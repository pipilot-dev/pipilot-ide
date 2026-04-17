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
    let raw_resource_dir = app
        .path()
        .resource_dir()
        .expect("failed to resolve resource dir");

    // On Windows, resource_dir() returns \\?\ prefixed paths which Node.js can't handle.
    // Strip the prefix and canonicalize to a normal path.
    let resource_dir_str = raw_resource_dir.to_string_lossy().to_string();
    let resource_dir_str = resource_dir_str.strip_prefix("\\\\?\\").unwrap_or(&resource_dir_str).to_string();
    let resource_dir = std::path::PathBuf::from(&resource_dir_str);

    // Bundles are inside the resources/ subdirectory
    let script_path = resource_dir.join("resources").join(script_name);
    let script_str = script_path.to_string_lossy().to_string();

    // Build args: [script_path, ...extra_args]
    let mut args: Vec<String> = vec![script_str];
    for a in extra_args {
        args.push(a.to_string());
    }

    // Look for .env in the user's PiPilot config directory
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| resource_dir.clone());
    let env_file = config_dir.join(".env");

    let shell = app.shell();
    let mut command = shell
        .sidecar("node-sidecar")
        .expect("failed to create sidecar command")
        .args(args)
        .env("NODE_ENV", "production")
        .env(
            "NODE_PATH",
            resource_dir.join("resources").join("node_modules").to_string_lossy().to_string(),
        )
        // Baked-in API config — users shouldn't need manual .env setup
        .env("ANTHROPIC_BASE_URL", "https://the3rdacademy.com/api")
        .env("ANTHROPIC_AUTH_TOKEN", "sk-praxis-6685c84fda3dc26efa6b20e79e7fb704d5eb7002b59a106c5ba8b7777948dcca")
        .env("ANTHROPIC_API_KEY", "sk-ant-api03-placeholder-key-for-sdk-validation-only")
        .env("ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-6")
        .env("ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-sonnet-4-6")
        .env("ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-sonnet-4-6")
        .env("CLAUDE_CODE_REMOTE", "true");

    // If user has a custom .env in config dir, let it override defaults
    if env_file.exists() {
        command = command.env(
            "DOTENV_CONFIG_PATH",
            env_file.to_string_lossy().to_string(),
        );
    }

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
        .plugin(tauri_plugin_opener::init())
        // Always enable logging so we can see sidecar output
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // Spawn sidecar servers in production mode
            // In dev mode, servers are started manually via `pnpm dev:server`
            if !cfg!(debug_assertions) {
                log::info!("Production mode — spawning sidecar servers...");

                let resource_dir = app.path().resource_dir()
                    .expect("failed to resolve resource dir");
                log::info!("Resource dir: {:?}", resource_dir);

                let config_dir = app.path().app_config_dir()
                    .unwrap_or_else(|_| resource_dir.clone());
                log::info!("Config dir: {:?}", config_dir);

                // Ensure config dir exists (for .env placement)
                let _ = std::fs::create_dir_all(&config_dir);

                match spawn_sidecar(app, "server-bundle.mjs", &[]) {
                    Ok(child) => {
                        log::info!("Agent sidecar spawned successfully");
                        app.manage(SidecarState {
                            agent_child: Mutex::new(Some(child)),
                            cloud_child: Mutex::new(None),
                        });
                    }
                    Err(e) => {
                        log::error!("Failed to spawn agent sidecar: {}", e);
                        app.manage(SidecarState {
                            agent_child: Mutex::new(None),
                            cloud_child: Mutex::new(None),
                        });
                        return Ok(());
                    }
                }

                match spawn_sidecar(app, "cloud-bundle.mjs", &["--standalone"]) {
                    Ok(child) => {
                        log::info!("Cloud sidecar spawned successfully");
                        let state = app.state::<SidecarState>();
                        *state.cloud_child.lock().unwrap() = Some(child);
                    }
                    Err(e) => {
                        log::error!("Failed to spawn cloud sidecar: {}", e);
                    }
                }
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
