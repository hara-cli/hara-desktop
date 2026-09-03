// hara-desktop Rust host — deliberately THIN. The agent core lives in `hara serve` (hara-cli); the
// desktop is a WebSocket JSON-RPC client rendered in the webview. Rust only does what the webview
// can't: read the serve discovery file and spawn the server.
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use tauri::Manager;

#[cfg(windows)]
mod windows_process;

const MAX_PET_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PET_ASSET_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PET_CATALOG_SCAN_ENTRIES: usize = 512;
const MAX_PET_CATALOG_ENTRIES: usize = 256;
const PET_SHEET_WIDTH: u32 = 1536;
const PET_FRAME_WIDTH: u32 = 192;
const PET_FRAME_HEIGHT: u32 = 208;
const MAX_SERVE_DISCOVERY_BYTES: u64 = 64 * 1024;
const MAX_MANAGED_CLI_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MANAGED_CLI_RECEIPT_BYTES: u64 = 16 * 1024;
const MAX_DROPPED_ATTACHMENT_PATHS: usize = 32;
const MAX_COMPOSER_IMAGE_BYTES: usize = 3_600_000;
const MAX_COMPOSER_IMAGE_BASE64_BYTES: usize = (MAX_COMPOSER_IMAGE_BYTES + 2) / 3 * 4;
const MAX_PRESENTATION_IMAGE_BYTES: usize = 3_000_000;
const MAX_PRESENTATION_IMAGE_DIMENSION: u32 = 8_192;
const MAX_PRESENTATION_IMAGE_PIXELS: u64 = 32_000_000;
const MANAGED_CLI_RECEIPT_SCHEMA: u8 = 1;
const BUNDLED_CLI_VERSION: &str = include_str!("../binaries/SIDECAR_VERSION");
const DEFAULT_MAIN_WINDOW_WIDTH: u32 = 1100;
const DEFAULT_MAIN_WINDOW_HEIGHT: u32 = 760;
const MIN_MAIN_WINDOW_WIDTH: u32 = 720;
const MIN_MAIN_WINDOW_HEIGHT: u32 = 480;
const EXTENSION_MAIN_WINDOW_WIDTH: u32 = 1480;
const MIN_PANEL_NODE_MAJOR: u32 = 18;
const PREFERRED_PANEL_NODE_MAJOR: u32 = 22;
const PANEL_NODE_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg(any(windows, test))]
const WINDOWS_UPDATE_STAGING_PREFIX: &str = "Hara-";
#[cfg(any(windows, test))]
const WINDOWS_UPDATE_STAGING_MARKER: &str = "-updater-";
#[cfg(any(windows, test))]
const WINDOWS_UPDATE_STAGING_RANDOM_MIN: usize = 6;
#[cfg(any(windows, test))]
const WINDOWS_UPDATE_STAGING_RANDOM_MAX: usize = 32;
#[cfg(any(windows, test))]
const WINDOWS_UPDATE_STAGING_ROOT_SCAN_LIMIT: usize = 16_384;
#[cfg(any(windows, test))]
const WINDOWS_UPDATE_STAGING_FILE_LIMIT: usize = 8;
#[cfg(windows)]
const WINDOWS_UPDATE_STAGING_AUTOCLEAN_AGE: std::time::Duration =
    std::time::Duration::from_secs(60 * 60);
#[cfg(windows)]
const WINDOWS_RENDERER_BOOT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
#[cfg(windows)]
const WINDOWS_RENDERER_RECREATE_DELAY: std::time::Duration = std::time::Duration::from_millis(350);
#[cfg(windows)]
const WINDOWS_SOFTWARE_RENDERER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu";
const CRASH_REPORT_ENDPOINT: &str = "https://gw.nanhara.tech/v1/desktop/crash-reports";
const CRASH_REPORT_VERSION: u8 = 1;
const CRASH_CONSENT_VERSION: u8 = 1;
const CRASH_REPORT_MAX_BYTES: u64 = 16 * 1024;
const CRASH_RUN_MARKER_PREFIX: &str = "desktop-run-";
const CRASH_RUN_MARKER_SUFFIX: &str = ".active";
const CRASH_PENDING_FILE: &str = "pending-crash-report.json";

#[derive(Default)]
struct RendererBootState {
    ready: AtomicBool,
    #[cfg(windows)]
    software_mode: AtomicBool,
    #[cfg(windows)]
    fallback_started: AtomicBool,
}

#[cfg(windows)]
fn windows_software_renderer_marker<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    use tauri::Manager;
    let version = app.package_info().version.to_string();
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("resolve Hara renderer cache: {error}"))?;
    Ok(cache.join(format!("webview2-software-{version}.flag")))
}

#[cfg(windows)]
fn windows_software_renderer_was_required<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let Ok(marker) = windows_software_renderer_marker(app) else {
        return false;
    };
    fs::symlink_metadata(marker)
        .map(|metadata| {
            metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() <= 64
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn remember_windows_software_renderer<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let marker = windows_software_renderer_marker(app)?;
    let parent = marker
        .parent()
        .ok_or_else(|| "Hara renderer marker has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("prepare Hara renderer cache: {error}"))?;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
    {
        Ok(mut file) => file
            .write_all(b"software-renderer-required\n")
            .map_err(|error| format!("write Hara renderer marker: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!("create Hara renderer marker: {error}")),
    }
}

#[tauri::command]
fn renderer_ready<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, RendererBootState>,
) -> Result<(), String> {
    state.ready.store(true, Ordering::Release);
    #[cfg(windows)]
    if state.software_mode.load(Ordering::Acquire) {
        remember_windows_software_renderer(&app)?;
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

fn macos_updater_target(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "x86_64") => Some("darwin-x86_64"),
        ("macos", "aarch64") => Some("darwin-aarch64"),
        _ => None,
    }
}

#[tauri::command]
fn desktop_updater_target() -> Option<&'static str> {
    macos_updater_target(std::env::consts::OS, std::env::consts::ARCH)
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateStorageStatus {
    supported: bool,
    directory: String,
    managed_entries: usize,
    managed_bytes: u64,
    protected_entries: usize,
    removed_entries: usize,
    reclaimed_bytes: u64,
    failed_entries: usize,
    scan_complete: bool,
}

impl DesktopUpdateStorageStatus {
    fn unsupported() -> Self {
        Self {
            supported: false,
            directory: String::new(),
            managed_entries: 0,
            managed_bytes: 0,
            protected_entries: 0,
            removed_entries: 0,
            reclaimed_bytes: 0,
            failed_entries: 0,
            scan_complete: true,
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct ManagedUpdateStagingEntry {
    path: PathBuf,
    bytes: u64,
    modified: Option<std::time::SystemTime>,
}

#[cfg(any(windows, test))]
fn windows_update_staging_version(name: &str) -> Option<&str> {
    let remainder = name.strip_prefix(WINDOWS_UPDATE_STAGING_PREFIX)?;
    let (version, random) = remainder.rsplit_once(WINDOWS_UPDATE_STAGING_MARKER)?;
    if version.is_empty()
        || !version.as_bytes().first().is_some_and(u8::is_ascii_digit)
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
        || !(WINDOWS_UPDATE_STAGING_RANDOM_MIN..=WINDOWS_UPDATE_STAGING_RANDOM_MAX)
            .contains(&random.len())
        || !random.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(version)
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes()
        & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
        != 0
}

#[cfg(all(not(windows), test))]
fn metadata_is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(any(windows, test))]
fn managed_update_staging_entry(path: &Path, version: &str) -> Option<ManagedUpdateStagingEntry> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return None;
    }

    let mut bytes = 0_u64;
    let mut files = 0_usize;
    for child in fs::read_dir(path).ok()? {
        let child = child.ok()?;
        files += 1;
        if files > WINDOWS_UPDATE_STAGING_FILE_LIMIT {
            return None;
        }
        let child_path = child.path();
        let child_metadata = fs::symlink_metadata(&child_path).ok()?;
        if !child_metadata.is_file()
            || child_metadata.file_type().is_symlink()
            || metadata_is_reparse_point(&child_metadata)
        {
            return None;
        }
        let filename = child.file_name();
        let filename = filename.to_str()?;
        let extension = child_path.extension()?.to_str()?.to_ascii_lowercase();
        if !filename.starts_with("Hara")
            || !filename.contains(version)
            || !matches!(extension.as_str(), "exe" | "msi" | "zip")
        {
            return None;
        }
        bytes = bytes.saturating_add(child_metadata.len());
    }

    Some(ManagedUpdateStagingEntry {
        path: path.to_path_buf(),
        bytes,
        modified: metadata.modified().ok(),
    })
}

#[cfg(any(windows, test))]
fn collect_windows_update_storage(
    root: &Path,
) -> (DesktopUpdateStorageStatus, Vec<ManagedUpdateStagingEntry>) {
    let mut status = DesktopUpdateStorageStatus {
        supported: true,
        directory: root.to_string_lossy().into_owned(),
        managed_entries: 0,
        managed_bytes: 0,
        protected_entries: 0,
        removed_entries: 0,
        reclaimed_bytes: 0,
        failed_entries: 0,
        scan_complete: true,
    };
    let mut managed = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => {
            status.scan_complete = false;
            return (status, managed);
        }
    };

    for (index, entry) in entries.enumerate() {
        if index >= WINDOWS_UPDATE_STAGING_ROOT_SCAN_LIMIT {
            status.scan_complete = false;
            break;
        }
        let Ok(entry) = entry else {
            status.scan_complete = false;
            continue;
        };
        let Some(name) = entry.file_name().to_str().map(ToOwned::to_owned) else {
            continue;
        };
        let Some(version) = windows_update_staging_version(&name) else {
            continue;
        };
        match managed_update_staging_entry(&entry.path(), version) {
            Some(candidate) => {
                status.managed_entries += 1;
                status.managed_bytes = status.managed_bytes.saturating_add(candidate.bytes);
                managed.push(candidate);
            }
            None => status.protected_entries += 1,
        }
    }
    (status, managed)
}

#[cfg(any(windows, test))]
fn clean_windows_update_storage_at(
    root: &Path,
    minimum_age: std::time::Duration,
) -> DesktopUpdateStorageStatus {
    let (_, candidates) = collect_windows_update_storage(root);
    let now = std::time::SystemTime::now();
    let mut removed_entries = 0_usize;
    let mut reclaimed_bytes = 0_u64;
    let mut failed_entries = 0_usize;

    for candidate in candidates {
        let old_enough = minimum_age.is_zero()
            || candidate
                .modified
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age >= minimum_age);
        if !old_enough {
            continue;
        }

        let removed = fs::read_dir(&candidate.path)
            .and_then(|entries| {
                for child in entries {
                    fs::remove_file(child?.path())?;
                }
                fs::remove_dir(&candidate.path)
            })
            .is_ok();
        if removed {
            removed_entries += 1;
            reclaimed_bytes = reclaimed_bytes.saturating_add(candidate.bytes);
        } else {
            failed_entries += 1;
        }
    }

    let (mut status, _) = collect_windows_update_storage(root);
    status.removed_entries = removed_entries;
    status.reclaimed_bytes = reclaimed_bytes;
    status.failed_entries = failed_entries;
    status
}

#[tauri::command]
fn inspect_desktop_update_storage() -> DesktopUpdateStorageStatus {
    #[cfg(windows)]
    {
        collect_windows_update_storage(&std::env::temp_dir()).0
    }
    #[cfg(not(windows))]
    {
        DesktopUpdateStorageStatus::unsupported()
    }
}

#[tauri::command]
fn clean_desktop_update_storage() -> DesktopUpdateStorageStatus {
    #[cfg(windows)]
    {
        clean_windows_update_storage_at(&std::env::temp_dir(), std::time::Duration::ZERO)
    }
    #[cfg(not(windows))]
    {
        DesktopUpdateStorageStatus::unsupported()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug)]
struct DisplayWorkArea {
    rect: WindowRect,
    scale_factor: f64,
}

impl WindowRect {
    fn has_area(self) -> bool {
        self.width > 0 && self.height > 0
    }

    fn intersects(self, other: Self) -> bool {
        if !self.has_area() || !other.has_area() {
            return false;
        }

        let self_left = i64::from(self.x);
        let self_top = i64::from(self.y);
        let self_right = self_left + i64::from(self.width);
        let self_bottom = self_top + i64::from(self.height);
        let other_left = i64::from(other.x);
        let other_top = i64::from(other.y);
        let other_right = other_left + i64::from(other.width);
        let other_bottom = other_top + i64::from(other.height);

        self_left < other_right
            && self_right > other_left
            && self_top < other_bottom
            && self_bottom > other_top
    }

    fn intersection_area(self, other: Self) -> u64 {
        if !self.intersects(other) {
            return 0;
        }

        let left = i64::from(self.x).max(i64::from(other.x));
        let top = i64::from(self.y).max(i64::from(other.y));
        let right = (i64::from(self.x) + i64::from(self.width))
            .min(i64::from(other.x) + i64::from(other.width));
        let bottom = (i64::from(self.y) + i64::from(self.height))
            .min(i64::from(other.y) + i64::from(other.height));
        u64::try_from(right - left).unwrap_or_default()
            * u64::try_from(bottom - top).unwrap_or_default()
    }
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn logical_to_physical_dimension(logical: u32, scale_factor: f64) -> u32 {
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return logical;
    }

    (f64::from(logical) * scale_factor)
        .round()
        .clamp(1.0, f64::from(u32::MAX)) as u32
}

/// Return a safe replacement when the restored main window is off-screen or cannot fit a usable
/// size on the display it overlaps most. Work areas exclude menu bars, taskbars, and docks.
fn offscreen_window_recovery(
    window: WindowRect,
    work_areas: &[DisplayWorkArea],
    primary_work_area: Option<DisplayWorkArea>,
) -> Option<WindowRect> {
    let visible_work_area = if window.has_area() {
        work_areas
            .iter()
            .copied()
            .filter(|work_area| work_area.rect.has_area() && window.intersects(work_area.rect))
            .max_by_key(|work_area| window.intersection_area(work_area.rect))
    } else {
        None
    };
    let target = visible_work_area
        .or_else(|| primary_work_area.filter(|work_area| work_area.rect.has_area()))
        .or_else(|| {
            work_areas
                .iter()
                .copied()
                .find(|work_area| work_area.rect.has_area())
        })?;
    let minimum_width = logical_to_physical_dimension(MIN_MAIN_WINDOW_WIDTH, target.scale_factor);
    let minimum_height = logical_to_physical_dimension(MIN_MAIN_WINDOW_HEIGHT, target.scale_factor);
    let size_is_invalid = window.width < minimum_width
        || window.height < minimum_height
        || window.width > target.rect.width
        || window.height > target.rect.height;
    if visible_work_area.is_some() && !size_is_invalid {
        return None;
    }

    let (requested_width, requested_height) = if size_is_invalid {
        (
            logical_to_physical_dimension(DEFAULT_MAIN_WINDOW_WIDTH, target.scale_factor),
            logical_to_physical_dimension(DEFAULT_MAIN_WINDOW_HEIGHT, target.scale_factor),
        )
    } else {
        (window.width, window.height)
    };
    let width = requested_width.min(target.rect.width);
    let height = requested_height.min(target.rect.height);
    let x = i64::from(target.rect.x) + i64::from(target.rect.width.saturating_sub(width) / 2);
    let y = i64::from(target.rect.y) + i64::from(target.rect.height.saturating_sub(height) / 2);

    Some(WindowRect {
        x: clamp_i64_to_i32(x),
        y: clamp_i64_to_i32(y),
        width,
        height,
    })
}

/// Grow the main window for a side-by-side work object without covering the primary workbench.
/// The result never leaves the monitor work area and never shrinks a user-sized window.
fn extension_window_growth(window: WindowRect, work_area: DisplayWorkArea) -> Option<WindowRect> {
    if !window.has_area() || !work_area.rect.has_area() || !window.intersects(work_area.rect) {
        return None;
    }
    let target_width =
        logical_to_physical_dimension(EXTENSION_MAIN_WINDOW_WIDTH, work_area.scale_factor)
            .min(work_area.rect.width);
    if target_width <= window.width {
        return None;
    }

    let work_left = i64::from(work_area.rect.x);
    let work_top = i64::from(work_area.rect.y);
    let work_right = work_left + i64::from(work_area.rect.width);
    let work_bottom = work_top + i64::from(work_area.rect.height);
    let max_x = work_right - i64::from(target_width);
    let height = window.height.min(work_area.rect.height);
    let max_y = work_bottom - i64::from(height);
    Some(WindowRect {
        x: clamp_i64_to_i32(i64::from(window.x).clamp(work_left, max_x)),
        y: clamp_i64_to_i32(i64::from(window.y).clamp(work_top, max_y)),
        width: target_width,
        height,
    })
}

#[cfg(desktop)]
#[tauri::command]
fn ensure_extension_window_width(window: tauri::WebviewWindow) -> Result<bool, String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("read main window position: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("read main window size: {error}"))?;
    let monitor = window
        .current_monitor()
        .map_err(|error| format!("read current monitor: {error}"))?
        .ok_or_else(|| "main window is not on an available monitor".to_string())?;
    let area = monitor.work_area();
    let work_area = DisplayWorkArea {
        rect: WindowRect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        scale_factor: monitor.scale_factor(),
    };
    let current = WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let Some(expanded) = extension_window_growth(current, work_area) else {
        return Ok(false);
    };
    window
        .set_size(tauri::PhysicalSize::new(expanded.width, expanded.height))
        .map_err(|error| format!("expand main window: {error}"))?;
    window
        .set_position(tauri::PhysicalPosition::new(expanded.x, expanded.y))
        .map_err(|error| format!("keep expanded main window on-screen: {error}"))?;
    Ok(true)
}

#[cfg(desktop)]
fn recover_main_window_if_offscreen<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> tauri_plugin_window_state::Result<bool> {
    use tauri::Manager;
    use tauri_plugin_window_state::{AppHandleExt, StateFlags};

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let current = WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let monitors = window.available_monitors()?;
    let work_areas = monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            DisplayWorkArea {
                rect: WindowRect {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                },
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect::<Vec<_>>();
    let primary_work_area = window.primary_monitor()?.map(|monitor| {
        let area = monitor.work_area();
        DisplayWorkArea {
            rect: WindowRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            },
            scale_factor: monitor.scale_factor(),
        }
    });

    let Some(recovered) = offscreen_window_recovery(current, &work_areas, primary_work_area) else {
        return Ok(false);
    };

    if recovered.width != current.width || recovered.height != current.height {
        window.set_size(tauri::PhysicalSize::new(recovered.width, recovered.height))?;
    }
    window.set_position(tauri::PhysicalPosition::new(recovered.x, recovered.y))?;
    window.show()?;
    window.set_focus()?;
    window.app_handle().save_window_state(StateFlags::all())?;
    Ok(true)
}

fn should_track_window_state(label: &str) -> bool {
    // Companion windows have fixed runtime geometry and their positions live in the main renderer's
    // bounded preference state. Restoring an older native size here can override new min/max values
    // before the transparent webview is shown (notably 224x230 physical -> 112x115 on Retina).
    label == "main"
}

#[cfg(desktop)]
fn create_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    software_renderer: bool,
) -> Result<tauri::WebviewWindow<R>, String> {
    #[cfg(windows)]
    use tauri::Manager;
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .cloned()
        .ok_or_else(|| "main window configuration is missing".to_string())?;
    let builder = tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| format!("prepare main window: {error}"))?;
    #[cfg(windows)]
    let builder = if software_renderer {
        let data_directory = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("resolve Hara renderer cache: {error}"))?
            .join("webview2-software-renderer");
        builder
            .additional_browser_args(WINDOWS_SOFTWARE_RENDERER_ARGS)
            .data_directory(data_directory)
    } else {
        builder
    };
    #[cfg(not(windows))]
    let _ = software_renderer;
    builder
        .build()
        .map_err(|error| format!("create main window: {error}"))
}

