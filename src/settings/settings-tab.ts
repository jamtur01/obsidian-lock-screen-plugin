import {
	ConfirmationModal,
	Notice,
	PluginSettingTab,
	type App,
	type Plugin,
	type SettingDefinitionItem,
} from "obsidian";

import { PasswordModal } from "#src/settings/password-modal";
import type { LockScreenSettings } from "#src/settings/settings";

type TimingSettingKey = "idleTimeoutSeconds" | "lockDelaySeconds";
type SettingKey = TimingSettingKey | "lockOnStartup";

interface LockScreenPluginHost extends Plugin {
	settings: LockScreenSettings;
	clearPassword: () => Promise<void>;
	setPassword: (password: string) => Promise<void>;
	setLockOnStartup: (value: boolean) => Promise<void>;
	updateTimingSetting: (key: TimingSettingKey, value: number) => Promise<void>;
}

export class LockScreenSettingsTab extends PluginSettingTab {
	private readonly lockScreenPlugin: LockScreenPluginHost;

	constructor(app: App, lockScreenPlugin: LockScreenPluginHost) {
		super(app, lockScreenPlugin);
		this.lockScreenPlugin = lockScreenPlugin;
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name:
					this.lockScreenPlugin.settings.credential === null
						? "Set password"
						: "Change password",
				desc: "The password is stored as a salted PBKDF2 hash, never as plaintext.",
				render: (setting) => {
					setting.addButton((button) => {
						button
							.setButtonText("Set password")
							.setCta()
							.onClick(() => this.openPasswordModal());
					});
				},
			},
			{
				name: "Remove password",
				desc: "The vault stops locking until you set a new password.",
				render: (setting) => {
					setting.addButton((button) => {
						button
							.setButtonText("Remove password")
							.setDestructive()
							.onClick(() => this.confirmPasswordRemoval());
					});
				},
				visible: () => this.lockScreenPlugin.settings.credential !== null,
			},
			{
				name: "Lock when Obsidian starts",
				desc:
					"Ask for the password before showing the vault on a cold start. Without " +
					"this, anyone who opens Obsidian can read your notes: the idle timeout " +
					"only fires when nobody is using it.",
				control: { key: "lockOnStartup", type: "toggle" },
			},
			...this.createTimingDefinitions(),
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "lockOnStartup") {
			if (typeof value !== "boolean") throw new TypeError(`${key} must be a boolean.`);
			await this.lockScreenPlugin.setLockOnStartup(value);
			return;
		}
		if (key !== "idleTimeoutSeconds" && key !== "lockDelaySeconds") {
			throw new Error(`Unsupported Lock Screen setting: ${key}`);
		}
		if (typeof value !== "number") throw new TypeError(`${key} must be a number.`);
		await this.lockScreenPlugin.updateTimingSetting(key, value);
	}

	private createTimingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		const idleTimeout: SettingDefinitionItem<SettingKey> = {
			name: "Idle timeout",
			desc: "Seconds without interaction before locking. Set to 0 to never lock on idle.",
			control: {
				key: "idleTimeoutSeconds",
				max: 86_400,
				min: 0,
				step: 1,
				type: "number",
				validate: (value) => this.validateSeconds(value),
			},
		};
		return [
			{
				name: "Lock delay",
				desc: "Seconds to wait after all Obsidian windows lose focus.",
				control: {
					key: "lockDelaySeconds",
					max: 86_400,
					min: 0,
					step: 1,
					type: "number",
					validate: (value) => this.validateSeconds(value),
				},
			},
			idleTimeout,
		];
	}

	private validateSeconds(value: number): string | undefined {
		if (!Number.isInteger(value)) return "Enter a whole number of seconds.";
		if (value < 0 || value > 86_400) return "Enter a value from 0 to 86400 seconds.";
		return undefined;
	}

	private openPasswordModal(): void {
		new PasswordModal({
			app: this.app,
			onSave: async (password) => this.lockScreenPlugin.setPassword(password),
			onSaved: () => this.update(),
		}).open();
	}

	private confirmPasswordRemoval(): void {
		const modal = new ConfirmationModal(this.app);
		modal.titleEl.textContent = "Remove lock screen password?";
		modal.contentEl.textContent =
			"The vault will stop locking until you set a new password. This device's stored " +
			"password is replaced, not deleted.";
		modal.addCancelButton();
		modal.addButton((button) => {
			button
				.setButtonText("Remove password")
				.setDestructive()
				.onClick(async () => {
					try {
						await this.lockScreenPlugin.clearPassword();
						this.update();
						return false;
					} catch {
						void new Notice(
							"Could not remove the password. Check vault write access.",
							10_000,
						);
						return true;
					}
				});
		});
		modal.open();
	}
}
