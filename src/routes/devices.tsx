import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useBridgeStatus, refreshBridgeStatus } from "@/lib/rah/bridgeStatus";
import { bridgeSystemStatus, bridgeHealth } from "@/lib/rah/bridge";
import type { BridgeSystemStatus } from "@/lib/rah/bridge-protocol";
import {
  bridgeDeviceRecord, loadManualDevices, saveManualDevices,
  createManualDevice, updateManualDevice, removeManualDevice,
  mergeDevices, DEVICE_ROLES, DEVICE_ROLE_HINTS, CONNECTION_TYPES,
  type DeviceRecord,
} from "@/lib/rah/devices";
import { toast } from "sonner";

export const Route = createFileRoute("/devices")({ component: DevicesPage });

function StatusPill({ status }: { status: DeviceRecord["status"] }) {
  const cls = status === "Connected" ? "border-primary/60 bg-primary/10 text-primary"
    : status === "Offline" ? "border-destructive/60 bg-destructive/10 text-destructive"
    : status === "Planned" ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-400"
    : "border-border/60 text-muted-foreground";
  return <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + cls}>{status}</span>;
}

function DevicesPage() {
  const { snapshot, refresh } = useBridgeStatus();
  const [sys, setSys] = useState<BridgeSystemStatus | null>(null);
  const [manual, setManual] = useState<DeviceRecord[]>(() => loadManualDevices());
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { void refreshBridgeStatus(); }, []);
  useEffect(() => {
    let cancel = false;
    if (snapshot?.ui === "paired_online") {
      bridgeSystemStatus().then((s) => { if (!cancel) setSys(s); }).catch(() => setSys(null));
    } else { setSys(null); }
    return () => { cancel = true; };
  }, [snapshot?.ui, snapshot?.version]);

  const bridgeDevice = useMemo(
    () => bridgeDeviceRecord({ snapshot, sys, allowedRoots: null }),
    [snapshot, sys],
  );
  const devices = useMemo(() => mergeDevices(bridgeDevice, manual), [bridgeDevice, manual]);
  const openDevice = devices.find((d) => d.id === openId) ?? null;

  // Cluster overview: counts by status and by role — purely derived.
  const cluster = useMemo(() => {
    const byStatus = { Connected: 0, Offline: 0, Planned: 0, Unknown: 0 };
    const byRole = new Map<string, number>();
    for (const d of devices) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      byRole.set(d.role, (byRole.get(d.role) ?? 0) + 1);
    }
    return { total: devices.length, byStatus, roles: [...byRole.entries()] };
  }, [devices]);

  function persist(next: DeviceRecord[]) { setManual(next); saveManualDevices(next); }

  async function testBridge() {
    const h = await bridgeHealth();
    if (h.state === "online") toast.success(`Bridge responded in ${h.latencyMs ?? "?"} ms.`);
    else toast.error(`Bridge unreachable: ${h.message ?? h.state}`);
    void refresh();
  }

  return (
    <div className="space-y-4">
      <header className="glass-panel gold-border p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Raven One · Alpha 0.1</div>
          <h1 className="display text-2xl gold-text">Device Center</h1>
          <p className="text-xs text-muted-foreground mt-1">
            One place for every machine that runs Raven. Live status comes from the paired Desktop Bridge; planned devices you add here are honest placeholders.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => refresh()} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Refresh devices</button>
          <button onClick={() => void testBridge()} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Test bridge</button>
          <button onClick={() => setShowAdd(true)} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">＋ Add device</button>
        </div>
      </header>

      {devices.length > 0 && (
        <section className="glass-panel p-4" aria-label="Cluster overview">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="display text-sm uppercase tracking-widest text-muted-foreground">Raven Cluster</h2>
            <span className="text-[11px] text-muted-foreground">Foundation for multi-device Raven. Only real telemetry is shown as connected.</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2"><div className="text-[10px] uppercase text-muted-foreground">Connected</div><div className="text-primary text-lg font-semibold">{cluster.byStatus.Connected}</div></div>
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2"><div className="text-[10px] uppercase text-muted-foreground">Offline</div><div className="text-destructive text-lg font-semibold">{cluster.byStatus.Offline}</div></div>
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2"><div className="text-[10px] uppercase text-muted-foreground">Planned</div><div className="text-yellow-400 text-lg font-semibold">{cluster.byStatus.Planned}</div></div>
            <div className="rounded-md border border-border/60 p-2"><div className="text-[10px] uppercase text-muted-foreground">Total nodes</div><div className="text-foreground text-lg font-semibold">{cluster.total}</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {cluster.roles.map(([role, count]) => {
              const label = DEVICE_ROLES.find((r) => r.id === role)?.label ?? role;
              return <span key={role} className="rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground">{label}: <span className="text-foreground">{count}</span></span>;
            })}
          </div>
        </section>
      )}

      {devices.length === 0 && (
        <section className="glass-panel p-6 text-center">
          <h2 className="display text-lg gold-text">No devices yet</h2>
          <p className="text-xs text-muted-foreground mt-2">Pair the Desktop Bridge to see this workstation appear here, or add planned nodes manually.</p>
          <ul className="mt-4 text-xs text-muted-foreground max-w-md mx-auto text-left space-y-1">
            {DEVICE_ROLE_HINTS.map((h, i) => <li key={i}>• {h}</li>)}
          </ul>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/connections" className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Open Connections</Link>
            <button onClick={() => setShowAdd(true)} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">＋ Add device</button>
          </div>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((d) => (
          <button key={d.id} onClick={() => setOpenId(d.id)} className="glass-panel p-4 text-left hover:border-primary/60 border border-border/60">
            <div className="flex items-center gap-2">
              <div className="display text-base truncate flex-1">{d.displayName}</div>
              <StatusPill status={d.status} />
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              {DEVICE_ROLES.find((r) => r.id === d.role)?.label ?? d.role} · {d.connectionType}
            </div>
            {d.telemetry ? (
              <dl className="mt-3 grid grid-cols-2 gap-1 text-[11px]">
                <dt className="text-muted-foreground">CPU</dt><dd>{d.telemetry.cores ? d.telemetry.cores + " cores" : "—"}</dd>
                <dt className="text-muted-foreground">Memory</dt>
                <dd>{d.telemetry.totalGB ? `${(d.telemetry.usedGB ?? 0).toFixed(1)}/${d.telemetry.totalGB.toFixed(1)} GB` : "—"}</dd>
                <dt className="text-muted-foreground">Bridge</dt><dd>{d.telemetry.bridgeVersion ? "v" + d.telemetry.bridgeVersion : "—"}</dd>
                <dt className="text-muted-foreground">Latency</dt><dd>{d.telemetry.latencyMs != null ? d.telemetry.latencyMs + " ms" : "—"}</dd>
              </dl>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{d.notes || "Planned device — no telemetry."}</p>
            )}
          </button>
        ))}
      </div>

      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onCreate={(patch) => { persist([...manual, createManualDevice(patch)]); setShowAdd(false); }}
        />
      )}
      {openDevice && (
        <DeviceDrawer
          device={openDevice}
          onClose={() => setOpenId(null)}
          onSave={(patch) => { if (openDevice.kind === "manual") persist(updateManualDevice(manual, openDevice.id, patch)); }}
          onRemove={() => { if (openDevice.kind === "manual") { persist(removeManualDevice(manual, openDevice.id)); setOpenId(null); } }}
        />
      )}
    </div>
  );
}

