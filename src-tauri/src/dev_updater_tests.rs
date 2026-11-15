//! Real command dispatch and plugin registration, with loopback metadata only.
//! Never downloads or installs a release and never starts a real app/window.
use super::*;
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};

struct Feed {
    endpoint: String,
    requests: Arc<AtomicUsize>,
    downloads: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Feed {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}/latest.json", listener.local_addr().unwrap());
        let archive = endpoint.replace("latest.json", "Hara_aarch64.app.tar.gz");
        let target = desktop_updater_target()
            .map(str::to_owned)
            .or_else(tauri_plugin_updater::target)
            .expect("supported updater fixture target");
        let mut platforms = serde_json::Map::new();
        platforms.insert(
            target,
            serde_json::json!({"url":archive,"signature":"fixture-only"}),
        );
        let body = serde_json::json!({"version":"999.0.0","notes":"local metadata fixture",
            "platforms":platforms})
        .to_string();
        let requests = Arc::new(AtomicUsize::new(0));
        let downloads = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (count, payloads, done) = (requests.clone(), downloads.clone(), stop.clone());
        let worker = thread::spawn(move || {
            while !done.load(AtomicOrdering::SeqCst) {
                match listener.accept() {
                    Ok((mut socket, _)) => {
                        socket
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        let mut request = [0; 4096];
                        let bytes = socket.read(&mut request).unwrap_or(0);
                        count.fetch_add(1, AtomicOrdering::SeqCst);
                        if String::from_utf8_lossy(&request[..bytes]).contains(".tar.gz") {
                            payloads.fetch_add(1, AtomicOrdering::SeqCst);
                        }
                        let _ = write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("local metadata fixture: {error}"),
                }
            }
        });
        Self {
            endpoint,
            requests,
            downloads,
            stop,
            worker: Some(worker),
        }
    }
}
impl Drop for Feed {
    fn drop(&mut self) {
        self.stop.store(true, AtomicOrdering::SeqCst);
        self.worker.take().unwrap().join().unwrap();
    }
}
fn app(identifier: &str, endpoint: &str) -> tauri::App<MockRuntime> {
    // Use the shipped command ACLs, with a mock runtime and no OS windows.
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = identifier.into();
    // This override belongs only to the mock application, never to shipped configuration.
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "endpoints":[endpoint],"pubkey":"fixture-only","dangerousInsecureTransport":true
        }),
    );
    let app = dev_updater::register_public_updater(mock_builder(), identifier)
        .invoke_handler(tauri::generate_handler![
            desktop_check_update,
            desktop_restart_for_update,
            restart_after_update,
            desktop_update_info
        ])
        .build(context)
        .unwrap();
    app
}
fn invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            // Use each platform's actual bundled origin, rather than a remote URL that
            // could make an ACL denial look like the Dev updater guard worked.
            url: if cfg!(any(windows, target_os = "android")) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize::<serde_json::Value>().unwrap())
}
#[test]
fn dev_updater_ipc_rejects_every_entry_and_keeps_formal_metadata_check_live() {
    let feed = Feed::new();
    // The native debug override is already loopback-only. Serialize both profiles in this test.
    std::env::set_var("HARA_DESKTOP_UPDATER_TEST_ENDPOINT", &feed.endpoint);
    let development = app(dev_updater::IDENTIFIER, &feed.endpoint);
    let window = tauri::WebviewWindowBuilder::new(&development, "main", Default::default())
        .build()
        .unwrap();
    for command in [
        "desktop_check_update",
        "desktop_restart_for_update",
        "restart_after_update",
    ] {
        assert_eq!(
            invoke(&window, command),
            Err(serde_json::json!(dev_updater::DISABLED)),
            "{command}"
        );
    }
    for command in ["check", "download", "install", "download_and_install"] {
        let error = invoke(&window, &format!("plugin:updater|{command}"))
            .expect_err("Dev must not register the updater plugin");
        assert!(
            error.to_string().contains("not found"),
            "unexpected plugin response: {error}"
        );
    }
    let info = invoke(&window, "desktop_update_info").unwrap();
    assert_eq!(info["isolatedDevelopment"], true);
    assert_eq!(info["channel"], "development");
    assert_eq!(feed.requests.load(AtomicOrdering::SeqCst), 0);
    assert_eq!(feed.downloads.load(AtomicOrdering::SeqCst), 0);
    drop(window);
    drop(development);

    // The production endpoint override is deliberately debug-only. Never contact a public feed
    // from release-mode tests; keep the Dev denial assertions above in both build modes.
    #[cfg(debug_assertions)]
    {
        // Negative control: the same real registration/command path works for the installed profile.
        let formal = app("com.nanhara.hara", &feed.endpoint);
        let window = tauri::WebviewWindowBuilder::new(&formal, "main", Default::default())
            .build()
            .unwrap();
        let formal_info = invoke(&window, "desktop_update_info").unwrap();
        assert!(formal_info.get("isolatedDevelopment").is_none());
        assert_eq!(formal_info["channel"], update_channel::channel());
        assert_eq!(
            invoke(&window, "desktop_check_update").unwrap()["version"],
            "999.0.0"
        );
        assert_eq!(
            invoke(&window, "plugin:updater|check").unwrap()["version"],
            "999.0.0"
        );
        assert_eq!(feed.requests.load(AtomicOrdering::SeqCst), 2);
        assert_eq!(feed.downloads.load(AtomicOrdering::SeqCst), 0);
    }
    std::env::remove_var("HARA_DESKTOP_UPDATER_TEST_ENDPOINT");
}
