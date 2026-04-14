//! Diagnostics — project health checks and dependency installation.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Clone)]
pub struct DiagnosticsResult {
    #[serde(rename = "hasPackageJson")]
    pub has_package_json: bool,
    #[serde(rename = "hasNodeModules")]
    pub has_node_modules: bool,
    #[serde(rename = "tscErrors")]
    pub tsc_errors: Option<String>,
    #[serde(rename = "packageManager")]
    pub package_manager: Option<String>,
}

// ── Tauri commands ──

#[tauri::command]
pub fn diagnostics_check(cwd: String) -> Result<DiagnosticsResult, String> {
    let cwd_path = Path::new(&cwd);
    let has_package_json = cwd_path.join("package.json").exists();
    let has_node_modules = cwd_path.join("node_modules").exists();

    // Detect package manager
    let package_manager = if cwd_path.join("pnpm-lock.yaml").exists() {
        Some("pnpm".to_string())
    } else if cwd_path.join("yarn.lock").exists() {
        Some("yarn".to_string())
    } else if cwd_path.join("bun.lockb").exists() {
        Some("bun".to_string())
    } else if has_package_json {
        Some("npm".to_string())
    } else {
        None
    };

    // Try tsc --noEmit
    let tsc_errors = if has_package_json {
        let npx = if cfg!(target_os = "windows") { "npx.cmd" } else { "npx" };
        let output = Command::new(npx)
            .args(["tsc", "--noEmit"])
            .current_dir(&cwd)
            .output();

        match output {
            Ok(out) if !out.status.success() => {
                let stderr = String::from_utf8_lossy(&out.stdout).to_string();
                Some(stderr)
            }
            _ => None,
        }
    } else {
        None
    };

    Ok(DiagnosticsResult {
        has_package_json,
        has_node_modules,
        tsc_errors,
        package_manager,
    })
}

#[tauri::command]
pub fn diagnostics_install_deps(cwd: String, package_manager: Option<String>) -> Result<String, String> {
    let pm = package_manager.unwrap_or_else(|| {
        let cwd_path = Path::new(&cwd);
        if cwd_path.join("pnpm-lock.yaml").exists() {
            "pnpm".to_string()
        } else if cwd_path.join("yarn.lock").exists() {
            "yarn".to_string()
        } else if cwd_path.join("bun.lockb").exists() {
            "bun".to_string()
        } else {
            "npm".to_string()
        }
    });

    let cmd = if cfg!(target_os = "windows") {
        format!("{}.cmd", pm)
    } else {
        pm.clone()
    };

    let output = Command::new(&cmd)
        .arg("install")
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run {} install: {}", pm, e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("{} install failed: {}", pm, stderr))
    }
}
