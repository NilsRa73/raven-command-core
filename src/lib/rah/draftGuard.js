// Pure decision helper for the Automations unsaved-draft guard.
// Returns true when the caller MUST prompt the user before performing the
// destructive action (switching, importing, creating a new draft, unloading).
//
// Rules:
//   - Clean state (no dirty edits, no unsaved in-memory draft) => never prompt.
//   - Selecting the same workflow that is already current => never prompt.
//   - Dirty saved workflow or an unsaved in-memory draft => prompt.
export function shouldConfirmDiscard({
  dirty = false,
  isDraftUnsaved = false,
  targetId = null,
  currentId = null,
} = {}) {
  if (!dirty && !isDraftUnsaved) return false;
  if (targetId != null && currentId != null && targetId === currentId) return false;
  return true;
}