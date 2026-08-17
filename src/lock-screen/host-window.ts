import type { App } from "obsidian";

interface ElectronWindow {
	focus: () => void;
	isMinimized?: () => boolean;
	restore?: () => void;
	show?: () => void;
}

interface ElectronRemote {
	remote?: { getCurrentWindow?: () => ElectronWindow };
}

// Obsidian's own settings object. Not part of the plugin API, so every access is guarded and a
// version that drops or renames it simply leaves the settings window open.
interface AppWithSetting {
	setting?: { close?: () => void };
}

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
	typeof value === "function";

/**
 * Closes Obsidian's settings window. It is left uncovered while locked, and on macOS it floats
 * above the window holding the password field, so locking has to put it away.
 */
export const closeSettingsWindow = (app: App): void => {
	const close = (app as AppWithSetting).setting?.close;
	if (!isFunction(close)) return;
	try {
		close.call((app as AppWithSetting).setting);
	} catch {
		// Internal API. Failing to close a settings window must not stop the lock.
	}
};

const currentElectronWindow = (hostWindow: Window): ElectronWindow | null => {
	const load = (hostWindow as Window & { require?: (id: string) => unknown }).require;
	if (!isFunction(load)) return null;
	try {
		const electron = load("electron") as ElectronRemote;
		const electronWindow = electron.remote?.getCurrentWindow?.();
		return electronWindow ?? null;
	} catch {
		return null;
	}
};

/**
 * Brings the window holding the lock screen to the front. `Window.focus` alone does not raise an
 * Electron window that sits behind another one, so ask Electron when it is reachable.
 */
export const raiseWindow = (hostWindow: Window): void => {
	const electronWindow = currentElectronWindow(hostWindow);
	if (electronWindow === null) {
		hostWindow.focus();
		return;
	}
	try {
		if (electronWindow.isMinimized?.() === true) electronWindow.restore?.();
		electronWindow.show?.();
		electronWindow.focus();
	} catch {
		hostWindow.focus();
	}
};
