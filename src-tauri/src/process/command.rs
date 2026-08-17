use crate::types::Service;

/// Built command ready for spawning
pub struct BuiltCommand {
    pub program: String,
    pub args: Vec<String>,
    pub use_shell: bool,
}

/// Build platform-specific command from Service config
pub fn build_command(service: &Service) -> BuiltCommand {
    let command = service.command.trim();
    
    // Check if explicit shell mode
    if service.shell_mode.unwrap_or(false) {
        return build_shell_command(command, &service.args);
    }
    
    // Auto-detect Windows batch wrappers
    #[cfg(target_os = "windows")]
    {
        if should_use_shell_on_windows(command) {
            return build_shell_command(command, &service.args);
        }
    }
    
    // Structured spawn (no shell)
    BuiltCommand {
        program: command.to_string(),
        args: service.args.clone().unwrap_or_default(),
        use_shell: false,
    }
}

/// Check if command should use shell on Windows
#[cfg(target_os = "windows")]
fn should_use_shell_on_windows(command: &str) -> bool {
    let cmd_lower = command.to_lowercase();
    
    // Check if already has batch extension
    if cmd_lower.ends_with(".cmd") || cmd_lower.ends_with(".bat") {
        return true;
    }
    
    // Known batch wrappers that require cmd.exe
    matches!(
        cmd_lower.as_str(),
        "npm" | "pnpm" | "yarn" | "npx" | "bun" | 
        "tsx" | "mvn" | "mvnw" | "gradle" | "gradlew"
    )
}

/// Resolve command to actual executable with extension
#[cfg(target_os = "windows")]
fn resolve_windows_executable(command: &str) -> String {
    let cmd_lower = command.to_lowercase();
    
    // Already has extension, use as-is
    if cmd_lower.ends_with(".cmd") || cmd_lower.ends_with(".bat") || cmd_lower.ends_with(".exe") {
        return command.to_string();
    }
    
    // Map known tools to their actual executables
    match cmd_lower.as_str() {
        "npm" | "pnpm" | "yarn" | "npx" | "tsx" | "mvn" | "mvnw" => {
            format!("{}.cmd", command)
        }
        "gradle" | "gradlew" => {
            format!("{}.bat", command)
        }
        "bun" => {
            format!("{}.exe", command)
        }
        _ => command.to_string()
    }
}

/// Build shell-wrapped command
fn build_shell_command(command: &str, args: &Option<Vec<String>>) -> BuiltCommand {
    #[cfg(target_os = "windows")]
    {
        build_windows_shell_command(command, args)
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        build_unix_shell_command(command, args)
    }
}

/// Quote argument for Windows cmd.exe
#[cfg(target_os = "windows")]
fn quote_for_cmd(arg: &str) -> String {
    // Empty string needs quotes
    if arg.is_empty() {
        return "\"\"".to_string();
    }
    
    // Check if needs quoting
    let needs_quote = arg.contains(' ') || arg.contains('\t') || 
                      arg.contains('&') || arg.contains('|') || 
                      arg.contains('<') || arg.contains('>') || 
                      arg.contains('^') || arg.contains('\"') ||
                      arg.contains('(') || arg.contains(')') ||
                      arg.contains('%') || arg.contains('!') ||
                      arg.contains(',') || arg.contains(';') ||
                      arg.contains('=');
    
    if !needs_quote {
        return arg.to_string();
    }
    
    // Quote and escape
    let mut result = String::from("\"");
    for ch in arg.chars() {
        match ch {
            '\"' => result.push_str("\\\""),
            '\\' => {
                // Check if backslash is before quote
                result.push('\\');
            }
            _ => result.push(ch),
        }
    }
    result.push('\"');
    result
}

/// Build Windows cmd.exe wrapped command
#[cfg(target_os = "windows")]
fn build_windows_shell_command(command: &str, args: &Option<Vec<String>>) -> BuiltCommand {
    // Resolve command to actual executable
    let resolved_cmd = resolve_windows_executable(command);
    
    // Quote the command itself if it has spaces
    let quoted_cmd = if resolved_cmd.contains(' ') {
        format!("\"{}\"", resolved_cmd)
    } else {
        resolved_cmd
    };
    
    // Build full command line with quoted args
    let mut full_cmd = quoted_cmd;
    if let Some(args) = args {
        for arg in args {
            full_cmd.push(' ');
            full_cmd.push_str(&quote_for_cmd(arg));
        }
    }
    
    // Wrap with cmd.exe /d /s /c
    BuiltCommand {
        program: "cmd".to_string(),
        args: vec![
            "/d".to_string(),  // Disable AutoRun
            "/s".to_string(),  // Strip quotes
            "/c".to_string(),  // Execute and exit
            full_cmd,
        ],
        use_shell: true,
    }
}

/// Build Unix shell wrapped command
#[cfg(not(target_os = "windows"))]
fn build_unix_shell_command(command: &str, args: &Option<Vec<String>>) -> BuiltCommand {
    let mut full_cmd = command.to_string();
    if let Some(args) = args {
        for arg in args {
            full_cmd.push(' ');
            full_cmd.push_str(arg);
        }
    }
    
    BuiltCommand {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), full_cmd],
        use_shell: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Service, ServiceType, ServiceRole};

    fn create_test_service(command: &str, args: Option<Vec<String>>, shell_mode: Option<bool>) -> Service {
        Service {
            id: "test".to_string(),
            workspace_id: "ws".to_string(),
            name: "Test".to_string(),
            service_type: ServiceType::Node,
            role: ServiceRole::Backend,
            cwd: "/path".to_string(),
            command: command.to_string(),
            args,
            package_manager: None,
            port: None,
            env: None,
            env_file: None,
            enabled: true,
            dependencies: vec![],
            startup_delay: None,
            auto_open_browser: None,
            open_url: None,
            health_check: None,
            shell_mode,
            discovery: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_npm_uses_shell_on_windows() {
        let service = create_test_service("npm", Some(vec!["run".to_string(), "dev".to_string()]), None);
        let built = build_command(&service);
        
        assert_eq!(built.program, "cmd");
        assert_eq!(built.use_shell, true);
        assert!(built.args.contains(&"/c".to_string()));
        assert!(built.args.last().unwrap().contains("npm.cmd"));
    }

    #[test]
    fn test_explicit_shell_mode() {
        let service = create_test_service("echo", Some(vec!["hello".to_string()]), Some(true));
        let built = build_command(&service);
        
        assert_eq!(built.use_shell, true);
    }

    #[test]
    fn test_structured_spawn_for_exe() {
        let service = create_test_service("node", Some(vec!["index.js".to_string()]), Some(false));
        let built = build_command(&service);
        
        assert_eq!(built.program, "node");
        assert_eq!(built.use_shell, false);
        assert_eq!(built.args, vec!["index.js"]);
    }
}
