#!/usr/bin/env node
import { createServer, newPairing } from "./server.js";
import { loadConfig, paths } from "./config.js";
import { BRIDGE_VERSION, DEFAULT_PORT, PAIRING_CODE_TTL_MS } from "./protocol.js";

const port = Number(process.env.RAH_BRIDGE_PORT || DEFAULT_PORT);
const host = "127.0.0.1"; // localhost only, never LAN

const cfg = loadConfig();
const server = createServer(cfg);

server.listen(port, host, () => {
  const banner = "\n" +
    "==================================================================\n" +
    " RAH Desktop Bridge v" + BRIDGE_VERSION + "\n" +
    " Listening on http://" + host + ":" + port + "  (localhost only)\n" +
    " Config: " + paths().configDir + "\n" +
    "==================================================================\n";
  process.stdout.write(banner);
  // Machine-readable ready line for the native supervisor to detect
  // the exact moment the bridge is accepting connections. Any parser
  // MUST tolerate this line vanishing in future versions.
  process.stdout.write(`RAH_BRIDGE_READY port=${port} version=${BRIDGE_VERSION}\n`);

  if (!cfg.deviceToken) {
    const code = newPairing();
    // Machine-readable line for the native supervisor. Contains the
    // six-digit code and its absolute expiry epoch ms. This line is
    // scrubbed by the native redactor before ANY log write.
    process.stdout.write(`RAH_PAIRING_CODE code=${code} expiresAt=${Date.now() + PAIRING_CODE_TTL_MS}\n`);
    process.stdout.write(
      "\n  PAIRING REQUIRED\n" +
      "  Open Raven Command  ->  Connections  ->  Pair Desktop Bridge\n" +
      "  Enter this six-digit code:\n\n" +
      "        " + code + "\n\n" +
      "  Code expires in 5 minutes. Do NOT share it with anyone.\n" +
      "  Close this window to stop the bridge.\n\n"
    );
  } else {
    process.stdout.write("  Status: paired (token stored in config dir)\n\n");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write("Port " + port + " is already in use. Is the bridge already running? Set RAH_BRIDGE_PORT to override.\n");
    process.exit(2);
  }
  process.stderr.write("Server error: " + err.message + "\n");
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { process.stdout.write("\nShutting down...\n"); server.close(() => process.exit(0)); });
}
