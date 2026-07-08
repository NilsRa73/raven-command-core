// Entry point for the RAH Desktop Bridge Tauri companion.
//
// Design notes:
//  - Single-instance guard: opening the app twice focuses the tray
//    window instead of spawning a second sidecar.
//  - The sidecar is launched with argv only (no shell). There is no
//    generic shell / PowerShell IPC exposed to the webview.
//  - The IPC allowlist below is intentionally tiny and typed.
//  - CSP in tauri.conf.json is restrictive (no remote origins) and
//    "Open Raven Command" opens the system browser, never the native
//    webview.

use rah_desktop_bridge_native::redact::redact;
use rah_desktop_bridge_native::supervisor::{Action, Supervisor};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

const BRIDGE_VERSION: &str = "0.1.1";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Default)]
struct AppState {
    sup: Mutex<Supervisor>,
}

#[derive(Serialize, Clone)]
struct StatusPayload {
    app_version: String,
    bridge_version: String,
    signed: bool,
    state_label: String,
    endpoint: String,
}

fn status_payload(sup: &Supervisor) -> StatusPayload {
    use rah_desktop_bridge_native::supervisor::State as S;
    let label = match &sup.state {
        S::Idle             => "Idle".into(),
        S::Starting         => "Starting".into(),
        S::Running { .. }   => "Connected".into(),
        S::PairingRequired  => "Pairing required".into(),
        S::EmergencyStopped => "Emergency stopped".into(),
        S::Crashed { reason, attempt } => format!("Crashed (retry {attempt}): {}", redact(reason)),
        S::GaveUp { reason, .. } => format!("Error: {}", redact(reason)),
        S::Stopped          => "Stopped".into(),
    };
    StatusPayload {
        app_version: APP_VERSION.into(),
        bridge_version: BRIDGE_VERSION.into(),
        signed: false, // flip only when signtool has actually signed the build
        state_label: label,
        endpoint: "http://127.0.0.1:47824".into(),
    }
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> StatusPayload {
    status_payload(&state.sup.lock())
}

#[tauri::command]
fn start_bridge(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.sup.lock().on_user_start();
    // Real Command::new_sidecar spawn wired in v0.2.1 alongside the
    // signed sidecar. Kept as a state-only transition here so the IPC
    // surface compiles and the state machine tests exercise it.
    Ok(())
}

#[tauri::command]
fn stop_bridge(state: State<'_, AppState>) -> Result<(), String> {
    state.sup.lock().on_user_stop();
    Ok(())
}

#[tauri::command]
fn emergency_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.sup.lock().on_emergency_stop();
    Ok(())
}

#[tauri::command]
fn open_raven_command(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://raven-command-core.lovable.app", None::<&str>)
        .map_err(|e| e.to_string())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let status_item = MenuItemBuilder::with_id("status", "Status: Starting…").enabled(false).build(app)?;
    let show_item   = MenuItemBuilder::with_id("show",    "Show Bridge Window").build(app)?;
    let open_raven  = MenuItemBuilder::with_id("open",    "Open Raven Command").build(app)?;
    let restart     = MenuItemBuilder::with_id("restart", "Restart Bridge").build(app)?;
    let estop       = MenuItemBuilder::with_id("estop",   "Emergency Stop").build(app)?;
    let logs        = MenuItemBuilder::with_id("logs",    "Open Logs Folder").build(app)?;
    let quit        = MenuItemBuilder::with_id("quit",    "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&status_item, &PredefinedMenuItem::separator(app)?,
                 &show_item, &open_raven,
                 &PredefinedMenuItem::separator(app)?,
                 &restart, &estop, &logs,
                 &PredefinedMenuItem::separator(app)?,
                 &quit])
        .build()?;
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("RAH Desktop Bridge")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show"    => { if let Some(w) = app.get_webview_window("status") { let _ = w.show(); let _ = w.set_focus(); } }
            "open"    => { let _ = open_raven_command(app.clone()); }
            "quit"    => { app.exit(0); }
            _ => {}
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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_status,
            start_bridge,
            stop_bridge,
            emergency_stop,
            open_raven_command,
        ])
        .setup(|app| { build_tray(app.handle())?; Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running RAH Desktop Bridge");
}

fn main() { run(); }