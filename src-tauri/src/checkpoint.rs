//! Checkpoint operations via git CLI and JSON index files.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone)]
pub struct CheckpointEntry {
    pub id: String,
    pub sha: String,
    pub label: String,
    #[serde(rename = "messageId")]
    pub message_id: Option<String>,
    pub timestamp: u64,
}

// ── Helpers ──

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("git error: {}", stderr.trim()))
    }
}

#[allow(dead_code)]
fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn index_path(data_dir: &str, project_id: &str) -> std::path::PathBuf {
    Path::new(data_dir).join(project_id).join("index.json")
}

fn read_index(data_dir: &str, project_id: &str) -> Vec<CheckpointEntry> {
    let path = index_path(data_dir, project_id);
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn write_index(data_dir: &str, project_id: &str, entries: &[CheckpointEntry]) -> Result<(), String> {
    let path = index_path(data_dir, project_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create checkpoint dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize index: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write index: {}", e))
}

// ── Tauri commands ──

#[tauri::command]
pub fn checkpoint_create(cwd: String, label: String, _message_id: Option<String>) -> Result<String, String> {
    run_git(&cwd, &["add", "-A"])?;
    let msg = format!("checkpoint: {}", label);
    run_git(&cwd, &["commit", "-m", &msg, "--allow-empty"])?;
    let sha = run_git(&cwd, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();
    Ok(sha)
}

#[tauri::command]
pub fn checkpoint_list(data_dir: String, project_id: String) -> Result<Vec<CheckpointEntry>, String> {
    Ok(read_index(&data_dir, &project_id))
}

#[tauri::command]
pub fn checkpoint_restore(cwd: String, sha: String) -> Result<(), String> {
    run_git(&cwd, &["checkout", &sha, "--", "."])?;
    run_git(&cwd, &["clean", "-fd"])?;
    Ok(())
}

#[tauri::command]
pub fn checkpoint_find_before(
    data_dir: String,
    project_id: String,
    message_id: String,
) -> Result<Option<CheckpointEntry>, String> {
    let entries = read_index(&data_dir, &project_id);
    let target = format!("before-{}", message_id);
    let found = entries.into_iter().find(|e| e.label == target || e.message_id.as_deref() == Some(&message_id));
    Ok(found)
}

#[tauri::command]
pub fn checkpoint_delete(data_dir: String, project_id: String, checkpoint_id: String) -> Result<(), String> {
    let mut entries = read_index(&data_dir, &project_id);
    entries.retain(|e| e.id != checkpoint_id);
    write_index(&data_dir, &project_id, &entries)
}

#[tauri::command]
pub fn checkpoint_clear(data_dir: String, project_id: String) -> Result<(), String> {
    write_index(&data_dir, &project_id, &[])
}

#[tauri::command]
pub fn checkpoint_git_available() -> Result<bool, String> {
    let output = Command::new("git").arg("--version").output();
    Ok(output.map(|o| o.status.success()).unwrap_or(false))
}
