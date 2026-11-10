//! Read-only visual accessibility metadata. No filesystem, credentials, Core or runtime access.
use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemVisualPreferences {
    reduce_transparency: Option<bool>,
    increase_contrast: Option<bool>,
    reduce_motion: Option<bool>,
    low_power_mode: Option<bool>,
}

#[cfg(target_os = "macos")]
fn read_on_main_thread() -> Result<SystemVisualPreferences, String> {
    use objc2::{sel, MainThreadMarker};
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSObjectProtocol, NSProcessInfo};
    let _main = MainThreadMarker::new().ok_or("Visual preferences require the main thread")?;
    let workspace = NSWorkspace::sharedWorkspace();
    let process = NSProcessInfo::processInfo();
    // Low Power Mode is newer than our minimum macOS target. Never send an unavailable selector.
    let low_power_mode = process
        .respondsToSelector(sel!(isLowPowerModeEnabled))
        .then(|| process.isLowPowerModeEnabled());
    Ok(SystemVisualPreferences {
        reduce_transparency: Some(workspace.accessibilityDisplayShouldReduceTransparency()),
        increase_contrast: Some(workspace.accessibilityDisplayShouldIncreaseContrast()),
        reduce_motion: Some(workspace.accessibilityDisplayShouldReduceMotion()),
        low_power_mode,
    })
}

#[tauri::command]
pub async fn system_visual_preferences(
    app: tauri::AppHandle,
) -> Result<SystemVisualPreferences, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = send.send(read_on_main_thread());
        })
        .map_err(|_| "Visual preferences are unavailable".to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receive
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|_| "Visual preference query timed out".to_string())?
        })
        .await
        .map_err(|_| "Visual preference query stopped".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(SystemVisualPreferences::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn off_main_thread_is_rejected_before_any_appkit_query() {
        std::thread::spawn(|| assert!(read_on_main_thread().is_err()))
            .join()
            .unwrap();
    }
    #[test]
    fn unknown_visual_metadata_stays_unknown_and_has_only_closed_boolean_fields() {
        assert_eq!(
            serde_json::to_value(SystemVisualPreferences::default()).unwrap(),
            serde_json::json!({
                "reduceTransparency": null, "increaseContrast": null, "reduceMotion": null, "lowPowerMode": null
            })
        );
        let value = SystemVisualPreferences {
            reduce_transparency: Some(false),
            increase_contrast: Some(true),
            reduce_motion: Some(false),
            low_power_mode: Some(true),
        };
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            serde_json::json!({
                "reduceTransparency": false, "increaseContrast": true, "reduceMotion": false, "lowPowerMode": true
            })
        );
    }
}
