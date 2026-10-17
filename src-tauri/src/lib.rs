mod ai;
mod history;
mod mosh;
mod platform;
mod pty;
mod secrets;
mod serial;
mod sftp;
mod ssh;
mod storage;
mod telnet;
mod terminal;
mod tools;
mod tunnels;
mod updates;

use mosh::{MoshLauncher, MoshRequest};
use pty::{PtyError, PtyManager, SpawnRequest};
use secrets::{KeyringStore, SecretError, SharedSecrets};
use serial::{SerialError, SerialManager, SerialRequest};
use sftp::SftpError;
use ssh::{ConnectRequest, PasswordStorage, SshError, SshManager, SshTarget};
use storage::StorageError;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use telnet::{TelnetError, TelnetManager, TelnetRequest};
use terminal::TerminalSink;
use tunnels::{StatusUpdate, TunnelDefinition, TunnelError, TunnelManager};

/// Events streamed to the frontend for one terminal session.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum TerminalEvent {
    Output(String),
    Exit(Option<u32>),
}

struct ChannelSink(Channel<TerminalEvent>);

impl TerminalSink for ChannelSink {
    fn data(&self, text: String) {
        let _ = self.0.send(TerminalEvent::Output(text));
    }
    fn exit(&self, code: Option<u32>) {
        let _ = self.0.send(TerminalEvent::Exit(code));
    }
}

#[tauri::command]
fn pty_spawn(
    request: SpawnRequest,
    on_event: Channel<TerminalEvent>,
    ptys: State<'_, PtyManager>,
) -> Result<u32, PtyError> {
    ptys.spawn(request, ChannelSink(on_event))
}

