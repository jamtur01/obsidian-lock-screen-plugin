# Obsidian Lock Screen

A password-gated privacy screen for desktop Obsidian 1.13 and later.

## Locking

The lock screen appears when:

- Obsidian starts;
- you have not interacted for the **idle timeout**;
- every Obsidian window has been unfocused for the **lock delay**; or
- you run the **Lock screen** command.

Type the password to unlock; there is no need to press Enter. Repeated failures trigger an
escalating lockout that survives a restart. The main window holds the password field, and pop-out
note windows are covered and point you to it.

Nothing happens until you set a password in **Settings → Lock Screen**.

Locking on start is worth keeping on. It is the only trigger that catches someone else opening
Obsidian, because the idle timeout resets on every interaction and so never fires while a person
is reading.

## Where your password is kept

In Obsidian's per-device Secret Storage, as a PBKDF2-HMAC-SHA-256 hash with 600,000 iterations
and a unique salt. Nothing about the lock screen is kept in the vault: `data.json` is cleared once
on first load and never written again.

So editing or deleting vault files cannot change the password, clear a lockout, or roll
enforcement back, and the hash never reaches Git, sync, or backups.

Secret Storage is Obsidian's own local store, not an operating-system keychain.

Credentials do not sync. Set a password on each machine — the same one, if you like.

## What it protects against

Someone sitting down at your unattended, already-open Obsidian. That is the whole design goal.

This is a privacy control, not encryption. It cannot protect against:

- **Anyone who can write vault files.** The plugin's own `main.js` lives in the vault, and a
  modified copy simply does not lock.
- **Other plugins, developer tools, or filesystem access.** They read your notes directly.
- **A theme or CSS snippet.** A `transform` or `filter` on an ancestor element can clip the
  overlay out of view. Input stays blocked, because the locked state lives in the plugin rather
  than the page, but whatever is on screen can be exposed.
- **Mobile.** The plugin is desktop-only, so a synced vault is unprotected on iOS and Android.
- **Guessing without pressing Enter.** Typing is not counted towards the lockout, so it is
  limited only by the cost of the key derivation.

A settings window is left uncovered and can stay visible while locked. It is not a way in: the
password and the timeouts cannot be changed while locked. Working in one counts as using Obsidian,
so the idle timeout does not fire while you are typing there.

For anything genuinely confidential, use full-disk encryption and your operating system's session
lock.

## If you forget the password

There is no recovery code. Open **Settings → Keychain**, delete the secret named
`obsidian-lock-screen-plugin-state-v1`, and restart Obsidian. Your notes are untouched; only this
device's password and lockout state are cleared.

## Upgrading from 1.x

Version 1.x kept the password in plaintext in `data.json`. Version 2.0 clears that file instead of
reading it, so set a new password in **Settings → Lock Screen** on each device.

## Development

Requires Node 24.13.0 (see `.node-version`) and npm.

```sh
npm ci
npm run check
```

Production artifacts are written to `dist/`.

## Credits

Eric Biewener created the original plugin. James Turnbull maintains the current version at
[jamtur01/obsidian-lock-screen-plugin](https://github.com/jamtur01/obsidian-lock-screen-plugin).
See [CHANGELOG.md](CHANGELOG.md) for release details.

Copyright 2022 Eric Biewener and 2026 James Turnbull. Released under the [MIT License](LICENSE).
