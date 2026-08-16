import { Modal, Setting, type App, type ButtonComponent } from "obsidian";

import { maskPasswordInput } from "#src/security/masked-input";
import { validateNewPassword } from "#src/security/password";

interface PasswordModalOptions {
	app: App;
	onSave: (password: string) => Promise<void>;
	onSaved: () => void;
}

export class PasswordModal extends Modal {
	private confirmation = "";
	private password = "";
	private saving = false;

	constructor(private readonly options: PasswordModalOptions) {
		super(options.app);
	}

	override onOpen(): void {
		this.titleEl.textContent = "Set lock screen password";
		this.contentEl.empty();

		this.addPasswordSetting("Password", (value) => {
			this.password = value;
		});
		this.addPasswordSetting("Confirm password", (value) => {
			this.confirmation = value;
		});

		const status = this.contentEl.createEl("p", {
			cls: "edb-password-modal__status",
			attr: { "aria-live": "polite", role: "status" },
		});
		let saveButton: ButtonComponent;
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel").onClick(() => this.close());
			})
			.addButton((button) => {
				saveButton = button
					.setButtonText("Save password")
					.setCta()
					.onClick(() => this.savePassword(saveButton, status));
			});
	}

	override onClose(): void {
		// Cancelling leaves both fields populated for as long as the modal is reachable.
		this.password = "";
		this.confirmation = "";
		this.contentEl.empty();
	}

	private addPasswordSetting(label: string, onChange: (value: string) => void): void {
		new Setting(this.contentEl).setName(label).addText((text) => {
			text.setPlaceholder("Enter at least 8 characters").onChange(onChange);
			text.inputEl.autocomplete = "new-password";
			maskPasswordInput(text.inputEl);
		});
	}

	private async savePassword(button: ButtonComponent, status: HTMLElement): Promise<void> {
		if (this.saving) return;
		const validationError = validateNewPassword(this.password);
		if (validationError !== null) {
			status.textContent = validationError;
			return;
		}
		if (this.password !== this.confirmation) {
			status.textContent = "The passwords do not match.";
			return;
		}

		this.saving = true;
		button.setDisabled(true).setButtonText("Saving…");
		status.textContent = "";
		try {
			await this.options.onSave(this.password);
			this.password = "";
			this.confirmation = "";
			this.options.onSaved();
			this.close();
		} catch {
			status.textContent =
				"Could not save the password. Check vault write access and try again.";
		} finally {
			this.saving = false;
			button.setDisabled(false).setButtonText("Save password");
		}
	}
}
