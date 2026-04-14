//! Workspace management — file system operations for project registry.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;

#[derive(Serialize, Deserialize, Clone)]
pub struct LinkedProject {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(rename = "lastAccessed")]
    pub last_accessed: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FrameworkInfo {
    pub framework: Option<String>,
    #[serde(rename = "packageManager")]
    pub package_manager: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub file: String,
    pub line: u32,
    pub text: String,
}

// ── Helpers ──

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn registry_path(workspace_base: &str) -> std::path::PathBuf {
    Path::new(workspace_base).join(".pipilot-linked.json")
}

fn read_registry(workspace_base: &str) -> Vec<LinkedProject> {
    let path = registry_path(workspace_base);
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn write_registry(workspace_base: &str, entries: &[LinkedProject]) -> Result<(), String> {
    let path = registry_path(workspace_base);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write registry: {}", e))
}

fn path_to_id(abs_path: &str) -> String {
    abs_path
        .replace(['/', '\\', ':'], "-")
        .trim_matches('-')
        .to_string()
}

// ── Tauri commands ──

#[tauri::command]
pub fn workspace_link(workspace_base: String, absolute_path: String) -> Result<LinkedProject, String> {
    let mut entries = read_registry(&workspace_base);
    let id = path_to_id(&absolute_path);

    // Check if already linked
    if let Some(existing) = entries.iter_mut().find(|e| e.path == absolute_path) {
        existing.last_accessed = now_epoch();
        let result = existing.clone();
        write_registry(&workspace_base, &entries)?;
        return Ok(result);
    }

    let name = Path::new(&absolute_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| id.clone());

    let project = LinkedProject {
        id,
        path: absolute_path,
        name,
        last_accessed: now_epoch(),
    };
    entries.push(project.clone());
    write_registry(&workspace_base, &entries)?;
    Ok(project)
}

#[tauri::command]
pub fn workspace_unlink(workspace_base: String, project_id: String) -> Result<(), String> {
    let mut entries = read_registry(&workspace_base);
    entries.retain(|e| e.id != project_id);
    write_registry(&workspace_base, &entries)
}

#[tauri::command]
pub fn workspace_list(workspace_base: String) -> Result<Vec<LinkedProject>, String> {
    Ok(read_registry(&workspace_base))
}

#[tauri::command]
pub fn workspace_info(workspace_base: String, project_id: String) -> Result<Option<LinkedProject>, String> {
    let entries = read_registry(&workspace_base);
    Ok(entries.into_iter().find(|e| e.id == project_id))
}

#[tauri::command]
pub fn workspace_touch(workspace_base: String, project_id: String) -> Result<(), String> {
    let mut entries = read_registry(&workspace_base);
    if let Some(entry) = entries.iter_mut().find(|e| e.id == project_id) {
        entry.last_accessed = now_epoch();
    }
    write_registry(&workspace_base, &entries)
}

#[tauri::command]
pub fn fs_home() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub fn fs_list_directory(dir_path: String) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to list {}: {}", dir_path, e))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Error reading entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Error reading metadata: {}", e))?;
        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(result)
}

#[tauri::command]
pub fn project_detect_framework(cwd: String) -> Result<FrameworkInfo, String> {
    let pkg_path = Path::new(&cwd).join("package.json");
    if !pkg_path.exists() {
        return Ok(FrameworkInfo {
            framework: None,
            package_manager: None,
        });
    }

    let content = fs::read_to_string(&pkg_path)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;
    let pkg: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse package.json: {}", e))?;

    let deps = pkg.get("dependencies").and_then(|v| v.as_object());
    let dev_deps = pkg.get("devDependencies").and_then(|v| v.as_object());

    let has_dep = |name: &str| -> bool {
        deps.map_or(false, |d| d.contains_key(name))
            || dev_deps.map_or(false, |d| d.contains_key(name))
    };

    let framework = if has_dep("next") {
        Some("next".to_string())
    } else if has_dep("nuxt") || has_dep("nuxt3") {
        Some("nuxt".to_string())
    } else if has_dep("svelte") || has_dep("@sveltejs/kit") {
        Some("sveltekit".to_string())
    } else if has_dep("vue") {
        Some("vue".to_string())
    } else if has_dep("react") {
        Some("react".to_string())
    } else if has_dep("express") {
        Some("express".to_string())
    } else {
        None
    };

    // Detect package manager
    let package_manager = if Path::new(&cwd).join("pnpm-lock.yaml").exists() {
        Some("pnpm".to_string())
    } else if Path::new(&cwd).join("yarn.lock").exists() {
        Some("yarn".to_string())
    } else if Path::new(&cwd).join("bun.lockb").exists() {
        Some("bun".to_string())
    } else {
        Some("npm".to_string())
    };

    Ok(FrameworkInfo {
        framework,
        package_manager,
    })
}

#[tauri::command]
pub fn project_scripts(cwd: String) -> Result<serde_json::Value, String> {
    let pkg_path = Path::new(&cwd).join("package.json");
    if !pkg_path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(&pkg_path)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;
    let pkg: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse package.json: {}", e))?;

    Ok(pkg.get("scripts").cloned().unwrap_or(serde_json::json!({})))
}

#[tauri::command]
pub fn project_search(cwd: String, query: String) -> Result<Vec<SearchResult>, String> {
    // Try ripgrep first, fall back to simple search
    let output = Command::new("rg")
        .args(["--line-number", "--no-heading", "--max-count", "50", &query])
        .current_dir(&cwd)
        .output();

    match output {
        Ok(out) if out.status.success() || out.status.code() == Some(1) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let results: Vec<SearchResult> = stdout
                .lines()
                .filter_map(|line| {
                    // format: file:line:text
                    let mut parts = line.splitn(3, ':');
                    let file = parts.next()?;
                    let line_num: u32 = parts.next()?.parse().ok()?;
                    let text = parts.next()?.to_string();
                    Some(SearchResult {
                        file: file.to_string(),
                        line: line_num,
                        text,
                    })
                })
                .collect();
            Ok(results)
        }
        _ => {
            // ripgrep not available — return empty
            Ok(vec![])
        }
    }
}
