import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/rah-health")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json({
            ok: false,
            state: "auth_required",
            provider: "Lovable AI Gateway",
            message: "LOVABLE_API_KEY is not configured on the server.",
          }, { status: 200 });
        }
        const started = Date.now();
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": key,
            },
            body: JSON.stringify({
              model: "openai/gpt-5.5",
              messages: [{ role: "user", content: "Reply with the single word: pong" }],
              max_completion_tokens: 16,
            }),
          });
          const latencyMs = Date.now() - started;
          if (res.status === 429) return Response.json({ ok: false, state: "rate_limited", provider: "Lovable AI Gateway", latencyMs, message: "Rate limit reached." });
          if (res.status === 402) return Response.json({ ok: false, state: "quota", provider: "Lovable AI Gateway", latencyMs, message: "Workspace credits exhausted." });
          if (!res.ok) {
            const t = await res.text();
            return Response.json({ ok: false, state: "error", provider: "Lovable AI Gateway", latencyMs, status: res.status, message: t.slice(0, 300) });
          }
          const data = await res.json() as { model?: string; choices?: { message?: { content?: string } }[] };
          return Response.json({
            ok: true,
            state: "connected",
            provider: "Lovable AI Gateway",
            model: data.model ?? "openai/gpt-5.5",
            latencyMs,
            sample: data.choices?.[0]?.message?.content?.trim() ?? "",
          });
        } catch (err) {
          return Response.json({
            ok: false,
            state: "network_error",
            provider: "Lovable AI Gateway",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});