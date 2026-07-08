import type { ExecutionMode } from "./db";
import type { PromptContext } from "./systemPrompts";

export type AiState =
  | "unknown"
  | "checking"
  | "connected"
  | "auth_required"
  | "rate_limited"
  | "quota"
  | "network_error"
  | "error";

export interface HealthResult {
  ok: boolean;
  state: AiState;
  provider: string;
  model?: string;
  latencyMs?: number;
  message?: string;
  sample?: string;
}

export async function checkHealth(signal?: AbortSignal): Promise<HealthResult> {
  try {
    const res = await fetch("/api/rah-health", { signal });
    return (await res.json()) as HealthResult;
  } catch (err) {
    return {
      ok: false,
      state: "network_error",
      provider: "Lovable AI Gateway",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface StreamCallbacks {
  onStart?: (info: { provider: string; model: string }) => void;
  onVision?: (info: { imageCount: number; attachments: { name: string; mime: string }[] }) => void;
  onDelta?: (chunk: string, full: string) => void;
  onDone?: (info: { text: string; model: string; provider: string; latencyMs: number; usage: unknown }) => void;
  onError?: (message: string, state: AiState) => void;
}

export interface StreamRequest {
  prompt: string;
  agents: string[];
  mode: ExecutionMode;
  context?: PromptContext;
  model?: string;
  signal?: AbortSignal;
  images?: { name: string; mime: string; dataUrl: string }[];
}

export async function streamChat(req: StreamRequest, cb: StreamCallbacks): Promise<string> {
  let full = "";
  const res = await fetch("/api/rah-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: req.signal,
    body: JSON.stringify({
      prompt: req.prompt,
      agents: req.agents,
      mode: req.mode,
      context: req.context,
      model: req.model,
      images: req.images,
    }),
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    let state: AiState = "error";
    try {
      const j = (await res.json()) as { error?: AiState; message?: string };
      if (j.message) msg = j.message;
      if (j.error) state = j.error;
    } catch { /* ignore */ }
    cb.onError?.(msg, state);
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as
          | { type: "start"; provider: string; model: string }
          | { type: "vision"; imageCount: number; attachments: { name: string; mime: string }[] }
          | { type: "delta"; text: string }
          | { type: "done"; text: string; model: string; provider: string; latencyMs: number; usage: unknown }
          | { type: "error"; message: string };
        if (ev.type === "start") cb.onStart?.({ provider: ev.provider, model: ev.model });
        else if (ev.type === "vision") cb.onVision?.({ imageCount: ev.imageCount, attachments: ev.attachments });
        else if (ev.type === "delta") { full += ev.text; cb.onDelta?.(ev.text, full); }
        else if (ev.type === "done") { full = ev.text || full; cb.onDone?.({ text: full, model: ev.model, provider: ev.provider, latencyMs: ev.latencyMs, usage: ev.usage }); }
        else if (ev.type === "error") cb.onError?.(ev.message, "error");
      } catch { /* ignore */ }
    }
  }
  return full;
}

export interface VisionTestResult {
  ok: boolean;
  state: AiState;
  provider: string;
  model?: string;
  latencyMs?: number;
  reply?: string;
  message?: string;
  matched?: boolean;
}

export async function testVision(signal?: AbortSignal): Promise<VisionTestResult> {
  try {
    const res = await fetch("/api/rah-vision-test", { method: "POST", signal });
    return (await res.json()) as VisionTestResult;
  } catch (err) {
    return {
      ok: false, state: "network_error", provider: "Lovable AI Gateway",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}