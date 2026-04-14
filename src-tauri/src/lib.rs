mod filesystem;
mod git;
mod terminal;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(terminal::TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            filesystem::fs_read_file,
            filesystem::fs_write_file,
            filesystem::fs_create_dir,
            filesystem::fs_delete,
            filesystem::fs_rename,
            filesystem::fs_copy,
            filesystem::fs_list_dir,
            filesystem::fs_stat,
            filesystem::fs_exists,
            filesystem::fs_watch,
            git::git_check,
            git::git_status,
            git::git_init,
            git::git_add,
            git::git_commit,
            git::git_log,
            git::git_diff,
            git::git_push,
            git::git_pull,
            git::git_branch_list,
            git::git_branch_create,
            git::git_checkout,
        ])
        .setup(|app| {
            // Spawn the Express servers as sidecar processes
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                start_servers(&handle);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_servers(_handle: &tauri::AppHandle) {
    // In dev mode, servers are started by the dev script.
    // In production, spawn tsx/node to run the Express servers.
    #[cfg(not(debug_assertions))]
    {
        use std::process::Command;
        let resource_dir = _handle
            .path()
            .resource_dir()
            .expect("failed to get resource dir");

        // Start agent server
        let _ = Command::new("node")
            .arg(resource_dir.join("server").join("index.js"))
            .spawn();

        // Start cloud server
        let _ = Command::new("node")
            .arg(resource_dir.join("server").join("cloud.js"))
            .arg("--standalone")
            .spawn();
    }
}
