// Metadata-only export helpers for Screen Vision v0.3. Markdown NEVER
// embeds raw image bytes or base64. JSON is metadata-only unless the
// caller explicitly passes `{ includeImages: true }` — even then, only
// evidence rows that have local image bytes are enriched, and each
// enriched row is tagged so a downstream import can honestly show a
// warning.

const EXPORT_SCHEMA = "raven-vision/1";

function safe(x, fallback = "—") {
  if (x === null || x === undefined || x === "") return fallback;
  return x;
}

export function buildJsonExport({ sessions = [], evidence = [], results = [], resultVersions = [] } = {}, { includeImages = false } = {}) {
  const sanitizedEvidence = evidence.map((row) => {
    const base = { ...row };
    // Strip inline image data unless explicitly opted in AND present.
    const hasBytes = typeof row.frame?.dataUrl === "string" && row.frame.dataUrl.length > 0;
    if (!includeImages) {
      if (base.frame) base.frame = { ...base.frame, dataUrl: undefined };
      if (base.redactedFrame) base.redactedFrame = { ...base.redactedFrame, dataUrl: undefined };
      base._imagesIncluded = false;
    } else {
      base._imagesIncluded = hasBytes;
    }
    return base;
  });
  return {
    schema: EXPORT_SCHEMA,
    generatedAt: Date.now(),
    includeImages: !!includeImages,
    counts: {
      sessions: sessions.length,
      evidence: sanitizedEvidence.length,
      results: results.length,
      resultVersions: resultVersions.length,
    },
    sessions,
    evidence: sanitizedEvidence,
    results,
    resultVersions,
  };
}

export function buildMarkdownExport({ sessions = [], evidence = [], results = [] } = {}) {
  const lines = [];
  lines.push("# Raven Screen Vision export");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} — metadata only, no image bytes._`);
  lines.push("");
  if (sessions.length) {
    lines.push(`## Sessions (${sessions.length})`);
    for (const s of sessions) {
      lines.push(`- **${safe(s.title || s.id)}** · project ${safe(s.projectId)} · source ${safe(s.source)} · started ${safe(s.startedAt && new Date(s.startedAt).toISOString())} · captures ${safe(s.captureCount, 0)}`);
    }
    lines.push("");
  }
  if (evidence.length) {
    lines.push(`## Evidence (${evidence.length})`);
    for (const e of evidence) {
      const size = e.frame?.width && e.frame?.height ? `${e.frame.width}×${e.frame.height}` : "—";
      const hash = e.frame?.hash || "no integrity hash";
      lines.push(`- \`${e.id}\` · ${size} · ${safe(e.privacy?.class)} · sha256 ${hash}`);
    }
    lines.push("");
  }
  if (results.length) {
    lines.push(`## Results (${results.length})`);
    for (const r of results) {
      lines.push(`### ${safe(r.id)}`);
      lines.push(`_route: ${safe(r.route?.provider)}/${safe(r.route?.model)} · created ${safe(r.createdAt && new Date(r.createdAt).toISOString())}_`);
      lines.push("");
      lines.push("````");
      lines.push(String(r.rawText || "").slice(0, 4000));
      lines.push("````");
      lines.push("");
    }
  }
  return lines.join("\n");
}

/**
 * Validate a raw import payload. Returns { ok, errors, payload? }.
 * Only checks shape — no side effects. Callers must call the lifecycle
 * planner (`planImportApply` in visionLifecycle.js) to compute per-row
 * conflict actions before applying.
 */
export function validateImportPayload(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") errors.push("payload_not_object");
  else if (raw.schema !== EXPORT_SCHEMA) errors.push(`schema_mismatch:${raw.schema}`);
  if (raw && !Array.isArray(raw.sessions)) errors.push("sessions_not_array");
  if (raw && !Array.isArray(raw.evidence)) errors.push("evidence_not_array");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    payload: {
      schema: raw.schema,
      generatedAt: raw.generatedAt,
      includeImages: !!raw.includeImages,
      sessions: raw.sessions,
      evidence: raw.evidence,
      results: Array.isArray(raw.results) ? raw.results : [],
      resultVersions: Array.isArray(raw.resultVersions) ? raw.resultVersions : [],
    },
  };
}

export { EXPORT_SCHEMA };