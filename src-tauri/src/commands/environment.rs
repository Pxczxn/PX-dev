use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub name: String,
    pub available: bool,
    pub version: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

const ENVIRONMENTS: &[(&str, &str, &[&str])] = &[
    ("node", "node", &["--version"]),
    ("npm", "npm", &["--version"]),
    ("pnpm", "pnpm", &["--version"]),
    ("yarn", "yarn", &["--version"]),
    ("java", "java", &["-version"]),
    ("mvn", "mvn", &["--version"]),
    ("gradle", "gradle", &["--version"]),
    ("git", "git", &["--version"]),
];

fn check_command(cmd: &str, args: &[&str]) -> (bool, String, String) {
    #[cfg(target_os = "windows")]
    {
        // Windows batch scripts (.cmd, .bat) need to be run via cmd.exe
        let built_cmd = build_windows_cmd(cmd, args);
        let result = Command::new("cmd")
            .args(["/d", "/s", "/c", &built_cmd])
            .output();

        match result {
            Ok(output) => {
                // Check if command succeeded (exit code 0)
                if !output.status.success() {
                    return (false, String::new(), String::new());
                }

                // Windows cmd.exe output is typically GBK encoded in Chinese Windows
                let version = decode_windows_output(&output.stdout, &output.stderr, cmd);
                let path = resolve_path(cmd);
                (true, version, path)
            }
            Err(_) => (false, String::new(), String::new()),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = Command::new(cmd).args(args).output();

        match result {
            Ok(output) => {
                if !output.status.success() {
                    return (false, String::new(), String::new());
                }
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let combined = format!("{}{}", stdout, stderr);
                let version = parse_version(&combined, cmd);
                let path = resolve_path(cmd);
                (true, version, path)
            }
            Err(_) => (false, String::new(), String::new()),
        }
    }
}

/// Decode Windows cmd.exe output which may be GBK encoded
#[cfg(target_os = "windows")]
fn decode_windows_output(stdout: &[u8], stderr: &[u8], cmd: &str) -> String {
    // Try UTF-8 first
    if let Ok(s) = std::str::from_utf8(stdout) {
        let trimmed = s.trim();
        // Check if it looks like valid UTF-8 (not garbled GBK)
        if !trimmed.is_empty() && !looks_like_gibberish(trimmed) {
            let combined = format!("{}{}", trimmed, std::str::from_utf8(stderr).unwrap_or(""));
            return parse_version(&combined, cmd);
        }
    }

    // Try GBK encoding
    if find_gbk_decoder().is_some() {
        use std::io::Read;
        // Convert to string assuming GBK encoding
        let mut reader = std::io::Cursor::new(stdout);
        let mut gbk_bytes = Vec::new();
        reader.read_to_end(&mut gbk_bytes).ok();

        // Simple GBK to UTF-8 conversion for common Chinese characters
        let utf8_str = gbk_to_utf8(&gbk_bytes);
        if !utf8_str.trim().is_empty() {
            let stderr_str = String::from_utf8_lossy(stderr);
            let combined = format!("{}{}", utf8_str, stderr_str);
            return parse_version(&combined, cmd);
        }
    }

    // Fallback to lossy UTF-8
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    );
    parse_version(&combined, cmd)
}

/// Check if string looks like garbled text (likely wrong encoding)
#[cfg(target_os = "windows")]
fn looks_like_gibberish(s: &str) -> bool {
    // Check for common garbled patterns
    let gibberish_patterns = ["锟斤拷", "�", "锟", "烫烫烫"];
    for pattern in gibberish_patterns {
        if s.contains(pattern) {
            return true;
        }
    }

    // Count replacement characters
    let replacement_count = s.chars().filter(|c| *c == '\u{FFFD}').count();
    if replacement_count > s.len() / 10 {
        return true;
    }

    false
}

/// Find gbk encoding decoder (uses encoding_rs or windows core api)
#[cfg(target_os = "windows")]
fn find_gbk_decoder() -> Option<()> {
    // For simplicity, use built-in conversion table for common cases
    // A full implementation would use encoding_rs crate
    Some(())
}

