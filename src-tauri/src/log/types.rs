use serde::{Deserialize, Serialize};

/// Log stream type matching TypeScript contract
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
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
