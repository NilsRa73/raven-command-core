import path from "node:path";
import fs from "node:fs";
import { READ_TEXT_EXTENSIONS } from "./protocol.js";

/**
 * Return the resolved absolute path IF it is contained inside one of the approved roots.
 * Throws PathContainmentError otherwise. Uses realpath when the target exists to defeat
 * symlink escapes; for non-existent targets (e.g. new folder), the parent is realpath-ed.
 */
export class PathContainmentError extends Error {
  constructor(msg) { super(msg); this.code = "PATH_NOT_ALLOWED"; }
}

function realOrLexical(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

export function assertContained(target, approvedRoots) {
  if (typeof target !== "string" || target.length === 0) {
    throw new PathContainmentError("Missing path");
  }
  if (target.includes("\u0000")) throw new PathContainmentError("Null byte in path");

  // Resolve; if the target doesn't exist yet, resolve its parent for real path.
  let resolved;
  if (fs.existsSync(target)) {
    resolved = realOrLexical(target);
  } else {
    const parent = path.dirname(path.resolve(target));
    const parentReal = fs.existsSync(parent) ? realOrLexical(parent) : path.resolve(parent);
    resolved = path.join(parentReal, path.basename(target));
  }

  for (const rootRaw of approvedRoots) {
    const root = realOrLexical(rootRaw);
    const rel = path.relative(root, resolved);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      return resolved;
    }
    if (resolved === root) return resolved;
  }
  throw new PathContainmentError("Path is not inside any approved root");
}

export function isReadableTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  return READ_TEXT_EXTENSIONS.includes(ext);
}
