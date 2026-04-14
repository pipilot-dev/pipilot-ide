use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct FsStat {
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub modified: u64,
}

// ── Commands ──

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
pub fn fs_write_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs for {}: {}", path, e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {}: {}", path, e))
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("Failed to delete dir {}: {}", path, e))
    } else {
        fs::remove_file(p).map_err(|e| format!("Failed to delete file {}: {}", path, e))
    }
}

#[tauri::command]
pub fn fs_rename(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename {} -> {}: {}", old_path, new_path, e))
}

#[tauri::command]
pub fn fs_copy(src: String, dest: String) -> Result<(), String> {
    let src_path = Path::new(&src);
    if src_path.is_dir() {
        copy_dir_recursive(src_path, Path::new(&dest))
            .map_err(|e| format!("Failed to copy dir {} -> {}: {}", src, dest, e))
    } else {
        // Ensure parent of dest exists
        if let Some(parent) = Path::new(&dest).parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::copy(&src, &dest)
            .map(|_| ())
            .map_err(|e| format!("Failed to copy {} -> {}: {}", src, dest, e))
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to list {}: {}", path, e))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Error reading entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Error reading metadata: {}", e))?;
        result.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    // Sort: directories first, then alphabetical
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(result)
}

#[tauri::command]
pub fn fs_stat(path: String) -> Result<FsStat, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to stat {}: {}", path, e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(FsStat {
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        modified,
    })
}

#[tauri::command]
pub fn fs_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub fn fs_watch(app: AppHandle, path: String) -> Result<(), String> {
    use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {}: {}", path, e))?;

    // Spawn a thread to forward events to the frontend
    std::thread::spawn(move || {
        // Keep watcher alive for the lifetime of this thread
        let _watcher = watcher;
        for result in rx {
            if let Ok(event) = result {
                let paths: Vec<String> = event
                    .paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                let kind = format!("{:?}", event.kind);
                let _ = app.emit(
                    "fs:changed",
                    serde_json::json!({ "kind": kind, "paths": paths }),
                );
            }
        }
    });

    Ok(())
}
