use std::fs;
use std::path::Path;

use super::types::{DetectionEvidence, DiscoveryConfidence, DiscoveryProjectType, DiscoveredProject};
use super::walker::{find_marker_files, has_primary_marker, to_relative};

/// 根据标记文件判断项目类型
fn detect_project_type(marker_files: &[String]) -> DiscoveryProjectType {
    let has_package_json = marker_files.iter().any(|f| f == "package.json");
    let has_maven = marker_files
        .iter()
        .any(|f| f == "pom.xml" || f == "mvnw" || f == "mvnw.cmd");
    let has_gradle = marker_files.iter().any(|f| {
        f == "build.gradle"
            || f == "build.gradle.kts"
            || f == "gradlew"
            || f == "gradlew.bat"
    });

    if has_package_json {
        return DiscoveryProjectType::Node;
    }
    if has_maven || has_gradle {
        return DiscoveryProjectType::Java;
    }
    DiscoveryProjectType::Unknown
}

/// 尝试检测 Node 项目中的框架
fn detect_node_framework(dir_path: &Path) -> Option<String> {
    let pkg_path = dir_path.join("package.json");
    let content = fs::read_to_string(&pkg_path).ok()?;
    let pkg: serde_json::Value = serde_json::from_str(&content).ok()?;

    let deps = |key: &str| -> Vec<String> {
        pkg.get(key)
            .and_then(|v| v.as_object())
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    };

    let all_deps: Vec<String> = deps("dependencies")
        .into_iter()
        .chain(deps("devDependencies"))
        .collect();

    let has = |name: &str| all_deps.iter().any(|d| d == name);

    // 前端框架
    if has("vue") || has("nuxt") || has("@nuxt/kit") {
        if has("nuxt") || has("@nuxt/kit") {
            return Some("nuxt".to_string());
        }
        return Some("vue".to_string());
    }
    if has("react") || has("next") || has("react-dom") {
        if has("next") {
            return Some("next".to_string());
        }
        return Some("react".to_string());
    }
    if has("@angular/core") {
        return Some("angular".to_string());
    }
    if has("svelte") || has("@sveltejs/kit") {
        if has("@sveltejs/kit") {
            return Some("sveltekit".to_string());
        }
        return Some("svelte".to_string());
    }

    // 后端框架
    if has("express") {
        return Some("express".to_string());
    }
    if has("koa") {
        return Some("koa".to_string());
    }
    if has("@nestjs/core") {
        return Some("nest".to_string());
    }
    if has("fastify") {
        return Some("fastify".to_string());
    }

    // 构建工具（作为框架标识）
    if has("vite") || has("@vitejs/plugin-vue") || has("@vitejs/plugin-react") {
        return Some("vite".to_string());
    }

    None
}

/// 检测前端还是后端角色
fn detect_role(framework: Option<&str>) -> Option<String> {
    match framework {
        Some("vue")
        | Some("react")
        | Some("next")
        | Some("nuxt")
        | Some("angular")
        | Some("svelte")
        | Some("sveltekit")
        | Some("vite") => Some("frontend".to_string()),
        Some("express")
        | Some("koa")
        | Some("nest")
        | Some("fastify") => Some("backend".to_string()),
        _ => None,
    }
}

/// 从 package.json 解析推荐的启动命令和参数
fn parse_node_scripts(dir_path: &Path) -> (Option<String>, Option<Vec<String>>) {
    let pkg_path = dir_path.join("package.json");
    let content = match fs::read_to_string(&pkg_path) {
        Ok(c) => c,
        Err(_) => return (None, None),
    };
    let pkg: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };

    let scripts = match pkg.get("scripts").and_then(|s| s.as_object()) {
        Some(s) => s,
        None => return (None, None),
    };

    // 优先 dev / start
    let script_name = if scripts.contains_key("dev") {
        "dev"
    } else if scripts.contains_key("start") {
        "start"
    } else if scripts.contains_key("serve") {
        "serve"
    } else {
        return (None, None);
    };

    // 检测包管理器
    let has_lock = |name: &str| dir_path.join(name).exists();
    let pm = if has_lock("pnpm-lock.yaml") {
        "pnpm"
    } else if has_lock("yarn.lock") {
        "yarn"
    } else if has_lock("bun.lockb") || has_lock("bun.lock") {
        "bun"
    } else {
        "npm"
    };

    (Some(pm.to_string()), Some(vec!["run".to_string(), script_name.to_string()]))
}

