import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDB, storageEstimate, uid, type FileItem } from "@/lib/rah/db";
import { useRah } from "@/lib/rah/context";
import { Trash2, Star, Download } from "lucide-react";

export const Route = createFileRoute("/files")({
  head: () => ({ meta: [{ title: "Files & Knowledge — RAH Listen Key" }] }),
  component: FilesPage,
});

function FilesPage() {
  const rah = useRah();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{ url: string; file: FileItem } | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

  async function reload() {
    const db = await getDB();
    setFiles((await db.getAll("files")).sort((a, b) => b.createdAt - a.createdAt));
    const est = await storageEstimate();
    if (est) setUsage({ used: est.usage ?? 0, quota: est.quota ?? 0 });
  }
  useEffect(() => { void reload(); }, []);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const db = await getDB();
    for (const f of Array.from(e.dataTransfer.files)) {
      await db.put("files", { id: uid(), name: f.name, mime: f.type, size: f.size, createdAt: Date.now(), blob: f, projectId: rah.activeProject?.id, tags: [], favorite: false });
    }
    toast.success("Files added"); await reload();
  }

  async function del(id: string) { const db = await getDB(); await db.delete("files", id); await reload(); }
  async function fav(f: FileItem) { const db = await getDB(); await db.put("files", { ...f, favorite: !f.favorite }); await reload(); }

  const list = files.filter((f) => (f.name + " " + f.tags.join(" ")).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="display text-3xl">Files & Knowledge</h1>
          <p className="text-muted-foreground">Stored locally on this device (IndexedDB). Nothing uploads without your action.</p>
        </div>
        <label className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm cursor-pointer hover:bg-accent">
          Add files
          <input type="file" hidden multiple onChange={async (e) => {
            if (!e.target.files) return; const db = await getDB();
            for (const f of Array.from(e.target.files)) {
              await db.put("files", { id: uid(), name: f.name, mime: f.type, size: f.size, createdAt: Date.now(), blob: f, projectId: rah.activeProject?.id, tags: [], favorite: false });
            }
            e.target.value = ""; await reload();
          }} />
        </label>
      </header>

      {usage && (
        <div className="glass-panel p-3 text-xs text-muted-foreground">
          Local storage used: {(usage.used / 1024 / 1024).toFixed(1)} MB of ~{(usage.quota / 1024 / 1024).toFixed(0)} MB estimated by the browser.
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files & tags…" className="max-w-sm" />

      <div className="glass-panel border-dashed border p-6 text-center text-sm text-muted-foreground">
        Drop files anywhere on this page to add them.
      </div>

      <div className="glass-panel divide-y divide-border/60">
        {list.length === 0 && <p className="p-4 text-sm text-muted-foreground">No files yet.</p>}
        {list.map((f) => (
          <div key={f.id} className="p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{f.name}</div>
              <div className="text-[11px] text-muted-foreground">{f.mime || "file"} · {(f.size / 1024).toFixed(1)} KB · {new Date(f.createdAt).toLocaleString()}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => fav(f)}><Star className={"h-4 w-4 " + (f.favorite ? "text-primary fill-primary" : "")} /></Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview({ url: URL.createObjectURL(f.blob), file: f })}>Preview</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              const u = URL.createObjectURL(f.blob); const a = document.createElement("a");
              a.href = u; a.download = f.name; a.click(); URL.revokeObjectURL(u);
            }}><Download className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => del(f.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>
          <div className="max-w-4xl w-full max-h-[85vh] overflow-auto glass-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-3">
              <div className="font-semibold truncate">{preview.file.name}</div>
              <Button variant="ghost" className="ml-auto" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>Close</Button>
            </div>
            {preview.file.mime.startsWith("image/") ? <img src={preview.url} alt={preview.file.name} className="max-h-[70vh] mx-auto" />
              : preview.file.mime.startsWith("audio/") ? <audio controls src={preview.url} className="w-full" />
              : preview.file.mime.startsWith("video/") ? <video controls src={preview.url} className="w-full max-h-[70vh]" />
              : <iframe src={preview.url} title={preview.file.name} className="w-full h-[70vh] rounded bg-white" />}
          </div>
        </div>
      )}
    </div>
  );
}