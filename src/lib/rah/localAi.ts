/**
 * Local AI integration layer for Raven Command.
 *
 * Runs entirely client-side: no API keys, no cloud round-trips.
 * Supports two local backends:
 *   - LM Studio (OpenAI-compatible)  default http://127.0.0.1:1234/v1
 *   - Ollama                         default http://127.0.0.1:11434
 *
 * Settings + last diagnostics live in localStorage under stable keys.
 * Prompt contents are NEVER logged in diagnostics.
 */

import { buildSystemPrompt, type PromptContext } from "./systemPrompts";
import type { ExecutionMode } from "./db";
import type { AiState, HealthResult, StreamCallbacks, StreamRequest } from "./ai";

export type AiEngine = "cloud" | "lmstudio" | "ollama" | "demo";

export interface LocalAiSettings {
  engine: AiEngine;
  lmStudioUrl: string;
  ollamaUrl: string;
  lmStudioModel: string;
  ollamaModel: string;
  temperature: number;
  contextLength: number;
  systemPromptExtra: string;
  firstRunDismissed: boolean;
}

export interface LocalDiagnostic {
  engine: AiEngine;
  endpoint: string;
  op: string;
  status: number | null;
  errorType: string | null;
  ok: boolean;
  timestamp: number;
}

export const DEFAULT_LOCAL_SETTINGS: LocalAiSettings = {
  engine: "cloud",
  lmStudioUrl: "http://127.0.0.1:1234/v1",
  ollamaUrl: "http://127.0.0.1:11434",
  lmStudioModel: "google/gemma-4-e4b",
  ollamaModel: "llama3.1",
  temperature: 0.7,
  contextLength: 4096,
  systemPromptExtra: "",
  firstRunDismissed: false,
};

const SETTINGS_KEY = "rah:localAi:v1";
const DIAG_KEY = "rah:localAi:diag:v1";

type Listener = (s: LocalAiSettings) => void;
const listeners = new Set<Listener>();

export function getLocalAiSettings(): LocalAiSettings {
  if (typeof window === "undefined") return { ...DEFAULT_LOCAL_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LocalAiSettings>;
    return { ...DEFAULT_LOCAL_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_LOCAL_SETTINGS };
  }
}

export function saveLocalAiSettings(patch: Partial<LocalAiSettings>): LocalAiSettings {
  const next = { ...getLocalAiSettings(), ...patch };
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }
  for (const l of listeners) l(next);
  return next;
}

export function subscribeLocalAi(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recordDiagnostic(d: LocalDiagnostic): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DIAG_KEY, JSON.stringify(d)); } catch { /* */ }
}
export function getLastDiagnostic(): LocalDiagnostic | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DIAG_KEY);
    return raw ? (JSON.parse(raw) as LocalDiagnostic) : null;
  } catch { return null; }
}

export function isLocalEngine(e: AiEngine): boolean {
  return e === "lmstudio" || e === "ollama";
}

export function engineLabel(e: AiEngine): string {
  switch (e) {
    case "cloud": return "Lovable AI Gateway";
    case "lmstudio": return "LM Studio (local)";
    case "ollama": return "Ollama (local)";
    case "demo": return "Local Demo Engine";
  }
}

function normalizeUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

function classifyFetchError(err: unknown): { state: AiState; message: string; errorType: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const isTypeError = err instanceof TypeError;
  if (isTypeError) {
    return {
      state: "network_error",
      errorType: "TypeError",
      message:
        "Browser blocked the request. This is usually CORS or the local server not running. " +
        "Check that LM Studio's Local Server is started (or Ollama is running) and that CORS is enabled for this origin.",
    };
  }
  return { state: "network_error", errorType: err instanceof Error ? err.name : "Error", message: msg };
}

/* ---------------- Model discovery ---------------- */

export interface DiscoveredModel { id: string; label?: string }

export async function listLmStudioModels(baseUrl: string, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  const url = `${normalizeUrl(baseUrl)}/models`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal });
    recordDiagnostic({ engine: "lmstudio", endpoint: url, op: "GET /models", status: res.status, errorType: null, ok: res.ok, timestamp: started });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => ({ id: m.id }));
  } catch (err) {
    const c = classifyFetchError(err);
    recordDiagnostic({ engine: "lmstudio", endpoint: url, op: "GET /models", status: null, errorType: c.errorType, ok: false, timestamp: started });
    throw err;
  }
}

export async function listOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  const url = `${normalizeUrl(baseUrl)}/api/tags`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal });
    recordDiagnostic({ engine: "ollama", endpoint: url, op: "GET /api/tags", status: res.status, errorType: null, ok: res.ok, timestamp: started });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => ({ id: m.name }));
  } catch (err) {
    const c = classifyFetchError(err);
    recordDiagnostic({ engine: "ollama", endpoint: url, op: "GET /api/tags", status: null, errorType: c.errorType, ok: false, timestamp: started });
    throw err;
  }
}

