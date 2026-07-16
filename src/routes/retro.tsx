import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/retro")({
  head: () => ({ meta: [
    { title: "Retro / Games — Raven Hub" },
    { name: "description", content: "Local game scoreboard. RAH Gammon integration is planned." },
  ] }),
  component: RetroPage,
});

const KEY = "rah.retro.scores.v1";
interface Score { id: string; game: string; player: string; score: number; ts: number }

function RetroPage() {
  const [scores, setScores] = useState<Score[]>([]);
  const [game, setGame] = useState("Backgammon");
  const [player, setPlayer] = useState("");
  const [score, setScore] = useState("");
  useEffect(() => { try { const raw = localStorage.getItem(KEY); setScores(raw ? JSON.parse(raw) : []); } catch { /* ignore */ } }, []);
  function save(next: Score[]) { setScores(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } }
  function add() {
    const n = Number(score);
    if (!player.trim() || !Number.isFinite(n)) return;
    save([{ id: `s_${Date.now()}`, game, player: player.trim(), score: n, ts: Date.now() }, ...scores].slice(0, 100));
    setPlayer(""); setScore("");
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Retro & Games</h1>
        <p className="text-muted-foreground">Prototype scoreboard. RAH Gammon opponent will plug in here.</p>
      </header>
      <Card className="p-4 rune-tile grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
        <Input placeholder="Game" value={game} onChange={(e) => setGame(e.target.value)} />
        <Input placeholder="Player" value={player} onChange={(e) => setPlayer(e.target.value)} />
        <Input placeholder="Score" value={score} onChange={(e) => setScore(e.target.value)} />
        <Button onClick={add}>Log</Button>
      </Card>
      <Card className="p-4 rune-tile">
        {scores.length === 0 ? <p className="text-sm text-muted-foreground">No scores yet.</p> :
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-muted-foreground">
              <tr><th className="text-left py-2">When</th><th className="text-left">Game</th><th className="text-left">Player</th><th className="text-right">Score</th></tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id} className="border-t border-border/40">
                  <td className="py-2 text-muted-foreground">{new Date(s.ts).toLocaleString()}</td>
                  <td>{s.game}</td><td>{s.player}</td><td className="text-right gold-text">{s.score}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </Card>
    </div>
  );
}