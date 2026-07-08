// RAH Desktop Bridge — native status window.
// Only talks to the Rust host through Tauri IPC. Never to any remote origin.
const T = window.__TAURI__;
const invoke = T ? T.core.invoke : async () => ({});

function $(id) { return document.getElementById(id); }

async function refresh() {
  try {
    const s = await invoke("get_status");
    $("state").textContent = s.state_label;
    $("endpoint").textContent = s.endpoint;
    $("app-version").textContent = "v" + s.app_version;
    $("bridge-min").textContent = "v" + s.bridge_min_version;
    const sig = $("signed");
    if (s.signed) { sig.textContent = "Signed"; sig.classList.remove("warn"); }
    else          { sig.textContent = "Unsigned development build"; sig.classList.add("warn"); }

    const pp = $("pairing-panel");
    if (s.pairing && s.pairing.seconds_remaining > 0) {
      pp.classList.remove("hidden");
      $("pairing-code").textContent = s.pairing.code;
      const m = Math.floor(s.pairing.seconds_remaining / 60);
      const sec = s.pairing.seconds_remaining % 60;
      $("pairing-countdown").textContent = `${m}m ${sec}s`;
    } else {
      pp.classList.add("hidden");
    }
  } catch (e) { /* not running inside Tauri */ }

  try {
    $("autostart").checked = await invoke("get_autostart");
  } catch (e) { $("autostart").disabled = true; }
}

$("btn-open"   ).onclick = () => invoke("open_raven_command");
$("btn-start"  ).onclick = () => invoke("start_bridge").then(refresh);
$("btn-stop"   ).onclick = () => invoke("stop_bridge").then(refresh);
$("btn-restart").onclick = () => invoke("restart_bridge").then(refresh);
$("btn-estop"  ).onclick = () => invoke("local_emergency_stop").then(refresh);
$("btn-resume" ).onclick = () => invoke("resume_bridge").then(refresh);
$("btn-logs"   ).onclick = () => invoke("open_logs_folder");
$("btn-quit"   ).onclick = () => invoke("quit_app");
$("autostart"  ).onchange = (e) => invoke("set_autostart", { enabled: e.target.checked }).then(refresh);

refresh();
setInterval(refresh, 1000);