/// 从 vite.config.ts 解析端口号
fn detect_port_from_vite_config(dir_path: &Path) -> Option<u16> {
    let config_path = dir_path.join("vite.config.ts");
    let content = fs::read_to_string(&config_path).ok()?;

    // 匹配 "port:" 或 "port :" 或 "port =" 等形式
    // 需要确保 port 后面紧跟分隔符，而不是字母（避免匹配到 ports 等）
    let search_patterns = ["port:", "port :", "port=", "port ="];

    for pattern in &search_patterns {
        let mut search_str = &content[..];
        while let Some(pos) = search_str.find(pattern) {
            // 获取 port 后的内容
            let after_port = &search_str[pos + pattern.len()..];
            // 跳过空白
            let rest = after_port.trim_start();
            // 提取数字
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                    if let Ok(port) = digits.parse::<u16>() {
                        if port > 0 {
                        return Some(port);
                    }
                }
            }
            // 继续搜索（跳过当前位置避免死循环）
            if pos + pattern.len() >= search_str.len() {
                break;
            }
            search_str = &search_str[pos + 1..];
        }
    }

    None
}

/// 从 package.json scripts 或 vite.config.ts 解析端口号
fn detect_port_from_scripts(dir_path: &Path) -> Option<u16> {
    // 先尝试从 vite.config.ts 解析（优先级更高）
    if let Some(port) = detect_port_from_vite_config(dir_path) {
        return Some(port);
    }

    let pkg_path = dir_path.join("package.json");
    let content = fs::read_to_string(&pkg_path).ok()?;
    let pkg: serde_json::Value = serde_json::from_str(&content).ok()?;

    let scripts = pkg.get("scripts")?.as_object()?;

    for (_name, val) in scripts {
        if let Some(cmd) = val.as_str() {
            if let Some(port) = extract_port_from_command(cmd) {
                return Some(port);
            }
        }
    }
    None
}

/// 从命令字符串中提取端口号
fn extract_port_from_command(cmd: &str) -> Option<u16> {
    // --port=3000 / --port 3000 / -p 3000 / PORT=3000
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    for i in 0..parts.len() {
        if let Some(port_str) = parts[i].strip_prefix("--port=") {
            if let Ok(p) = port_str.parse::<u16>() {
                return Some(p);
            }
        }
        if parts[i] == "--port" || parts[i] == "-p" {
            if let Some(next) = parts.get(i + 1) {
                if let Ok(p) = next.parse::<u16>() {
                    return Some(p);
                }
            }
        }
        // PORT=XXXX in env prefix
        if let Some(rest) = parts[i].strip_prefix("PORT=") {
            if let Ok(p) = rest.parse::<u16>() {
                return Some(p);
            }
        }
    }
    // 检查常见框架默认端口
    if cmd.contains("vite") || cmd.contains("vue-cli-service") || cmd.contains("react-scripts") {
        return Some(5173);
    }
    if cmd.contains("next") {
        return Some(3000);
    }
    if cmd.contains("nuxt") {
        return Some(3000);
    }
    None
}

