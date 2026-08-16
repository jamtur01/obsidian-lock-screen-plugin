export interface FailedAttemptState {
	failedAttempts: number;
	lockedUntil: number;
}

const BASE_LOCKOUT_MS = 30_000;
const LOCKOUT_THRESHOLD = 5;
const MAX_LOCKOUT_MS = 30 * 60_000;

export const getRemainingLockoutMs = (state: FailedAttemptState, now: number): number =>
	Math.max(0, state.lockedUntil - now);

export const recordFailedAttempt = (state: FailedAttemptState, now: number): FailedAttemptState => {
	const failedAttempts = state.failedAttempts + 1;
	if (failedAttempts < LOCKOUT_THRESHOLD) return { failedAttempts, lockedUntil: 0 };

	const exponent = failedAttempts - LOCKOUT_THRESHOLD;
	const delay = Math.min(BASE_LOCKOUT_MS * 2 ** exponent, MAX_LOCKOUT_MS);

	return { failedAttempts, lockedUntil: now + delay };
};

export const resetFailedAttempts = (): FailedAttemptState => ({
	failedAttempts: 0,
	lockedUntil: 0,
});
