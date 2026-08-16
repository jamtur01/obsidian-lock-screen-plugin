export const PASSWORD_ITERATIONS = 600_000;

const HASH_BYTES = 32;
const MAX_PASSWORD_LENGTH = 1_024;
export const MIN_PASSWORD_LENGTH = 8;
const SALT_BYTES = 16;

export interface PasswordCredential {
	hash: string;
	iterations: number;
	salt: string;
}

const bytesToBase64 = (bytes: Uint8Array): string => btoa(String.fromCodePoint(...bytes));

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> =>
	Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

const derivePassword = async (
	password: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<Uint8Array> => {
	const passwordBytes = new TextEncoder().encode(password);
	const key = await globalThis.crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, [
		"deriveBits",
	]);
	const bits = await globalThis.crypto.subtle.deriveBits(
		{
			hash: "SHA-256",
			iterations,
			name: "PBKDF2",
			salt,
		},
		key,
		HASH_BYTES * 8,
	);

	return new Uint8Array(bits);
};

const equalBytes = (first: Uint8Array, second: Uint8Array): boolean => {
	if (first.length !== second.length) return false;

	let difference = 0;
	for (let index = 0; index < first.length; index += 1) {
		difference |= (first[index] ?? 0) ^ (second[index] ?? 0);
	}

	return difference === 0;
};

export const validateNewPassword = (password: string): string | null => {
	const length = [...password].length;
	if (length < MIN_PASSWORD_LENGTH) {
		return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
	}
	if (length > MAX_PASSWORD_LENGTH) {
		return `Password must contain no more than ${MAX_PASSWORD_LENGTH} characters.`;
	}

	return null;
};

export const createPasswordCredential = async (password: string): Promise<PasswordCredential> => {
	const validationError = validateNewPassword(password);
	if (validationError !== null) throw new RangeError(validationError);

	const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);

	return {
		hash: bytesToBase64(hash),
		iterations: PASSWORD_ITERATIONS,
		salt: bytesToBase64(salt),
	};
};

export const verifyPassword = async (
	password: string,
	credential: PasswordCredential,
): Promise<boolean> => {
	if ([...password].length > MAX_PASSWORD_LENGTH) return false;

	const expectedHash = base64ToBytes(credential.hash);
	const actualHash = await derivePassword(
		password,
		base64ToBytes(credential.salt),
		credential.iterations,
	);

	return equalBytes(actualHash, expectedHash);
};
