# RAH Desktop Bridge — release signing and updater readiness

This document is the single source of truth for how a signed production
build is produced. **The repository never ships private keys or
certificates.** Every credential lives in workspace / CI secrets.

## Two independent signing surfaces

1. **Tauri updater signing (minisign)** — used to sign the `latest.json`
   payload that the updater plugin verifies before installing an update.
   Without this, the app must not be published as auto-updatable.

2. **Windows code signing (Authenticode)** — signs the NSIS `.exe`
   installer and the SEA sidecar `.exe`. Without this, users get a
   SmartScreen warning and the download path is not eligible for the
   updater to trust it end-to-end.

These are set up separately. `scripts/release-preflight.mjs` reports
each independently: `not_configured`, `installer_signed_updater_not_configured`,
`ready_updater_only_installer_unsigned`, or `ready_signed`.

## Environment / secret contract

| Purpose                                | Variable                              | Where |
| -------------------------------------- | ------------------------------------- | ----- |
| Tauri updater private key              | `TAURI_SIGNING_PRIVATE_KEY`           | CI secret |
| Tauri updater private key password     | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | CI secret |
| Tauri updater public key (base64)      | `TAURI_UPDATER_PUBKEY`                | Merged into `tauri.conf.json` at CI |
| Updater endpoint (HTTPS `latest.json`) | `RELEASE_BASE_URL` / `RELEASE_ENDPOINT` | CI secret |
| Windows codesign cert (base64 PFX)     | `WINDOWS_CERTIFICATE`                 | CI secret |
| Windows codesign cert password         | `WINDOWS_CERTIFICATE_PASSWORD`        | CI secret |
| signtool.exe path (optional)           | `WINDOWS_SIGNTOOL_PATH`               | Runner-provided |
| Release manifest signature (minisign)  | `RELEASE_SIGNATURE`, `RELEASE_KEY_ID` | CI secret |

`scripts/release-preflight.mjs` reads only presence (`!!process.env.X`),
never the values. It never prints or logs secret contents.

## How the updater plugin is enabled

To keep dev builds unsigned and honest, the updater plugin is **not**
wired into the default capabilities. Enabling it in a production build
is a three-step, secret-gated merge that happens in CI only:

1. CI writes `tauri.updater.template.json` into `tauri.conf.json` under
   `plugins.updater`, substituting `TAURI_UPDATER_PUBKEY` for
   `REPLACE_WITH_BASE64_MINISIGN_PUBLIC_KEY` and the endpoint URL for
   the placeholder.
2. CI copies `capabilities/updater.template.json` into
   `capabilities/updater.json` so Tauri loads the `updater:default`
   permission.
3. CI initializes the plugin in `main.rs` behind the `updater` Cargo
   feature (opt-in) — the default `cargo tauri build` on a developer
   machine does not carry that feature.

If any of the required secrets are missing, the production workflow
**must fail before** producing a build that claims to be signed. The
dev workflow explicitly does not attempt any signing.

## Sidecar (Node SEA) integrity

The sidecar is bundled with esbuild (`package-sidecar.mjs`) into a
single CommonJS file. Its SHA-256 is printed at bundle time and
re-hashed by the preflight script when the corresponding `.exe`
exists (Windows CI only). The SHA-256 of every dist artifact is
recorded to `dist/SHA256SUMS.txt`.

## Release manifest

`scripts/build-updater-manifest.mjs` produces
`public/updater-manifest.json` (our internal, schemaVersion 3
manifest) from the real installer artifact. It writes
`public/latest.json` (Tauri updater format) **only** when the
installer, the HTTPS endpoint URL, and a real minisign signature are
all present. Otherwise it exits with a non-zero code and never
fabricates a signed manifest.

## What this repository does not do

- Does not generate or embed private keys.
- Does not sign installers on developer machines.
- Does not publish a GitHub Release automatically.
- Does not claim a build is signed unless the CI job that produced it
  had every required secret and passed `release-preflight`.

## Runbook (production release)

1. In GitHub → Settings → Secrets, add every entry in the table above.
2. Push a tag matching `desktop-bridge-v<semver>`.
3. `Build RAH Desktop Bridge — Production (signed)` runs:
   preflight → sidecar → merge updater template → `cargo tauri build`
   with codesign → `build-updater-manifest.mjs` → upload artifacts.
4. Review the draft GitHub Release, verify the `SHA256SUMS.txt` values
   against the workflow log, then publish manually.

If any of the above is missing, downgrade to
`Build RAH Desktop Bridge — Development (unsigned)` which produces a
working build clearly labelled unsigned and does not publish a
manifest that promises auto-updates.