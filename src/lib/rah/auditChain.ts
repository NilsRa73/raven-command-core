// Hash-chained audit log built deterministically from existing commands & approvals.
// Uses Web Crypto SHA-256 with a synchronous FNV-1a fallback for environments
// that lack it (never occurs in-browser, but keeps types honest).

import type { CommandRecord, Approval } from "./db";

export interface AuditEvent {
  seq: number;
  ts: number;
  actor: string;
  agent?: string;
  type: string;
  prevState?: string;
  newState?: string;
  detail: string;
  sourceId: string;
  prevHash: string;
  hash: string;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8).padStart(16, "0");
}

async function sha256(s: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return fnv1a(s);
}

interface RawEvent {
  ts: number; actor: string; agent?: string; type: string;
  prevState?: string; newState?: string; detail: string; sourceId: string;
}

function collectRaw(commands: CommandRecord[], approvals: Approval[]): RawEvent[] {
  const out: RawEvent[] = [];
  for (const c of commands) {
    out.push({
      ts: c.createdAt, actor: "user", agent: c.agents[0],
      type: "command.created", newState: c.status, detail: c.prompt.slice(0, 140), sourceId: c.id,
    });
    if (c.status === "done" || c.status === "error" || c.status === "rejected") {
      out.push({
        ts: c.createdAt + 1, actor: c.provider ? "ai" : "system", agent: c.agents[0],
        type: "command." + c.status, prevState: "running", newState: c.status,
        detail: c.resultSummary?.slice(0, 140) ?? c.errorMessage ?? "",
        sourceId: c.id,
      });
    }
  }
  for (const a of approvals) {
    out.push({
      ts: a.createdAt, actor: "system", type: "approval.requested",
      newState: "pending", detail: `${a.title} · risk=${a.risk}`, sourceId: a.id,
    });
    if (a.status !== "pending") {
      out.push({
        ts: a.createdAt + 1, actor: "user", type: "approval." + a.status,
        prevState: "pending", newState: a.status, detail: a.title, sourceId: a.id,
      });
    }
  }
  out.sort((x, y) => x.ts - y.ts);
  return out;
}

export async function buildAuditChain(commands: CommandRecord[], approvals: Approval[]): Promise<AuditEvent[]> {
  const raw = collectRaw(commands, approvals);
  const events: AuditEvent[] = [];
  let prevHash = "0".repeat(64);
  let seq = 0;
  for (const r of raw) {
    seq += 1;
    const payload = JSON.stringify({ ...r, seq, prevHash });
    const hash = await sha256(payload);
    events.push({ ...r, seq, prevHash, hash });
    prevHash = hash;
  }
  return events;
}

export async function verifyChain(events: AuditEvent[]): Promise<{ ok: boolean; brokenAt?: number }> {
  let prev = "0".repeat(64);
  for (const e of events) {
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
    const { hash, ...rest } = e;
    const payload = JSON.stringify({
      ts: rest.ts, actor: rest.actor, agent: rest.agent, type: rest.type,
      prevState: rest.prevState, newState: rest.newState, detail: rest.detail,
      sourceId: rest.sourceId, seq: rest.seq, prevHash: rest.prevHash,
    });
    const expected = await sha256(payload);
    if (expected !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true };
}
