export function shouldConfirmDiscard(input?: {
  dirty?: boolean;
  isDraftUnsaved?: boolean;
  targetId?: string | null;
  currentId?: string | null;
}): boolean;