use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use super::types::{LogEntry, LogStream, LogBatchPayload};

const EVENT_LOG_BATCH: &str = "log:batch";
const DEFAULT_MAX_LINES: usize = 5000;
const FLUSH_INTERVAL_MS: u64 = 80;

/// Per-service log buffer with history and pending batch
struct ServiceLogBuffer {
    history: VecDeque<LogEntry>,
    pending: Vec<LogEntry>,
}

/// Internal state for LogManager
struct LogManagerInner {
    buffers: HashMap<String, ServiceLogBuffer>,
    subscribers: HashSet<String>,
    max_lines: usize,
}

/// LogManager with batch event emission
#[derive(Clone)]
pub struct LogManager {
    inner: Arc<Mutex<LogManagerInner>>,
    app: AppHandle,
}

impl LogManager {
    /// Create new LogManager and start flush task
    pub fn new(app: AppHandle, max_lines: usize) -> Self {
        let manager = Self {
            inner: Arc::new(Mutex::new(LogManagerInner {
                buffers: HashMap::new(),
                subscribers: HashSet::new(),
                max_lines,
            })),
            app,
        };
        
        manager.start_flush_task();
        manager
    }

    /// Append a log entry to history and pending (if subscribed)
    pub fn append(&self, entry: LogEntry) {
        let mut inner = self.inner.lock().unwrap();
        let service_id = entry.service_id.clone();
        let max_lines = inner.max_lines;
        let is_subscribed = inner.subscribers.contains(&service_id);
        
        let buffer = inner.buffers.entry(service_id.clone()).or_insert_with(|| {
            ServiceLogBuffer {
                history: VecDeque::new(),
                pending: Vec::new(),
            }
        });
        
        // Add to history with ring buffer trimming
        buffer.history.push_back(entry.clone());
        if buffer.history.len() > max_lines {
            buffer.history.pop_front();
        }
        
        // Add to pending only if subscribed
        if is_subscribed {
            buffer.pending.push(entry);
        }
    }

    /// Subscribe to log events for a service
    pub fn subscribe(&self, service_id: String) {
        let mut inner = self.inner.lock().unwrap();
        inner.subscribers.insert(service_id);
    }

    /// Unsubscribe from log events for a service
    pub fn unsubscribe(&self, service_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.subscribers.remove(service_id);
        
        // Clear pending to avoid stale batch on resubscribe
        if let Some(buffer) = inner.buffers.get_mut(service_id) {
            buffer.pending.clear();
        }
    }

    /// Clear both history and pending for a service
    pub fn clear(&self, service_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(buffer) = inner.buffers.get_mut(service_id) {
            buffer.history.clear();
            buffer.pending.clear();
        }
    }

    /// Get history, optionally limited to last N entries
    pub fn history(&self, service_id: &str, limit: Option<usize>) -> Vec<LogEntry> {
        let inner = self.inner.lock().unwrap();
        if let Some(buffer) = inner.buffers.get(service_id) {
            match limit {
                Some(n) => {
                    // Return last N entries (most recent)
                    let start = buffer.history.len().saturating_sub(n);
                    buffer.history.iter().skip(start).cloned().collect()
                }
                None => buffer.history.iter().cloned().collect(),
            }
        } else {
            Vec::new()
        }
    }

    /// Remove all logs and subscription for a service
    pub fn remove_service(&self, service_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.buffers.remove(service_id);
        inner.subscribers.remove(service_id);
    }

    /// Update max lines and trim all buffers immediately
    pub fn set_max_lines(&self, max_lines: usize) {
        let mut inner = self.inner.lock().unwrap();
        inner.max_lines = max_lines;
        
        // Trim all existing buffers
        for buffer in inner.buffers.values_mut() {
            while buffer.history.len() > max_lines {
                buffer.history.pop_front();
            }
        }
    }

    /// Start the 80ms batch flush task
    fn start_flush_task(&self) {
        let inner = Arc::clone(&self.inner);
        let app = self.app.clone();
        
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(
                tokio::time::Duration::from_millis(FLUSH_INTERVAL_MS)
            );
            
            loop {
                interval.tick().await;
                
                // Collect batches to emit (lock → collect → unlock)
                let batches: Vec<(String, Vec<LogEntry>)> = {
                    let mut inner = inner.lock().unwrap();
                    
                    // Collect service IDs that are subscribed
                    let subscribed_ids: Vec<String> = inner.subscribers.iter().cloned().collect();
                    
                    subscribed_ids.iter()
                        .filter_map(|service_id| {
                            inner.buffers.get_mut(service_id).and_then(|buffer| {
                                if buffer.pending.is_empty() {
                                    None
                                } else {
                                    let entries = std::mem::take(&mut buffer.pending);
                                    Some((service_id.clone(), entries))
                                }
                            })
                        })
                        .collect()
                };
                
                // Emit events outside lock
                for (service_id, entries) in batches {
                    let payload = LogBatchPayload { service_id, entries };
                    let _ = app.emit(EVENT_LOG_BATCH, &payload);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_entry_creation() {
        let entry = LogEntry::new(
            "test-service".to_string(),
            LogStream::Stdout,
            "Hello World".to_string(),
        );
        
        assert_eq!(entry.service_id, "test-service");
        assert_eq!(entry.text, "Hello World");
        assert!(matches!(entry.stream, LogStream::Stdout));
        assert!(entry.timestamp > 0);
    }

    #[test]
    fn test_subscribe_unsubscribe() {
        // Note: This test cannot fully test LogManager without a real AppHandle
        // Full integration tests should be done with tauri::test helpers
        let service_id = "test-service";
        
        // We can test the logic with a mock-like approach
        let mut subscribers = HashSet::new();
        
        // Subscribe
        subscribers.insert(service_id.to_string());
        assert!(subscribers.contains(service_id));
        
        // Unsubscribe
        subscribers.remove(service_id);
        assert!(!subscribers.contains(service_id));
    }

    #[test]
    fn test_ring_buffer_logic() {
        let max_lines = 5;
        let mut history = VecDeque::new();
        
        // Add more than max_lines
        for i in 0..10 {
            history.push_back(LogEntry::new(
                "test".to_string(),
                LogStream::Stdout,
                format!("Line {}", i),
            ));
            
            if history.len() > max_lines {
                history.pop_front();
            }
        }
        
        // Should only keep last 5
        assert_eq!(history.len(), max_lines);
        assert!(history[0].text.contains("Line 5"));
        assert!(history[4].text.contains("Line 9"));
    }

    #[test]
    fn test_log_stream_serialization() {
        use serde_json;
        
        let stdout = LogStream::Stdout;
        let stderr = LogStream::Stderr;
        
        assert_eq!(serde_json::to_string(&stdout).unwrap(), r#""stdout""#);
        assert_eq!(serde_json::to_string(&stderr).unwrap(), r#""stderr""#);
    }
}

impl Default for LogManager {
    fn default() -> Self {
        panic!("LogManager::default() should not be used. Use LogManager::new(app_handle, max_lines) instead.");
    }
}
