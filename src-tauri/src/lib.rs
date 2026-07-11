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
    #[cfg(unix)]
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
        if let Some(pid) = v.get("pid").and_then(|p| p.as_i64()) {
            let alive = unsafe { libc::kill(pid as i32, 0) } == 0
                || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
            if !alive {
                return None;
            }
        }
    }
    // non-unix: no cheap pid probe — trust the file (a stale one just makes the UI dial a dead port
    // and fall back to the start button)
    Some(raw)
}

/// Spawn `hara serve` detached. Resolution order (cc-haha sidecar blueprint, adapted):
/// 1. **Bundled sidecar** — the `hara` binary Tauri ships next to the app executable (externalBin).
///    Zero-dependency: the app works on a machine with no node/npm at all.
/// 2. PATH fallback (dev mode / user-managed installs), with two macOS traps handled: GUI apps don't
///    inherit the terminal PATH (→ login shell), and the npm shim's `#!/usr/bin/env node` may pick an
///    old MacPorts node that can't parse ESM (→ run the shim with the node that sits NEXT TO it).
/// Output → ~/.hara/serve.log (read back by `read_serve_log` for the failure UI).
#[tauri::command]
fn start_serve() -> Result<String, String> {
    // 1. bundled sidecar next to the app executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("hara");
            if sidecar.is_file() {
                let script = format!(
                    "nohup '{}' serve >\"$HOME/.hara/serve.log\" 2>&1 &",
                    sidecar.display()
                );
                return std::process::Command::new("/bin/zsh")
                    .args(["-c", &script])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map(|_| "starting bundled hara serve — log: ~/.hara/serve.log".to_string())
                    .map_err(|e| format!("could not start bundled hara: {e}"));
            }
        }
    }
    // 2. PATH fallback
    let resolve = std::process::Command::new("/bin/zsh")
        .args(["-lc", "command -v hara"])
        .output()
        .map_err(|e| format!("zsh: {e}"))?;
    let hara = String::from_utf8_lossy(&resolve.stdout).trim().to_string();
    if hara.is_empty() {
        return Err("`hara` not found — no bundled sidecar and nothing on PATH (npm i -g @nanhara/hara)".into());
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

/// Tail of ~/.hara/serve.log — shown in the UI when startup fails (cc-haha's 80-line startup buffer
/// pattern: give the user the actual error, not "connection refused").
#[tauri::command]
fn read_serve_log() -> String {
    let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) else {
        return String::new();
    };
    match std::fs::read_to_string(format!("{home}/.hara/serve.log")) {
        Ok(s) => {
            let lines: Vec<&str> = s.lines().collect();
            let start = lines.len().saturating_sub(40);
            lines[start..].join("\n")
        }
        Err(_) => String::new(),
    }
}

/// Home directory — the webview can't read env vars; used to place the global-assistant workspace
/// (`$HOME/.hara/workspace`, the same default the chat gateway uses).
#[tauri::command]
fn get_home() -> String {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default()
}

/// First-run onboarding: merge provider credentials into ~/.hara/config.json (0600) so the bundled
/// serve can authenticate — the desktop equivalent of `hara setup`. Never logs or returns the key.
#[tauri::command]
fn write_config(provider: String, api_key: String, model: String, base_url: Option<String>) -> Result<String, String> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|_| "no HOME")?;
    let dir = format!("{home}/.hara");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = format!("{dir}/config.json");
    let mut cfg: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let obj = cfg.as_object_mut().ok_or("config.json is not an object")?;
    obj.insert("provider".into(), provider.clone().into());
    obj.insert("apiKey".into(), api_key.into());
    obj.insert("model".into(), model.into());
    match base_url {
        Some(u) if !u.is_empty() => {
            obj.insert("baseURL".into(), u.into());
        }
        _ => {
            obj.remove("baseURL");
        }
    }
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(format!("configured {provider}"))
}

