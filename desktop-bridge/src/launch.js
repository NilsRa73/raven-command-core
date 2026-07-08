import { assertContained } from "./paths.js";
import { assertSafeUrl } from "./urlCheck.js";

export async function openInExplorer(target, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  const { spawn } = await import("node:child_process");
  if (process.platform === "win32") {
    spawn("explorer.exe", [abs], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [abs], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [abs], { detached: true, stdio: "ignore" }).unref();
  }
  return { path: abs, launched: true };
}

export async function openUrl(url) {
  const safe = assertSafeUrl(url);
  const { spawn } = await import("node:child_process");
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", safe], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [safe], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [safe], { detached: true, stdio: "ignore" }).unref();
  }
  return { url: safe, launched: true };
}
