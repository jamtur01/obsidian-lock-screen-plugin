export interface LockScreenViewCallbacks {
	continueWithoutPassword: () => void;
	submitPassword: (password: string) => Promise<void>;
}

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
	private busy = false;
	private errorMessage = "";
	private readonly overlayEl: HTMLDivElement;
	private passwordInput: HTMLInputElement | null = null;
	private remainingLockoutMs = 0;
	private statusEl: HTMLParagraphElement | null = null;
	private submitButton: HTMLButtonElement | null = null;

	constructor(
		private readonly document: Document,
		hasPassword: boolean,
		callbacks: LockScreenViewCallbacks,
	) {
		this.overlayEl = this.createOverlay();
		if (hasPassword) this.createPasswordForm(callbacks.submitPassword);
		else this.createNoPasswordMessage(callbacks.continueWithoutPassword);
	}

	containsEvent(event: Event): boolean {
		return event.composedPath().includes(this.overlayEl);
	}

	mount(): void {
		if (this.overlayEl.isConnected) return;
		this.document.body.append(this.overlayEl);
		this.document.defaultView?.requestAnimationFrame(() => this.passwordInput?.focus());
	}

	hide(): void {
		this.overlayEl.remove();
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

	private createOverlay(): HTMLDivElement {
		const overlay = this.document.createElement("div");
		overlay.className = "edb-lock-screen";
		overlay.setAttribute("aria-label", "Lock screen");
		overlay.setAttribute("aria-modal", "true");
		overlay.setAttribute("role", "dialog");

		for (const eventName of STOP_PROPAGATION_EVENTS) {
			overlay.addEventListener(eventName, (event) => event.stopPropagation());
		}

		return overlay;
	}

	private createPasswordForm(submitPassword: (password: string) => Promise<void>): void {
		const form = this.document.createElement("form");
		form.className = "edb-lock-screen__panel";
		this.appendTitle(form);

		const input = this.document.createElement("input");
		input.autocomplete = "current-password";
		input.className = "edb-lock-screen__password";
		input.setAttribute("aria-label", "Lock screen password");
		input.setAttribute("autocapitalize", "none");
		input.spellcheck = false;
		input.type = "text";
		input.addEventListener("keydown", (event) => this.handlePasswordKey(event));
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

	private createNoPasswordMessage(continueWithoutPassword: () => void): void {
		const panel = this.document.createElement("section");
		panel.className = "edb-lock-screen__panel";
		this.appendTitle(panel);

		const message = this.document.createElement("p");
		message.textContent = "No password is configured. Set one in the plugin settings.";
		panel.append(message);

		const button = this.createButton("Continue");
		button.addEventListener("click", continueWithoutPassword);
		panel.append(button);
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
