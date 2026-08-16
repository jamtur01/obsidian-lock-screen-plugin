import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, parseSettings } from "#src/settings/settings";

const credential = {
	hash: `${"A".repeat(43)}=`,
	iterations: 600_000,
	salt: `${"A".repeat(22)}==`,
};

describe("settings parsing", () => {
	it("uses defaults for missing data", () => {
		expect(parseSettings(null)).toEqual({
			credentialStatus: "absent",
			settings: DEFAULT_SETTINGS,
		});
	});

	it("accepts a valid credential and timing values", () => {
		const settings = {
			credential,
			failedAttempts: 3,
			idleTimeoutSeconds: 45,
			lockDelaySeconds: 10,
			lockOnStartup: false,
			lockedUntil: 123_456,
		};

		expect(parseSettings(settings)).toEqual({
			credentialStatus: "valid",
			settings,
		});
	});

	it("never carries a legacy plaintext password into the parsed settings", () => {
		const parsed = parseSettings({ password: "do not persist this" });

		expect(parsed.settings).not.toHaveProperty("password");
		expect(parsed.settings.credential).toBeNull();
	});

	it("clamps unsafe numeric values", () => {
		const parsed = parseSettings({
			failedAttempts: -4,
			idleTimeoutSeconds: -1,
			lockDelaySeconds: Number.POSITIVE_INFINITY,
			lockedUntil: -20,
		});

		expect(parsed.settings).toEqual({
			...DEFAULT_SETTINGS,
			idleTimeoutSeconds: 0,
		});
	});

	it("locks on open by default and honours an explicit choice", () => {
		expect(parseSettings(null).settings.lockOnStartup).toBe(true);
		expect(parseSettings({ lockOnStartup: false }).settings.lockOnStartup).toBe(false);
		expect(parseSettings({ lockOnStartup: "no" }).settings.lockOnStartup).toBe(true);
	});

	it("keeps a zero idle timeout, which disables idle locking", () => {
		expect(parseSettings({ idleTimeoutSeconds: 0 }).settings.idleTimeoutSeconds).toBe(0);
	});

	it.each([
		["a non-object credential", "plaintext"],
		["a malformed hash", { ...credential, hash: "plaintext" }],
		["a malformed salt", { ...credential, salt: "short" }],
		["too few iterations", { ...credential, iterations: 1 }],
		["a missing field", { hash: credential.hash, salt: credential.salt }],
	])("reports %s as unreadable rather than as an absent password", (_label, value) => {
		const parsed = parseSettings({ credential: value });

		expect(parsed.credentialStatus).toBe("invalid");
		expect(parsed.settings.credential).toBeNull();
	});

	it("treats an explicitly null credential as absent", () => {
		expect(parseSettings({ credential: null }).credentialStatus).toBe("absent");
	});
});
