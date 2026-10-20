fn main() {
    println!("cargo:rerun-if-env-changed=HARA_DESKTOP_UPDATE_CHANNEL");
    let channel = std::env::var("HARA_DESKTOP_UPDATE_CHANNEL").unwrap_or_else(|_| "stable".into());
    assert!(matches!(channel.as_str(), "candidate" | "stable"), "unsupported Hara update channel");
    println!("cargo:rustc-env=HARA_DESKTOP_UPDATE_CHANNEL={channel}");
    tauri_build::build()
}
