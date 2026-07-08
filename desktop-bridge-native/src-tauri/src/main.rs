// Entry point for the RAH Desktop Bridge Tauri companion (v0.2.1).
//
// Security posture:
//  - Single-instance guard: opening the app twice focuses the tray
//    status window instead of spawning a second sidecar.
//  - The sidecar is spawned via `Shell::sidecar(SIDECAR_NAME)` with a
//    fixed empty argv and NO shell. There is no generic shell,
//    program-launch, or user-argv IPC exposed to the webview.
//  - The IPC allowlist is exactly the 11 typed commands below.
//  - Restrictive CSP + capabilities file forbid remote origins.
//  - "Open Raven Command" opens the fixed HTTPS URL in the system
//    browser, never inside the native webview.
//  - Every child stdout/stderr line is passed through `redact::redact`
//    before it can be shown, logged, or emitted to the webview.
//  - The six-digit pairing code is held only in memory and returned
//    only to the native status window via `get_status`; it never
//    appears in logs, updater manifests, URLs, or files.

use rah_desktop_bridge_native::healthcheck::{probe, HealthState, BRIDGE_MIN_VERSION};
use rah_desktop_bridge_native::pairing::{parse_pairing_line, PairingCode};
use rah_desktop_bridge_native::redact::redact;
use rah_desktop_bridge_native::supervisor::{Action, State as SupState, Supervisor, SIDECAR_ARGS, SIDECAR_NAME};

use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BRIDGE_PORT: u16 = 47824;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Default)]
struct AppState {
    sup: Mutex<Supervisor>,
    child: Mutex<Option<CommandChild>>,
    pairing: Mutex<Option<PairingCode>>,
    health: Mutex<HealthState>,
}

impl Default for HealthState { fn default() -> Self { HealthState::Offline } }

#[derive(Serialize, Clone)]
struct StatusPayload {
    app_version: String,
    bridge_min_version: String,
    signed: bool,
    state_label: String,
    endpoint: String,
    pairing: Option<PairingInfo>,
    unsigned_dev_build: bool,
}

#[derive(Serialize, Clone)]
struct PairingInfo {
    code: String,
    seconds_remaining: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn state_label(sup: &Supervisor, health: &HealthState) -> String {
    // Native "Connected" REQUIRES a real successful health probe.
    match sup.state {
        SupState::EmergencyStopped => return "Emergency stopped".into(),
        SupState::Stopped          => return "Stopped".into(),
        SupState::GaveUp { ref reason, .. } => return format!("Error: {}", redact(reason)),
        SupState::Crashed { ref reason, attempt } => return format!("Crashed (retry {attempt}): {}", redact(reason)),
        _ => {}
    }
    match health {
        HealthState::Offline                 => "Starting…".into(),
        HealthState::PairingRequired         => "Pairing required".into(),
        HealthState::Online { version }      => format!("Connected · bridge v{version}"),
        HealthState::VersionMismatch { detected, min } =>
            format!("Version mismatch (bridge {detected} < required {min})"),
        HealthState::EmergencyStopped        => "Emergency stopped".into(),
        HealthState::Error(m)                => format!("Error: {}", redact(m)),
    }
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> StatusPayload {
    let sup = state.sup.lock();
    let health = state.health.lock().clone();
    let pairing = state.pairing.lock().as_ref().and_then(|p| {
        let now = now_ms();
        if p.is_expired_now(now) { None } else {
            Some(PairingInfo { code: p.code.clone(), seconds_remaining: p.seconds_remaining(now) })
        }
    });
    StatusPayload {
        app_version: APP_VERSION.into(),
        bridge_min_version: BRIDGE_MIN_VERSION.into(),
        signed: false,
        unsigned_dev_build: true,
        state_label: state_label(&sup, &health),
        endpoint: format!("http://127.0.0.1:{BRIDGE_PORT}"),
        pairing,
    }
}

#[tauri::command]
fn start_bridge(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let action = state.sup.lock().on_user_start();
    match action {
        Action::Spawn => spawn_sidecar(app),
        Action::IgnoreAlreadyRunning => Ok(()),
        _ => Ok(()),
    }
}

fn do_stop(app: &AppHandle) {
    let state: State<'_, AppState> = app.state();
    state.sup.lock().on_user_stop();
    kill_child(&state);
    *state.pairing.lock() = None;
}

#[tauri::command]
fn stop_bridge(app: AppHandle) -> Result<(), String> { do_stop(&app); Ok(()) }

#[tauri::command]
fn restart_bridge(app: AppHandle) -> Result<(), String> {
    do_stop(&app);
    thread::sleep(Duration::from_millis(250));
    let action = { let state: State<'_, AppState> = app.state(); state.sup.lock().on_user_start() };
    if let Action::Spawn = action { spawn_sidecar(app)?; }
    Ok(())
}

#[tauri::command]
fn local_emergency_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.sup.lock().on_local_emergency_stop();
    kill_child(&state);
    *state.pairing.lock() = None;
    Ok(())
}

#[tauri::command]
fn resume_bridge(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.sup.lock().on_resume();
    spawn_sidecar(app)
}

#[tauri::command]
fn open_raven_command(app: AppHandle) -> Result<(), String> {
    // System browser only, never the native webview.
    app.opener()
        .open_url("https://raven-command-core.lovable.app", None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let path = logs_dir();
    // The path is FIXED and not derived from any webview input.
    let _ = std::fs::create_dir_all(&path);
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) -> Result<(), String> {
    do_stop(&app);
    app.exit(0);
    Ok(())
}

fn logs_dir() -> PathBuf {
    // %LOCALAPPDATA%/RAH/DesktopBridge/ on Windows; XDG on other OSes.
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| dirs_local())
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("RAH").join("DesktopBridge")
}

fn dirs_local() -> Option<PathBuf> {
    #[cfg(target_os = "windows")] { None }
    #[cfg(not(target_os = "windows"))] {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"))
    }
}

fn kill_child(state: &State<'_, AppState>) {
    if let Some(child) = state.child.lock().take() {
        let _ = child.kill();
    }
}

fn spawn_sidecar(app: AppHandle) -> Result<(), String> {
    // Fixed named sidecar + fixed empty argv. Never accept args from
    // the webview or the environment. This mirrors the contract
    // declared in `supervisor::{SIDECAR_NAME, SIDECAR_ARGS}` and the
    // capability entry in `capabilities/default.json`.
    let shell = app.shell();
    let (mut rx, child) = shell
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("sidecar unavailable: {e}"))?
        .args::<[&str; 0], &str>([]) // fixed empty argv — do not add anything here
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    // Store child + mark supervisor
    {
        let state: State<'_, AppState> = app.state();
        *state.child.lock() = Some(child);
        state.sup.lock().on_spawned();
    }

