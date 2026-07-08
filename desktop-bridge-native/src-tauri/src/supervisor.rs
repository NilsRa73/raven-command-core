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
    /// Monotonically-increasing spawn generation. Every intentional
    /// stop / emergency-stop / resume / new spawn increments this so
    /// that a late `Terminated` event from a previous child can be
    /// recognised as stale and never schedule another restart on top
    /// of an already-started replacement.
    generation: u64,
    /// Set to `true` whenever the supervisor itself asked the current
    /// child to exit (user stop, emergency stop, restart). A subsequent
    /// child-exit event is then treated as an intentional termination
    /// (`Action::Idle`) instead of a crash.
    expected_exit: bool,
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
            generation: 0,
            expected_exit: false,
        }
    }

    /// User (or auto-start) asked to start the bridge.
    /// Returns `IgnoreAlreadyRunning` if a child is already tracked.
    pub fn on_user_start(&mut self) -> Action {
        if self.has_child || matches!(self.state, State::Starting | State::Running | State::PairingRequired) {
            return Action::IgnoreAlreadyRunning;
        }
        self.state = State::Starting;
        self.expected_exit = false;
        Action::Spawn
    }

    pub fn on_user_stop(&mut self) {
        self.state = State::Stopped;
        self.has_child = false;
        self.history.clear();
        self.expected_exit = true;
        self.generation = self.generation.wrapping_add(1);
    }

    pub fn on_local_emergency_stop(&mut self) {
        self.state = State::EmergencyStopped;
        self.has_child = false;
        self.expected_exit = true;
        self.generation = self.generation.wrapping_add(1);
    }

    pub fn on_resume(&mut self) -> Action {
        self.state = State::Starting;
        self.expected_exit = false;
        self.generation = self.generation.wrapping_add(1);
        Action::Spawn
    }

    /// Mark that a fresh child is now attached and return the
    /// generation tag the caller must use to identify events from
    /// this specific child.
    pub fn on_spawned(&mut self) -> u64 {
        self.has_child = true;
        self.expected_exit = false;
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }
    pub fn current_generation(&self) -> u64 { self.generation }
    pub fn on_started(&mut self) { self.state = State::Running; self.has_child = true; }
    pub fn on_pairing_required(&mut self) { self.state = State::PairingRequired; }

    /// Child exited. Returns next action; capped restart policy.
    ///
    /// `event_generation` is the generation tag the spawn task captured
    /// when the child was launched. If it does not match the current
    /// supervisor generation, this is a stale event from a previous
    /// child (killed via stop/emergency/restart) — it must NOT trigger
    /// a new restart on top of the replacement that has since started.
    pub fn on_child_exit(&mut self, event_generation: u64, reason: impl Into<String>) -> Action {
        if event_generation != self.generation {
            // Stale event from a prior child — the replacement (if any)
            // is already tracked, so do nothing.
            return Action::Idle;
        }
        self.has_child = false;
        if self.expected_exit
            || matches!(self.state, State::Stopped | State::EmergencyStopped)
        {
            self.expected_exit = false;
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
        let _g = s.on_spawned();
        assert_eq!(s.on_user_start(), Action::IgnoreAlreadyRunning);
        s.on_started();
        assert_eq!(s.on_user_start(), Action::IgnoreAlreadyRunning);
    }

    #[test]
    fn user_stop_suppresses_restart() {
        let mut s = Supervisor::new();
        s.on_user_start();
        let g = s.on_spawned();
        s.on_started();
        s.on_user_stop();
        assert_eq!(s.on_child_exit(g, "normal exit"), Action::Idle);
    }

    #[test]
    fn local_emergency_stop_suppresses_restart() {
        let mut s = Supervisor::new();
        s.on_user_start();
        let g = s.on_spawned();
        s.on_started();
        s.on_local_emergency_stop();
        assert_eq!(s.on_child_exit(g, "killed"), Action::Idle);
    }

    #[test]
    fn capped_crash_restart_gives_up() {
        let mut s = Supervisor::new();
        s.max_restarts = 3;
        s.on_user_start();
        let mut g = s.on_spawned();
        s.on_started();
        for _ in 0..3 {
            let a = s.on_child_exit(g, "boom");
            assert!(matches!(a, Action::WaitBackoff(_)), "got {:?}", a);
            // simulate the next spawn cycle producing a new generation
            g = s.on_spawned();
        }
        assert!(matches!(s.on_child_exit(g, "boom"), Action::NotifyGaveUp(_)));
        assert!(matches!(s.state, State::GaveUp { .. }));
    }

    #[test]
    fn resume_after_emergency_spawns_again() {
        let mut s = Supervisor::new();
        s.on_user_start();
        let _g = s.on_spawned();
        s.on_started();
        s.on_local_emergency_stop();
        assert_eq!(s.on_resume(), Action::Spawn);
        assert!(matches!(s.state, State::Starting));
    }

    #[test]
    fn stale_child_exit_after_restart_does_not_double_recover() {
        // Simulate: child A crashes, supervisor schedules backoff, then
        // user hits Restart which kills A and spawns B before A's
        // Terminated event is even delivered. The delayed event from A
        // (still carrying generation g_a) must NOT count as a fresh
        // crash of B.
        let mut s = Supervisor::new();
        s.on_user_start();
        let g_a = s.on_spawned();
        s.on_started();

        // User initiates a manual restart.
        s.on_user_stop();
        // Fresh spawn (generation advances).
        let action = s.on_user_start();
        assert_eq!(action, Action::Spawn);
        let g_b = s.on_spawned();
        s.on_started();
        assert_ne!(g_a, g_b, "generations must differ across spawns");

        // NOW the delayed Terminated event from child A arrives.
        assert_eq!(s.on_child_exit(g_a, "late exit from A"), Action::Idle,
            "stale child-exit event must not schedule another restart");

        // Sanity: a real crash of B is still handled as a crash.
        let a = s.on_child_exit(g_b, "real crash");
        assert!(matches!(a, Action::WaitBackoff(_)), "got {:?}", a);
    }

    #[test]
    fn intentional_stop_not_counted_as_crash_even_at_current_generation() {
        let mut s = Supervisor::new();
        s.on_user_start();
        let g = s.on_spawned();
        s.on_started();
        s.on_user_stop();
        // In the race where the intentional-stop advances generation
        // BEFORE the terminated event arrives, event_generation lags:
        // that's the stale-event path (Idle). But if a caller happens
        // to compare with the CURRENT generation and the state is
        // Stopped, we still refuse to restart.
        let g_now = s.current_generation();
        assert_eq!(s.on_child_exit(g_now, "killed by user"), Action::Idle);
        // g isn't referenced again, but keep it in scope for readability.
        let _ = g;
    }
}