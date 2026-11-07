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
#[cfg(test)]
mod tests {
    use super::*;
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
    fn served(response: Vec<u8>, range: Option<&str>, head: bool) -> Response<Vec<u8>> {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let port = server.local_addr().unwrap().port();
        let token = "b".repeat(64); remember(port, &token);
        let expected_range = range.map(str::to_string);
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap(); socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
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

}
