export interface AgentDef {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  summary: string;
  responsibilities: string[];
}

export const AGENTS: AgentDef[] = [
  { id: "brain", name: "RAH Master Brain", role: "Orchestrator", emoji: "🜛", color: "oklch(0.82 0.15 82)",
    summary: "Understands the goal, picks specialists, combines results, requests approval.",
    responsibilities: ["Decompose tasks", "Pick specialists", "Combine results", "Detect conflicts", "Present final plan", "Request approval before sensitive actions"] },
  { id: "coder", name: "RAH Coder", role: "Engineering", emoji: "⚙️", color: "oklch(0.7 0.12 200)",
    summary: "Generates, reviews and debugs code; designs APIs; prepares Lovable prompts.",
    responsibilities: ["Generate & review code", "Debug errors", "Explain installation", "Design APIs", "Prepare Lovable prompts", "Security & performance review"] },
  { id: "vision", name: "RAH Vision", role: "Visual Analysis", emoji: "👁", color: "oklch(0.75 0.14 300)",
    summary: "Analyses screenshots and interfaces through configured vision APIs.",
    responsibilities: ["Analyse screenshots", "Explain interfaces", "Identify visible errors", "Click-by-click guidance", "Extract visible text", "Compare designs"] },
  { id: "research", name: "RAH Research", role: "Knowledge", emoji: "🔍", color: "oklch(0.75 0.1 260)",
    summary: "Searches sources, separates fact from speculation, cites evidence.",
    responsibilities: ["Search knowledge", "Cite sources", "Flag outdated info", "Summarize evidence", "Show uncertainty"] },
  { id: "designer", name: "RAH Designer", role: "Design", emoji: "🜄", color: "oklch(0.78 0.13 20)",
    summary: "Creates interface concepts and design specifications.",
    responsibilities: ["Interface concepts", "Improve usability", "Maintain RAH branding", "Design specs", "Responsive layouts", "Accessibility check"] },
  { id: "engineer", name: "RAH Engineer", role: "Systems", emoji: "⚡", color: "oklch(0.78 0.14 60)",
    summary: "Evaluates technical feasibility, estimates infrastructure.",
    responsibilities: ["Feasibility", "System diagrams", "Estimate energy/hardware", "Dependencies", "Simulations & tests"] },
  { id: "earth", name: "RAH Earth", role: "Ecosystem", emoji: "🜨", color: "oklch(0.75 0.14 140)",
    summary: "Analyses ecological, energy and climate implications.",
    responsibilities: ["Ecological consequences", "Compare solutions", "Real engineering vs speculation", "Data needed for simulation"] },
  { id: "business", name: "RAH Business", role: "Business", emoji: "🜍", color: "oklch(0.78 0.13 90)",
    summary: "Costs, pricing, markets, business models and risks.",
    responsibilities: ["Cost estimates", "Pricing", "Market evaluation", "Business models", "Regulatory risk", "Proposals"] },
  { id: "guardian", name: "RAH Guardian", role: "Privacy & Safety", emoji: "🜏", color: "oklch(0.6 0.22 25)",
    summary: "Privacy checks and confirmations before destructive actions.",
    responsibilities: ["Privacy checks", "Detect sensitive data", "Review permissions", "Warn on destructive ops", "Prevent disclosure", "Require confirmation"] },
  { id: "action", name: "RAH Action", role: "Execution", emoji: "🜚", color: "oklch(0.82 0.15 82)",
    summary: "Turns approved plans into structured, auditable actions.",
    responsibilities: ["Convert plans to actions", "Execution checklist", "Explicit approval", "Record outcomes", "Rollback where possible"] },
];

export const agentById = (id: string) => AGENTS.find((a) => a.id === id);