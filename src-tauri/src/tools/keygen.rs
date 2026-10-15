//! Tools > SSH key generator (S2): generates an Ed25519 key pair, saves it to files and
//! installs the public key on a server like `ssh-copy-id`.
//!
//! The private key stays in the backend: [`generate`] keeps it in a [`KeyStore`] under an
//! id and returns only the public key, which [`save`] and [`install`] then refer to. The
//! private key only ever leaves memory as the file written by [`save`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use russh::ChannelMsg;
use russh::keys::ssh_key::LineEnding;
use russh::keys::ssh_key::rand_core::UnwrapErr;
use russh::keys::{Algorithm, HashAlg, PrivateKey};
use zeroize::Zeroizing;

use crate::ssh::{
    Chain, Connection, SshError, SshManager, SshTarget, connect_authenticated, disconnect_jumps,
};

/// Longest comment accepted (OpenSSH has no limit; this keeps lines readable).
const MAX_COMMENT: usize = 256;

/// Generated keys kept at once; the oldest is dropped beyond this.
const MAX_KEYS: usize = 8;

/// How long the install command may take on the server.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(20);

/// Most output of the install command kept for error messages.
const MAX_OUTPUT: usize = 16 * 1024;

const ADDED: &str = "PLEXUSTERM_KEY_ADDED";
const PRESENT: &str = "PLEXUSTERM_KEY_PRESENT";

/// Errors of generating and saving keys. Serialized as `{ kind, ... }` (camelCase).
#[derive(Debug, thiserror::Error, serde::Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KeygenError {
    #[error("{message}")]
    Invalid { message: String },
    /// `path` already exists and `overwrite` was not set.
    #[error("{path} already exists")]
    Exists { path: String },
    #[error("the generated key is no longer available; generate it again")]
    UnknownKey,
    #[error("{message}")]
    Io { message: String },
}

fn invalid(message: impl Into<String>) -> KeygenError {
    KeygenError::Invalid {
        message: message.into(),
    }
}

/// What the frontend gets back from [`generate`]: never the private key.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
    pub id: u32,
    /// One `authorized_keys` line: `ssh-ed25519 AAAA... comment`.
    pub public_key: String,
    /// `SHA256:...`, as printed by `ssh-keygen -l`.
    pub fingerprint: String,
}

/// Whether [`install`] added the key or found it already there.
#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallOutcome {
    Added,
    AlreadyPresent,
}

/// A generated key pair. Deliberately not `Debug`: it holds the private key.
struct StoredKey {
    /// OpenSSH private key file contents, encrypted when a passphrase was given.
    private_openssh: Zeroizing<String>,
    public_key: String,
}

/// Generated keys by id, until the dialog that made them is closed.
#[derive(Default)]
pub struct KeyStore {
    next_id: AtomicU32,
    keys: Mutex<HashMap<u32, StoredKey>>,
}

impl KeyStore {
    fn insert(&self, key: StoredKey) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let mut keys = self.keys.lock().unwrap();
        if keys.len() >= MAX_KEYS
            && let Some(oldest) = keys.keys().min().copied()
        {
            keys.remove(&oldest);
        }
        keys.insert(id, key);
        id
    }

    fn with<T>(&self, id: u32, f: impl FnOnce(&StoredKey) -> T) -> Option<T> {
        self.keys.lock().unwrap().get(&id).map(f)
    }

    /// Forgets the key `id` (the dialog was closed).
    pub fn discard(&self, id: u32) {
        self.keys.lock().unwrap().remove(&id);
    }
}

/// The store used by the Tauri commands.
static STORE: std::sync::LazyLock<KeyStore> = std::sync::LazyLock::new(KeyStore::default);

/// A comment that fits on one `authorized_keys` line.
fn validate_comment(comment: &str) -> Result<&str, KeygenError> {
    let comment = comment.trim();
    if comment.chars().count() > MAX_COMMENT {
        return Err(invalid(format!(
            "the comment must be at most {MAX_COMMENT} characters"
        )));
    }
    if comment.chars().any(char::is_control) {
        return Err(invalid("the comment cannot contain control characters"));
    }
    Ok(comment)
}

