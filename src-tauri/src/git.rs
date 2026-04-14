//! Git operations via CLI — Tauri IPC commands.
//!
//! Each command shells out to `git` via `std::process::Command`,
//! keeping the implementation simple and dependency-free.

use serde::{Deserialize, Serialize};
use std::process::Command;

// ── Result types ──

#[derive(Serialize, Deserialize, Clone)]
pub struct GitCheckResult {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub staged: Vec<String>,
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitLogEntry {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

// ── Helpers ──

/// Run a git command in `cwd`, returning (stdout, stderr).
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

// ── Tauri commands ──

#[tauri::command]
pub fn git_check() -> Result<GitCheckResult, String> {
    let output = Command::new("git")
        .arg("--version")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(GitCheckResult {
                installed: true,
                version: Some(version),
            })
        }
        _ => Ok(GitCheckResult {
            installed: false,
            version: None,
        }),
    }
}

#[tauri::command]
pub fn git_status(cwd: String) -> Result<GitStatus, String> {
    // Check if it's a repo
    let is_repo = Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(&cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !is_repo {
        return Ok(GitStatus {
            is_repo: false,
            branch: String::new(),
            staged: vec![],
            modified: vec![],
            untracked: vec![],
            ahead: 0,
            behind: 0,
        });
    }

    // Branch name
    let branch = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();

    // Porcelain status for file lists
    let status_output = run_git(&cwd, &["status", "--porcelain=v1"]).unwrap_or_default();
    let mut staged = Vec::new();
    let mut modified = Vec::new();
    let mut untracked = Vec::new();

    for line in status_output.lines() {
        if line.len() < 3 {
            continue;
        }
        let x = line.chars().nth(0).unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let file = line[3..].to_string();

        if x == '?' {
            untracked.push(file);
        } else {
            if x != ' ' && x != '?' {
                staged.push(file.clone());
            }
            if y != ' ' && y != '?' {
                modified.push(file);
            }
        }
    }

    // Ahead/behind
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;
    if let Ok(ab) = run_git(&cwd, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) {
        let parts: Vec<&str> = ab.trim().split('\t').collect();
        if parts.len() == 2 {
            ahead = parts[0].parse().unwrap_or(0);
            behind = parts[1].parse().unwrap_or(0);
        }
    }

    Ok(GitStatus {
        is_repo: true,
        branch,
        staged,
        modified,
        untracked,
        ahead,
        behind,
    })
}

#[tauri::command]
pub fn git_init(cwd: String) -> Result<(), String> {
    run_git(&cwd, &["init"])?;
    Ok(())
}

#[tauri::command]
pub fn git_add(cwd: String, paths: Vec<String>) -> Result<(), String> {
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    let mut args = vec!["add"];
    args.extend(path_refs);
    run_git(&cwd, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_commit(cwd: String, message: String) -> Result<String, String> {
    run_git(&cwd, &["commit", "-m", &message])?;
    // Return the SHA of the new commit
    let sha = run_git(&cwd, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();
    Ok(sha)
}

#[tauri::command]
pub fn git_log(cwd: String, count: u32) -> Result<Vec<GitLogEntry>, String> {
    let count_str = format!("-{}", count);
    // Use a delimiter unlikely to appear in commit messages
    let format = "--format=%H\x1f%s\x1f%an\x1f%ai";
    let output = run_git(&cwd, &["log", &count_str, format])?;

    let mut entries = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() >= 4 {
            entries.push(GitLogEntry {
                sha: parts[0].to_string(),
                message: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
            });
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn git_diff(cwd: String, path: Option<String>) -> Result<String, String> {
    let mut args = vec!["diff"];
    if let Some(ref p) = path {
        args.push("--");
        args.push(p.as_str());
    }
    run_git(&cwd, &args)
}

#[tauri::command]
pub fn git_push(cwd: String, remote: String, branch: String) -> Result<(), String> {
    run_git(&cwd, &["push", &remote, &branch])?;
    Ok(())
}

#[tauri::command]
pub fn git_pull(cwd: String, remote: String, branch: String) -> Result<(), String> {
    run_git(&cwd, &["pull", &remote, &branch])?;
    Ok(())
}

#[tauri::command]
pub fn git_branch_list(cwd: String) -> Result<Vec<String>, String> {
    let output = run_git(&cwd, &["branch", "--format=%(refname:short)"])?;
    let branches: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(branches)
}

#[tauri::command]
pub fn git_branch_create(cwd: String, name: String) -> Result<(), String> {
    run_git(&cwd, &["branch", &name])?;
    Ok(())
}

#[tauri::command]
pub fn git_checkout(cwd: String, ref_name: String) -> Result<(), String> {
    run_git(&cwd, &["checkout", &ref_name])?;
    Ok(())
}
