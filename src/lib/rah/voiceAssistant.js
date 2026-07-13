// Pure helpers for the Raven Voice Assistant (Sprint 1).
//
// Deterministic, DOM-free logic so it can be exercised by fast Node tests.
// Privacy contract:
//   * No auto-start: caller MUST provide an explicit user gesture before
//     transitioning out of "idle".
//   * No silent persistence: `buildSummarySuggestion` returns a draft the
//     UI must confirm before saving to Project Memory.
//   * No transcript logging beyond the normal command pipeline: transcripts
//     handed to `buildVoiceCommandPayload` become a regular CommandRecord.

export const VOICE_STATES = [
  "idle",
  "requesting_mic",
  "listening",
  "transcribing",
  "thinking",
  "speaking",
  "paused",
  "error",
];

/** Allowed transitions. Anything not listed is rejected. */
const TRANSITIONS = {
  idle: ["requesting_mic", "error"],
  requesting_mic: ["listening", "error", "idle"],
  listening: ["transcribing", "paused", "thinking", "idle", "error"],
  transcribing: ["listening", "thinking", "idle", "error"],
  thinking: ["speaking", "listening", "idle", "error"],
  speaking: ["listening", "idle", "paused", "error"],
  paused: ["listening", "idle", "error"],
  error: ["idle", "requesting_mic"],
};

export function canTransition(from, to) {
  if (!VOICE_STATES.includes(from) || !VOICE_STATES.includes(to)) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextState(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`voice: illegal transition ${from} -> ${to}`);
  }
  return to;
}

/** Contract enforced by the UI: user gesture required before leaving idle. */
export const NO_AUTO_START = { requiresExplicitUserGesture: true };
export const NO_SILENT_PERSIST = { summarySaveRequiresExplicitConfirm: true };

// ─── Wake phrase parsing ───────────────────────────────────────────────

export const WAKE_PHRASES = ["hey raven", "raven"];

function stripLeadingPunctuation(s) {
  return s.replace(/^[\s,.;:!?—-]+/, "");
}

/**
 * Look for "raven" / "hey raven" at the start of a fresh utterance.
 * Returns null when no wake phrase is present (and directDictation is off).
 * When directDictation is true every non-empty utterance is treated as a
 * command with no wake gate.
 */
export function parseWakePhrase(raw, opts = {}) {
  const directDictation = !!opts.directDictation;
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (directDictation) return { matched: true, phrase: null, command: text };
  const lower = text.toLowerCase();
  for (const phrase of WAKE_PHRASES) {
    if (lower === phrase) return { matched: true, phrase, command: "" };
    if (lower.startsWith(phrase + " ") || lower.startsWith(phrase + ",")) {
      const rest = stripLeadingPunctuation(text.slice(phrase.length));
      return { matched: true, phrase, command: rest };
    }
  }
  return null;
}

// ─── TTS interrupt contract ────────────────────────────────────────────

export const TTS_INTERRUPT_EVENTS = ["user-speech-start", "user-stop", "user-cancel"];

/**
 * Given the current voice state and an incoming event, decide whether
 * speechSynthesis.cancel() must be invoked immediately.
 */
export function shouldInterruptTts(state, event) {
  if (!TTS_INTERRUPT_EVENTS.includes(event)) return false;
  // Interrupt whenever the assistant is or might be producing audio.
  return state === "speaking" || state === "thinking";
}

// ─── Transcript → command payload ──────────────────────────────────────

/**
 * Build the exact CommandRecord input the existing pipeline expects.
 * Reused by the Voice Assistant so it never invents a parallel backend.
 */
export function buildVoiceCommandPayload(opts) {
  const {
    transcript,
    project = null,
    memoryTextItems = [],
    projectMemoryBlock = "",
    agents = ["brain"],
    mode = "fast",
    approvalMode = "ask_every",
  } = opts ?? {};
  const prompt = String(transcript ?? "").trim();
  if (!prompt) throw new Error("voice: empty transcript");
  const status = approvalMode === "advisory" ? "queued" : "awaiting_approval";
  return {
    prompt,
    agents: Array.isArray(agents) && agents.length ? agents : ["brain"],
    mode,
    fileIds: [],
    projectId: project?.id,
    inputType: "voice",
    status,
    resultSummary:
      status === "awaiting_approval"
        ? "Queued for approval before running."
        : "Running…",
    pending: {
      context: {
        projectName: project?.name,
        projectGoals: project?.goals,
        memory: memoryTextItems.slice(),
        projectMemoryBlock: projectMemoryBlock || "",
      },
    },
  };
}

// ─── Session summary suggestion (no silent save) ───────────────────────

export function buildSummarySuggestion(session, opts = {}) {
  const turns = Array.isArray(session?.turns) ? session.turns : [];
  if (!turns.length) return null;
  const projectId = opts.projectId ?? null;
  const firstUser = turns.find((t) => t.role === "user")?.text ?? "";
  const lastReply = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";
  const title = ("Voice session: " + firstUser.slice(0, 60)).trim();
  const bullets = turns
    .filter((t) => t.role === "user")
    .slice(0, 5)
    .map((t, i) => `${i + 1}. ${t.text.slice(0, 140)}`)
    .join("\n");
  const content =
    `Voice session summary (${turns.length} turn${turns.length === 1 ? "" : "s"}).\n\n` +
    `Key user prompts:\n${bullets}\n\n` +
    (lastReply ? `Final assistant reply:\n${lastReply.slice(0, 400)}` : "");
  return {
    _suggestion: true,
    draft: {
      projectId,
      title,
      content,
      type: "daily_log",
      tags: ["voice"],
      source: "voice-session",
      archived: false,
      pinned: false,
    },
  };
}

// ─── Honest diagnostics ────────────────────────────────────────────────

export function buildVoiceDiagnostics(input) {
  const d = input ?? {};
  return {
    sttSupported: !!d.sttSupported,
    ttsSupported: !!d.ttsSupported,
    micPermission: d.micPermission ?? "unknown",
    inputLang: d.inputLang ?? null,
    outputLang: d.outputLang ?? null,
    engine: d.engine ?? "unknown",
    bridgeOnline: !!d.bridgeOnline,
    wakeWordBackground: false, // we NEVER listen outside an active browser session
    honestCapabilityStatement:
      "Wake phrase only inside an active browser session; no background listening.",
  };
}

// ─── Error remediation guidance ────────────────────────────────────────

export const VOICE_ERROR_HINTS = {
  "not-allowed":
    "Microphone permission was denied. Enable it in the browser site settings, then click Start again.",
  "service-not-allowed":
    "The browser blocked speech recognition. Enable it in site settings and retry.",
  "no-speech":
    "No speech detected. Speak closer to the microphone or check the mic input level.",
  network:
    "Speech recognition network error. The browser could not reach its transcription service — try again in a moment.",
  aborted: "Session ended.",
  unsupported:
    "This browser does not support SpeechRecognition. Use Chromium-based browsers (Chrome/Edge) for voice input.",
  audio_capture:
    "No microphone was found. Plug one in or select a different input device, then click Start again.",
};

export function explainVoiceError(code) {
  if (!code) return "";
  return VOICE_ERROR_HINTS[code] ?? `Voice error: ${code}`;
}