/// Persist a pasted clipboard image (base64 png bytes from the webview) to ~/.hara/tmp so the serve
/// side can inline it into the turn. Returns the absolute path.
#[tauri::command]
fn write_temp_image(data_base64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("image too large (>20MB)".into());
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|_| "no HOME")?;
    let dir = format!("{home}/.hara/tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!(
        "paste-{}.png",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
    );
    let path = format!("{dir}/{name}");
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Dock badge = manual unread count (macOS). None clears it.
#[tauri::command]
fn set_badge(app: tauri::AppHandle, count: Option<i64>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(count);
    }
}

/// Panel servers WE started (their port wasn't listening before start_panel ran) — terminated on app
/// exit so design/video preview servers don't pile up as orphans. A server the user already had
/// running (pre-listening on the hinted port) is never touched.
struct OwnedPanels(std::sync::Mutex<Vec<u16>>);

fn port_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(150),
    )
    .is_ok()
}

fn kill_owned_panels(ports: &[u16]) {
    #[cfg(unix)]
    for p in ports {
        let _ = std::process::Command::new("/bin/sh")
            .args(["-c", &format!("lsof -ti tcp:{p} | xargs kill 2>/dev/null")])
            .status();
    }
    #[cfg(not(unix))]
    let _ = ports; // windows: no orphan cleanup yet (panels are unix-first plugins today)
}

/// Launch a plugin panel command (e.g. `hara-design preview`) and return the URL it prints.
/// Plugin bins live in ~/.hara/bin (added to PATH by the login shell) or on PATH generally; the
/// command is expected to start/reuse its server, print `http://127.0.0.1:<port>…`, and exit.
/// `port_hint` (the manifest's declared port) drives ownership tracking for exit cleanup.
#[tauri::command]
fn start_panel(state: tauri::State<OwnedPanels>, command: String, args: Vec<String>, cwd: Option<String>, port_hint: Option<u16>) -> Result<String, String> {
    let pre_listening = port_hint.map(port_listening).unwrap_or(false);
    // basic hygiene: a panel command is a bare bin name from a plugin manifest, never shell syntax
    if !command.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid panel command".into());
    }
    let joined = args
        .iter()
        .map(|a| format!("'{}'", a.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ");
    // project panels run FROM the project dir (e.g. `hara-design preview` picks up that project's
    // .hara/design/); global panels (settings page) pass no cwd
    let cd = cwd
        .filter(|d| !d.is_empty())
        .map(|d| format!("cd '{}' && ", d.replace('\'', "'\\''")))
        .unwrap_or_default();
    let script = format!("export PATH=\"$HOME/.hara/bin:$PATH\"; {cd}{command} {joined} 2>&1");
    let out = std::process::Command::new("/bin/zsh")
        .args(["-lc", &script])
        .output()
        .map_err(|e| format!("spawn: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    match text.split_whitespace().find(|w| w.starts_with("http://127.0.0.1") || w.starts_with("http://localhost")) {
        Some(url) => {
            // ownership: we only claim (and later kill) a server when the hinted port was NOT
            // listening before we ran the command and the URL confirms that same port came up
            if let Some(hint) = port_hint {
                let actual: Option<u16> = url.rsplit(':').next().and_then(|r| r.split('/').next()).and_then(|p| p.parse().ok());
                if !pre_listening && actual == Some(hint) {
                    let mut owned = state.0.lock().unwrap();
                    if !owned.contains(&hint) {
                        owned.push(hint);
                    }
                }
            }
            Ok(url.to_string())
        }
        None => Err(format!("panel command printed no URL: {}", text.chars().take(300).collect::<String>())),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OwnedPanels(std::sync::Mutex::new(Vec::new())))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![read_discovery, start_serve, start_panel, get_home, read_serve_log, set_badge, write_config, write_temp_image])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // app exit: terminate the panel servers WE started (never a server the user had running)
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                let ports = app.state::<OwnedPanels>().0.lock().map(|v| v.clone()).unwrap_or_default();
                kill_owned_panels(&ports);
            }
        });
}
