//! Parses the machine-readable pairing line printed by the sidecar
//! at startup and holds the code in memory with its expiry.
//! The raw code is exposed ONLY to the native status window via IPC;
//! never written to logs, updater manifests, URLs, files, or crash
//! reports.

use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingCode {
    pub code: String,
    pub expires_at_ms: u64,
    pub captured_at: Instant,
}

/// Parses `RAH_PAIRING_CODE code=<6-digits> expiresAt=<epoch_ms>`
/// from a single line. Returns None on any format mismatch.
pub fn parse_pairing_line(line: &str) -> Option<PairingCode> {
    let line = line.trim();
    let rest = line.strip_prefix("RAH_PAIRING_CODE")?.trim_start();
    let mut code: Option<String> = None;
    let mut expires: Option<u64> = None;
    for tok in rest.split_ascii_whitespace() {
        if let Some(v) = tok.strip_prefix("code=") {
            if v.len() == 6 && v.chars().all(|c| c.is_ascii_digit()) {
                code = Some(v.to_string());
            }
        } else if let Some(v) = tok.strip_prefix("expiresAt=") {
            expires = v.parse::<u64>().ok();
        }
    }
    Some(PairingCode {
        code: code?,
        expires_at_ms: expires?,
        captured_at: Instant::now(),
    })
}

impl PairingCode {
    pub fn is_expired_now(&self, now_ms: u64) -> bool {
        now_ms >= self.expires_at_ms
    }
    pub fn seconds_remaining(&self, now_ms: u64) -> u64 {
        self.expires_at_ms.saturating_sub(now_ms) / 1000
    }
    pub fn age(&self) -> Duration { self.captured_at.elapsed() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_line() {
        let p = parse_pairing_line("RAH_PAIRING_CODE code=482915 expiresAt=1783528014993").unwrap();
        assert_eq!(p.code, "482915");
        assert_eq!(p.expires_at_ms, 1_783_528_014_993);
    }

    #[test]
    fn rejects_wrong_prefix() {
        assert!(parse_pairing_line("PAIRING_CODE code=482915 expiresAt=1").is_none());
    }

    #[test]
    fn rejects_non_numeric_code() {
        assert!(parse_pairing_line("RAH_PAIRING_CODE code=abcdef expiresAt=1").is_none());
    }

    #[test]
    fn rejects_wrong_length() {
        assert!(parse_pairing_line("RAH_PAIRING_CODE code=12345 expiresAt=1").is_none());
        assert!(parse_pairing_line("RAH_PAIRING_CODE code=1234567 expiresAt=1").is_none());
    }

    #[test]
    fn expiry_math() {
        let p = parse_pairing_line("RAH_PAIRING_CODE code=482915 expiresAt=1000000").unwrap();
        assert!(p.is_expired_now(1_000_001));
        assert!(!p.is_expired_now(999_999));
        assert_eq!(p.seconds_remaining(500_000), 500);
    }
}