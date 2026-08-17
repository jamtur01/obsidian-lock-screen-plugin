import { Notice, Plugin } from "obsidian";

import { LockScreenController } from "#src/lock-screen/lock-screen-controller";
import { createPasswordCredential } from "#src/security/password";
import { readSecretState, writeSecretState } from "#src/settings/secret-store";
import { DEFAULT_SETTINGS, type LockScreenSettings } from "#src/settings/settings";
import { LockScreenSettingsTab } from "#src/settings/settings-tab";

type TimingSettingKey = "idleTimeoutSeconds" | "lockDelaySeconds";

const isNonEmptyRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && Object.keys(value).length > 0;

export default class LockScreenPlugin extends Plugin {
	credentialUnreadable = false;
	override settings: LockScreenSettings = { ...DEFAULT_SETTINGS };
	private controller: LockScreenController | null = null;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.controller = new LockScreenController(this);
		this.addSettingTab(new LockScreenSettingsTab(this.app, this));
		this.addCommand({
			callback: () => this.lockNow(),
			id: "lock-screen",
			name: "Lock screen",
		});
		this.controller.start();
	}

	private lockNow(): void {
		if (this.controller?.canLock() === false) {
			void new Notice("Set a lock screen password first, in Settings.", 5_000);
			return;
		}
		this.controller?.lock();
	}

	override onunload(): void {
		this.controller?.destroy();
		this.controller = null;
	}

	/** Stores authentication state only. Used by the lock screen for lockout bookkeeping. */
	async replaceSettings(settings: LockScreenSettings): Promise<void> {
		this.storeState(settings);
		this.settings = settings;
	}

	async setPassword(password: string): Promise<void> {
		this.assertUnlocked();
		const credential = await createPasswordCredential(password);
		await this.applyUserSettings({
			...this.settings,
			credential,
			failedAttempts: 0,
			lockedUntil: 0,
		});
	}

	async clearPassword(): Promise<void> {
		this.assertUnlocked();
		// Written as an explicit passwordless record rather than removed: Secret Storage has no
		// delete operation, and an absent record would mean "never set up" instead.
		await this.applyUserSettings({
			...this.settings,
			credential: null,
			failedAttempts: 0,
			lockedUntil: 0,
		});
	}

	async setLockOnStartup(value: boolean): Promise<void> {
		this.assertUnlocked();
		await this.applyUserSettings({ ...this.settings, lockOnStartup: value });
	}

	async updateTimingSetting(key: TimingSettingKey, value: number): Promise<void> {
		this.assertUnlocked();
		if (!Number.isInteger(value)) throw new RangeError(`${key} must be a whole number.`);
		if (value < 0 || value > 86_400) {
			throw new RangeError(`${key} must be from 0 to 86400.`);
		}
		await this.applyUserSettings({ ...this.settings, [key]: value });
	}

	/**
	 * Locking closes the settings window rather than covering it, but a window reopened while
	 * locked is still uncovered. Refusing the change itself is what stops one being used to
	 * remove the password and walk past the lock.
	 */
	private assertUnlocked(): void {
		if (this.controller?.isLocked() !== true) return;
		throw new Error("Unlock the vault before changing lock screen settings.");
	}

	private async applyUserSettings(settings: LockScreenSettings): Promise<void> {
		this.storeState(settings);
		this.settings = settings;
		this.credentialUnreadable = false;
		this.controller?.settingsChanged();
	}

	private storeState(settings: LockScreenSettings): void {
		if (writeSecretState(this.app.secretStorage, settings)) return;
		throw new Error("Lock Screen could not store authentication state for this device.");
	}

	private async loadSettings(): Promise<void> {
		await this.discardVaultState();
		const state = readSecretState(this.app.secretStorage);
		if (state.status === "invalid") {
			this.settings = { ...DEFAULT_SETTINGS };
			this.credentialUnreadable = true;
			this.reportUnreadableState();
			return;
		}
		this.settings = state.status === "present" ? state.settings : { ...DEFAULT_SETTINGS };
	}

	/**
	 * Nothing in the vault drives the lock screen, so nothing belongs there. Clears whatever a
	 * previous version left behind, including 1.x plaintext passwords, once.
	 */
	private async discardVaultState(): Promise<void> {
		let storedData: unknown;
		try {
			storedData = await this.loadData();
		} catch {
			return;
		}
		if (!isNonEmptyRecord(storedData)) return;

		const hadPlaintext = Object.hasOwn(storedData, "password");
		try {
			await this.saveData({});
		} catch {
			if (hadPlaintext) {
				void new Notice(
					"Lock Screen could not remove the old plaintext password from data.json. " +
						"Check vault write access; the password is still stored in the clear.",
					0,
				);
			}
			return;
		}
		if (hadPlaintext) {
			void new Notice(
				"Lock Screen removed the old plaintext password from this vault. Set a new " +
					"password in Settings.",
				10_000,
			);
		}
	}

	private reportUnreadableState(): void {
		void new Notice(
			"Lock Screen could not read this device's stored password and will stay locked. " +
				"Delete the secret obsidian-lock-screen-plugin-state-v1 under Settings, " +
				"Keychain, then restart Obsidian.",
			0,
		);
	}
}
