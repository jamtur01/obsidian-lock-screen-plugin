// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { closeSettingsWindow, raiseWindow } from "#src/lock-screen/host-window";

interface FakeElectronWindow {
	focus: () => void;
	isMinimized: () => boolean;
	restore: () => void;
	show: () => void;
}

const installElectron = (electronWindow: Partial<FakeElectronWindow>): void => {
	Object.defineProperty(window, "require", {
		configurable: true,
		value: (id: string) => {
			if (id !== "electron") throw new Error(`Cannot find module '${id}'`);
			return { remote: { getCurrentWindow: () => electronWindow } };
		},
		writable: true,
	});
};

afterEach(() => {
	Reflect.deleteProperty(window, "require");
	vi.restoreAllMocks();
});

describe("closeSettingsWindow", () => {
	it("closes the settings window Obsidian is showing", () => {
		const close = vi.fn<() => void>();
		closeSettingsWindow({ setting: { close } } as never);

		expect(close).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the running Obsidian has no settings object", () => {
		expect(() => closeSettingsWindow({} as never)).not.toThrow();
	});

	it("survives a settings object that throws", () => {
		const close = vi.fn<() => void>(() => {
			throw new Error("no settings window");
		});

		expect(() => closeSettingsWindow({ setting: { close } } as never)).not.toThrow();
	});
});

describe("raiseWindow", () => {
	it("brings the Electron window to the front", () => {
		const electronWindow = {
			focus: vi.fn<() => void>(),
			isMinimized: vi.fn<() => boolean>(() => false),
			restore: vi.fn<() => void>(),
			show: vi.fn<() => void>(),
		};
		installElectron(electronWindow);

		raiseWindow(window);

		expect(electronWindow.show).toHaveBeenCalledTimes(1);
		expect(electronWindow.focus).toHaveBeenCalledTimes(1);
		expect(electronWindow.restore).not.toHaveBeenCalled();
	});

	it("restores the Electron window when it is minimised", () => {
		const electronWindow = {
			focus: vi.fn<() => void>(),
			isMinimized: vi.fn<() => boolean>(() => true),
			restore: vi.fn<() => void>(),
			show: vi.fn<() => void>(),
		};
		installElectron(electronWindow);

		raiseWindow(window);

		expect(electronWindow.restore).toHaveBeenCalledTimes(1);
	});

	it("falls back to the DOM when Electron is not reachable", () => {
		const focus = vi.spyOn(window, "focus").mockImplementation(() => {});

		raiseWindow(window);

		expect(focus).toHaveBeenCalledTimes(1);
	});
});
