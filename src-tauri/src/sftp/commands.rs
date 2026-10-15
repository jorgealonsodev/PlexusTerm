//! Tauri commands of the SFTP browser's context menu (chmod, open/edit, compare).

use std::ffi::OsString;
use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use super::edit::{self, TempFiles};
use super::{SftpError, chmod, download_copy, upload_file};
use crate::ssh::SshManager;

/// Emitted with [`EditSaved`] when a temporary copy opened for editing is saved.
pub const EDIT_SAVED_EVENT: &str = "sftp-edit-saved";

const EDIT: &str = "edit";
const COMPARE: &str = "compare";

/// Which program opens the temporary copy.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenWith {
    /// The system's default program for the file.
    Default,
    /// The default text editor.
    TextEditor,
    /// A program chosen by the user.
    Program { path: String },
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSaved {
    pub id: u32,
    pub remote: String,
    pub local: String,
}

fn open_failure(local: &Path, err: impl std::fmt::Display) -> SftpError {
    SftpError::Sftp {
        message: format!("cannot open {}: {err}", local.display()),
    }
}

fn launch(with: &OpenWith, local: &Path) -> Result<(), SftpError> {
    let path = local.to_string_lossy().into_owned();
    match with {
        OpenWith::Default => tauri_plugin_opener::open_path(path, None::<&str>)
            .map_err(|err| open_failure(local, err)),
        OpenWith::Program { path: program } => {
            tauri_plugin_opener::open_path(path, Some(program.as_str()))
                .map_err(|err| open_failure(local, err))
        }
        // Without a known text editor, fall back to the default program.
        OpenWith::TextEditor => match edit::text_editor_command(local) {
            Some(command) => edit::spawn_detached(&command).map_err(|err| open_failure(local, err)),
            None => tauri_plugin_opener::open_path(path, None::<&str>)
                .map_err(|err| open_failure(local, err)),
        },
    }
}

#[tauri::command]
pub async fn sftp_chmod(
    id: u32,
    path: String,
    mode: u32,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    chmod(&*ssh.sftp(id).await?, &path, mode).await
}

/// Downloads `remote` to a private temporary copy, opens it and watches it:
/// every save emits [`EDIT_SAVED_EVENT`]. Returns the local path.
#[tauri::command]
pub async fn sftp_edit(
    id: u32,
    remote: String,
    with: OpenWith,
    app: AppHandle,
    ssh: State<'_, SshManager>,
    temp: State<'_, TempFiles>,
) -> Result<String, SftpError> {
    let sftp = ssh.sftp(id).await?;
    let local = download_copy(&sftp, &temp, id, EDIT, &remote).await?;
    let saved = EditSaved {
        id,
        remote: remote.clone(),
        local: local.to_string_lossy().into_owned(),
    };
    temp.watch(id, EDIT, &remote, edit::WATCH_INTERVAL, move || {
        let _ = app.emit(EDIT_SAVED_EVENT, saved.clone());
    });
    launch(&with, &local)?;
    Ok(local.to_string_lossy().into_owned())
}

/// Uploads the edited temporary copy of `remote` back to `remote`.
#[tauri::command]
pub async fn sftp_edit_upload(
    id: u32,
    remote: String,
    ssh: State<'_, SshManager>,
    temp: State<'_, TempFiles>,
) -> Result<(), SftpError> {
    let local = temp
        .existing(id, EDIT, &remote)
        .ok_or_else(|| SftpError::Sftp {
            message: format!("cannot upload to {remote}: it is not open for editing"),
        })?;
    upload_file(&*ssh.sftp(id).await?, &local, &remote).await
}

/// Opens a temporary copy of `remote` and the local file `local` in the first
/// installed diff tool (Meld, KDiff3, Kompare, then `code --diff`).
#[tauri::command]
pub async fn sftp_compare(
    id: u32,
    remote: String,
    local: String,
    ssh: State<'_, SshManager>,
    temp: State<'_, TempFiles>,
) -> Result<(), SftpError> {
    let (tool, args) =
        edit::find_diff_tool(std::env::var_os("PATH")).ok_or_else(|| SftpError::Sftp {
            message: "No diff tool found: install Meld, KDiff3, Kompare or Visual Studio Code."
                .into(),
        })?;
    let copy = download_copy(&*ssh.sftp(id).await?, &temp, id, COMPARE, &remote).await?;
    let mut command: Vec<OsString> = vec![tool.into_os_string()];
    command.extend(args.iter().map(OsString::from));
    command.push(copy.clone().into_os_string());
    command.push(local.into());
    edit::spawn_detached(&command).map_err(|err| open_failure(&copy, err))
}

/// Deletes the temporary copies of session `id` (call when the SSH session ends).
#[tauri::command]
pub fn sftp_discard_copies(id: u32, temp: State<'_, TempFiles>) {
    temp.remove(id);
}
