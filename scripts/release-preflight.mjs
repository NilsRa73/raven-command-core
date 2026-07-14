#!/usr/bin/env node
// Native companion v0.3 release preflight. Deterministic, no network.
//
// Verifies:
//   - Node 22
//   - package versions align (desktop-bridge, native, tauri.conf.json)
//   - Tauri bundle identifier + productName sane
//   - Sidecar bundle presence + naming
//   - Bridge min-version compatibility
//   - Updater endpoint / public key configuration presence
//   - Windows signing cert / signtool presence (env-driven)
//   - Build artifact presence (if built)
//   - SHA-256 checksum re-verification
//
// Exits non-zero on blockers. Warnings printed but do not block.
// Usage: node scripts/release-preflight.mjs [--json]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  compareSemver,
  meetsMinimum,
  summarizeSigningReadiness,
  evaluateSidecarCompatibility,
  parseSemver,
} from "../src/lib/rah/updater.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOut = process.argv.includes("--json");

const blockers = [];
const warnings = [];
const info = [];
const push = (arr, msg) => arr.push(msg);

// Node version
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) push(blockers, `node_version_below_22:${process.versions.node}`);
else push(info, `node=${process.versions.node}`);

// Load package versions
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

const bridgePkgPath = path.join(repoRoot, "desktop-bridge", "package.json");
const nativeCargoPath = path.join(repoRoot, "desktop-bridge-native", "src-tauri", "Cargo.toml");
const tauriConfPath  = path.join(repoRoot, "desktop-bridge-native", "src-tauri", "tauri.conf.json");
const manifestPath   = path.join(repoRoot, "src", "lib", "rah", "bridge-manifest.json");

const bridgePkg   = readJson(bridgePkgPath);
const tauriConf   = readJson(tauriConfPath);
const manifest    = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;

const bridgeVersion = bridgePkg.version;
const tauriVersion  = tauriConf.version;

const cargoToml = fs.readFileSync(nativeCargoPath, "utf8");
const cargoVersionMatch = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml);
const cargoVersion = cargoVersionMatch ? cargoVersionMatch[1] : null;

if (!parseSemver(bridgeVersion)) push(blockers, `bridge_version_invalid:${bridgeVersion}`);
if (!parseSemver(tauriVersion))  push(blockers, `tauri_version_invalid:${tauriVersion}`);
if (!parseSemver(cargoVersion))  push(blockers, `cargo_version_invalid:${cargoVersion}`);

if (bridgeVersion && tauriVersion && compareSemver(bridgeVersion, tauriVersion) !== 0) {
  push(warnings, `version_drift_bridge_vs_tauri:${bridgeVersion}!=${tauriVersion}`);
}
if (tauriVersion && cargoVersion && tauriVersion !== cargoVersion) {
  push(blockers, `version_mismatch_cargo_vs_tauriConf:${cargoVersion}!=${tauriVersion}`);
}
push(info, `bridge=${bridgeVersion} tauri=${tauriVersion} cargo=${cargoVersion}`);

// Bundle identifier / product name
if (tauriConf.identifier !== "studios.rah.desktop-bridge") push(blockers, `identifier_unexpected:${tauriConf.identifier}`);
if (!tauriConf.productName || !tauriConf.productName.trim()) push(blockers, "productName_missing");
if (tauriConf.bundle?.windows?.nsis?.installMode !== "currentUser") push(blockers, "nsis_installMode_must_be_currentUser");

// Sidecar externalBin
const externalBin = tauriConf.bundle?.externalBin ?? [];
if (!externalBin.includes("binaries/rah-bridge-sidecar")) push(blockers, "externalBin_missing_rah-bridge-sidecar");

// Bridge manifest → min-version compatibility
if (manifest) {
  const minV = manifest.bridgeMinVersion ?? "0.0.0";
  if (!meetsMinimum(bridgeVersion, minV)) push(blockers, `bridge_below_min:${bridgeVersion}<${minV}`);
  const compat = evaluateSidecarCompatibility({
    sidecarVersion: bridgeVersion,
    appVersion: tauriVersion,
    bridgeMinVersion: minV,
  });
  if (!compat.compatible) push(blockers, `sidecar_incompatible:${compat.reasons.join(",")}`);
} else {
  push(warnings, "bridge_manifest_missing");
}

