use serde::{Deserialize, Serialize};

/// Log stream type matching TypeScript contract
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

/// Strip ANSI escape sequences from text (e.g. color codes like [32m, [1m, [39m).
pub fn strip_ansi(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // ANSI escape sequence: \x1b[...m
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                loop {
                    match chars.next() {
                        Some(c) if c.is_ascii_digit() || c == ';' => {}
                        Some('m') => break,
                        Some(_) | None => break,
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Decode raw bytes to String with multiple encoding fallbacks.
/// Tries UTF-8 first, then falls back to GBK/CP936 (common on Chinese Windows).
/// Also strips ANSI color codes from the result.
pub fn decode_bytes(data: &[u8]) -> String {
    let text = decode_bytes_raw(data);
    strip_ansi(&text)
}

/// Decode bytes to string without stripping ANSI codes.
fn decode_bytes_raw(data: &[u8]) -> String {
    // Try UTF-8 first
    if let Ok(s) = std::str::from_utf8(data) {
        return s.to_string();
    }

    // Try GBK/CP936 (Windows Chinese/Asian encoding)
    // The windows crate is not available, so we use a simple single-byte fallback
    // for CP936 which extends GBK: try CP936 (code page 936)
    // Without external crates, decode as Latin-1 (always valid) then fall back to lossy UTF-8
    // A practical approach: decode lossy as UTF-8 (replacement char for invalid bytes)
    // and also try CP1252 which is common on Windows
    decode_with_codepage(data, 936)
        .or_else(|| decode_with_codepage(data, 1252))
        .unwrap_or_else(|| String::from_utf8_lossy(data).into_owned())
}

/// Try to decode bytes using a specific code page number.
/// Returns None if the conversion fails.
fn decode_with_codepage(data: &[u8], code_page: u32) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn MultiByteToWideChar(
                cp: u32,
                flags: u32,
                src: *const u8,
                srclen: i32,
                dest: *mut u16,
                destlen: i32,
            ) -> i32;
            fn WideCharToMultiByte(
                cp: u32,
                flags: u32,
                src: *const u16,
                srclen: i32,
                dest: *mut u8,
                destlen: i32,
                def: *const i8,
                used: *mut i32,
            ) -> i32;
        }

        let wide_len = unsafe {
            MultiByteToWideChar(code_page, 0, data.as_ptr(), data.len() as i32, std::ptr::null_mut(), 0)
        };
        if wide_len == 0 {
            return None;
        }
        let mut wide: Vec<u16> = vec![0; wide_len as usize];
        let wide_len2 = unsafe {
            MultiByteToWideChar(code_page, 0, data.as_ptr(), data.len() as i32, wide.as_mut_ptr(), wide_len)
        };
        if wide_len2 == 0 {
            return None;
        }

        let utf8_len = unsafe {
            WideCharToMultiByte(65001, 0, wide.as_ptr(), wide_len, std::ptr::null_mut(), 0, std::ptr::null(), std::ptr::null_mut())
        };
        if utf8_len == 0 {
            return None;
        }
        let mut utf8: Vec<u8> = vec![0; utf8_len as usize];
        let final_len = unsafe {
            WideCharToMultiByte(65001, 0, wide.as_ptr(), wide_len, utf8.as_mut_ptr(), utf8_len, std::ptr::null(), std::ptr::null_mut())
        };
        if final_len == 0 {
            return None;
        }

        String::from_utf8(utf8).ok()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = code_page;
        None
    }
}

/// Log entry matching TypeScript contract exactly
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub service_id: String,
    pub timestamp: u64,
    pub stream: LogStream,
    pub text: String,
}

impl LogEntry {
    pub fn new(service_id: String, stream: LogStream, text: String) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        Self {
            service_id,
            timestamp,
            stream,
            text,
        }
    }
}

/// Payload for log:batch event
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBatchPayload {
    pub service_id: String,
    pub entries: Vec<LogEntry>,
}
