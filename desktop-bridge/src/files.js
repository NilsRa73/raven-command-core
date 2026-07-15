import fs from "node:fs";
import path from "node:path";
import { assertContained, isReadableTextFile } from "./paths.js";
import { READ_TEXT_MAX_BYTES, WRITE_TEXT_MAX_BYTES, BLOCKED_TEXT_BASENAMES } from "./protocol.js";

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

// ---- v0.2.2 text-write safety ----------------------------------------
// Enforce: text-file extension allowlist, size cap, no NUL bytes, no
// blocked basenames (credentials/system files), no hidden dotfiles.
// Callers must have already assertContained() the path.
function assertWriteSafe(abs, content) {
  if (typeof content !== "string") throw new Error("content must be a string");
  if (content.includes("\u0000")) throw new Error("Null byte in content is not allowed");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > WRITE_TEXT_MAX_BYTES) throw new Error(`Content too large (${bytes} bytes > ${WRITE_TEXT_MAX_BYTES})`);
  const base = path.basename(abs).toLowerCase();
  if (base.startsWith(".") ) throw new Error("Hidden dotfiles are not allowed");
  if (BLOCKED_TEXT_BASENAMES.includes(base)) throw new Error("Basename is blocked (credential/system file)");
  if (!isReadableTextFile(abs)) throw new Error("Extension not in text-file allowlist");
  return bytes;
}

/**
 * Write a text file. `mode`:
 *   - "createOnly": fail if target exists (no accidental overwrite)
 *   - "overwrite" : replace existing file, but first drop a sidecar
 *                   backup at <target>.rah-backup-<ts> so a bad write
 *                   can be recovered by the user.
 * Parent directory must already exist inside an approved root.
 */
export function writeTextFile(target, content, approvedRoots, { mode = "createOnly" } = {}) {
  const abs = assertContained(target, approvedRoots);
  const bytes = assertWriteSafe(abs, content);
  const parent = path.dirname(abs);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("Parent directory does not exist");
  }
  const exists = fs.existsSync(abs);
  let backupPath = null;
  if (exists) {
    if (mode !== "overwrite") throw new Error("File exists and mode is not 'overwrite'");
    // Sanity: refuse to overwrite a non-file (dir/symlink target).
    const st = fs.lstatSync(abs);
    if (!st.isFile()) throw new Error("Refusing to overwrite non-regular file");
    backupPath = abs + ".rah-backup-" + Date.now();
    fs.copyFileSync(abs, backupPath);
  }
  // Atomic-ish write: write to temp then rename.
  const tmp = abs + ".rah-tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, content, { encoding: "utf8" });
  fs.renameSync(tmp, abs);
  return { path: abs, bytes, mode, overwrote: exists, backupPath };
}

/**
 * Append UTF-8 text to an existing text file inside an approved root.
 * The file must exist; we do not create-on-append (that's writeText's job).
 * Same safety checks as writeText.
 */
export function appendTextFile(target, content, approvedRoots) {
  const abs = assertContained(target, approvedRoots);
  const bytes = assertWriteSafe(abs, content);
  if (!fs.existsSync(abs)) throw new Error("File does not exist (use files.writeText to create)");
  const st = fs.lstatSync(abs);
  if (!st.isFile()) throw new Error("Target is not a regular file");
  // Also cap combined size to prevent unbounded growth.
  if (st.size + bytes > WRITE_TEXT_MAX_BYTES * 4) throw new Error("File would exceed maximum size");
  fs.appendFileSync(abs, content, { encoding: "utf8" });
  const after = fs.statSync(abs);
  return { path: abs, appendedBytes: bytes, totalBytes: after.size };
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
