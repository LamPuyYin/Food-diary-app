use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    time::Duration,
};
use std::process::Command;

use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<CommandChild>>,
    url: Mutex<Option<String>>,
}

fn stop_backend(state: &BackendState) {
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            // CommandChild::kill terminates the process and waits for it to
            // exit, releasing PocketBase's database file handles.
            let _ = child.kill();
        }
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http and https URLs can be opened".to_owned());
    }

    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|error| format!("Could not open the external URL: {error}"))?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|error| format!("Could not open the external URL: {error}"))?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|error| format!("Could not open the external URL: {error}"))?;

    Ok(())
}

fn available_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("Could not reserve a backend port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Could not read the backend port: {error}"))
}

#[tauri::command]
async fn initialize_backend(
    app: tauri::AppHandle,
    state: State<'_, BackendState>,
) -> Result<String, String> {
    if let Some(url) = state.url.lock().map_err(|error| error.to_string())?.clone() {
        return Ok(url);
    }

    let port = available_port()?;
    let url = format!("http://127.0.0.1:{port}");
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?
        .join("pocketbase");
    let migrations_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve bundled resources: {error}"))?
        .join("pb_migrations");
    let hooks_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve bundled resources: {error}"))?
        .join("pb_hooks");

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not create the PocketBase data directory: {error}"))?;

    let command = app
        .shell()
        .sidecar("pocketbase")
        .map_err(|error| format!("Could not locate the PocketBase sidecar: {error}"))?
        .args([
            "serve".to_owned(),
            format!("--http=127.0.0.1:{port}"),
            format!("--dir={}", data_dir.display()),
            format!("--migrationsDir={}", migrations_dir.display()),
            format!("--hooksDir={}", hooks_dir.display()),
        ]);

    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Could not launch PocketBase: {error}"))?;

    tauri::async_runtime::spawn(async move {
        while events.recv().await.is_some() {}
    });

    *state.child.lock().map_err(|error| error.to_string())? = Some(child);

    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    for _ in 0..50 {
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            *state.url.lock().map_err(|error| error.to_string())? = Some(url.clone());
            return Ok(url);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    if let Some(child) = state.child.lock().map_err(|error| error.to_string())?.take() {
        let _ = child.kill();
    }

    Err("PocketBase did not become ready within five seconds".to_owned())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![initialize_backend, open_external_url])
        .build(tauri::generate_context!())
        .expect("error while building the Food Diary desktop app");

    app.run(|app_handle, event| {
        let state = app_handle.state::<BackendState>();
        match event {
            // CloseRequested leads to ExitRequested. Stop PocketBase at the
            // beginning of shutdown instead of waiting for final process exit.
            RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_backend(&state),
            _ => {}
        }
    });
}
