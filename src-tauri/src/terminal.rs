//! Terminal PTY management via portable-pty.
//!
//! Provides Tauri IPC commands for creating, writing to, resizing,
//! and killing terminal sessions. Output is streamed to the frontend
//! via Tauri events (zero HTTP overhead).

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter};

/// Active terminal session
struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// Shared state for all terminal sessions
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    counter: Mutex<u32>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            counter: Mutex::new(0),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TerminalCreateResult {
    pub id: String,
    pub success: bool,
}

#[derive(Serialize, Clone)]
struct TerminalDataEvent {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExitEvent {
    id: String,
    code: Option<u32>,
}

/// Create a new terminal session with a PTY.
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    cwd: String,
    shell: Option<String>,
) -> Result<TerminalCreateResult, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Determine shell
    let shell_cmd = shell.unwrap_or_else(|| {
        if cfg!(windows) {
            std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
    });

    let mut cmd = CommandBuilder::new(&shell_cmd);
    cmd.cwd(&cwd);

    // Inherit environment
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Generate unique ID
    let id = {
        let mut counter = state.counter.lock().unwrap();
        *counter += 1;
        format!("term_{}", *counter)
    };

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get writer: {}", e))?;

    // Spawn reader thread — streams PTY output to frontend via Tauri events
    let reader_id = id.clone();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get reader: {}", e))?;

    let app_handle = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(
                        "terminal:data",
                        TerminalDataEvent {
                            id: reader_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // Process exited
        let _ = app_handle.emit(
            "terminal:exit",
            TerminalExitEvent {
                id: reader_id.clone(),
                code: None,
            },
        );
    });

    // Spawn a thread to wait for the child process to exit
    let exit_id = id.clone();
    let app_exit = app.clone();
    thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
        let _ = app_exit.emit(
            "terminal:exit",
            TerminalExitEvent {
                id: exit_id,
                code: None,
            },
        );
    });

    // Store the session
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(
            id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
            },
        );
    }

    Ok(TerminalCreateResult {
        id,
        success: true,
    })
}

/// Write data to a terminal session (keyboard input from frontend).
#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
    }
    Ok(())
}

/// Resize a terminal session.
#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
    }
    Ok(())
}

/// Kill a terminal session.
#[tauri::command]
pub fn terminal_kill(state: tauri::State<'_, TerminalState>, id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    // Dropping the session closes the PTY which signals the child to exit
    sessions.remove(&id);
    Ok(())
}
