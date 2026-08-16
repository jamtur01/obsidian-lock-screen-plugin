import { maskPasswordInput } from "#src/security/masked-input";
import { MIN_PASSWORD_LENGTH } from "#src/security/password";

export type LockScreenViewMode = "cover" | "password" | "unreadable";

export interface LockScreenViewCallbacks {
	submitPassword: (password: string) => Promise<void>;
	tryPassword: (password: string) => void;
}

// Checking as the user types costs a full key derivation per check, so wait for a pause rather
// than firing on every keystroke, and ignore anything too short to be a valid password.
const PROBE_DELAY_MS = 350;

const OVERLAY_CLASS = "edb-lock-screen";

// Re-applied whenever the DOM mutates while locked. Inline `!important` outranks the
// stylesheet and survives it being unloaded, so neither a snippet nor injected JavaScript can
// hide the overlay and expose the notes underneath.
const CRITICAL_STYLE_DECLARATIONS = [
	"animation: none !important",
	"align-items: center !important",
	"clip: auto !important",
	"clip-path: none !important",
	"content-visibility: visible !important",
	"display: flex !important",
	"filter: none !important",
	"height: auto !important",
	"inset: 0 !important",
	"justify-content: center !important",
	"margin: 0 !important",
	"mask: none !important",
	"max-height: none !important",
	"max-width: none !important",
	"min-height: 100% !important",
	"min-width: 100% !important",
	"mix-blend-mode: normal !important",
	"opacity: 1 !important",
	"pointer-events: auto !important",
	"position: fixed !important",
	"rotate: none !important",
	"scale: none !important",
	"transform: none !important",
	"transition: none !important",
	"translate: none !important",
	"visibility: visible !important",
	"width: auto !important",
	"-webkit-mask: none !important",
	"zoom: 1 !important",
	"z-index: 2147483647 !important",
];

/**
 * Both halves of the surface are literals. Pinning the background to a theme variable let a
 * snippet make the overlay transparent; pinning only the background left the theme's dark text
 * on a forced dark background, which is unreadable in a light theme. The theme chooses between
 * two readable pairs and can do nothing else.
 */
const DARK_SURFACE = { background: "#1e1e1e", text: "#dcddde" };
const LIGHT_SURFACE = { background: "#ffffff", text: "#1f1f1f" };