/// Generates an Ed25519 key pair with `comment`, encrypted with `passphrase` when given
/// (empty means none), keeps it in `store` and returns its public half.
pub fn generate(
    store: &KeyStore,
    passphrase: Option<&str>,
    comment: &str,
) -> Result<GeneratedKey, KeygenError> {
    let comment = validate_comment(comment)?;
    let mut rng = UnwrapErr(rand::rngs::SysRng);
    let mut key = PrivateKey::random(&mut rng, Algorithm::Ed25519)
        .map_err(|err| invalid(format!("cannot generate the key: {err}")))?;
    key.set_comment(comment);
    let public = key.public_key();
    let public_key = public
        .to_openssh()
        .map_err(|err| invalid(format!("cannot encode the public key: {err}")))?;
    let fingerprint = public.fingerprint(HashAlg::Sha256).to_string();
    let key = match passphrase.filter(|p| !p.is_empty()) {
        Some(passphrase) => key
            .encrypt(&mut rng, passphrase)
            .map_err(|err| invalid(format!("cannot encrypt the key: {err}")))?,
        None => key,
    };
    let private_openssh = key
        .to_openssh(LineEnding::LF)
        .map_err(|err| invalid(format!("cannot encode the private key: {err}")))?;
    let id = store.insert(StoredKey {
        private_openssh,
        public_key: public_key.clone(),
    });
    Ok(GeneratedKey {
        id,
        public_key,
        fingerprint,
    })
}

/// `path` with `.pub` appended (`id_ed25519` -> `id_ed25519.pub`).
pub fn public_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".pub");
    PathBuf::from(name)
}

fn io(path: &Path, err: std::io::Error) -> KeygenError {
    KeygenError::Io {
        message: format!("cannot write {}: {err}", path.display()),
    }
}

/// Writes `contents` to `path` with `mode` (Unix), creating it, or replacing it only when
/// `overwrite` is set. The mode is set before any byte is written, also on a replaced file.
fn write_file(path: &Path, contents: &[u8], mode: u32, overwrite: bool) -> Result<(), KeygenError> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true);
    if overwrite {
        options.create(true).truncate(true);
    } else {
        options.create_new(true);
    }
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, mode);
    #[cfg(not(unix))]
    let _ = mode;
    let mut file = options.open(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::AlreadyExists => KeygenError::Exists {
            path: path.display().to_string(),
        },
        _ => io(path, err),
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(mode))
            .map_err(|err| io(path, err))?;
    }
    file.write_all(contents).map_err(|err| io(path, err))?;
    file.sync_all().map_err(|err| io(path, err))
}

/// Saves key `id` as `path` (private, 0600) and `path.pub` (public, 0644). Existing files
/// are never replaced unless `overwrite` is set: [`KeygenError::Exists`] names the first one.
pub fn save(store: &KeyStore, id: u32, path: &Path, overwrite: bool) -> Result<(), KeygenError> {
    if path.as_os_str().is_empty() {
        return Err(invalid("choose where to save the key"));
    }
    let pub_path = public_path(path);
    if !overwrite {
        for existing in [path, pub_path.as_path()] {
            if existing.exists() {
                return Err(KeygenError::Exists {
                    path: existing.display().to_string(),
                });
            }
        }
    }
    let (private, public) = store
        .with(id, |key| {
            (key.private_openssh.clone(), key.public_key.clone())
        })
        .ok_or(KeygenError::UnknownKey)?;
    write_file(path, private.as_bytes(), 0o600, overwrite)?;
    write_file(
        &pub_path,
        format!("{public}\n").as_bytes(),
        0o644,
        overwrite,
    )
}

/// An `ssh-ed25519` public key line safe to put in a shell command: the key type, base64,
/// and an optional comment without control characters.
fn validate_public_line(line: &str) -> Result<(&str, &str), String> {
    let invalid = || "not an ssh-ed25519 public key line".to_string();
    if line.chars().any(char::is_control) {
        return Err(invalid());
    }
    let mut parts = line.splitn(3, ' ');
    let (kind, blob) = (
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or_default(),
    );
    let blob_ok = !blob.is_empty()
        && blob
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=');
    if kind != "ssh-ed25519" || !blob_ok {
        return Err(invalid());
    }
    Ok((kind, blob))
}

