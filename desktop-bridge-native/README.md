# RAH Desktop Bridge — Native Companion (v0.2.0)

Tauri 2 tray/status companion that supervises the existing
`desktop-bridge/` Node sidecar. The sidecar is bundled as a Node 22
SEA (Single Executable Application) so end users do NOT install
Node.js.

## Layout

```
desktop-bridge-native/
  src-tauri/           Tauri 2 Rust source
    src/main.rs        entry, tray, single-instance, IPC allowlist
    src/supervisor.rs  child-process state machine + capped restart
    src/redact.rs      log/UI redaction of pairing codes and tokens
    tauri.conf.json    bundle + CSP + allowlist
    Cargo.toml
  ui/                  static webview UI (black/gold RAH)
  package-sidecar.mjs  builds the Windows SEA sidecar from ../desktop-bridge
  icons/               .ico / .png (generated at build; see icons/README.md)
```

## Local development

Prerequisites (developer machine, not end user):

- Rust stable (`rustup default stable`)
- Node.js 22 LTS
- On Windows: MSVC build tools + WebView2 runtime (preinstalled on Windows 11)

```
node desktop-bridge-native/package-sidecar.mjs
cd desktop-bridge-native/src-tauri
cargo tauri dev          # requires: cargo install tauri-cli --version ^2
```

The Tauri app supervises `rah-bridge-sidecar.exe` with argv only
(no shell). There is no generic shell/PowerShell IPC exposed to the
webview. See `../docs/desktop-bridge-windows-build.md` for CI/release.

## What is intentionally NOT here

- No silent auto-update — update-check is manual in v0.2.0.
- No screenshot capture (protocol still returns 501).
- No embedded signing certificate. Development artifacts are unsigned
  and the UI shows an "Unsigned development build" badge.