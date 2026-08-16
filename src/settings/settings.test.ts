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
			needsSave: true,
			removedPlaintextPassword: false,
			settings: DEFAULT_SETTINGS,
		});
	});

	it("accepts a valid credential and timing values", () => {
		const settings = {
			credential,
			failedAttempts: 3,
			idleTimeoutSeconds: 45,
			lockDelaySeconds: 10,
			lockedUntil: 123_456,
		};

		expect(parseSettings(settings)).toEqual({
			needsSave: false,
			removedPlaintextPassword: false,
			settings,
		});
	});

	it("discards plaintext passwords rather than retaining a legacy format", () => {
		const parsed = parseSettings({ password: "do not persist this" });

		expect(parsed.removedPlaintextPassword).toBe(true);
		expect(parsed.needsSave).toBe(true);
		expect(parsed.settings).not.toHaveProperty("password");
		expect(parsed.settings.credential).toBeNull();
	});

	it("rejects malformed credentials and clamps unsafe numeric values", () => {
		const parsed = parseSettings({
			credential: { hash: "plaintext", iterations: 1, salt: "short" },
			failedAttempts: -4,
			idleTimeoutSeconds: 1,
			lockDelaySeconds: Number.POSITIVE_INFINITY,
			lockedUntil: -20,
		});

		expect(parsed.settings).toEqual({
			...DEFAULT_SETTINGS,
			idleTimeoutSeconds: 5,
		});
		expect(parsed.needsSave).toBe(true);
	});
});