/* ---------------- Health ---------------- */

export async function checkLocalHealth(settings: LocalAiSettings, signal?: AbortSignal): Promise<HealthResult> {
  if (settings.engine === "demo") {
    return { ok: true, state: "connected", provider: engineLabel("demo"), model: "demo", latencyMs: 0, sample: "" };
  }
  const started = Date.now();
  try {
    if (settings.engine === "lmstudio") {
      const models = await listLmStudioModels(settings.lmStudioUrl, signal);
      return {
        ok: true, state: "connected", provider: engineLabel("lmstudio"),
        model: settings.lmStudioModel || models[0]?.id || "unknown",
        latencyMs: Date.now() - started,
        sample: models.length ? `${models.length} model(s) loaded` : "no models loaded",
      };
    }
    const models = await listOllamaModels(settings.ollamaUrl, signal);
    return {
      ok: true, state: "connected", provider: engineLabel("ollama"),
      model: settings.ollamaModel || models[0]?.id || "unknown",
      latencyMs: Date.now() - started,
      sample: models.length ? `${models.length} model(s) installed` : "no models installed",
    };
  } catch (err) {
    const c = classifyFetchError(err);
    return {
      ok: false, state: c.state,
      provider: engineLabel(settings.engine),
      message: c.message,
      latencyMs: Date.now() - started,
    };
  }
}

/* ---------------- Chat streaming ---------------- */

function buildMessages(req: StreamRequest, settings: LocalAiSettings): { role: string; content: string }[] {
  const ctx: PromptContext = { ...(req.context ?? {}) };
  const base = buildSystemPrompt(req.agents ?? ["brain"], req.mode as ExecutionMode, ctx);
  const system = settings.systemPromptExtra
    ? `${base}\n\nAdditional instructions:\n${settings.systemPromptExtra}`
    : base;
  return [
    { role: "system", content: system },
    { role: "user", content: req.prompt },
  ];
}

export async function streamLmStudio(req: StreamRequest, settings: LocalAiSettings, cb: StreamCallbacks): Promise<string> {
  const url = `${normalizeUrl(settings.lmStudioUrl)}/chat/completions`;
  const model = settings.lmStudioModel || "google/gemma-4-e4b";
  const started = Date.now();
  cb.onStart?.({ provider: engineLabel("lmstudio"), model });
  if (req.images?.length) cb.onVision?.({ imageCount: 0, attachments: [] });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model,
        stream: true,
        temperature: settings.temperature,
        max_tokens: settings.contextLength,
        messages: buildMessages(req, settings),
      }),
    });
  } catch (err) {
    const c = classifyFetchError(err);
    recordDiagnostic({ engine: "lmstudio", endpoint: url, op: "POST /chat/completions", status: null, errorType: c.errorType, ok: false, timestamp: started });
    cb.onError?.(c.message, c.state);
    throw err;
  }
  recordDiagnostic({ engine: "lmstudio", endpoint: url, op: "POST /chat/completions", status: res.status, errorType: null, ok: res.ok, timestamp: started });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    cb.onError?.(t || `HTTP ${res.status}`, "error");
    throw new Error(t || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { full += delta; cb.onDelta?.(delta, full); }
      } catch { /* keepalive */ }
    }
  }
  cb.onDone?.({ text: full, model, provider: engineLabel("lmstudio"), latencyMs: Date.now() - started, usage: null });
  return full;
}

export async function streamOllama(req: StreamRequest, settings: LocalAiSettings, cb: StreamCallbacks): Promise<string> {
  const url = `${normalizeUrl(settings.ollamaUrl)}/api/chat`;
  const model = settings.ollamaModel || "llama3.1";
  const started = Date.now();
  cb.onStart?.({ provider: engineLabel("ollama"), model });
  if (req.images?.length) cb.onVision?.({ imageCount: 0, attachments: [] });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model,
        stream: true,
        options: { temperature: settings.temperature, num_ctx: settings.contextLength },
        messages: buildMessages(req, settings),
      }),
    });
  } catch (err) {
    const c = classifyFetchError(err);
    recordDiagnostic({ engine: "ollama", endpoint: url, op: "POST /api/chat", status: null, errorType: c.errorType, ok: false, timestamp: started });
    cb.onError?.(c.message, c.state);
    throw err;
  }
  recordDiagnostic({ engine: "ollama", endpoint: url, op: "POST /api/chat", status: res.status, errorType: null, ok: res.ok, timestamp: started });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    cb.onError?.(t || `HTTP ${res.status}`, "error");
    throw new Error(t || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const delta = j.message?.content;
        if (delta) { full += delta; cb.onDelta?.(delta, full); }
      } catch { /* */ }
    }
  }
  cb.onDone?.({ text: full, model, provider: engineLabel("ollama"), latencyMs: Date.now() - started, usage: null });
  return full;
}