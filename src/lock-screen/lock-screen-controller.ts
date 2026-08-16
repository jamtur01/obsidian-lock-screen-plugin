import { Notice, Platform, type Plugin } from "obsidian";

import { LockScreenView } from "#src/lock-screen/lock-screen-view";
import {
	getRemainingLockoutMs,
	recordFailedAttempt,
	resetFailedAttempts,
} from "#src/security/lockout";
import { verifyPassword, type PasswordCredential } from "#src/security/password";
import type { LockScreenSettings } from "#src/settings/settings";

interface LockScreenPluginHost extends Plugin {
	settings: LockScreenSettings;
	replaceSettings: (settings: LockScreenSettings) => Promise<void>;
}

interface DocumentContext {
	observer: MutationObserver;
	view: LockScreenView;
}

const PROTECTED_EVENTS: Array<keyof DocumentEventMap> = [
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
	private readonly contexts = new Map<Document, DocumentContext>();
	private idleTimer: number | null = null;
	private locked = false;
	private verifying = false;

	constructor(private readonly plugin: LockScreenPluginHost) {}

	start(): void {
		this.registerDocument(document);
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			this.registerDocument(leaf.view.containerEl.doc);
		});
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("window-open", (_workspaceWindow, openedWindow) => {
				this.registerDocument(openedWindow.document);
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("window-close", (_workspaceWindow, closedWindow) => {
				this.unregisterDocument(closedWindow.document);
			}),
		);
		this.plugin.registerInterval(window.setInterval(() => this.updateLockoutViews(), 1_000));
		this.lock();
	}

	destroy(): void {
		this.clearBlurTimer();
		this.clearIdleTimer();
		for (const context of this.contexts.values()) {
			context.observer.disconnect();
			context.view.hide();
		}
		this.contexts.clear();
	}

	lock(): void {
		if (this.locked) return;
		this.locked = true;
		this.clearBlurTimer();
		this.clearIdleTimer();
		for (const context of this.contexts.values()) context.view.mount();
		this.updateLockoutViews();
	}

	settingsChanged(): void {
		for (const [registeredDocument, context] of this.contexts) {
			context.view.hide();
			context.view = this.createView(registeredDocument);
			if (this.locked) context.view.mount();
		}
		this.updateLockoutViews();
		if (!this.locked) this.resetIdleTimer();
	}

	registerDocument(registeredDocument: Document): void {
		const registeredWindow = registeredDocument.defaultView;
		if (registeredWindow === null || this.contexts.has(registeredDocument)) return;

		const observer = new registeredWindow.MutationObserver(() => {
			if (this.locked) this.contexts.get(registeredDocument)?.view.mount();
		});
		const context = { observer, view: this.createView(registeredDocument) };
		this.contexts.set(registeredDocument, context);
		observer.observe(registeredDocument.documentElement, { childList: true, subtree: true });
		this.registerProtectionEvents(registeredDocument);
		this.registerTimingEvents(registeredDocument, registeredWindow);
		this.plugin.registerDomEvent(registeredWindow, "unload", () => {
			this.unregisterDocument(registeredDocument);
		});
		if (this.locked) context.view.mount();
	}

	private unregisterDocument(registeredDocument: Document): void {
		const context = this.contexts.get(registeredDocument);
		if (context === undefined) return;
		context.observer.disconnect();
		context.view.hide();
		this.contexts.delete(registeredDocument);
	}

	private registerProtectionEvents(registeredDocument: Document): void {
		for (const eventName of PROTECTED_EVENTS) {
			this.plugin.registerDomEvent(
				registeredDocument,
				eventName,
				(event) => this.protectDocumentEvent(registeredDocument, event),
				{ capture: true },
			);
		}
	}

	private registerTimingEvents(registeredDocument: Document, registeredWindow: Window): void {
		if (Platform.isDesktopApp) {
			this.plugin.registerDomEvent(registeredWindow, "blur", () => this.startBlurTimer());
			this.plugin.registerDomEvent(registeredWindow, "focus", () => this.clearBlurTimer());
			return;
		}

		for (const eventName of ACTIVITY_EVENTS) {
			this.plugin.registerDomEvent(registeredDocument, eventName, () =>
				this.resetIdleTimer(),
			);
		}
	}

	private protectDocumentEvent(registeredDocument: Document, event: Event): void {
		if (!this.locked) return;
		const view = this.contexts.get(registeredDocument)?.view;
		if (view?.containsEvent(event) === true) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	private createView(registeredDocument: Document): LockScreenView {
		return new LockScreenView(registeredDocument, this.plugin.settings.credential !== null, {
			continueWithoutPassword: () => this.continueWithoutPassword(),
			submitPassword: async (password) => this.submitPassword(password),
		});
	}

	private continueWithoutPassword(): void {
		if (this.plugin.settings.credential !== null) return;
		this.unlock();
	}

	private async submitPassword(password: string): Promise<void> {
		const credential = this.getCredentialForAttempt();
		if (credential === null) return;

		this.verifying = true;
		for (const context of this.contexts.values()) context.view.setBusy(true);
		try {
			const verified = await verifyPassword(password, credential);
			if (verified) await this.acceptPassword();
			else await this.rejectPassword();
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

	private getCredentialForAttempt(): PasswordCredential | null {
		if (this.verifying) return null;
		if (getRemainingLockoutMs(this.plugin.settings, Date.now()) > 0) return null;
		return this.plugin.settings.credential;
	}

	private async acceptPassword(): Promise<void> {
		const failures = resetFailedAttempts();
		await this.storeSecurityState({ ...this.plugin.settings, ...failures });
		this.unlock();
	}

	private async rejectPassword(): Promise<void> {
		const failures = recordFailedAttempt(this.plugin.settings, Date.now());
		await this.storeSecurityState({ ...this.plugin.settings, ...failures });
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
		const remainingMs = getRemainingLockoutMs(this.plugin.settings, Date.now());
		for (const context of this.contexts.values()) context.view.setLockout(remainingMs);
	}

	private unlock(): void {
		this.locked = false;
		for (const context of this.contexts.values()) context.view.hide();
		this.plugin.app.workspace.activeEditor?.editor?.focus();
		this.resetIdleTimer();
	}

	private startBlurTimer(): void {
		if (this.locked) return;
		this.clearBlurTimer();
		this.blurTimer = window.setTimeout(() => this.finishBlurTransition(), 0);
	}

	private finishBlurTransition(): void {
		this.blurTimer = null;
		this.registerDocument(activeDocument);
		if (activeDocument.hasFocus()) return;
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
		if (Platform.isDesktopApp || this.locked) return;
		this.clearIdleTimer();
		this.idleTimer = window.setTimeout(
			() => this.lock(),
			this.plugin.settings.idleTimeoutSeconds * 1_000,
		);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer === null) return;
		window.clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}
}