/// `text` as one single-quoted POSIX shell word.
fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// `text` as octal escapes (`\163\163\150...`) for `printf`: digits and backslashes only, so
/// no shell between sshd and `sh` (fish included) can reinterpret it.
fn octal_escaped(text: &str) -> String {
    text.bytes().map(|b| format!("\\{b:03o}")).collect()
}

/// The command that adds `line` to `~/.ssh/authorized_keys` unless the same key (type and
/// base64, whatever its comment) is already there, creating `~/.ssh` (0700) and the file
/// (0600). It runs under `sh` whatever the login shell is, and prints [`ADDED`] or [`PRESENT`].
///
/// sshd hands the command to the user's login shell first. The script therefore contains no
/// single quote and no backslash other than `\n` and octal escapes, and the user's text (the
/// comment) only travels octal-escaped.
pub fn install_command(line: &str) -> Result<String, String> {
    let (kind, blob) = validate_public_line(line)?;
    let script = format!(
        concat!(
            "umask 077; set -e; ",
            "mkdir -p \"$HOME/.ssh\"; chmod 700 \"$HOME/.ssh\"; ",
            "f=\"$HOME/.ssh/authorized_keys\"; touch \"$f\"; chmod 600 \"$f\"; ",
            "if grep -qF -- \"{kind} {blob}\" \"$f\"; then echo {present}; else ",
            "if [ -s \"$f\" ] && [ -n \"$(tail -c 1 \"$f\")\" ]; then echo >> \"$f\"; fi; ",
            "printf \"{line}\\n\" >> \"$f\"; echo {added}; fi"
        ),
        kind = kind,
        blob = blob,
        line = octal_escaped(line),
        present = PRESENT,
        added = ADDED,
    );
    debug_assert!(!script.contains('\''));
    Ok(format!("sh -c {}", sh_quote(&script)))
}

fn failure(message: impl Into<String>) -> SshError {
    SshError::Connection {
        message: message.into(),
    }
}

/// Reads what the install command printed.
fn install_outcome(output: &str, exit_status: Option<u32>) -> Result<InstallOutcome, SshError> {
    if output.contains(PRESENT) {
        return Ok(InstallOutcome::AlreadyPresent);
    }
    if output.contains(ADDED) {
        return Ok(InstallOutcome::Added);
    }
    let tail: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let tail: String = tail[tail.len().saturating_sub(3)..]
        .join(" / ")
        .chars()
        .take(300)
        .collect();
    let status = exit_status.map_or(String::new(), |s| format!(" (exit status {s})"));
    Err(failure(if tail.is_empty() {
        format!("the key could not be installed{status}")
    } else {
        format!("the key could not be installed{status}: {tail}")
    }))
}

/// Runs `command` on `connection` and returns its output and exit status.
async fn run(
    connection: &Connection,
    command: &str,
    timeout: Duration,
) -> Result<(String, Option<u32>), SshError> {
    let mut channel = connection
        .channel_open_session()
        .await
        .map_err(|err| failure(format!("cannot run the install command: {err}")))?;
    channel
        .exec(true, command)
        .await
        .map_err(|err| failure(format!("cannot run the install command: {err}")))?;
    let mut output = Vec::new();
    let mut exit_status = None;
    let wait = async {
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    if output.len() < MAX_OUTPUT {
                        output.extend_from_slice(&data);
                    }
                }
                ChannelMsg::ExitStatus { exit_status: s } => exit_status = Some(s),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
    };
    tokio::time::timeout(timeout, wait).await.map_err(|_| {
        failure(format!(
            "the server did not answer within {} s",
            timeout.as_secs()
        ))
    })?;
    Ok((String::from_utf8_lossy(&output).into_owned(), exit_status))
}

