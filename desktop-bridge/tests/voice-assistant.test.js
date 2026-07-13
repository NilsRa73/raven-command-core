import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VOICE_STATES,
  NO_AUTO_START,
  NO_SILENT_PERSIST,
  WAKE_PHRASES,
  canTransition,
  nextState,
  parseWakePhrase,
  shouldInterruptTts,
  buildVoiceCommandPayload,
  buildSummarySuggestion,
  buildVoiceDiagnostics,
  explainVoiceError,
  VOICE_ERROR_HINTS,
} from "../../src/lib/rah/voiceAssistant.js";

test("state machine covers all 8 required states", () => {
  for (const s of [
    "idle", "requesting_mic", "listening", "transcribing",
    "thinking", "speaking", "paused", "error",
  ]) assert.ok(VOICE_STATES.includes(s), `missing ${s}`);
});

test("transitions: no auto-start out of idle without explicit gesture path", () => {
  // idle -> listening is NOT allowed directly; must go through requesting_mic.
  assert.equal(canTransition("idle", "listening"), false);
  assert.equal(canTransition("idle", "requesting_mic"), true);
  assert.equal(canTransition("requesting_mic", "listening"), true);
  assert.equal(NO_AUTO_START.requiresExplicitUserGesture, true);
});

test("transitions: listening can go to thinking/paused/idle but not directly to speaking", () => {
  assert.equal(canTransition("listening", "thinking"), true);
  assert.equal(canTransition("listening", "paused"), true);
  assert.equal(canTransition("listening", "idle"), true);
  assert.equal(canTransition("listening", "speaking"), false);
});

test("nextState throws on illegal transition", () => {
  assert.throws(() => nextState("idle", "speaking"));
  assert.equal(nextState("thinking", "speaking"), "speaking");
});

test("wake phrase: 'hey raven, do X' matches and strips phrase+punct", () => {
  const r = parseWakePhrase("Hey Raven, summarise the roadmap.");
  assert.ok(r?.matched);
  assert.equal(r.phrase, "hey raven");
  assert.equal(r.command, "summarise the roadmap.");
});

test("wake phrase: bare 'Raven what is the weather' matches with 'raven'", () => {
  const r = parseWakePhrase("Raven what is the weather");
  assert.ok(r?.matched);
  assert.equal(r.phrase, "raven");
  assert.equal(r.command, "what is the weather");
});

test("wake phrase: unrelated utterance returns null when gate is on", () => {
  assert.equal(parseWakePhrase("open the pod bay doors"), null);
});

test("wake phrase: direct dictation mode bypasses the gate", () => {
  const r = parseWakePhrase("open the pod bay doors", { directDictation: true });
  assert.ok(r?.matched);
  assert.equal(r.phrase, null);
  assert.equal(r.command, "open the pod bay doors");
});

test("wake phrase: empty input returns null even in direct dictation", () => {
  assert.equal(parseWakePhrase("", { directDictation: true }), null);
  assert.equal(parseWakePhrase("   "), null);
});

test("wake phrases list contains exactly 'raven' and 'hey raven'", () => {
  assert.deepEqual([...WAKE_PHRASES].sort(), ["hey raven", "raven"]);
});

test("TTS interrupt fires on user-speech-start while speaking", () => {
  assert.equal(shouldInterruptTts("speaking", "user-speech-start"), true);
  assert.equal(shouldInterruptTts("thinking", "user-stop"), true);
  assert.equal(shouldInterruptTts("listening", "user-stop"), false);
  assert.equal(shouldInterruptTts("speaking", "some-unrelated-event"), false);
});

test("buildVoiceCommandPayload: awaiting_approval + inputType=voice + project + memory", () => {
  const p = buildVoiceCommandPayload({
    transcript: "  do the thing  ",
    project: { id: "p1", name: "RAH OS", goals: "ship" },
    memoryTextItems: ["fact-a"],
    projectMemoryBlock: "=== MEM ===",
    agents: ["brain", "coder"],
    mode: "expert",
    approvalMode: "ask_every",
  });
  assert.equal(p.prompt, "do the thing");
  assert.equal(p.inputType, "voice");
  assert.equal(p.status, "awaiting_approval");
  assert.equal(p.projectId, "p1");
  assert.deepEqual(p.agents, ["brain", "coder"]);
  assert.equal(p.mode, "expert");
  assert.equal(p.pending.context.projectName, "RAH OS");
  assert.equal(p.pending.context.projectMemoryBlock, "=== MEM ===");
  assert.deepEqual(p.pending.context.memory, ["fact-a"]);
});

test("buildVoiceCommandPayload: advisory mode skips approval", () => {
  const p = buildVoiceCommandPayload({ transcript: "hi", approvalMode: "advisory" });
  assert.equal(p.status, "queued");
});

test("buildVoiceCommandPayload: empty transcript throws", () => {
  assert.throws(() => buildVoiceCommandPayload({ transcript: "   " }));
});

test("summary suggestion never saves silently — returns _suggestion draft", () => {
  const s = buildSummarySuggestion({
    turns: [
      { role: "user", text: "plan the sprint", ts: 1 },
      { role: "assistant", text: "here is a plan", ts: 2 },
    ],
  }, { projectId: "p1" });
  assert.ok(s?._suggestion);
  assert.equal(s.draft.projectId, "p1");
  assert.equal(s.draft.type, "daily_log");
  assert.ok(s.draft.title.startsWith("Voice session:"));
  assert.equal(NO_SILENT_PERSIST.summarySaveRequiresExplicitConfirm, true);
});

test("summary suggestion: empty session returns null", () => {
  assert.equal(buildSummarySuggestion({ turns: [] }), null);
});

test("diagnostics are honest: never claim background wake-word listening", () => {
  const d = buildVoiceDiagnostics({
    sttSupported: true, ttsSupported: true, micPermission: "granted",
    inputLang: "en-US", outputLang: "en-US", engine: "lmstudio", bridgeOnline: true,
  });
  assert.equal(d.wakeWordBackground, false);
  assert.match(d.honestCapabilityStatement, /no background listening/i);
  assert.equal(d.sttSupported, true);
  assert.equal(d.engine, "lmstudio");
});

test("explainVoiceError maps known codes; unknown falls back to raw", () => {
  assert.match(explainVoiceError("not-allowed"), /permission was denied/i);
  assert.match(explainVoiceError("no-speech"), /no speech/i);
  assert.equal(explainVoiceError(""), "");
  assert.match(explainVoiceError("weird-code"), /weird-code/);
  assert.ok(VOICE_ERROR_HINTS.network);
});