#[cfg(desktop)]
fn get_or_create_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    software_renderer: bool,
) -> Result<tauri::WebviewWindow<R>, String> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }
    create_main_window(app, software_renderer)
}

#[cfg(target_os = "macos")]
fn reopen_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let window = get_or_create_main_window(app, false)?;

    window
        .unminimize()
        .map_err(|error| format!("restore main window: {error}"))?;
    // A stale Space assignment can leave a valid window off the current desktop. Keep it
    // reachable until the user genuinely focuses it; the Focused event below then restores the
    // standard single-Space policy on the Space the user chose.
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| format!("make main window reachable: {error}"))?;
    window
        .show()
        .map_err(|error| format!("show main window: {error}"))?;
    let recovered = recover_main_window_if_offscreen(&window)
        .map_err(|error| format!("recover main window position: {error}"))?;
    if !recovered {
        window
            .set_focus()
            .map_err(|error| format!("focus main window: {error}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn schedule_windows_renderer_recovery(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use tauri::Manager;

        std::thread::sleep(WINDOWS_RENDERER_BOOT_TIMEOUT);
        if app
            .state::<RendererBootState>()
            .ready
            .load(Ordering::Acquire)
        {
            return;
        }

        let destroy_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let state = destroy_app.state::<RendererBootState>();
            if state.ready.load(Ordering::Acquire) {
                return;
            }
            state.fallback_started.store(true, Ordering::Release);
            if let Some(window) = destroy_app.get_webview_window("main") {
                if let Err(error) = window.destroy() {
                    state.fallback_started.store(false, Ordering::Release);
                    eprintln!(
                        "Windows renderer recovery could not close the stalled window: {error}"
                    );
                    return;
                }
            }
        }) {
            eprintln!("Windows renderer recovery could not schedule window reset: {error}");
            return;
        }

        std::thread::sleep(WINDOWS_RENDERER_RECREATE_DELAY);
        if !app
            .state::<RendererBootState>()
            .fallback_started
            .load(Ordering::Acquire)
        {
            return;
        }

        let create_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let state = create_app.state::<RendererBootState>();
            state.ready.store(false, Ordering::Release);
            state.software_mode.store(true, Ordering::Release);
            match create_main_window(&create_app, true) {
                Ok(window) => {
                    if let Err(error) = window.show() {
                        eprintln!("Windows software renderer window could not be shown: {error}");
                    } else if let Err(error) = recover_main_window_if_offscreen(&window) {
                        eprintln!("Windows software renderer window recovery failed: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("Windows software renderer fallback failed: {error}");
                    state.fallback_started.store(false, Ordering::Release);
                    create_app.exit(1);
                    return;
                }
            }
            state.fallback_started.store(false, Ordering::Release);
        }) {
            eprintln!("Windows software renderer fallback could not be scheduled: {error}");
            app.state::<RendererBootState>()
                .fallback_started
                .store(false, Ordering::Release);
            app.exit(1);
        }
    });
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetManifest {
    id: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    sprite_version_number: Option<u8>,
    spritesheet_path: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PetCatalogEntry {
    selector: String,
    id: String,
    display_name: String,
    description: String,
    source: String,
    sprite_version_number: Option<u8>,
    rows: Option<u32>,
    compatible: bool,
    error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PetAsset {
    data_url: String,
    sprite_version_number: u8,
    columns: u32,
    rows: u32,
    frame_width: u32,
    frame_height: u32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandLineHaraStatus {
    path: String,
    bundled_version: String,
    available: bool,
    installed: bool,
    current: bool,
    managed: bool,
    blocked: bool,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedCliReceipt {
    schema_version: u8,
    managed_path: String,
    bundled_version: String,
    sha256: String,
}

#[derive(Debug)]
struct ValidatedPet {
    manifest: PetManifest,
    asset_path: PathBuf,
    mime: &'static str,
    version: u8,
    rows: u32,
}

fn user_home() -> Result<PathBuf, String> {
    resolve_user_home(
        std::env::var_os("HOME").map(PathBuf::from),
        std::env::var_os("USERPROFILE").map(PathBuf::from),
        cfg!(windows),
    )
}

/// Mirror hara-cli's portable-home contract without depending on the host running these tests.
/// Git Bash/MSYS exposes native Windows homes through POSIX-looking environment values, while a
/// native Desktop process must use drive or UNC syntax when it opens those paths.
fn normalize_portable_home(value: PathBuf, windows: bool) -> PathBuf {
    if !windows {
        return value;
    }

    let Some(raw) = value.to_str() else {
        // Preserve an unusual, non-Unicode environment value instead of lossy-converting it.
        return value;
    };
    let home = raw.trim();
    let bytes = home.as_bytes();

    // MSYS/Git Bash drive form: /c/Users/alice -> C:\Users\alice.
    if bytes.len() >= 2
        && bytes[0] == b'/'
        && bytes[1].is_ascii_alphabetic()
        && (bytes.len() == 2 || bytes.get(2) == Some(&b'/'))
    {
        let drive = char::from(bytes[1]).to_ascii_uppercase();
        let rest = if bytes.len() > 3 { &home[3..] } else { "" };
        return PathBuf::from(format!("{drive}:\\{}", rest.replace('/', "\\")));
    }

    // MSYS UNC form: //server/share -> \\server\share.
    if home.starts_with("//") && bytes.get(2).is_some_and(|byte| *byte != b'/') {
        return PathBuf::from(format!("\\\\{}", home[2..].replace('/', "\\")));
    }

    // Already-native drive form, possibly with forward or mixed separators.
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
    {
        let drive = char::from(bytes[0]).to_ascii_uppercase();
        return PathBuf::from(format!("{drive}{}", home[1..].replace('/', "\\")));
    }

    PathBuf::from(home)
}

fn resolve_user_home(
    home: Option<PathBuf>,
    user_profile: Option<PathBuf>,
    windows: bool,
) -> Result<PathBuf, String> {
    // Hara CLI treats an explicit HOME as an intentional portable-home override on every platform.
    // Native Windows GUI launches commonly omit it, so USERPROFILE is the required fallback there.
    home.filter(|path| !path.as_os_str().is_empty())
        .map(|path| normalize_portable_home(path, windows))
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| user_profile.filter(|path| !path.as_os_str().is_empty()))
        .ok_or_else(|| "no user home directory (HOME and USERPROFILE are unset)".to_string())
}

fn hara_data_dir() -> Result<PathBuf, String> {
    Ok(user_home()?.join(".hara"))
}

fn pet_root(source: &str) -> Result<PathBuf, String> {
    match source {
        "hara" => Ok(hara_data_dir()?.join("pets")),
        "codex" => Ok(user_home()?.join(".codex").join("pets")),
        _ => Err("unsupported pet source".into()),
    }
}

/// A selector may choose one directory directly below a fixed local pet root. It may never become
/// an arbitrary path, even if a malformed renderer payload reaches this native command.
fn selector_parts(selector: &str) -> Result<(&str, &str), String> {
    let (source, directory) = selector
        .split_once(':')
        .ok_or_else(|| "pet selector must be <source>:<id>".to_string())?;
    let mut components = Path::new(directory).components();
    if directory.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err("pet id must be one directory name".into());
    }
    pet_root(source)?;
    Ok((source, directory))
}

fn regular_file_size(path: &Path, max_bytes: u64, label: &str) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("read {label}: {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} must be a regular file"));
    }
    if metadata.len() > max_bytes {
        return Err(format!("{label} is too large"));
    }
    Ok(metadata.len())
}

fn safe_asset_path(pet_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative.is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("spritesheetPath must stay inside the pet directory".into());
    }
    let canonical_dir = pet_dir
        .canonicalize()
        .map_err(|e| format!("resolve pet directory: {e}"))?;
    let candidate = pet_dir.join(relative_path);
    regular_file_size(&candidate, MAX_PET_ASSET_BYTES, "pet spritesheet")?;
    let canonical_asset = candidate
        .canonicalize()
        .map_err(|e| format!("resolve pet spritesheet: {e}"))?;
    if !canonical_asset.starts_with(&canonical_dir) {
        return Err("spritesheetPath escapes the pet directory".into());
    }
    Ok(canonical_asset)
}

fn sprite_geometry(width: u32, height: u32, declared: Option<u8>) -> Result<(u8, u32), String> {
    let inferred = match (width, height) {
        (PET_SHEET_WIDTH, 1872) => (1, 9),
        (PET_SHEET_WIDTH, 2288) => (2, 11),
        _ => {
            return Err(format!(
                "unsupported spritesheet size {width}x{height}; expected 1536x1872 (v1) or 1536x2288 (v2)"
            ))
        }
    };
    if declared.is_some_and(|version| version != inferred.0) {
        return Err(format!(
            "spriteVersionNumber does not match the {}x{} spritesheet",
            width, height
        ));
    }
    Ok(inferred)
}

fn read_pet(selector: &str) -> Result<ValidatedPet, String> {
    let (source, directory) = selector_parts(selector)?;
    let root = pet_root(source)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("resolve pet root: {e}"))?;
    let pet_dir = root.join(directory);
    let pet_metadata =
        fs::symlink_metadata(&pet_dir).map_err(|e| format!("read pet directory: {e}"))?;
    if pet_metadata.file_type().is_symlink() || !pet_metadata.is_dir() {
        return Err("pet package must be a real directory".into());
    }
    let canonical_dir = pet_dir
        .canonicalize()
        .map_err(|e| format!("resolve pet directory: {e}"))?;
    if !canonical_dir.starts_with(&canonical_root) {
        return Err("pet directory escapes its local catalog".into());
    }

    let manifest_path = pet_dir.join("pet.json");
    regular_file_size(&manifest_path, MAX_PET_MANIFEST_BYTES, "pet.json")?;
    let raw = fs::read_to_string(&manifest_path).map_err(|e| format!("read pet.json: {e}"))?;
    let manifest: PetManifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse pet.json: {e}"))?;
    let relative = manifest
        .spritesheet_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("spritesheet.webp");
    let asset_path = safe_asset_path(&pet_dir, relative)?;
    let reader = image::ImageReader::open(&asset_path)
        .map_err(|e| format!("read pet spritesheet: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("detect pet spritesheet: {e}"))?;
    let format = reader
        .format()
        .ok_or_else(|| "pet spritesheet must be PNG or WebP".to_string())?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("pet spritesheet must be PNG or WebP".into()),
    };
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("decode pet spritesheet dimensions: {e}"))?;
    let (version, rows) = sprite_geometry(width, height, manifest.sprite_version_number)?;
    Ok(ValidatedPet {
        manifest,
        asset_path,
        mime,
        version,
        rows,
    })
}

fn display_text(value: Option<&str>, fallback: &str, max_chars: usize) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .chars()
        .take(max_chars)
        .collect()
}

fn scan_pet_root(source: &str) -> Vec<PetCatalogEntry> {
    let Ok(root) = pet_root(source) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    // A user-controlled local directory must not make Settings perform an unbounded scan/decode.
    // Collect a bounded candidate set first, sort it for a stable UI, and validate at most 256.
    let mut directories = Vec::new();
    for entry in entries.flatten().take(MAX_PET_CATALOG_SCAN_ENTRIES) {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let directory = entry.file_name().to_string_lossy().to_string();
        if selector_parts(&format!("{source}:{directory}")).is_err() {
            continue;
        }
        directories.push(directory);
    }
    directories.sort_by_key(|directory| directory.to_lowercase());
    directories.dedup();

    let catalog_source = match source {
        "hara" => "hara-local",
        "codex" => "codex-local",
        _ => return Vec::new(),
    };
    let mut catalog = Vec::new();
    for directory in directories.into_iter().take(MAX_PET_CATALOG_ENTRIES) {
        let selector = format!("{source}:{directory}");
        match read_pet(&selector) {
            Ok(pet) => catalog.push(PetCatalogEntry {
                selector,
                id: display_text(pet.manifest.id.as_deref(), &directory, 120),
                display_name: display_text(
                    pet.manifest
                        .display_name
                        .as_deref()
                        .or(pet.manifest.id.as_deref()),
                    &directory,
                    120,
                ),
                description: display_text(pet.manifest.description.as_deref(), "", 500),
                source: catalog_source.to_string(),
                sprite_version_number: Some(pet.version),
                rows: Some(pet.rows),
                compatible: true,
                error: None,
            }),
            Err(error) => catalog.push(PetCatalogEntry {
                selector,
                id: directory.clone(),
                display_name: directory,
                description: String::new(),
                source: catalog_source.to_string(),
                sprite_version_number: None,
                rows: None,
                compatible: false,
                error: Some(error.chars().take(300).collect()),
            }),
        }
    }
    catalog.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    catalog
}

/// Enumerate only Hara's pet directory and Codex's documented local package directory. The renderer
/// receives metadata, never arbitrary filesystem paths.
#[tauri::command]
fn list_pets() -> Vec<PetCatalogEntry> {
    let mut pets = scan_pet_root("hara");
    pets.extend(scan_pet_root("codex"));
    pets
}

/// Return a validated image as a data URL. This deliberately avoids granting the pet webview a broad
/// filesystem/asset-protocol scope; every read repeats the package-root, symlink, size, MIME and geometry
/// checks above.
#[tauri::command]
fn read_pet_asset(selector: String) -> Result<PetAsset, String> {
    use base64::Engine;
    let pet = read_pet(&selector)?;
    let bytes = fs::read(&pet.asset_path).map_err(|e| format!("read pet spritesheet: {e}"))?;
    if bytes.len() as u64 > MAX_PET_ASSET_BYTES {
        return Err("pet spritesheet is too large".into());
    }
    Ok(PetAsset {
        data_url: format!(
            "data:{};base64,{}",
            pet.mime,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        sprite_version_number: pet.version,
        columns: PET_SHEET_WIDTH / PET_FRAME_WIDTH,
        rows: pet.rows,
        frame_width: PET_FRAME_WIDTH,
        frame_height: PET_FRAME_HEIGHT,
    })
}

#[derive(Debug, serde::Deserialize)]
struct ServeDiscoveryRecord {
    pid: u32,
}

const DEFAULT_SERVE_PORT: u16 = 8790;

fn discovery_path() -> Result<PathBuf, String> {
    Ok(hara_data_dir()?.join("serve.json"))
}

/// Read the CLI-owned discovery file through a bounded, no-follow descriptor. The renderer receives its
/// token because it must authenticate to Serve, but it never receives a native "kill arbitrary pid" API:
/// the legacy bridge below re-reads and validates this same private record itself.
fn read_private_discovery_at(path: &Path) -> Result<(String, ServeDiscoveryRecord), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "serve discovery has no parent directory".to_string())?;
    let parent_metadata = fs::symlink_metadata(parent)
        .map_err(|error| format!("inspect Hara data directory: {error}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err("Hara data directory must be a real private directory".into());
    }

    let path_metadata =
        fs::symlink_metadata(path).map_err(|error| format!("inspect serve discovery: {error}"))?;
    if path_metadata.file_type().is_symlink() || !path_metadata.is_file() {
        return Err("serve discovery must be a regular file".into());
    }
    if path_metadata.len() > MAX_SERVE_DISCOVERY_BYTES {
        return Err("serve discovery is too large".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let uid = unsafe { libc::geteuid() };
        if parent_metadata.uid() != uid || parent_metadata.mode() & 0o077 != 0 {
            return Err("Hara data directory must be owned by this user with mode 0700".into());
        }
        if path_metadata.uid() != uid
            || path_metadata.mode() & 0o077 != 0
            || path_metadata.nlink() != 1
        {
            return Err("serve discovery must be an owner-only, single-link file".into());
        }
    }

    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("open serve discovery: {error}"))?;
    let opened = file
        .metadata()
        .map_err(|error| format!("inspect opened serve discovery: {error}"))?;
    if !opened.is_file() || opened.len() > MAX_SERVE_DISCOVERY_BYTES {
        return Err("opened serve discovery is not a bounded regular file".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != path_metadata.dev()
            || opened.ino() != path_metadata.ino()
            || opened.uid() != path_metadata.uid()
            || opened.nlink() != 1
        {
            return Err("serve discovery changed while opening".into());
        }
    }

    let mut raw = String::new();
    (&mut file)
        .take(MAX_SERVE_DISCOVERY_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|error| format!("read serve discovery: {error}"))?;
    if raw.len() as u64 > MAX_SERVE_DISCOVERY_BYTES {
        return Err("serve discovery is too large".into());
    }

    let after =
        fs::symlink_metadata(path).map_err(|error| format!("recheck serve discovery: {error}"))?;
    if after.file_type().is_symlink() || !after.is_file() {
        return Err("serve discovery changed while reading".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if after.dev() != path_metadata.dev()
            || after.ino() != path_metadata.ino()
            || after.uid() != path_metadata.uid()
            || after.nlink() != 1
        {
            return Err("serve discovery changed while reading".into());
        }
    }

    let record: ServeDiscoveryRecord =
        serde_json::from_str(&raw).map_err(|error| format!("parse serve discovery: {error}"))?;
    if record.pid <= 1 || (cfg!(unix) && record.pid > i32::MAX as u32) {
        return Err("serve discovery contains an invalid pid".into());
    }
    Ok((raw, record))
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    windows_process::process_is_alive(pid)
}

#[cfg(not(any(unix, windows)))]
fn process_is_alive(_pid: u32) -> bool {
    true
}

/// Read ~/.hara/serve.json — written by a running `hara serve` ({host, port, token, pid, version}).
/// Returns None when the file is missing, unsafe, malformed, or records a dead process.
#[tauri::command]
fn read_discovery() -> Option<String> {
    let (raw, record) = read_private_discovery_at(&discovery_path().ok()?).ok()?;
    process_is_alive(record.pid).then_some(raw)
}

fn bundled_sidecar_name(windows: bool) -> &'static str {
    if windows {
        "hara.exe"
    } else {
        "hara"
    }
}

fn bundled_sidecar_path(app_executable: &Path, windows: bool) -> Option<PathBuf> {
    app_executable
        .parent()
        .map(|directory| directory.join(bundled_sidecar_name(windows)))
}

fn bundled_herdr_name(windows: bool) -> &'static str {
    if windows {
        "herdr.exe"
    } else {
        "herdr"
    }
}

