# dsh-privacy-mode

Asymmetric visibility modes for [DeepSeek Harness](https://github.com/deepseek-ai): in **NORMAL**
the plugins, workspaces and chats you marked private do not exist; in **PRIVATE** the whole
profile is visible again and reading comes back.

[中文说明](dsh-privacy-mode/README.md) · [Bundle source](dsh-privacy-mode/) · MIT

```
NORMAL   marked bundle -> not composed at all (no row, no tools, no prompt text)
         marked workspace/session -> archived and out of the sidebar
PRIVATE  everything composed again; private chats readable, tagged and listed by group
```

## What it does

- **One switch, three planes.** A bundle marked private stops being composed — not disabled,
  absent — so its tools never reach the tool catalog. Workspaces and sessions of a private
  workspace are archived through DSH's own registry, never deleted.
- **Locked entry.** A password (scrypt, no plaintext) or a platform authenticator (Windows Hello /
  Touch ID, verified with ES256 signatures on the host) gates PRIVATE. A forgotten password can be
  recovered through the computer's own PIN, which also issues a single-use reset token.
- **Per-chat privacy.** The button under the composer marks *this* conversation: it leaves the
  workspace tree, and its content stays frosted outside PRIVATE.
- **Grouped navigation.** Inside PRIVATE the workspace list is split into 常规工作区 and 隐私工作区,
  both collapsible.
- **Bulk classification.** Each section gets "all private / all regular / all unclassified" in one
  write, one audit line and one reconcile.

## Install

```bash
plugin_manager install_bundle {"target": "github:huiyaoxingkong/dsh-privacy-mode#path:dsh-privacy-mode"}
plugin_manager set_bundle    {"target": "dsh-privacy-mode", "enabled": true}
```

Requires DSH `>=0.2.2-rc.5 <0.3.0`. Enabling or disabling the bundle recomposes the profile; a
running turn can be interrupted, which is why the switch itself answers before it runs.

## Market index

This repository publishes its own index for the DSH Discover page:

```
https://huiyaoxingkong.github.io/dsh-privacy-mode/index.json
```

Add it under Settings → Plugins → Market indexes.

## Privacy boundary

The plugin changes **visibility and composition only**. It does not encrypt or migrate
`~/.dsh/sessions` or the workspace registry, it makes no network requests, and it sends no
telemetry. A private chat is archived, not wiped: anyone with the filesystem can still read it —
the lock is a front lock against the person at the screen, not disk encryption.

## Development

```bash
node dsh-privacy-mode/scripts/selfcheck-coldstart.mjs   # 58 checks: mode semantics, rollback, PIN, WebAuthn, queue, recovery
node dsh-privacy-mode/scripts/check-client.mjs          # renders the client half without a browser
node dsh-privacy-mode/scripts/check-presets.mjs         # preset drift against the installed standard preset
```

CI runs the first two on every push (the preset check skips itself without a DSH installation).

## License

MIT © 2026 huiyaoxingkong
