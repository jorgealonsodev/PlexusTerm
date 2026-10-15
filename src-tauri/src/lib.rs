mod pty;
mod serial;
mod sftp;
mod ssh;
mod storage;
mod terminal;
mod tunnels;

use pty::{PtyError, PtyManager, SpawnRequest};
use serial::{SerialError, SerialManager, SerialRequest};
use sftp::SftpError;
use ssh::{ConnectRequest, SshError, SshManager, SshTarget};
use storage::StorageError;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
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
async fn ssh_connect(
    request: ConnectRequest,
    on_event: Channel<TerminalEvent>,
    ssh: State<'_, SshManager>,
) -> Result<u32, SshError> {
    ssh.connect(request, ChannelSink(on_event)).await
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
fn ssh_close(id: u32, ssh: State<'_, SshManager>) -> Result<(), SshError> {
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

/// Upper bound for files picked for import (a MobaXterm.ini is a few kilobytes).
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

/// Event carrying every tunnel status change.
const TUNNEL_STATUS_EVENT: &str = "tunnel-status";

/// `target` is the tunnel's saved session, with the password filled in when it uses one.
#[tauri::command]
async fn tunnel_start(
    tunnel: TunnelDefinition,
    target: SshTarget,
    trusted_fingerprint: Option<String>,
    tunnels: State<'_, TunnelManager>,
) -> Result<(), TunnelError> {
    tunnels.start(tunnel, target, trusted_fingerprint).await
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::default())
        .manage(SerialManager::default())
        .manage(SshManager::for_current_user())
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(TunnelManager::for_current_user(move |update| {
                let _ = handle.emit(TUNNEL_STATUS_EVENT, update);
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            serial_list_ports,
            serial_open,
            serial_write,
            serial_close,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_close,
            sftp_home,
            sftp_list,
            sftp_download,
            sftp_upload,
            sftp_mkdir,
            sftp_remove,
            sftp_rename,
            sessions_load,
            sessions_save,
            import_read_file,
            tunnels_load,
            tunnels_save,
            tunnel_start,
            tunnel_stop,
            tunnel_statuses
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
