import { describe, expect, it } from "vitest";

import {
	createPasswordCredential,
	validateNewPassword,
	verifyPassword,
} from "#src/security/password";

describe("password credentials", () => {
	it("stores a salted PBKDF2 hash and verifies only the original password", async () => {
		const credential = await createPasswordCredential("correct horse battery staple");

		expect(credential.hash).toMatch(/^[A-Za-z0-9+/]{43}=$/);
		expect(credential.salt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
		expect(credential.iterations).toBe(600_000);
		expect(credential).not.toHaveProperty("password");
		await expect(verifyPassword("correct horse battery staple", credential)).resolves.toBe(
			true,
		);
		await expect(verifyPassword("incorrect password", credential)).resolves.toBe(false);
	});

	it("uses a different salt for each credential", async () => {
		const first = await createPasswordCredential("correct horse battery staple");
		const second = await createPasswordCredential("correct horse battery staple");

		expect(first.salt).not.toBe(second.salt);
		expect(first.hash).not.toBe(second.hash);
	});

	it.each([
		["", "at least 8 characters"],
		["1234567", "at least 8 characters"],
		["a".repeat(1_025), "no more than 1024 characters"],
	])("rejects unsafe password length", (password, message) => {
		expect(validateNewPassword(password)).toContain(message);
	});
});
