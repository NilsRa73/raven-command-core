// Tauri 2 IPC — talks to the Rust host through window.__TAURI__.core.
// Never talks to any remote origin.
const { invoke } = window.__TAURI__ ? window.__TAURI__.core : { invoke: async () => ({}) };

async function refresh() {
  try {
    const s = await invoke("get_status");
    document.getElementById("state").textContent = s.state_label;
    document.getElementById("endpoint").textContent = s.endpoint;
    document.getElementById("app-version").textContent = s.app_version;
    document.getElementById("bridge-version").textContent = s.bridge_version;
    const sig = document.getElementById("signed");
    if (s.signed) { sig.textContent = "Signed"; sig.classList.remove("warn"); }
    else          { sig.textContent = "Unsigned development build"; sig.classList.add("warn"); }
  } catch (e) { /* not running inside Tauri (e.g. plain preview) */ }
}
document.getElementById("btn-open" ).onclick = () => invoke("open_raven_command");
document.getElementById("btn-start").onclick = () => invoke("start_bridge").then(refresh);
document.getElementById("btn-stop" ).onclick = () => invoke("stop_bridge" ).then(refresh);
document.getElementById("btn-estop").onclick = () => invoke("emergency_stop").then(refresh);
refresh();
setInterval(refresh, 2000);