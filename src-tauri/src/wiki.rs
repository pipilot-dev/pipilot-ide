//! Wiki operations — file-based markdown wiki in .pipilot/wiki/.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct WikiEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub children: Option<Vec<WikiEntry>>,
}

#[derive(Serialize, Clone)]
pub struct WikiPage {
    pub path: String,
    pub content: String,
}

// ── Helpers ──

fn walk_wiki_dir(dir: &Path, base: &Path) -> Vec<WikiEntry> {
    let mut entries = Vec::new();
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return entries,
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            let children = walk_wiki_dir(&path, base);
            entries.push(WikiEntry {
                name,
                path: rel,
                is_dir: true,
                children: Some(children),
            });
        } else if name.ends_with(".md") {
            entries.push(WikiEntry {
                name,
                path: rel,
                is_dir: false,
                children: None,
            });
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    entries
}

// ── Tauri commands ──

#[tauri::command]
pub fn wiki_tree(cwd: String) -> Result<Vec<WikiEntry>, String> {
    let wiki_dir = Path::new(&cwd).join(".pipilot").join("wiki");
    if !wiki_dir.exists() {
        return Ok(vec![]);
    }
    Ok(walk_wiki_dir(&wiki_dir, &wiki_dir))
}

#[tauri::command]
pub fn wiki_page(cwd: String, page_path: String) -> Result<WikiPage, String> {
    let full_path = Path::new(&cwd).join(".pipilot").join("wiki").join(&page_path);
    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read wiki page {}: {}", page_path, e))?;
    Ok(WikiPage {
        path: page_path,
        content,
    })
}

#[tauri::command]
pub fn wiki_scan(cwd: String) -> Result<Vec<String>, String> {
    let cwd_path = Path::new(&cwd);
    let mut md_files = Vec::new();

    fn scan_dir(dir: &Path, base: &Path, results: &mut Vec<String>, depth: u32) {
        if depth > 5 {
            return; // limit depth
        }
        let read_dir = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden dirs and node_modules
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }

            if path.is_dir() {
                scan_dir(&path, base, results, depth + 1);
            } else if name.ends_with(".md") {
                let rel = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                results.push(rel);
            }
        }
    }

    scan_dir(cwd_path, cwd_path, &mut md_files, 0);
    md_files.sort();
    Ok(md_files)
}

#[tauri::command]
pub fn wiki_save(cwd: String, page_path: String, content: String) -> Result<(), String> {
    let full_path = Path::new(&cwd).join(".pipilot").join("wiki").join(&page_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create wiki directory: {}", e))?;
    }
    fs::write(&full_path, content)
        .map_err(|e| format!("Failed to save wiki page {}: {}", page_path, e))
}
