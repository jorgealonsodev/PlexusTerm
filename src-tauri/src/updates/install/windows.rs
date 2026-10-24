//! Registry provenance and native UAC launch. Never invoke a shell or an uninstall command.
use super::*;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError},
    System::{
        Com::{COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize},
        SystemInformation::GetSystemDirectoryW,
        Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject},
    },
    UI::{
        Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW},
        WindowsAndMessaging::SW_SHOWNORMAL,
    },
};
use winreg::{RegKey, enums::*};

pub(in super::super) fn detect() -> Result<Installation, String> {
    let exe = std::env::current_exe()
        .map_err(error)?
        .canonicalize()
        .map_err(error)?;
    let mut proofs = Vec::new();
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        // Only the native 64-bit view: querying both views could count the same registration twice.
        let Ok(uninstall) = RegKey::predef(hive).open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ | KEY_WOW64_64KEY,
        ) else {
            continue;
        };
        for key in uninstall.enum_keys().filter_map(Result::ok) {
            let Ok(record) = uninstall.open_subkey_with_flags(&key, KEY_READ) else {
                continue;
            };
            if record.get_value::<String, _>("DisplayName").ok().as_deref() != Some("PlexusTerm") {
                continue;
            }
            let Ok(location) = record.get_value::<String, _>("InstallLocation") else {
                continue;
            };
            let msi = record.get_value::<u32, _>("WindowsInstaller").ok() == Some(1);
            let uninstaller = record
                .get_value::<String, _>("UninstallString")
                .ok()
                .map(|s| PathBuf::from(s.trim_matches('"')));
            if let Some(format) =
                windows_proof(&exe, Path::new(&location), msi, uninstaller.as_deref())
            {
                proofs.push(format);
            }
        }
    }
    Ok(Installation {
        format: choose(&proofs)?,
        target: exe,
    })
}
fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
    s.encode_wide().chain(Some(0)).collect()
}

pub(in super::super) fn apply(
    installation: &Installation,
    package: &Path,
    _: &str,
) -> Result<Outcome, String> {
    let current = detect()?;
    if current.format != installation.format || current.target != installation.target {
        return Err("Installation changed while downloading".into());
    }
    let mut system = [0u16; 32768];
    let n = unsafe { GetSystemDirectoryW(system.as_mut_ptr(), system.len() as u32) } as usize;
    if n == 0 || n >= system.len() {
        return Err("Cannot locate Windows installer".into());
    }
    use std::os::windows::ffi::OsStringExt;
    let msi = PathBuf::from(std::ffi::OsString::from_wide(&system[..n])).join("msiexec.exe");
    let executable = match installation.format {
        Format::Msi => &msi,
        Format::Nsis => package,
        _ => return Err("Unsupported Windows installation".into()),
    };
    let file = wide(executable.as_os_str());
    // No command interpreter; generated package paths cannot contain a Windows quote character.
    let parameters = wide(std::ffi::OsStr::new(&match installation.format {
        Format::Msi => format!(
            "/i \"{}\" /norestart",
            package.to_str().ok_or("Invalid installer path")?
        ),
        _ => String::new(),
    }));
    let verb = wide(std::ffi::OsStr::new("runas"));
    let initialized = unsafe {
        CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    };
    if initialized < 0 {
        return Err(format!(
            "Cannot initialize Windows installer launcher ({initialized})"
        ));
    }
    struct Com;
    impl Drop for Com {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    let _com = Com;
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(format!(
            "Installer launch failed or UAC was cancelled (Windows error {})",
            unsafe { GetLastError() }
        ));
    }
    if info.hProcess.is_null() {
        return Err("Windows did not return an installer process".into());
    }
    // Caller retains the private TempDir and single-flight guard until this process consumes it.
    let wait = unsafe { WaitForSingleObject(info.hProcess, INFINITE) };
    let mut code = 0;
    let read = unsafe { GetExitCodeProcess(info.hProcess, &mut code) };
    unsafe {
        CloseHandle(info.hProcess);
    }
    if wait != 0 || read == 0 {
        return Err("Cannot observe installer completion".into());
    }
    if ![0, 1641, 3010].contains(&code) {
        return Err(format!("Installer failed or was cancelled (exit {code})"));
    }
    Ok(Outcome::InstallerOpened)
}
