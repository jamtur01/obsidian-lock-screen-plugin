// @vitest-environment jsdom
import type { App, PluginManifest } from "obsidian";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import LockScreenPlugin from "#src/main";
import { createPasswordCredential, type PasswordCredential } from "#src/security/password";
import { SECRET_ID } from "#src/settings/secret-store";
import { DEFAULT_SETTINGS, type LockScreenSettings } from "#src/settings/settings";
import {
	createFakeApp,
	FakeSecretStorage,
	flushDom,
	installRuntimeGlobals,
	waitFor,
} from "#test/lock-screen-harness";
import { clearNotices, notices } from "#test/obsidian-stub";

const PASSWORD = "correct horse battery staple";
const OTHER_PASSWORD = "an entirely different password";

let credential: PasswordCredential;
let otherCredential: PasswordCredential;

const intervals: number[] = [];
let active: LockScreenPlugin | null = null;

const hasPasswordPrompt = (): boolean =>
	document.querySelector(".edb-lock-screen__password") !== null;

/** Whether an overlay is up at all. Without a password the plugin does not lock. */
const isLocked = (): boolean => document.querySelector(".edb-lock-screen") !== null;

const noticeMatching = (fragment: string): string | undefined =>
	notices.find((notice) => notice.includes(fragment));

const secretRecord = (settings: Partial<LockScreenSettings>): string =>
	JSON.stringify({ settings: { ...DEFAULT_SETTINGS, ...settings }, version: 1 });

interface LoadOptions {
	secret?: string;
	secretStorage?: FakeSecretStorage;
	vaultData?: unknown;
}

interface LoadedPlugin {
	plugin: LockScreenPlugin;
	secretStorage: FakeSecretStorage;
	writes: unknown[];
}

const loadPlugin = async (options: LoadOptions = {}): Promise<LoadedPlugin> => {
	const writes: unknown[] = [];
	const secretStorage = options.secretStorage ?? new FakeSecretStorage();
	if (options.secret !== undefined) secretStorage.seed(SECRET_ID, options.secret);

	const app = createFakeApp(new Map(), secretStorage) as unknown as App;
	const plugin = new LockScreenPlugin(app, {} as PluginManifest);
	plugin.loadData = () => Promise.resolve(options.vaultData ?? null);
	plugin.saveData = (data: unknown) => {
		writes.push(data);
		return Promise.resolve();
	};
	plugin.registerInterval = (id: number): number => {
		intervals.push(id);
		return id;
	};

	await plugin.onload();
	await flushDom();
	active = plugin;

	return { plugin, secretStorage, writes };
};

/** Types the password into the lock screen and waits for the key derivation. */
const unlock = async (): Promise<void> => {
	const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");
	if (input === null) throw new Error("The lock screen is not showing a password field.");
	input.value = PASSWORD;
	input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	await waitFor(() => !isLocked());
};

beforeAll(async () => {
	installRuntimeGlobals();
	credential = await createPasswordCredential(PASSWORD);
	otherCredential = await createPasswordCredential(OTHER_PASSWORD);
});

beforeEach(() => {
	installRuntimeGlobals();
	clearNotices();
	document.body.innerHTML = "";
});

afterEach(() => {
	active?.onunload();
	active = null;
	for (const id of intervals) globalThis.clearInterval(id);
	intervals.length = 0;
});

