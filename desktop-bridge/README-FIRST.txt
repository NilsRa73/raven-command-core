RAH Desktop Bridge v0.2.2
=========================

What this is
------------
A tiny local companion service that lets Raven Command perform limited,
user-approved actions on THIS PC. It listens only on 127.0.0.1
(localhost); it never opens a LAN or internet port.

What you need
-------------
- Windows 10 or 11
- Node.js 20 or later (https://nodejs.org)

How to start
------------
1. Extract this ZIP anywhere (e.g. Documents).
2. Double-click "Start RAH Desktop Bridge.cmd".
3. A six-digit pairing code appears in the black window.
4. Open Raven Command  ->  Connections  ->  "Pair Desktop Bridge".
5. Type the code. That's it — the code expires in five minutes and
   is single-use.

Stopping
--------
Close the black window, or double-click "stop.cmd".

Config location
---------------
%LOCALAPPDATA%\RAH\DesktopBridge\

That folder holds your device token and an audit log of every request.
Never share the config folder or its contents.

Local AI proxy (v0.2.1)
-----------------------
The bridge can proxy authenticated calls from Raven Command to LM Studio
and Ollama running on THIS PC, so the browser does not need to talk to
those local ports directly (no CORS setup required).

Safe text-file writes (v0.2.2)
------------------------------
Raven Command's "Continue Project" workflow can, with a per-run approval,
write and append small UTF-8 text files inside an approved root
(files.writeText / files.appendText). Limits:
  - max 256 KB per write
  - extension must be in the read-text allowlist (.md, .txt, .json, …)
  - hidden dotfiles and known credential/system basenames are refused
  - overwrites first create a ".rah-backup-<timestamp>" sidecar

- LM Studio: http://127.0.0.1:1234/v1     (start its Local Server)
- Ollama:    http://127.0.0.1:11434        (installed and running)

Only these two loopback destinations are permitted. The bridge is NOT an
open proxy — arbitrary hosts are rejected. Prompt contents are never
logged; audit records provider, endpoint, status, latency, and model id.

Security in this release
------------------------
- All requests use bearer-token authentication plus HMAC signing with
  a replay-protection nonce and short expiry.
- The bridge binds only to 127.0.0.1 — no LAN, no internet.
- File operations are limited to approved roots (Desktop, Documents,
  Downloads, Pictures, Videos, Music) and cannot escape them.
- Deletes send to the Recycle Bin only. Permanent deletion is not
  available in v0.1.0.
- Program launch is DISABLED in v0.1.0. Opening files or URLs is
  allowed but every launch requires an approval card in Raven Command.
- Arbitrary PowerShell/CMD/registry/credential/microphone/webcam
  access is DISABLED.
- Screenshot capture is intentionally NOT implemented in this release
  and returns a clear "not_implemented" response. Use Raven Screen
  Vision in the browser instead.

Support
-------
Delete the config folder above and re-launch to reset the bridge.
