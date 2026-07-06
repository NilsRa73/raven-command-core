export function isSpeechSupported() {
  if (typeof window === "undefined") return false;
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

export function createRecognizer(lang: string): any {
  if (typeof window === "undefined") return null;
  const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = true;
  return r;
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter((d) => d.kind === "audioinput");
}

export function speak(text: string, opts?: { rate?: number; voiceName?: string }) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  if (opts?.rate) u.rate = opts.rate;
  if (opts?.voiceName) {
    const v = window.speechSynthesis.getVoices().find((v) => v.name === opts.voiceName);
    if (v) u.voice = v;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

export async function requestScreenShare(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) return null;
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return null;
  }
}

export async function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return await new Promise((r) => canvas.toBlob((b) => r(b), "image/png"));
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

export type PermState = "granted" | "denied" | "prompt" | "unsupported";
export async function queryPermission(name: any): Promise<PermState> {
  if (typeof navigator === "undefined" || !("permissions" in navigator)) return "unsupported";
  try {
    const p = await (navigator.permissions as any).query({ name });
    return p.state as PermState;
  } catch {
    return "unsupported";
  }
}

export type BridgeState = "not_installed" | "disconnected" | "connected" | "error" | "checking";
export async function probeBridge(port = 47823, timeout = 800): Promise<BridgeState> {
  if (typeof WebSocket === "undefined") return "not_installed";
  return await new Promise<BridgeState>((resolve) => {
    let done = false;
    const finish = (s: BridgeState) => { if (!done) { done = true; try { ws.close(); } catch {} resolve(s); } };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rah-bridge`);
    const t = setTimeout(() => finish("not_installed"), timeout);
    ws.onopen = () => { clearTimeout(t); finish("connected"); };
    ws.onerror = () => { clearTimeout(t); finish("not_installed"); };
  });
}