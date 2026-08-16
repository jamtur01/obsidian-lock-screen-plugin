import { Notice, Scope, type Plugin } from "obsidian";

import { LockScreenView, type LockScreenViewMode } from "#src/lock-screen/lock-screen-view";
import {
	getRemainingLockoutMs,
	recordFailedAttempt,
	resetFailedAttempts,
} from "#src/security/lockout";
import { verifyPassword, type PasswordCredential } from "#src/security/password";
import type { LockScreenSettings } from "#src/settings/settings";

export interface LockScreenPluginHost extends Plugin {
	credentialUnreadable: boolean;
	settings: LockScreenSettings;
	replaceSettings: (settings: LockScreenSettings) => Promise<void>;
}

interface DocumentContext {
	cleanups: Array<() => void>;
	observer: MutationObserver;
	view: LockScreenView;
}

// Window capture precedes every document-target listener. Obsidian core hotkeys are also blocked
// through an active Scope because listeners already registered on the same Window still run first.
const PROTECTED_EVENTS: Array<keyof WindowEventMap> = [
	"click",
	"contextmenu",
	"dragstart",
	"drop",
	"keydown",
	"keyup",
	"mousedown",
	"mouseup",
	"pointerdown",
	"pointerup",
	"touchend",
	"touchstart",
	"wheel",
];

// Blocked even inside the lock UI: there is no legitimate reason to drag text out of the
// password field, and doing so would defeat the masking.
const ALWAYS_BLOCKED_EVENTS = new Set<string>(["dragstart", "drop"]);

// The only Ctrl/Cmd combinations allowed inside the lock UI, so a password manager can still
// fill the field. Copy and cut are excluded for the same reason dragging out is blocked. Alt is
// not treated as a command modifier: it composes accented characters on macOS.
const EDITING_SHORTCUT_KEYS = new Set(["a", "v", "y", "z"]);

// Only observed while locked. CodeMirror mutates the DOM on every keystroke, so a permanent
// subtree observer would tax normal editing for no benefit.
const OVERLAY_OBSERVER_OPTIONS: MutationObserverInit = {
	attributeFilter: ["class", "style"],
	attributes: true,
	childList: true,
	subtree: true,
};

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
	"keydown",
	"mousedown",
	"mousemove",
	"scroll",
	"touchstart",
	"wheel",
];

export class LockScreenController {
	private blurTimer: number | null = null;
	private readonly closedDocuments = new WeakSet<Document>();
	private readonly contexts = new Map<Document, DocumentContext>();
	private idleTimer: number | null = null;
	private readonly lockScope = new Scope();
	// The window that carries the password field. Every other window gets a plain cover.
	private readonly primaryDocument = document;
	private locked = false;
	// Wall-clock deadlines survive a restart. A parallel monotonic deadline prevents a later
	// system-clock change from shortening a lockout during the current session.
	private monotonicLockoutUntil = 0;
	private scopeActive = false;
	private settingsRevision = 0;
	private verifying = false;

	constructor(private readonly plugin: LockScreenPluginHost) {
		this.lockScope.register(null, null, (event) => this.handleKeymapEvent(event));
	}

