//! Child-process supervisor state machine for the Node bridge sidecar.
//!
//! Intentionally free of Tauri types so `cargo test --lib` runs it in
//! any CI environment.

use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Idle,
    Starting,
    Running { since: Instant },
    PairingRequired,
    EmergencyStopped,
    Crashed { reason: String, attempt: u32 },
    GaveUp { reason: String, attempts: u32 },
    Stopped,
}

pub struct Supervisor {
    pub state: State,
    pub max_restarts: u32,
    pub restart_window: Duration,
    pub restart_backoff: Duration,
    history: Vec<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Spawn,
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
            max_restarts: 5,
            restart_window: Duration::from_secs(60),
            restart_backoff: Duration::from_secs(2),
            history: Vec::new(),
        }
    }

    pub fn on_user_start(&mut self) -> Action {
        self.state = State::Starting;
        Action::Spawn
    }

    pub fn on_user_stop(&mut self) {
        self.state = State::Stopped;
        self.history.clear();
    }

    pub fn on_emergency_stop(&mut self) {
        self.state = State::EmergencyStopped;
    }

    pub fn on_resume(&mut self) -> Action {
        self.state = State::Starting;
        Action::Spawn
    }

    pub fn on_started(&mut self) {
        self.state = State::Running { since: Instant::now() };
    }

    pub fn on_pairing_required(&mut self) {
        self.state = State::PairingRequired;
    }

    pub fn on_child_exit(&mut self, reason: impl Into<String>) -> Action {
        if matches!(self.state, State::Stopped | State::EmergencyStopped) {
            return Action::Idle;
        }
        let now = Instant::now();
        self.history.retain(|t| now.duration_since(*t) < self.restart_window);
        self.history.push(now);
        let attempts = self.history.len() as u32;
        let reason = reason.into();
        if attempts > self.max_restarts {
            let msg = format!(
                "bridge crashed {attempts} times in {}s: {reason}",
                self.restart_window.as_secs()
            );
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
    fn user_stop_prevents_restart() {
        let mut s = Supervisor::new();
        s.on_user_start(); s.on_started(); s.on_user_stop();
        assert_eq!(s.on_child_exit("normal exit"), Action::Idle);
    }

    #[test]
    fn emergency_stop_prevents_restart() {
        let mut s = Supervisor::new();
        s.on_user_start(); s.on_started(); s.on_emergency_stop();
        assert_eq!(s.on_child_exit("killed"), Action::Idle);
    }

    #[test]
    fn crash_triggers_backoff_then_gives_up() {
        let mut s = Supervisor::new();
        s.max_restarts = 3;
        s.on_user_start(); s.on_started();
        for _ in 0..3 {
            let a = s.on_child_exit("boom");
            assert!(matches!(a, Action::WaitBackoff(_)), "got {:?}", a);
        }
        let a = s.on_child_exit("boom");
        assert!(matches!(a, Action::NotifyGaveUp(_)), "got {:?}", a);
        assert!(matches!(s.state, State::GaveUp { .. }));
    }

    #[test]
    fn resume_after_emergency_spawns_again() {
        let mut s = Supervisor::new();
        s.on_user_start(); s.on_started(); s.on_emergency_stop();
        assert_eq!(s.on_resume(), Action::Spawn);
        assert!(matches!(s.state, State::Starting));
    }
}