// Sidecar bundle presence (bundled CJS is created by package-sidecar.mjs)
const bundleCjs = path.join(repoRoot, "desktop-bridge-native", "src-tauri", "binaries", "rah-bridge-sidecar.bundle.cjs");
if (!fs.existsSync(bundleCjs)) push(warnings, "sidecar_bundle_not_built_yet_run_package_sidecar.mjs");

// Sidecar exe (only present after Windows CI SEA step)
const sidecarExe = path.join(repoRoot, "desktop-bridge-native", "src-tauri", "binaries", "rah-bridge-sidecar-x86_64-pc-windows-msvc.exe");
if (!fs.existsSync(sidecarExe)) push(warnings, "sidecar_exe_not_built_windows_ci_required");

// Updater plugin config presence (structural check; does not read secrets)
const updaterCfg = tauriConf.plugins?.updater ?? null;
const endpointConfigured = !!(updaterCfg?.endpoints && Array.isArray(updaterCfg.endpoints) && updaterCfg.endpoints.length > 0 && updaterCfg.endpoints.every((e) => /^https:\/\//.test(String(e))));
const publicKeyConfigured = !!(updaterCfg?.pubkey && String(updaterCfg.pubkey).length > 32);
if (!updaterCfg) push(warnings, "updater_plugin_not_configured_in_tauri.conf.json");
else {
  if (!endpointConfigured) push(warnings, "updater_endpoints_missing_or_not_https");
  if (!publicKeyConfigured) push(warnings, "updater_pubkey_missing");
}

// Signing env (presence only — never read the values themselves)
const env = process.env;
const signing = summarizeSigningReadiness({
  tauriPrivateKeyPresent: !!env.TAURI_SIGNING_PRIVATE_KEY,
  tauriKeyPasswordPresent: !!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
  tauriPublicKeyPresent: publicKeyConfigured,
  windowsCertPresent: !!env.WINDOWS_CERTIFICATE,
  windowsSignToolPresent: !!env.WINDOWS_SIGNTOOL_PATH || process.platform === "win32",
  updaterEndpointConfigured: endpointConfigured,
});

// Installer artifact + checksum (public/ copy staged by CI)
const publicDir = path.join(repoRoot, "public");
const installerCandidates = fs.existsSync(publicDir)
  ? fs.readdirSync(publicDir).filter((f) => /^rah-desktop-bridge-\d+\.\d+\.\d+.*-x64\.exe$/i.test(f))
  : [];
let installer = null;
if (installerCandidates.length === 0) {
  push(warnings, "installer_artifact_not_present_in_public_dir");
} else if (installerCandidates.length > 1) {
  push(blockers, `installer_artifact_ambiguous:${installerCandidates.join(",")}`);
} else {
  const p = path.join(publicDir, installerCandidates[0]);
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  installer = { file: installerCandidates[0], bytes: buf.length, sha256: sha };
  push(info, `installer=${installer.file} bytes=${installer.bytes} sha256=${installer.sha256}`);
  // Cross-check against manifest if present
  if (manifest?.windowsInstaller?.sha256 && manifest.windowsInstaller.sha256 !== sha) {
    push(blockers, `installer_sha_mismatch_vs_manifest:${sha}!=${manifest.windowsInstaller.sha256}`);
  }
}

const result = {
  ok: blockers.length === 0,
  nodeVersion: process.versions.node,
  versions: { bridge: bridgeVersion, tauri: tauriVersion, cargo: cargoVersion },
  signing,
  installer,
  blockers,
  warnings,
  info,
};

if (jsonOut) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  const line = (l) => process.stdout.write(l + "\n");
  line("[release-preflight] Native companion v0.3");
  line(`  node        : ${result.nodeVersion}`);
  line(`  versions    : bridge=${bridgeVersion} tauri=${tauriVersion} cargo=${cargoVersion}`);
  line(`  signing     : ${signing.overall}`);
  line(`    configured: ${signing.configured.join(", ") || "(none)"}`);
  line(`    missing   : ${signing.missing.join(", ") || "(none)"}`);
  line(`    external  : ${signing.external.join(", ") || "(none)"}`);
  line(`  installer   : ${installer ? `${installer.file} (${installer.bytes} bytes)` : "(not present)"}`);
  if (info.length)     line("  info:\n    - " + info.join("\n    - "));
  if (warnings.length) line("  warnings:\n    - " + warnings.join("\n    - "));
  if (blockers.length) line("  BLOCKERS:\n    - " + blockers.join("\n    - "));
  line(`  result      : ${result.ok ? "PASS" : "FAIL"}`);
}

process.exit(result.ok ? 0 : 1);