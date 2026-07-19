use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_TERMINATE,
};

fn process_path_from_handle(handle: HANDLE) -> Result<PathBuf, String> {
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) };
    if ok == 0 || length == 0 {
        return Err(format!(
            "inspect legacy Hara process: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(PathBuf::from(OsString::from_wide(
        &buffer[..length as usize],
    )))
}

pub(crate) fn process_is_alive(pid: u32) -> bool {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    unsafe {
        CloseHandle(handle);
    }
    true
}

pub(crate) fn terminate_verified_process(
    pid: u32,
    is_allowed: impl FnOnce(&Path) -> bool,
) -> Result<(), String> {
    // Keep one process handle from executable verification through termination so PID reuse cannot retarget
    // the action between two separate OpenProcess calls.
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            0,
            pid,
        )
    };
    if handle.is_null() {
        return Err(format!(
            "open legacy Hara engine: {}",
            std::io::Error::last_os_error()
        ));
    }
    let executable = process_path_from_handle(handle);
    let result = match executable {
        Ok(path) if is_allowed(&path) => {
            let terminated = unsafe { TerminateProcess(handle, 0) };
            if terminated == 0 {
                Err(format!(
                    "stop legacy Hara engine: {}",
                    std::io::Error::last_os_error()
                ))
            } else {
                Ok(())
            }
        }
        Ok(path) => Err(format!(
            "refusing to stop pid {pid}: {} is not a Desktop-managed Hara engine",
            path.display()
        )),
        Err(error) => Err(error),
    };
    unsafe {
        CloseHandle(handle);
    }
    result
}