fn bundled_herdr_path(app_executable: &Path, windows: bool) -> Option<PathBuf> {
    app_executable
        .parent()
        .map(|directory| directory.join(bundled_herdr_name(windows)))
}

fn managed_cli_path(data_directory: &Path, windows: bool) -> PathBuf {
    data_directory
        .join("bin")
        .join(bundled_sidecar_name(windows))
}

fn managed_cli_receipt_path(data_directory: &Path) -> PathBuf {
    data_directory.join("desktop-cli.json")
}

fn bounded_regular_file(path: &Path, label: &str) -> Result<Option<fs::Metadata>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("inspect {label}: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} must be a regular file, not a link"));
    }
    if metadata.len() == 0 || metadata.len() > MAX_MANAGED_CLI_BYTES {
        return Err(format!("{label} has an invalid size"));
    }
    Ok(Some(metadata))
}

fn files_are_identical(left: &Path, right: &Path) -> Result<bool, String> {
    let Some(left_metadata) = bounded_regular_file(left, "bundled Hara CLI")? else {
        return Ok(false);
    };
    let Some(right_metadata) = bounded_regular_file(right, "installed command-line Hara")? else {
        return Ok(false);
    };
    if left_metadata.len() != right_metadata.len() {
        return Ok(false);
    }

    let mut left_file =
        fs::File::open(left).map_err(|error| format!("open bundled Hara CLI: {error}"))?;
    let mut right_file = fs::File::open(right)
        .map_err(|error| format!("open installed command-line Hara: {error}"))?;
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_read = left_file
            .read(&mut left_buffer)
            .map_err(|error| format!("read bundled Hara CLI: {error}"))?;
        let right_read = right_file
            .read(&mut right_buffer)
            .map_err(|error| format!("read installed command-line Hara: {error}"))?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn regular_file_sha256(path: &Path, label: &str) -> Result<Option<String>, String> {
    use sha2::{Digest, Sha256};

    let Some(_) = bounded_regular_file(path, label)? else {
        return Ok(None);
    };
    let mut file = fs::File::open(path).map_err(|error| format!("open {label}: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read {label}: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(Some(format!("{:x}", digest.finalize())))
}

fn read_managed_cli_receipt(data_directory: &Path) -> Result<Option<ManagedCliReceipt>, String> {
    let path = managed_cli_receipt_path(data_directory);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("inspect Desktop CLI receipt: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Desktop CLI receipt must be a regular file, not a link".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_MANAGED_CLI_RECEIPT_BYTES {
        return Err("Desktop CLI receipt has an invalid size".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
            return Err("Desktop CLI receipt must be private and owned by this user".into());
        }
    }
    let raw =
        fs::read_to_string(&path).map_err(|error| format!("read Desktop CLI receipt: {error}"))?;
    let receipt: ManagedCliReceipt = serde_json::from_str(&raw)
        .map_err(|error| format!("parse Desktop CLI receipt: {error}"))?;
    if receipt.schema_version != MANAGED_CLI_RECEIPT_SCHEMA
        || receipt.managed_path.trim().is_empty()
        || receipt.bundled_version.trim().is_empty()
        || receipt.sha256.len() != 64
        || !receipt.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Desktop CLI receipt is invalid".into());
    }
    Ok(Some(receipt))
}

fn command_line_hara_status_at(
    app_executable: &Path,
    data_directory: &Path,
    windows: bool,
) -> CommandLineHaraStatus {
    let source = bundled_sidecar_path(app_executable, windows);
    let destination = managed_cli_path(data_directory, windows);
    let available = source
        .as_deref()
        .and_then(|path| {
            bounded_regular_file(path, "bundled Hara CLI")
                .ok()
                .flatten()
        })
        .is_some();
    let destination_state = bounded_regular_file(&destination, "installed command-line Hara");
    let installed = matches!(destination_state, Ok(Some(_)));
    let receipt_state = read_managed_cli_receipt(data_directory);
    let destination_digest = if installed && matches!(receipt_state, Ok(Some(_))) {
        regular_file_sha256(&destination, "installed command-line Hara")
    } else {
        Ok(None)
    };
    let managed = matches!(
        (&receipt_state, &destination_digest),
        (Ok(Some(receipt)), Ok(Some(digest)))
            if receipt.managed_path == destination.to_string_lossy()
                && receipt.sha256.eq_ignore_ascii_case(digest)
    );
    let blocked =
        destination_state.is_err() || receipt_state.is_err() || destination_digest.is_err();
    let current = available
        && installed
        && source
            .as_deref()
            .is_some_and(|path| files_are_identical(path, &destination).unwrap_or(false));
    CommandLineHaraStatus {
        path: destination.to_string_lossy().into_owned(),
        bundled_version: BUNDLED_CLI_VERSION.trim().to_string(),
        available,
        installed,
        current,
        managed,
        blocked,
    }
}

fn ensure_managed_cli_directory(data_directory: &Path) -> Result<PathBuf, String> {
    for (directory, label) in [
        (data_directory, "Hara data directory"),
        (&data_directory.join("bin"), "Hara command directory"),
    ] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(format!("{label} must be a real directory, not a link"));
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o022 != 0
                    {
                        return Err(format!(
                            "{label} must be owned by this user and not writable by other users"
                        ));
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(directory).map_err(|error| format!("create {label}: {error}"))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
                        .map_err(|error| format!("secure {label}: {error}"))?;
                }
            }
            Err(error) => return Err(format!("inspect {label}: {error}")),
        }
    }
    Ok(data_directory.join("bin"))
}

fn create_managed_cli_temp(directory: &Path) -> Result<(PathBuf, fs::File), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for attempt in 0..32_u8 {
        let path = directory.join(format!(
            ".hara-install-{}-{nonce}-{attempt}",
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o700).custom_flags(libc::O_NOFOLLOW);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("create staged Hara CLI: {error}")),
        }
    }
    Err("could not reserve a staged Hara CLI path".into())
}

fn create_managed_cli_receipt_temp(directory: &Path) -> Result<(PathBuf, fs::File), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for attempt in 0..32_u8 {
        let path = directory.join(format!(
            ".desktop-cli-receipt-{}-{nonce}-{attempt}",
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("create staged Desktop CLI receipt: {error}")),
        }
    }
    Err("could not reserve a staged Desktop CLI receipt path".into())
}

#[cfg(not(windows))]
fn replace_managed_file(staged: &Path, destination: &Path, label: &str) -> Result<(), String> {
    fs::rename(staged, destination).map_err(|error| format!("{label}: {error}"))
}

#[cfg(windows)]
fn replace_managed_file(staged: &Path, destination: &Path, label: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let staged_wide: Vec<u16> = staged.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            staged_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(format!("{label}: {}", std::io::Error::last_os_error()));
    }
    Ok(())
}

fn write_managed_cli_receipt(
    data_directory: &Path,
    destination: &Path,
    sha256: String,
) -> Result<(), String> {
    let receipt = ManagedCliReceipt {
        schema_version: MANAGED_CLI_RECEIPT_SCHEMA,
        managed_path: destination.to_string_lossy().into_owned(),
        bundled_version: BUNDLED_CLI_VERSION.trim().to_string(),
        sha256,
    };
    let serialized = serde_json::to_vec(&receipt)
        .map_err(|error| format!("serialize Desktop CLI receipt: {error}"))?;
    let path = managed_cli_receipt_path(data_directory);
    let (staged_path, mut staged_file) = create_managed_cli_receipt_temp(data_directory)?;
    let result = (|| -> Result<(), String> {
        staged_file
            .write_all(&serialized)
            .and_then(|_| staged_file.flush())
            .and_then(|_| staged_file.sync_all())
            .map_err(|error| format!("persist staged Desktop CLI receipt: {error}"))?;
        drop(staged_file);
        replace_managed_file(&staged_path, &path, "install Desktop CLI receipt")?;
        if let Ok(directory_file) = fs::File::open(data_directory) {
            let _ = directory_file.sync_all();
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&staged_path);
        return Err(error);
    }
    Ok(())
}

fn install_command_line_hara_at(
    app_executable: &Path,
    data_directory: &Path,
    windows: bool,
) -> Result<CommandLineHaraStatus, String> {
    let source = bundled_sidecar_path(app_executable, windows)
        .ok_or_else(|| "could not resolve the Desktop-bundled Hara CLI".to_string())?;
    bounded_regular_file(&source, "bundled Hara CLI")?
        .ok_or_else(|| "this Desktop build does not contain an installable Hara CLI".to_string())?;
    let directory = ensure_managed_cli_directory(data_directory)?;
    let destination = managed_cli_path(data_directory, windows);
    read_managed_cli_receipt(data_directory)?;
    if let Err(error) = bounded_regular_file(&destination, "installed command-line Hara") {
        return Err(error);
    }

    let source_sha256 = regular_file_sha256(&source, "bundled Hara CLI")?
        .ok_or_else(|| "this Desktop build does not contain an installable Hara CLI".to_string())?;

    let mut source_file =
        fs::File::open(&source).map_err(|error| format!("open bundled Hara CLI: {error}"))?;
    let source_length = source_file
        .metadata()
        .map_err(|error| format!("inspect opened Hara CLI: {error}"))?
        .len();
    let (staged_path, mut staged_file) = create_managed_cli_temp(&directory)?;
    let staged_result = (|| -> Result<(), String> {
        let copied = std::io::copy(&mut source_file, &mut staged_file)
            .map_err(|error| format!("copy bundled Hara CLI: {error}"))?;
        if copied != source_length {
            return Err("the staged Hara CLI is incomplete".into());
        }
        staged_file
            .flush()
            .and_then(|_| staged_file.sync_all())
            .map_err(|error| format!("persist staged Hara CLI: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&staged_path, fs::Permissions::from_mode(0o755))
                .map_err(|error| format!("make staged Hara CLI executable: {error}"))?;
        }
        if !files_are_identical(&source, &staged_path)? {
            return Err("the staged Hara CLI did not match the Desktop bundle".into());
        }
        drop(staged_file);
        replace_managed_file(&staged_path, &destination, "install command-line Hara")?;
        if let Ok(directory_file) = fs::File::open(&directory) {
            let _ = directory_file.sync_all();
        }
        Ok(())
    })();
    if let Err(error) = staged_result {
        let _ = fs::remove_file(&staged_path);
        return Err(error);
    }

    write_managed_cli_receipt(data_directory, &destination, source_sha256)?;

    let status = command_line_hara_status_at(app_executable, data_directory, windows);
    if !status.current || !status.managed {
        return Err("installed command-line Hara could not be verified".into());
    }
    Ok(status)
}

fn synchronize_command_line_hara_at(
    app_executable: &Path,
    data_directory: &Path,
    windows: bool,
) -> Result<CommandLineHaraStatus, String> {
    let status = command_line_hara_status_at(app_executable, data_directory, windows);
    if status.blocked || !status.available {
        return Ok(status);
    }
    if status.current {
        if status.managed {
            return Ok(status);
        }

        // The executable replacement and its ownership receipt are two separately durable renames.
        // A crash between them leaves the exact new bundle at the managed path with the previous valid
        // receipt. Recover only that already opted-in path: a missing receipt or a receipt naming any
        // other path remains unmanaged and requires an explicit install/adoption.
        let destination = managed_cli_path(data_directory, windows);
        let Some(receipt) = read_managed_cli_receipt(data_directory)? else {
            return Ok(status);
        };
        if receipt.managed_path != destination.to_string_lossy() {
            return Ok(status);
        }
        let Some(source) = bundled_sidecar_path(app_executable, windows) else {
            return Ok(status);
        };
        let Some(source_sha256) = regular_file_sha256(&source, "bundled Hara CLI")? else {
            return Ok(status);
        };
        let Some(destination_sha256) =
            regular_file_sha256(&destination, "installed command-line Hara")?
        else {
            return Ok(command_line_hara_status_at(
                app_executable,
                data_directory,
                windows,
            ));
        };
        if source_sha256 != destination_sha256 {
            return Ok(command_line_hara_status_at(
                app_executable,
                data_directory,
                windows,
            ));
        }

        write_managed_cli_receipt(data_directory, &destination, destination_sha256)?;
        let repaired = command_line_hara_status_at(app_executable, data_directory, windows);
        if !repaired.current || !repaired.managed {
            return Err("recovered command-line Hara receipt could not be verified".into());
        }
        return Ok(repaired);
    }
    if !status.installed || status.managed {
        return install_command_line_hara_at(app_executable, data_directory, windows);
    }
    Ok(status)
}

#[tauri::command]
fn inspect_command_line_hara() -> Result<CommandLineHaraStatus, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve Hara Desktop executable: {error}"))?;
    Ok(command_line_hara_status_at(
        &executable,
        &hara_data_dir()?,
        cfg!(windows),
    ))
}

#[tauri::command]
fn synchronize_command_line_hara() -> Result<CommandLineHaraStatus, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve Hara Desktop executable: {error}"))?;
    synchronize_command_line_hara_at(&executable, &hara_data_dir()?, cfg!(windows))
}

#[tauri::command]
fn install_command_line_hara() -> Result<CommandLineHaraStatus, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve Hara Desktop executable: {error}"))?;
    install_command_line_hara_at(&executable, &hara_data_dir()?, cfg!(windows))
}

fn fallback_sidecar_path(
    data_directory: &Path,
    path_environment: Option<&std::ffi::OsStr>,
    windows: bool,
) -> Option<PathBuf> {
    let name = bundled_sidecar_name(windows);
    let managed = managed_cli_path(data_directory, windows);
    if managed.is_file() {
        return Some(managed);
    }
    path_environment.and_then(|path| {
        std::env::split_paths(path)
            // Never let a relative/empty PATH entry turn Desktop's current directory into an
            // executable search root.
            .filter(|directory| directory.is_absolute())
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.is_file())
    })
}

fn normalized_process_path(path: &Path, windows: bool) -> String {
    let raw = path.to_string_lossy();
    let without_deleted_suffix = raw.strip_suffix(" (deleted)").unwrap_or(&raw);
    let normalized = without_deleted_suffix.replace('\\', "/");
    if windows {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn same_executable_path(candidate: &Path, allowed: &Path, windows: bool) -> bool {
    if normalized_process_path(candidate, windows) == normalized_process_path(allowed, windows) {
        return true;
    }
    let Ok(candidate) = candidate.canonicalize() else {
        return false;
    };
    let Ok(allowed) = allowed.canonicalize() else {
        return false;
    };
    normalized_process_path(&candidate, windows) == normalized_process_path(&allowed, windows)
}

fn allowed_sidecar_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(sidecar) = bundled_sidecar_path(&executable, cfg!(windows)) {
            candidates.push(sidecar);
        }
    }
    if let Ok(data_directory) = hara_data_dir() {
        candidates.push(
            data_directory
                .join("bin")
                .join(bundled_sidecar_name(cfg!(windows))),
        );
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .filter(|directory| directory.is_absolute())
                .take(128)
                .map(|directory| directory.join(bundled_sidecar_name(cfg!(windows)))),
        );
    }
    candidates.sort();
    candidates.dedup();
    candidates
}

fn process_path_is_hara_sidecar(candidate: &Path) -> bool {
    allowed_sidecar_paths()
        .iter()
        .any(|allowed| same_executable_path(candidate, allowed, cfg!(windows)))
}

#[cfg(target_os = "linux")]
fn process_executable_path(pid: u32) -> Result<PathBuf, String> {
    fs::read_link(format!("/proc/{pid}/exe"))
        .map_err(|error| format!("inspect legacy Hara process: {error}"))
}

