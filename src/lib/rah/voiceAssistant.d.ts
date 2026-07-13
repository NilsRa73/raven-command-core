export type VoiceState =
  | "idle" | "requesting_mic" | "listening" | "transcribing"
  | "thinking" | "speaking" | "paused" | "error";

export const VOICE_STATES: VoiceState[];
export const NO_AUTO_START: { requiresExplicitUserGesture: true };
export const NO_SILENT_PERSIST: { summarySaveRequiresExplicitConfirm: true };
export const WAKE_PHRASES: string[];
export const TTS_INTERRUPT_EVENTS: string[];
export const VOICE_ERROR_HINTS: Record<string, string>;

export function canTransition(from: VoiceState, to: VoiceState): boolean;
export function nextState(from: VoiceState, to: VoiceState): VoiceState;

export interface WakeParseResult {
  matched: boolean;
  phrase: string | null;
  command: string;
}
export function parseWakePhrase(raw: string, opts?: { directDictation?: boolean }): WakeParseResult | null;

export function shouldInterruptTts(state: VoiceState, event: string): boolean;

export interface VoiceCommandPayloadOpts {
  transcript: string;
  project?: { id?: string; name?: string; goals?: string } | null;
  memoryTextItems?: string[];
  projectMemoryBlock?: string;
  agents?: string[];
  mode?: "fast" | "expert" | "debate" | "deep_project";
  approvalMode?: "advisory" | "ask_every" | "trusted_low_risk";
}
export function buildVoiceCommandPayload(opts: VoiceCommandPayloadOpts): {
  prompt: string;
  agents: string[];
  mode: string;
  fileIds: string[];
  projectId?: string;
  inputType: "voice";
  status: "queued" | "awaiting_approval";
  resultSummary: string;
  pending: { context: { projectName?: string; projectGoals?: string; memory: string[]; projectMemoryBlock: string } };
};

export interface VoiceSessionTurn {
  role: "user" | "assistant";
  text: string;
  ts: number;
}
export interface VoiceSession { turns: VoiceSessionTurn[] }
export interface SummarySuggestion {
  _suggestion: true;
  draft: {
    projectId: string | null;
    title: string;
    content: string;
    type: string;
    tags: string[];
    source: string;
    archived: boolean;
    pinned: boolean;
  };
}
export function buildSummarySuggestion(session: VoiceSession, opts?: { projectId?: string | null }): SummarySuggestion | null;

export interface VoiceDiagnostics {
  sttSupported: boolean;
  ttsSupported: boolean;
  micPermission: string;
  inputLang: string | null;
  outputLang: string | null;
  engine: string;
  bridgeOnline: boolean;
  wakeWordBackground: false;
  honestCapabilityStatement: string;
}
export function buildVoiceDiagnostics(input: Partial<VoiceDiagnostics>): VoiceDiagnostics;

export function explainVoiceError(code: string | null | undefined): string;