//! Build-time channel routing. A release can never pick an arbitrary endpoint at runtime.
pub const STABLE: &str = "https://assets.nanhara.com/hara/desktop/stable/latest.json";
pub const CANDIDATE: &str = "https://assets.nanhara.com/hara/desktop/candidate/latest.json";
pub const GITHUB: &str = "https://github.com/hara-cli/hara-desktop/releases/latest/download/latest.json";

pub fn channel() -> &'static str { option_env!("HARA_DESKTOP_UPDATE_CHANNEL").unwrap_or("stable") }
pub fn endpoints(channel: &str) -> Result<Vec<String>, String> {
    match channel {
        "candidate" => Ok(vec![CANDIDATE.into()]),
        "stable" => Ok(vec![STABLE.into(), GITHUB.into()]),
        _ => Err("Unsupported Hara update channel".into()),
    }
}
pub fn test_endpoint(value: &str) -> Result<String, String> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid local updater fixture")?;
    if url.scheme() != "http" || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || url.port().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Updater fixture must use explicit loopback HTTP".into());
    }
    Ok(url.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn stable_and_candidate_never_cross_channels() {
        assert_eq!(endpoints("stable").unwrap(), vec![STABLE, GITHUB]);
        assert_eq!(endpoints("candidate").unwrap(), vec![CANDIDATE]);
        assert!(endpoints("preview").is_err());
    }
    #[test] fn fixture_override_is_loopback_only() {
        assert!(test_endpoint("http://127.0.0.1:4321/latest.json").is_ok());
        for value in ["https://example.com/latest.json", "http://127.0.0.1/latest.json", "http://user@localhost:80/feed", "http://localhost.evil:80/feed"] { assert!(test_endpoint(value).is_err()); }
    }
}
