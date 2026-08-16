# Obsidian Lock Screen Plugin

Adds a password-gated privacy screen to Obsidian 1.13 and later.

## Features

- Locks when the vault opens or when you run the **Lock screen** command.
- On desktop, locks after every Obsidian window has lost focus for a configurable delay.
- On mobile, locks after a configurable period without interaction.
- Covers the main window and every pop-out window.
- Stores a unique salt and a PBKDF2-HMAC-SHA-256 hash with 600,000 iterations. The
  password itself is never saved.
- Delays authentication after repeated failures, with an escalating lockout persisted across
  restarts.

## Security model

This plugin is a UI privacy control, not an encryption boundary. It is intended to stop casual
access when Obsidian is left open.

It cannot protect vault data from:

- direct filesystem access;
- another Obsidian plugin;
- Electron developer tools;
- disabling or modifying this plugin; or
- a compromised operating-system session.

Use full-disk encryption and the operating system's session lock for sensitive data. Encrypt
individual vaults or containers when data must remain confidential outside Obsidian.

## Upgrading from 1.x

Version 1.x stored the configured password in plaintext. Version 2.0 deletes that field instead
of loading or retaining it. After upgrading, open **Settings → Lock Screen** and set a new
password.

## Development

The build requires Node 24 and npm.

```sh
npm ci
npm run check
```

Production artifacts are written to `dist/`.

## Maintenance and credits

Eric Biewener created the original plugin. James Turnbull maintains the current version at
[jamtur01/obsidian-lock-screen-plugin](https://github.com/jamtur01/obsidian-lock-screen-plugin).
See [CHANGELOG.md](CHANGELOG.md) for release details.

Copyright 2022 Eric Biewener and 2026 James Turnbull. Released under the [MIT License](LICENSE).
