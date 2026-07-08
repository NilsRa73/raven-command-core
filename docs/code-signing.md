# Code signing — current status

**As of v0.2.0 the Windows installer is UNSIGNED.** The dashboard,
the tray/status window, and the release manifest all report
`signed: false`. Do not claim otherwise anywhere.

## What a real signed release requires

1. An EV or standard Windows code-signing certificate issued to
   **RAH AI Studios**. EV avoids SmartScreen warnings immediately;
   standard certificates gain reputation over time.
2. A hardware token (EV) or an HSM/Azure Key Vault holding the key.
   Never commit the certificate or private key.
3. GitHub Actions secrets: `WINDOWS_CERT_PFX_BASE64`,
   `WINDOWS_CERT_PFX_PASSWORD`, or (Azure KV) `AZURE_KV_URL`,
   `AZURE_KV_TENANT_ID`, `AZURE_KV_CLIENT_ID`,
   `AZURE_KV_CLIENT_SECRET`.
4. Signing step in the Windows workflow that runs `signtool sign`
   (or `AzureSignTool`) on **both** the installer and the sidecar
   `.exe` after `cargo tauri build`.
5. Flip `signed: true` in `scripts/build-release-manifest.mjs` only
   after signtool has actually completed in the same run.

## What NOT to do

- Do not add a "signed" badge while the artifact is unsigned.
- Do not self-sign — Windows treats self-signed EXEs as unsigned.
- Do not store the PFX anywhere other than GitHub Encrypted Secrets
  or an HSM. Never in the repo, `public/`, `.env`, or `LOCALAPPDATA`.

## Interim UX

Until signing is in place, the installer will trigger Windows
SmartScreen "Unrecognized app" warnings. The dashboard and the tray
window both display an "Unsigned development build" badge so users
know this is expected.