import os from "node:os";
import { BRIDGE_VERSION } from "./protocol.js";

const started = Date.now();

export function systemStatus() {
  const cpus = os.cpus() || [];
  const total = os.totalmem();
  const free = os.freemem();
  return {
    bridgeVersion: BRIDGE_VERSION,
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    uptimeSec: Math.floor(os.uptime()),
    processUptimeSec: Math.floor((Date.now() - started) / 1000),
    cpu: { model: cpus[0]?.model ?? "unknown", cores: cpus.length, loadAvg: os.loadavg() },
    memory: { totalBytes: total, freeBytes: free, usedBytes: total - free },
    network: Object.entries(os.networkInterfaces()).map(([name, addrs]) => ({
      name,
      addresses: (addrs || []).filter((a) => !a.internal).map((a) => ({ family: a.family, cidr: a.cidr })),
    })),
  };
}