#[tauri::command]
fn pty_write(id: u32, data: String, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.write(id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(id: u32, cols: u16, rows: u16, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.resize(id, cols, rows)
}

#[tauri::command]
fn pty_close(id: u32, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.close(id)
}

#[tauri::command]
fn serial_list_ports() -> Vec<String> {
    serial::list_ports()
}

/// Wake On LAN (Tools menu): sends the magic packet for `mac`; the broadcast address and
/// port default to 255.255.255.255 and 9.
#[tauri::command]
async fn wol_send(mac: String, broadcast: Option<String>, port: Option<u16>) -> Result<(), String> {
    let mac = tools::wol::parse_mac(&mac)?;
    let broadcast = match broadcast.as_deref().map(str::trim) {
        None | Some("") => std::net::Ipv4Addr::BROADCAST,
        Some(text) => text
            .parse()
            .map_err(|_| "Broadcast address must be an IPv4 address".to_string())?,
    };
    let port = port.unwrap_or(tools::wol::DEFAULT_PORT);
    if port == 0 {
        return Err("Port must be a number between 1 and 65535".into());
    }
    tools::wol::send(mac, broadcast, port)
        .await
        .map_err(|err| format!("Could not send the packet: {err}"))
}

/// The shells local terminals can run, and the default one (Settings and local sessions list them).
#[tauri::command]
fn shells() -> platform::Shells {
    platform::shells()
}

/// Whether a newer PlexusTerm release is published on GitHub (the app only links to it).
#[tauri::command]
async fn update_check() -> Result<updates::UpdateCheck, String> {
    updates::check().await
}

/// `"linux"`, `"windows"` or `"macos"`, so the frontend can adapt platform-specific texts.
#[tauri::command]
fn platform() -> &'static str {
    platform::name()
}

#[tauri::command]
fn serial_open(
    request: SerialRequest,
    on_event: Channel<TerminalEvent>,
    serial: State<'_, SerialManager>,
) -> Result<u32, SerialError> {
    serial.open(request, ChannelSink(on_event))
}

#[tauri::command]
fn serial_write(
    id: u32,
    data: String,
    serial: State<'_, SerialManager>,
) -> Result<(), SerialError> {
    serial.write(id, data.as_bytes())
}

#[tauri::command]
fn serial_close(id: u32, serial: State<'_, SerialManager>) -> Result<(), SerialError> {
    serial.close(id)
}

#[tauri::command]
async fn telnet_connect(
    request: TelnetRequest,
    on_event: Channel<TerminalEvent>,
    telnet: State<'_, TelnetManager>,
) -> Result<u32, TelnetError> {
    telnet.connect(request, ChannelSink(on_event)).await
}

#[tauri::command]
fn telnet_write(
    id: u32,
    data: String,
    telnet: State<'_, TelnetManager>,
) -> Result<(), TelnetError> {
    telnet.write(id, data.as_bytes())
}

#[tauri::command]
fn telnet_resize(
    id: u32,
    cols: u16,
    rows: u16,
    telnet: State<'_, TelnetManager>,
) -> Result<(), TelnetError> {
    telnet.resize(id, cols, rows)
}

#[tauri::command]
fn telnet_close(id: u32, telnet: State<'_, TelnetManager>) -> Result<(), TelnetError> {
    telnet.close(id)
}

/// Starts `mosh-server` over SSH (login rules and `storage` as for `ssh_connect`) and
/// runs `mosh-client` in a PTY; the returned id is driven with the `pty_*` commands.
#[tauri::command]
async fn mosh_connect(
    request: MoshRequest,
    storage: Option<PasswordStorage>,
    on_event: Channel<TerminalEvent>,
    mosh: State<'_, MoshLauncher>,
    ssh: State<'_, SshManager>,
    ptys: State<'_, PtyManager>,
) -> Result<u32, SshError> {
    mosh.connect(&ssh, &ptys, request, storage, ChannelSink(on_event))
        .await
}

/// `storage` saves the typed password in the keyring (or forgets the saved one) once logged in.
#[tauri::command]
async fn ssh_connect(
    request: ConnectRequest,
    storage: Option<PasswordStorage>,
    on_event: Channel<TerminalEvent>,
    ssh: State<'_, SshManager>,
) -> Result<u32, SshError> {
    ssh.connect_with(request, storage, ChannelSink(on_event))
        .await
}

/// Whether a system keyring (Secret Service) can hold saved passwords.
#[tauri::command]
async fn secret_available(secrets: State<'_, SharedSecrets>) -> Result<bool, ()> {
    Ok(secrets::run(&secrets, |s| Ok(s.available()))
        .await
        .unwrap_or(false))
}

/// Whether a password is saved for the session; the password itself never leaves the backend.
#[tauri::command]
async fn secret_exists(
    session_id: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<bool, SecretError> {
    secrets::run(&secrets, move |s| {
        Ok(s.available() && s.get(&session_id)?.is_some())
    })
    .await
}

#[tauri::command]
async fn secret_delete(
    session_id: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<(), SecretError> {
    secrets::run(&secrets, move |s| s.delete(&session_id)).await
}

#[tauri::command]
fn ssh_write(id: u32, data: String, ssh: State<'_, SshManager>) -> Result<(), SshError> {
    ssh.write(id, data.as_bytes())
}

#[tauri::command]
fn ssh_resize(id: u32, cols: u16, rows: u16, ssh: State<'_, SshManager>) -> Result<(), SshError> {
    ssh.resize(id, cols, rows)
}

#[tauri::command]
fn ssh_close(
    id: u32,
    ssh: State<'_, SshManager>,
    copies: State<'_, sftp::edit::TempFiles>,
) -> Result<(), SshError> {
    // Temporary copies opened from the SFTP browser go with their session.
    copies.remove(id);
    ssh.close(id)
}

#[tauri::command]
async fn sftp_home(id: u32, ssh: State<'_, SshManager>) -> Result<String, SftpError> {
    sftp::home(&*ssh.sftp(id).await?).await
}

#[tauri::command]
async fn sftp_list(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<Vec<sftp::Entry>, SftpError> {
    sftp::list(&*ssh.sftp(id).await?, &path).await
}

#[tauri::command]
async fn sftp_download(
    id: u32,
    remote: String,
    local: String,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::download(&*ssh.sftp(id).await?, &remote, local.as_ref()).await
}

/// Returns the remote path of the uploaded file.
#[tauri::command]
async fn sftp_upload(
    id: u32,
    local: String,
    remote_dir: String,
    ssh: State<'_, SshManager>,
) -> Result<String, SftpError> {
    sftp::upload(&*ssh.sftp(id).await?, local.as_ref(), &remote_dir).await
}

#[tauri::command]
async fn sftp_mkdir(id: u32, path: String, ssh: State<'_, SshManager>) -> Result<(), SftpError> {
    sftp::mkdir(&*ssh.sftp(id).await?, &path).await
}

#[tauri::command]
async fn sftp_create_file(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::create_file(&*ssh.sftp(id).await?, &path).await
}

#[tauri::command]
async fn sftp_remove(
    id: u32,
    path: String,
    is_dir: bool,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::remove(&*ssh.sftp(id).await?, &path, is_dir).await
}

#[tauri::command]
async fn sftp_rename(
    id: u32,
    from: String,
    to: String,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::rename(&*ssh.sftp(id).await?, &from, &to).await
}

const SESSIONS_FILE: &str = "sessions.json";
const TUNNELS_FILE: &str = "tunnels.json";

fn config_path(app: &AppHandle, file: &str) -> Result<std::path::PathBuf, StorageError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| StorageError::Io(err.to_string()))?;
    Ok(dir.join(file))
}

#[tauri::command]
fn sessions_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    storage::load(&config_path(&app, SESSIONS_FILE)?)
}

#[tauri::command]
fn sessions_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, SESSIONS_FILE)?, &contents)
}

