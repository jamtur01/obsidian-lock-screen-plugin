/**
 * Minimal stand-in for the `obsidian` module, which only exists inside the Obsidian runtime.
 * Covers the runtime values the lock screen imports; everything else it uses is type-only and
 * erased at compile time.
 */

export const notices: string[] = [];

export const clearNotices = (): void => {
	notices.length = 0;
};

export class Notice {
	constructor(message: string) {
		notices.push(message);
	}
}

export const Platform = { isDesktopApp: true, isMobileApp: false };

type ScopeListener = (event: KeyboardEvent) => false | unknown;

export class Scope {
	private listener: ScopeListener | null = null;

	register(_modifiers: unknown, _key: unknown, listener: ScopeListener): Record<string, never> {
		this.listener = listener;
		return {};
	}

	dispatch(event: KeyboardEvent): boolean {
		if (this.listener?.(event) === false) {
			event.preventDefault();
			return false;
		}
		return true;
	}
}

const activeScopes: Scope[] = [];

export const pushScope = (scope: Scope): void => {
	activeScopes.push(scope);
};

export const popScope = (scope: Scope): void => {
	const index = activeScopes.lastIndexOf(scope);
	if (index >= 0) activeScopes.splice(index, 1);
};

export const dispatchKeymapEvent = (event: KeyboardEvent): boolean =>
	activeScopes.at(-1)?.dispatch(event) ?? true;

export class Plugin {
	readonly app: unknown;

	constructor(app?: unknown) {
		this.app = app;
	}

	addCommand(command: unknown): unknown {
		return command;
	}

	addSettingTab(_tab: unknown): void {}

	registerEvent(_reference: unknown): void {}

	registerInterval(id: number): number {
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

	async loadData(): Promise<unknown> {
		return null;
	}

	async saveData(_data: unknown): Promise<void> {}
}

export class PluginSettingTab {}

export class Modal {
	readonly contentEl: HTMLElement = document.createElement("div");
	readonly titleEl: HTMLElement = document.createElement("div");

	open(): void {}

	close(): void {}
}

export class ConfirmationModal extends Modal {
	buttonContainerEl: HTMLElement = document.createElement("div");

	addCancelButton(_text?: string): this {
		return this;
	}

	addButton(_callback: (button: unknown) => unknown): this {
		return this;
	}
}

export class Setting {}