#[cfg(target_os = "macos")]
fn process_executable_path(pid: u32) -> Result<PathBuf, String> {
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let length =
        unsafe { libc::proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if length <= 0 {
        return Err(format!(
            "inspect legacy Hara process: {}",
            std::io::Error::last_os_error()
        ));
    }
    buffer.truncate(length as usize);
    while buffer.last() == Some(&0) {
        buffer.pop();
    }
    Ok(PathBuf::from(String::from_utf8_lossy(&buffer).into_owned()))
}

#[cfg(unix)]
fn terminate_verified_legacy_process(pid: u32) -> Result<(), String> {
    let executable = process_executable_path(pid)?;
    if !process_path_is_hara_sidecar(&executable) {
        return Err(format!(
            "refusing to stop pid {pid}: {} is not a Desktop-managed Hara engine",
            executable.display()
        ));
    }
    let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    if result != 0 {
        return Err(format!(
            "stop legacy Hara engine: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_verified_legacy_process(pid: u32) -> Result<(), String> {
    windows_process::terminate_verified_process(pid, process_path_is_hara_sidecar)
}

#[cfg(not(any(unix, windows)))]
fn terminate_verified_legacy_process(_pid: u32) -> Result<(), String> {
    Err("legacy engine replacement is not supported on this platform".into())
}

fn retire_discovered_serve_at(
    path: &Path,
    expected_pid: Option<u32>,
    is_alive: impl Fn(u32) -> bool,
    terminate: impl Fn(u32) -> Result<(), String>,
) -> Result<(), String> {
    let (raw, record) = read_private_discovery_at(&path)?;
    if expected_pid.is_some_and(|expected| record.pid != expected) {
        return Err("the running Hara engine changed; reconnect before restarting it".into());
    }

    if is_alive(record.pid) {
        terminate(record.pid)?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while is_alive(record.pid) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        if is_alive(record.pid) {
            return Err("legacy Hara engine did not stop within 5 seconds".into());
        }
    }

    // A graceful old engine normally removes its own record. Windows legacy termination cannot, so remove
    // only the exact owner-only contents we opened before signalling; never unlink a replacement instance.
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("recheck retired serve discovery: {error}")),
        Ok(_) => {
            let (current, _) = read_private_discovery_at(path)?;
            if current != raw {
                return Err(
                    "another Hara engine started while the old engine was retiring; reconnect and retry"
                        .into(),
                );
            }
            fs::remove_file(path)
                .map_err(|error| format!("remove retired serve discovery: {error}"))?;
        }
    }
    Ok(())
}

/// One-time bridge for engines that predate authenticated `server.shutdown`. The renderer supplies only
/// the pid it already authenticated to; native code independently reopens the private record and refuses
/// to signal anything except a Desktop-bundled, managed, or absolute-PATH `hara` executable.
#[tauri::command]
fn terminate_legacy_serve(expected_pid: u32) -> Result<(), String> {
    retire_discovered_serve_at(
        &discovery_path()?,
        Some(expected_pid),
        process_is_alive,
        terminate_verified_legacy_process,
    )
}

/// A failed authenticated connection followed by an explicit Start is a recovery request. Retire only the
/// process named by the owner-only discovery record and only after executable-path verification. A stale
/// record for a dead process is removed without signalling anything.
fn recover_discovered_serve_before_start() -> Result<(), String> {
    let path = discovery_path()?;
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("inspect previous Hara engine: {error}")),
        Ok(_) => {}
    }
    retire_discovered_serve_at(
        &path,
        None,
        process_is_alive,
        terminate_verified_legacy_process,
    )
    .map_err(|error| {
        format!(
            "Hara Desktop could not safely recover the previous engine: {error}. \
             Stop the identified process or remove ~/.hara/serve.json after confirming it is stale, then retry."
        )
    })
}

/// Prefer Hara's conventional port when it is available. If another application owns 8790, choose a
/// loopback-only ephemeral port and let the authenticated discovery record advertise it. This avoids
/// killing or probing unrelated applications and removes Desktop's fixed-port startup dependency.
fn available_serve_port() -> Result<u16, String> {
    let default_address = std::net::SocketAddr::from(([127, 0, 0, 1], DEFAULT_SERVE_PORT));
    match std::net::TcpListener::bind(default_address) {
        Ok(listener) => {
            drop(listener);
            Ok(DEFAULT_SERVE_PORT)
        }
        Err(default_error) => {
            let listener = std::net::TcpListener::bind(std::net::SocketAddr::from((
                [127, 0, 0, 1],
                0,
            )))
            .map_err(|error| {
                format!(
                    "port {DEFAULT_SERVE_PORT} is occupied ({default_error}) and no fallback loopback port is available ({error})"
                )
            })?;
            let port = listener
                .local_addr()
                .map_err(|error| format!("inspect fallback Hara port: {error}"))?
                .port();
            drop(listener);
            Ok(port)
        }
    }
}

fn serve_command(
    executable: &Path,
    port: u16,
    herdr_executable: Option<&Path>,
) -> std::process::Command {
    let mut command = std::process::Command::new(executable);
    command.args(["serve", "--port", &port.to_string()]);
    // The sidecar uses this marker only for Desktop-owned migrations such as repairing an already
    // installed Hara scheduler path after an app rename/move. It never auto-installs new OS services.
    command.env("HARA_DESKTOP_SIDECAR", "1");
    if let Some(herdr_executable) = herdr_executable {
        command.env("HARA_HERDR_PATH", herdr_executable);
    }
    command
}

fn spawn_serve_process(
    executable: &Path,
    log_path: &Path,
    port: u16,
    herdr_executable: Option<&Path>,
) -> Result<u32, String> {
    let log_directory = log_path
        .parent()
        .ok_or_else(|| "serve log has no parent directory".to_string())?;
    fs::create_dir_all(log_directory)
        .map_err(|error| format!("create Hara data directory: {error}"))?;
    let stdout = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(log_path)
        .map_err(|error| format!("open serve log: {error}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("clone serve log handle: {error}"))?;

    let mut command = serve_command(executable, port, herdr_executable);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(stdout))
        .stderr(std::process::Stdio::from(stderr));

    // Keep the engine outside the Desktop process group. Direct process spawning avoids shell
    // quoting, login-shell PATH differences, and the absence of zsh/nohup on Windows.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start {}: {error}", executable.display()))?;
    let pid = child.id();
    // Dropping Child does not reap it on Unix. A tiny waiter prevents a stopped Serve process from
    // remaining as a zombie while Desktop stays open.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
}

/// Spawn `hara serve` detached. Resolution order (cc-haha sidecar blueprint, adapted):
/// 1. **Bundled sidecar** — the `hara` binary Tauri ships next to the app executable (externalBin).
///    Zero-dependency: the app works on a machine with no node/npm at all.
/// 2. PATH fallback (dev mode / user-managed standalone installs).
///
/// Both paths launch the engine directly through `std::process::Command`; no shell is involved.
/// Output → ~/.hara/serve.log (read back by `read_serve_log` for the failure UI).
#[tauri::command]
fn start_serve() -> Result<u32, String> {
    let data_directory = hara_data_dir()?;
    let log_path = data_directory.join("serve.log");
    let app_executable = std::env::current_exe()
        .map_err(|error| format!("resolve Hara Desktop executable: {error}"))?;
    let bundled =
        bundled_sidecar_path(&app_executable, cfg!(windows)).filter(|sidecar| sidecar.is_file());
    let bundled_herdr =
        bundled_herdr_path(&app_executable, cfg!(windows)).filter(|runtime| runtime.is_file());
    let executable = match bundled {
        Some(sidecar) => sidecar,
        None => {
            let path = std::env::var_os("PATH");
            let Some(fallback) =
                fallback_sidecar_path(&data_directory, path.as_deref(), cfg!(windows))
            else {
                return Err(format!(
                    "`{}` not found — no bundled sidecar, {} or absolute PATH entry contains it",
                    bundled_sidecar_name(cfg!(windows)),
                    data_directory.join("bin").display()
                ));
            };
            fallback
        }
    };
    recover_discovered_serve_before_start()?;
    let port = available_serve_port()?;
    let pid = spawn_serve_process(&executable, &log_path, port, bundled_herdr.as_deref())?;
    Ok(pid)
}

/// Tail of ~/.hara/serve.log — shown in the UI when startup fails (cc-haha's 80-line startup buffer
/// pattern: give the user the actual error, not "connection refused").
#[tauri::command]
fn read_serve_log() -> String {
    let Ok(log_path) = hara_data_dir().map(|directory| directory.join("serve.log")) else {
        return String::new();
    };
    match fs::read_to_string(log_path) {
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
    user_home()
        .map(|home| home.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ClassifiedAttachmentPath {
    path: String,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_size: Option<u64>,
}

fn classify_attachment_paths_inner(
    paths: Vec<String>,
) -> Result<Vec<ClassifiedAttachmentPath>, String> {
    if paths.len() > MAX_DROPPED_ATTACHMENT_PATHS {
        return Err(format!(
            "too many dropped items (maximum {MAX_DROPPED_ATTACHMENT_PATHS})"
        ));
    }

    paths
        .into_iter()
        .map(|raw_path| {
            let candidate = PathBuf::from(&raw_path);
            if raw_path.is_empty() || !candidate.is_absolute() {
                return Err("dropped material must use an absolute local path".to_string());
            }
            let metadata = fs::symlink_metadata(&candidate)
                .map_err(|_| "a dropped item is no longer available".to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("symbolic links cannot be added as dropped material".to_string());
            }
            let kind = if metadata.is_dir() {
                "directory"
            } else if metadata.is_file() {
                "file"
            } else {
                return Err("a dropped item is not a regular file or folder".to_string());
            };
            Ok(ClassifiedAttachmentPath {
                path: raw_path,
                kind: kind.to_string(),
                byte_size: metadata.is_file().then(|| metadata.len()),
            })
        })
        .collect()
}

/// Classify paths supplied by Tauri's native drop event without reading their contents. Hara Serve
/// remains authoritative for protected-path, type, size and one-turn directory inventory checks.
#[tauri::command]
fn classify_attachment_paths(paths: Vec<String>) -> Result<Vec<ClassifiedAttachmentPath>, String> {
    classify_attachment_paths_inner(paths)
}

/// Persist a pasted clipboard image to the explicit Desktop media input surface. `hara serve` protects
/// runtime/control-plane state under ~/.hara by default, but permits the narrowly named
/// ~/.hara/<client>/media surface because those bytes are intentional model inputs.
fn temp_image_size_error() -> String {
    format!(
        "image exceeds Hara's 3.6 MB ({MAX_COMPOSER_IMAGE_BYTES} byte) attachment limit; it was not sent to the model or to an OCR fallback. Compress or crop it, then attach it again"
    )
}

fn validate_temp_image_size(byte_count: usize) -> Result<(), String> {
    if byte_count > MAX_COMPOSER_IMAGE_BYTES {
        return Err(temp_image_size_error());
    }
    Ok(())
}

fn ensure_desktop_media_directory(data_directory: &Path) -> Result<PathBuf, String> {
    let desktop = data_directory.join("desktop");
    let media = desktop.join("media");
    for (directory, label) in [
        (data_directory, "Hara data directory"),
        (desktop.as_path(), "Hara Desktop data directory"),
        (media.as_path(), "Hara Desktop media directory"),
    ] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) => {
                #[cfg(windows)]
                let linked =
                    metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata);
                #[cfg(not(windows))]
                let linked = metadata.file_type().is_symlink();
                if linked || !metadata.is_dir() {
                    return Err(format!("{label} must be a real directory, not a link"));
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o022 != 0
                    {
                        return Err(format!(
                            "{label} must be owned by this user and not writable by other users"
                        ));
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    fs::DirBuilder::new()
                        .mode(0o700)
                        .create(directory)
                        .map_err(|error| format!("create {label}: {error}"))?;
                }
                #[cfg(not(unix))]
                fs::create_dir(directory).map_err(|error| format!("create {label}: {error}"))?;
            }
            Err(error) => return Err(format!("inspect {label}: {error}")),
        }
    }
    Ok(media)
}

fn persist_pasted_image_at(data_directory: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    validate_temp_image_size(bytes.len())?;
    let directory = ensure_desktop_media_directory(data_directory)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for attempt in 0..32_u8 {
        let path = directory.join(format!(
            "paste-{}-{nonce}-{attempt}.png",
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        match options.open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(format!("persist pasted image: {error}"));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("create pasted image: {error}")),
        }
    }
    Err("could not reserve a pasted image path".into())
}

#[tauri::command]
fn write_temp_image(data_base64: String) -> Result<String, String> {
    use base64::Engine;
    if data_base64.len() > MAX_COMPOSER_IMAGE_BASE64_BYTES {
        return Err(temp_image_size_error());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    let path = persist_pasted_image_at(&hara_data_dir()?, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

fn read_presentation_image_at(path: &Path) -> Result<String, String> {
    use base64::Engine;

    if !path.is_absolute() {
        return Err("presentation image must use an absolute local path".into());
    }
    let before = fs::symlink_metadata(path)
        .map_err(|_| "the selected presentation image is no longer available".to_string())?;
    if !before.is_file() || before.file_type().is_symlink() {
        return Err("presentation image must be a regular file, not a link".into());
    }
    #[cfg(windows)]
    if metadata_is_reparse_point(&before) {
        return Err("presentation image must be a regular file, not a link".into());
    }
    if before.len() == 0 || before.len() > MAX_PRESENTATION_IMAGE_BYTES as u64 {
        return Err("presentation image must be non-empty and no larger than 3 MB".into());
    }

    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "the selected presentation image could not be opened safely".to_string())?;
    let opened = file
        .metadata()
        .map_err(|_| "the selected presentation image could not be inspected safely".to_string())?;
    if !opened.is_file() || opened.len() != before.len() {
        return Err("the selected presentation image changed while it was being opened".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != before.dev() || opened.ino() != before.ino() {
            return Err("the selected presentation image changed while it was being opened".into());
        }
    }

    let mut bytes = Vec::with_capacity(opened.len() as usize);
    std::io::Read::by_ref(&mut file)
        .take(MAX_PRESENTATION_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "the selected presentation image could not be read safely".to_string())?;
    if bytes.len() > MAX_PRESENTATION_IMAGE_BYTES {
        return Err("presentation image must be no larger than 3 MB".into());
    }
    let format = image::guess_format(&bytes)
        .map_err(|_| "presentation image format is not recognized".to_string())?;
    let media_type = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        _ => return Err("presentation images support PNG, JPEG, WebP, or GIF".into()),
    };
    let mut reader = image::ImageReader::new(std::io::Cursor::new(&bytes));
    reader.set_format(format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_PRESENTATION_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_PRESENTATION_IMAGE_DIMENSION);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "presentation image is invalid or exceeds safe dimensions".to_string())?;
    if width == 0
        || height == 0
        || u64::from(width).saturating_mul(u64::from(height)) > MAX_PRESENTATION_IMAGE_PIXELS
    {
        return Err("presentation image is empty or exceeds safe dimensions".into());
    }

    Ok(format!(
        "data:{media_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn read_presentation_image(path: String) -> Result<String, String> {
    read_presentation_image_at(Path::new(&path))
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCrashDraft {
    report_version: u8,
    consent_version: u8,
    app_version: String,
    platform: String,
    arch: String,
    kind: String,
    occurred_at_ms: u64,
    fingerprint: String,
    summary: String,
    context: Vec<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCrashSubmission {
    report_version: u8,
    consent_version: u8,
    app_version: String,
    engine_version: String,
    platform: String,
    arch: String,
    kind: String,
    occurred_at: String,
    fingerprint: String,
    summary: String,
    user_description: String,
    context: Vec<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCrashReceipt {
    report_id: String,
    status: String,
    occurrence_count: u32,
}

fn unix_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn desktop_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn desktop_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => other,
    }
}

fn hex_sha256(parts: &[&str]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;

    let mut digest = Sha256::new();
    for part in parts {
        digest.update(part.as_bytes());
        digest.update([0]);
    }
    digest
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            let _ = write!(output, "{byte:02x}");
            output
        })
}

fn safe_crash_identifier(value: &str, fallback: &str) -> String {
    let safe: String = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
        .take(64)
        .collect();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

fn ensure_crash_report_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("Hara crash report storage is not a private directory".into());
            }
            #[cfg(windows)]
            if metadata_is_reparse_point(&metadata) {
                return Err("Hara crash report storage is not a private directory".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)
                .map_err(|error| format!("create crash report storage: {error}"))?;
        }
        Err(error) => return Err(format!("inspect crash report storage: {error}")),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("secure crash report storage: {error}"))?;
    }
    Ok(())
}

fn crash_report_directory<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve crash report storage: {error}"))?
        .join("crash-reports");
    ensure_crash_report_directory(&directory)?;
    Ok(directory)
}

fn write_private_crash_json(path: &Path, value: &DesktopCrashDraft) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "crash report path has no parent".to_string())?;
    ensure_crash_report_directory(directory)?;
    let bytes =
        serde_json::to_vec(value).map_err(|error| format!("serialize crash report: {error}"))?;
    if bytes.len() as u64 > CRASH_REPORT_MAX_BYTES {
        return Err("crash report exceeds the local size limit".into());
    }
    let staged = directory.join(format!(
        ".crash-report-{}-{}.tmp",
        std::process::id(),
        unix_time_millis(),
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&staged)
        .map_err(|error| format!("stage crash report: {error}"))?;
    let result = file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("persist crash report: {error}"));
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    if let Err(error) = replace_managed_file(&staged, path, "install crash report") {
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    Ok(())
}

