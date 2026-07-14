import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldConfirmDiscard } from "../../src/lib/rah/draftGuard.js";

test("clean state never prompts", () => {
  assert.equal(shouldConfirmDiscard({}), false);
  assert.equal(shouldConfirmDiscard({ dirty: false, isDraftUnsaved: false, targetId: "a", currentId: "b" }), false);
});

test("dirty saved workflow prompts on switching selection", () => {
  assert.equal(shouldConfirmDiscard({ dirty: true, currentId: "a", targetId: "b" }), true);
});

test("dirty saved workflow prompts on import (no target)", () => {
  assert.equal(shouldConfirmDiscard({ dirty: true, currentId: "a" }), true);
});

test("dirty saved workflow prompts on create new draft", () => {
  assert.equal(shouldConfirmDiscard({ dirty: true, currentId: "a", targetId: null }), true);
});

test("unsaved in-memory draft prompts on any navigation", () => {
  assert.equal(shouldConfirmDiscard({ isDraftUnsaved: true, currentId: null, targetId: "a" }), true);
  assert.equal(shouldConfirmDiscard({ isDraftUnsaved: true }), true);
});

test("selecting the same currently-selected workflow never prompts even when dirty", () => {
  assert.equal(shouldConfirmDiscard({ dirty: true, currentId: "a", targetId: "a" }), false);
});

test("unload-style call (no targetId) with clean state does not prompt", () => {
  assert.equal(shouldConfirmDiscard({ dirty: false, isDraftUnsaved: false }), false);
});