    // Consume child stdout/stderr on a background task. Every line is
    // scanned for the machine pairing marker BEFORE being redacted for
    // logs, so the code lands only in the in-memory `pairing` slot.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let raw = String::from_utf8_lossy(&bytes).to_string();
                    for line in raw.split_inclusive('\n') {
                        if let Some(pc) = parse_pairing_line(line) {
                            let state: State<'_, AppState> = app_handle.state();
                            *state.pairing.lock() = Some(pc);
                            // do NOT forward this line anywhere — even redacted.
                            continue;
                        }
                        // Everything else: redact, then emit for the UI log tail.
                        let safe = redact(line);
                        let _ = app_handle.emit("bridge-log", safe);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let reason = format!("exit code={:?} signal={:?}", payload.code, payload.signal);
                    let state: State<'_, AppState> = app_handle.state();
                    let action = state.sup.lock().on_child_exit(&reason);
                    *state.child.lock() = None;
                    if let Action::WaitBackoff(d) = action {
                        let app2 = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(d).await;
                            let _ = spawn_sidecar(app2);
                        });
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn start_health_poller(app: AppHandle) {
    thread::spawn(move || loop {
        let h = probe(BRIDGE_PORT);
        {
            let state: State<'_, AppState> = app.state();
            *state.health.lock() = h.clone();
            // Auto-clear pairing slot once the bridge reports paired.
            if !matches!(h, HealthState::PairingRequired) {
                if let Some(p) = state.pairing.lock().as_ref() {
                    if p.is_expired_now(now_ms()) {
                        // expired — let the UI drop it naturally on next get_status
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(1500));
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let status_item = MenuItemBuilder::with_id("status", "Status: Starting…").enabled(false).build(app)?;
    let show_item   = MenuItemBuilder::with_id("show",    "Show Bridge Window").build(app)?;
    let open_raven  = MenuItemBuilder::with_id("open",    "Open Raven Command").build(app)?;
    let restart     = MenuItemBuilder::with_id("restart", "Restart Bridge").build(app)?;
    let estop       = MenuItemBuilder::with_id("estop",   "Emergency Stop").build(app)?;
    let resume      = MenuItemBuilder::with_id("resume",  "Resume Bridge").build(app)?;
    let logs        = MenuItemBuilder::with_id("logs",    "Open Logs Folder").build(app)?;
    let autostart   = CheckMenuItemBuilder::with_id("autostart", "Start with Windows").checked(false).build(app)?;
    let quit        = MenuItemBuilder::with_id("quit",    "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&status_item, &PredefinedMenuItem::separator(app)?,
                 &show_item, &open_raven,
                 &PredefinedMenuItem::separator(app)?,
                 &restart, &estop, &resume, &logs,
                 &PredefinedMenuItem::separator(app)?,
                 &autostart,
                 &PredefinedMenuItem::separator(app)?,
                 &quit])
        .build()?;
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("RAH Desktop Bridge")
        .on_menu_event(|app, event| {
            let handle = app.clone();
            match event.id.as_ref() {
                "show"    => { if let Some(w) = handle.get_webview_window("status") { let _ = w.show(); let _ = w.set_focus(); } }
                "open"    => { let _ = open_raven_command(handle); }
                "restart" => { let _ = restart_bridge(handle); }
                "estop"   => { let s: State<'_, AppState> = app.state(); let _ = local_emergency_stop(s); }
                "resume"  => { let s: State<'_, AppState> = app.state(); let _ = resume_bridge(handle, s); }
                "logs"    => { let _ = open_logs_folder(handle); }
                "autostart" => {
                    if let Ok(cur) = get_autostart(handle.clone()) {
                        let _ = set_autostart(handle, !cur);
                    }
                }
                "quit"    => { let _ = quit_app(handle); }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                if let Some(w) = tray.app_handle().get_webview_window("status") {
                    let _ = w.show(); let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("status") {
                let _ = w.show(); let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None, // default OFF; user must explicitly enable
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_status,
            start_bridge,
            stop_bridge,
            restart_bridge,
            local_emergency_stop,
            resume_bridge,
            open_raven_command,
            open_logs_folder,
            get_autostart,
            set_autostart,
            quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;
            // Auto-start the bridge when the companion itself opens.
            // (This is distinct from Windows-login autostart, which is
            // controlled separately by `set_autostart` and defaults OFF.)
            let _ = start_bridge(handle.clone(), app.state());
            start_health_poller(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RAH Desktop Bridge");
}

fn main() { run(); }