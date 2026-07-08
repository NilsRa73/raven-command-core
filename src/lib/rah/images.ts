// Client-side image ingestion, validation, and downscaling for multimodal AI.
// No image bytes are ever persisted to localStorage — thumbnails are kept in
// memory (blob URLs) and only safe metadata is persisted in IndexedDB.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB raw per file
export const MAX_IMAGES = 4;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_EDGE = 2048; // longest side after downscale
export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

export interface PreparedImage {
  id: string;
  name: string;
  mime: string;              // final transmitted mime (jpeg/png/webp)
  sourceMime: string;
  sizeBytes: number;         // final transmitted size
  sourceBytes: number;
  width: number;
  height: number;
  dataUrl: string;           // base64 data URL for transport (in-memory only)
  thumbUrl: string;          // blob: URL for preview
  included: boolean;
  state: "ready" | "preparing" | "unsupported" | "too_large" | "failed";
  error?: string;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  included: boolean;
  analyzed?: boolean;
  state?: PreparedImage["state"];
}

export function metaFromPrepared(p: PreparedImage, analyzed = false): AttachmentMeta {
  return {
    id: p.id, name: p.name, mime: p.mime,
    width: p.width, height: p.height, sizeBytes: p.sizeBytes,
    included: p.included, analyzed, state: p.state,
  };
}

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

async function loadImageBitmap(blob: Blob): Promise<{ w: number; h: number; canvas: HTMLCanvasElement }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode failed"));
      el.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    ctx.drawImage(img, 0, 0, dw, dh);
    return { w: dw, h: dh, canvas };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encode failed"))), mime, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Read failed"));
    r.readAsDataURL(blob);
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const base: PreparedImage = {
    id: uid(),
    name: file.name || "image",
    mime: file.type || "application/octet-stream",
    sourceMime: file.type || "application/octet-stream",
    sizeBytes: file.size,
    sourceBytes: file.size,
    width: 0, height: 0,
    dataUrl: "", thumbUrl: URL.createObjectURL(file),
    included: true, state: "preparing",
  };
  if (!ACCEPTED_MIME.includes(file.type)) {
    return { ...base, state: "unsupported", error: `Unsupported type: ${file.type || "unknown"}` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ...base, state: "too_large", error: `Over 10 MB (${(file.size / 1_048_576).toFixed(1)} MB)` };
  }
  try {
    const { w, h, canvas } = await loadImageBitmap(file);
    // Prefer PNG when the source is PNG (preserves text/UI clarity + transparency), else JPEG.
    const outMime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const outBlob = await canvasToBlob(canvas, outMime, outMime === "image/jpeg" ? 0.85 : undefined);
    const dataUrl = await blobToDataUrl(outBlob);
    return {
      ...base,
      mime: outMime,
      sizeBytes: outBlob.size,
      width: w, height: h,
      dataUrl, state: "ready",
    };
  } catch (err) {
    return { ...base, state: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function prepareCanvasBlob(blob: Blob, name: string): Promise<PreparedImage> {
  const file = new File([blob], name, { type: blob.type || "image/png" });
  return prepareImage(file);
}

export function releasePrepared(list: PreparedImage[]) {
  for (const p of list) { try { URL.revokeObjectURL(p.thumbUrl); } catch { /* */ } }
}

export function validateBatch(existing: PreparedImage[], addingCount: number, addingBytes: number): string | null {
  const readyCount = existing.filter((p) => p.state === "ready").length;
  if (readyCount + addingCount > MAX_IMAGES) return `Maximum ${MAX_IMAGES} images per command.`;
  const totalBytes = existing.reduce((s, p) => s + (p.state === "ready" ? p.sizeBytes : 0), 0) + addingBytes;
  if (totalBytes > MAX_TOTAL_BYTES) return `Combined image size over ${(MAX_TOTAL_BYTES / 1_048_576).toFixed(0)} MB.`;
  return null;
}

// sessionStorage handoff from /vision → CommandBar. Uses object URLs re-encoded
// as data URLs; small helper so we don't lose the image on navigation.
const PENDING_KEY = "rah:pending-attachments-v1";
export interface PendingImage { name: string; mime: string; dataUrl: string; width: number; height: number; sizeBytes: number }

export function queuePendingImage(p: PendingImage) {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const arr: PendingImage[] = raw ? JSON.parse(raw) : [];
    arr.push(p);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(arr));
  } catch { /* ignore quota */ }
}

export function drainPendingImages(): PendingImage[] {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as PendingImage[];
  } catch { return []; }
}

export async function preparedFromPending(p: PendingImage): Promise<PreparedImage> {
  // Convert the data URL back to a Blob for consistent handling / thumbnail.
  const res = await fetch(p.dataUrl);
  const blob = await res.blob();
  return {
    id: uid(),
    name: p.name,
    mime: p.mime,
    sourceMime: p.mime,
    sizeBytes: p.sizeBytes,
    sourceBytes: p.sizeBytes,
    width: p.width, height: p.height,
    dataUrl: p.dataUrl,
    thumbUrl: URL.createObjectURL(blob),
    included: true, state: "ready",
  };
}