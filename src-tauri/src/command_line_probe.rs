//! Read-only, on-demand CLI diagnostics. Never modify PATH or another installation.
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_PROBE_BYTES: usize = 64 * 1024;
const PATH_MARKER: &str = "__HARA_TERMINAL_PATH__";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalHaraStatus {
    path: Option<String>,
    version: Option<String>,
    uses_managed_cli: bool,
    path_source: &'static str,
}

// Capture bounded output off the UI thread, with a deadline even if a descendant keeps a pipe
// open. Unix probes get their own process group so a stalled shell cannot leave children behind.
fn probe_output(command: &mut Command, timeout: Duration) -> Option<Vec<u8>> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut pipe = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = pipe.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let retained = count.min(MAX_PROBE_BYTES.saturating_sub(output.len()));
            output.extend_from_slice(&buffer[..retained]);
        }
        let _ = sender.send(output);
    });
    let started = Instant::now();
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(exit_status)) => break Some(exit_status),
            Err(_) => break None,
            _ if started.elapsed() >= timeout => break None,
            _ => std::thread::sleep(Duration::from_millis(10)),
        }
    };
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    if exit_status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let output = receiver.recv_timeout(Duration::from_millis(100)).ok();
    exit_status.filter(|code| code.success()).and(output)
}

fn parse_shell_path(output: &[u8]) -> Option<OsString> {
    let output = std::str::from_utf8(output).ok()?;
    let value = output
        .lines()
        .find_map(|line| line.strip_prefix(PATH_MARKER))?;
    (!value.is_empty()).then(|| OsString::from(value))
}

fn configured_login_shell() -> Option<PathBuf> {
    if let Some(shell) = std::env::var_os("SHELL").filter(|shell| !shell.is_empty()) {
        return Some(PathBuf::from(shell));
    }
    // Finder/Launchpad processes may not inherit SHELL. Read the configured account shell
    // rather than inventing /bin/zsh or claiming the GUI environment is the terminal's PATH.
    #[cfg(unix)]
    {
        let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result = std::ptr::null_mut();
        let mut buffer = vec![0_u8; MAX_PROBE_BYTES];
        let code = unsafe {
            libc::getpwuid_r(
                libc::geteuid(),
                &mut entry,
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &mut result,
            )
        };
        if code == 0 && !result.is_null() && !entry.pw_shell.is_null() {
            use std::os::unix::ffi::OsStrExt;
            let value = unsafe { std::ffi::CStr::from_ptr(entry.pw_shell) };
            if !value.to_bytes().is_empty() {
                return Some(PathBuf::from(OsStr::from_bytes(value.to_bytes())));
            }
        }
    }
    None
}

fn login_shell_path(home: &Path) -> Option<OsString> {
    // Only fixed POSIX shell syntax and the user's configured standard login shell are used.
    // Startup banners are ignored; neither a path nor a command is interpolated into the script.
    let shell = configured_login_shell()?;
    if !matches!(
        shell.to_str(),
        Some("/bin/zsh" | "/bin/bash" | "/bin/sh" | "/usr/bin/zsh" | "/usr/bin/bash")
    ) {
        return None;
    }
    let mut command = Command::new(shell);
    command
        .args(["-lic", "printf '\n__HARA_TERMINAL_PATH__%s\n' \"$PATH\""])
        .current_dir(home)
        .env_remove("BASH_ENV")
        .env_remove("ENV");
    parse_shell_path(&probe_output(&mut command, PROBE_TIMEOUT)?)
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    true
}

fn resolve_hara_on_path(path_environment: &OsStr, windows: bool) -> Option<PathBuf> {
    let names: &[&str] = if windows {
        &["hara.com", "hara.exe", "hara.bat", "hara.cmd"]
    } else {
        &["hara"]
    };
    std::env::split_paths(path_environment)
        .filter(|directory| directory.is_absolute())
        .take(256)
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        // npm's symlinks are valid diagnostic targets; relative/empty PATH entries are not.
        .find(|candidate| is_executable_file(candidate))
}

