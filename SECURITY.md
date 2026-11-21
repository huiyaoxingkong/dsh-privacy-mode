# Security policy

## What this plugin protects

`dsh-privacy-mode` is a **front lock**: it stops the person at the screen from finding or reading
what you marked private while the profile is in NORMAL. It is not disk encryption.

- Session logs and workspace registries are never encrypted, moved or deleted. Private chats are
  archived through DSH's own registry, so anyone with file access can still read them.
- The password is stored as scrypt with a per-PIN salt; no plaintext is written anywhere.
- The platform-authenticator path stores only a public key and a credential id. Assertions are
  verified on the host (`lib/webauthn.js`): single-use challenge, origin and rpId binding, user
  presence and user verification flags, and the ES256 signature.
- The plugin makes no network requests and collects no telemetry.

## Reporting a vulnerability

Open a private advisory on this repository (Security → Report a vulnerability) or mail
lihaoyang20041201@outlook.com. Please include the DSH version, the profile, and the smallest repro
you have. Expect an answer within a week; fixes ship on `main` and in the next tag.

## Supported versions

The latest tagged release on `main`. Older tags are kept for pinning, not for fixes.
