# RAH Desktop Bridge — Windows Build & Release

This is the source-of-truth for building the v0.2.0 companion
installer. The workflow at
`.github/workflows/build-rah-desktop-bridge-windows.yml` runs the
same steps automatically on `windows-latest`.

## One-time developer setup (Windows)

1. Install Node.js 22 LTS.
2. Install Rust stable (`rustup default stable`) and MSVC build tools.
3. `cargo install tauri-cli --version "^2" --locked`.
4. Install the WebView2 runtime (preinstalled on Windows 11).

## Build steps

```powershell
cd desktop-bridge; node --test tests; cd ..
cd desktop-bridge-native\src-tauri; cargo test --lib --release; cd ..\..

node desktop-bridge-native\package-sidecar.mjs
cd desktop-bridge-native\src-tauri\binaries
node --experimental-sea-config sea-config.json
Copy-Item (Get-Command node).Source rah-bridge-sidecar-x86_64-pc-windows-msvc.exe
npx postject rah-bridge-sidecar-x86_64-pc-windows-msvc.exe NODE_SEA_BLOB sea-prep.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
cd ..

cargo tauri icon ..\..\src\assets\raven-mark.svg -o icons
cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis

cd ..\..
node scripts\build-release-manifest.mjs
```

Output: `desktop-bridge-native/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`.

## Releasing

1. Bump `tauri.conf.json` `version` and `Cargo.toml` `version`.
2. Bump `bridgeMinVersion` in the manifest only if the wire protocol changed.
3. Tag `desktop-bridge-v0.2.0` and push. The Windows workflow builds
   and uploads a **draft** GitHub Release with the installer,
   sidecar, and `SHA256SUMS.txt`. Review, then publish manually.
4. Copy the released installer into `public/` and commit the updated
   `src/lib/rah/bridge-manifest.json`.

## Verifying an installer locally

```powershell
Get-FileHash rah-desktop-bridge-0.2.0-x64.exe -Algorithm SHA256
```

Compare against `windowsInstaller.sha256` in
`src/lib/rah/bridge-manifest.json`.