fn parse_hara_version(output: &[u8]) -> Option<String> {
    std::str::from_utf8(output)
        .ok()?
        .lines()
        .take(8)
        .find_map(|line| {
            let line = line.trim();
            let line = line.strip_prefix("hara ").unwrap_or(line);
            let version = line.strip_prefix('v').unwrap_or(line);
            let core = version.split_once('-').map_or(version, |(core, _)| core);
            let parts: Vec<_> = core.split('.').collect();
            (version.len() <= 80
                && parts.len() == 3
                && parts
                    .iter()
                    .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
                && version
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')))
            .then(|| version.to_owned())
        })
}

pub(crate) fn inspect(home: &Path, managed: &Path) -> TerminalHaraStatus {
    let (path_environment, path_source) = match login_shell_path(home) {
        Some(path) => (path, "loginShell"),
        None => (
            std::env::var_os("PATH").unwrap_or_default(),
            "desktopEnvironment",
        ),
    };
    let path = resolve_hara_on_path(&path_environment, cfg!(windows));
    let version = path.as_ref().and_then(|path| {
        let mut command = Command::new(path);
        command
            .arg("--version")
            .env("PATH", &path_environment)
            .current_dir(home);
        parse_hara_version(&probe_output(&mut command, PROBE_TIMEOUT)?)
    });
    TerminalHaraStatus {
        uses_managed_cli: path
            .as_ref()
            .is_some_and(|path| crate::same_executable_path(path, managed, cfg!(windows))),
        path: path.map(|path| path.to_string_lossy().into_owned()),
        version,
        path_source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixtureDirectory(PathBuf);

    impl Drop for FixtureDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    #[ignore = "manual smoke: reads this account's real login-shell PATH and installed Hara version"]
    fn terminal_probe_local_installation_smoke() {
        let home = crate::user_home().unwrap();
        let managed = crate::managed_cli_path(&crate::hara_data_dir().unwrap(), cfg!(windows));
        let result = inspect(&home, &managed);
        println!("{}", serde_json::to_string(&result).unwrap());
        assert!(
            result.path.is_some(),
            "the local smoke account must have Hara on PATH"
        );
        assert!(
            result.version.is_some(),
            "the actual installed command must report a readable version"
        );
        #[cfg(unix)]
        assert_eq!(result.path_source, "loginShell");
    }

    #[test]
    fn terminal_probe_never_exposes_arbitrary_version_output() {
        for value in ["0.183.2\n", "hara v0.183.2", "0.184.0-beta.1"] {
            assert!(parse_hara_version(value.as_bytes()).is_some());
        }
        for value in [
            "token=secret",
            "error: 0.183.2",
            "1.2",
            "1.2.3 secret",
            "vv1.2.3",
            "1.2.3\u{1b}[0m",
        ] {
            assert!(parse_hara_version(value.as_bytes()).is_none());
        }
        assert_eq!(
            parse_shell_path(b"startup banner\n__HARA_TERMINAL_PATH__/bin:/usr/bin\n"),
            Some(OsString::from("/bin:/usr/bin"))
        );
        assert!(parse_shell_path(b"not a path").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn terminal_probe_respects_path_order_and_npm_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = std::env::temp_dir().join(format!(
            "hara-terminal-probe-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let _cleanup = FixtureDirectory(root.clone());
        let old = root.join("old");
        let managed = root.join("managed");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&managed).unwrap();
        let executable = root.join("cli");
        std::fs::write(&executable, b"#!/bin/sh\nprintf '0.183.2\\n'\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        symlink(&executable, old.join("hara")).unwrap();
        std::fs::write(managed.join("hara"), b"not executable").unwrap();
        let search = std::env::join_paths([Path::new("."), Path::new(""), &managed, &old]).unwrap();
        assert_eq!(resolve_hara_on_path(&search, false), Some(old.join("hara")));
        std::fs::set_permissions(managed.join("hara"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        assert_eq!(
            resolve_hara_on_path(&search, false),
            Some(managed.join("hara"))
        );
        // Exercise output capture through the existing system interpreter. Launching a newly
        // written executable is a separate macOS startup concern and can exceed the production
        // deadline during parallel builds. Real installed-command execution has its own smoke.
        let mut command = Command::new("/bin/sh");
        command.arg(&executable).arg("--version");
        assert_eq!(
            parse_hara_version(&probe_output(&mut command, PROBE_TIMEOUT).unwrap()),
            Some("0.183.2".into())
        );
    }

    #[cfg(unix)]
    #[test]
    fn terminal_probe_bounds_output_and_stalled_descendants() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 10 & wait"]);
        let started = Instant::now();
        assert!(probe_output(&mut command, Duration::from_millis(100)).is_none());
        assert!(started.elapsed() < Duration::from_secs(1));
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "yes x | head -c 100000"]);
        assert_eq!(
            probe_output(&mut command, PROBE_TIMEOUT).unwrap().len(),
            MAX_PROBE_BYTES
        );
    }
}