describe("authentication state authority", () => {
	it("enforces the device secret and ignores the vault copy", async () => {
		const { plugin } = await loadPlugin({
			secret: secretRecord({ credential, idleTimeoutSeconds: 45 }),
			vaultData: { credential: otherCredential, idleTimeoutSeconds: 900 },
		});

		expect(plugin.settings.credential).toEqual(credential);
		expect(plugin.settings.idleTimeoutSeconds).toBe(45);
		expect(hasPasswordPrompt()).toBe(true);
	});

	it("stays locked when the vault copy is deleted", async () => {
		const { plugin } = await loadPlugin({
			secret: secretRecord({ credential }),
			vaultData: null,
		});

		expect(plugin.settings.credential).toEqual(credential);
		expect(hasPasswordPrompt()).toBe(true);
		expect(isLocked()).toBe(true);
	});

	it("stays locked when the vault copy claims there is no password", async () => {
		const { plugin } = await loadPlugin({
			secret: secretRecord({ credential }),
			vaultData: { credential: null },
		});

		expect(plugin.settings.credential).toEqual(credential);
		expect(hasPasswordPrompt()).toBe(true);
	});

	it("fails closed when the stored record cannot be parsed", async () => {
		const { plugin } = await loadPlugin({ secret: "{ truncated" });

		expect(plugin.credentialUnreadable).toBe(true);
		expect(hasPasswordPrompt()).toBe(false);
		expect(isLocked()).toBe(true);
		expect(noticeMatching("could not read this device's stored password")).toBeDefined();
	});

	it("fails closed when the record is a version it does not understand", async () => {
		const { plugin } = await loadPlugin({
			secret: JSON.stringify({ settings: DEFAULT_SETTINGS, version: 99 }),
		});

		expect(plugin.credentialUnreadable).toBe(true);
		expect(isLocked()).toBe(true);
	});

	it("fails closed when the record holds a malformed credential", async () => {
		const { plugin } = await loadPlugin({
			secret: secretRecord({ credential: { hash: "plaintext" } as PasswordCredential }),
		});

		expect(plugin.credentialUnreadable).toBe(true);
		expect(isLocked()).toBe(true);
	});

	it("fails closed when secret storage cannot be read", async () => {
		const secretStorage = new FakeSecretStorage();
		secretStorage.throwOnRead = true;
		const { plugin } = await loadPlugin({ secretStorage });

		expect(plugin.credentialUnreadable).toBe(true);
		expect(isLocked()).toBe(true);
	});

	it("reports a failure rather than silently losing a new password", async () => {
		const { plugin, secretStorage } = await loadPlugin();
		secretStorage.failWrites = true;

		await expect(plugin.setPassword("a brand new password")).rejects.toThrow(
			/could not store authentication state/i,
		);
	});

	it("refuses to change its own settings while locked", async () => {
		const { plugin } = await loadPlugin({ secret: secretRecord({ credential }) });

		expect(isLocked()).toBe(true);
		// A settings window can outlive the lock, so removing the password must not be reachable.
		await expect(plugin.clearPassword()).rejects.toThrow(/unlock the vault/i);
		await expect(plugin.setPassword("another password")).rejects.toThrow(/unlock the vault/i);
		await expect(plugin.updateTimingSetting("idleTimeoutSeconds", 90)).rejects.toThrow(
			/unlock the vault/i,
		);
		expect(plugin.settings.credential).toEqual(credential);
	});

	it("removes a password by storing a passwordless record, not by deleting it", async () => {
		const { plugin, secretStorage } = await loadPlugin({
			secret: secretRecord({ credential }),
		});
		await unlock();

		await plugin.clearPassword();

		expect(secretStorage.listSecrets()).toContain(SECRET_ID);
		expect(plugin.settings.credential).toBeNull();
	});

	it("writes the device record and nothing else when a password is set", async () => {
		const { plugin, secretStorage, writes } = await loadPlugin();

		await plugin.setPassword(PASSWORD);

		expect(secretStorage.getSecret(SECRET_ID)).toContain(plugin.settings.credential?.hash);
		expect(writes).toHaveLength(0);
	});
});

describe("clearing the vault of authentication state", () => {
	it("removes a 1.x plaintext password and everything beside it", async () => {
		const { writes } = await loadPlugin({
			vaultData: { password: "legacy plaintext", credential, timeoutWindowBlur: 30_000 },
		});

		expect(writes).toEqual([{}]);
		expect(noticeMatching("removed the old plaintext password")).toBeDefined();
	});

	it("discards a credential a previous version left in the vault", async () => {
		const { plugin, writes } = await loadPlugin({
			vaultData: { ...DEFAULT_SETTINGS, credential },
		});

		expect(writes).toEqual([{}]);
		// The vault copy never had authority, so the device is simply unconfigured.
		expect(plugin.settings.credential).toBeNull();
		expect(isLocked()).toBe(false);
	});

	it("leaves an already empty settings file alone", async () => {
		const { writes } = await loadPlugin({ vaultData: {} });

		expect(writes).toHaveLength(0);
	});

	it("never writes the credential back to the vault", async () => {
		const { plugin, writes } = await loadPlugin();

		await plugin.setPassword(PASSWORD);
		await plugin.updateTimingSetting("idleTimeoutSeconds", 120);

		expect(writes).toHaveLength(0);
	});

	it("says so when the plaintext password could not be removed", async () => {
		const secretStorage = new FakeSecretStorage();
		const app = createFakeApp(new Map(), secretStorage) as unknown as App;
		const plugin = new LockScreenPlugin(app, {} as PluginManifest);
		plugin.loadData = () => Promise.resolve({ password: "legacy plaintext" });
		plugin.saveData = () => Promise.reject(new Error("EACCES"));
		plugin.registerInterval = (id: number): number => {
			intervals.push(id);
			return id;
		};

		await plugin.onload();
		active = plugin;

		expect(noticeMatching("still stored in the clear")).toBeDefined();
	});
});
