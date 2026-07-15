import { test } from "node:test";
import assert from "node:assert/strict";

function validateWorkspacePath(workspace, approvedRoots) {
  if (!workspace || typeof workspace !== "string") return { ok: false, reason: "Workspace path is empty" };
  if (workspace.includes("\u0000")) return { ok: false, reason: "Null byte in path" };
  const norm = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const rootRaw of approvedRoots) {
    const root = rootRaw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!root) continue;
    if (norm === root) return { ok: true };
    if (norm.toLowerCase().startsWith(root.toLowerCase() + "/")) return { ok: true };
  }
  return { ok: false, reason: "Workspace is not inside any approved root" };
}
test("empty rejected", () => assert.equal(validateWorkspacePath("", ["C:/x"]).ok, false));
test("null byte rejected", () => assert.equal(validateWorkspacePath("C:/x\u0000y", ["C:/x"]).ok, false));
test("exact match ok", () => assert.equal(validateWorkspacePath("C:/A", ["C:/A"]).ok, true));
test("child ok", () => assert.equal(validateWorkspacePath("C:/A/B", ["C:/A"]).ok, true));
test("sibling rejected", () => assert.equal(validateWorkspacePath("C:/AX", ["C:/A"]).ok, false));
test("outside root rejected", () => assert.equal(validateWorkspacePath("D:/Z", ["C:/A"]).ok, false));
test("backslash normalized", () => assert.equal(validateWorkspacePath("C:\\A\\B", ["C:\\A"]).ok, true));
test("case-insensitive", () => assert.equal(validateWorkspacePath("c:/a/b", ["C:/A"]).ok, true));

function noteTargetPath(workspace, filename = "PROJECT_STATUS.md") {
  const sep = workspace.includes("\\") && !workspace.includes("/") ? "\\" : "/";
  return workspace.replace(/[\\/]+$/, "") + sep + filename;
}
test("unix join", () => assert.equal(noteTargetPath("/x/y"), "/x/y/PROJECT_STATUS.md"));
test("windows join", () => assert.equal(noteTargetPath("C:\\U\\D"), "C:\\U\\D\\PROJECT_STATUS.md"));
test("strip trailing sep", () => assert.equal(noteTargetPath("/x/y/"), "/x/y/PROJECT_STATUS.md"));

function nextStatus(current, event) {
  if (event === "block" || event === "reject") return "blocked";
  if (event === "approve") return current === "awaiting_approval" ? "running" : current;
  if (event === "wrote") return "testing";
  if (event === "verified") return "complete";
  return current;
}
test("approve moves awaiting→running", () => assert.equal(nextStatus("awaiting_approval", "approve"), "running"));
test("approve no-op elsewhere", () => assert.equal(nextStatus("running", "approve"), "running"));
test("reject/block→blocked", () => {
  assert.equal(nextStatus("running", "reject"), "blocked");
  assert.equal(nextStatus("testing", "block"), "blocked");
});
test("wrote→testing, verified→complete", () => {
  assert.equal(nextStatus("running", "wrote"), "testing");
  assert.equal(nextStatus("testing", "verified"), "complete");
});