function AddDeviceModal({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Partial<DeviceRecord>) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<DeviceRecord["role"]>("development");
  const [conn, setConn] = useState("Planned");
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel gold-border p-4 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="display gold-text text-lg">Add device</h2>
        <p className="text-[11px] text-muted-foreground">Manual entries start as “Planned”. Raven never claims a device is online without live telemetry.</p>
        <div className="mt-3 space-y-2 text-xs">
          <label className="block">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full h-8 rounded-md border border-border/70 bg-background/40 px-2" placeholder="e.g. AI Core desktop" /></label>
          <label className="block">Role
            <select value={role} onChange={(e) => setRole(e.target.value as DeviceRecord["role"])} className="mt-1 w-full h-8 rounded-md border border-border/70 bg-background/40 px-2">
              {DEVICE_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">Connection type
            <select value={conn} onChange={(e) => setConn(e.target.value)} className="mt-1 w-full h-8 rounded-md border border-border/70 bg-background/40 px-2">
              {CONNECTION_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border/70 bg-background/40 px-2 py-1" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 rounded-md border border-border/70 px-3 text-xs">Cancel</button>
          <button disabled={!name.trim()} onClick={() => onCreate({ displayName: name.trim(), role, connectionType: conn, notes })} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">Add device</button>
        </div>
      </div>
    </div>
  );
}

function DeviceDrawer({ device, onClose, onSave, onRemove }: {
  device: DeviceRecord;
  onClose: () => void;
  onSave: (patch: Partial<DeviceRecord>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(device.displayName);
  const [role, setRole] = useState(device.role);
  const [notes, setNotes] = useState(device.notes ?? "");
  const [enabled, setEnabled] = useState(device.enabled);
  const isBridge = device.kind === "bridge";
  return (
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel gold-border p-4 max-w-lg w-full max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{isBridge ? "Live · read-only" : "Manual entry"}</div>
            <h2 className="display gold-text text-lg truncate">{device.displayName}</h2>
          </div>
          <StatusPill status={device.status} />
        </div>

        {device.telemetry && (
          <section className="mt-3">
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Telemetry</h3>
            <dl className="grid grid-cols-2 gap-1 text-xs">
              <dt className="text-muted-foreground">Hostname</dt><dd>{device.telemetry.hostname}</dd>
              <dt className="text-muted-foreground">User</dt><dd>{device.telemetry.username}</dd>
              <dt className="text-muted-foreground">Platform</dt><dd>{device.telemetry.platform}{device.telemetry.arch ? " · " + device.telemetry.arch : ""}</dd>
              <dt className="text-muted-foreground">Release</dt><dd>{device.telemetry.release ?? "—"}</dd>
              <dt className="text-muted-foreground">CPU cores</dt><dd>{device.telemetry.cores ?? "—"}</dd>
              <dt className="text-muted-foreground">Memory</dt><dd>{device.telemetry.totalGB ? `${(device.telemetry.usedGB ?? 0).toFixed(1)}/${device.telemetry.totalGB.toFixed(1)} GB` : "—"}</dd>
              <dt className="text-muted-foreground">Bridge</dt><dd>{device.telemetry.bridgeVersion ? "v" + device.telemetry.bridgeVersion : "—"}</dd>
              <dt className="text-muted-foreground">Latency</dt><dd>{device.telemetry.latencyMs != null ? device.telemetry.latencyMs + " ms" : "—"}</dd>
              <dt className="text-muted-foreground">Last seen</dt><dd>{device.lastSeen ? new Date(device.lastSeen).toLocaleString() : "—"}</dd>
            </dl>
          </section>
        )}

        <section className="mt-4 space-y-2 text-xs">
          <label className="block">Display name
            <input value={name} disabled={isBridge} onChange={(e) => setName(e.target.value)} className="mt-1 w-full h-8 rounded-md border border-border/70 bg-background/40 px-2 disabled:opacity-60" />
          </label>
          <label className="block">Role
            <select value={role} disabled={isBridge} onChange={(e) => setRole(e.target.value as DeviceRecord["role"])} className="mt-1 w-full h-8 rounded-md border border-border/70 bg-background/40 px-2 disabled:opacity-60">
              {DEVICE_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">Notes
            <textarea value={notes} disabled={isBridge} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border/70 bg-background/40 px-2 py-1 disabled:opacity-60" />
          </label>
          {!isBridge && (
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-3 w-3 accent-primary" /> Enabled
            </label>
          )}
        </section>

        <section className="mt-4 rounded-md border border-border/60 bg-background/40 p-3 text-[11px] text-muted-foreground">
          Security scope: Raven never issues remote execution, keyboard/mouse control, shell or registry access from this screen. All bridge actions still require approval.
        </section>

        <div className="mt-4 flex justify-between items-center gap-2">
          {!isBridge ? (
            <button onClick={onRemove} className="h-8 rounded-md border border-destructive/60 text-destructive px-3 text-xs">Remove device</button>
          ) : <span className="text-[11px] text-muted-foreground">Bridge device is managed by pairing.</span>}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 rounded-md border border-border/70 px-3 text-xs">Close</button>
            {!isBridge && (
              <button onClick={() => { onSave({ displayName: name, role, notes, enabled }); onClose(); }} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Save</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}