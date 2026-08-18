use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use super::types::{DiscoveryOptions, DiscoveryStats, DiscoveryWarning};

/// 默认忽略的目录名
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "out",
    "target",
    "coverage",
    "release",
    ".next",
    ".nuxt",
    ".cache",
    ".tmp",
    "logs",
];

/// 项目标记文件——目录中存在任意一个即为候选目录
const PROJECT_MARKER_FILES: &[&str] = &[
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
    "package-lock.json",
    "pom.xml",
    "mvnw",
    "mvnw.cmd",
    "build.gradle",
    "build.gradle.kts",
    "gradlew",
    "gradlew.bat",
];

/// 主标记文件（出现即可信度高）
const PRIMARY_MARKER_FILES: &[&str] = &[
    "package.json",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
];

pub struct WalkResult {
    pub candidates: Vec<PathBuf>,
    pub warnings: Vec<DiscoveryWarning>,
    pub stats: DiscoveryStats,
}

struct QueueItem {
    path: PathBuf,
    depth: u32,
}

pub fn is_candidate_dir(path: &Path) -> bool {
    PROJECT_MARKER_FILES
        .iter()
        .any(|f| path.join(f).exists())
}

pub fn find_marker_files(path: &Path) -> Vec<String> {
    PROJECT_MARKER_FILES
        .iter()
        .filter(|f| path.join(f).exists())
        .map(|f| f.to_string())
        .collect()
}

pub fn has_primary_marker(marker_files: &[String]) -> bool {
    marker_files
        .iter()
        .any(|f| PRIMARY_MARKER_FILES.contains(&f.as_str()))
}

pub fn is_ignored(name: &str, extra_ignores: &[String]) -> bool {
    let lower = name.to_lowercase();
    if IGNORED_DIRS
        .iter()
        .any(|&d| d.to_lowercase() == lower)
    {
        return true;
    }
    extra_ignores
        .iter()
        .any(|e| e.to_lowercase() == lower)
}

pub fn is_symlink(path: &Path) -> bool {
    path.read_link().is_ok()
}

pub fn to_relative(root: &Path, target: &Path) -> String {
    match target.strip_prefix(root) {
        Ok(rel) => {
            let s = rel.to_string_lossy().to_string();
            if s.is_empty() {
                ".".to_string()
            } else {
                s.replace('\\', "/")
            }
        }
        Err(_) => ".".to_string(),
    }
}

pub fn walk(root_path: &Path, options: &DiscoveryOptions) -> WalkResult {
    let started = Instant::now();
    let mut candidates = Vec::new();
    let mut warnings = Vec::new();
    let mut scanned_directories: u32 = 0;
    let mut skipped_directories: u32 = 0;
    let mut max_depth_reached: u32 = 0;
    let mut truncated = false;

    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(QueueItem {
        path: root_path.to_path_buf(),
        depth: 0,
    });

    while let Some(item) = queue.pop_front() {
        // 超时
        if started.elapsed().as_millis() as u64 > options.timeout {
            truncated = true;
            warnings.push(DiscoveryWarning {
                code: "DISCOVERY_TIMEOUT".to_string(),
                message: format!("扫描超时（{}ms），已返回部分结果", options.timeout),
                path: Some(to_relative(root_path, &item.path)),
                severity: Some("warn".to_string()),
            });
            break;
        }

        // 目录数上限
        if scanned_directories >= options.max_directories {
            truncated = true;
            warnings.push(DiscoveryWarning {
                code: "DISCOVERY_DIRECTORY_LIMIT".to_string(),
                message: format!(
                    "已达到目录数上限（{}），遍历被截断",
                    options.max_directories
                ),
                path: Some(to_relative(root_path, &item.path)),
                severity: Some("warn".to_string()),
            });
            break;
        }

        scanned_directories += 1;
        if item.depth > max_depth_reached {
            max_depth_reached = item.depth;
        }

        // 候选目录判定
        if is_candidate_dir(&item.path) {
            candidates.push(item.path.clone());
        }

        // 到达最大深度，不再展开
        if item.depth >= options.max_depth {
            continue;
        }

        // 符号链接跳过
        if item.depth > 0 && is_symlink(&item.path) {
            skipped_directories += 1;
            warnings.push(DiscoveryWarning {
                code: "DISCOVERY_SYMLINK_SKIPPED".to_string(),
                message: format!(
                    "跳过符号链接：{}",
                    item.path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                ),
                path: Some(to_relative(root_path, &item.path)),
                severity: Some("info".to_string()),
            });
            continue;
        }

        // 读取目录
        let entries = match fs::read_dir(&item.path) {
            Ok(e) => e,
            Err(err) => {
                let is_denied = err.kind() == std::io::ErrorKind::PermissionDenied
                    || err.raw_os_error() == Some(5);
                warnings.push(DiscoveryWarning {
                    code: if is_denied {
                        "DISCOVERY_PERMISSION_DENIED".to_string()
                    } else {
                        "DISCOVERY_READ_FAILED".to_string()
                    },
                    message: if is_denied {
                        "目录无读取权限，已跳过".to_string()
                    } else {
                        format!("目录读取失败，已跳过（{}）", err)
                    },
                    path: Some(to_relative(root_path, &item.path)),
                    severity: Some("warn".to_string()),
                });
                continue;
            }
        };

        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            if is_ignored(&name_str, &options.extra_ignores) {
                skipped_directories += 1;
                continue;
            }

            let child_path = item.path.join(&name);

            // 检查是否为目录（不跟随符号链接）
            match entry.file_type() {
                Ok(ft) => {
                    if ft.is_dir() {
                        // 不跟随符号链接
                        if ft.is_symlink() {
                            skipped_directories += 1;
                            warnings.push(DiscoveryWarning {
                                code: "DISCOVERY_SYMLINK_SKIPPED".to_string(),
                                message: format!("跳过符号链接：{}", name_str),
                                path: Some(to_relative(root_path, &child_path)),
                                severity: Some("info".to_string()),
                            });
                            continue;
                        }
                        if !visited.contains(&child_path) {
                            visited.insert(child_path.clone());
                            queue.push_back(QueueItem {
                                path: child_path,
                                depth: item.depth + 1,
                            });
                        }
                    }
                }
                Err(_) => {
                    // lstat fallback
                    if let Ok(meta) = fs::symlink_metadata(&child_path) {
                        if meta.is_dir() && !meta.file_type().is_symlink() {
                            if !visited.contains(&child_path) {
                                visited.insert(child_path.clone());
                                queue.push_back(QueueItem {
                                    path: child_path,
                                    depth: item.depth + 1,
                                });
                            }
                        } else if meta.file_type().is_symlink() {
                            skipped_directories += 1;
                            warnings.push(DiscoveryWarning {
                                code: "DISCOVERY_SYMLINK_SKIPPED".to_string(),
                                message: format!("跳过符号链接：{}", name_str),
                                path: Some(to_relative(root_path, &child_path)),
                                severity: Some("info".to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    WalkResult {
        candidates,
        warnings,
        stats: DiscoveryStats {
            scanned_directories,
            max_depth_reached,
            truncated,
            elapsed_ms: started.elapsed().as_millis() as u64,
            skipped_directories: Some(skipped_directories),
        },
    }
}
