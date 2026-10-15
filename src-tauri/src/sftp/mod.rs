//! File operations over the SFTP subsystem of an SSH session.
//!
//! Remote paths are POSIX strings as sent on the wire; transfers are streamed
//! in chunks so large files never sit in memory.

#[cfg(test)]
mod tests;

use std::path::Path;

use russh_sftp::client::SftpSession;

use crate::ssh::SshError;

#[derive(Debug, thiserror::Error)]
pub enum SftpError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("{message}")]
    Sftp { message: String },
}

/// SSH errors keep their own shape; SFTP failures become `{ kind: "sftp", message }`.
impl serde::Serialize for SftpError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Ssh(err) => err.serialize(serializer),
            Self::Sftp { message } => {
                use serde::ser::SerializeStruct;
                let mut s = serializer.serialize_struct("SftpError", 2)?;
                s.serialize_field("kind", "sftp")?;
                s.serialize_field("message", message)?;
                s.end()
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Unix seconds.
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

/// Read/write buffer for transfers; large enough to keep many SFTP requests in flight.
const TRANSFER_CHUNK: usize = 256 * 1024;

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;

/// Builds an error message with the operation and path, e.g. `cannot list /x: No such file`.
fn failure(action: &str, path: &str, err: impl Into<SftpCause>) -> SftpError {
    SftpError::Sftp {
        message: format!("cannot {action} {path}: {}", err.into().0),
    }
}

/// Human-readable cause of a failed SFTP or local I/O operation.
struct SftpCause(String);

impl From<russh_sftp::client::error::Error> for SftpCause {
    fn from(err: russh_sftp::client::error::Error) -> Self {
        use russh_sftp::client::error::Error;
        Self(match err {
            Error::Status(status) if !status.error_message.is_empty() => status.error_message,
            Error::Status(status) => status.status_code.to_string(),
            other => other.to_string(),
        })
    }
}

impl From<std::io::Error> for SftpCause {
    fn from(err: std::io::Error) -> Self {
        Self(err.to_string())
    }
}

/// Joins a POSIX directory and a name without doubling the separator.
fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

fn kind_of(permissions: Option<u32>) -> EntryKind {
    match permissions.unwrap_or(0) & S_IFMT {
        S_IFDIR => EntryKind::Dir,
        S_IFLNK => EntryKind::Symlink,
        _ => EntryKind::File,
    }
}

/// The remote working directory the server starts in (usually the user's home).
pub async fn home(sftp: &SftpSession) -> Result<String, SftpError> {
    sftp.canonicalize(".")
        .await
        .map_err(|err| failure("resolve", "the home folder", err))
}

/// Lists `path` without `.`/`..`: directories first, then by case-insensitive name.
pub async fn list(sftp: &SftpSession, path: &str) -> Result<Vec<Entry>, SftpError> {
    let dir = sftp
        .read_dir(path)
        .await
        .map_err(|err| failure("list", path, err))?;
    let mut entries: Vec<Entry> = dir
        .filter(|entry| !matches!(entry.file_name().as_str(), "." | ".."))
        .map(|entry| {
            let meta = entry.metadata();
            let name = entry.file_name();
            Entry {
                path: join(path, &name),
                name,
                kind: kind_of(meta.permissions),
                size: meta.size.unwrap_or(0),
                modified: meta.mtime.map(u64::from),
                permissions: meta.permissions.map(|p| p & !S_IFMT),
            }
        })
        .collect();
    entries.sort_by_cached_key(|entry| {
        (
            entry.kind != EntryKind::Dir,
            entry.name.to_lowercase(),
            entry.name.clone(),
        )
    });
    Ok(entries)
}

/// Streams the remote file `remote` into the local file `local` (created or truncated).
/// A partially written local file is removed when the transfer fails.
pub async fn download(sftp: &SftpSession, remote: &str, local: &Path) -> Result<(), SftpError> {
    use tokio::io::AsyncWriteExt;

    let source = sftp
        .open(remote)
        .await
        .map_err(|err| failure("download", remote, err))?;
    let local_label = local.display().to_string();
    // Write next to the target and rename at the end, so a failed transfer never
    // destroys a file the user chose to replace.
    let mut partial_name = local.file_name().unwrap_or_default().to_os_string();
    partial_name.push(".nexusterm-partial");
    let partial = local.with_file_name(partial_name);
    let target = tokio::fs::File::create(&partial)
        .await
        .map_err(|err| failure("write", &local_label, err))?;
    let mut reader = tokio::io::BufReader::with_capacity(TRANSFER_CHUNK, source);
    let mut writer = tokio::io::BufWriter::with_capacity(TRANSFER_CHUNK, target);
    let copied = async {
        tokio::io::copy_buf(&mut reader, &mut writer).await?;
        writer.flush().await?;
        drop(writer);
        tokio::fs::rename(&partial, local).await
    }
    .await;
    if let Err(err) = copied {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(failure("download", remote, err));
    }
    Ok(())
}

/// Streams the local file `local` into `remote_dir`, keeping its name; returns the remote path.
pub async fn upload(
    sftp: &SftpSession,
    local: &Path,
    remote_dir: &str,
) -> Result<String, SftpError> {
    use tokio::io::AsyncWriteExt;

    let local_label = local.display().to_string();
    let name = local
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| SftpError::Sftp {
            message: format!("cannot upload {local_label}: not a file name"),
        })?;
    let remote = join(remote_dir, name);
    let source = tokio::fs::File::open(local)
        .await
        .map_err(|err| failure("read", &local_label, err))?;
    let mut target = sftp
        .create(remote.as_str())
        .await
        .map_err(|err| failure("upload to", &remote, err))?;
    let mut reader = tokio::io::BufReader::with_capacity(TRANSFER_CHUNK, source);
    tokio::io::copy_buf(&mut reader, &mut target)
        .await
        .map_err(|err| failure("upload to", &remote, err))?;
    // Waits for every pending write to be acknowledged.
    target
        .shutdown()
        .await
        .map_err(|err| failure("upload to", &remote, err))?;
    Ok(remote)
}

pub async fn mkdir(sftp: &SftpSession, path: &str) -> Result<(), SftpError> {
    sftp.create_dir(path)
        .await
        .map_err(|err| failure("create folder", path, err))
}

/// Removes a file, or a directory when `is_dir` (only if it is empty).
pub async fn remove(sftp: &SftpSession, path: &str, is_dir: bool) -> Result<(), SftpError> {
    let result = if is_dir {
        sftp.remove_dir(path).await
    } else {
        sftp.remove_file(path).await
    };
    result.map_err(|err| failure("delete", path, err))
}

pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> Result<(), SftpError> {
    sftp.rename(from, to)
        .await
        .map_err(|err| failure("rename", from, err))
}
