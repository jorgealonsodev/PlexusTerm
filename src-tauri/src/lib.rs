mod pty;
mod sftp;
mod ssh;
mod storage;
mod terminal;

use pty::{PtyError, PtyManager, SpawnRequest};
use sftp::SftpError;
use ssh::{ConnectRequest, SshError, SshManager};
use storage::StorageError;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use terminal::TerminalSink;

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

fn sessions_path(app: &AppHandle) -> Result<std::path::PathBuf, StorageError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| StorageError::Io(err.to_string()))?;
    Ok(dir.join(SESSIONS_FILE))
}

#[tauri::command]
fn sessions_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    storage::load(&sessions_path(&app)?)
}

#[tauri::command]
fn sessions_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&sessions_path(&app)?, &contents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::default())
        .manage(SshManager::for_current_user())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
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
            sessions_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
