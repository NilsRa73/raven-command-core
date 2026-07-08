import { assertContained } from "./paths.js";
import { assertSafeUrl } from "./urlCheck.js";

// Never launch through a shell interpreter. Every spawn here uses argv
// (no shell:true, no "cmd.exe /c start"), so validated arguments cannot
// be re-parsed by cmd.exe or /bin/sh.

export async function openInExplorer(target, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  const { spawn } = await import("node:child_process");
  if (process.platform === "win32") {
    spawn("explorer.exe", [abs], { detached: true, stdio: "ignore", shell: false }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["--", abs], { detached: true, stdio: "ignore", shell: false }).unref();
  } else {
    spawn("xdg-open", [abs], { detached: true, stdio: "ignore", shell: false }).unref();
  }
  return { path: abs, launched: true };
}

export async function openUrl(url) {
  const safe = assertSafeUrl(url);
  const { spawn } = await import("node:child_process");
  if (process.platform === "win32") {
    // Windows: launch the validated https:// URL directly via Explorer,
    // NOT "cmd.exe /c start" (which reparses arguments through the shell).
    spawn("explorer.exe", [safe], { detached: true, stdio: "ignore", shell: false, windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["--", safe], { detached: true, stdio: "ignore", shell: false }).unref();
  } else {
    spawn("xdg-open", [safe], { detached: true, stdio: "ignore", shell: false }).unref();
  }
  return { url: safe, launched: true };
}
