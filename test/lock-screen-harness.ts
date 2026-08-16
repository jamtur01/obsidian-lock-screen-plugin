import { webcrypto } from "node:crypto";

import type { LockScreenPluginHost } from "#src/lock-screen/lock-screen-controller";
import { DEFAULT_SETTINGS, type LockScreenSettings } from "#src/settings/settings";
import { popScope, pushScope } from "#test/obsidian-stub";

type WorkspaceHandler = (...args: never[]) => void;

/** Installs the globals Obsidian provides that jsdom does not. */
export const installRuntimeGlobals = (): void => {
	if (globalThis.crypto?.subtle === undefined) {
		Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
	}
	if (typeof globalThis.requestAnimationFrame !== "function") {
		globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			globalThis.setTimeout(() => callback(0), 0);
			return 0;
		}) as typeof requestAnimationFrame;
	}
	Object.defineProperty(globalThis, "activeDocument", {
		configurable: true,
		get: () => globalThis.document,
	});
};

/** Lets MutationObserver callbacks and requestAnimationFrame callbacks run. */
export const flushDom = (): Promise<void> =>
	new Promise((resolve) => {
		globalThis.setTimeout(resolve, 0);
	});

/** Waits for real asynchronous work, such as a 600,000-iteration key derivation. */
export const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for the lock screen.");
		await flushDom();
	}
};

/**
 * Stands in for Obsidian's SecretStorage. `setSecret` returns void in the real API, so
 * `failWrites` models a write that silently does nothing rather than throwing.
 */
export class FakeSecretStorage {
	failWrites = false;
	throwOnRead = false;
	private readonly secrets = new Map<string, string>();

	getSecret(id: string): string | null {
		if (this.throwOnRead) throw new Error("secret storage unavailable");
		return this.secrets.get(id) ?? null;
	}

	setSecret(id: string, secret: string): void {
		if (this.failWrites) return;
		this.secrets.set(id, secret);
	}

	listSecrets(): string[] {
		return [...this.secrets.keys()];
	}

	seed(id: string, secret: string): void {
		this.secrets.set(id, secret);
	}
}

/** The slice of Obsidian's App that the lock screen touches. */
export const createFakeApp = (
	handlers: Map<string, WorkspaceHandler>,
	secretStorage: FakeSecretStorage = new FakeSecretStorage(),
) => ({
	keymap: {
		popScope,
		pushScope,
	},
	secretStorage,
	workspace: {
		activeEditor: null,
		layoutReady: false,
		iterateAllLeaves: (): void => {},
		onLayoutReady: (callback: () => void): void => callback(),
		on: (name: string, callback: WorkspaceHandler): { name: string } => {
			handlers.set(name, callback);
			return { name };
		},
	},
});

export class FakePlugin {
	credentialUnreadable = false;
	readonly handlers = new Map<string, WorkspaceHandler>();
	readonly intervals: number[] = [];
	readonly saves: LockScreenSettings[] = [];
	settings: LockScreenSettings = { ...DEFAULT_SETTINGS };

	readonly app = createFakeApp(this.handlers);

	asHost(): LockScreenPluginHost {
		return this as unknown as LockScreenPluginHost;
	}

	emit(name: string, ...args: unknown[]): void {
		this.handlers.get(name)?.(...(args as never[]));
	}

	registerEvent(): void {}

	registerInterval(id: number): number {
		this.intervals.push(id);
		return id;
	}

	registerDomEvent(
		target: EventTarget,
		type: string,
		callback: EventListener,
		options?: AddEventListenerOptions,
	): void {
		target.addEventListener(type, callback, options);
	}

	async replaceSettings(settings: LockScreenSettings): Promise<void> {
		this.settings = settings;
		this.saves.push(settings);
	}

	clearIntervals(): void {
		for (const id of this.intervals) globalThis.clearInterval(id);
		this.intervals.length = 0;
	}
}
