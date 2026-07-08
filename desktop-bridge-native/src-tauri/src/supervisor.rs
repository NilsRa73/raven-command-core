//! Child-process supervisor state machine + immutable spawn contract
//! for the Node bridge sidecar. Tauri-free so `cargo test --lib`
//! runs anywhere.

use std::time::{Duration, Instant};

/// The immutable spawn contract enforced everywhere the sidecar is
/// launched. Any change here MUST be reviewed and mirrored in the
/// capabilities file `capabilities/default.json`.
pub const SIDECAR_NAME: &str = "rah-bridge-sidecar";
pub const SIDECAR_ARGS: &[&str] = &[]; // fixed empty argv, no user input
pub const SIDECAR_USE_SHELL: bool = false;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Idle,
    Starting,
    Running,
    PairingRequired,
    EmergencyStopped,
    Crashed { reason: String, attempt: u32 },
    GaveUp { reason: String, attempts: u32 },
    Stopped,
}

pub struct Supervisor {
    pub state: State,
    pub has_child: bool,
    pub max_restarts: u32,
    pub restart_window: Duration,
    pub restart_backoff: Duration,
    history: Vec<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Spawn,
    IgnoreAlreadyRunning,
    WaitBackoff(Duration),
    Idle,
    NotifyGaveUp(String),
}

impl Default for Supervisor {
    fn default() -> Self { Self::new() }
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            state: State::Idle,
            has_child: false,
            max_restarts: 5,
            restart_window: Duration::from_secs(60),
            restart_backoff: Duration::from_secs(2),
            history: Vec::new(),
        }
    }

    /// User (or auto-start) asked to start the bridge.
    /// Returns `IgnoreAlreadyRunning` if a child is already tracked.
    pub fn on_user_start(&mut self) -> Action {
        if self.has_child || matches!(self.state, State::Starting | State::Running | State::PairingRequired) {
            return Action::IgnoreAlreadyRunning;
        }
        self.state = State::Starting;
        Action::Spawn
    }

    pub fn on_user_stop(&mut self) {
        self.state = State::Stopped;
        self.has_child = false;
        self.history.clear();
    }

    pub fn on_local_emergency_stop(&mut self) {
        self.state = State::EmergencyStopped;
        self.has_child = false;
    }

    pub fn on_resume(&mut self) -> Action {
        self.state = State::Starting;
        Action::Spawn
    }

    pub fn on_spawned(&mut self) { self.has_child = true; }
    pub fn on_started(&mut self) { self.state = State::Running; self.has_child = true; }
    pub fn on_pairing_required(&mut self) { self.state = State::PairingRequired; }

    /// Child exited. Returns next action; capped restart policy.
    pub fn on_child_exit(&mut self, reason: impl Into<String>) -> Action {
        self.has_child = false;
        if matches!(self.state, State::Stopped | State::EmergencyStopped) {
            return Action::Idle;
        }
        let now = Instant::now();
        self.history.retain(|t| now.duration_since(*t) < self.restart_window);
        self.history.push(now);
        let attempts = self.history.len() as u32;
        let reason = reason.into();
        if attempts > self.max_restarts {
            let msg = format!("bridge crashed {attempts} times in {}s: {reason}",
                              self.restart_window.as_secs());
            self.state = State::GaveUp { reason: msg.clone(), attempts };
            return Action::NotifyGaveUp(msg);
        }
        self.state = State::Crashed { reason, attempt: attempts };
        Action::WaitBackoff(self.restart_backoff * attempts.min(5))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_contract_is_fixed_and_shell_free() {
        assert_eq!(SIDECAR_NAME, "rah-bridge-sidecar");
        assert_eq!(SIDECAR_ARGS.len(), 0, "sidecar argv must be empty");
        assert!(!SIDECAR_USE_SHELL, "sidecar must not go through a shell");
    }

    #[test]
    fn duplicate_start_is_suppressed() {
        let mut s = Supervisor::new();
        assert_eq!(s.on_user_start(), Action::Spawn);
        s.on_spawned();
        assert_eq!(s.on_user_start(), Action::IgnoreAlreadyRunning);
        s.on_started();
        assert_eq!(s.on_user_start(), Action::IgnoreAlreadyRunning);
    }

    #[test]
    fn user_stop_suppresses_restart() {
        let mut s = Supervisor::new();
        s.on_user_start(); s.on_started(); s.on_user_stop();
        assert_eq!(s.on_child_exit("normal exit"), Action::Idle);
    }

    #[test]
    fn local_emergency_stop_suppresses_restart() {
        let mut s = Supervisor::new();
        s.on_user_start(); s.on_started(); s.on_local_emergency_stop();
        assert_eq!(s.on_child_exit("killed"), Action::Idle);
    }

    #[test]
    fn capped_crash_restart_gives_up() {
        let mut s = Supervisor::new();
        s.max_restarts = 3;
        s.on_user_start(); s.on_started();
        for _ in 0..3 {
            let a = s.on_child_exit("boom");
            assert!(matches!(a, Action::WaitBackoff(_)), "got {:?}", a);
        }
        assert!(matches!(s.on_child_exit("boom"), Action::NotifyGaveUp(_)));
        assert!(matches!(s.state, State::GaveUp { .. }));
    }

    #[test]
    fn resume_after_emergency_spawns_again() {
        let mut s = Supervisor::new();
        s.on_user_start(); s.on_started(); s.on_local_emergency_stop();
        assert_eq!(s.on_resume(), Action::Spawn);
        assert!(matches!(s.state, State::Starting));
    }
}