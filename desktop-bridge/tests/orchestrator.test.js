import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreSpecialists, pickSpecialists, runWithConcurrency,
  specialistRuntimeLine, privacyLabel, buildSpecialistUserPrompt,
  buildSynthesisPrompt, buildTeamSummarySuggestion, makeEventLogger,
  isolateFailures, ORCHESTRATION_INVARIANTS, MAX_CONCURRENT, TEAM_MODE_LABEL,
} from "../../src/lib/rah/orchestrator.js";

test("scoreSpecialists ranks coder highest for a code-flavored prompt", () => {
  const s = scoreSpecialists("Please debug this TypeScript function; it throws an error.");
  assert.equal(s[0].id, "coder");
  assert.ok(s[0].score > 0);
});

test("scoreSpecialists returns zeros for a neutral prompt", () => {
  const s = scoreSpecialists("hello there");
  assert.ok(s.every((x) => x.score === 0));
});

test("pickSpecialists team_review returns 2..3 specialists and never brain", () => {
  const p = pickSpecialists("write a react component and cite market data", "team_review");
  assert.ok(p.length >= 2 && p.length <= 3);
  assert.ok(!p.includes("brain"));
});

test("pickSpecialists full_council returns up to 5 and backfills defaults on empty prompt", () => {
  const p = pickSpecialists("hi", "full_council");
  assert.ok(p.length >= 3 && p.length <= 5);
  assert.ok(!p.includes("brain"));
});

test("pickSpecialists manual honors caller list, strips brain, caps at 5", () => {
  const p = pickSpecialists("anything", "manual", {
    manualSelection: ["brain", "coder", "vision", "research", "designer", "engineer", "earth"],
  });
  assert.deepEqual(p, ["coder", "vision", "research", "designer", "engineer"]);
});

test("runWithConcurrency respects MAX_CONCURRENT bound", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  const results = await runWithConcurrency(items, async () => {
    inFlight++;
    if (inFlight > peak) peak = inFlight;
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return "ok";
  });
  assert.equal(results.length, 12);
  assert.ok(peak <= MAX_CONCURRENT, `peak ${peak} exceeded ${MAX_CONCURRENT}`);
  assert.equal(results.peakInFlight, peak);
  assert.ok(results.every((r) => r.status === "fulfilled"));
});

test("runWithConcurrency isolates failures — one bad task doesn't fail the run", async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await runWithConcurrency(items, async (n) => {
    if (n === 3) throw new Error("boom");
    return n * 2;
  });
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 4);
  const iso = isolateFailures(results);
  assert.equal(iso[2].failed, true);
  assert.equal(iso[2].reason, "boom");
});

test("runWithConcurrency cancels pending tasks when signal is aborted", async () => {
  const ac = new AbortController();
  const items = Array.from({ length: 10 }, (_, i) => i);
  let started = 0;
  const p = runWithConcurrency(items, async () => {
    started++;
    await new Promise((r) => setTimeout(r, 30));
    return "ok";
  }, { signal: ac.signal, concurrency: 2 });
  setTimeout(() => ac.abort(), 15);
  const results = await p;
  const cancelled = results.filter((r) => r.status === "cancelled").length;
  assert.ok(cancelled > 0, "expected some cancelled tasks after abort");
  assert.ok(started < items.length, "some tasks should never have started");
});

test("specialistRuntimeLine is deterministic app-generated identity", () => {
  const line = specialistRuntimeLine({
    agentName: "RAH Coder", provider: "LM Studio", model: "qwen2.5",
    engine: "lmstudio", transport: "bridge", latencyMs: 812,
  });
  assert.match(line, /RAH Coder/);
  assert.match(line, /LM Studio/);
  assert.match(line, /qwen2\.5/);
  assert.match(line, /local/);
  assert.match(line, /via Bridge/);
  assert.match(line, /812ms/);
});

