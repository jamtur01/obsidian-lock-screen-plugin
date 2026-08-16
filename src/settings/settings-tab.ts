import {
	ConfirmationModal,
	Notice,
	Platform,
	PluginSettingTab,
	type App,
	type Plugin,
	type SettingDefinitionItem,
} from "obsidian";

import { PasswordModal } from "#src/settings/password-modal";
import type { LockScreenSettings } from "#src/settings/settings";

type TimingSettingKey = "idleTimeoutSeconds" | "lockDelaySeconds";

interface LockScreenPluginHost extends Plugin {
	settings: LockScreenSettings;
	clearPassword: () => Promise<void>;
	registerDocument: (registeredDocument: Document) => void;
	setPassword: (password: string) => Promise<void>;
	updateTimingSetting: (key: TimingSettingKey, value: number) => Promise<void>;
}

export class LockScreenSettingsTab extends PluginSettingTab {
	private readonly lockScreenPlugin: LockScreenPluginHost;

	constructor(app: App, lockScreenPlugin: LockScreenPluginHost) {
		super(app, lockScreenPlugin);
		this.lockScreenPlugin = lockScreenPlugin;
	}

	override getSettingDefinitions(): SettingDefinitionItem<TimingSettingKey>[] {
		return [
			{
				name:
					this.lockScreenPlugin.settings.credential === null
						? "Set password"
						: "Change password",
				desc: "The password is stored as a salted PBKDF2 hash, never as plaintext.",
				render: (setting) => {
					this.lockScreenPlugin.registerDocument(setting.settingEl.doc);
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
				desc: "The lock screen can then be dismissed without authentication.",
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
			this.createTimingDefinition(),
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== "idleTimeoutSeconds" && key !== "lockDelaySeconds") {
			throw new Error(`Unsupported Lock Screen setting: ${key}`);
		}
		if (typeof value !== "number") throw new TypeError(`${key} must be a number.`);
		await this.lockScreenPlugin.updateTimingSetting(key, value);
	}

	private createTimingDefinition(): SettingDefinitionItem<TimingSettingKey> {
		if (Platform.isDesktopApp) {
			return {
				name: "Lock delay",
				desc: "Seconds to wait after all Obsidian windows lose focus.",
				control: {
					key: "lockDelaySeconds",
					max: 86_400,
					min: 0,
					step: 1,
					type: "number",
					validate: (value) => this.validateSeconds(value, 0),
				},
			};
		}

		return {
			name: "Idle timeout",
			desc: "Seconds without interaction before the mobile app locks.",
			control: {
				key: "idleTimeoutSeconds",
				max: 86_400,
				min: 5,
				step: 1,
				type: "number",
				validate: (value) => this.validateSeconds(value, 5),
			},
		};
	}

	private validateSeconds(value: number, minimum: number): string | undefined {
		if (!Number.isInteger(value)) return "Enter a whole number of seconds.";
		if (value < minimum || value > 86_400) {
			return `Enter a value from ${minimum} to 86400 seconds.`;
		}
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
		modal.contentEl.textContent = "The lock screen will no longer require authentication.";
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
