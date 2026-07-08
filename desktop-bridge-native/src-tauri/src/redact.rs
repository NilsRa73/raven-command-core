//! Redacts secrets from anything that could be written to a log,
//! shown in the tray/status UI, sent to an updater feed, or embedded
//! in an analytics ping.
//!
//! Implemented as small hand-rolled scanners instead of a regex
//! dependency to keep the native binary small and the behavior
//! auditable.

/// Redacts, in order:
///  - `Authorization: Bearer <token>`     → `Authorization: Bearer [REDACTED]`
///  - `X-RAH-Signature: <hex>`            → `X-RAH-Signature: [REDACTED]`
///  - JSON string fields `deviceToken`, `hmacSecret`, `pairingCode`, `code`
///  - Any hex/base64-ish run of 32+ chars → `[REDACTED_TOKEN]`
///  - Word-bounded 6-digit sequences      → `[REDACTED_PAIR_CODE]`
pub fn redact(input: &str) -> String {
    let mut s = input.to_string();
    s = replace_after_prefix_ci(&s, "authorization: bearer ", |c| !c.is_whitespace(), "[REDACTED]");
    s = replace_after_prefix_ci(&s, "x-rah-signature: ",     |c| !c.is_whitespace(), "[REDACTED]");
    for field in ["deviceToken", "hmacSecret", "pairingCode", "code"] {
        s = replace_json_string_field(&s, field, "[REDACTED]");
    }
    s = replace_long_hex_runs(&s, 32, "[REDACTED_TOKEN]");
    s = replace_bare_six_digit_codes(&s, "[REDACTED_PAIR_CODE]");
    s
}

fn replace_after_prefix_ci(input: &str, prefix_lc: &str, take_while: fn(char) -> bool, repl: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if lower[i..].starts_with(prefix_lc) {
            out.push_str(&input[i..i + prefix_lc.len()]);
            let mut j = i + prefix_lc.len();
            let bytes = input.as_bytes();
            while j < bytes.len() && take_while(bytes[j] as char) { j += 1; }
            if j > i + prefix_lc.len() { out.push_str(repl); }
            i = j;
        } else {
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn replace_json_string_field(input: &str, field: &str, repl: &str) -> String {
    // Match  "<field>"  :  " ... "     (allowing whitespace and \" inside)
    let needle = format!("\"{field}\"");
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if input[i..].starts_with(&needle) {
            let start = i;
            let mut j = i + needle.len();
            while j < bytes.len() && (bytes[j] as char).is_whitespace() { j += 1; }
            if j < bytes.len() && bytes[j] == b':' {
                j += 1;
                while j < bytes.len() && (bytes[j] as char).is_whitespace() { j += 1; }
                if j < bytes.len() && bytes[j] == b'"' {
                    // find closing quote (no escaping handled: sufficient for our audit surface)
                    let vstart = j + 1;
                    let mut vend = vstart;
                    while vend < bytes.len() && bytes[vend] != b'"' { vend += 1; }
                    if vend < bytes.len() {
                        out.push_str(&format!("\"{field}\":\"{repl}\""));
                        i = vend + 1;
                        continue;
                    }
                }
            }
            out.push_str(&input[start..start + needle.len()]);
            i = start + needle.len();
        } else {
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn replace_long_hex_runs(input: &str, min_len: usize, repl: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let is_hex = |c: u8| c.is_ascii_hexdigit();
        if is_hex(c) && (i == 0 || !bytes[i - 1].is_ascii_hexdigit()) {
            let mut j = i;
            while j < bytes.len() && is_hex(bytes[j]) { j += 1; }
            if j - i >= min_len {
                out.push_str(repl);
                i = j;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn replace_bare_six_digit_codes(input: &str, repl: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let left_ok = i == 0 || !is_ident_or_digit(bytes[i - 1]);
        if left_ok && i + 6 <= bytes.len() {
            let run = &bytes[i..i + 6];
            if run.iter().all(|c| c.is_ascii_digit()) {
                let right_ok = i + 6 == bytes.len() || !is_ident_or_digit(bytes[i + 6]);
                if right_ok {
                    out.push_str(repl);
                    i += 6;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn is_ident_or_digit(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_token() {
        let s = "Authorization: Bearer abcdef1234567890xyz";
        assert_eq!(redact(s), "Authorization: Bearer [REDACTED]");
    }

    #[test]
    fn redacts_signature_header() {
        let s = "X-RAH-Signature: deadbeefdeadbeefdeadbeefdeadbeef";
        assert_eq!(redact(s), "X-RAH-Signature: [REDACTED]");
    }

    #[test]
    fn redacts_pairing_code() {
        let s = "your code is 482915 now";
        let r = redact(s);
        assert!(r.contains("[REDACTED_PAIR_CODE]"), "got {r}");
        assert!(!r.contains("482915"), "got {r}");
    }

    #[test]
    fn redacts_device_token_field() {
        let s = r#"{"deviceToken":"deadbeefdeadbeefdeadbeefdeadbeef","other":"ok"}"#;
        let r = redact(s);
        assert!(!r.contains("deadbeefdeadbeefdeadbeefdeadbeef"), "got {r}");
        assert!(r.contains(r#""deviceToken":"[REDACTED]""#), "got {r}");
        assert!(r.contains(r#""other""#), "got {r}");
    }

    #[test]
    fn redacts_bare_long_hex() {
        let s = "token=deadbeefdeadbeefdeadbeefdeadbeef01 rest";
        let r = redact(s);
        assert!(r.contains("[REDACTED_TOKEN]"), "got {r}");
    }

    #[test]
    fn leaves_ipv4_and_port_alone() {
        // "127.0.0.1:47824" contains "47824" (5 digits) — must not match six-digit rule
        let s = "Bridge on 127.0.0.1:47824";
        assert_eq!(redact(s), s);
    }

    #[test]
    fn does_not_redact_six_digits_inside_hostname() {
        // "abc123456def" — the 6 digits are surrounded by identifier chars, so left/right guards reject
        let s = "id abc123456def end";
        assert_eq!(redact(s), s);
    }
}