import fs from "node:fs";
import path from "node:path";
import { assertContained, isReadableTextFile } from "./paths.js";
import { READ_TEXT_MAX_BYTES } from "./protocol.js";

export function listFolder(target, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw new Error("Not a directory");
  const items = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 5000).map((d) => {
    let size = null, mtime = null;
    try { const s = fs.statSync(path.join(abs, d.name)); size = s.size; mtime = s.mtimeMs; } catch { /* ignore */ }
    return { name: d.name, path: path.join(abs, d.name), type: d.isDirectory() ? "dir" : "file", size, mtime };
  });
  return { path: abs, items };
}

export function searchFiles({ root, query, extensions, limit = 200, maxDepth = 6 }, approvedRoots) {
  const abs = assertContained(root, approvedRoots);
  const results = [];
  const q = (query || "").toLowerCase();
  const exts = Array.isArray(extensions) ? extensions.map((e) => e.toLowerCase()) : null;
  const stack = [{ dir: abs, depth: 0 }];
  while (stack.length && results.length < limit) {
    const { dir, depth } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of entries) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: p, depth: depth + 1 });
        continue;
      }
      const name = d.name.toLowerCase();
      const ext = path.extname(name);
      if (q && !name.includes(q)) continue;
      if (exts && !exts.includes(ext)) continue;
      let st = null;
      try { st = fs.statSync(p); } catch { /* skip */ }
      results.push({ name: d.name, path: p, size: st?.size ?? null, mtime: st?.mtimeMs ?? null });
      if (results.length >= limit) break;
    }
  }
  return { results, truncated: results.length >= limit };
}

export function readTextFile(target, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  if (!isReadableTextFile(abs)) throw new Error("Extension not in read-text allowlist");
  const st = fs.statSync(abs);
  if (st.size > READ_TEXT_MAX_BYTES) throw new Error("File too large");
  const buf = fs.readFileSync(abs);
  return { path: abs, size: st.size, mtime: st.mtimeMs, text: buf.toString("utf8") };
}

export function createFolder(target, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  fs.mkdirSync(abs, { recursive: false });
  return { path: abs, created: true };
}

export function renameEntry(fromP, toP, approvedRoots) {
  const from = assertContained(fromP, approvedRoots);
  const to = assertContained(toP, approvedRoots);
  if (fs.existsSync(to)) throw new Error("Destination already exists");
  fs.renameSync(from, to);
  return { from, to };
}

export function copyEntry(fromP, toP, approvedRoots) {
  const from = assertContained(fromP, approvedRoots);
  const to = assertContained(toP, approvedRoots);
  if (fs.existsSync(to)) throw new Error("Destination already exists");
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  return { from, to };
}

export function moveEntry(fromP, toP, approvedRoots) {
  const from = assertContained(fromP, approvedRoots);
  const to = assertContained(toP, approvedRoots);
  if (fs.existsSync(to)) throw new Error("Destination already exists");
  try { fs.renameSync(from, to); }
  catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
  return { from, to };
}

// Recycle-bin delete — Windows only. On non-Windows, we refuse to avoid permanent delete.
export async function recycleEntry(target, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  if (process.platform !== "win32") {
    throw new Error("Recycle Bin delete is only available on Windows");
  }
  // Uses Microsoft.VisualBasic FileIO to send to Recycle Bin.
  const { spawn } = await import("node:child_process");
  const isDir = fs.statSync(abs).isDirectory();
  const psFn = isDir ? "DeleteDirectory" : "DeleteFile";
  const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${psFn}('${abs.replace(/'/g, "''")}','OnlyErrorDialogs','SendToRecycleBin')`;
  return await new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let err = "";
    ps.stderr.on("data", (d) => { err += d.toString(); });
    ps.on("close", (code) => code === 0 ? resolve({ path: abs, recycled: true }) : reject(new Error("PowerShell exit " + code + ": " + err.slice(0, 300))));
  });
}
