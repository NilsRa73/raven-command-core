//! Redacts secrets from anything that could be written to a log,
//! shown in the tray/status UI, sent to an updater feed, or
//! embedded in an analytics ping. Hand-rolled to avoid pulling
//! `regex` into the binary.

/// Redacts, in order:
///  - `RAH_PAIRING_CODE code=<6-digits> expiresAt=<n>` -> everything after `RAH_PAIRING_CODE` stripped
///  - `Authorization: Bearer <token>`                  -> `Authorization: Bearer [REDACTED]`
///  - `X-RAH-Signature: <hex>`                         -> `X-RAH-Signature: [REDACTED]`
///  - JSON string fields `deviceToken` / `hmacSecret` / `pairingCode` / `code`
///  - Any hex run of 32+ chars                         -> `[REDACTED_TOKEN]`
///  - Word-bounded 6-digit sequences                   -> `[REDACTED_PAIR_CODE]`
pub fn redact(input: &str) -> String {
    let mut s = input.to_string();
    // Strip the machine-readable pairing line before anything else.
    s = strip_pairing_line(&s);
    s = replace_after_prefix_ci(&s, "authorization: bearer ", |c| !c.is_whitespace(), "[REDACTED]");
    s = replace_after_prefix_ci(&s, "x-rah-signature: ",      |c| !c.is_whitespace(), "[REDACTED]");
    for field in ["deviceToken", "hmacSecret", "pairingCode", "code"] {
        s = replace_json_string_field(&s, field, "[REDACTED]");
    }
    s = replace_long_hex_runs(&s, 32, "[REDACTED_TOKEN]");
    s = replace_bare_six_digit_codes(&s, "[REDACTED_PAIR_CODE]");
    s
}

fn strip_pairing_line(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.split_inclusive('\n') {
        if line.trim_start().starts_with("RAH_PAIRING_CODE") {
            out.push_str("RAH_PAIRING_CODE [REDACTED]\n");
        } else {
            out.push_str(line);
        }
    }
    out
}

fn replace_after_prefix_ci(input: &str, prefix_lc: &str, take_while: fn(char) -> bool, repl: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if lower[i..].starts_with(prefix_lc) {
            out.push_str(&input[i..i + prefix_lc.len()]);
            let mut j = i + prefix_lc.len();
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
    let needle = format!("\"{field}\"");
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if input[i..].starts_with(&needle) {
            let mut j = i + needle.len();
            while j < bytes.len() && (bytes[j] as char).is_whitespace() { j += 1; }
            if j < bytes.len() && bytes[j] == b':' {
                j += 1;
                while j < bytes.len() && (bytes[j] as char).is_whitespace() { j += 1; }
                if j < bytes.len() && bytes[j] == b'"' {
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
            out.push_str(&input[i..i + needle.len()]);
            i += needle.len();
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
        if c.is_ascii_hexdigit() && (i == 0 || !bytes[i - 1].is_ascii_hexdigit()) {
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_hexdigit() { j += 1; }
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
    fn strips_machine_pairing_line_entirely() {
        let s = "hello\nRAH_PAIRING_CODE code=482915 expiresAt=1234567890000\ntail\n";
        let r = redact(s);
        assert!(!r.contains("482915"), "raw code leaked: {r}");
        assert!(!r.contains("expiresAt="), "expiry metadata leaked: {r}");
        assert!(r.contains("RAH_PAIRING_CODE [REDACTED]"));
        assert!(r.contains("hello"));
        assert!(r.contains("tail"));
    }

    #[test]
    fn redacts_bearer_token() {
        assert_eq!(redact("Authorization: Bearer abcdef1234567890xyz"),
                   "Authorization: Bearer [REDACTED]");
    }

    #[test]
    fn redacts_signature_header() {
        assert_eq!(redact("X-RAH-Signature: deadbeefdeadbeefdeadbeefdeadbeef"),
                   "X-RAH-Signature: [REDACTED]");
    }

    #[test]
    fn redacts_word_bounded_pairing_code() {
        let r = redact("your code is 482915 now");
        assert!(r.contains("[REDACTED_PAIR_CODE]"), "got {r}");
        assert!(!r.contains("482915"));
    }

    #[test]
    fn redacts_device_token_json_field() {
        let s = r#"{"deviceToken":"deadbeefdeadbeefdeadbeefdeadbeef","other":"ok"}"#;
        let r = redact(s);
        assert!(!r.contains("deadbeefdeadbeefdeadbeefdeadbeef"));
        assert!(r.contains(r#""deviceToken":"[REDACTED]""#));
        assert!(r.contains(r#""other""#));
    }

    #[test]
    fn redacts_bare_long_hex() {
        let r = redact("token=deadbeefdeadbeefdeadbeefdeadbeef01 rest");
        assert!(r.contains("[REDACTED_TOKEN]"), "got {r}");
    }

    #[test]
    fn leaves_ipv4_port_alone() {
        // "47824" is 5 digits (word-bound rule needs 6), "127.0.0.1" contains
        // no six-digit run. Neither should be redacted.
        let s = "Bridge on 127.0.0.1:47824";
        assert_eq!(redact(s), s);
    }
}