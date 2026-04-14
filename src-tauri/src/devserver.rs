//! Dev server child process management.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct DevServerState {
    processes: Mutex<HashMap<String, DevProcess>>,
}

struct DevProcess {
    child: Child,
    logs: Vec<String>,
}

impl DevServerState {
    pub fn new() -> Self {
        DevServerState {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct DevServerInfo {
    pub pid: String,
    pub running: bool,
}

// ── Tauri commands ──

#[tauri::command]
pub fn dev_server_start(
    state: tauri::State<'_, DevServerState>,
    cwd: String,
    command: String,
) -> Result<DevServerInfo, String> {
    // Parse command into program + args
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }

    let program = parts[0];
    let args = &parts[1..];

    let child = Command::new(program)
        .args(args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start dev server: {}", e))?;

    let pid = child.id().to_string();

    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    processes.insert(
        pid.clone(),
        DevProcess {
            child,
            logs: vec![],
        },
    );

    Ok(DevServerInfo {
        pid: pid.clone(),
        running: true,
    })
}

#[tauri::command]
pub fn dev_server_stop(
    state: tauri::State<'_, DevServerState>,
    pid: String,
) -> Result<(), String> {
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(mut proc) = processes.remove(&pid) {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
    Ok(())
}

#[tauri::command]
pub fn dev_server_status(
    state: tauri::State<'_, DevServerState>,
    pid: String,
) -> Result<DevServerInfo, String> {
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(proc) = processes.get_mut(&pid) {
        let running = proc.child.try_wait().map_err(|e| e.to_string())?.is_none();
        Ok(DevServerInfo {
            pid: pid.clone(),
            running,
        })
    } else {
        Ok(DevServerInfo {
            pid,
            running: false,
        })
    }
}

#[tauri::command]
pub fn dev_server_logs(
    state: tauri::State<'_, DevServerState>,
    pid: String,
) -> Result<Vec<String>, String> {
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(proc) = processes.get_mut(&pid) {
        // Try to read available stdout
        if let Some(ref mut stdout) = proc.child.stdout {
            let mut buf = vec![0u8; 8192];
            // Non-blocking read attempt
            match stdout.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    for line in text.lines() {
                        proc.logs.push(line.to_string());
                    }
                }
                _ => {}
            }
        }
        Ok(proc.logs.clone())
    } else {
        Ok(vec![])
    }
}
