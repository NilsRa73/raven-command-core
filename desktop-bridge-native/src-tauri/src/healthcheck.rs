//! Native localhost health probe. Deliberately tiny: only accepts
//! `http://127.0.0.1:<port>/v1/health` and short timeouts. Never
//! reaches out to any remote host.

use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum HealthState {
    #[default]
    Offline,
    PairingRequired,
    EmergencyStopped,
    VersionMismatch { detected: String, min: String },
    Online { version: String },
    Error(String),
}

pub const BRIDGE_MIN_VERSION: &str = "0.1.1";

pub fn probe(port: u16) -> HealthState {
    let url = format!("http://127.0.0.1:{port}/v1/health");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(400))
        .timeout_read(Duration::from_millis(600))
        .build();
    match agent.get(&url).call() {
        Ok(resp) => match resp.into_json::<serde_json::Value>() {
            Ok(j) => classify(&j),
            Err(e) => HealthState::Error(format!("bad json: {e}")),
        },
        Err(ureq::Error::Status(code, _)) => HealthState::Error(format!("HTTP {code}")),
        Err(_) => HealthState::Offline,
    }
}

pub fn classify(j: &serde_json::Value) -> HealthState {
    let version = j.get("bridgeVersion").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if j.get("emergencyStopped").and_then(|v| v.as_bool()).unwrap_or(false) {
        return HealthState::EmergencyStopped;
    }
    if !j.get("paired").and_then(|v| v.as_bool()).unwrap_or(false) {
        return HealthState::PairingRequired;
    }
    if !version.is_empty() {
        // Below the minimum patch/minor OR an incompatible major both
        // count as VersionMismatch; only versions in the same major
        // AND ≥ the documented minimum are treated as Online.
        let detected_major = major_of(&version);
        let expected_major = major_of(BRIDGE_MIN_VERSION);
        if detected_major != expected_major || !version_ge(&version, BRIDGE_MIN_VERSION) {
            return HealthState::VersionMismatch { detected: version, min: BRIDGE_MIN_VERSION.into() };
        }
    }
    HealthState::Online { version }
}

fn major_of(v: &str) -> u32 {
    v.split('.').next().and_then(|p| p.parse().ok()).unwrap_or(0)
}

fn version_ge(a: &str, b: &str) -> bool {
    let pa: Vec<u32> = a.split('.').take(3).filter_map(|p| p.parse().ok()).collect();
    let pb: Vec<u32> = b.split('.').take(3).filter_map(|p| p.parse().ok()).collect();
    for i in 0..3 {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y { return x > y; }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classifies_emergency_stop_first() {
        let j = json!({ "bridgeVersion": "0.1.1", "paired": true, "emergencyStopped": true });
        assert_eq!(classify(&j), HealthState::EmergencyStopped);
    }

    #[test]
    fn classifies_pairing_required_when_unpaired() {
        let j = json!({ "bridgeVersion": "0.1.1", "paired": false });
        assert_eq!(classify(&j), HealthState::PairingRequired);
    }

    #[test]
    fn classifies_online_at_or_above_min() {
        let j = json!({ "bridgeVersion": "0.1.1", "paired": true });
        assert!(matches!(classify(&j), HealthState::Online { .. }));
        let j = json!({ "bridgeVersion": "0.2.0", "paired": true });
        assert!(matches!(classify(&j), HealthState::Online { .. }));
    }

    #[test]
    fn classifies_version_mismatch_below_min() {
        let j = json!({ "bridgeVersion": "0.1.0", "paired": true });
        assert!(matches!(classify(&j), HealthState::VersionMismatch { .. }));
    }

    #[test]
    fn classifies_incompatible_major_as_mismatch_not_online() {
        // Same "≥ min" numerically but a different major line — this
        // MUST NOT be reported as Online.
        let j = json!({ "bridgeVersion": "1.0.0", "paired": true });
        assert!(matches!(classify(&j), HealthState::VersionMismatch { .. }),
            "incompatible major bridge version must be VersionMismatch");
        let j = json!({ "bridgeVersion": "2.5.0", "paired": true });
        assert!(matches!(classify(&j), HealthState::VersionMismatch { .. }));
    }

    #[test]
    fn version_compare() {
        assert!(version_ge("0.1.1", "0.1.1"));
        assert!(version_ge("0.2.0", "0.1.1"));
        assert!(!version_ge("0.1.0", "0.1.1"));
    }
}