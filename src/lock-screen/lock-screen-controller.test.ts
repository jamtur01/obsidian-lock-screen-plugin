// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LockScreenController } from "#src/lock-screen/lock-screen-controller";
import { createPasswordCredential, type PasswordCredential } from "#src/security/password";
import { FakePlugin, flushDom, installRuntimeGlobals, waitFor } from "#test/lock-screen-harness";
import { dispatchKeymapEvent } from "#test/obsidian-stub";

const PASSWORD = "correct horse battery staple";
const OVERLAY = ".edb-lock-screen";

let credential: PasswordCredential;
let controller: LockScreenController;
let plugin: FakePlugin;

const overlayIn = (target: Document = document): HTMLElement | null =>
	target.body.querySelector(OVERLAY);

const newPopout = (): JSDOM =>
	new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });

/** Starts locked with any pending observer callbacks already drained. */
const startLocked = async (): Promise<void> => {
	controller.start();
	await flushDom();
};

const isChecking = (): boolean =>
	document.querySelector(".edb-lock-screen__button")?.textContent === "Checking…";

const unlockWith = async (password: string): Promise<void> => {
	const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");
	if (input === null) throw new Error("The lock screen is not showing a password field.");
	input.value = password;
	// setBusy(true) runs synchronously inside the submit handler, so the wait cannot start
	// before the attempt has been registered.
	input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	await waitFor(() => !isChecking());
	await flushDom();
};

beforeAll(async () => {
	installRuntimeGlobals();
	credential = await createPasswordCredential(PASSWORD);
});

beforeEach(() => {
	installRuntimeGlobals();
	document.documentElement.removeAttribute("style");
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	plugin = new FakePlugin();
	plugin.settings = { ...plugin.settings, credential };
	controller = new LockScreenController(plugin.asHost());
});

