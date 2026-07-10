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

/// Spawn `hara serve` detached. Two macOS traps handled here:
/// 1. GUI apps don't inherit the terminal PATH → resolve `hara` via a login shell.
/// 2. The resolved shim's `#!/usr/bin/env node` may pick an OLD system/MacPorts node that can't parse
///    ESM (`SyntaxError: Unexpected token {`) → run the shim with the `node` that sits NEXT TO it
///    (nvm keeps them in the same bin dir). Output goes to ~/.hara/serve.log so failures are diagnosable.
#[tauri::command]
fn start_serve() -> Result<String, String> {
    let resolve = std::process::Command::new("/bin/zsh")
        .args(["-lc", "command -v hara"])
        .output()
        .map_err(|e| format!("zsh: {e}"))?;
    let hara = String::from_utf8_lossy(&resolve.stdout).trim().to_string();
    if hara.is_empty() {
        return Err("`hara` not found on PATH — install it first: npm i -g @nanhara/hara".into());
    }
    let script = format!(
        "H='{hara}'; N=\"$(dirname \"$H\")/node\"; [ -x \"$N\" ] || N=node; \
         nohup \"$N\" \"$H\" serve >\"$HOME/.hara/serve.log\" 2>&1 &"
    );
    std::process::Command::new("/bin/zsh")
        .args(["-lc", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| format!("starting hara serve ({hara}) — log: ~/.hara/serve.log"))
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
