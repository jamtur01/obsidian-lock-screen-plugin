import type { SecretStorage } from "obsidian";

import { parseSettings, type LockScreenSettings } from "#src/settings/settings";

/**
 * Fixed, plugin-owned identifier. It is deliberately never read from data.json: an identifier
 * taken from the vault would let anyone who can write the vault point the plugin at a secret of
 * their choosing, which is the weakness this store exists to remove.
 */
export const SECRET_ID = "obsidian-lock-screen-plugin-state-v1";

const SECRET_VERSION = 1;

export type SecretState =
	| { settings: LockScreenSettings; status: "present" }
	| { status: "absent" }
	| { status: "invalid" };

const isVersionedRecord = (value: unknown): value is { settings: unknown; version: number } =>
	typeof value === "object" &&
	value !== null &&
	(value as { version?: unknown }).version === SECRET_VERSION;

/**
 * Reads the authoritative authentication state.
 *
 * `absent` means this device was never set up, which nobody can induce by editing the vault.
 * `invalid` means a record exists but cannot be trusted, and the caller must fail closed.
 */
export const readSecretState = (secretStorage: SecretStorage): SecretState => {
	let raw: string | null;
	try {
		raw = secretStorage.getSecret(SECRET_ID);
	} catch {
		return { status: "invalid" };
	}
	if (raw === null) return { status: "absent" };

	let record: unknown;
	try {
		record = JSON.parse(raw);
	} catch {
		return { status: "invalid" };
	}
	if (!isVersionedRecord(record)) return { status: "invalid" };

	const parsed = parseSettings(record.settings);
	if (parsed.credentialStatus === "invalid") return { status: "invalid" };

	return { settings: parsed.settings, status: "present" };
};

/**
 * Returns whether the state was stored. `setSecret` returns void and documents no durability
 * guarantee, so the only way to know the write took effect is to read it back.
 */
export const writeSecretState = (
	secretStorage: SecretStorage,
	settings: LockScreenSettings,
): boolean => {
	const payload = JSON.stringify({ settings, version: SECRET_VERSION });
	try {
		secretStorage.setSecret(SECRET_ID, payload);
		return secretStorage.getSecret(SECRET_ID) === payload;
	} catch {
		return false;
	}
};