fn pending_crash_report_at(path: &Path) -> Result<Option<DesktopCrashDraft>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("inspect pending crash report: {error}")),
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > CRASH_REPORT_MAX_BYTES
    {
        return Err("pending crash report is not a bounded regular file".into());
    }
    #[cfg(windows)]
    if metadata_is_reparse_point(&metadata) {
        return Err("pending crash report is not a bounded regular file".into());
    }
    let raw = fs::read(path).map_err(|error| format!("read pending crash report: {error}"))?;
    serde_json::from_slice(&raw)
        .map(Some)
        .map_err(|error| format!("parse pending crash report: {error}"))
}

fn pending_crash_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(crash_report_directory(app)?.join(CRASH_PENDING_FILE))
}

fn unclean_exit_draft() -> DesktopCrashDraft {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let platform = desktop_platform().to_string();
    let arch = desktop_arch().to_string();
    DesktopCrashDraft {
        report_version: CRASH_REPORT_VERSION,
        consent_version: CRASH_CONSENT_VERSION,
        app_version: version.clone(),
        platform: platform.clone(),
        arch: arch.clone(),
        kind: "unclean_exit".into(),
        occurred_at_ms: unix_time_millis(),
        fingerprint: hex_sha256(&["unclean_exit", &version, &platform, &arch]),
        summary: "The previous Hara Desktop run did not close normally".into(),
        context: Vec::new(),
    }
}

fn desktop_run_marker_pid(name: &str) -> Option<u32> {
    let raw = name
        .strip_prefix(CRASH_RUN_MARKER_PREFIX)?
        .strip_suffix(CRASH_RUN_MARKER_SUFFIX)?;
    let pid = raw.parse::<u32>().ok()?;
    (pid > 1 && (!cfg!(unix) || pid <= i32::MAX as u32)).then_some(pid)
}

fn reconcile_crash_run_markers_at(
    directory: &Path,
    pending: &Path,
    current_pid: u32,
    expected_update_restart: bool,
) -> Result<(), String> {
    let entries =
        fs::read_dir(directory).map_err(|error| format!("scan crash markers: {error}"))?;
    for entry in entries.take(64) {
        let entry = entry.map_err(|error| format!("read crash marker: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(pid) = desktop_run_marker_pid(&name) else {
            continue;
        };
        // A marker with our freshly assigned PID predates this process because this launch has not
        // created its own marker yet. Treat PID reuse as a stale run; only another live PID belongs
        // to a concurrent Hara instance.
        if pid != current_pid && process_is_alive(pid) {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("inspect crash marker: {error}"))?;
        if metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() <= 256 {
            // Updaters from before crash-marker retirement leave the old PID marker behind. The
            // one-shot update marker is already durable before the new process starts, but the renderer
            // consumes it only after setup. Suppress only this launch's stale-marker report; still retire
            // every old marker and arm the new run below.
            if !expected_update_restart && pending_crash_report_at(pending)?.is_none() {
                write_private_crash_json(pending, &unclean_exit_draft())?;
            }
            fs::remove_file(&path).map_err(|error| format!("retire crash marker: {error}"))?;
        }
    }
    Ok(())
}

fn initialize_crash_tracking<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let directory = crash_report_directory(app)?;
    let pending = directory.join(CRASH_PENDING_FILE);
    let current_pid = std::process::id();
    let expected_update_restart = update_restart_marker(app)
        .and_then(|marker| update_restart_marker_pending_at(&marker))
        .unwrap_or(false);
    reconcile_crash_run_markers_at(&directory, &pending, current_pid, expected_update_restart)?;
    let marker = directory.join(format!(
        "{CRASH_RUN_MARKER_PREFIX}{current_pid}{CRASH_RUN_MARKER_SUFFIX}",
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&marker)
        .map_err(|error| format!("arm crash marker: {error}"))?;
    file.write_all(format!("{}\n", unix_time_millis()).as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("persist crash marker: {error}"))
}

fn crash_run_marker<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(crash_report_directory(app)?.join(format!(
        "{CRASH_RUN_MARKER_PREFIX}{}{CRASH_RUN_MARKER_SUFFIX}",
        std::process::id(),
    )))
}

fn retire_crash_run_marker_at(marker: &Path) -> Result<(), String> {
    match fs::symlink_metadata(marker) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("crash run marker is not a regular file".into())
        }
        Ok(_) => {
            fs::remove_file(marker).map_err(|error| format!("retire crash run marker: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("inspect crash run marker: {error}")),
    }
}

fn clear_crash_tracking<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(marker) = crash_run_marker(app) {
        let _ = retire_crash_run_marker_at(&marker);
    }
}

#[tauri::command]
fn record_renderer_failure(
    app: tauri::AppHandle,
    error_name: String,
    component_names: Vec<String>,
) -> Result<(), String> {
    let name = safe_crash_identifier(&error_name, "Error");
    let context: Vec<String> = component_names
        .iter()
        .map(|component| safe_crash_identifier(component, "Component"))
        .take(12)
        .collect();
    let version = env!("CARGO_PKG_VERSION").to_string();
    let platform = desktop_platform().to_string();
    let arch = desktop_arch().to_string();
    let context_key = context.join(",");
    let draft = DesktopCrashDraft {
        report_version: CRASH_REPORT_VERSION,
        consent_version: CRASH_CONSENT_VERSION,
        app_version: version.clone(),
        platform: platform.clone(),
        arch: arch.clone(),
        kind: "renderer_exception".into(),
        occurred_at_ms: unix_time_millis(),
        fingerprint: hex_sha256(&[
            "renderer_exception",
            &version,
            &platform,
            &arch,
            &name,
            &context_key,
        ]),
        summary: format!("{name} reached the Hara renderer recovery boundary"),
        context,
    };
    write_private_crash_json(&pending_crash_path(&app)?, &draft)
}

#[tauri::command]
fn pending_crash_report(app: tauri::AppHandle) -> Result<Option<DesktopCrashDraft>, String> {
    pending_crash_report_at(&pending_crash_path(&app)?)
}

#[tauri::command]
fn discard_pending_crash_report(app: tauri::AppHandle) -> Result<(), String> {
    let path = pending_crash_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("discard pending crash report: {error}")),
    }
}

fn validate_crash_submission(value: &DesktopCrashSubmission) -> Result<(), String> {
    let bounded = |text: &str, max: usize| !text.is_empty() && text.chars().count() <= max;
    if value.report_version != CRASH_REPORT_VERSION
        || value.consent_version != CRASH_CONSENT_VERSION
        || !bounded(&value.app_version, 48)
        || value.engine_version.chars().count() > 48
        || !matches!(value.platform.as_str(), "windows" | "macos" | "linux")
        || !matches!(value.arch.as_str(), "x86_64" | "aarch64" | "arm64")
        || !matches!(
            value.kind.as_str(),
            "unclean_exit" | "renderer_exception" | "renderer_unresponsive"
        )
        || value.fingerprint.len() != 64
        || !value
            .fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || !bounded(&value.occurred_at, 40)
        || !bounded(&value.summary, 500)
        || value.user_description.chars().count() > 1200
        || value.context.len() > 12
        || value.context.iter().any(|entry| entry.chars().count() > 80)
    {
        return Err("crash report contains unsupported or oversized fields".into());
    }
    Ok(())
}

#[tauri::command]
async fn submit_crash_report(
    app: tauri::AppHandle,
    report: DesktopCrashSubmission,
) -> Result<DesktopCrashReceipt, String> {
    validate_crash_submission(&report)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|_| "could not prepare the crash report connection".to_string())?;
    let response = client
        .post(CRASH_REPORT_ENDPOINT)
        .header(
            "User-Agent",
            format!("Hara-Desktop/{}", env!("CARGO_PKG_VERSION")),
        )
        .json(&report)
        .send()
        .await
        .map_err(|_| "could not reach Hara crash report intake".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "crash report intake returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let receipt = response
        .json::<DesktopCrashReceipt>()
        .await
        .map_err(|_| "crash report intake returned an invalid receipt".to_string())?;
    if receipt.report_id.len() > 80 || receipt.status != "received" {
        return Err("crash report intake returned an invalid receipt".into());
    }
    discard_pending_crash_report(app)?;
    Ok(receipt)
}

/// Dock badge = manual unread count (macOS). None clears it.
#[tauri::command]
fn set_badge(app: tauri::AppHandle, count: Option<i64>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(count);
    }
}

const UPDATE_RESTART_MARKER: &str = "update-restart.pending";

fn arm_update_restart_marker_at(marker: &Path) -> Result<(), String> {
    use std::io::Write;

    let parent = marker
        .parent()
        .ok_or_else(|| "update restart marker has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("create app data directory: {e}"))?;
    match fs::symlink_metadata(marker) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("update restart marker is not a regular file".into())
        }
        Ok(_) => {
            fs::remove_file(marker).map_err(|e| format!("replace update restart marker: {e}"))?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("inspect update restart marker: {error}")),
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
        .map_err(|e| format!("create update restart marker: {e}"))?;
    file.write_all(b"start-bundled-sidecar-once\n")
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("persist update restart marker: {e}"))
}

fn update_restart_marker_pending_at(marker: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("inspect update restart marker: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 128 {
        return Err("update restart marker is invalid".into());
    }
    let content = fs::read(marker).map_err(|e| format!("read update restart marker: {e}"))?;
    if content != b"start-bundled-sidecar-once\n" {
        return Err("update restart marker is invalid".into());
    }
    Ok(true)
}

fn take_update_restart_marker_at(marker: &Path) -> Result<bool, String> {
    if !update_restart_marker_pending_at(marker)? {
        return Ok(false);
    }
    fs::remove_file(marker).map_err(|e| format!("consume update restart marker: {e}"))?;
    Ok(true)
}

fn update_restart_marker<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(UPDATE_RESTART_MARKER))
        .map_err(|e| format!("resolve app data directory: {e}"))
}

fn prepare_update_restart_markers_at(
    update_marker: &Path,
    crash_marker: &Path,
) -> Result<(), String> {
    arm_update_restart_marker_at(update_marker)?;
    if let Err(retire_error) = retire_crash_run_marker_at(crash_marker) {
        return match take_update_restart_marker_at(update_marker) {
            Ok(_) => Err(retire_error),
            Err(rollback_error) => Err(format!(
                "{retire_error}; rollback update restart marker: {rollback_error}"
            )),
        };
    }
    Ok(())
}

/// This one-shot marker is the only path that auto-starts a sidecar on launch. Ordinary launches
/// continue to discover an existing Serve process and otherwise wait for the user.
#[tauri::command]
fn take_update_restart_marker(app: tauri::AppHandle) -> Result<bool, String> {
    take_update_restart_marker_at(&update_restart_marker(&app)?)
}

/// Relaunch only after the renderer has observed authenticated Serve shutdown and discovery cleanup.
/// The marker survives the process boundary, is consumed once, and grants no general process control.
#[tauri::command]
fn restart_after_update(app: tauri::AppHandle) -> Result<(), String> {
    // Tauri's process replacement is not guaranteed to deliver RunEvent::Exit before the new binary
    // starts. Retire this known-clean run synchronously so the next launch cannot report an update as
    // an unclean exit. If retirement fails, roll back the update marker and do not restart.
    prepare_update_restart_markers_at(&update_restart_marker(&app)?, &crash_run_marker(&app)?)?;
    app.restart();
}

/// Panel servers WE started (their port wasn't listening before start_panel ran) — terminated on app
/// exit so design/video preview servers don't pile up as orphans. A server the user already had
/// running (pre-listening on the hinted port) is never touched.
struct OwnedPanels(std::sync::Mutex<Vec<u16>>);

#[derive(Debug, PartialEq, Eq)]
enum PanelLaunchPlan {
    Direct(PathBuf),
    Node { runtime: PathBuf, script: PathBuf },
}

fn bounded_command_output(
    command: &mut std::process::Command,
    timeout: std::time::Duration,
) -> std::io::Result<std::process::Output> {
    use std::process::Stdio;

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || -> std::io::Result<Vec<u8>> {
        let mut output = Vec::new();
        if let Some(mut pipe) = stdout_pipe.take() {
            pipe.read_to_end(&mut output)?;
        }
        Ok(output)
    });
    let stderr_reader = std::thread::spawn(move || -> std::io::Result<Vec<u8>> {
        let mut output = Vec::new();
        if let Some(mut pipe) = stderr_pipe.take() {
            pipe.read_to_end(&mut output)?;
        }
        Ok(output)
    });
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            let stdout = stdout_reader
                .join()
                .map_err(|_| std::io::Error::other("stdout reader failed"))??;
            let stderr = stderr_reader
                .join()
                .map_err(|_| std::io::Error::other("stderr reader failed"))??;
            return Ok(std::process::Output {
                status,
                stdout,
                stderr,
            });
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "command timed out",
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn parse_node_major(output: &[u8]) -> Option<u32> {
    String::from_utf8_lossy(output)
        .trim()
        .strip_prefix('v')?
        .split('.')
        .next()?
        .parse()
        .ok()
}

fn supported_node_runtime(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    let mut checked = Vec::<PathBuf>::new();
    let mut fallback = None;
    for candidate in candidates {
        if !candidate.is_absolute() || !candidate.is_file() {
            continue;
        }
        let identity = candidate
            .canonicalize()
            .unwrap_or_else(|_| candidate.clone());
        if checked.iter().any(|seen| seen == &identity) {
            continue;
        }
        checked.push(identity);
        let Ok(output) = bounded_command_output(
            std::process::Command::new(&candidate).arg("--version"),
            PANEL_NODE_PROBE_TIMEOUT,
        ) else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        if let Some(major) = parse_node_major(&output.stdout) {
            if major >= PREFERRED_PANEL_NODE_MAJOR {
                return Some(candidate);
            }
            if major >= MIN_PANEL_NODE_MAJOR && fallback.is_none() {
                fallback = Some(candidate);
            }
        }
    }
    fallback
}

fn append_versioned_node_candidates(
    candidates: &mut Vec<PathBuf>,
    versions_root: &Path,
    suffix: &Path,
) {
    let Ok(entries) = fs::read_dir(versions_root) else {
        return;
    };
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join(suffix))
        .take(128)
        .collect::<Vec<_>>();
    paths.sort_by(|a, b| b.cmp(a));
    candidates.extend(paths);
}

fn node_runtime_candidates(
    home: &Path,
    path_environment: Option<&std::ffi::OsStr>,
    windows: bool,
) -> Vec<PathBuf> {
    let node_name = if windows { "node.exe" } else { "node" };
    // Prefer bounded user runtime-manager installs. A Desktop process often inherits a stale system
    // PATH (or a project-local shim); probing that first can both select the wrong Node and delay a known
    // good NVM/FNM runtime under load. `supported_node_runtime` still scans later candidates when an early
    // managed runtime is only Node 18 and a preferred Node 22+ exists elsewhere.
    let mut candidates = vec![
        home.join(".volta").join("bin").join(node_name),
        home.join(".local")
            .join("share")
            .join("mise")
            .join("shims")
            .join(node_name),
        home.join(".asdf").join("shims").join(node_name),
    ];
    append_versioned_node_candidates(
        &mut candidates,
        &home.join(".nvm").join("versions").join("node"),
        &PathBuf::from("bin").join(node_name),
    );
    append_versioned_node_candidates(
        &mut candidates,
        &home.join(".fnm").join("node-versions"),
        &PathBuf::from("installation").join("bin").join(node_name),
    );

    candidates.extend(
        path_environment
            .into_iter()
            .flat_map(std::env::split_paths)
            .filter(|directory| directory.is_absolute())
            .take(128)
            .map(|directory| directory.join(node_name)),
    );

    if windows {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("nodejs").join(node_name));
        }
    } else {
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
            PathBuf::from("/usr/bin/node"),
        ]);
    }
    candidates
}

fn verified_panel_entry(data_directory: &Path, command: &str) -> Result<PathBuf, String> {
    let link = data_directory.join("bin").join(command);
    let link_metadata = fs::symlink_metadata(&link)
        .map_err(|error| format!("installed panel command is unavailable: {error}"))?;
    if !link_metadata.file_type().is_symlink() {
        return Err("installed panel command is not a verified plugin link".into());
    }

    let target = link
        .canonicalize()
        .map_err(|error| format!("resolve installed panel command: {error}"))?;
    let plugin_root = data_directory
        .join("plugins")
        .canonicalize()
        .map_err(|error| format!("resolve installed plugins directory: {error}"))?;
    if !target.starts_with(&plugin_root) || !target.is_file() {
        return Err("installed panel command escaped its verified plugin directory".into());
    }
    Ok(target)
}

fn panel_entry_requires_node(entry: &Path) -> Result<bool, String> {
    if entry.extension().and_then(|value| value.to_str()) == Some("mjs") {
        return Ok(true);
    }
    let mut source = fs::File::open(entry)
        .map_err(|error| format!("inspect installed panel command: {error}"))?;
    let mut prefix = [0_u8; 256];
    let length = source
        .read(&mut prefix)
        .map_err(|error| format!("inspect installed panel command: {error}"))?;
    let first_line = String::from_utf8_lossy(&prefix[..length])
        .lines()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    Ok(first_line.starts_with("#!")
        && first_line
            .split(|character: char| character.is_ascii_whitespace() || character == '/')
            .any(|part| part == "node" || part == "node.exe"))
}

fn panel_launch_plan(
    data_directory: &Path,
    home: &Path,
    path_environment: Option<&std::ffi::OsStr>,
    command: &str,
    windows: bool,
) -> Result<PanelLaunchPlan, String> {
    let entry = verified_panel_entry(data_directory, command)?;
    if !panel_entry_requires_node(&entry)? {
        return Ok(PanelLaunchPlan::Direct(entry));
    }
    let runtime = supported_node_runtime(node_runtime_candidates(home, path_environment, windows))
        .ok_or_else(|| {
            format!(
                "This plugin requires Node.js {MIN_PANEL_NODE_MAJOR} or newer. Install Node.js 22 LTS, then try again."
            )
        })?;
    Ok(PanelLaunchPlan::Node {
        runtime,
        script: entry,
    })
}