	start(): void {
		this.extendMonotonicLockoutFromSettings();
		this.registerDocument(document);
		// Leaves do not exist yet at onload, so pop-outs restored from the previous session are
		// only reachable once the layout is ready.
		this.plugin.app.workspace.onLayoutReady(() => {
			this.plugin.app.workspace.iterateAllLeaves((leaf) => {
				this.registerDocument(leaf.view.containerEl.doc);
			});
		});
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("window-open", (_workspaceWindow, openedWindow) => {
				this.registerDocument(openedWindow.document);
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("window-close", (_workspaceWindow, closedWindow) => {
				this.closedDocuments.add(closedWindow.document);
				this.unregisterDocument(closedWindow.document);
			}),
		);
		this.plugin.registerInterval(window.setInterval(() => this.updateLockoutViews(), 1_000));
		if (this.shouldLockOnStart()) this.lock();
		else this.resetIdleTimer();
	}

	/**
	 * Locking on start covers someone opening Obsidian and reading before any timer could fire.
	 *
	 * It does not cover enabling or reloading the plugin, because doing either requires already
	 * being inside an unlocked Obsidian. A ready layout means the app was already running, so the
	 * person who caused this load is present and has had access all along.
	 */
	private shouldLockOnStart(): boolean {
		if (!this.plugin.settings.lockOnStartup) return false;
		return !this.plugin.app.workspace.layoutReady;
	}

	destroy(): void {
		this.settingsRevision += 1;
		this.clearBlurTimer();
		this.clearIdleTimer();
		this.deactivateKeymapScope();
		// Deleting the current entry mid-iteration is well defined for Map.
		for (const registeredDocument of this.contexts.keys()) {
			this.unregisterDocument(registeredDocument);
		}
		this.locked = false;
	}

	isLocked(): boolean {
		return this.locked;
	}

	lock(): void {
		if (this.locked || !this.canLock()) return;
		this.locked = true;
		this.activateKeymapScope();
		this.clearBlurTimer();
		this.clearIdleTimer();
		for (const [registeredDocument, context] of this.contexts) {
			this.startEnforcing(registeredDocument, context);
		}
		this.updateLockoutViews();
	}

	settingsChanged(): void {
		this.settingsRevision += 1;
		this.extendMonotonicLockoutFromSettings();
		for (const [registeredDocument, context] of this.contexts) {
			context.view.hide();
			context.view = this.createView(registeredDocument);
			if (this.locked) context.view.enforce();
		}
		this.updateLockoutViews();
		if (!this.locked) this.resetIdleTimer();
	}

	/**
	 * Only the main window and the pop-outs the workspace reports, because only those show notes.
	 * Covering anything else — a settings window, say — puts another lock screen in the user's
	 * way with nothing behind it worth hiding. Settings stay safe because the plugin refuses to
	 * change them while locked, not because they are covered.
	 */
	registerDocument(registeredDocument: Document): void {
		const registeredWindow = registeredDocument.defaultView;
		if (
			registeredWindow === null ||
			registeredWindow.closed ||
			this.closedDocuments.has(registeredDocument) ||
			this.contexts.has(registeredDocument)
		) {
			return;
		}

		const observer = new registeredWindow.MutationObserver(() => {
			if (this.locked) this.contexts.get(registeredDocument)?.view.enforce();
		});
		const context: DocumentContext = {
			cleanups: [],
			observer,
			view: this.createView(registeredDocument),
		};
		this.contexts.set(registeredDocument, context);
		this.registerProtectionEvents(context, registeredDocument, registeredWindow);
		this.registerTimingEvents(context, registeredDocument, registeredWindow);
		this.listen(context, registeredWindow, "unload", () => {
			this.closedDocuments.add(registeredDocument);
			this.unregisterDocument(registeredDocument);
		});
		if (this.locked) this.startEnforcing(registeredDocument, context);
	}

	private startEnforcing(registeredDocument: Document, context: DocumentContext): void {
		context.view.enforce();
		context.observer.observe(registeredDocument.documentElement, OVERLAY_OBSERVER_OPTIONS);
	}

	private unregisterDocument(registeredDocument: Document): void {
		const context = this.contexts.get(registeredDocument);
		if (context === undefined) return;
		for (const cleanup of context.cleanups) cleanup();
		context.cleanups.length = 0;
		context.observer.disconnect();
		context.view.hide();
		this.contexts.delete(registeredDocument);
	}

	/**
	 * Binds a listener for the lifetime of one document's context. Obsidian's registerDomEvent
	 * only unbinds on plugin unload, which would leave a closed pop-out's handlers — and their
	 * event blocking — attached for the rest of the session.
	 */
	private listen(
		context: DocumentContext,
		target: EventTarget,
		eventName: string,
		handler: EventListener,
		options?: AddEventListenerOptions,
	): void {
		target.addEventListener(eventName, handler, options);
		context.cleanups.push(() => target.removeEventListener(eventName, handler, options));
	}

	private registerProtectionEvents(
		context: DocumentContext,
		registeredDocument: Document,
		registeredWindow: Window,
	): void {
		for (const eventName of PROTECTED_EVENTS) {
			this.listen(
				context,
				registeredWindow,
				eventName,
				(event) => this.protectDocumentEvent(registeredDocument, event),
				{ capture: true },
			);
		}
	}

	private registerTimingEvents(
		context: DocumentContext,
		registeredDocument: Document,
		registeredWindow: Window,
	): void {
		this.listen(context, registeredWindow, "blur", () => this.startBlurTimer());
		this.listen(context, registeredWindow, "focus", () => this.clearBlurTimer());

		for (const eventName of ACTIVITY_EVENTS) {
			this.listen(context, registeredDocument, eventName, () => this.resetIdleTimer());
		}
	}

	private protectDocumentEvent(registeredDocument: Document, event: Event): void {
		if (!this.locked) return;
		const view = this.contexts.get(registeredDocument)?.view;
		if (view?.containsEvent(event) === true && !ALWAYS_BLOCKED_EVENTS.has(event.type)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	/**
	 * Runs for every keystroke while locked. Returning false makes Obsidian preventDefault, so
	 * plain typing inside the lock UI must be allowed through or the password cannot be entered.
	 * A hotkey pressed inside the lock UI is still blocked: it would open a modal beneath the
	 * overlay and take focus away from the password field.
	 */
	private handleKeymapEvent(event: KeyboardEvent): boolean {
		if (!this.isInsideLockUi(event)) return false;
		if (!event.ctrlKey && !event.metaKey) return true;
		return EDITING_SHORTCUT_KEYS.has(event.key.toLowerCase());
	}

	private isInsideLockUi(event: KeyboardEvent): boolean {
		for (const context of this.contexts.values()) {
			if (context.view.containsEvent(event)) return true;
		}
		return false;
	}

	private activateKeymapScope(): void {
		if (this.scopeActive) return;
		this.plugin.app.keymap.pushScope(this.lockScope);
		this.scopeActive = true;
	}

	private deactivateKeymapScope(): void {
		if (!this.scopeActive) return;
		this.plugin.app.keymap.popScope(this.lockScope);
		this.scopeActive = false;
	}

	private createView(registeredDocument: Document): LockScreenView {
		return new LockScreenView(registeredDocument, this.getViewMode(registeredDocument), {
			submitPassword: async (password) => this.submitPassword(password),
		});
	}

	private getViewMode(registeredDocument: Document): LockScreenViewMode {
		if (registeredDocument !== this.primaryDocument) return "cover";
		return this.plugin.credentialUnreadable ? "unreadable" : "password";
	}

	/**
	 * With no password there is nothing to authenticate against, so a lock screen would only be
	 * something to click past. Lock when there is a password to check, or when the stored record
	 * is unreadable and the safe assumption is that there was one.
	 */
	canLock(): boolean {
		return this.plugin.credentialUnreadable || this.plugin.settings.credential !== null;
	}

	private async submitPassword(password: string): Promise<void> {
		const credential = this.getCredentialForAttempt();
		if (credential === null) return;
		const settingsRevision = this.settingsRevision;

		this.verifying = true;
		for (const context of this.contexts.values()) context.view.setBusy(true);
		try {
			const verified = await verifyPassword(password, credential);
			if (!this.isCurrentAttempt(credential, settingsRevision)) return;
			if (verified) await this.acceptPassword(credential, settingsRevision);
			else await this.rejectPassword(credential, settingsRevision);
		} catch {
			this.showError("Password verification failed. Restart Obsidian and try again.");
		} finally {
			this.verifying = false;
			for (const context of this.contexts.values()) {
				context.view.setBusy(false);
				context.view.clearPassword();
			}
			this.updateLockoutViews();
		}
	}

	private getLockoutRemainingMs(): number {
		return Math.max(
			getRemainingLockoutMs(this.plugin.settings, Date.now()),
			this.monotonicLockoutUntil - performance.now(),
			0,
		);
	}

	private extendMonotonicLockoutFromSettings(): void {
		const monotonicNow = performance.now();
		const existingRemainingMs = Math.max(0, this.monotonicLockoutUntil - monotonicNow);
		const storedRemainingMs = getRemainingLockoutMs(this.plugin.settings, Date.now());
		this.monotonicLockoutUntil =
			monotonicNow + Math.max(existingRemainingMs, storedRemainingMs);
	}

	private getCredentialForAttempt(): PasswordCredential | null {
		if (this.verifying) return null;
		if (this.getLockoutRemainingMs() > 0) return null;
		return this.plugin.settings.credential;
	}

	private isCurrentAttempt(credential: PasswordCredential, settingsRevision: number): boolean {
		return (
			settingsRevision === this.settingsRevision &&
			!this.plugin.credentialUnreadable &&
			this.plugin.settings.credential === credential
		);
	}

	private async acceptPassword(
		credential: PasswordCredential,
		settingsRevision: number,
	): Promise<void> {
		const failures = resetFailedAttempts();
		this.monotonicLockoutUntil = 0;
		await this.storeSecurityState({ ...this.plugin.settings, ...failures });
		if (!this.isCurrentAttempt(credential, settingsRevision)) return;
		this.unlock();
	}

	private async rejectPassword(
		credential: PasswordCredential,
		settingsRevision: number,
	): Promise<void> {
		const now = Date.now();
		const failures = recordFailedAttempt(this.plugin.settings, now);
		if (failures.lockedUntil > now) {
			this.monotonicLockoutUntil = performance.now() + (failures.lockedUntil - now);
		}
		await this.storeSecurityState({ ...this.plugin.settings, ...failures });
		if (!this.isCurrentAttempt(credential, settingsRevision)) return;
		this.showError("Incorrect password.");
		this.updateLockoutViews();
	}

	private async storeSecurityState(settings: LockScreenSettings): Promise<void> {
		try {
			await this.plugin.replaceSettings(settings);
		} catch {
			this.plugin.settings = settings;
			void new Notice(
				"Lock Screen could not save authentication state. Check vault write access.",
				10_000,
			);
		}
	}

	private showError(message: string): void {
		for (const context of this.contexts.values()) context.view.setError(message);
	}

	private updateLockoutViews(): void {
		const remainingMs = this.getLockoutRemainingMs();
		for (const context of this.contexts.values()) context.view.setLockout(remainingMs);
	}

	private unlock(): void {
		this.locked = false;
		this.deactivateKeymapScope();
		for (const context of this.contexts.values()) {
			context.observer.disconnect();
			context.view.hide();
		}
		this.plugin.app.workspace.activeEditor?.editor?.focus();
		this.resetIdleTimer();
	}

	private startBlurTimer(): void {
		if (this.locked || !this.canLock()) return;
		this.clearBlurTimer();
		this.blurTimer = window.setTimeout(() => this.finishBlurTransition(), 0);
	}

	private finishBlurTransition(): void {
		this.blurTimer = null;
		// Only ever reads focus here. Registering whatever window happens to be focused would
		// pull in settings windows, which then get an overlay and event blocking of their own.
		const focusedDocument = activeDocument;
		if (focusedDocument.defaultView?.closed !== false) return;
		if (focusedDocument.hasFocus()) return;
		this.blurTimer = window.setTimeout(
			() => this.lock(),
			this.plugin.settings.lockDelaySeconds * 1_000,
		);
	}

	private clearBlurTimer(): void {
		if (this.blurTimer === null) return;
		window.clearTimeout(this.blurTimer);
		this.blurTimer = null;
	}

	private resetIdleTimer(): void {
		if (this.locked || !this.canLock()) return;
		this.clearIdleTimer();
		const timeoutSeconds = this.plugin.settings.idleTimeoutSeconds;
		if (timeoutSeconds <= 0) return;
		this.idleTimer = window.setTimeout(() => this.lock(), timeoutSeconds * 1_000);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer === null) return;
		window.clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}
}