/// 扫描单个候选目录，生成 DiscoveredProject
pub fn scan_project(dir_path: &Path, root_path: &Path) -> DiscoveredProject {
    let marker_files = find_marker_files(dir_path);
    let relative_path = to_relative(root_path, dir_path);
    let name = if relative_path == "." {
        root_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    } else {
        dir_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    };

    let project_type = detect_project_type(&marker_files);
    let has_primary = has_primary_marker(&marker_files);

    // 构建证据
    let mut evidence: Vec<DetectionEvidence> = marker_files
        .iter()
        .map(|f| DetectionEvidence {
            evidence_type: "marker-file".to_string(),
            detail: format!("发现项目标记文件 {}", f),
            source: f.clone(),
        })
        .collect();

    // Node 项目特殊处理
    let mut framework = None;
    let mut package_manager = None;
    let mut detected_port = None;

    if project_type == DiscoveryProjectType::Node {
        framework = detect_node_framework(dir_path);
        let (pm, _scripts) = parse_node_scripts(dir_path);
        package_manager = pm;
        detected_port = detect_port_from_scripts(dir_path);
    }

    // 置信度
    let confidence = if framework.is_some() {
        DiscoveryConfidence::High
    } else if has_primary {
        if project_type == DiscoveryProjectType::Unknown {
            DiscoveryConfidence::Low
        } else {
            DiscoveryConfidence::High
        }
    } else {
        DiscoveryConfidence::Medium
    };

    // 推荐命令/参数
    let (final_command, final_args) = match project_type {
        DiscoveryProjectType::Node => {
            let pm = package_manager.as_deref().unwrap_or("npm");
            let script = if marker_files.iter().any(|f| f == "package.json") {
                // 检查 scripts
                let pkg_path = dir_path.join("package.json");
                if let Ok(content) = fs::read_to_string(&pkg_path) {
                    if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
                            if scripts.contains_key("dev") {
                                Some("dev")
                            } else if scripts.contains_key("start") {
                                Some("start")
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(s) = script {
                (
                    Some(pm.to_string()),
                    Some(vec!["run".to_string(), s.to_string()]),
                )
            } else {
                (None, None)
            }
        }
        DiscoveryProjectType::Java => {
            if dir_path.join("mvnw").exists() || dir_path.join("mvnw.cmd").exists() {
                (
                    Some("./mvnw".to_string()),
                    Some(vec!["spring-boot:run".to_string()]),
                )
            } else if dir_path.join("pom.xml").exists() {
                (
                    Some("mvn".to_string()),
                    Some(vec!["spring-boot:run".to_string()]),
                )
            } else if dir_path.join("gradlew").exists() || dir_path.join("gradlew.bat").exists() {
                (
                    Some("./gradlew".to_string()),
                    Some(vec!["bootRun".to_string()]),
                )
            } else {
                (
                    Some("gradle".to_string()),
                    Some(vec!["bootRun".to_string()]),
                )
            }
        }
        _ => (None, None),
    };

    let suggested_service_type = match project_type {
        DiscoveryProjectType::Node | DiscoveryProjectType::Frontend => {
            Some("node".to_string())
        }
        DiscoveryProjectType::Java => Some("java".to_string()),
        _ => Some("generic".to_string()),
    };

    let suggested_role = detect_role(framework.as_deref()).or_else(|| {
        Some(match project_type {
            DiscoveryProjectType::Frontend => "frontend".to_string(),
            DiscoveryProjectType::Java => "backend".to_string(),
            _ => "backend".to_string(),
        })
    });

    let id = format!(
        "{:016x}",
        sha1_hash(&format!("{}\0{}", root_path.to_string_lossy(), relative_path))
    );

    // 验证 package.json 可解析性
    if project_type == DiscoveryProjectType::Node {
        let pkg_path = dir_path.join("package.json");
        if pkg_path.exists() {
            if let Ok(content) = fs::read_to_string(&pkg_path) {
                if serde_json::from_str::<serde_json::Value>(&content).is_err() {
                    evidence.push(DetectionEvidence {
                        evidence_type: "parse-failed".to_string(),
                        detail: "package.json 解析失败，项目信息可能不完整".to_string(),
                        source: "package.json".to_string(),
                    });
                }
            }
        }
    }

    let config_files: Vec<String> = marker_files;

    DiscoveredProject {
        id,
        path: dir_path.to_string_lossy().to_string(),
        relative_path,
        name,
        project_type: match project_type {
            DiscoveryProjectType::Node => "node".to_string(),
            DiscoveryProjectType::Java => "java".to_string(),
            DiscoveryProjectType::Frontend => "frontend".to_string(),
            DiscoveryProjectType::Generic => "generic".to_string(),
            DiscoveryProjectType::Unknown => "unknown".to_string(),
        },
        framework,
        package_manager: package_manager.or_else(|| {
            let has_lock = |n: &str| dir_path.join(n).exists();
            if has_lock("pnpm-lock.yaml") {
                Some("pnpm".to_string())
            } else if has_lock("yarn.lock") {
                Some("yarn".to_string())
            } else if has_lock("bun.lockb") || has_lock("bun.lock") {
                Some("bun".to_string())
            } else {
                None
            }
        }),
        command: final_command,
        args: final_args,
        detected_port,
        is_library: None,
        suggested_service_type,
        suggested_role,
        suggested_selected: Some(confidence != DiscoveryConfidence::Low),
        confidence: confidence,
        evidence_items: evidence,
        config_files,
    }
}

/// 简易 SHA1（不引入外部 crate，用 std 的哈希即可）
fn sha1_hash(input: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}
