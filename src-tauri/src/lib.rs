// hara-desktop Rust host — deliberately THIN. The agent core lives in `hara serve` (hara-cli); the
// desktop is a WebSocket JSON-RPC client rendered in the webview. Rust only does what the webview
// can't: read the serve discovery file and spawn the server.
use std::fs;

/// Read ~/.hara/serve.json — written by a running `hara serve` ({host, port, token, pid, version}).
/// Returns None when the file is missing OR its recorded pid is dead (stale file after a crash),
/// so the UI can offer to start the server instead of dialing a ghost.
#[tauri::command]
fn read_discovery() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let raw = fs::read_to_string(format!("{home}/.hara/serve.json")).ok()?;
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
        if let Some(pid) = v.get("pid").and_then(|p| p.as_i64()) {
            let alive = unsafe { libc::kill(pid as i32, 0) } == 0
                || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
            if !alive {
                return None;
            }
        }
    }
    Some(raw)
}

/// Spawn `hara serve` detached, through a login shell so the user's PATH (nvm etc.) resolves —
/// GUI apps on macOS don't inherit the terminal PATH.
#[tauri::command]
fn start_serve() -> Result<String, String> {
    std::process::Command::new("/bin/zsh")
        .args(["-lc", "nohup hara serve >/dev/null 2>&1 &"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| "starting hara serve…".to_string())
        .map_err(|e| format!("could not start `hara serve`: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_discovery, start_serve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
