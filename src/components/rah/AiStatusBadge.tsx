import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { checkHealth, type HealthResult } from "@/lib/rah/ai";

export function useAiHealth(autoCheck = true) {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    const h = await checkHealth();
    setHealth(h);
    setLoading(false);
    return h;
  }
  useEffect(() => {
    if (autoCheck) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { health, loading, refresh: run };
}

export function AiStatusBadge({ health, loading }: { health: HealthResult | null; loading?: boolean }) {
  const state = loading ? "checking" : health?.state ?? "unknown";
  const label = ({
    checking: "Checking AI…",
    connected: `AI Connected${health?.model ? " · " + health.model : ""}`,
    auth_required: "Authentication Required",
    rate_limited: "Rate Limited",
    quota: "Credits Exhausted",
    network_error: "Offline / Network",
    error: "AI Error",
    unknown: "AI Status Unknown",
  } as Record<string, string>)[state] ?? "AI Status";
  const cls =
    state === "connected" ? "border-primary text-primary"
    : state === "checking" ? "border-primary/60 text-primary animate-pulse"
    : state === "unknown" ? "border-border text-muted-foreground"
    : "border-destructive text-destructive";
  return (
    <Link to="/connections" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Link>
  );
}