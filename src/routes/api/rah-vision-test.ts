import { createFileRoute } from "@tanstack/react-router";

// A fixed 8x8 solid-red PNG. Used to verify the full server-side multimodal
// path (image bytes → provider → parseable answer). Success requires the
// model to actually read the image and mention "red".
const RED_PNG_DATAURL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVR4nGP8z8Dwn4GBgYGJgYGBgYGBgYGBgQEAGAsBAaW9E20AAAAASUVORK5CYII=";

export const Route = createFileRoute("/api/rah-vision-test")({
  server: {
    handlers: {
      POST: async () => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({
            ok: false, state: "auth_required", provider: "Lovable AI Gateway",
            message: "LOVABLE_API_KEY is not configured on the server.",
          });
        }
        const model = "google/gemini-2.5-flash";
        const started = Date.now();
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: "You are a vision test probe. Reply with a single lowercase color word (e.g. red, blue, green)." },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "What single color fills this image? Reply with only the color name." },
                    { type: "image_url", image_url: { url: RED_PNG_DATAURL } },
                  ],
                },
              ],
              max_completion_tokens: 16,
            }),
          });
          const latencyMs = Date.now() - started;
          if (res.status === 429) return Response.json({ ok: false, state: "rate_limited", provider: "Lovable AI Gateway", latencyMs, message: "Rate limit reached." });
          if (res.status === 402) return Response.json({ ok: false, state: "quota", provider: "Lovable AI Gateway", latencyMs, message: "Workspace credits exhausted." });
          if (!res.ok) {
            const t = await res.text();
            return Response.json({ ok: false, state: "error", provider: "Lovable AI Gateway", model, latencyMs, message: t.slice(0, 300) });
          }
          const data = await res.json() as { model?: string; choices?: { message?: { content?: string } }[] };
          const reply = (data.choices?.[0]?.message?.content ?? "").trim();
          const matched = /red/i.test(reply);
          return Response.json({
            ok: matched,
            state: matched ? "connected" : "error",
            provider: "Lovable AI Gateway",
            model: data.model ?? model,
            latencyMs,
            reply,
            matched,
            message: matched ? undefined : `Model reply did not contain "red": "${reply}"`,
          });
        } catch (err) {
          return Response.json({
            ok: false, state: "network_error", provider: "Lovable AI Gateway",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});