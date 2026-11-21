# Changelog

## 0.2.0 — 2026-11-21

First published release.

- Mode engine: NORMAL deselects the marked bundles (absent, not disabled), PRIVATE composes them
  again; workspaces and sessions of a private workspace are archived through DSH's registry.
- Transactional switch with rollback, a serialized job queue, a 30-second stale watchdog, and a
  superseded job that stands down before it touches another bundle.
- Front lock: scrypt PIN with two-field confirmation, platform-authenticator unlock (ES256 verified
  on the host), and a single-use recovery token issued by a verified gesture.
- Per-conversation privacy: the composer button marks the current chat, which leaves the workspace
  tree and stays frosted outside PRIVATE; the card offers the way back.
- Grouped workspace list inside PRIVATE (regular / private), collapsible, with a hidden-chats list
  and a control that restores the built-in list.
- Bulk classification per section in one write, one audit line and one reconcile.
- `privacy_mode` tool registered only while the mode is PRIVATE.
- Checks: 58 engine cases, an offline client renderer matrix, and a preset drift check.