/// Upper bound for files picked for import (a sessions.ini is a few kilobytes).
const IMPORT_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
fn import_read_file(path: String) -> Result<Vec<u8>, StorageError> {
    storage::read_bounded(std::path::Path::new(&path), IMPORT_MAX_BYTES)
}

#[tauri::command]
fn tunnels_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    storage::load(&config_path(&app, TUNNELS_FILE)?)
}

#[tauri::command]
fn tunnels_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, TUNNELS_FILE)?, &contents)
}

const MACROS_FILE: &str = "macros.json";

#[tauri::command]
fn macros_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    storage::load(&config_path(&app, MACROS_FILE)?)
}

#[tauri::command]
fn macros_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, MACROS_FILE)?, &contents)
}

const SETTINGS_FILE: &str = "settings.json";

#[tauri::command]
fn settings_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    storage::load(&config_path(&app, SETTINGS_FILE)?)
}

#[tauri::command]
fn settings_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, SETTINGS_FILE)?, &contents)
}

/// Upper bound for terminal output written to a file in one call (saved scrollback or a log batch).
const TEXT_FILE_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// Saves terminal output to a file the user picked in the save dialog.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), StorageError> {
    storage::write_text(std::path::Path::new(&path), &contents, TEXT_FILE_MAX_BYTES)
}

/// Appends a batch of session log output to the file the user picked.
#[tauri::command]
fn append_text_file(path: String, contents: String) -> Result<(), StorageError> {
    storage::append_text(std::path::Path::new(&path), &contents, TEXT_FILE_MAX_BYTES)
}

/// Event carrying every tunnel status change.
const TUNNEL_STATUS_EVENT: &str = "tunnel-status";

/// `target` is the tunnel's saved session, with the typed password or a reference
/// to the saved one; `storage` works as for `ssh_connect`.
#[tauri::command]
async fn tunnel_start(
    tunnel: TunnelDefinition,
    target: SshTarget,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    tunnels: State<'_, TunnelManager>,
) -> Result<(), TunnelError> {
    tunnels
        .start_with(tunnel, target, trusted_fingerprint, storage)
        .await
}

#[tauri::command]
async fn tunnel_stop(id: String, tunnels: State<'_, TunnelManager>) -> Result<(), ()> {
    tunnels.stop(&id).await;
    Ok(())
}

#[tauri::command]
fn tunnel_statuses(tunnels: State<'_, TunnelManager>) -> Vec<StatusUpdate> {
    tunnels.statuses()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let secrets: SharedSecrets = std::sync::Arc::new(KeyringStore::default());
    let tunnel_secrets = secrets.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::default())
        .manage(SerialManager::default())
        .manage(TelnetManager::default())
        .manage(MoshLauncher::default())
        .manage(tools::scan::ScanManager::default())
        .manage(sftp::edit::TempFiles::default())
        .manage(SshManager::for_current_user().with_secrets(secrets.clone()))
        .manage(secrets)
        .manage(ai::AiClient::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            app.manage(
                TunnelManager::for_current_user(move |update| {
                    let _ = handle.emit(TUNNEL_STATUS_EVENT, update);
                })
                .with_secrets(tunnel_secrets),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            serial_list_ports,
            platform,
            shells,
            update_check,
            serial_open,
            serial_write,
            serial_close,
            telnet_connect,
            telnet_write,
            telnet_resize,
            telnet_close,
            mosh_connect,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_close,
            secret_available,
            secret_exists,
            secret_delete,
            sftp_home,
            sftp_list,
            sftp_download,
            sftp_upload,
            sftp_mkdir,
            sftp_create_file,
            sftp_remove,
            sftp_rename,
            sessions_load,
            sessions_save,
            import_read_file,
            tunnels_load,
            tunnels_save,
            tunnel_start,
            tunnel_stop,
            tunnel_statuses,
            settings_load,
            settings_save,
            macros_load,
            macros_save,
            save_text_file,
            append_text_file,
            wol_send,
            history::history_load,
            history::history_save,
            ai::ai_key_status,
            ai::ai_key_save,
            ai::ai_key_delete,
            ai::ai_complete,
            ai::ai_assist,
            ai::ai_opencode_models,
            ai::models::ai_models,
            tools::keygen::keygen_generate,
            tools::keygen::keygen_save,
            tools::keygen::keygen_install,
            tools::keygen::keygen_discard,
            tools::keygen::keygen_load,
            tools::keygen::keygen_update,
            tools::keygen::keygen_save_public,
            tools::keygen::keygen_save_private,
            tools::keygen::keygen_export_ppk,
            tools::scan::scan_ports,
            tools::scan::scan_network,
            tools::scan::scan_stop,
            tools::monitor::monitor_sample,
            sftp::commands::sftp_chmod,
            sftp::commands::sftp_edit,
            sftp::commands::sftp_edit_upload,
            sftp::commands::sftp_compare,
            sftp::commands::sftp_discard_copies
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
