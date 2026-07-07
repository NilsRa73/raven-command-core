import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MonitorPlay, Square, Camera, Upload, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestScreenShare, captureFrame, stopStream } from "@/lib/rah/speech";
import { getDB, uid } from "@/lib/rah/db";
import { useRah } from "@/lib/rah/context";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/vision")({
  head: () => ({ meta: [{ title: "Screen Vision — RAH Listen Key" }, { name: "description", content: "Share your screen and capture frames with explicit permission." }] }),
  component: VisionPage,
});

type Anno = { type: "rect" | "arrow" | "marker" | "text"; x: number; y: number; w?: number; h?: number; text?: string; n?: number };

function VisionPage() {
  const rah = useRah();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captures, setCaptures] = useState<{ id: string; url: string; blob: Blob }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tool, setTool] = useState<Anno["type"]>("rect");
  const [annos, setAnnos] = useState<Record<string, Anno[]>>({});
  const [history, setHistory] = useState<Record<string, Anno[][]>>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => stopStream(stream), [stream]);
  useEffect(() => { if (videoRef.current && stream) videoRef.current.srcObject = stream; }, [stream]);

  async function share() {
    const s = await requestScreenShare();
    if (!s) return toast.error("Screen sharing cancelled or unsupported.");
    setStream(s);
    s.getVideoTracks()[0]?.addEventListener("ended", () => setStream(null));
  }
  async function capture() {
    if (!videoRef.current) return;
    const blob = await captureFrame(videoRef.current);
    if (!blob) return toast.error("Could not capture frame.");
    const id = uid(); const url = URL.createObjectURL(blob);
    setCaptures((c) => [{ id, url, blob }, ...c]); setActive(id);
  }
  function onUpload(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) { toast.error(`${f.name}: not an image`); continue; }
      const id = uid(); const url = URL.createObjectURL(f);
      setCaptures((c) => [{ id, url, blob: f }, ...c]); setActive(id);
    }
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const it of Array.from(e.clipboardData.items)) {
        if (it.type.startsWith("image/")) {
          const b = it.getAsFile();
          if (b) { const id = uid(); const url = URL.createObjectURL(b); setCaptures((c) => [{ id, url, blob: b }, ...c]); setActive(id); }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function push(id: string, next: Anno[]) {
    setHistory((h) => ({ ...h, [id]: [...(h[id] ?? []), annos[id] ?? []] }));
    setAnnos((a) => ({ ...a, [id]: next }));
  }
  function undo(id: string) {
    setHistory((h) => {
      const list = h[id] ?? []; if (!list.length) return h;
      const prev = list[list.length - 1];
      setAnnos((a) => ({ ...a, [id]: prev }));
      return { ...h, [id]: list.slice(0, -1) };
    });
  }

  function onOverlayDown(e: React.MouseEvent) {
    if (!active || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (tool === "marker") {
      const list = annos[active] ?? [];
      const num = list.filter((a) => a.type === "marker").length + 1;
      push(active, [...list, { type: "marker", x, y, n: num }]);
      return;
    }
    if (tool === "text") {
      const text = prompt("Note text?");
      if (!text) return;
      push(active, [...(annos[active] ?? []), { type: "text", x, y, text }]);
      return;
    }
    dragRef.current = { x, y };
  }
  function onOverlayUp(e: React.MouseEvent) {
    if (!active || !overlayRef.current || !dragRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x2 = ((e.clientX - rect.left) / rect.width) * 100;
    const y2 = ((e.clientY - rect.top) / rect.height) * 100;
    const { x, y } = dragRef.current; dragRef.current = null;
    push(active, [...(annos[active] ?? []), { type: tool as any, x, y, w: x2 - x, h: y2 - y }]);
  }

  async function saveToFiles(cap: { id: string; blob: Blob }) {
    const db = await getDB();
    await db.put("files", {
      id: uid(), name: `capture-${new Date().toISOString()}.png`, mime: "image/png",
      size: cap.blob.size, createdAt: Date.now(), blob: cap.blob,
      projectId: rah.activeProject?.id, tags: ["screen"], folder: "captures", favorite: false,
    });
    toast.success("Saved to Files.");
  }

  const activeCap = captures.find((c) => c.id === active) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Screen Vision</h1>
        <p className="text-muted-foreground">Explicit browser screen sharing, capture and annotation. Nothing starts automatically.</p>
      </header>

      <div className="glass-panel p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={share} disabled={!!stream}><MonitorPlay className="h-4 w-4" /> Start screen share</Button>
          <Button variant="secondary" onClick={() => { stopStream(stream); setStream(null); }} disabled={!stream}>
            <Square className="h-4 w-4" /> Stop
          </Button>
          <Button variant="secondary" onClick={capture} disabled={!stream}><Camera className="h-4 w-4" /> Capture frame</Button>
          <label className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm cursor-pointer hover:bg-accent">
            <Upload className="h-4 w-4" /> Upload images
            <input type="file" hidden accept="image/*" multiple onChange={(e) => onUpload(e.target.files)} />
          </label>
          {stream && (
            <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-primary/60 px-3 py-1 text-xs text-primary pulse-gold">
              ● Sharing live
            </span>
          )}
        </div>
        <div className="aspect-video w-full rounded-md overflow-hidden border bg-black/40 grid place-items-center">
          {stream
            ? <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
            : <p className="text-sm text-muted-foreground">No active screen share. You can also upload or paste screenshots.</p>
          }
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="glass-panel p-3">
          <h2 className="text-sm font-medium mb-2">Captures</h2>
          {captures.length === 0 ? (
            <p className="text-xs text-muted-foreground">No captures yet.</p>
          ) : (
            <ul className="space-y-2 max-h-[480px] overflow-y-auto">
              {captures.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActive(c.id)}
                    className={"w-full rounded-md border p-1 " + (active === c.id ? "border-primary" : "border-border")}
                  >
                    <img src={c.url} alt="capture" className="w-full h-16 object-cover rounded" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass-panel p-3 space-y-3">
          {!activeCap ? (
            <p className="text-sm text-muted-foreground">Select or create a capture to annotate.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {(["rect", "arrow", "marker", "text"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTool(t)}
                    className={"rounded-md border px-2 py-1 " + (tool === t ? "border-primary text-primary" : "")}
                  >{t}</button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => undo(activeCap.id)}>Undo</Button>
                <Button size="sm" variant="ghost" onClick={() => setAnnos((a) => ({ ...a, [activeCap.id]: [] }))}>Clear</Button>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => saveToFiles(activeCap)}>Save to Files</Button>
                  <Button size="sm" variant="ghost" asChild><a href={activeCap.url} download="capture.png"><Download className="h-4 w-4" />Download</a></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCaptures((c) => c.filter((x) => x.id !== activeCap.id)); setActive(null); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="relative aspect-video w-full rounded-md overflow-hidden border">
                <img src={activeCap.url} alt="active capture" className="absolute inset-0 w-full h-full object-contain bg-black" />
                <div
                  ref={overlayRef}
                  className="absolute inset-0 cursor-crosshair"
                  onMouseDown={onOverlayDown}
                  onMouseUp={onOverlayUp}
                >
                  {(annos[activeCap.id] ?? []).map((a, i) => {
                    const s: React.CSSProperties = { position: "absolute", left: `${a.x}%`, top: `${a.y}%` };
                    if (a.type === "rect" || a.type === "arrow") {
                      s.width = `${Math.abs(a.w ?? 0)}%`; s.height = `${Math.abs(a.h ?? 0)}%`;
                      if ((a.w ?? 0) < 0) s.left = `${a.x + (a.w ?? 0)}%`;
                      if ((a.h ?? 0) < 0) s.top = `${a.y + (a.h ?? 0)}%`;
                    }
                    if (a.type === "rect") return <div key={i} style={s} className="border-2 border-primary" />;
                    if (a.type === "arrow") return <div key={i} style={s} className="border-t-2 border-primary" />;
                    if (a.type === "marker") return (
                      <div key={i} style={s} className="-translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs grid place-items-center font-semibold">{a.n}</div>
                    );
                    return <div key={i} style={s} className="rounded bg-primary text-primary-foreground px-1.5 py-0.5 text-xs">{a.text}</div>;
                  })}
                </div>
              </div>
            </>
          )}

          {!rah.prefs.provider && (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              A Vision AI provider is not configured. Capture and annotation work locally.{" "}
              <Link to="/settings" className="text-primary hover:underline">Configure provider →</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}