const STOP_PROPAGATION_EVENTS: Array<keyof HTMLElementEventMap> = [
	"click",
	"contextmenu",
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

export class LockScreenView {
	private appliedStyleText: string | null = null;
	private probeTimer: number | null = null;
	private appliedSurface: string | null = null;
	private busy = false;
	private errorMessage = "";
	private readonly overlayEl: HTMLDivElement;
	private passwordInput: HTMLInputElement | null = null;
	private remainingLockoutMs = 0;
	private statusEl: HTMLParagraphElement | null = null;
	private submitButton: HTMLButtonElement | null = null;

	constructor(
		private readonly document: Document,
		mode: LockScreenViewMode,
		private readonly callbacks: LockScreenViewCallbacks,
	) {
		this.overlayEl = this.createOverlay();
		if (mode === "password") this.createPasswordForm(callbacks.submitPassword);
		else if (mode === "cover") this.createUnlockElsewhereMessage();
		else this.createUnreadableMessage();
	}

	containsEvent(event: Event): boolean {
		return event.composedPath().includes(this.overlayEl);
	}

	/** Restores the overlay after any tampering: removal, reparenting, class or style edits. */
	enforce(): void {
		this.applyCriticalStyles();
		this.mount();
		this.restoreFocus();
	}

	mount(): void {
		if (this.overlayEl.parentElement === this.document.body) return;
		this.document.body.append(this.overlayEl);
		this.document.defaultView?.requestAnimationFrame(() => this.passwordInput?.focus());
	}

	hide(): void {
		this.cancelProbe();
		this.overlayEl.remove();
		// Nothing typed or reported during this lock should survive into the next one.
		this.errorMessage = "";
		this.clearPassword();
		this.updateStatus(this.remainingLockoutMs);
	}

	/**
	 * Anything that takes focus out of the overlay while locked would leave the user unable to
	 * type, since keystrokes outside the lock UI are blocked. Only the window holding the
	 * password field has anything to restore, and only while it has focus, so this cannot pull
	 * focus away from the window the user is actually in.
	 */
	private restoreFocus(): void {
		if (this.passwordInput === null || !this.document.hasFocus()) return;
		const focused = this.document.activeElement;
		if (focused !== null && this.overlayEl.contains(focused)) return;
		this.passwordInput.focus();
	}

	clearPassword(): void {
		if (this.passwordInput === null) return;
		this.passwordInput.value = "";
		if (this.overlayEl.isConnected) this.passwordInput.focus();
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		this.updateControls();
	}

	setError(message: string): void {
		this.errorMessage = message;
		this.updateStatus(0);
	}

	setLockout(remainingMs: number): void {
		this.remainingLockoutMs = remainingMs;
		this.updateControls();
		this.updateStatus(remainingMs);
	}

	private cancelProbe(): void {
		if (this.probeTimer === null) return;
		this.document.defaultView?.clearTimeout(this.probeTimer);
		this.probeTimer = null;
	}

	private createOverlay(): HTMLDivElement {
		const overlay = this.document.createElement("div");
		overlay.className = OVERLAY_CLASS;
		overlay.setAttribute("aria-label", "Lock screen");
		overlay.setAttribute("aria-modal", "true");
		overlay.setAttribute("role", "dialog");

		for (const eventName of STOP_PROPAGATION_EVENTS) {
			overlay.addEventListener(eventName, (event) => event.stopPropagation());
		}

		return overlay;
	}

	private criticalStyleText(): string {
		const surface = this.document.body.classList.contains("theme-light")
			? LIGHT_SURFACE
			: DARK_SURFACE;

		return [
			...CRITICAL_STYLE_DECLARATIONS,
			`background-color: ${surface.background} !important`,
			`color: ${surface.text} !important`,
		].join("; ");
	}

	private applyCriticalStyles(): void {
		const styleText = this.criticalStyleText();
		if (
			this.appliedStyleText !== null &&
			this.appliedSurface === styleText &&
			this.overlayEl.className === OVERLAY_CLASS &&
			this.overlayEl.getAttribute("style") === this.appliedStyleText
		) {
			return;
		}

		this.appliedSurface = styleText;
		this.overlayEl.className = OVERLAY_CLASS;
		this.overlayEl.style.cssText = styleText;
		// Record what the engine actually serialised so later comparisons converge instead of
		// rewriting the attribute on every mutation.
		this.appliedStyleText = this.overlayEl.getAttribute("style") ?? "";
	}

	private scheduleProbe(tryPassword: (password: string) => void, input: HTMLInputElement): void {
		const view = this.document.defaultView;
		if (view === null) return;
		if (this.probeTimer !== null) view.clearTimeout(this.probeTimer);
		this.probeTimer = view.setTimeout(() => {
			this.probeTimer = null;
			if (input.value.length >= MIN_PASSWORD_LENGTH) tryPassword(input.value);
		}, PROBE_DELAY_MS);
	}

	private createPasswordForm(submitPassword: (password: string) => Promise<void>): void {
		const form = this.document.createElement("form");
		form.className = "edb-lock-screen__panel";
		this.appendTitle(form);

		const input = this.document.createElement("input");
		input.autocomplete = "current-password";
		input.className = "edb-lock-screen__password";
		input.setAttribute("aria-label", "Lock screen password");
		maskPasswordInput(input);
		input.addEventListener("keydown", (event) => this.handlePasswordKey(event));
		input.addEventListener("input", () =>
			this.scheduleProbe(this.callbacks.tryPassword, input),
		);
		form.append(input);
		this.passwordInput = input;

		this.submitButton = this.createButton("Unlock");
		form.append(this.submitButton);
		this.statusEl = this.createStatus();
		form.append(this.statusEl);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			void submitPassword(input.value);
		});
		this.overlayEl.append(form);
	}

	/**
	 * Shown in every covered window except the one holding the password field. Two focusable
	 * fields in two windows fight over focus, and there is no reason to authenticate twice.
	 */
	private createUnlockElsewhereMessage(): void {
		const panel = this.document.createElement("section");
		panel.className = "edb-lock-screen__panel";
		this.appendTitle(panel);

		const message = this.document.createElement("p");
		message.textContent = "Unlock in the main Obsidian window.";
		panel.append(message);
		this.overlayEl.append(panel);
	}

	private createUnreadableMessage(): void {
		const panel = this.document.createElement("section");
		panel.className = "edb-lock-screen__panel";
		this.appendTitle(panel);

		const message = this.document.createElement("p");
		message.textContent =
			"This device's stored password could not be read, so the lock screen cannot be " +
			"dismissed. Delete the secret named obsidian-lock-screen-plugin-state-v1 under " +
			"Settings, Keychain, then restart Obsidian to set a new password.";
		panel.append(message);
		this.overlayEl.append(panel);
	}

	private appendTitle(parent: HTMLElement): void {
		const title = this.document.createElement("h1");
		title.className = "edb-lock-screen__title";
		title.textContent = "Obsidian is locked";
		parent.append(title);
	}

	private createButton(label: string): HTMLButtonElement {
		const button = this.document.createElement("button");
		button.className = "mod-cta edb-lock-screen__button";
		button.textContent = label;
		button.type = "submit";
		return button;
	}

	private createStatus(): HTMLParagraphElement {
		const status = this.document.createElement("p");
		status.className = "edb-lock-screen__status";
		status.setAttribute("aria-live", "polite");
		status.setAttribute("role", "status");
		return status;
	}

	private handlePasswordKey(event: KeyboardEvent): void {
		if (event.key !== "Escape" || this.passwordInput === null) return;
		event.preventDefault();
		this.passwordInput.value = "";
	}

	private updateControls(): void {
		const disabled = this.busy || this.remainingLockoutMs > 0;
		if (this.passwordInput !== null) this.passwordInput.disabled = disabled;
		if (this.submitButton === null) return;
		this.submitButton.disabled = disabled;
		this.submitButton.textContent = this.busy ? "Checking…" : "Unlock";
	}

	private updateStatus(remainingMs: number): void {
		if (this.statusEl === null) return;
		if (remainingMs > 0) {
			const seconds = Math.ceil(remainingMs / 1_000);
			this.statusEl.textContent = `Too many attempts. Try again in ${seconds} seconds.`;
			return;
		}
		this.statusEl.textContent = this.errorMessage;
	}
}