afterEach(() => {
	controller.destroy();
	plugin.clearIntervals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("lock screen controller", () => {
	it("locks as soon as it starts", () => {
		controller.start();

		expect(overlayIn()).not.toBeNull();
	});

	it("does not lock when it loads into an Obsidian that is already running", async () => {
		// Enabling or reloading the plugin requires already being inside an unlocked Obsidian,
		// so whoever caused this load has had access all along.
		plugin.app.workspace.layoutReady = true;
		controller.start();
		await flushDom();

		expect(overlayIn()).toBeNull();
		expect(controller.canLock()).toBe(true);
	});

	it("stays open at startup when locking on open is turned off", async () => {
		plugin.settings = { ...plugin.settings, lockOnStartup: false };
		controller.start();
		await flushDom();

		expect(overlayIn()).toBeNull();
		// Still armed: the idle and blur triggers are unaffected.
		expect(controller.canLock()).toBe(true);
		controller.lock();
		expect(overlayIn()).not.toBeNull();
	});

	it("restores an overlay that is removed from the document", async () => {
		await startLocked();
		overlayIn()?.remove();
		expect(overlayIn()).toBeNull();

		await flushDom();

		expect(overlayIn()).not.toBeNull();
	});

	it("restores an overlay that is hidden with inline styles", async () => {
		await startLocked();
		const overlay = overlayIn();
		overlay?.style.setProperty("display", "none");

		await flushDom();

		expect(overlay?.style.getPropertyValue("display")).toBe("flex");
	});

	it("restores an overlay whose class is stripped", async () => {
		await startLocked();
		const overlay = overlayIn();
		overlay?.setAttribute("class", "");

		await flushDom();

		expect(overlay?.className).toBe("edb-lock-screen");
	});

	it("keeps an opaque, full-screen presentation independent of theme CSS", async () => {
		document.documentElement.style.setProperty("--background-primary", "transparent");
		const stylesheet = document.createElement("style");
		stylesheet.textContent = [
			".edb-lock-screen {",
			"  clip-path: inset(100%) !important;",
			"  transform: translateX(100vw) !important;",
			"  transition: opacity 1s !important;",
			"}",
		].join("\n");
		document.head.append(stylesheet);

		await startLocked();
		const overlay = overlayIn();

		expect(overlay?.style.getPropertyValue("background-color")).toBe("rgb(30, 30, 30)");
		expect(overlay?.style.getPropertyValue("clip-path")).toBe("none");
		expect(overlay?.style.getPropertyValue("transform")).toBe("none");
		expect(overlay?.style.getPropertyValue("transition")).toBe("none");
		for (const property of ["background-color", "clip-path", "transform", "transition"]) {
			expect(overlay?.style.getPropertyPriority(property)).toBe("important");
		}
	});

	it("restores an overlay that is reparented out of the body", async () => {
		await startLocked();
		const attacker = document.body.appendChild(document.createElement("div"));
		const overlay = overlayIn();
		if (overlay !== null) attacker.append(overlay);

		await flushDom();

		expect(overlay?.parentElement).toBe(document.body);
	});

	it("blocks input events outside the lock UI while locked", () => {
		let reached = false;
		document.addEventListener("keydown", () => {
			reached = true;
		});
		controller.start();

		const blocked = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "p",
		});
		document.body.dispatchEvent(blocked);

		expect(reached).toBe(false);
		expect(blocked.defaultPrevented).toBe(true);
	});

	it("blocks core hotkeys even when the keymap listener was registered first", () => {
		let coreHotkeyRan = false;
		window.addEventListener(
			"keydown",
			(event) => {
				dispatchKeymapEvent(event);
				if (!event.defaultPrevented) coreHotkeyRan = true;
			},
			{ capture: true, once: true },
		);
		controller.start();

		const blocked = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "p",
		});
		document.body.dispatchEvent(blocked);

		expect(coreHotkeyRan).toBe(false);
		expect(blocked.defaultPrevented).toBe(true);
	});

	it("lets input events through inside the lock UI", () => {
		controller.start();
		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");

		const allowed = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "p",
		});
		input?.dispatchEvent(allowed);

		expect(allowed.defaultPrevented).toBe(false);
	});

	it.each([
		["a plain keystroke", { key: "p" }, true],
		["a paste shortcut", { key: "v", metaKey: true }, true],
		["a select-all shortcut", { key: "a", ctrlKey: true }, true],
		["an accented character", { altKey: true, key: "é" }, true],
		["a command hotkey", { key: "p", metaKey: true }, false],
		["a copy shortcut", { key: "c", metaKey: true }, false],
	])("inside the lock UI, %s reaches Obsidian: %s", (_label, init, allowed) => {
		let reachedObsidian = false;
		window.addEventListener(
			"keydown",
			(event) => {
				dispatchKeymapEvent(event);
				if (!event.defaultPrevented) reachedObsidian = true;
			},
			{ capture: true, once: true },
		);
		controller.start();
		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");

		input?.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
		);

		expect(reachedObsidian).toBe(allowed);
	});

	it("returns focus to the password field when something takes it away", async () => {
		await startLocked();
		const thief = document.body.appendChild(document.createElement("input"));
		thief.focus();
		expect(document.activeElement).toBe(thief);

		document.body.append(document.createElement("span"));
		await flushDom();

		expect(document.activeElement).toBe(document.querySelector(".edb-lock-screen__password"));
	});

	it("blocks dragging text out of the password field", () => {
		controller.start();
		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");

		const drag = new Event("dragstart", { bubbles: true, cancelable: true });
		input?.dispatchEvent(drag);

		expect(drag.defaultPrevented).toBe(true);
	});

	it("stops blocking input once unlocked", async () => {
		controller.start();
		await unlockWith(PASSWORD);

		const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "p" });
		document.body.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it("restores the normal keymap scope once unlocked", async () => {
		let coreHotkeyRan = false;
		window.addEventListener(
			"keydown",
			(event) => {
				dispatchKeymapEvent(event);
				if (!event.defaultPrevented) coreHotkeyRan = true;
			},
			{ capture: true, once: true },
		);
		controller.start();
		await unlockWith(PASSWORD);

		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "p",
		});
		document.body.dispatchEvent(event);

		expect(coreHotkeyRan).toBe(true);
		expect(event.defaultPrevented).toBe(false);
	});

	it("unlocks with the correct password and stops restoring the overlay", async () => {
		controller.start();

		await unlockWith(PASSWORD);

		expect(overlayIn()).toBeNull();
		document.body.append(document.createElement("span"));
		await flushDom();
		expect(overlayIn()).toBeNull();
	});

	it("unlocks as soon as the right password is typed, without submitting", async () => {
		controller.start();
		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");
		if (input === null) throw new Error("no password field");

		input.value = PASSWORD;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await waitFor(() => overlayIn() === null);

		expect(overlayIn()).toBeNull();
	});

	it("does not count a half-typed password as a failed attempt", async () => {
		controller.start();
		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");
		if (input === null) throw new Error("no password field");

		// Counting every prefix would hit the lockout before the password could be finished.
		for (const value of ["correct ", "correct hors", "correct horse ba"]) {
			input.value = value;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await waitFor(() => true);
		}
		await flushDom();

		expect(plugin.settings.failedAttempts).toBe(0);
		expect(plugin.saves).toHaveLength(0);
		expect(overlayIn()).not.toBeNull();
	});

	it("ignores typing while a lockout is in force", async () => {
		plugin.settings = {
			...plugin.settings,
			failedAttempts: 5,
			lockedUntil: Date.now() + 60_000,
		};
		controller.start();
		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");
		if (input === null) throw new Error("no password field");

		input.value = PASSWORD;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await flushDom();
		await flushDom();

		expect(overlayIn()).not.toBeNull();
	});

	it("stays locked and records a failure for the wrong password", async () => {
		controller.start();

		await unlockWith("not the password");

		expect(overlayIn()).not.toBeNull();
		expect(plugin.settings.failedAttempts).toBe(1);
		expect(plugin.saves).toHaveLength(1);
	});

	it("does not carry a failure message into the next lock", async () => {
		controller.start();
		await unlockWith("not the password");
		expect(document.querySelector(".edb-lock-screen__status")?.textContent).toContain(
			"Incorrect password",
		);

		await unlockWith(PASSWORD);
		controller.lock();

		expect(document.querySelector(".edb-lock-screen__status")?.textContent).toBe("");
	});

	it("refuses attempts while a lockout is in force", async () => {
		plugin.settings = {
			...plugin.settings,
			failedAttempts: 5,
			lockedUntil: Date.now() + 60_000,
		};
		controller.start();

		await unlockWith(PASSWORD);

		expect(overlayIn()).not.toBeNull();
		expect(plugin.saves).toHaveLength(0);
	});

	it("keeps a lockout in force when the system clock jumps past its deadline", async () => {
		plugin.settings = { ...plugin.settings, failedAttempts: 4 };
		controller.start();
		await unlockWith("not the password");
		expect(plugin.settings.lockedUntil).toBeGreaterThan(Date.now());

		// Fake Date only: setTimeout must stay real so the key derivation can complete.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(plugin.settings.lockedUntil + 1_000);
		await unlockWith(PASSWORD);

		expect(overlayIn()).not.toBeNull();
		vi.useRealTimers();
	});

	it("seeds the monotonic deadline from a persisted lockout", async () => {
		plugin.settings = {
			...plugin.settings,
			failedAttempts: 5,
			lockedUntil: Date.now() + 60_000,
		};
		controller.start();

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(plugin.settings.lockedUntil + 1_000);
		await unlockWith(PASSWORD);

		expect(overlayIn()).not.toBeNull();
		expect(plugin.saves).toHaveLength(0);
		vi.useRealTimers();
	});

	it("cannot be dismissed when the stored credential is unreadable", async () => {
		plugin.credentialUnreadable = true;
		plugin.settings = { ...plugin.settings, credential: null };
		controller.start();

		// Neither a password field to authenticate against nor a way to dismiss the overlay.
		expect(document.querySelector(".edb-lock-screen__password")).toBeNull();
		expect(document.querySelector(".edb-lock-screen__button")).toBeNull();
		document.querySelector<HTMLButtonElement>(".edb-lock-screen__button")?.click();
		await flushDom();

		expect(overlayIn()).not.toBeNull();
	});

	it("abandons an authentication attempt when the credential changes", async () => {
		let finishDerivation: ((value: ArrayBuffer) => void) | undefined;
		const derivation = new Promise<ArrayBuffer>((resolve) => {
			finishDerivation = resolve;
		});
		const deriveBits = vi
			.spyOn(globalThis.crypto.subtle, "deriveBits")
			.mockImplementationOnce(() => derivation);
		controller.start();

		const input = document.querySelector<HTMLInputElement>(".edb-lock-screen__password");
		if (input === null) throw new Error("The lock screen is not showing a password field.");
		input.value = PASSWORD;
		input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await waitFor(() => deriveBits.mock.calls.length === 1);

		plugin.credentialUnreadable = true;
		plugin.settings = { ...plugin.settings, credential: null };
		controller.settingsChanged();
		const expectedHash = Uint8Array.from(atob(credential.hash), (character) =>
			character.charCodeAt(0),
		);
		finishDerivation?.(expectedHash.buffer);
		await flushDom();
		deriveBits.mockRestore();

		expect(plugin.saves).toHaveLength(0);
		expect(overlayIn()).not.toBeNull();
		expect(document.querySelector(".edb-lock-screen__button")).toBeNull();
	});

	it("does not lock at all when no password is configured", async () => {
		plugin.settings = { ...plugin.settings, credential: null };
		controller.start();
		await flushDom();

		// A lock screen anyone can dismiss protects nothing and only costs a click.
		expect(overlayIn()).toBeNull();
		expect(controller.canLock()).toBe(false);

		controller.lock();

		expect(overlayIn()).toBeNull();
	});

	it("uses a surface the theme cannot make unreadable", async () => {
		document.body.classList.add("theme-light");
		await startLocked();
		const overlay = overlayIn();

		expect(overlay?.style.getPropertyValue("background-color")).toBe("rgb(255, 255, 255)");
		expect(overlay?.style.getPropertyValue("color")).toBe("rgb(31, 31, 31)");

		document.body.classList.remove("theme-light");
		document.body.append(document.createElement("span"));
		await flushDom();

		expect(overlay?.style.getPropertyValue("background-color")).toBe("rgb(30, 30, 30)");
		expect(overlay?.style.getPropertyValue("color")).toBe("rgb(220, 221, 222)");
	});

	it("covers a pop-out window opened while locked", async () => {
		controller.start();
		const popout = newPopout();

		plugin.emit("window-open", {}, popout.window);
		await flushDom();

		expect(overlayIn(popout.window.document)).not.toBeNull();
	});

	it("removes its overlay from a pop-out window that closes", async () => {
		controller.start();
		const popout = newPopout();
		plugin.emit("window-open", {}, popout.window);
		await flushDom();

		plugin.emit("window-close", {}, popout.window);
		await flushDom();

		expect(overlayIn(popout.window.document)).toBeNull();
	});

	it("does not resurrect a closed window after a queued blur", async () => {
		plugin.settings = { ...plugin.settings, lockDelaySeconds: 0 };
		controller.start();
		await unlockWith(PASSWORD);
		const popout = newPopout();
		plugin.emit("window-open", {}, popout.window);
		Object.defineProperty(globalThis, "activeDocument", {
			configurable: true,
			get: () => popout.window.document,
		});

		popout.window.dispatchEvent(new popout.window.Event("blur"));
		plugin.emit("window-close", {}, popout.window);
		await flushDom();
		Object.defineProperty(globalThis, "activeDocument", {
			configurable: true,
			get: () => document,
		});
		controller.lock();

		expect(overlayIn()).not.toBeNull();
		expect(overlayIn(popout.window.document)).toBeNull();
	});

	it("puts the password field in one window only", async () => {
		controller.start();
		const popout = newPopout();
		plugin.emit("window-open", {}, popout.window);
		await flushDom();

		// Two focusable fields in two windows would fight over focus every time the status
		// text is rewritten.
		expect(document.querySelectorAll(".edb-lock-screen__password")).toHaveLength(1);
		expect(popout.window.document.querySelectorAll(".edb-lock-screen__password")).toHaveLength(
			0,
		);
		expect(overlayIn(popout.window.document)?.textContent).toContain(
			"Unlock in the main Obsidian window",
		);
	});

	it("leaves windows the workspace did not open uncovered", async () => {
		controller.start();
		await unlockWith(PASSWORD);
		// A settings window shows settings, not notes. Covering it only adds a lock screen the
		// user has to get past to reach the one that matters.
		const settingsWindow = newPopout();
		Object.defineProperty(globalThis, "activeDocument", {
			configurable: true,
			get: () => settingsWindow.window.document,
		});

		controller.lock();
		await flushDom();

		expect(overlayIn(settingsWindow.window.document)).toBeNull();
		expect(overlayIn()).not.toBeNull();
	});

	it("locks every registered window at once", async () => {
		controller.start();
		const popout = newPopout();
		plugin.emit("window-open", {}, popout.window);
		await flushDom();

		await unlockWith(PASSWORD);
		expect(overlayIn(popout.window.document)).toBeNull();

		controller.lock();

		expect(overlayIn()).not.toBeNull();
		expect(overlayIn(popout.window.document)).not.toBeNull();
	});
});
