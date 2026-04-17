use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::sync::Mutex;

struct SidecarState {
    agent_child: Mutex<Option<CommandChild>>,
    cloud_child: Mutex<Option<CommandChild>>,
}

fn spawn_sidecar(
    app: &tauri::App,
    script_name: &str,
    extra_args: &[&str],
) -> Result<CommandChild, Box<dyn std::error::Error>> {
    // Resolve the resources directory where server bundles live
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("failed to resolve resource dir");

    let script_path = resource_dir.join(script_name);
    let script_str = script_path.to_string_lossy().to_string();

    // Build args: [script_path, ...extra_args]
    let mut args: Vec<String> = vec![script_str];
    for a in extra_args {
        args.push(a.to_string());
    }

    let shell = app.shell();
    let command = shell
        .sidecar("node-sidecar")
        .expect("failed to create sidecar command")
        .args(args)
        .env("NODE_ENV", "production")
        .env(
            "NODE_PATH",
            resource_dir.join("node_modules").to_string_lossy().to_string(),
        );

    let (mut rx, child) = command.spawn().expect("failed to spawn sidecar");

    let label = script_name.to_string();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    log::info!("[{}] {}", label, text.trim());
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    log::warn!("[{}] {}", label, text.trim());
                }
                CommandEvent::Terminated(status) => {
                    log::info!("[{}] exited with {:?}", label, status);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Only enable logging in debug builds
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn sidecar servers in production mode
            // In dev mode, servers are started manually via `pnpm dev:server`
            if !cfg!(debug_assertions) {
                let agent_child =
                    spawn_sidecar(app, "server-bundle.mjs", &[]).expect("agent sidecar failed");
                let cloud_child =
                    spawn_sidecar(app, "cloud-bundle.mjs", &["--standalone"])
                        .expect("cloud sidecar failed");

                app.manage(SidecarState {
                    agent_child: Mutex::new(Some(agent_child)),
                    cloud_child: Mutex::new(Some(cloud_child)),
                });
            } else {
                app.manage(SidecarState {
                    agent_child: Mutex::new(None),
                    cloud_child: Mutex::new(None),
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<SidecarState>();
                let agent = state.agent_child.lock().unwrap().take();
                let cloud = state.cloud_child.lock().unwrap().take();
                if let Some(child) = agent {
                    let _ = child.kill();
                }
                if let Some(child) = cloud {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PiPilot IDE");
}
