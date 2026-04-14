mod checkpoint;
mod cloud;
mod codestral;
mod devserver;
mod diagnostics;
mod filesystem;
mod git;
mod terminal;
mod wiki;
mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(terminal::TerminalState::new())
        .manage(cloud::CloudState::new())
        .manage(devserver::DevServerState::new())
        .invoke_handler(tauri::generate_handler![
            // Terminal
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            // Filesystem
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
            // Git
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
            // Cloud
            cloud::cloud_save_token,
            cloud::cloud_status,
            cloud::cloud_github_repos,
            cloud::cloud_github_issues,
            cloud::cloud_github_pulls,
            cloud::cloud_github_actions,
            cloud::cloud_github_branches,
            cloud::cloud_github_commits,
            cloud::cloud_github_create_repo,
            cloud::cloud_github_create_issue,
            cloud::cloud_github_create_pr,
            cloud::cloud_vercel_projects,
            cloud::cloud_vercel_deployments,
            cloud::cloud_vercel_env,
            cloud::cloud_vercel_domains,
            cloud::cloud_supabase_projects,
            cloud::cloud_supabase_sql,
            cloud::cloud_neon_projects,
            cloud::cloud_netlify_sites,
            cloud::cloud_cloudflare_zones,
            cloud::cloud_cloudflare_dns,
            cloud::cloud_cloudflare_account,
            cloud::cloud_cloudflare_workers,
            cloud::cloud_cloudflare_pages,
            // Checkpoint
            checkpoint::checkpoint_create,
            checkpoint::checkpoint_list,
            checkpoint::checkpoint_restore,
            checkpoint::checkpoint_find_before,
            checkpoint::checkpoint_delete,
            checkpoint::checkpoint_clear,
            checkpoint::checkpoint_git_available,
            // Workspace
            workspace::workspace_link,
            workspace::workspace_unlink,
            workspace::workspace_list,
            workspace::workspace_info,
            workspace::workspace_touch,
            workspace::fs_home,
            workspace::fs_list_directory,
            workspace::project_detect_framework,
            workspace::project_scripts,
            workspace::project_search,
            // Dev Server
            devserver::dev_server_start,
            devserver::dev_server_stop,
            devserver::dev_server_status,
            devserver::dev_server_logs,
            // Wiki
            wiki::wiki_tree,
            wiki::wiki_page,
            wiki::wiki_scan,
            wiki::wiki_save,
            // Diagnostics
            diagnostics::diagnostics_check,
            diagnostics::diagnostics_install_deps,
            // Codestral
            codestral::codestral_fim,
            codestral::codestral_chat,
        ])
        .setup(|app| {
            // Spawn the agent server sidecar in production
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
    #[cfg(not(debug_assertions))]
    {
        use std::process::Command;

        // Try to find the bundled agent server
        if let Ok(resource_dir) = _handle.path().resource_dir() {
            let server_path = resource_dir.join("server-bundle").join("agent-server.mjs");
            if server_path.exists() {
                match Command::new("node")
                    .arg(&server_path)
                    .env("NODE_ENV", "production")
                    .spawn()
                {
                    Ok(_) => eprintln!("[tauri] Agent server started"),
                    Err(e) => eprintln!("[tauri] Agent server failed: {} (Node.js may not be installed)", e),
                }
            } else {
                eprintln!("[tauri] Agent server bundle not found (app works without it, but AI chat won't stream)");
            }
        }
    }
}