test("privacyLabel: all local => LOCAL", () => {
  assert.equal(privacyLabel([{ engine: "lmstudio" }, { engine: "lmstudio" }]), "LOCAL");
});
test("privacyLabel: mixed local+cloud => MIXED", () => {
  assert.equal(privacyLabel([{ engine: "lmstudio" }, { engine: "cloud" }]), "MIXED");
});
test("privacyLabel: all cloud => CLOUD", () => {
  assert.equal(privacyLabel([{ engine: "cloud" }, { engine: "cloud" }]), "CLOUD");
});

test("buildSpecialistUserPrompt includes context and instructs no synthesis", () => {
  const p = buildSpecialistUserPrompt("Do X", {
    projectName: "Raven", projectGoals: "Ship v1", projectMemoryBlock: "MEMORY_HEADER",
  });
  assert.match(p, /Active project: Raven/);
  assert.match(p, /Project goals: Ship v1/);
  assert.match(p, /MEMORY_HEADER/);
  assert.match(p, /Do X/);
  assert.match(p, /Master Brain will do that/);
});

test("buildSynthesisPrompt separates completed / failed / cancelled and forbids forging", () => {
  const p = buildSynthesisPrompt("Plan X", [
    { agentId: "coder", agentName: "RAH Coder", state: "done", text: "code result" },
    { agentId: "vision", agentName: "RAH Vision", state: "failed", error: "no image" },
    { agentId: "earth", agentName: "RAH Earth", state: "cancelled" },
  ]);
  assert.match(p, /## Consensus/);
  assert.match(p, /## Disagreements/);
  assert.match(p, /## Risks/);
  assert.match(p, /## Recommended next action/);
  assert.match(p, /RAH Coder — completed/);
  assert.match(p, /RAH Vision: no image/);
  assert.match(p, /RAH Earth/);
  assert.match(p, /do NOT pretend/);
});

test("buildTeamSummarySuggestion returns explicit-confirm suggestion, never persists silently", () => {
  const sug = buildTeamSummarySuggestion({
    userPrompt: "Plan launch",
    taskStates: [
      { agentId: "coder", agentName: "RAH Coder", state: "done", text: "..." },
      { agentId: "vision", agentName: "RAH Vision", state: "failed", error: "x" },
    ],
    synthesis: "Consensus: ship",
    projectId: "p1",
  });
  assert.ok(sug);
  assert.equal(sug._suggestion, true);
  assert.equal(sug.draft.projectId, "p1");
  assert.match(sug.draft.title, /Team run:/);
  assert.match(sug.draft.content, /RAH Coder/);
  assert.ok(!sug.draft.content.includes("RAH Vision"));
});

test("makeEventLogger scrubs free-form strings but keeps IDs and counts", () => {
  const log = makeEventLogger();
  log.log("run:start", {
    runId: "r1", teamMode: "team_review", prompt: "SECRET USER PROMPT",
    specialists: ["coder", "vision"], concurrency: 4,
  });
  const ev = log.events[0];
  assert.equal(ev.kind, "run:start");
  assert.equal(ev.runId, "r1");
  assert.equal(ev.teamMode, "team_review");
  assert.equal(ev.prompt, "[len:18]"); // scrubbed
  assert.deepEqual(ev.specialists, { count: 2 });
  assert.equal(ev.concurrency, 4);
});

test("invariants object encodes the promises this sprint makes", () => {
  assert.equal(ORCHESTRATION_INVARIANTS.maxConcurrent, 4);
  assert.equal(ORCHESTRATION_INVARIANTS.masterBrainNeverSpecialist, true);
  assert.equal(ORCHESTRATION_INVARIANTS.synthesisNeverForgesResults, true);
  assert.equal(ORCHESTRATION_INVARIANTS.neverPersistIntermediateSpecialistOutputs, true);
  assert.equal(ORCHESTRATION_INVARIANTS.saveTeamSummaryRequiresExplicitConfirm, true);
  assert.equal(ORCHESTRATION_INVARIANTS.approvalCardsRequiredForSideEffects, true);
  assert.equal(ORCHESTRATION_INVARIANTS.runtimeIdentityGeneratedByApp, true);
});

test("TEAM_MODE_LABEL exposes user-facing names for every mode", () => {
  for (const m of ["fast", "team_review", "full_council", "manual"]) {
    assert.ok(TEAM_MODE_LABEL[m]);
  }
});
