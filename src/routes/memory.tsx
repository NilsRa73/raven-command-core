import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { toast } from "sonner";
import {
  MEMORY_TYPES, MEMORY_TYPE_LABEL,
  filterMemories, bucketToday, bucketRecent, bucketPinned, bucketByProject,
  memoryDiagnostics,
} from "@/lib/rah/projectMemory";
import type { MemoryType, ProjectMemoryRecord } from "@/lib/rah/projectMemory";
import { Pin, Archive, ArchiveRestore, Trash2, Pencil, Plus, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/memory")({
  head: () => ({ meta: [{ title: "Project Memory — Raven Command" }] }),
  component: MemoryPage,
});

function MemoryPage() {
  const rah = useRah();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | MemoryType>("all");
  const [projectFilter, setProjectFilter] = useState<"all" | "global" | string>("all");
  const [editing, setEditing] = useState<ProjectMemoryRecord | null>(null);
  const [showNew, setShowNew] = useState(false);

  const projectId = projectFilter === "all" ? undefined
    : projectFilter === "global" ? null
    : projectFilter;
  const filtered = useMemo(
    () => filterMemories(rah.projectMemory, {
      q,
      types: typeFilter === "all" ? undefined : [typeFilter],
      projectId,
    }),
    [rah.projectMemory, q, typeFilter, projectId],
  );

  const today = bucketToday(filtered);
  const recent = bucketRecent(filtered).filter((r) => !today.find((t) => t.id === r.id));
  const pinned = bucketPinned(filtered);
  const grouped = bucketByProject(filtered);
  const diag = memoryDiagnostics(rah.projectMemory);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="display text-3xl gold-text">Project Memory</h1>
          <p className="text-muted-foreground">Local-only. Nothing leaves your browser. Raven uses this to resume work.</p>
        </div>
        <Button className="ml-auto" onClick={() => { setEditing(null); setShowNew(true); }}>
          <Plus className="h-4 w-4" /> New memory
        </Button>
        <Link
          to="/backup"
          className="rounded border border-border/60 px-3 py-2 text-sm hover:bg-muted/40"
        >
          Backup & Restore
        </Link>
      </header>

      <div className="glass-panel gold-border p-3 grid gap-2 md:grid-cols-[1fr_180px_220px]">
        <Input placeholder="Search title, content, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {MEMORY_TYPES.map((t) => <SelectItem key={t} value={t}>{MEMORY_TYPE_LABEL[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={(v) => setProjectFilter(v)}>
          <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            <SelectItem value="global">Global (no project)</SelectItem>
            {rah.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.icon} {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {(showNew || editing) && (
        <MemoryEditor
          initial={editing ?? undefined}
          projects={rah.projects}
          activeProjectId={rah.activeProject?.id ?? null}
          onCancel={() => { setShowNew(false); setEditing(null); }}
          onSave={async (draft) => {
            if (editing) {
              await rah.updateProjectMemory(editing.id, draft);
              toast.success("Memory updated");
            } else {
              await rah.createProjectMemory({ ...draft, source: "manual" });
              toast.success("Memory saved");
            }
            setShowNew(false); setEditing(null);
          }}
        />
      )}

      <Section title="Pinned" records={pinned} onEdit={setEditing} rah={rah} />
      <Section title="Today" records={today} onEdit={setEditing} rah={rah} />
      <Section title="Recent (7 days)" records={recent} onEdit={setEditing} rah={rah} />

      <section className="glass-panel p-4 space-y-3">
        <h2 className="display text-lg">By project</h2>
        {[...grouped.entries()].map(([key, rows]) => {
          const proj = rah.projects.find((p) => p.id === key);
          const label = proj ? `${proj.icon} ${proj.name}` : "Global (no project)";
          return (
            <div key={key} className="border-t border-border/40 pt-2">
              <div className="text-xs uppercase tracking-widest text-primary mb-1">{label}</div>
              <RecordList records={rows} onEdit={setEditing} rah={rah} />
            </div>
          );
        })}
        {grouped.size === 0 && <p className="text-sm text-muted-foreground">No memories match filters.</p>}
      </section>

      <section className="glass-panel p-4 space-y-2">
        <h2 className="display text-lg">Diagnostics</h2>
        <p className="text-xs text-muted-foreground">Counts only. Contents are never logged.</p>
        <div className="grid gap-2 md:grid-cols-4 text-sm">
          <Stat k="Total" v={diag.total} />
          <Stat k="Pinned" v={diag.pinned} />
          <Stat k="Archived" v={diag.archived} />
          <Stat k="Global (no project)" v={diag.global} />
        </div>
        <div className="grid gap-1 md:grid-cols-4 text-xs mt-2">
          {MEMORY_TYPES.map((t) => (
            <div key={t} className="flex justify-between rounded border border-border/50 px-2 py-1">
              <span className="text-muted-foreground">{MEMORY_TYPE_LABEL[t]}</span>
              <span className="text-primary">{diag.byType[t]}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="rounded border border-border/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="text-xl gold-text display">{v}</div>
    </div>
  );
}

function Section({
  title, records, onEdit, rah,
}: { title: string; records: ProjectMemoryRecord[]; onEdit: (r: ProjectMemoryRecord) => void; rah: ReturnType<typeof useRah> }) {
  if (!records.length) return null;
  return (
    <section className="glass-panel p-4 space-y-2">
      <h2 className="display text-lg">{title} <span className="text-xs text-muted-foreground">({records.length})</span></h2>
      <RecordList records={records} onEdit={onEdit} rah={rah} />
    </section>
  );
}

function RecordList({
  records, onEdit, rah,
}: { records: ProjectMemoryRecord[]; onEdit: (r: ProjectMemoryRecord) => void; rah: ReturnType<typeof useRah> }) {
  return (
    <ul className="divide-y divide-border/50">
      {records.map((r) => {
        const proj = r.projectId ? rah.projects.find((p) => p.id === r.projectId) : null;
        return (
          <li key={r.id} className="py-2 flex items-start gap-3">
            <span className="mt-0.5 text-[10px] uppercase tracking-widest text-primary min-w-[80px]">
              {MEMORY_TYPE_LABEL[r.type as MemoryType] ?? r.type}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                {r.pinned && <span className="mr-1 text-primary">★</span>}
                {r.title}
              </div>
              {r.content && <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{r.content}</div>}
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {new Date(r.updatedAt).toLocaleString()} · {proj ? `${proj.icon} ${proj.name}` : "global"}
                {r.tags.length ? " · " + r.tags.join(", ") : ""}
                {r.archived && " · archived"}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" title="Pin" onClick={() => rah.togglePinProjectMemory(r.id)}>
                <Pin className={"h-4 w-4 " + (r.pinned ? "text-primary" : "")} />
              </Button>
              <Button size="sm" variant="ghost" title={r.archived ? "Unarchive" : "Archive"} onClick={() => rah.toggleArchiveProjectMemory(r.id)}>
                {r.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="ghost" title="Edit" onClick={() => onEdit(r)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" title="Delete" onClick={() => {
                if (confirm("Delete this memory?")) void rah.deleteProjectMemory(r.id);
              }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MemoryEditor({
  initial, projects, activeProjectId, onCancel, onSave,
}: {
  initial?: ProjectMemoryRecord;
  projects: { id: string; name: string; icon: string }[];
  activeProjectId: string | null;
  onCancel: () => void;
  onSave: (draft: Omit<ProjectMemoryRecord, "id" | "createdAt" | "updatedAt">) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [type, setType] = useState<MemoryType>(initial?.type ?? "note");
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? activeProjectId);
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  return (
    <div className="glass-panel gold-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="display text-lg">{initial ? "Edit memory" : "New memory"}</div>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-4 w-4" /></Button>
      </div>
      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea rows={4} placeholder="Content (optional)" value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="grid gap-2 md:grid-cols-3">
        <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MEMORY_TYPES.map((t) => <SelectItem key={t} value={t}>{MEMORY_TYPE_LABEL[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={projectId ?? "__global__"} onValueChange={(v) => setProjectId(v === "__global__" ? null : v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__global__">Global (no project)</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.icon} {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned
      </label>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => {
          if (!title.trim()) { toast.error("Title required"); return; }
          void onSave({
            title: title.trim(),
            content: content.trim(),
            type,
            projectId,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
            pinned,
            archived: initial?.archived ?? false,
            source: initial?.source ?? "manual",
          });
        }}>Save</Button>
      </div>
    </div>
  );
}
