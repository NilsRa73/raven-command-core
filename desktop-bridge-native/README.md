# RAH Desktop Bridge — Native Companion (v0.2.1)

Tauri 2 tray/status companion that supervises the existing
`desktop-bridge/` Node sidecar. The sidecar is bundled with esbuild
to a single CommonJS file and packaged as a Node 22 SEA (Single
Executable Application) so end users do NOT install Node.js.

**v0.2.1 wires the real spawn** — `start_bridge` genuinely launches
the named sidecar via `tauri-plugin-shell` with a fixed empty argv,
`stop_bridge` terminates it, `restart_bridge` cycles it, tray Quit
stops the child before app exit, and the native health probe against
`http://127.0.0.1:47824/v1/health` drives the "Connected" state.

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
  package-sidecar.mjs  bundles ../desktop-bridge with esbuild + writes SEA config
  assets/raven-mark.svg  repo-owned brand SVG used to generate app icons
  icons/               .ico / .png (generated at CI; see icons/README.md)
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

The Tauri app supervises `rah-bridge-sidecar.exe` with a fixed empty
argv, no shell interpreter, and no user-controlled arguments. The
capabilities file scopes `shell:allow-execute` to that one named
sidecar only. See `../docs/desktop-bridge-windows-build.md` for
CI/release.

## What is intentionally NOT here

- No silent auto-update — update-check is manual in v0.2.0.
- No screenshot capture (protocol still returns 501).
- No embedded signing certificate. Development artifacts are unsigned
  and the UI shows an "Unsigned development build" badge.