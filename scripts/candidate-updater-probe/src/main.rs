// Test-only native SDK client. Never run the installed Hara App or replace a live application.
use std::{error::Error, fs, path::PathBuf};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 8 { return Err("expected old-config,target,private-root,private-exe,loopback-endpoint,new-version,mode".into()); }
    if !matches!(args[2].as_str(), "darwin-aarch64" | "darwin-x86_64" | "linux-x86_64" | "windows-x86_64") { return Err("invalid target".into()); }
    if !matches!(args[7].as_str(), "download" | "install") { return Err("invalid test mode".into()); }
    let root = fs::canonicalize(&args[3])?;
    let exe = fs::canonicalize(&args[4])?;
    if !exe.starts_with(&root) || !root.components().any(|c| c.as_os_str().to_string_lossy().starts_with("hara-candidate-")) {
        return Err("executable must be in this candidate's private root".into());
    }
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&args[1])?)?;
    let current = config["version"].as_str().ok_or("old version missing")?;
    if !matches!(current, "0.1.187" | "1.0.3") { return Err("unexpected old version".into()); }
    let original = &config["plugins"]["updater"];
    if original["endpoints"] != serde_json::json!([
        "https://assets.nanhara.com/hara/desktop/stable/latest.json",
        "https://github.com/hara-cli/hara-desktop/releases/latest/download/latest.json"
    ]) { return Err("original endpoint order changed".into()); }
    let endpoint: tauri::Url = args[5].parse()?;
    if endpoint.scheme() != "http" || endpoint.host_str() != Some("127.0.0.1") || endpoint.port().is_none()
        || endpoint.path() != "/latest.json" || endpoint.query().is_some() || endpoint.fragment().is_some()
        || endpoint.username() != "" || endpoint.password().is_some() { return Err("only the test loopback endpoint is allowed".into()); }
    let mut test_updater = original.clone();
    test_updater["endpoints"] = serde_json::json!([endpoint.as_str()]);
    // This single test endpoint is HTTP; TLS certificate checks are NOT relaxed. Signature,
    // comparator, download and installation code remain the unchanged pinned upstream SDK.
    test_updater["dangerousInsecureTransportProtocol"] = serde_json::json!(true);
    test_updater["dangerousAcceptInvalidCerts"] = serde_json::json!(false);
    test_updater["dangerousAcceptInvalidHostnames"] = serde_json::json!(false);
    let mut context = mock_context(noop_assets());
    context.package_info_mut().name = "Hara".into();
    context.package_info_mut().version = current.parse()?;
    context.config_mut().identifier = "com.nanhara.hara.private-candidate-upgrade-probe".into();
    context.config_mut().plugins.0.insert("updater".into(), test_updater);
    let app = mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context)?;
    let client = app.updater_builder().target(&args[2]).executable_path(&exe).no_proxy().build()?;
    tauri::async_runtime::block_on(async {
        let update = client.check().await?.ok_or("candidate was not detected")?;
        if update.current_version != current || update.version != args[6] { return Err::<(), Box<dyn Error>>("version mismatch".into()); }
        if update.download_url.origin() != endpoint.origin() { return Err("unexpected candidate payload origin".into()); }
        let mut received = 0_u64;
        if args[7] == "install" {
            if !cfg!(target_os = "macos") || !exe.ends_with("Hara.app/Contents/MacOS/hara-desktop") { return Err("private install is macOS-App-only".into()); }
            update.download_and_install(|n, _| received += n as u64, || {}).await?;
        } else {
            let bytes = update.download(|n, _| received += n as u64, || {}).await?;
            if bytes.is_empty() { return Err("empty verified download".into()); }
        }
        println!("{}", serde_json::json!({"from":current,"to":args[6],"target":args[2],"checked":true,
            "signatureVerified":true,"bytes":received,"privateInstalled":args[7]=="install"}));
        Ok(())
    })
}
