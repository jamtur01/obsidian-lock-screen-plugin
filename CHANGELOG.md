# Changelog

## Unreleased

### Fixed

- Count interaction in Obsidian windows the lock screen leaves uncovered, such as a settings
  window, towards the idle timeout. Working in one previously looked like inactivity, so the
  lock fired mid-edit and the keymap scope then blocked typing in that window. A window already
  holding focus when the plugin loads is picked up too, which is what happens when the plugin is
  reloaded from the settings window.

## 2.0.0 - 2026-08-16

### Security

- Replace plaintext password persistence with uniquely salted PBKDF2-HMAC-SHA-256 hashes using
  600,000 iterations.
- Delete the insecure 1.x plaintext password field on upgrade and require a new password.
- Clear `data.json` once on first load and never write to it again. Nothing about the lock screen
  is kept in the vault, so the credential cannot reach Git, sync, or backups, and there is no
  verifier there to crack offline. Removal of a 1.x plaintext password is reported only after
  that write succeeds, and plainly when it failed and the plaintext is still on disk.
- Never let a vault read or write failure abort plugin loading, which previously left the vault
  open with no lock screen at all.
- Hold the credential, failed-attempt counter, lockout deadline, and both timeouts in Obsidian's
  per-device Secret Storage under a fixed, plugin-owned identifier, and consult nothing else.
  Editing or deleting vault files can no longer change the password, clear a lockout, or roll
  enforcement back. Replacing or disabling the plugin itself remains out of scope.
- Verify every stored record by reading it back, since `setSecret` returns void and reports
  nothing, and refuse to continue as though a lost write had succeeded.
- Stay locked when the stored record cannot be parsed, rather than behaving as though no password
  had been set. An absent record means the device was never set up, which cannot be induced by
  writing to the vault.
- Store an explicit passwordless record when a password is removed, because Secret Storage has no
  delete operation and an absent record would mean something else.
- Do not show a lock screen when no password is configured. It could be dismissed by anyone who
  saw it, so it protected nothing and cost a click on every launch and every idle timeout.
- Set a password per device. Nothing carries one between devices, because doing so would require
  leaving a verifier in the vault, and it would not have propagated password changes anyway:
  a device that is already set up never consults the vault.
- Abandon an in-flight password check if the credential changes, so an external settings reload
  cannot make the completed attempt overwrite or unlock against stale authentication state.
- Unlock as soon as the typed password is right, without waiting for Enter, checking after a
  pause rather than on every keystroke since each check costs a full key derivation. A failure
  while typing is not recorded, because counting every prefix would reach the lockout threshold
  before a password could be finished.
- Add persistent, exponentially increasing lockouts after repeated failed attempts, held against
  a monotonic clock as well as the stored deadline. Seed that monotonic deadline from persisted
  state so moving the system clock forward cannot clear an existing current-session lockout.
- Keep authentication state separate from the overlay so removing the element does not unlock
  the plugin. While locked, restore the overlay after removal, reparenting, or class and style
  edits, pinning its critical layout with inline `!important` declarations.
- Block keyboard, pointer, touch, drag, context-menu, and wheel events outside the lock UI during
  the locked state. Window capture precedes document handlers, while a dedicated active Obsidian
  keymap scope prevents core hotkeys even though the core listener was registered first.
- Block Ctrl and Cmd hotkeys pressed inside the lock UI as well, which would otherwise open a
  modal beneath the overlay and take focus off the password field. Plain typing, accented
  characters, select all, paste, and undo still work so a password manager can fill the field.
- Return focus to the password field if anything takes it while locked, in the focused window
  only.
- Keep the overlay's background and text colour out of theme variables entirely, pinned inline as
  a matching literal pair chosen to suit a light or dark theme, so neither a missing variable nor
  a hostile one can leave the lock screen transparent or its text unreadable. Clipping,
  transforms, transitions, masks, and filters that could move or conceal it are neutralized the
  same way.
- Mask password fields with an inline declaration as well as the stylesheet class, so losing
  `styles.css` cannot reveal the password, and block dragging text out of the field.
- Clear the typed password and the failure message when the lock screen is dismissed, and clear
  the password modal's fields when it closes rather than only on a successful save.
- Cover the main window and workspace pop-outs, and nothing else, since only those show notes.
  Only the main window carries a password field; pop-outs say where to unlock, because two
  focusable fields in two windows fought over focus every time the countdown was rewritten.
- Refuse to change the password or the timeouts while locked. Settings windows are deliberately
  left uncovered, so one can stay visible and usable above the lock screen; refusing the change
  is what stops it being used to remove the password and walk past.
- Lock on inactivity. Losing window focus was previously the only automatic trigger, so a focused
  window left unattended never locked. Set the idle timeout to 0 to disable it.
- Add a "Lock when Obsidian starts" toggle, on by default. It is the only trigger that covers
  someone opening Obsidian themselves, since the idle timeout resets on every interaction and so
  never fires while a person is reading. Turning it off leaves the idle and focus triggers armed.
- Only lock on a cold start, never when the plugin is enabled or reloaded into an Obsidian that
  is already running. Doing either requires already being inside an unlocked vault, so locking
  afterwards protects nothing and only interrupts the person who just did it.
- Replace the release script that staged every file and pushed automatically with a local,
  manifest-only version bump.

### Changed

- Require desktop Obsidian. The plugin now declares `isDesktopOnly`, so it no longer loads
  on iOS or Android, and a synced vault is unprotected there.
- Observe the DOM for tampering only while locked, instead of keeping a subtree observer on
  every window for the plugin's lifetime.
- Unbind each window's listeners when its context is torn down, rather than holding them until
  the plugin unloads, reject closed documents during blur transitions, and register restored
  pop-outs once the workspace layout is ready.
- Require Obsidian 1.13 and use its declarative, searchable settings API and confirmation modal.
- Target Node 24 for development and replace ESLint/Prettier with Oxlint/Oxfmt.
- Switch the development lockfile from Yarn to npm and pin every direct dependency.
- Update the security documentation to describe the plugin as a UI privacy control rather than
  an encryption boundary, state that replacing or disabling the plugin defeats it regardless of
  where credentials are stored, explain why passwords are per device, and document how to clear a
  forgotten password.

### Added

- Add behavior tests for password hashing, failed-attempt lockouts, settings validation, and
  plaintext-password removal.
- Add DOM-level tests covering the locked state machine, overlay tamper recovery, event
  blocking, lockout enforcement, and pop-out windows.
- Add strict TypeScript, lint, format, test, and build verification.
- Run that verification in CI, and build release artifacts from the tagged source rather than
  uploading them by hand. Releases follow Obsidian's recommended workflow: the tag is checked
  against `manifest.json`, artifacts carry a build provenance attestation, and the release is
  created as a draft with the GitHub CLI rather than a third-party action.
- Pin both workflows to action commit SHAs, an exact runner image, and an exact Node version, and
  stop the checkout step persisting credentials.

## 1.3.0 - 2022-03-03

- Focus the active editor after dismissing the lock screen.
- Publish the final upstream release by Eric Biewener.
