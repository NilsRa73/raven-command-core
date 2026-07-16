import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CATALOG, filterCatalog, landedCost, adjustedQuality,
  buildComparison, loadShortlist, toggleShortlist,
  type Product,
} from "@/lib/rah/shopping";

export const Route = createFileRoute("/shopping")({
  head: () => ({
    meta: [
      { title: "Shopping — Raven Hub" },
      { name: "description", content: "Curated research surface. Quality scores, landed cost, and shortlists." },
    ],
  }),
  component: ShoppingPage,
});

const CATEGORIES = ["All", "Desk", "Seating", "Lighting", "Network", "Audio", "VR", "Home Mesh", "Environment"];

function ShoppingPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => { setShortlist(loadShortlist()); }, []);

  const items = useMemo(() => filterCatalog(CATALOG, q, cat), [q, cat]);
  const shortlistItems = useMemo(() => CATALOG.filter((p) => shortlist.includes(p.id)), [shortlist]);
  const comparison = useMemo(() => {
    if (shortlistItems.length < 2) return null;
    try { return buildComparison(shortlistItems.slice(0, 4)); } catch { return null; }
  }, [shortlistItems]);

  function pin(id: string) {
    const cur = loadShortlist();
    if (!cur.includes(id) && cur.length >= 4) {
      toast.warning("Shortlist limit is 4. Remove one to add another.");
      return;
    }
    setShortlist(toggleShortlist(id));
  }

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="min-w-0">
          <h1 className="display text-3xl gold-text">Shopping</h1>
          <p className="text-muted-foreground">
            Research surface. Nothing is purchased automatically — Raven only compares and shortlists.
          </p>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mt-1">
            Supplier and country of origin are always shown.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant={compareOpen ? "default" : "outline"} onClick={() => setCompareOpen((o) => !o)} disabled={shortlistItems.length < 2}>
            Compare ({shortlistItems.length})
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input placeholder="Search catalog…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} onClick={() => setCat(c)}>{c}</Button>
          ))}
        </div>
      </div>

      {compareOpen && comparison && (
        <Card className="p-4 rune-tile overflow-x-auto">
          <h2 className="display text-lg mb-2">Comparison</h2>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left py-2">Field</th>
                {comparison.rows.map((r) => (<th key={r.id} className="text-left py-2">{r.name}</th>))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Price", (r: any) => `$${r.priceUsd}`],
                ["Shipping", (r: any) => `$${r.shippingUsd}`],
                ["Landed cost", (r: any) => `$${r.landed}`],
                ["Quality", (r: any) => `${r.quality}`],
                ["Adjusted", (r: any) => `${r.adjusted}`],
                ["Origin", (r: any) => r.origin],
                ["Supplier", (r: any) => r.supplier],
                ["Risks", (r: any) => r.risks.join(", ") || "—"],
              ].map(([label, fn]) => (
                <tr key={label as string} className="border-t border-border/40">
                  <td className="py-2 text-muted-foreground">{label as string}</td>
                  {comparison.rows.map((r) => (<td key={r.id} className="py-2">{(fn as (r: any) => string)(r)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <ProductCard key={p.id} p={p} pinned={shortlist.includes(p.id)} onPin={() => pin(p.id)} />
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No products match.</p>}
      </div>
    </div>
  );
}

function ProductCard({ p, pinned, onPin }: { p: Product; pinned: boolean; onPin: () => void }) {
  return (
    <Card className="p-4 space-y-3 rune-tile">
      <div className="flex items-start gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-primary/30 text-primary text-2xl bg-background/40">🜛</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="display text-lg truncate">{p.name}</h3>
            <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">Q {adjustedQuality(p)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{p.category} · {p.supplier} · {p.origin}</p>
        </div>
        <div className="text-right">
          <div className="text-lg gold-text">${landedCost(p)}</div>
          <div className="text-[11px] text-muted-foreground">landed</div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{p.reviewSummary}</p>
      {p.compatibility.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Compatible: {p.compatibility.join(", ")}</p>
      )}
      {p.risks.length > 0 && (
        <p className="text-[11px] text-amber-400">Risk: {p.risks.join(", ")}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant={pinned ? "default" : "outline"} onClick={onPin}>{pinned ? "★ Shortlisted" : "☆ Shortlist"}</Button>
        <Button size="sm" variant="ghost" onClick={() => toast.info("View in Room — Quest 3 spatial preview is planned.")}>View in Room</Button>
      </div>
    </Card>
  );
}