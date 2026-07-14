export const EXPORT_SCHEMA: string;

export interface VisionExportBundle {
  sessions?: unknown[];
  evidence?: unknown[];
  results?: unknown[];
  resultVersions?: unknown[];
}

export function buildJsonExport(bundle?: VisionExportBundle, opts?: { includeImages?: boolean }): {
  schema: string;
  generatedAt: number;
  includeImages: boolean;
  counts: { sessions: number; evidence: number; results: number; resultVersions: number };
  sessions: unknown[];
  evidence: unknown[];
  results: unknown[];
  resultVersions: unknown[];
};

export function buildMarkdownExport(bundle?: VisionExportBundle): string;

export function validateImportPayload(raw: unknown): { ok: boolean; errors: string[]; payload?: {
  schema: string;
  generatedAt: number;
  includeImages: boolean;
  sessions: unknown[];
  evidence: unknown[];
  results: unknown[];
  resultVersions: unknown[];
} };