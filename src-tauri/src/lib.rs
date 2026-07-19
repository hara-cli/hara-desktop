// hara-desktop Rust host — deliberately THIN. The agent core lives in `hara serve` (hara-cli); the
// desktop is a WebSocket JSON-RPC client rendered in the webview. Rust only does what the webview
// can't: read the serve discovery file and spawn the server.
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

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
    if record.pid <= 1 {
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

fn fallback_sidecar_path(
    data_directory: &Path,
    path_environment: Option<&std::ffi::OsStr>,
    windows: bool,
) -> Option<PathBuf> {
    let name = bundled_sidecar_name(windows);
    let managed = data_directory.join("bin").join(name);
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

/// One-time bridge for engines that predate authenticated `server.shutdown`. The renderer supplies only
/// the pid it already authenticated to; native code independently reopens the private record and refuses
/// to signal anything except a Desktop-bundled, managed, or absolute-PATH `hara` executable.
#[tauri::command]
fn terminate_legacy_serve(expected_pid: u32) -> Result<(), String> {
    let path = discovery_path()?;
    let (raw, record) = read_private_discovery_at(&path)?;
    if record.pid != expected_pid {
        return Err("the running Hara engine changed; reconnect before restarting it".into());
    }
    terminate_verified_legacy_process(record.pid)?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while process_is_alive(record.pid) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    if process_is_alive(record.pid) {
        return Err("legacy Hara engine did not stop within 5 seconds".into());
    }

    // A graceful old engine normally removes its own record. Windows legacy termination cannot, so remove
    // only the exact owner-only contents we opened before signalling; never unlink a replacement instance.
    if let Ok((current, _)) = read_private_discovery_at(&path) {
        if current == raw {
            fs::remove_file(&path)
                .map_err(|error| format!("remove retired serve discovery: {error}"))?;
        }
    }
    Ok(())
}

fn serve_command(executable: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(executable);
    command.arg("serve");
    command
}

fn spawn_serve_process(executable: &Path, log_path: &Path) -> Result<u32, String> {
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

    let mut command = serve_command(executable);
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
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|executable| bundled_sidecar_path(&executable, cfg!(windows)))
        .filter(|sidecar| sidecar.is_file());
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
    let pid = spawn_serve_process(&executable, &log_path)?;
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
    let dir = hara_data_dir()?.join("tmp");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!(
        "paste-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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

fn take_update_restart_marker_at(marker: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("inspect update restart marker: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 128 {
        return Err("update restart marker is invalid".into());
    }
    fs::remove_file(marker).map_err(|e| format!("consume update restart marker: {e}"))?;
    Ok(true)
}

fn update_restart_marker(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(UPDATE_RESTART_MARKER))
        .map_err(|e| format!("resolve app data directory: {e}"))
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
    arm_update_restart_marker_at(&update_restart_marker(&app)?)?;
    app.restart();
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
    let plugin_bin = hara_data_dir()?
        .join("bin")
        .to_string_lossy()
        .replace('\'', "'\\''");
    let script = format!("export PATH='{plugin_bin}':$PATH; {cd}{command} {joined} 2>&1");
    let out = std::process::Command::new("/bin/zsh")
        .args(["-lc", &script])
        .output()
        .map_err(|e| format!("spawn: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    match text
        .split_whitespace()
        .find(|w| w.starts_with("http://127.0.0.1") || w.starts_with("http://localhost"))
    {
        Some(url) => {
            // ownership: we only claim (and later kill) a server when the hinted port was NOT
            // listening before we ran the command and the URL confirms that same port came up
            if let Some(hint) = port_hint {
                let actual: Option<u16> = url
                    .rsplit(':')
                    .next()
                    .and_then(|r| r.split('/').next())
                    .and_then(|p| p.parse().ok());
                if !pre_listening && actual == Some(hint) {
                    let mut owned = state.0.lock().unwrap();
                    if !owned.contains(&hint) {
                        owned.push(hint);
                    }
                }
            }
            Ok(url.to_string())
        }
        None => Err(format!(
            "panel command printed no URL: {}",
            text.chars().take(300).collect::<String>()
        )),
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
        .invoke_handler(tauri::generate_handler![
            read_discovery,
            start_serve,
            terminate_legacy_serve,
            start_panel,
            get_home,
            read_serve_log,
            set_badge,
            take_update_restart_marker,
            restart_after_update,
            write_temp_image,
            list_pets,
            read_pet_asset
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // app exit: terminate the panel servers WE started (never a server the user had running)
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                let ports = app
                    .state::<OwnedPanels>()
                    .0
                    .lock()
                    .map(|v| v.clone())
                    .unwrap_or_default();
                kill_owned_panels(&ports);
            }
        });
}

#[cfg(test)]
mod pet_tests {
    use super::*;

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
    fn serve_command_executes_the_sidecar_directly() {
        use std::ffi::OsStr;

        let command = serve_command(Path::new("/opt/hara/hara"));
        assert_eq!(command.get_program(), OsStr::new("/opt/hara/hara"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![OsStr::new("serve")]
        );
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
        arm_update_restart_marker_at(&marker).unwrap();
        assert!(take_update_restart_marker_at(&marker).unwrap());
        assert!(!take_update_restart_marker_at(&marker).unwrap());
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
}
