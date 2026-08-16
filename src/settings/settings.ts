import type { PasswordCredential } from "#src/security/password";

export interface LockScreenSettings {
	credential: PasswordCredential | null;
	failedAttempts: number;
	idleTimeoutSeconds: number;
	lockDelaySeconds: number;
	lockedUntil: number;
}

export interface ParsedSettings {
	needsSave: boolean;
	removedPlaintextPassword: boolean;
	settings: LockScreenSettings;
}

export const DEFAULT_SETTINGS: LockScreenSettings = {
	credential: null,
	failedAttempts: 0,
	idleTimeoutSeconds: 30,
	lockDelaySeconds: 30,
	lockedUntil: 0,
};

const BASE64_HASH_PATTERN = /^[A-Za-z\d+/]{43}=$/;
const BASE64_SALT_PATTERN = /^[A-Za-z\d+/]{22}==$/;
const MAX_ITERATIONS = 10_000_000;
const MAX_TIMEOUT_SECONDS = 86_400;
const MIN_ITERATIONS = 600_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const parseHash = (value: unknown): string | null =>
	typeof value === "string" && BASE64_HASH_PATTERN.test(value) ? value : null;

const parseSalt = (value: unknown): string | null =>
	typeof value === "string" && BASE64_SALT_PATTERN.test(value) ? value : null;

const parseIterations = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	return value >= MIN_ITERATIONS && value <= MAX_ITERATIONS ? value : null;
};

const parseCredential = (value: unknown): PasswordCredential | null => {
	if (!isRecord(value)) return null;

	const hash = parseHash(value.hash);
	const iterations = parseIterations(value.iterations);
	const salt = parseSalt(value.salt);
	if (hash === null || iterations === null || salt === null) return null;

	return { hash, iterations, salt };
};

const parseInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.round(value)));
};

export const parseSettings = (data: unknown): ParsedSettings => {
	const record = isRecord(data) ? data : {};
	const settings: LockScreenSettings = {
		credential: parseCredential(record.credential),
		failedAttempts: parseInteger(record.failedAttempts, 0, 0, 1_000),
		idleTimeoutSeconds: parseInteger(
			record.idleTimeoutSeconds,
			DEFAULT_SETTINGS.idleTimeoutSeconds,
			5,
			MAX_TIMEOUT_SECONDS,
		),
		lockDelaySeconds: parseInteger(
			record.lockDelaySeconds,
			DEFAULT_SETTINGS.lockDelaySeconds,
			0,
			MAX_TIMEOUT_SECONDS,
		),
		lockedUntil: parseInteger(record.lockedUntil, 0, 0, Number.MAX_SAFE_INTEGER),
	};
	const removedPlaintextPassword = Object.hasOwn(record, "password");

	return {
		needsSave: JSON.stringify(data) !== JSON.stringify(settings),
		removedPlaintextPassword,
		settings,
	};
};