fn panel_process(
    plan: &PanelLaunchPlan,
    data_directory: &Path,
    home: &Path,
    args: &[String],
    cwd: Option<&Path>,
) -> Result<std::process::Command, String> {
    let mut process = match plan {
        PanelLaunchPlan::Direct(program) => std::process::Command::new(program),
        PanelLaunchPlan::Node { runtime, script } => {
            let mut process = std::process::Command::new(runtime);
            process.arg(script);
            process
        }
    };
    process.args(args);
    if let Some(directory) = cwd {
        if !directory.is_absolute() || !directory.is_dir() {
            return Err("panel project directory is unavailable".into());
        }
        process.current_dir(directory);
    }

    let runtime_directory = match plan {
        PanelLaunchPlan::Node { runtime, .. } => runtime.parent(),
        PanelLaunchPlan::Direct(_) => None,
    };
    let mut path = vec![data_directory.join("bin")];
    path.extend(runtime_directory.map(Path::to_path_buf));
    path.extend([
        home.join(".local").join("bin"),
        home.join(".bun").join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(environment) = std::env::var_os("PATH") {
        path.extend(
            std::env::split_paths(&environment).filter(|directory| directory.is_absolute()),
        );
    }
    if let Ok(path) = std::env::join_paths(path) {
        process.env("PATH", path);
    }
    Ok(process)
}

fn port_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(150),
    )
    .is_ok()
}

/// Parse the one URL emitted by a legacy panel command without trusting string prefixes. Legacy
/// panels are local-only: exact loopback HTTP host, no URL credentials, and an explicit non-zero
/// port. When the manifest declares a port, the emitted URL must use that same port.
fn parse_local_panel_url(candidate: &str, port_hint: Option<u16>) -> Option<(String, u16)> {
    let parsed = tauri::Url::parse(candidate).ok()?;
    if parsed.scheme() != "http" || !parsed.username().is_empty() || parsed.password().is_some() {
        return None;
    }
    let host = parsed.host_str()?;
    let exact_localhost = host.eq_ignore_ascii_case("localhost");
    let loopback_ip = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
        .map(|address| address.is_loopback())
        .unwrap_or(false);
    if !exact_localhost && !loopback_ip {
        return None;
    }
    let port = parsed.port().filter(|port| *port != 0)?;
    if port_hint.is_some_and(|expected| expected != port) {
        return None;
    }
    Some((parsed.to_string(), port))
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
/// Plugin bins are verified links under ~/.hara/bin. Node-based panels are launched with a checked
/// Node >=18 runtime, never whichever interpreter a login shell happens to put first on PATH. The
/// command is expected to start/reuse its server, print `http://127.0.0.1:<port>…`, and exit.
/// `port_hint` (the manifest's declared port) drives ownership tracking for exit cleanup.
#[tauri::command]
fn start_panel(
    state: tauri::State<OwnedPanels>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    port_hint: Option<u16>,
) -> Result<String, String> {
    let pre_listening = port_hint.map(port_listening).unwrap_or(false);
    // basic hygiene: a panel command is a bare bin name from a plugin manifest, never shell syntax
    if !command
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid panel command".into());
    }
    let data_directory = hara_data_dir()?;
    let home = user_home()?;
    let plan = panel_launch_plan(
        &data_directory,
        &home,
        std::env::var_os("PATH").as_deref(),
        &command,
        cfg!(windows),
    )?;
    let cwd = cwd
        .filter(|directory| !directory.is_empty())
        .map(PathBuf::from);
    let mut process = panel_process(&plan, &data_directory, &home, &args, cwd.as_deref())?;
    let out = bounded_command_output(&mut process, std::time::Duration::from_secs(20))
        .map_err(|error| format!("start panel command: {error}"))?;
    let mut combined = out.stdout;
    combined.extend_from_slice(&out.stderr);
    let text = String::from_utf8_lossy(&combined);
    match text
        .split_whitespace()
        .find_map(|candidate| parse_local_panel_url(candidate, port_hint))
    {
        Some((url, actual_port)) => {
            // ownership: we only claim (and later kill) a server when the hinted port was NOT
            // listening before we ran the command and the URL confirms that same port came up
            if let Some(hint) = port_hint {
                if !pre_listening && actual_port == hint {
                    let mut owned = state.0.lock().unwrap();
                    if !owned.contains(&hint) {
                        owned.push(hint);
                    }
                }
            }
            Ok(url)
        }
        // stdout/stderr may contain URL query tokens, authorization headers, or other plugin
        // secrets. Keep renderer-visible errors useful but never echo untrusted process output.
        None => Err("panel command did not return a valid local URL on its declared port".into()),
    }
}

const FIRST_PARTY_UPDATER_ENDPOINT: &str =
    "https://assets.nanhara.com/hara/desktop/stable/latest.json";
const GITHUB_UPDATER_ENDPOINT: &str =
    "https://github.com/hara-cli/hara-desktop/releases/latest/download/latest.json";
const UPDATER_ENDPOINT_SMOKE_ARG: &str = "--hara-release-updater-endpoint-smoke";