/// Simple GBK to UTF-8 conversion for common Chinese characters
#[cfg(target_os = "windows")]
fn gbk_to_utf8(gbk: &[u8]) -> String {
    // Quick check: if all bytes are valid ASCII, return directly
    if gbk.iter().all(|&b| b < 128) {
        return String::from_utf8_lossy(gbk).to_string();
    }

    // Common GBK ranges: 0x8140-0xFEFE (high bytes)
    // For a proper implementation, use the encoding_rs crate
    // Here we do a best-effort conversion
    let mut result = String::new();
    let mut i = 0;

    while i < gbk.len() {
        let b = gbk[i];
        if b < 0x80 {
            // ASCII
            result.push(b as char);
            i += 1;
        } else if i + 1 < gbk.len() {
            let b2 = gbk[i + 1];
            // GBK two-byte sequence
            if (b >= 0x81 && b <= 0xFE) && (b2 >= 0x40 && b2 <= 0xFE && b2 != 0x7F) {
                // Convert GBK code to Unicode code point (simplified)
                let gbk_code = ((b as usize) << 8) | (b2 as usize);
                if let Some(c) = gbk_char_to_utf8(gbk_code) {
                    result.push(c);
                }
                i += 2;
            } else {
                // Unknown byte, skip
                result.push('?');
                i += 1;
            }
        } else {
            // Incomplete sequence at end
            result.push('?');
            i += 1;
        }
    }

    result
}

/// Convert a single GBK character to UTF-8
#[cfg(target_os = "windows")]
fn gbk_char_to_utf8(gbk_code: usize) -> Option<char> {
    // Common GBK ranges mapped to Unicode
    // This is a simplified lookup table for frequently used Chinese characters
    const GBK_TO_UNICODE: &[(u16, u16)] = &[
        // Common punctuation and symbols
        (0xA1A1, 0x3000), // 　 (ideographic space)
        (0xA1A2, 0x3001), // 、 (ideographic comma)
        (0xA1A3, 0x3002), // 。 (ideographic full stop)
        (0xA1B1, 0x3010), // 【 (left black lenticular bracket)
        (0xA1B2, 0x3011), // 】 (right black lenticular bracket)
        // Common Chinese characters
        (0xD2BB, 0x4E00), // 一
        (0xB6A1, 0x4E2D), // 中
        (0xC4E3, 0x4F60), // 你
        (0xC3BB, 0x597D), // 好
        (0xD6D0, 0x5316), // 化
        (0xC9E7, 0x5728), // 在
        (0xCAC0, 0x91CC), // 里
        (0xD4DA, 0x52A0), // 加
        (0xD5E2, 0x5165), // 入
        (0xD7A8, 0x5173), // 关
        (0xD2B5, 0x4E3A), // 为
        (0xB2BB, 0x65E0), // 无
        (0xD3C9, 0x573A), // 场
        (0xC9FA, 0x53EF), // 可
        (0xD0C5, 0x8BBE), // 设
        (0xD6B4, 0x53D1), // 发
        (0xB3C9, 0x6210), // 成
        (0xC9E8, 0x5B9A), // 定
        (0xD6C3, 0x53C2), // 参
        (0xB2CE, 0x4E2A), // 个
        (0xD0D4, 0x8BF7), // 请
        (0xBFDA, 0x7B49), // 等
        (0xB4F3, 0x6253), // 打
        (0xB5C4, 0x7684), // 的
        (0xB7BD, 0x547C), // 叫
        (0xD2D4, 0x5916), // 外
        (0xCAC2, 0x91CD), // 重
        (0xB5E3, 0x62E5), // 拥
        (0xC9EE, 0x5E94), // 应
        (0xCBAB, 0x8BBF), // 访
        (0xD4C6, 0x5668), // 器
        (0xC4DA, 0x5185), // 内
        (0xD6D6, 0x540C), // 同
        (0xB6BC, 0x4E0B), // 下
        (0xC9CF, 0x5DE6), // 左
        (0xD3D0, 0x6709), // 有
        (0xD3CE, 0x53EF), // 吧
        (0xD2D2, 0x5404), // 各
        (0xB8F6, 0x6240), // 所
        (0xCBD6, 0x65F6), // 时
        (0xB8F1, 0x60F3), // 想
        (0xB4CB, 0x4E3A), // 被
        (0xC9F8, 0x5C0F), // 小
        (0xB6D4, 0x4E2A), // 对
        (0xCFD6, 0x6570), // 数
        (0xB5D8, 0x540D), // 名
        (0xC4DA, 0x5185), // 内
        (0xCFD4, 0x6570), // 据
        (0xB9FB, 0x6807), // 标
        (0xC9E7, 0x5728), // 在
        (0xD6D0, 0x5316), // 化
        (0xCAC0, 0x91CC), // 里
        (0xD5E2, 0x5165), // 入
        (0xD2B5, 0x4E3A), // 为
        (0xC9FA, 0x53EF), // 可
        (0xD0C5, 0x8BBE), // 设
        (0xD6B4, 0x53D1), // 发
        (0xB3C9, 0x6210), // 成
        (0xC9E8, 0x5B9A), // 定
        (0xD2BB, 0x4E00), // 一
        (0xB6A1, 0x4E2D), // 中
        (0xC4E3, 0x4F60), // 你
        (0xC3BB, 0x597D), // 好
    ];

    for &(gbk, unicode) in GBK_TO_UNICODE {
        if gbk as usize == gbk_code {
            return char::from_u32(unicode as u32);
        }
    }

    // For unmapped characters, return a placeholder
    Some('?')
}

