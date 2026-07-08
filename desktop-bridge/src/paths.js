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

// Walk up the path until we find an ancestor that actually exists on disk,
// so we can realpath through any intermediate symlink and check containment
// against the resolved location, not the lexical one.
function nearestExistingAncestor(absPath) {
  let cur = absPath;
  while (true) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return cur; // filesystem root
    cur = parent;
  }
}

export function assertContained(target, approvedRoots) {
  if (typeof target !== "string" || target.length === 0) {
    throw new PathContainmentError("Missing path");
  }
  if (target.includes("\u0000")) throw new PathContainmentError("Null byte in path");

  const abs = path.resolve(target);
  // Resolve symlinks on the deepest existing ancestor, then re-append the
  // remaining suffix. This defeats symlink-in-the-middle escapes for
  // not-yet-existing targets (e.g. new folder under a symlinked parent).
  const anchor = nearestExistingAncestor(abs);
  const anchorReal = realOrLexical(anchor);
  const suffix = path.relative(anchor, abs); // "" if abs already exists
  const resolved = suffix ? path.join(anchorReal, suffix) : anchorReal;

  for (const rootRaw of approvedRoots) {
    const root = realOrLexical(rootRaw);
    const rel = path.relative(root, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return resolved;
    }
  }
  throw new PathContainmentError("Path is not inside any approved root");
}

export function isReadableTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  return READ_TEXT_EXTENSIONS.includes(ext);
}
