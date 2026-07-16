import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/vr")({
  head: () => ({ meta: [
    { title: "VR Room — Raven Hub" },
    { name: "description", content: "Quest 3 spatial workspace roadmap for Raven agents." },
  ] }),
  component: VrPage,
});

function VrPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">VR Room</h1>
        <p className="text-muted-foreground">Planned spatial workspace for Raven agents on Quest 3.</p>
      </header>
      <Card className="p-6 rune-tile space-y-3">
        <p>The Quest 3 room will let you place project boards in physical space, drag files between screens, and speak commands with head tracking.</p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>Native passthrough with anchor persistence</li>
          <li>Raven Bridge sync for shared devices</li>
          <li>Voice control tied to the same Raven persona</li>
        </ul>
        <p className="text-xs text-muted-foreground">Prototype ships alongside Raven Bridge v0.3.</p>
      </Card>
    </div>
  );
}