/// Build Windows command line for batch scripts
#[cfg(target_os = "windows")]
fn build_windows_cmd(cmd: &str, args: &[&str]) -> String {
    let cmd_lower = cmd.to_lowercase();

    // Map known batch scripts to their actual executables
    let actual_cmd = if cmd_lower.ends_with(".cmd") || cmd_lower.ends_with(".bat") || cmd_lower.ends_with(".exe") {
        cmd.to_string()
    } else {
        match cmd_lower.as_str() {
            "npm" | "pnpm" | "yarn" | "npx" | "tsx" | "mvn" | "mvnw" => format!("{}.cmd", cmd),
            "gradle" | "gradlew" => format!("{}.bat", cmd),
            "bun" => format!("{}.exe", cmd),
            _ => cmd.to_string(),
        }
    };

    // Quote if contains spaces
    let quoted_cmd = if actual_cmd.contains(' ') {
        format!("\"{}\"", actual_cmd)
    } else {
        actual_cmd
    };

    let mut full_cmd = quoted_cmd;
    for arg in args {
        full_cmd.push(' ');
        if arg.contains(' ') || arg.contains('&') || arg.contains('|') || arg.contains('^') {
            full_cmd.push('"');
            full_cmd.push_str(arg);
            full_cmd.push('"');
        } else {
            full_cmd.push_str(arg);
        }
    }
    full_cmd
}

fn parse_version(output: &str, cmd: &str) -> String {
    let first_line = output.lines().next().unwrap_or("").trim();

    match cmd {
        "java" => {
            if let Some(start) = first_line.find('"') {
                if let Some(end) = first_line[start + 1..].find('"') {
                    return first_line[start + 1..start + 1 + end].to_string();
                }
            }
            first_line.to_string()
        }
        "mvn" => {
            // Extract version from "Apache Maven <version> (<hash>)"
            // e.g. "Apache Maven 3.9.16 (2bdd9fddda4b155ebf8006e807eb73fd829a51d5)"
            let without_prefix = first_line
                .strip_prefix("Apache Maven ")
                .or_else(|| first_line.strip_prefix("apache maven "))
                .unwrap_or(first_line);

            // Take only the version part, stop at space (skip hash in parentheses)
            let version = without_prefix.split_whitespace().next().unwrap_or(without_prefix);
            version.to_string()
        }
        "gradle" => {
            // Extract version from "Gradle <version>"
            let without_prefix = first_line
                .strip_prefix("Gradle ")
                .or_else(|| first_line.strip_prefix("gradle "))
                .unwrap_or(first_line);
            let version = without_prefix.split_whitespace().next().unwrap_or(without_prefix);
            version.to_string()
        }
        "git" => {
            // Extract version from "git version <version>"
            first_line
                .replace("git version", "")
                .trim()
                .to_string()
        }
        "node" | "npm" | "pnpm" | "yarn" => {
            // Strip leading "v" if present (e.g. "v24.18.0" -> "24.18.0")
            let trimmed = first_line.trim_start_matches('v');
            trimmed.split_whitespace().next().unwrap_or(trimmed).to_string()
        }
        _ => first_line.to_string(),
    }
}

fn resolve_path(cmd: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        // Windows 'where' is a cmd.exe builtin, not a standalone program
        let result = Command::new("cmd")
            .args(["/c", "where", cmd])
            .output();

        match result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                stdout.lines().next().unwrap_or("").trim().to_string()
            }
            Err(_) => String::new(),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = Command::new("which").arg(cmd).output();

        match result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                stdout.lines().next().unwrap_or("").trim().to_string()
            }
            Err(_) => String::new(),
        }
    }
}

#[tauri::command]
pub async fn environment_detect_all() -> Vec<EnvironmentInfo> {
    let mut results = Vec::new();

    for &(name, cmd, args) in ENVIRONMENTS {
        let (available, version, path) = check_command(cmd, args);
        results.push(EnvironmentInfo {
            name: name.to_string(),
            available,
            version,
            path,
            error: if !available {
                Some(format!("command not found: {}", cmd))
            } else {
                None
            },
        });
    }

    results
}

#[tauri::command]
pub async fn environment_detect_single(name: String) -> Result<EnvironmentInfo, String> {
    let env = ENVIRONMENTS.iter().find(|(n, _, _)| *n == name.as_str());

    match env {
        Some(&(_, cmd, args)) => {
            let (available, version, path) = check_command(cmd, args);
            Ok(EnvironmentInfo {
                name,
                available,
                version,
                path,
                error: if !available {
                    Some(format!("command not found: {}", cmd))
                } else {
                    None
                },
            })
        }
        None => Err(format!("Unknown environment: {}", name)),
    }
}
