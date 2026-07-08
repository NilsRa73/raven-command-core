import { AGENTS, agentById } from "./agents";
import type { ExecutionMode } from "./db";

/**
 * Produces a structured local demonstration response.
 * Clearly labelled — never claims to be a real AI answer.
 */
export function localDemoResponse(prompt: string, agentIds: string[], mode: ExecutionMode): string {
  const agents = agentIds.map((id) => agentById(id)).filter(Boolean);
  const modeLabel = ({
    fast: "Fast Answer",
    expert: "Expert Team",
    debate: "Debate Mode",
    deep_project: "Deep Project",
  } as const)[mode];

  const trimmed = prompt.trim().replace(/\s+/g, " ");
  const goal = trimmed.length > 140 ? trimmed.slice(0, 137) + "…" : trimmed;

  const perAgent = (agents.length ? agents : [AGENTS[0]]).map((a) => {
    const lines = a!.responsibilities.slice(0, 3).map((r) => `  • ${r}`).join("\n");
    return `${a!.emoji} ${a!.name} (${a!.role})\n${lines}\n  → Would apply the above to: "${goal}"`;
  }).join("\n\n");

  return [
    "⚑ Local Demo Response — no AI provider configured.",
    `Mode: ${modeLabel}    Agents: ${agents.length}`,
    "",
    "Interpreted request:",
    `  ${goal || "(empty prompt)"}`,
    "",
    "Proposed plan by agent:",
    perAgent,
    "",
    "Next steps:",
    "  1. Configure an AI provider in Settings to receive real responses.",
    "  2. Approve or edit this plan in the Approvals panel.",
    "  3. Attach files or screenshots for deeper analysis.",
  ].join("\n");
}