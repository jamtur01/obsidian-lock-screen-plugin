import { Notice, Plugin } from "obsidian";

import { LockScreenController } from "#src/lock-screen/lock-screen-controller";
import { createPasswordCredential } from "#src/security/password";
import { DEFAULT_SETTINGS, parseSettings, type LockScreenSettings } from "#src/settings/settings";
import { LockScreenSettingsTab } from "#src/settings/settings-tab";

type TimingSettingKey = "idleTimeoutSeconds" | "lockDelaySeconds";

export default class LockScreenPlugin extends Plugin {
	override settings: LockScreenSettings = { ...DEFAULT_SETTINGS };
	private controller: LockScreenController | null = null;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.controller = new LockScreenController(this);
		this.addSettingTab(new LockScreenSettingsTab(this.app, this));
		this.addCommand({
			callback: () => this.controller?.lock(),
			id: "lock-screen",
			name: "Lock screen",
		});
		this.controller.start();
	}

	override onunload(): void {
		this.controller?.destroy();
		this.controller = null;
	}

	override async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.controller?.settingsChanged();
	}

	async replaceSettings(settings: LockScreenSettings): Promise<void> {
		await this.saveData(settings);
		this.settings = settings;
	}

	registerDocument(registeredDocument: Document): void {
		this.controller?.registerDocument(registeredDocument);
	}

	async setPassword(password: string): Promise<void> {
		const credential = await createPasswordCredential(password);
		await this.replaceSettings({
			...this.settings,
			credential,
			failedAttempts: 0,
			lockedUntil: 0,
		});
		this.controller?.settingsChanged();
	}

	async clearPassword(): Promise<void> {
		await this.replaceSettings({
			...this.settings,
			credential: null,
			failedAttempts: 0,
			lockedUntil: 0,
		});
		this.controller?.settingsChanged();
	}

	async updateTimingSetting(key: TimingSettingKey, value: number): Promise<void> {
		if (!Number.isInteger(value)) throw new RangeError(`${key} must be a whole number.`);
		const minimum = key === "idleTimeoutSeconds" ? 5 : 0;
		if (value < minimum || value > 86_400) {
			throw new RangeError(`${key} must be from ${minimum} to 86400.`);
		}
		await this.replaceSettings({ ...this.settings, [key]: value });
		this.controller?.settingsChanged();
	}

	private async loadSettings(): Promise<void> {
		const parsed = parseSettings(await this.loadData());
		this.settings = parsed.settings;
		if (parsed.needsSave) await this.saveData(this.settings);
		if (parsed.removedPlaintextPassword) {
			void new Notice(
				"Lock Screen removed the old plaintext password. Set a new password in Settings.",
				10_000,
			);
		}
	}
}
