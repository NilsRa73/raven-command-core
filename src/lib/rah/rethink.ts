// Deterministic local text transforms for the Raven Re-think module.
// No AI provider — clearly labelled as "Local demo analysis".

export type RethinkMode =
  | "summarize" | "simplify" | "keyFacts" | "questions" | "actions" | "rahLayout";

export const RETHINK_MODES: { id: RethinkMode; label: string; hint: string }[] = [
  { id: "summarize", label: "Summarize", hint: "3–5 sentence brief" },
  { id: "simplify", label: "Simplify", hint: "Plain, direct language" },
  { id: "keyFacts", label: "Key Facts", hint: "Bulleted essentials" },
  { id: "questions", label: "Questions", hint: "What to ask next" },
  { id: "actions", label: "Action Items", hint: "Concrete next steps" },
  { id: "rahLayout", label: "RAH Layout", hint: "Structured brief for Raven" },
];

const STOP = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","by","is","are",
  "was","were","be","been","being","this","that","these","those","it","its","as","at",
  "from","if","then","than","so","not","no","yes","we","you","i","he","she","they",
  "them","our","your","their","have","has","had","do","does","did","will","would",
  "can","could","should","may","might","just","also",
]);

function splitSentences(t: string): string[] {
  return t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function scoreWords(sentences: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const raw of s.toLowerCase().split(/[^a-z0-9åäöæø']+/i)) {
      const w = raw.trim();
      if (!w || w.length < 3 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return freq;
}

function topSentences(text: string, n: number): string[] {
  const sentences = splitSentences(text);
  if (sentences.length <= n) return sentences;
  const freq = scoreWords(sentences);
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().split(/[^a-z0-9åäöæø']+/i).filter(Boolean);
    const score = words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / Math.max(1, words.length);
    return { s, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

function simplifyLine(s: string): string {
  return s
    .replace(/\butilise|utilize\b/gi, "use")
    .replace(/\bcommence\b/gi, "start")
    .replace(/\bterminate\b/gi, "end")
    .replace(/\bfacilitate\b/gi, "help")
    .replace(/\bendeavour|endeavor\b/gi, "try")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\bdue to the fact that\b/gi, "because")
    .replace(/\bnotwithstanding\b/gi, "despite")
    .replace(/\baforementioned\b/gi, "above")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractQuestions(text: string): string[] {
  const facts = topSentences(text, 5);
  return facts.map((s) => {
    const trimmed = s.replace(/[.!?]+$/, "");
    return `What are the implications of: "${trimmed.slice(0, 120)}${trimmed.length > 120 ? "…" : ""}"?`;
  });
}

function extractActions(text: string): string[] {
  const sentences = splitSentences(text);
  const verbs = /\b(build|ship|design|write|test|verify|deploy|configure|contact|research|prototype|measure|review|document|refactor|migrate|integrate)\b/i;
  const found = sentences.filter((s) => verbs.test(s)).slice(0, 6);
  if (found.length) return found.map((s) => "→ " + simplifyLine(s));
  return topSentences(text, 4).map((s) => "→ Follow up on: " + simplifyLine(s));
}

export interface RethinkResult {
  mode: RethinkMode;
  label: string;
  markdown: string;
  demo: true;
  createdAt: number;
}

export function rethink(text: string, mode: RethinkMode): RethinkResult {
  const clean = (text ?? "").replace(/\r/g, "").trim();
  const label = RETHINK_MODES.find((m) => m.id === mode)?.label ?? mode;
  let body = "";
  if (!clean) {
    body = "_No input text provided._";
  } else if (mode === "summarize") {
    body = topSentences(clean, 4).map((s) => "- " + s).join("\n");
  } else if (mode === "simplify") {
    body = splitSentences(clean).map(simplifyLine).join(" ");
  } else if (mode === "keyFacts") {
    const freq = scoreWords(splitSentences(clean));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
    const facts = topSentences(clean, 6);
    body = [
      "**Key terms:** " + top.join(", "),
      "",
      ...facts.map((s) => "- " + s),
    ].join("\n");
  } else if (mode === "questions") {
    body = extractQuestions(clean).map((q) => "- " + q).join("\n");
  } else if (mode === "actions") {
    body = extractActions(clean).map((a) => "- " + a).join("\n");
  } else if (mode === "rahLayout") {
    const summary = topSentences(clean, 3).join(" ");
    const facts = topSentences(clean, 5);
    const actions = extractActions(clean);
    body = [
      "### Brief", summary || "_(empty)_", "",
      "### Key facts", ...facts.map((s) => "- " + s), "",
      "### Suggested actions", ...actions.map((a) => "- " + a),
    ].join("\n");
  }
  const md = `> ⚑ **Local demo analysis** — no AI provider used.\n\n**${label}**\n\n${body}\n`;
  return { mode, label, markdown: md, demo: true, createdAt: Date.now() };
}

const KEY = "rah.rethink.history.v1";
export interface RethinkHistoryEntry extends RethinkResult { id: string; input: string; }

export function loadRethinkHistory(): RethinkHistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as RethinkHistoryEntry[]; }
  catch { return []; }
}
export function saveRethinkHistory(list: RethinkHistoryEntry[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 25)));
}
