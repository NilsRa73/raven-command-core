import { createFileRoute } from "@tanstack/react-router";
import { buildSystemPrompt, type PromptContext } from "@/lib/rah/systemPrompts";
import type { ExecutionMode } from "@/lib/rah/db";

const ACCEPTED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const MAX_IMAGES_SERVER = 4;
const MAX_IMAGE_DATAURL_CHARS = 14_000_000; // ~10 MB base64
const MAX_TOTAL_DATAURL_CHARS = 32_000_000; // ~22 MB base64 combined

interface ImageInput { name?: string; mime?: string; dataUrl: string }

interface ChatBody {
  prompt: string;
  agents: string[];
  mode: ExecutionMode;
  context?: PromptContext;
  model?: string;
  images?: ImageInput[];
}

function sseEvent(obj: unknown) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

export const Route = createFileRoute("/api/rah-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({ error: "auth_required", message: "LOVABLE_API_KEY not configured." }, { status: 401 });
        }
        let body: ChatBody;
        try {
          body = (await request.json()) as ChatBody;
        } catch {
          return Response.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
        }
        if (!body.prompt?.trim()) {
          return Response.json({ error: "bad_request", message: "Missing prompt." }, { status: 400 });
        }
        const agents = Array.isArray(body.agents) && body.agents.length ? body.agents : ["brain"];
        const mode: ExecutionMode = body.mode ?? "fast";

        // Validate + normalize images (multimodal input).
        const rawImages = Array.isArray(body.images) ? body.images : [];
        if (rawImages.length > MAX_IMAGES_SERVER) {
          return Response.json({ error: "bad_request", message: `Too many images (max ${MAX_IMAGES_SERVER}).` }, { status: 400 });
        }
        let totalChars = 0;
        const images: { name: string; mime: string; dataUrl: string }[] = [];
        for (const img of rawImages) {
          if (!img?.dataUrl || typeof img.dataUrl !== "string") {
            return Response.json({ error: "bad_request", message: "Invalid image payload." }, { status: 400 });
          }
          const m = /^data:([^;]+);base64,/.exec(img.dataUrl);
          const mime = (m?.[1] || img.mime || "").toLowerCase();
          if (!m || !ACCEPTED_IMAGE_MIME.has(mime)) {
            return Response.json({ error: "bad_request", message: `Unsupported image type: ${mime || "unknown"}` }, { status: 400 });
          }
          if (img.dataUrl.length > MAX_IMAGE_DATAURL_CHARS) {
            return Response.json({ error: "bad_request", message: `Image too large: ${img.name || "image"}` }, { status: 413 });
          }
          totalChars += img.dataUrl.length;
          if (totalChars > MAX_TOTAL_DATAURL_CHARS) {
            return Response.json({ error: "bad_request", message: "Combined image payload too large." }, { status: 413 });
          }
          images.push({ name: img.name || "image", mime, dataUrl: img.dataUrl });
        }

        // Choose a multimodal-capable model when images are attached.
        const model = body.model || (images.length ? "google/gemini-2.5-flash" : "openai/gpt-5.5");

        // Inject attachment awareness into the system prompt.
        const ctx: PromptContext = { ...(body.context ?? {}) };
        if (images.length) {
          ctx.attachments = images.map((im, i) => ({
            name: im.name || `image-${i + 1}`,
            mime: im.mime,
            size: Math.floor((im.dataUrl.length * 3) / 4),
          }));
          ctx.attachmentsIncluded = true;
        }
        const system = buildSystemPrompt(agents, mode, ctx);

        // Build the user message: text + image_url parts (OpenAI-compatible multimodal).
        const userContent: unknown[] = [{ type: "text", text: body.prompt }];
        images.forEach((im, i) => {
          userContent.push({ type: "text", text: `\n[Attachment ${i + 1}: ${im.name}]` });
          userContent.push({ type: "image_url", image_url: { url: im.dataUrl } });
        });
        const userMessage = images.length
          ? { role: "user", content: userContent }
          : { role: "user", content: body.prompt };

        const started = Date.now();
        let upstream: Response;
        try {
          upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": key,
            },
            signal: request.signal,
            body: JSON.stringify({
              model,
              stream: true,
              messages: [
                { role: "system", content: system },
                userMessage,
              ],
            }),
          });
        } catch (err) {
          return Response.json({
            error: "network_error",
            message: err instanceof Error ? err.message : String(err),
          }, { status: 502 });
        }

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          const state =
            upstream.status === 429 ? "rate_limited"
            : upstream.status === 402 ? "quota"
            : upstream.status === 401 ? "auth_required"
            : "error";
          return Response.json({
            error: state,
            status: upstream.status,
            message: text.slice(0, 500) || upstream.statusText,
          }, { status: upstream.status });
        }

        const stream = new ReadableStream({
          async start(controller) {
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let full = "";
            let usage: unknown = null;
            let respModel = model;
            controller.enqueue(sseEvent({ type: "start", provider: "Lovable AI Gateway", model }));
            if (images.length) {
              controller.enqueue(sseEvent({
                type: "vision",
                imageCount: images.length,
                attachments: images.map((im) => ({ name: im.name, mime: im.mime })),
              }));
            }
            try {
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
                    const j = JSON.parse(data) as {
                      model?: string;
                      usage?: unknown;
                      choices?: { delta?: { content?: string } }[];
                    };
                    if (j.model) respModel = j.model;
                    if (j.usage) usage = j.usage;
                    const delta = j.choices?.[0]?.delta?.content;
                    if (delta) {
                      full += delta;
                      controller.enqueue(sseEvent({ type: "delta", text: delta }));
                    }
                  } catch { /* ignore keepalives */ }
                }
              }
              controller.enqueue(sseEvent({
                type: "done",
                text: full,
                model: respModel,
                usage,
                latencyMs: Date.now() - started,
                provider: "Lovable AI Gateway",
              }));
            } catch (err) {
              controller.enqueue(sseEvent({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              }));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});