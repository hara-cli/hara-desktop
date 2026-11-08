//! Narrow bridge: only opaque, Core-registered media IDs. No renderer-selected path, root, port,
//! transport credential or generic asset protocol. Loopback requests never use the AI proxy.
use std::sync::Mutex;
use tauri::http::{Request, Response};
use tauri_plugin_opener::OpenerExt;
const MAX_BYTES: usize = 8 * 1024 * 1024;
#[derive(Clone)]
struct Connection { port: u16, token: String }
static CONNECTION: Mutex<Option<Connection>> = Mutex::new(None);
pub(super) fn remember(port: u16, token: &str) {
    if port == 0 || !valid_id(token) { return; }
    if let Ok(mut connection) = CONNECTION.lock() { *connection = Some(Connection { port, token: token.into() }); }
}
fn valid_id(id: &str) -> bool { id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) }
fn request_id(request: &Request<Vec<u8>>) -> Option<&str> {
    if !matches!(request.method().as_str(), "GET" | "HEAD") || request.uri().query().is_some() { return None; }
    let authority = request.uri().authority()?.as_str();
    if !matches!((request.uri().scheme_str()?, authority), ("hara-media", "localhost") | ("http" | "https", "hara-media.localhost")) { return None; }
    let id = request.uri().path().strip_prefix('/')?;
    valid_id(id).then_some(id)
}
fn unavailable() -> Response<Vec<u8>> { Response::builder().status(404).header("Cache-Control", "no-store").body(Vec::new()).unwrap() }
async fn fetch(id: &str, suffix: &str, method: &str, range: Option<&str>) -> Result<reqwest::Response, ()> {
    if !valid_id(id) { return Err(()); }
    let connection = CONNECTION.lock().map_err(|_| ())?.clone().ok_or(())?;
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(2)).timeout(std::time::Duration::from_secs(10)).build().map_err(|_| ())?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| ())?;
    let mut request = client.request(method, format!("http://127.0.0.1:{}/workspace-media/{id}{suffix}", connection.port))
        .bearer_auth(connection.token);
    if let Some(range) = range { if range.len() > 100 { return Err(()); } request = request.header("Range", range); }
    request.send().await.map_err(|_| ())
}
async fn bounded_body(response: &mut reqwest::Response, limit: usize) -> Result<Vec<u8>, ()> {
    if response.content_length().is_some_and(|length| length > limit as u64) { return Err(()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? { if bytes.len() + chunk.len() > limit { return Err(()); } bytes.extend_from_slice(&chunk); }
    Ok(bytes)
}
pub(super) async fn response(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(id) = request_id(&request) else { return unavailable(); };
    let range = request.headers().get("Range").and_then(|value| value.to_str().ok());
    let Ok(mut source) = fetch(id, "", request.method().as_str(), range).await else { return unavailable(); };
    if !matches!(source.status().as_u16(), 200 | 206) { return unavailable(); }
    let mime = source.headers().get("Content-Type").and_then(|value| value.to_str().ok()).unwrap_or("");
    if !matches!(mime, "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "video/mp4" | "video/quicktime" | "video/webm") { return unavailable(); }
    let mut response = Response::builder().status(source.status().as_u16()).header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff").header("Access-Control-Allow-Origin", "*");
    for name in ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"] {
        if let Some(value) = source.headers().get(name) { response = response.header(name, value); }
    }
    let Ok(bytes) = bounded_body(&mut source, MAX_BYTES).await else { return unavailable(); };
    response.body(bytes).unwrap_or_else(|_| unavailable())
}
#[tauri::command]
pub(super) async fn workspace_media_reveal(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut response = fetch(&id, "/path", "GET", None).await.map_err(|_| "Media unavailable")?;
    if response.status() != 200 { return Err("Media unavailable".into()); }
    let bytes = bounded_body(&mut response, 8192).await.map_err(|_| "Media unavailable")?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "Media unavailable")?;
    let path = value["path"].as_str().filter(|value| std::path::Path::new(value).is_absolute()).ok_or("Media unavailable")?;
    app.opener().reveal_item_in_dir(path).map_err(|_| "Cannot show media in Finder".into())
}
// User-clicked file opening is limited to the same Core registrations and closed passive extensions.
fn file_path_still_regular(path: &std::path::Path) -> bool {
    let Ok(info) = std::fs::symlink_metadata(path) else { return false; };
    if !info.is_file() || info.file_type().is_symlink() { return false; }
    #[cfg(unix)] { use std::os::unix::fs::MetadataExt;
        if info.nlink() != 1 || std::fs::canonicalize(path).ok().as_deref() != Some(path) { return false; }
    }
    true
}
#[tauri::command]
pub(super) async fn workspace_file_open(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut source = fetch(&id, "/path", "GET", None).await.map_err(|_| "File unavailable")?;
    if source.status() != 200 { return Err("File unavailable".into()); }
    let bytes = bounded_body(&mut source, 8192).await.map_err(|_| "File unavailable")?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "File unavailable")?;
    let path = value["path"].as_str().filter(|path| std::path::Path::new(path).is_absolute()).ok_or("File unavailable")?;
    let ext = std::path::Path::new(path).extension().and_then(|part| part.to_str()).unwrap_or("").to_ascii_lowercase();
    let expected = match ext.as_str() { "pdf" => "application/pdf", "zip" => "application/zip", "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "md" => "text/markdown", "txt" => "text/plain", _ => return Err("File unavailable".into()) };
    let head = fetch(&id, "", "HEAD", None).await.map_err(|_| "File unavailable")?;
    if head.status() != 200 || head.headers().get("Content-Type").and_then(|value| value.to_str().ok()) != Some(expected) { return Err("File unavailable".into()); }
    if !file_path_still_regular(std::path::Path::new(path)) { return Err("File unavailable".into()); }
    app.opener().open_path(path, None::<&str>).map_err(|_| "Cannot open file".into())
}
// All writes require a native Save dialog. The renderer can supply neither a destination nor a root.
fn safe_destination(path: &std::path::Path, extensions: &[&str]) -> bool {
    let forbidden = [".hara", ".codex", ".claude", ".gemini", ".ssh", "Keychains"];
    path.is_absolute() && !path.components().any(|part| forbidden.iter().any(|name| part.as_os_str().to_string_lossy().eq_ignore_ascii_case(name)))
        && path.extension().and_then(|part| part.to_str()).is_some_and(|ext| extensions.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
        && match std::fs::symlink_metadata(path) { Ok(meta) => meta.is_file() && !meta.file_type().is_symlink(), Err(error) => error.kind() == std::io::ErrorKind::NotFound }
}
#[cfg(unix)]
fn save_in_directory(directory: &std::fs::File, name: &std::ffi::OsStr, bytes: &[u8]) -> Result<(), String> {
    use std::{ffi::CString, io::Write, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}};
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Cannot save file")?.as_nanos();
    let temporary = CString::new(format!(".hara-download-{}-{stamp}.part", std::process::id())).map_err(|_| "Cannot save file")?;
    let destination = CString::new(name.as_bytes()).map_err(|_| "Cannot save file")?;
    // Both publication and cleanup are relative to the verified directory descriptor. Replacing
    // an ancestor with a symlink cannot redirect the Host's write into a protected runtime Home.
    let raw = unsafe { libc::openat(directory.as_raw_fd(), temporary.as_ptr(), libc::O_CREAT | libc::O_EXCL | libc::O_WRONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
    if raw < 0 { return Err("Cannot save file".into()); }
    let mut output = unsafe { std::fs::File::from_raw_fd(raw) };
    let identity = output.metadata().map_err(|_| "Cannot verify save file")?;
    let same_temporary = || { let mut info = std::mem::MaybeUninit::<libc::stat>::uninit();
        let ok = unsafe { libc::fstatat(directory.as_raw_fd(), temporary.as_ptr(), info.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } == 0;
        ok && { let info = unsafe { info.assume_init() }; info.st_dev as u64 == identity.dev() && info.st_ino as u64 == identity.ino() } };
    let result = (|| { output.write_all(bytes).map_err(|_| "Cannot save file")?; output.sync_all().map_err(|_| "Cannot save file")?;
        if !same_temporary() { return Err("Save location changed"); }
        if unsafe { libc::renameat(directory.as_raw_fd(), temporary.as_ptr(), directory.as_raw_fd(), destination.as_ptr()) } != 0 { return Err("Cannot save file"); } Ok(()) })();
    if result.is_err() && same_temporary() { unsafe { libc::unlinkat(directory.as_raw_fd(), temporary.as_ptr(), 0); } }
    result.map_err(str::to_string)
}
fn atomic_save(path: &std::path::Path, bytes: &[u8], extensions: &[&str]) -> Result<(), String> {
    if !safe_destination(path, extensions) { return Err("Cannot save at this location".into()); }
    let parent = path.parent().and_then(|value| std::fs::canonicalize(value).ok()).ok_or("Cannot save at this location")?;
    let destination = parent.join(path.file_name().ok_or("Cannot save at this location")?);
    if !safe_destination(&destination, extensions) { return Err("Cannot save at this location".into()); }
    #[cfg(unix)] {
        use std::os::unix::fs::{OpenOptionsExt, MetadataExt};
        use std::os::fd::AsRawFd;
        let expected = std::fs::symlink_metadata(&parent).map_err(|_| "Cannot save at this location")?;
        let directory = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC).open(&parent).map_err(|_| "Cannot save at this location")?;
        let opened = directory.metadata().map_err(|_| "Cannot save at this location")?;
        if !opened.is_dir() || expected.dev() != opened.dev() || expected.ino() != opened.ino() { return Err("Save location changed".into()); }
        #[cfg(target_os = "macos")] {
            use std::os::unix::ffi::OsStrExt;
            let mut buffer = vec![0u8; libc::PATH_MAX as usize];
            if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) } != 0 { return Err("Cannot verify save location".into()); }
            let end = buffer.iter().position(|byte| *byte == 0).ok_or("Cannot verify save location")?;
            if std::path::Path::new(std::ffi::OsStr::from_bytes(&buffer[..end])) != parent { return Err("Save location changed".into()); }
        }
        #[cfg(target_os = "linux")]
        if std::fs::read_link(format!("/proc/self/fd/{}", directory.as_raw_fd())).map_err(|_| "Cannot verify save location")? != parent { return Err("Save location changed".into()); }
        return save_in_directory(&directory, path.file_name().ok_or("Cannot save file")?, bytes);
    }
    #[cfg(not(unix))] {
        use std::io::Write;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Cannot save file")?.as_nanos();
        let temporary = parent.join(format!(".hara-download-{}-{stamp}.part", std::process::id()));
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Cannot save file")?;
        let result = (|| { output.write_all(bytes).map_err(|_| "Cannot save file")?; output.sync_all().map_err(|_| "Cannot save file")?;
            if !safe_destination(&destination, extensions) { return Err("Cannot save at this location"); }
            std::fs::rename(&temporary, &destination).map_err(|_| "Cannot save file") })();
        drop(output); if result.is_err() { let _ = std::fs::remove_file(&temporary); } result.map_err(str::to_string)
    }
}
async fn selected_destination(app: tauri::AppHandle, name: String, extensions: Vec<String>) -> Result<Option<std::path::PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || { let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        app.dialog().file().add_filter("File", &extensions).set_file_name(name).blocking_save_file()
            .map(|value| value.into_path().map_err(|_| "Cannot save at this location".to_string())).transpose()
    }).await.map_err(|_| "Save dialog unavailable".to_string())?
}
#[tauri::command]
pub(super) async fn workspace_media_download(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let mut metadata = fetch(&id, "/path", "GET", None).await.map_err(|_| "Media unavailable")?;
    if metadata.status() != 200 { return Err("Media unavailable".into()); }
    let body = bounded_body(&mut metadata, 8192).await.map_err(|_| "Media unavailable")?;
    let value: serde_json::Value = serde_json::from_slice(&body).map_err(|_| "Media unavailable")?;
    let path = value["path"].as_str().filter(|value| std::path::Path::new(value).is_absolute()).ok_or("Media unavailable")?;
    let source_path = std::path::Path::new(path);
    let name = source_path.file_name().and_then(|name| name.to_str()).ok_or("Media unavailable")?.to_string();
    let head = fetch(&id, "", "HEAD", None).await.map_err(|_| "Media unavailable")?;
    if !matches!(head.status().as_u16(), 200 | 206) { return Err("Media unavailable".into()); }
    let mime = head.headers().get("Content-Type").and_then(|value| value.to_str().ok()).ok_or("Media unavailable")?.to_string();
    let extensions = match mime.as_str() { "image/png" => vec!["png"], "image/jpeg" => vec!["jpg", "jpeg"], "image/gif" => vec!["gif"], "image/webp" => vec!["webp"],
        "video/mp4" => vec!["mp4", "m4v"], "video/quicktime" => vec!["mov"], "video/webm" => vec!["webm"], _ => return Err("Media unavailable".into()) };
    let total = head.headers().get("Content-Range").and_then(|value| value.to_str().ok()).and_then(|value| value.rsplit('/').next()).and_then(|value| value.parse::<usize>().ok())
        .or_else(|| head.content_length().and_then(|value| usize::try_from(value).ok())).filter(|value| *value > 0 && *value <= 256 * 1024 * 1024).ok_or("Media unavailable")?;
    let selected = selected_destination(app, name, extensions.iter().map(|value| value.to_string()).collect()).await?;
    let Some(selected) = selected else { return Ok(false); };
    let mut bytes = Vec::with_capacity(total);
    while bytes.len() < total {
        let start = bytes.len(); let end = (start + MAX_BYTES).min(total) - 1; let range = format!("bytes={start}-{end}");
        let mut response = fetch(&id, "", "GET", Some(&range)).await.map_err(|_| "Media unavailable")?;
        if response.status() != 206 || response.headers().get("Content-Type").and_then(|value| value.to_str().ok()) != Some(mime.as_str())
            || response.headers().get("Content-Range").and_then(|value| value.to_str().ok()) != Some(format!("bytes {start}-{end}/{total}").as_str()) { return Err("Media unavailable".into()); }
        let chunk = bounded_body(&mut response, MAX_BYTES).await.map_err(|_| "Media unavailable")?;
        if chunk.len() != end - start + 1 { return Err("Media unavailable".into()); } bytes.extend_from_slice(&chunk);
    }
    atomic_save(&selected, &bytes, &extensions)?; Ok(true)
}
#[tauri::command]
pub(super) async fn workspace_export_conversation(app: tauri::AppHandle, text: String) -> Result<bool, String> {
    if text.is_empty() || text.len() > MAX_BYTES { return Err("Conversation export unavailable".into()); }
    let selected = selected_destination(app, "Conversation.md".into(), vec!["md".into(), "txt".into()]).await?;
    let Some(selected) = selected else { return Ok(false); };
    atomic_save(&selected, text.as_bytes(), &["md", "txt"])?; Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn native_save_ancestor_replacement_stays_in_the_selected_directory() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("hara-native-save-dir-{}", std::process::id()));
        assert!(!root.exists()); std::fs::create_dir(&root).unwrap();
        let selected = root.join("selected"); let retained = root.join("retained"); let protected = root.join(".hara");
        std::fs::create_dir(&selected).unwrap(); std::fs::create_dir(&protected).unwrap();
        let directory = std::fs::File::open(&selected).unwrap(); std::fs::rename(&selected, &retained).unwrap(); symlink(&protected, &selected).unwrap();
        save_in_directory(&directory, std::ffi::OsStr::new("fixture.md"), b"Synthetic verified bytes").unwrap();
        assert_eq!(std::fs::read(retained.join("fixture.md")).unwrap(), b"Synthetic verified bytes"); assert!(!protected.join("fixture.md").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn native_save_rejects_private_paths_extensions_and_aliases_and_preserves_bytes() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("hara-save-{}-{stamp}", std::process::id())); std::fs::create_dir(&root).unwrap();
        let output = root.join("Conversation.md"); atomic_save(&output, b"synthetic conversation", &["md"]).unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"synthetic conversation");
        atomic_save(&output, b"explicit replacement", &["md"]).unwrap(); assert_eq!(std::fs::read(&output).unwrap(), b"explicit replacement");
        assert!(atomic_save(&root.join("auth.json"), b"no", &["md"]).is_err()); assert!(!root.join("auth.json").exists());
        let private = root.join(".hara"); std::fs::create_dir(&private).unwrap(); assert!(atomic_save(&private.join("report.md"), b"no", &["md"]).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(&output, root.join("link.md")).unwrap();
            assert!(atomic_save(&root.join("link.md"), b"must not overwrite", &["md"]).is_err()); assert_eq!(std::fs::read(&output).unwrap(), b"explicit replacement");
            std::os::unix::fs::symlink(&private, root.join("alias")).unwrap();
            assert!(atomic_save(&root.join("alias/report.md"), b"no", &["md"]).is_err()); assert!(!private.join("report.md").exists());
        }
        assert!(!safe_destination(std::path::Path::new("relative.md"), &["md"]));
        assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".part")));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test] fn opaque_media_routes_reject_paths_queries_and_other_authorities() {
        let id = "a".repeat(64);
        for uri in [format!("hara-media://localhost/{id}"), format!("http://hara-media.localhost/{id}")] {
            assert_eq!(request_id(&Request::builder().uri(uri).body(vec![]).unwrap()), Some(id.as_str()));
        }
        for uri in ["hara-media://localhost/../../etc/passwd".into(), format!("hara-media://localhost/{id}?path=/etc/passwd"),
            format!("hara-media://evil/{id}"), format!("https://evil/{id}"), format!("hara-media://localhost/%61{id}"), format!("hara-media://localhost/{id}/path")] {
            assert!(request_id(&Request::builder().uri(uri).body(vec![]).unwrap()).is_none());
        }
        assert!(request_id(&Request::builder().method("POST").uri(format!("hara-media://localhost/{id}")).body(vec![]).unwrap()).is_none());
        assert!(!valid_id(&"A".repeat(64))); assert!(!valid_id("/Users/person/file.gif"));
    }
    // `remember` sets the process-wide media connection. Tests that point it at their own loopback
    // fixture must not interleave (cargo runs tests in parallel), or one test's request reaches the
    // other's fixture and its own listener waits forever.
    static SERVED: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn served(response: Vec<u8>, range: Option<&str>, head: bool) -> Response<Vec<u8>> {
        use std::io::{Read, Write};
        let _serial = SERVED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let port = server.local_addr().unwrap().port();
        let token = "b".repeat(64); remember(port, &token);
        let expected_range = range.map(str::to_string);
        let thread = std::thread::spawn(move || {
            // Bounded accept: a request that never arrives fails within 10s instead of hanging the suite.
            server.set_nonblocking(true).unwrap(); let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let mut socket = loop {
                match server.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(10)),
                    Err(error) => panic!("media fixture on port {port} received no request within 10s: {error:?}"),
                }
            };
            socket.set_nonblocking(false).unwrap(); socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut request = Vec::new(); let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") { assert_eq!(socket.read(&mut byte).unwrap(), 1); request.push(byte[0]); assert!(request.len() < 8192); }
            let request = String::from_utf8(request).unwrap().to_lowercase();
            assert!(request.contains(&format!("authorization: bearer {token}")));
            if let Some(range) = expected_range { assert!(request.contains(&format!("range: {range}"))); }
            socket.write_all(&response).unwrap();
        });
        let mut request = Request::builder().method(if head { "HEAD" } else { "GET" }).uri(format!("hara-media://localhost/{}", "a".repeat(64)));
        if let Some(range) = range { request = request.header("Range", range); }
        let response = tauri::async_runtime::block_on(super::response(request.body(vec![]).unwrap())); thread.join().unwrap(); response
    }
    #[test] fn native_media_bridge_preserves_bytes_ranges_and_head_without_exposing_transport_credentials() {
        let response = served(b"HTTP/1.1 206 Partial Content\r\nContent-Type: image/gif\r\nContent-Length: 6\r\nContent-Range: bytes 0-5/34\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\nGIF89a".to_vec(), Some("bytes=0-5"), false);
        assert_eq!(response.status(), 206); assert_eq!(response.body(), b"GIF89a");
        assert_eq!(response.headers()["Content-Range"], "bytes 0-5/34"); assert!(!response.headers().contains_key("Authorization"));
        let head = served(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 34\r\nConnection: close\r\n\r\n".to_vec(), None, true);
        assert_eq!(head.status(), 200); assert!(head.body().is_empty()); assert_eq!(head.headers()["Content-Length"], "34");
    }
    #[test] fn native_media_bridge_rejects_active_document_mime_and_oversized_responses() {
        assert_eq!(served(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(), None, false).status(), 404);
        let large = format!("HTTP/1.1 200 OK\r\nContent-Type: image/gif\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_BYTES + 1);
        assert_eq!(served(large.into_bytes(), None, false).status(), 404);
    }

    #[test] fn file_open_rechecks_regular_identity_before_the_os_opener() {
        let root = std::env::temp_dir().join(format!("hara-file-open-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap(); let root = std::fs::canonicalize(root).unwrap(); let file = root.join("fixture.md");
        std::fs::write(&file, b"Synthetic file").unwrap(); assert!(super::file_path_still_regular(&file)); assert!(!super::file_path_still_regular(&root));
        #[cfg(unix)] {
            let link = root.join("alias.md"); std::os::unix::fs::symlink(&file, &link).unwrap(); assert!(!super::file_path_still_regular(&link));
            let hard = root.join("hard.md"); std::fs::hard_link(&file, &hard).unwrap(); assert!(!super::file_path_still_regular(&hard));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

}