/// Logs into `target` (known_hosts, jump hosts and saved passwords as for an SSH tab,
/// never changing saved passwords) and adds key `id` to its `authorized_keys`.
pub async fn install(
    store: &KeyStore,
    id: u32,
    ssh: &SshManager,
    target: SshTarget,
    trusted_fingerprint: Option<String>,
) -> Result<InstallOutcome, SshError> {
    let public_key = store
        .with(id, |key| key.public_key.clone())
        .ok_or_else(|| failure(KeygenError::UnknownKey.to_string()))?;
    let command = install_command(&public_key).map_err(failure)?;
    let Chain {
        connection, jumps, ..
    } = connect_authenticated(target, trusted_fingerprint, None, ssh.context(), None).await?;
    let result = run(&connection, &command, INSTALL_TIMEOUT).await;
    let _ = connection
        .disconnect(russh::Disconnect::ByApplication, "", "en")
        .await;
    disconnect_jumps(&jumps).await;
    let (output, exit_status) = result?;
    install_outcome(&output, exit_status)
}

/// Generates an Ed25519 key pair; only its public half and an id come back.
#[tauri::command]
pub async fn keygen_generate(
    passphrase: Option<String>,
    comment: Option<String>,
) -> Result<GeneratedKey, KeygenError> {
    // Encrypting runs bcrypt-pbkdf, which takes a while: keep it off the async runtime.
    tokio::task::spawn_blocking(move || {
        generate(
            &STORE,
            passphrase.as_deref(),
            comment.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|err| invalid(format!("key generation failed: {err}")))?
}

/// Saves key `id` as `path` (0600) and `path.pub` (0644); see [`save`].
#[tauri::command]
pub async fn keygen_save(
    id: u32,
    path: String,
    overwrite: Option<bool>,
) -> Result<(), KeygenError> {
    tokio::task::spawn_blocking(move || {
        save(&STORE, id, Path::new(&path), overwrite.unwrap_or(false))
    })
    .await
    .map_err(|err| invalid(format!("saving failed: {err}")))?
}

/// Adds key `id` to `~/.ssh/authorized_keys` on `target`; see [`install`].
#[tauri::command]
pub async fn keygen_install(
    id: u32,
    target: SshTarget,
    trusted_fingerprint: Option<String>,
    ssh: tauri::State<'_, SshManager>,
) -> Result<InstallOutcome, SshError> {
    install(&STORE, id, &ssh, target, trusted_fingerprint).await
}

/// Forgets key `id` (the generator dialog was closed).
#[tauri::command]
pub fn keygen_discard(id: u32) {
    STORE.discard(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::SshAuth;
    use crate::ssh::test_server::{self, PASSWORD};

    fn stored_private(store: &KeyStore, id: u32) -> String {
        store.with(id, |k| k.private_openssh.to_string()).unwrap()
    }

    #[test]
    fn generates_an_ed25519_key_whose_halves_parse_back() {
        let store = KeyStore::default();
        let key = generate(&store, None, " me@laptop ").unwrap();
        assert!(
            key.public_key.starts_with("ssh-ed25519 AAAA"),
            "{}",
            key.public_key
        );
        assert!(key.public_key.ends_with(" me@laptop"), "{}", key.public_key);
        let public = russh::keys::PublicKey::from_openssh(&key.public_key).unwrap();
        assert_eq!(public.algorithm(), Algorithm::Ed25519);
        assert_eq!(
            key.fingerprint,
            public.fingerprint(HashAlg::Sha256).to_string()
        );
        assert!(key.fingerprint.starts_with("SHA256:"));
        let private = PrivateKey::from_openssh(stored_private(&store, key.id)).unwrap();
        assert!(!private.is_encrypted());
        assert_eq!(private.public_key().key_data(), public.key_data());
        // Every generation is a new key.
        assert_ne!(
            generate(&store, None, "").unwrap().public_key,
            key.public_key
        );
    }

    #[test]
    fn a_passphrase_encrypts_the_private_key() {
        let store = KeyStore::default();
        let key = generate(&store, Some("correct horse"), "").unwrap();
        let private = PrivateKey::from_openssh(stored_private(&store, key.id)).unwrap();
        assert!(private.is_encrypted());
        assert!(private.decrypt("wrong").is_err());
        let decrypted = private.decrypt("correct horse").unwrap();
        assert_eq!(decrypted.public_key().to_openssh().unwrap(), key.public_key);
        // An empty passphrase means none.
        let plain = generate(&store, Some(""), "").unwrap();
        assert!(
            !PrivateKey::from_openssh(stored_private(&store, plain.id))
                .unwrap()
                .is_encrypted()
        );
    }

    #[test]
    fn rejects_comments_that_do_not_fit_on_one_line() {
        let store = KeyStore::default();
        for bad in ["a\nb".to_string(), "x".repeat(MAX_COMMENT + 1)] {
            assert!(
                matches!(
                    generate(&store, None, &bad),
                    Err(KeygenError::Invalid { .. })
                ),
                "{bad:?}"
            );
        }
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn saves_the_private_key_0600_and_the_public_key_0644() {
        let store = KeyStore::default();
        let key = generate(&store, None, "c").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("id_test");
        save(&store, key.id, &path, false).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            stored_private(&store, key.id)
        );
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .starts_with("-----BEGIN OPENSSH PRIVATE KEY-----")
        );
        assert_eq!(mode(&path), 0o600);
        let pub_path = dir.path().join("id_test.pub");
        assert_eq!(
            std::fs::read_to_string(&pub_path).unwrap(),
            format!("{}\n", key.public_key)
        );
        assert_eq!(mode(&pub_path), 0o644);
    }

    #[cfg(unix)]
    #[test]
    fn never_overwrites_without_being_asked_to() {
        let store = KeyStore::default();
        let key = generate(&store, None, "").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("id_test");
        let pub_path = public_path(&path);
        // Only the .pub exists: nothing is written at all.
        std::fs::write(&pub_path, "old pub").unwrap();
        assert_eq!(
            save(&store, key.id, &path, false),
            Err(KeygenError::Exists {
                path: pub_path.display().to_string()
            })
        );
        assert!(!path.exists());
        assert_eq!(std::fs::read_to_string(&pub_path).unwrap(), "old pub");
        // A world-readable file being replaced ends up 0600.
        std::fs::write(&path, "old key").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        assert_eq!(
            save(&store, key.id, &path, false),
            Err(KeygenError::Exists {
                path: path.display().to_string()
            })
        );
        save(&store, key.id, &path, true).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            stored_private(&store, key.id)
        );
        assert_eq!(mode(&path), 0o600);
        assert_eq!(
            std::fs::read_to_string(&pub_path).unwrap(),
            format!("{}\n", key.public_key)
        );
    }

    #[test]
    fn unknown_and_discarded_keys_cannot_be_saved() {
        let store = KeyStore::default();
        let key = generate(&store, None, "").unwrap();
        store.discard(key.id);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            save(&store, key.id, &dir.path().join("k"), false),
            Err(KeygenError::UnknownKey)
        );
        assert!(!dir.path().join("k").exists());
    }

    #[test]
    fn the_install_command_only_accepts_ed25519_public_key_lines() {
        for bad in [
            "",
            "ssh-rsa AAAA x",
            "ssh-ed25519",
            "ssh-ed25519 AAAA;rm -rf ~",
            "ssh-ed25519 AAAA$(id)",
            "ssh-ed25519 AAAA c\nrm -rf ~",
        ] {
            assert!(install_command(bad).is_err(), "{bad:?}");
        }
        assert!(install_command("ssh-ed25519 AAAA it's 'quoted' $(id)").is_ok());
    }

    /// Runs the install command for `line` under a local `sh` with `home` as `$HOME`.
    #[cfg(unix)]
    fn run_locally(line: &str, home: &Path) -> String {
        let command = install_command(line).unwrap();
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(&command)
            .env("HOME", home)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn the_install_command_appends_the_key_once_with_safe_modes() {
        let home = tempfile::tempdir().unwrap();
        let line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB/x+y= it's me $(touch pwned)";
        assert_eq!(run_locally(line, home.path()).trim(), ADDED);
        let file = home.path().join(".ssh/authorized_keys");
        assert_eq!(mode(&home.path().join(".ssh")), 0o700);
        assert_eq!(mode(&file), 0o600);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), format!("{line}\n"));
        assert!(!home.path().join("pwned").exists());
        // Again, even with another comment: already there, nothing added.
        assert_eq!(run_locally(line, home.path()).trim(), PRESENT);
        let renamed = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB/x+y= other";
        assert_eq!(run_locally(renamed, home.path()).trim(), PRESENT);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), format!("{line}\n"));
    }

    /// sshd hands the command to the user's login shell, which parses it before `sh -c`
    /// runs: the key line must arrive intact whatever that shell is (fish treats `\'` and
    /// `\\` as escapes even inside single quotes).
    #[cfg(unix)]
    #[test]
    fn the_install_command_survives_every_login_shell() {
        let comments = ["jorge's laptop", r"a\'b\\c", r#"x'"'"'y; touch pwned #"#, "plain", "$(id) `id` %s %n ~ * !!"];
        for shell in ["sh", "dash", "bash", "zsh", "fish"] {
            if std::process::Command::new(shell).arg("-c").arg("true").output().is_err() {
                eprintln!("{shell} not installed, skipped");
                continue;
            }
            for comment in comments {
                let home = tempfile::tempdir().unwrap();
                let line = format!("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB/x+y= {comment}");
                let output = std::process::Command::new(shell)
                    .arg("-c")
                    .arg(install_command(&line).unwrap())
                    .env("HOME", home.path())
                    .output()
                    .unwrap();
                assert!(output.status.success(), "{shell} {comment:?}: {output:?}");
                assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), ADDED, "{shell} {comment:?}");
                let written = std::fs::read_to_string(home.path().join(".ssh/authorized_keys")).unwrap();
                assert_eq!(written, format!("{line}\n"), "{shell} {comment:?}");
                assert!(!home.path().join("pwned").exists(), "{shell} {comment:?}");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_install_command_keeps_existing_keys_and_fixes_modes() {
        let home = tempfile::tempdir().unwrap();
        let ssh_dir = home.path().join(".ssh");
        std::fs::create_dir(&ssh_dir).unwrap();
        let file = ssh_dir.join("authorized_keys");
        // An existing last line without a newline must not be joined with the new key.
        std::fs::write(&file, "ssh-ed25519 AAAAold old").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        let line = "ssh-ed25519 AAAAnew new";
        assert_eq!(run_locally(line, home.path()).trim(), ADDED);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "ssh-ed25519 AAAAold old\nssh-ed25519 AAAAnew new\n"
        );
        assert_eq!(mode(&ssh_dir), 0o700);
        assert_eq!(mode(&file), 0o600);
    }

    #[test]
    fn reads_the_install_outcome() {
        assert_eq!(
            install_outcome("PLEXUSTERM_KEY_ADDED\n", Some(0)).unwrap(),
            InstallOutcome::Added
        );
        assert_eq!(
            install_outcome("PLEXUSTERM_KEY_PRESENT\n", Some(0)).unwrap(),
            InstallOutcome::AlreadyPresent
        );
        let err = install_outcome("chmod: Read-only file system\n", Some(1)).unwrap_err();
        assert_eq!(
            err.to_string(),
            "the key could not be installed (exit status 1): chmod: Read-only file system"
        );
    }

    #[tokio::test]
    async fn install_logs_in_and_runs_the_install_command() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let ssh = SshManager::new(dir.path().join("known_hosts"));
        let store = KeyStore::default();
        let key = generate(&store, None, "me").unwrap();
        let target = SshTarget {
            host: "127.0.0.1".into(),
            port: server.addr.port(),
            username: "tester".into(),
            auth: SshAuth::Password {
                password: PASSWORD.into(),
            },
            jumps: vec![],
        };
        // An unknown host is reported like for an SSH tab, before anything runs.
        let err = install(&store, key.id, &ssh, target.clone(), None)
            .await
            .unwrap_err();
        let SshError::UnknownHost { fingerprint, .. } = err else {
            panic!("{err:?}")
        };
        assert!(server.exec_commands().is_empty());
        // Trusted: the command runs (the fake server has no `sh`, so it fails like one without it).
        let err = install(&store, key.id, &ssh, target, Some(fingerprint))
            .await
            .unwrap_err();
        assert_eq!(
            server.exec_commands(),
            vec![install_command(&key.public_key).unwrap()]
        );
        assert!(
            err.to_string()
                .starts_with("the key could not be installed (exit status 127)"),
            "{err}"
        );
    }
}