fn release_updater_endpoints(config: &tauri::utils::config::Config) -> Result<Vec<String>, String> {
    let updater = config
        .plugins
        .0
        .get("updater")
        .ok_or_else(|| "updater plugin configuration is required".to_string())?;
    let updater = updater
        .as_object()
        .ok_or_else(|| "updater plugin configuration must be an object".to_string())?;
    let endpoints = updater
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "updater endpoints must be an array".to_string())?;
    endpoints
        .iter()
        .map(|endpoint| {
            endpoint
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| "updater endpoints must be strings".to_string())
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // Release package smoke executes this exact desktop binary natively. Reading the generated
    // runtime config is architecture-safe; searching Mach-O/PE/ELF bytes is not, because linkers may
    // split or transform string data without changing the value Tauri reconstructs at runtime.
    if std::env::args_os().any(|arg| arg == UPDATER_ENDPOINT_SMOKE_ARG) {
        let endpoints = release_updater_endpoints(context.config())
            .expect("release updater endpoint diagnostics require valid generated configuration");
        let expected = vec![
            FIRST_PARTY_UPDATER_ENDPOINT.to_string(),
            GITHUB_UPDATER_ENDPOINT.to_string(),
        ];
        if endpoints != expected {
            eprintln!("generated updater endpoints do not match the release contract");
            std::process::exit(2);
        }
        println!(
            "{}",
            serde_json::to_string(&endpoints)
                .expect("release updater endpoints must serialize as JSON")
        );
        return;
    }

    // Tauri's Windows updater intentionally persists its installer directory before exiting to let
    // NSIS/MSI finish. The new app owns bounded cleanup on a later launch: only exact Hara updater
    // directories with simple installer files are eligible, and a one-hour floor avoids racing a
    // still-running installer from another Hara window.
    #[cfg(windows)]
    {
        let cleanup = clean_windows_update_storage_at(
            &std::env::temp_dir(),
            WINDOWS_UPDATE_STAGING_AUTOCLEAN_AGE,
        );
        if cleanup.failed_entries > 0 || !cleanup.scan_complete {
            eprintln!(
                "Hara update temporary-file cleanup was incomplete (failed: {}, scan complete: {})",
                cleanup.failed_entries, cleanup.scan_complete
            );
        }
    }

    tauri::Builder::default()
        .manage(OwnedPanels(std::sync::Mutex::new(Vec::new())))
        .manage(RendererBootState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(should_track_window_state)
                // A cold launch always owns a visible main entry window. Persisting visibility can
                // leave AppKit with a live Tauri handle but an ordered-out native window; geometry
                // and presentation mode remain safe and useful to restore.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::DECORATIONS
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .setup(|app| {
            if let Err(error) = initialize_crash_tracking(app.handle()) {
                eprintln!("Hara crash tracking could not start: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_discovery,
            start_serve,
            inspect_command_line_hara,
            synchronize_command_line_hara,
            install_command_line_hara,
            terminate_legacy_serve,
            start_panel,
            get_home,
            read_serve_log,
            set_badge,
            ensure_extension_window_width,
            take_update_restart_marker,
            restart_after_update,
            inspect_desktop_update_storage,
            clean_desktop_update_storage,
            desktop_updater_target,
            classify_attachment_paths,
            write_temp_image,
            read_presentation_image,
            record_renderer_failure,
            pending_crash_report,
            discard_pending_crash_report,
            submit_crash_report,
            list_pets,
            read_pet_asset,
            renderer_ready
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| match event {
            #[cfg(desktop)]
            tauri::RunEvent::Ready => {
                #[cfg(target_os = "macos")]
                if let Err(error) = reopen_main_window(app) {
                    eprintln!("main window startup recovery failed: {error}");
                }
                #[cfg(not(target_os = "macos"))]
                {
                    use tauri::Manager;
                    #[cfg(windows)]
                    let software_renderer = windows_software_renderer_was_required(app);
                    #[cfg(not(windows))]
                    let software_renderer = false;
                    let renderer_state = app.state::<RendererBootState>();
                    #[cfg(windows)]
                    renderer_state
                        .software_mode
                        .store(software_renderer, Ordering::Release);
                    renderer_state.ready.store(false, Ordering::Release);
                    match get_or_create_main_window(app, software_renderer) {
                        Ok(window) => {
                            if let Err(error) = window.show() {
                                eprintln!("main window startup visibility failed: {error}");
                            } else if let Err(error) = recover_main_window_if_offscreen(&window) {
                                eprintln!("main window visibility recovery failed: {error}");
                            }
                            #[cfg(windows)]
                            if !software_renderer {
                                schedule_windows_renderer_recovery(app.clone());
                            }
                        }
                        Err(error) => {
                            eprintln!("main window startup creation failed: {error}");
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Err(error) = reopen_main_window(app) {
                    eprintln!("main window reopen failed: {error}");
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Focused(true),
                ..
            } if label == "main" => {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.set_visible_on_all_workspaces(false) {
                        eprintln!("main window workspace recovery failed: {error}");
                    }
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Resized(size),
                ..
            } if label == "main" => {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = recover_main_window_if_offscreen(&window) {
                        eprintln!(
                            "main window resize recovery failed at {}x{}: {error}",
                            size.width, size.height
                        );
                    }
                }
            }
            #[cfg(windows)]
            tauri::RunEvent::ExitRequested { api, .. }
                if app
                    .state::<RendererBootState>()
                    .fallback_started
                    .load(Ordering::Acquire) =>
            {
                // Destroying the only WebView normally requests process exit. Keep the host alive
                // only for the bounded 350 ms handoff to the software-rendered replacement.
                api.prevent_exit();
            }
            // app exit: terminate the panel servers WE started (never a server the user had running)
            tauri::RunEvent::Exit => {
                use tauri::Manager;
                clear_crash_tracking(app);
                let ports = app
                    .state::<OwnedPanels>()
                    .0
                    .lock()
                    .map(|v| v.clone())
                    .unwrap_or_default();
                kill_owned_panels(&ports);
            }
            _ => {}
        });
}

#[cfg(test)]
mod crash_report_tests {
    use super::*;

    fn valid_submission() -> DesktopCrashSubmission {
        DesktopCrashSubmission {
            report_version: CRASH_REPORT_VERSION,
            consent_version: CRASH_CONSENT_VERSION,
            app_version: "0.1.126".into(),
            engine_version: "0.157.0".into(),
            platform: "windows".into(),
            arch: "x86_64".into(),
            kind: "renderer_exception".into(),
            occurred_at: "2026-08-30T15:45:00.000Z".into(),
            fingerprint: "a".repeat(64),
            summary: "TypeError reached the Hara renderer recovery boundary".into(),
            user_description: "Clicked New session".into(),
            context: vec!["App".into(), "SessionList".into()],
        }
    }

    #[test]
    fn crash_identifiers_strip_paths_unicode_and_punctuation() {
        assert_eq!(
            safe_crash_identifier("Type/Error: 密钥", "Error"),
            "TypeError"
        );
        assert_eq!(safe_crash_identifier("路径/密钥", "Error"), "Error");
        assert_eq!(
            safe_crash_identifier("Session.List_2", "Component"),
            "Session.List_2"
        );
    }

    #[test]
    fn crash_marker_pid_requires_the_exact_managed_name() {
        assert_eq!(
            desktop_run_marker_pid("desktop-run-4132.active"),
            Some(4132)
        );
        assert_eq!(desktop_run_marker_pid("desktop-run-0.active"), None);
        assert_eq!(desktop_run_marker_pid("desktop-run-4132.active.bak"), None);
        assert_eq!(desktop_run_marker_pid("other-4132.active"), None);
    }

    #[test]
    fn crash_submission_accepts_only_the_bounded_contract() {
        let mut report = valid_submission();
        assert!(validate_crash_submission(&report).is_ok());

        report.fingerprint = "A".repeat(64);
        assert!(validate_crash_submission(&report).is_err());
        report = valid_submission();
        report.context = vec!["Component".into(); 13];
        assert!(validate_crash_submission(&report).is_err());
        report = valid_submission();
        report.user_description = "x".repeat(1201);
        assert!(validate_crash_submission(&report).is_err());
    }

    #[test]
    fn pending_crash_draft_is_bounded_and_round_trips() {
        let root = std::env::temp_dir().join(format!(
            "hara-crash-report-test-{}-{}",
            std::process::id(),
            unix_time_millis(),
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join(CRASH_PENDING_FILE);
        let draft = unclean_exit_draft();
        write_private_crash_json(&path, &draft).unwrap();
        let restored = pending_crash_report_at(&path).unwrap().unwrap();
        assert_eq!(restored.kind, "unclean_exit");
        assert_eq!(restored.report_version, CRASH_REPORT_VERSION);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expected_update_restart_retires_old_run_marker_without_reporting_a_crash() {
        let root = std::env::temp_dir().join(format!(
            "hara-update-crash-reconcile-test-{}-{}",
            std::process::id(),
            unix_time_millis(),
        ));
        fs::create_dir_all(&root).unwrap();
        let pending = root.join(CRASH_PENDING_FILE);
        let stale = root.join("desktop-run-2147483000.active");
        fs::write(&stale, b"started\n").unwrap();

        reconcile_crash_run_markers_at(&root, &pending, std::process::id(), true).unwrap();
        assert!(!stale.exists());
        assert!(pending_crash_report_at(&pending).unwrap().is_none());

        fs::write(&stale, b"started\n").unwrap();
        reconcile_crash_run_markers_at(&root, &pending, std::process::id(), false).unwrap();
        assert!(!stale.exists());
        assert_eq!(
            pending_crash_report_at(&pending).unwrap().unwrap().kind,
            "unclean_exit"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod update_storage_tests {
    use super::*;

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "hara-desktop-update-storage-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn updater_staging_name_requires_exact_hara_grammar() {
        assert_eq!(
            windows_update_staging_version("Hara-0.1.56-updater-AbC123"),
            Some("0.1.56")
        );
        assert_eq!(
            windows_update_staging_version("Hara-0.2.0-beta.1-updater-Z9x8W7"),
            Some("0.2.0-beta.1")
        );
        assert_eq!(
            windows_update_staging_version("Other-0.1.56-updater-AbC123"),
            None
        );
        assert_eq!(
            windows_update_staging_version("Hara-main-updater-AbC123"),
            None
        );
        assert_eq!(
            windows_update_staging_version("Hara-0.1.56-updater-.."),
            None
        );
    }

    #[test]
    fn update_storage_cleanup_removes_only_verified_hara_installer_directories() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();

        let managed = root.join("Hara-0.1.56-updater-AbC123");
        fs::create_dir(&managed).unwrap();
        fs::write(managed.join("Hara-0.1.56-installer.exe"), vec![7_u8; 4_096]).unwrap();

        let protected = root.join("Hara-0.1.55-updater-ZyX987");
        fs::create_dir(&protected).unwrap();
        fs::create_dir(protected.join("unexpected-directory")).unwrap();

        let unrelated = root.join("AnotherApp-0.1.56-updater-AbC123");
        fs::create_dir(&unrelated).unwrap();
        fs::write(unrelated.join("keep.txt"), b"keep").unwrap();

        let (before, _) = collect_windows_update_storage(&root);
        assert_eq!(before.managed_entries, 1);
        assert_eq!(before.managed_bytes, 4_096);
        assert_eq!(before.protected_entries, 1);
        assert!(before.scan_complete);

        let startup_pass =
            clean_windows_update_storage_at(&root, std::time::Duration::from_secs(24 * 60 * 60));
        assert_eq!(startup_pass.removed_entries, 0);
        assert_eq!(startup_pass.managed_entries, 1);
        assert!(
            managed.exists(),
            "a recent installer is never raced at startup"
        );

        let after = clean_windows_update_storage_at(&root, std::time::Duration::ZERO);
        assert_eq!(after.removed_entries, 1);
        assert_eq!(after.reclaimed_bytes, 4_096);
        assert_eq!(after.managed_entries, 0);
        assert_eq!(after.protected_entries, 1);
        assert!(!managed.exists());
        assert!(protected.exists());
        assert!(unrelated.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn update_storage_cleanup_never_follows_a_link_shaped_like_hara_staging() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        let outside = root.with_extension("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let outside_installer = outside.join("Hara-0.1.56-installer.exe");
        fs::write(&outside_installer, b"keep").unwrap();
        let linked = root.join("Hara-0.1.56-updater-AbC123");
        symlink(&outside, &linked).unwrap();

        let before = collect_windows_update_storage(&root).0;
        assert_eq!(before.managed_entries, 0);
        assert_eq!(before.protected_entries, 1);

        let after = clean_windows_update_storage_at(&root, std::time::Duration::ZERO);
        assert_eq!(after.removed_entries, 0);
        assert!(linked.exists());
        assert_eq!(fs::read(&outside_installer).unwrap(), b"keep");

        fs::remove_file(linked).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}

#[cfg(test)]
mod updater_tests {
    use super::*;

    #[test]
    fn runtime_updater_endpoint_diagnostics_reads_generated_order_without_mutation() {
        let mut config = tauri::utils::config::Config::default();
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({
                "endpoints": [FIRST_PARTY_UPDATER_ENDPOINT, GITHUB_UPDATER_ENDPOINT],
                "pubkey": "fixture"
            }),
        );

        assert_eq!(
            release_updater_endpoints(&config).unwrap(),
            vec![FIRST_PARTY_UPDATER_ENDPOINT, GITHUB_UPDATER_ENDPOINT]
        );
        assert_eq!(config.plugins.0["updater"]["pubkey"], "fixture");
    }

    #[test]
    fn macos_updater_target_is_explicit_and_architecture_specific() {
        assert_eq!(
            macos_updater_target("macos", "x86_64"),
            Some("darwin-x86_64")
        );
        assert_eq!(
            macos_updater_target("macos", "aarch64"),
            Some("darwin-aarch64")
        );
        assert_eq!(macos_updater_target("windows", "x86_64"), None);
        assert_eq!(macos_updater_target("macos", "arm"), None);
    }
}

#[cfg(test)]
mod attachment_path_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_ROOT: AtomicU64 = AtomicU64::new(1);

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "hara-desktop-drop-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_TEST_ROOT.fetch_add(1, Ordering::Relaxed),
        ))
    }

    #[test]
    fn dropped_paths_are_bounded_and_classified_without_reading_contents() {
        let root = test_root();
        let folder = root.join("资料");
        let file = root.join("reference image.png");
        fs::create_dir_all(&folder).unwrap();
        fs::write(&file, b"not decoded by the native classifier").unwrap();

        let classified = classify_attachment_paths_inner(vec![
            file.to_string_lossy().into_owned(),
            folder.to_string_lossy().into_owned(),
        ])
        .unwrap();
        assert_eq!(classified[0].kind, "file");
        assert_eq!(classified[1].kind, "directory");
        assert_eq!(classified[0].path, file.to_string_lossy());
        assert_eq!(classified[0].byte_size, Some(36));
        assert_eq!(classified[1].byte_size, None);

        let too_many = (0..=MAX_DROPPED_ATTACHMENT_PATHS)
            .map(|index| root.join(index.to_string()).to_string_lossy().into_owned())
            .collect();
        assert!(classify_attachment_paths_inner(too_many).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pasted_images_use_the_same_authoritative_bound_as_serve() {
        assert!(validate_temp_image_size(MAX_COMPOSER_IMAGE_BYTES).is_ok());
        let error = validate_temp_image_size(MAX_COMPOSER_IMAGE_BYTES + 1).unwrap_err();
        assert!(error.contains("3.6 MB"));
        assert!(error.contains("not sent to the model"));
        assert!(error.contains("OCR fallback"));
        assert!(error.contains("Compress or crop"));
    }

    #[test]
    fn pasted_images_persist_in_the_authorized_desktop_media_surface() {
        let root = test_root();
        let bytes = b"\x89PNG\r\n\x1a\nfixture";
        let path = persist_pasted_image_at(&root, bytes).unwrap();
        let media = root.join("desktop").join("media");

        assert!(path.starts_with(&media));
        assert!(!path.starts_with(root.join("tmp")));
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let metadata = fs::symlink_metadata(&path).unwrap();
        assert!(metadata.is_file());
        assert!(!metadata.file_type().is_symlink());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(metadata.permissions().mode() & 0o077, 0);
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn presentation_images_are_bounded_validated_and_returned_as_data_urls() {
        use base64::Engine;

        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let image_path = root.join("slide.png");
        let png = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
            .unwrap();
        fs::write(&image_path, png).unwrap();

        let data_url = read_presentation_image_at(&image_path).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));

        let invalid = root.join("not-image.png");
        fs::write(&invalid, b"not an image").unwrap();
        assert!(read_presentation_image_at(&invalid).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn presentation_image_links_fail_closed() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let image_path = root.join("slide.png");
        let link = root.join("linked.png");
        fs::write(&image_path, b"not decoded because the link fails first").unwrap();
        symlink(&image_path, &link).unwrap();
        assert!(read_presentation_image_at(&link).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn pasted_image_directory_links_fail_closed() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        let outside = root.with_file_name(format!(
            "{}-outside",
            root.file_name().unwrap().to_string_lossy()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("desktop")).unwrap();

        let error = persist_pasted_image_at(&root, b"\x89PNG\r\n\x1a\nfixture").unwrap_err();
        assert!(error.contains("real directory, not a link"));
        assert!(!outside.join("media").exists());

        fs::remove_file(root.join("desktop")).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn dropped_symbolic_links_fail_closed() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.txt");
        let link = root.join("link.txt");
        fs::write(&target, b"target").unwrap();
        symlink(&target, &link).unwrap();

        let result = classify_attachment_paths_inner(vec![link.to_string_lossy().into_owned()]);
        assert!(result.is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod pet_tests {
    use super::*;

    fn unscaled_work_area(rect: WindowRect) -> DisplayWorkArea {
        DisplayWorkArea {
            rect,
            scale_factor: 1.0,
        }
    }

    #[test]
    fn home_resolution_uses_explicit_home_and_falls_back_to_windows_profile() {
        let home = PathBuf::from("/portable/home");
        let profile = PathBuf::from("/windows/profile");
        for windows in [false, true] {
            assert_eq!(
                resolve_user_home(Some(home.clone()), Some(profile.clone()), windows).unwrap(),
                home
            );
            assert_eq!(
                resolve_user_home(None, Some(profile.clone()), windows).unwrap(),
                profile
            );
            assert_eq!(
                resolve_user_home(Some(PathBuf::new()), Some(profile.clone()), windows).unwrap(),
                profile
            );
            assert!(resolve_user_home(None, None, windows).is_err());
        }
    }

    #[test]
    fn portable_home_normalization_is_platform_parameterized() {
        let cases = [
            ("/c/Users/alice", r"C:\Users\alice"),
            ("/d", r"D:\"),
            ("//server/share/alice", r"\\server\share\alice"),
            ("c:/Users/alice", r"C:\Users\alice"),
            (r"d:\Users/alice", r"D:\Users\alice"),
        ];

        for (input, windows_expected) in cases {
            assert_eq!(
                normalize_portable_home(PathBuf::from(input), true),
                PathBuf::from(windows_expected),
                "Windows normalization failed for {input}"
            );
            assert_eq!(
                normalize_portable_home(PathBuf::from(input), false),
                PathBuf::from(input),
                "non-Windows behavior changed for {input}"
            );
        }

        assert_eq!(
            resolve_user_home(
                Some(PathBuf::from(" /c/Users/alice ")),
                Some(PathBuf::from(r"C:\fallback")),
                true,
            )
            .unwrap(),
            PathBuf::from(r"C:\Users\alice")
        );
    }

    #[test]
    fn bundled_sidecar_name_and_path_are_platform_specific() {
        let app = Path::new("/opt/hara/Hara");
        assert_eq!(
            bundled_sidecar_path(app, false).unwrap(),
            Path::new("/opt/hara/hara")
        );
        assert_eq!(
            bundled_sidecar_path(app, true).unwrap(),
            Path::new("/opt/hara/hara.exe")
        );
        assert_eq!(
            bundled_herdr_path(app, false).unwrap(),
            Path::new("/opt/hara/herdr")
        );
        assert_eq!(
            bundled_herdr_path(app, true).unwrap(),
            Path::new("/opt/hara/herdr.exe")
        );
    }

    #[test]
    fn fallback_sidecar_uses_the_managed_hara_bin_without_a_shell() {
        let unique = format!(
            "hara-desktop-sidecar-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let data = root.join(".hara");
        let sidecar = data.join("bin").join("hara.exe");
        fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
        fs::write(&sidecar, b"test sidecar").unwrap();
        assert_eq!(fallback_sidecar_path(&data, None, true).unwrap(), sidecar);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn desktop_installs_and_refreshes_an_exact_managed_command_line_hara() {
        let unique = format!(
            "hara-desktop-managed-cli-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let app_directory = root.join("app");
        let home = root.join("home");
        let data = home.join(".hara");
        let app = app_directory.join("hara-desktop");
        let bundled = app_directory.join("hara");
        fs::create_dir_all(&app_directory).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(&bundled, b"bundled-cli-v1").unwrap();

        let before = command_line_hara_status_at(&app, &data, false);
        assert!(before.available);
        assert!(!before.installed);
        assert!(!before.current);
        assert!(!before.blocked);

        let installed = synchronize_command_line_hara_at(&app, &data, false).unwrap();
        let destination = data.join("bin").join("hara");
        assert!(installed.current);
        assert!(installed.managed);
        assert_eq!(installed.path, destination.to_string_lossy());
        assert_eq!(fs::read(&destination).unwrap(), b"bundled-cli-v1");
        assert_eq!(installed.bundled_version, BUNDLED_CLI_VERSION.trim());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                fs::metadata(&destination).unwrap().permissions().mode() & 0o111,
                0
            );
            assert_eq!(
                fs::metadata(managed_cli_receipt_path(&data))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o077,
                0
            );
        }

        fs::write(&bundled, b"bundled-cli-v2").unwrap();
        let stale = command_line_hara_status_at(&app, &data, false);
        assert!(stale.installed);
        assert!(stale.managed);
        assert!(!stale.current);
        synchronize_command_line_hara_at(&app, &data, false).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"bundled-cli-v2");
        let refreshed = command_line_hara_status_at(&app, &data, false);
        assert!(refreshed.current);
        assert!(refreshed.managed);
        let staged = fs::read_dir(data.join("bin"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".hara-install-")
            })
            .count();
        assert_eq!(
            staged, 0,
            "successful installation leaves no staged executable"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn automatic_sync_recovers_a_current_bundle_after_receipt_write_was_interrupted() {
        let unique = format!(
            "hara-desktop-managed-cli-receipt-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let app_directory = root.join("app");
        let data = root.join("home").join(".hara");
        let app = app_directory.join("hara-desktop");
        let bundled = app_directory.join("hara");
        fs::create_dir_all(&app_directory).unwrap();
        fs::create_dir_all(data.parent().unwrap()).unwrap();
        fs::write(&bundled, b"bundled-cli-v1").unwrap();

        let installed = install_command_line_hara_at(&app, &data, false).unwrap();
        assert!(installed.current);
        assert!(installed.managed);
        let destination = data.join("bin").join("hara");
        let old_receipt = fs::read(managed_cli_receipt_path(&data)).unwrap();

        // Simulate the durable executable rename completing for the new Desktop, followed by a
        // power loss before the new receipt could replace the old one.
        fs::write(&bundled, b"bundled-cli-v2").unwrap();
        fs::write(&destination, b"bundled-cli-v2").unwrap();
        assert_eq!(
            fs::read(managed_cli_receipt_path(&data)).unwrap(),
            old_receipt
        );
        let interrupted = command_line_hara_status_at(&app, &data, false);
        assert!(interrupted.current);
        assert!(!interrupted.managed);
        assert!(!interrupted.blocked);

        let recovered = synchronize_command_line_hara_at(&app, &data, false).unwrap();
        assert!(recovered.current);
        assert!(recovered.managed);
        assert_eq!(fs::read(&destination).unwrap(), b"bundled-cli-v2");
        assert_ne!(
            fs::read(managed_cli_receipt_path(&data)).unwrap(),
            old_receipt
        );
        let receipt = read_managed_cli_receipt(&data).unwrap().unwrap();
        assert_eq!(receipt.managed_path, destination.to_string_lossy());
        assert_eq!(
            receipt.sha256,
            regular_file_sha256(&destination, "installed command-line Hara")
                .unwrap()
                .unwrap()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn automatic_sync_does_not_adopt_a_current_bundle_without_a_matching_receipt() {
        let unique = format!(
            "hara-desktop-managed-cli-no-receipt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let app_directory = root.join("app");
        let data = root.join("home").join(".hara");
        let app = app_directory.join("hara-desktop");
        let bundled = app_directory.join("hara");
        let destination = data.join("bin").join("hara");
        fs::create_dir_all(&app_directory).unwrap();
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(&bundled, b"trusted-bundle").unwrap();
        fs::write(&destination, b"trusted-bundle").unwrap();

        let unmanaged = synchronize_command_line_hara_at(&app, &data, false).unwrap();
        assert!(unmanaged.current);
        assert!(!unmanaged.managed);
        assert!(!unmanaged.blocked);
        assert!(!managed_cli_receipt_path(&data).exists());
        assert_eq!(fs::read(&destination).unwrap(), b"trusted-bundle");

        let malicious_receipt = ManagedCliReceipt {
            schema_version: MANAGED_CLI_RECEIPT_SCHEMA,
            managed_path: root.join("outside").to_string_lossy().into_owned(),
            bundled_version: BUNDLED_CLI_VERSION.trim().to_string(),
            sha256: regular_file_sha256(&destination, "installed command-line Hara")
                .unwrap()
                .unwrap(),
        };
        fs::write(
            managed_cli_receipt_path(&data),
            serde_json::to_vec(&malicious_receipt).unwrap(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                managed_cli_receipt_path(&data),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
        }

        let still_unmanaged = synchronize_command_line_hara_at(&app, &data, false).unwrap();
        assert!(still_unmanaged.current);
        assert!(!still_unmanaged.managed);
        assert!(!still_unmanaged.blocked);
        assert_eq!(
            read_managed_cli_receipt(&data)
                .unwrap()
                .unwrap()
                .managed_path,
            malicious_receipt.managed_path
        );
        assert_eq!(fs::read(&destination).unwrap(), b"trusted-bundle");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn automatic_sync_never_overwrites_an_unmanaged_or_modified_cli() {
        let unique = format!(
            "hara-desktop-unmanaged-cli-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let app_directory = root.join("app");
        let data = root.join("home").join(".hara");
        let app = app_directory.join("hara-desktop");
        let bundled = app_directory.join("hara");
        let destination = data.join("bin").join("hara");
        fs::create_dir_all(&app_directory).unwrap();
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(&bundled, b"trusted-bundle").unwrap();
        fs::write(&destination, b"user-managed-cli").unwrap();

        let unmanaged = synchronize_command_line_hara_at(&app, &data, false).unwrap();
        assert!(unmanaged.installed);
        assert!(!unmanaged.current);
        assert!(!unmanaged.managed);
        assert_eq!(fs::read(&destination).unwrap(), b"user-managed-cli");
        assert!(!managed_cli_receipt_path(&data).exists());

        let adopted = install_command_line_hara_at(&app, &data, false).unwrap();
        assert!(adopted.current);
        assert!(adopted.managed);
        fs::write(&destination, b"externally-modified-cli").unwrap();

        let modified = synchronize_command_line_hara_at(&app, &data, false).unwrap();
        assert!(modified.installed);
        assert!(!modified.current);
        assert!(!modified.managed);
        assert_eq!(fs::read(&destination).unwrap(), b"externally-modified-cli");

        let repaired = install_command_line_hara_at(&app, &data, false).unwrap();
        assert!(repaired.current);
        assert!(repaired.managed);
        assert_eq!(fs::read(&destination).unwrap(), b"trusted-bundle");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn managed_command_line_hara_rejects_link_destinations() {
        use std::os::unix::fs::symlink;

        let unique = format!(
            "hara-desktop-managed-cli-link-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let app_directory = root.join("app");
        let data = root.join("home").join(".hara");
        let app = app_directory.join("hara-desktop");
        fs::create_dir_all(&app_directory).unwrap();
        fs::create_dir_all(data.join("bin")).unwrap();
        fs::write(app_directory.join("hara"), b"trusted-bundle").unwrap();
        let outside = root.join("outside");
        fs::write(&outside, b"do-not-touch").unwrap();
        symlink(&outside, data.join("bin").join("hara")).unwrap();

        let status = command_line_hara_status_at(&app, &data, false);
        assert!(status.blocked);
        assert!(install_command_line_hara_at(&app, &data, false).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"do-not-touch");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn serve_command_executes_the_sidecar_directly() {
        use std::ffi::OsStr;

        let command = serve_command(
            Path::new("/opt/hara/hara"),
            49152,
            Some(Path::new("/opt/hara/herdr")),
        );
        assert_eq!(command.get_program(), OsStr::new("/opt/hara/hara"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![
                OsStr::new("serve"),
                OsStr::new("--port"),
                OsStr::new("49152")
            ]
        );
        assert!(command.get_envs().any(|(key, value)| {
            key == OsStr::new("HARA_DESKTOP_SIDECAR") && value == Some(OsStr::new("1"))
        }));
        assert!(command.get_envs().any(|(key, value)| {
            key == OsStr::new("HARA_HERDR_PATH") && value == Some(OsStr::new("/opt/hara/herdr"))
        }));
    }

    #[cfg(unix)]
    #[test]
    fn startup_retires_only_the_exact_private_discovery_owner() {
        use std::cell::Cell;
        use std::os::unix::fs::PermissionsExt;

        let unique = format!(
            "hara-desktop-startup-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let directory = root.join(".hara");
        let discovery = directory.join("serve.json");
        fs::create_dir_all(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(&discovery, b"{\"pid\":4242}\n").unwrap();
        fs::set_permissions(&discovery, fs::Permissions::from_mode(0o600)).unwrap();

        let alive = Cell::new(true);
        let terminated = Cell::new(None);
        retire_discovered_serve_at(
            &discovery,
            None,
            |_| alive.get(),
            |pid| {
                terminated.set(Some(pid));
                alive.set(false);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(terminated.get(), Some(4242));
        assert!(!discovery.exists());

        fs::write(&discovery, b"{\"pid\":4243}\n").unwrap();
        fs::set_permissions(&discovery, fs::Permissions::from_mode(0o600)).unwrap();
        let error = retire_discovered_serve_at(
            &discovery,
            None,
            |_| true,
            |pid| {
                Err(format!(
                    "refusing to stop pid {pid}: not a managed Hara engine"
                ))
            },
        )
        .unwrap_err();
        assert!(error.contains("refusing to stop pid 4243"));
        assert!(discovery.exists(), "a refused owner is never removed");

        fs::write(&discovery, b"{\"pid\":4244}\n").unwrap();
        fs::set_permissions(&discovery, fs::Permissions::from_mode(0o600)).unwrap();
        retire_discovered_serve_at(
            &discovery,
            None,
            |_| false,
            |_| panic!("a dead discovery owner must never be signalled"),
        )
        .unwrap();
        assert!(!discovery.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fallback_serve_port_is_loopback_bindable_and_nonzero() {
        let default = std::net::SocketAddr::from(([127, 0, 0, 1], DEFAULT_SERVE_PORT));
        let listener = match std::net::TcpListener::bind(default) {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                // Some local agent sandboxes prohibit even loopback binds. CI and the packaged-app smoke
                // run outside that restriction; keep the rest of the native suite useful in the sandbox.
                return;
            }
            Err(_) => {
                match std::net::TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], 0))) {
                    Ok(listener) => listener,
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return,
                    Err(error) => panic!("reserve occupied-port test listener: {error}"),
                }
            }
        };
        let occupied = listener.local_addr().unwrap().port();
        let selected = if occupied == DEFAULT_SERVE_PORT {
            available_serve_port().unwrap()
        } else {
            // The default may already be owned by another test or local process; the production selector
            // still has to return a usable non-zero loopback port.
            available_serve_port().unwrap()
        };
        assert_ne!(selected, 0);
        if occupied == DEFAULT_SERVE_PORT {
            assert_ne!(selected, DEFAULT_SERVE_PORT);
        }
    }

    #[test]
    fn panel_urls_accept_only_exact_loopback_http_origins_and_declared_ports() {
        assert_eq!(
            parse_local_panel_url("http://127.0.0.1:4321/preview?token=local", Some(4321)),
            Some((
                "http://127.0.0.1:4321/preview?token=local".to_string(),
                4321,
            )),
        );
        assert_eq!(
            parse_local_panel_url("http://localhost:4321/", None),
            Some(("http://localhost:4321/".to_string(), 4321)),
        );
        assert_eq!(
            parse_local_panel_url("http://[::1]:4321/preview", Some(4321)),
            Some(("http://[::1]:4321/preview".to_string(), 4321)),
        );

        for rejected in [
            "http://localhost.evil:4321/",
            "http://127.0.0.1.evil:4321/",
            "https://localhost:4321/",
            "http://user:secret@localhost:4321/",
            "http://localhost/",
            "http://localhost:0/",
            "http://192.168.1.10:4321/",
        ] {
            assert_eq!(parse_local_panel_url(rejected, None), None, "{rejected}");
        }
        assert_eq!(
            parse_local_panel_url("http://localhost:4322/", Some(4321)),
            None,
        );
    }

    #[cfg(unix)]
    #[test]
    fn panel_launch_skips_an_old_path_node_and_remains_repeatable() {
        use std::ffi::OsStr;
        use std::os::unix::fs::{symlink, PermissionsExt};

        let unique = format!(
            "hara-desktop-panel-runtime-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let data = root.join("home").join(".hara");
        let home = root.join("home");
        let plugin_script = data
            .join("plugins")
            .join("design")
            .join("bin")
            .join("hara-design.mjs");
        let old_node = root.join("old-node").join("bin").join("node");
        let supported_node = home
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v22.22.3")
            .join("bin")
            .join("node");
        fs::create_dir_all(plugin_script.parent().unwrap()).unwrap();
        fs::create_dir_all(data.join("bin")).unwrap();
        fs::create_dir_all(old_node.parent().unwrap()).unwrap();
        fs::create_dir_all(supported_node.parent().unwrap()).unwrap();
        fs::write(
            &plugin_script,
            b"#!/usr/bin/env node\nimport { spawn } from 'node:child_process';\n",
        )
        .unwrap();
        fs::write(&old_node, b"#!/bin/sh\necho v11.4.0\n").unwrap();
        fs::write(
            &supported_node,
            b"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo v22.22.3; else echo http://127.0.0.1:4321; fi\n",
        )
        .unwrap();
        for executable in [&plugin_script, &old_node, &supported_node] {
            fs::set_permissions(executable, fs::Permissions::from_mode(0o755)).unwrap();
        }
        symlink(&plugin_script, data.join("bin").join("hara-design")).unwrap();
        let canonical_plugin_script = plugin_script.canonicalize().unwrap();
        let path = std::env::join_paths([old_node.parent().unwrap()]).unwrap();

        for _ in 0..2 {
            let plan = panel_launch_plan(&data, &home, Some(&path), "hara-design", false)
                .expect("a supported NVM runtime should be selected after the old PATH node");
            assert_eq!(
                plan,
                PanelLaunchPlan::Node {
                    runtime: supported_node.clone(),
                    script: canonical_plugin_script.clone(),
                }
            );
            let mut process = panel_process(
                &plan,
                &data,
                &home,
                &["preview".into()],
                Some(root.as_path()),
            )
            .unwrap();
            assert_eq!(process.get_program(), supported_node.as_os_str());
            assert_eq!(
                process.get_args().collect::<Vec<_>>(),
                vec![canonical_plugin_script.as_os_str(), OsStr::new("preview")]
            );
            let output =
                bounded_command_output(&mut process, std::time::Duration::from_secs(2)).unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap().trim(),
                "http://127.0.0.1:4321"
            );
        }

        assert_eq!(parse_node_major(b"v18.20.8\n"), Some(18));
        assert_eq!(parse_node_major(b"11.4.0\n"), None);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn panel_launch_rejects_a_command_link_outside_the_plugin_store() {
        use std::os::unix::fs::symlink;

        let unique = format!(
            "hara-desktop-panel-link-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let data = root.join(".hara");
        let outside = root.join("foreign-panel");
        fs::create_dir_all(data.join("bin")).unwrap();
        fs::create_dir_all(data.join("plugins")).unwrap();
        fs::write(&outside, b"#!/bin/sh\n").unwrap();
        symlink(&outside, data.join("bin").join("foreign")).unwrap();

        assert!(verified_panel_entry(&data, "foreign")
            .unwrap_err()
            .contains("escaped its verified plugin directory"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_restart_marker_is_consumed_exactly_once() {
        let unique = format!(
            "hara-desktop-update-marker-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        let marker = dir.join(UPDATE_RESTART_MARKER);
        assert!(!take_update_restart_marker_at(&marker).unwrap());
        fs::create_dir_all(&dir).unwrap();
        fs::write(&marker, b"unexpected\n").unwrap();
        assert!(take_update_restart_marker_at(&marker).is_err());
        fs::remove_file(&marker).unwrap();
        arm_update_restart_marker_at(&marker).unwrap();
        assert!(take_update_restart_marker_at(&marker).unwrap());
        assert!(!take_update_restart_marker_at(&marker).unwrap());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_restart_prepares_both_markers_atomically_before_process_replacement() {
        let unique = format!(
            "hara-desktop-crash-marker-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        let crash_marker = dir.join("run-current.marker");
        let update_marker = dir.join(UPDATE_RESTART_MARKER);
        fs::write(&crash_marker, b"started\n").unwrap();
        prepare_update_restart_markers_at(&update_marker, &crash_marker).unwrap();
        assert!(!crash_marker.exists());
        assert!(take_update_restart_marker_at(&update_marker).unwrap());

        fs::create_dir(&crash_marker).unwrap();
        assert!(prepare_update_restart_markers_at(&update_marker, &crash_marker).is_err());
        assert!(
            !update_marker.exists(),
            "a failed crash-marker retirement rolls back the update marker"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn process_path_matching_is_exact_case_aware_and_handles_replaced_linux_images() {
        assert!(same_executable_path(
            Path::new("/Applications/Hara.app/Contents/MacOS/hara"),
            Path::new("/Applications/Hara.app/Contents/MacOS/hara"),
            false,
        ));
        assert!(same_executable_path(
            Path::new("/opt/Hara/HARA.EXE"),
            Path::new(r"\opt\hara\hara.exe"),
            true,
        ));
        assert_eq!(
            normalized_process_path(Path::new("/opt/hara (deleted)"), false),
            "/opt/hara"
        );
        assert!(!same_executable_path(
            Path::new("/tmp/hara"),
            Path::new("/opt/hara"),
            false,
        ));
    }

    #[cfg(unix)]
    #[test]
    fn private_discovery_reader_rejects_links_and_non_private_state() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let unique = format!(
            "hara-desktop-discovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let directory = root.join(".hara");
        let discovery = directory.join("serve.json");
        fs::create_dir_all(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(&discovery, b"{\"pid\":1234}\n").unwrap();
        fs::set_permissions(&discovery, fs::Permissions::from_mode(0o600)).unwrap();

        let (_, record) = read_private_discovery_at(&discovery).unwrap();
        assert_eq!(record.pid, 1234);

        let alias = root.join("alias.json");
        fs::hard_link(&discovery, &alias).unwrap();
        assert!(read_private_discovery_at(&discovery).is_err());
        fs::remove_file(&alias).unwrap();

        fs::set_permissions(&discovery, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_private_discovery_at(&discovery).is_err());
        fs::set_permissions(&discovery, fs::Permissions::from_mode(0o600)).unwrap();

        let target = root.join("outside.json");
        fs::write(&target, b"{\"pid\":1234}\n").unwrap();
        fs::remove_file(&discovery).unwrap();
        symlink(&target, &discovery).unwrap();
        assert!(read_private_discovery_at(&discovery).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selector_is_bound_to_one_catalog_child() {
        assert_eq!(selector_parts("hara:mila").unwrap(), ("hara", "mila"));
        assert!(selector_parts("codex:../mila").is_err());
        assert!(selector_parts("codex:nested/mila").is_err());
        assert!(selector_parts("other:mila").is_err());
        assert!(selector_parts("codex:").is_err());
    }

    #[test]
    fn spritesheet_path_rejects_escape_and_absolute_components_before_io() {
        let dir = Path::new("/tmp/does-not-need-to-exist");
        assert!(safe_asset_path(dir, "../secret.webp").is_err());
        assert!(safe_asset_path(dir, "/tmp/secret.webp").is_err());
        assert!(safe_asset_path(dir, "nested/../secret.webp").is_err());
    }

    #[test]
    fn geometry_accepts_codex_v1_and_v2_only() {
        assert_eq!(sprite_geometry(1536, 1872, None).unwrap(), (1, 9));
        assert_eq!(sprite_geometry(1536, 2288, Some(2)).unwrap(), (2, 11));
        assert!(sprite_geometry(1536, 2288, Some(1)).is_err());
        assert!(sprite_geometry(1536, 2000, None).is_err());
    }

    #[test]
    fn only_the_main_window_uses_persistent_native_geometry() {
        assert!(should_track_window_state("main"));
        assert!(!should_track_window_state("pet"));
        assert!(!should_track_window_state("pet-chat"));
    }

    #[test]
    fn visible_window_geometry_is_preserved_across_negative_coordinate_monitors() {
        let work_areas = [
            unscaled_work_area(WindowRect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040,
            }),
            unscaled_work_area(WindowRect {
                x: 0,
                y: 0,
                width: 2560,
                height: 1400,
            }),
        ];
        let window = WindowRect {
            x: -1700,
            y: 100,
            width: 1100,
            height: 760,
        };

        assert_eq!(
            offscreen_window_recovery(window, &work_areas, Some(work_areas[1])),
            None
        );
    }

    #[test]
    fn extension_window_grows_right_when_space_exists_and_shifts_only_when_needed() {
        let work_area = unscaled_work_area(WindowRect {
            x: 0,
            y: 24,
            width: 1920,
            height: 1056,
        });
        assert_eq!(
            extension_window_growth(
                WindowRect {
                    x: 120,
                    y: 80,
                    width: 1100,
                    height: 760
                },
                work_area,
            ),
            Some(WindowRect {
                x: 120,
                y: 80,
                width: 1480,
                height: 760
            }),
        );
        assert_eq!(
            extension_window_growth(
                WindowRect {
                    x: 700,
                    y: 80,
                    width: 1100,
                    height: 760
                },
                work_area,
            ),
            Some(WindowRect {
                x: 440,
                y: 80,
                width: 1480,
                height: 760
            }),
        );
    }

    #[test]
    fn extension_window_never_shrinks_or_exceeds_a_retina_work_area() {
        let retina = DisplayWorkArea {
            rect: WindowRect {
                x: 0,
                y: 48,
                width: 3024,
                height: 1916,
            },
            scale_factor: 2.0,
        };
        assert_eq!(
            extension_window_growth(
                WindowRect {
                    x: 20,
                    y: 80,
                    width: 2200,
                    height: 1520
                },
                retina,
            ),
            Some(WindowRect {
                x: 20,
                y: 80,
                width: 2960,
                height: 1520
            }),
        );
        assert_eq!(
            extension_window_growth(
                WindowRect {
                    x: 0,
                    y: 48,
                    width: 3024,
                    height: 1700
                },
                retina,
            ),
            None,
        );
    }

    #[test]
    fn disconnected_monitor_window_is_centered_on_the_primary_work_area() {
        let primary = unscaled_work_area(WindowRect {
            x: 0,
            y: 24,
            width: 1920,
            height: 1056,
        });
        let offscreen = WindowRect {
            x: 4703,
            y: 788,
            width: 1100,
            height: 760,
        };

        assert_eq!(
            offscreen_window_recovery(offscreen, &[primary], Some(primary)),
            Some(WindowRect {
                x: 410,
                y: 172,
                width: 1100,
                height: 760,
            })
        );
    }

    #[test]
    fn tiny_restored_window_is_recovered_on_its_current_monitor() {
        let secondary = unscaled_work_area(WindowRect {
            x: 1920,
            y: 30,
            width: 2560,
            height: 1050,
        });
        let tiny = WindowRect {
            x: 1936,
            y: 501,
            width: 116,
            height: 109,
        };

        assert_eq!(
            offscreen_window_recovery(tiny, &[secondary], None),
            Some(WindowRect {
                x: 2650,
                y: 175,
                width: DEFAULT_MAIN_WINDOW_WIDTH,
                height: DEFAULT_MAIN_WINDOW_HEIGHT,
            })
        );
    }

    #[test]
    fn oversized_restored_window_uses_the_monitor_with_the_largest_overlap() {
        let primary = unscaled_work_area(WindowRect {
            x: 0,
            y: 30,
            width: 1920,
            height: 1050,
        });
        let secondary = unscaled_work_area(WindowRect {
            x: 1920,
            y: 30,
            width: 2560,
            height: 1050,
        });
        let oversized = WindowRect {
            x: 688,
            y: 62,
            width: 3708,
            height: 1826,
        };

        assert_eq!(
            offscreen_window_recovery(oversized, &[primary, secondary], Some(primary)),
            Some(WindowRect {
                x: 2650,
                y: 175,
                width: DEFAULT_MAIN_WINDOW_WIDTH,
                height: DEFAULT_MAIN_WINDOW_HEIGHT,
            })
        );
    }

    #[test]
    fn retina_single_axis_oversize_resets_both_logical_dimensions() {
        let retina = DisplayWorkArea {
            rect: WindowRect {
                x: 0,
                y: 62,
                width: 3024,
                height: 1964,
            },
            scale_factor: 2.0,
        };
        let stale = WindowRect {
            x: 2740,
            y: 62,
            width: 4080,
            height: 1964,
        };

        assert_eq!(
            offscreen_window_recovery(stale, &[retina], Some(retina)),
            Some(WindowRect {
                x: 412,
                y: 284,
                width: DEFAULT_MAIN_WINDOW_WIDTH * 2,
                height: DEFAULT_MAIN_WINDOW_HEIGHT * 2,
            })
        );
    }

    #[test]
    fn edge_touch_without_visible_overlap_is_recovered() {
        let primary = unscaled_work_area(WindowRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        });
        let offscreen = WindowRect {
            x: 1920,
            y: 100,
            width: 800,
            height: 600,
        };

        assert!(offscreen_window_recovery(offscreen, &[primary], Some(primary)).is_some());
    }

    #[test]
    fn oversized_or_zero_sized_offscreen_windows_recover_to_safe_dimensions() {
        let primary = unscaled_work_area(WindowRect {
            x: -1280,
            y: -200,
            width: 1280,
            height: 720,
        });
        assert_eq!(
            offscreen_window_recovery(
                WindowRect {
                    x: 5000,
                    y: 5000,
                    width: 5000,
                    height: 4000,
                },
                &[primary],
                Some(primary),
            ),
            Some(WindowRect {
                x: -1190,
                y: -200,
                width: DEFAULT_MAIN_WINDOW_WIDTH,
                height: 720,
            })
        );
        assert_eq!(
            offscreen_window_recovery(
                WindowRect {
                    x: 5000,
                    y: 5000,
                    width: 0,
                    height: 0,
                },
                &[primary],
                Some(primary),
            ),
            Some(WindowRect {
                x: -1190,
                y: -200,
                width: 1100,
                height: 720,
            })
        );
    }

    #[test]
    fn recovery_falls_back_to_an_available_monitor_and_never_invents_one() {
        let secondary = unscaled_work_area(WindowRect {
            x: 1920,
            y: -100,
            width: 1600,
            height: 900,
        });
        let offscreen = WindowRect {
            x: -9000,
            y: -9000,
            width: 800,
            height: 600,
        };

        assert_eq!(
            offscreen_window_recovery(offscreen, &[secondary], None),
            Some(WindowRect {
                x: 2320,
                y: 50,
                width: 800,
                height: 600,
            })
        );
        assert_eq!(offscreen_window_recovery(offscreen, &[], None), None);
    }
}
