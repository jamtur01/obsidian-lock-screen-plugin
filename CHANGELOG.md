# Changelog

## 2.0.0 - 2026-08-16

### Security

- Replace plaintext password persistence with uniquely salted PBKDF2-HMAC-SHA-256 hashes using
  600,000 iterations.
- Delete the insecure 1.x plaintext password field on upgrade and require a new password.
- Add persistent, exponentially increasing lockouts after repeated failed attempts.
- Keep authentication state separate from the overlay so removing the element does not unlock
  the plugin; restore removed overlays while locked.
- Block keyboard, pointer, touch, drag, context-menu, and wheel events outside the lock UI during
  the locked state.
- Cover the main window, workspace pop-outs, and dynamically focused Obsidian windows.
- Replace the release script that staged every file and pushed automatically with a local,
  manifest-only version bump.

### Changed

- Require Obsidian 1.13 and use its declarative, searchable settings API and confirmation modal.
- Target Node 24 for development and replace ESLint/Prettier with Oxlint/Oxfmt.
- Switch the development lockfile from Yarn to npm and pin every direct dependency.
- Update the security documentation to describe the plugin as a UI privacy control rather than
  an encryption boundary.

### Added

- Add behavior tests for password hashing, failed-attempt lockouts, settings validation, and
  plaintext-password removal.
- Add strict TypeScript, lint, format, test, and build verification.

## 1.3.0 - 2022-03-03

- Focus the active editor after dismissing the lock screen.
- Publish the final upstream release by Eric Biewener.
