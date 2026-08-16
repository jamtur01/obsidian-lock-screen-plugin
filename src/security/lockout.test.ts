import { describe, expect, it } from "vitest";

import {
	getRemainingLockoutMs,
	recordFailedAttempt,
	resetFailedAttempts,
} from "#src/security/lockout";

describe("failed-attempt lockout", () => {
	it("allows four failures before imposing a delay", () => {
		let state = resetFailedAttempts();

		for (let attempt = 1; attempt <= 4; attempt += 1) {
			state = recordFailedAttempt(state, 1_000);
			expect(state.failedAttempts).toBe(attempt);
			expect(state.lockedUntil).toBe(0);
		}
	});

	it("starts at 30 seconds and doubles subsequent lockouts", () => {
		let state = { failedAttempts: 4, lockedUntil: 0 };

		state = recordFailedAttempt(state, 1_000);
		expect(state).toEqual({ failedAttempts: 5, lockedUntil: 31_000 });
		state = recordFailedAttempt(state, 31_000);
		expect(state).toEqual({ failedAttempts: 6, lockedUntil: 91_000 });
	});

	it("caps lockouts at 30 minutes", () => {
		const state = recordFailedAttempt({ failedAttempts: 100, lockedUntil: 0 }, 1_000);

		expect(state.lockedUntil).toBe(1_801_000);
	});

	it("reports remaining time without returning negative values", () => {
		expect(getRemainingLockoutMs({ failedAttempts: 5, lockedUntil: 31_000 }, 1_000)).toBe(
			30_000,
		);
		expect(getRemainingLockoutMs({ failedAttempts: 5, lockedUntil: 31_000 }, 32_000)).toBe(0);
	});
});
