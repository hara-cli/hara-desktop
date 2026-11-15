//! Hara Dev is updated by its development launcher, never by the public updater.
//! Keep the installed application's registration and commands unchanged.
pub const IDENTIFIER: &str = "com.nanhara.hara.dev";
pub const DISABLED: &str = "Hara Dev updates through hara-desk-dev; public updates are disabled";

pub fn is_development(identifier: &str) -> bool {
    identifier == IDENTIFIER
}

pub fn ensure_public_updates(identifier: &str) -> Result<(), String> {
    if is_development(identifier) {
        Err(DISABLED.into())
    } else {
        Ok(())
    }
}

pub fn register_public_updater<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    identifier: &str,
) -> tauri::Builder<R> {
    if is_development(identifier) {
        builder
    } else {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    }
}
