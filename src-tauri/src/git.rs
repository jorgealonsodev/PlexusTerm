//! The git branch of a terminal's folder, shown in its tab.
//!
//! Local folders are read straight from the repository files, without starting a `git` process:
//! walk up from the folder to the first `.git` (a folder, or a file `gitdir: <path>` in worktrees
//! and submodules) and read its `HEAD`. Remote folders (SSH tabs) run one read-only `git` command
//! over the session's existing connection.

use std::path::{Path, PathBuf};

/// `HEAD` is one short line; anything longer is not a `HEAD` file.
const MAX_HEAD_BYTES: u64 = 4096;
/// Longest branch name shown.
const MAX_BRANCH_CHARS: usize = 200;
/// A detached `HEAD` shows its commit abbreviated like `git rev-parse --short`.
const SHORT_HASH: usize = 7;

/// The branch checked out in the repository holding `folder` (the short commit hash when `HEAD`
/// is detached), or `None` outside a repository or when `HEAD` cannot be read or makes no sense.
pub fn branch_of(folder: &Path) -> Option<String> {
    let mut dir = Some(folder);
    while let Some(current) = dir {
        let dotgit = current.join(".git");
        if dotgit.is_dir() {
            return head_of(&dotgit);
        }
        if dotgit.is_file() {
            return head_of(&gitdir_of(&dotgit)?);
        }
        dir = current.parent();
    }
    None
}

/// The repository folder a `.git` file points to (`gitdir: <path>`, relative to the file's folder).
fn gitdir_of(file: &Path) -> Option<PathBuf> {
    let text = read_small(file)?;
    let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
    if target.is_empty() {
        return None;
    }
    Some(file.parent()?.join(target))
}

fn read_small(file: &Path) -> Option<String> {
    let meta = std::fs::metadata(file).ok()?;
    if !meta.is_file() || meta.len() > MAX_HEAD_BYTES {
        return None;
    }
    std::fs::read_to_string(file).ok()
}

/// The branch or short hash in `<gitdir>/HEAD`.
fn head_of(gitdir: &Path) -> Option<String> {
    parse_head(&read_small(&gitdir.join("HEAD"))?)
}

/// `ref: refs/heads/<branch>` gives the branch; a full object id gives its first 7 digits.
pub fn parse_head(text: &str) -> Option<String> {
    let line = text.lines().next()?.trim();
    if let Some(reference) = line.strip_prefix("ref:") {
        let reference = reference.trim();
        let name = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return clean_name(name);
    }
    let is_hash =
        (line.len() == 40 || line.len() == 64) && line.bytes().all(|b| b.is_ascii_hexdigit());
    is_hash.then(|| line[..SHORT_HASH].to_ascii_lowercase())
}

/// A name fit to show: not empty, no control characters, not absurdly long.
fn clean_name(name: &str) -> Option<String> {
    let ok = !name.is_empty()
        && name.chars().count() <= MAX_BRANCH_CHARS
        && !name.chars().any(char::is_control);
    ok.then(|| name.to_string())
}

/// Quotes `text` as one word for POSIX `sh`: `'it'\''s'`. Only `sh` reads it: see [`through_sh`].
fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// Standard base64 (RFC 4648, with padding).
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() {
                ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    out
}

/// A command that runs the `sh` `script` whatever the user's login shell is. The SSH server hands
/// the command to that shell first, and shells disagree on quoting (fish reads `\'` inside single
/// quotes as an escaped quote), so the login shell only sees base64 letters piped into `sh`.
fn through_sh(script: &str) -> String {
    format!(
        "echo {} | base64 -d | sh 2>/dev/null",
        base64(script.as_bytes())
    )
}

/// The read-only command that prints the branch of the remote `folder` (or its short commit when
/// detached), or nothing outside a repository or without git. It always ends with status 0, and
/// it runs through `sh` whatever the user's login shell is. `None` for a folder that cannot be
/// passed safely.
pub fn remote_command(folder: &str) -> Option<String> {
    if folder.is_empty() || folder.contains('\0') {
        return None;
    }
    let dir = quote(folder);
    let script = format!(
        "{{ git -C {dir} symbolic-ref --short -q HEAD || git -C {dir} rev-parse --short HEAD; }} 2>/dev/null; exit 0"
    );
    Some(through_sh(&script))
}

/// The branch printed by [`remote_command`], or `None` when it printed none.
pub fn parse_remote(output: &str) -> Option<String> {
    clean_name(output.lines().next()?.trim())
}

// ---------------------------------------------------------------------------------------------
// File status for the file lists (local Explorer and SFTP browser), coloured like VS Code.
// ---------------------------------------------------------------------------------------------

/// Most status entries kept for one list; the rest are dropped (e.g. thousands of ignored files).
pub const MAX_STATUS_ENTRIES: usize = 10_000;

/// A file's git status, named after VS Code's `Status` (extensions/git/src/api/git.d.ts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    IndexModified,
    IndexAdded,
    IndexDeleted,
    IndexRenamed,
    IndexCopied,
    IndexTypeChanged,
    Modified,
    Deleted,
    Untracked,
    Ignored,
    IntentToAdd,
    IntentToRename,
    TypeChanged,
    AddedByUs,
    AddedByThem,
    DeletedByUs,
    DeletedByThem,
    BothAdded,
    BothDeleted,
    BothModified,
}

/// One status of a path under the listed folder. `path` is relative to that folder, `/`-separated;
/// a trailing `/` marks a whole folder (untracked or ignored as a block), and an empty path means
/// the listed folder itself is covered (it sits inside such a folder).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
}

/// The statuses of `XY` in `git status --porcelain=v1` (both columns may give one each), mapped
/// like VS Code's `Repository` does: a conflict pair or `??`/`!!` is one status; otherwise the
/// index column (`X`) and the working tree column (`Y`) give one each.
pub fn statuses_of_code(x: u8, y: u8) -> Vec<FileStatus> {
    use FileStatus::*;
    let pair = match (x, y) {
        (b'?', b'?') => Some(Untracked),
        (b'!', b'!') => Some(Ignored),
        (b'D', b'D') => Some(BothDeleted),
        (b'A', b'U') => Some(AddedByUs),
        (b'U', b'D') => Some(DeletedByThem),
        (b'U', b'A') => Some(AddedByThem),
        (b'D', b'U') => Some(DeletedByUs),
        (b'A', b'A') => Some(BothAdded),
        (b'U', b'U') => Some(BothModified),
        _ => None,
    };
    if let Some(status) = pair {
        return vec![status];
    }
    let index = match x {
        b'M' => Some(IndexModified),
        b'A' => Some(IndexAdded),
        b'D' => Some(IndexDeleted),
        b'R' => Some(IndexRenamed),
        b'C' => Some(IndexCopied),
        b'T' => Some(IndexTypeChanged),
        _ => None,
    };
    let tree = match y {
        b'M' => Some(Modified),
        b'D' => Some(Deleted),
        b'A' => Some(IntentToAdd),
        b'R' => Some(IntentToRename),
        b'T' => Some(TypeChanged),
        _ => None,
    };
    index.into_iter().chain(tree).collect()
}

/// Parses what [`status_command`] prints: the listed folder's path inside its repository
/// (`git rev-parse --show-prefix`, e.g. `src/` or empty at the top) and a NUL, then
/// `git status --porcelain=v1 -z` (paths from the top of the repository; a rename or copy is
/// followed by its original path). Only paths under the folder are kept, relative to it, at most
/// [`MAX_STATUS_ENTRIES`]; a record cut short (output capped) and garbage are skipped.
pub fn parse_status(output: &[u8]) -> Vec<StatusEntry> {
    let Some(split) = output.iter().position(|&b| b == 0) else {
        return Vec::new();
    };
    let prefix = String::from_utf8_lossy(&output[..split]);
    let rest = &output[split + 1..];
    // Every complete record ends with a NUL; whatever follows the last one was cut.
    let complete = rest
        .iter()
        .rposition(|&b| b == 0)
        .map_or(&rest[..0], |end| &rest[..end]);
    let mut fields = complete.split(|&b| b == 0);
    let mut entries = Vec::new();
    while let Some(record) = fields.next() {
        if entries.len() >= MAX_STATUS_ENTRIES {
            break;
        }
        if record.len() < 4 || record[2] != b' ' {
            continue;
        }
        let (x, y) = (record[0], record[1]);
        if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            fields.next(); // The original path.
        }
        let path = String::from_utf8_lossy(&record[3..]);
        let Some(relative) = relative_to(&prefix, &path) else {
            continue;
        };
        for status in statuses_of_code(x, y) {
            if entries.len() < MAX_STATUS_ENTRIES {
                entries.push(StatusEntry {
                    path: relative.clone(),
                    status,
                });
            }
        }
    }
    entries
}

/// `path` (from the top of the repository) relative to the folder at `prefix`, or `None` when it
/// is not under it. A folder entry (`dir/`) that holds the listed folder covers it: `""`.
fn relative_to(prefix: &str, path: &str) -> Option<String> {
    if let Some(rest) = path.strip_prefix(prefix) {
        return Some(rest.to_string());
    }
    (path.ends_with('/') && prefix.starts_with(path)).then(String::new)
}

/// Bytes of `git status` output read for one local list.
const MAX_STATUS_BYTES: u64 = 8 * 1024 * 1024;

/// The statuses of the files under the local `folder`; empty outside a repository, without git,
/// or when git fails. Two read-only git runs: the folder's place in its repository, then the
/// status of that folder only (`-- .`), untracked and ignored folders reported as one entry
/// without walking into them, and no optional locks (never in the way of a git the user runs).
pub fn status_of(folder: &Path) -> Vec<StatusEntry> {
    if !folder.is_dir() {
        return Vec::new();
    }
    let Some(prefix) = run_git(folder, &["rev-parse", "--show-prefix"]) else {
        return Vec::new();
    };
    let Some(status) = run_git(folder, &STATUS_ARGS) else {
        return Vec::new();
    };
    let prefix = String::from_utf8_lossy(&prefix);
    let mut output = prefix.trim_end_matches('\n').as_bytes().to_vec();
    output.push(0);
    output.extend_from_slice(&status);
    parse_status(&output)
}

const STATUS_ARGS: [&str; 6] = [
    "status",
    "--porcelain=v1",
    "-z",
    "--ignored=matching",
    "--",
    ".",
];

/// Runs `git --no-optional-locks <args>` in `folder`; its stdout (at most [`MAX_STATUS_BYTES`]),
/// or `None` when git is missing or fails.
fn run_git(folder: &Path, args: &[&str]) -> Option<Vec<u8>> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let mut command = Command::new("git");
    command
        .arg("--no-optional-locks")
        .args(args)
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().ok()?;
    let mut out = Vec::new();
    let read = child
        .stdout
        .take()?
        .take(MAX_STATUS_BYTES)
        .read_to_end(&mut out);
    if out.len() as u64 >= MAX_STATUS_BYTES {
        // Capped: stop git rather than wait for output nobody reads.
        let _ = child.kill();
        let _ = child.wait();
        return Some(out);
    }
    let status = child.wait().ok()?;
    (read.is_ok() && status.success()).then_some(out)
}

/// The read-only command that prints what [`parse_status`] reads for the remote `folder`, or
/// nothing outside a repository or without git. It always ends with status 0 and runs through `sh`
/// whatever the user's login shell is. `None` for a folder that cannot be passed safely.
pub fn remote_status_command(folder: &str) -> Option<String> {
    if folder.is_empty() || folder.contains('\0') {
        return None;
    }
    let dir = quote(folder);
    let status = STATUS_ARGS.join(" ");
    let script = format!(
        "{{ p=$(git --no-optional-locks -C {dir} rev-parse --show-prefix) && printf '%s\\000' \"$p\" && git --no-optional-locks -C {dir} {status}; }} 2>/dev/null; exit 0"
    );
    Some(through_sh(&script))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo_with_head(head: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/HEAD"), head).unwrap();
        dir
    }

    #[test]
    fn reads_the_branch_of_a_repository() {
        let repo = repo_with_head("ref: refs/heads/main\n");
        assert_eq!(branch_of(repo.path()), Some("main".into()));
        let repo = repo_with_head("ref: refs/heads/feature/git-branch\n");
        assert_eq!(branch_of(repo.path()), Some("feature/git-branch".into()));
    }

    #[test]
    fn finds_the_repository_from_a_nested_folder() {
        let repo = repo_with_head("ref: refs/heads/develop\n");
        let nested = repo.path().join("src/features/deep");
        fs::create_dir_all(&nested).unwrap();
        assert_eq!(branch_of(&nested), Some("develop".into()));
    }

    #[test]
    fn a_detached_head_shows_the_short_commit() {
        let repo = repo_with_head("72e8845a1b2c3d4e5f60718293a4b5c6d7e8f901\n");
        assert_eq!(branch_of(repo.path()), Some("72e8845".into()));
        // SHA-256 repositories have 64-digit ids.
        let repo = repo_with_head(&format!("{}\n", "ab".repeat(32)));
        assert_eq!(branch_of(repo.path()), Some("abababa".into()));
    }

    #[test]
    fn follows_a_git_file_of_a_worktree_or_submodule() {
        let main = repo_with_head("ref: refs/heads/main\n");
        let gitdir = main.path().join(".git/worktrees/wt");
        fs::create_dir_all(&gitdir).unwrap();
        fs::write(gitdir.join("HEAD"), "ref: refs/heads/wt-branch\n").unwrap();
        let worktree = tempfile::tempdir().unwrap();
        fs::write(
            worktree.path().join(".git"),
            format!("gitdir: {}\n", gitdir.display()),
        )
        .unwrap();
        assert_eq!(branch_of(worktree.path()), Some("wt-branch".into()));

        // Submodules point with a relative path.
        let sub = main.path().join("vendor/lib");
        fs::create_dir_all(&sub).unwrap();
        let modules = main.path().join(".git/modules/lib");
        fs::create_dir_all(&modules).unwrap();
        fs::write(modules.join("HEAD"), "ref: refs/heads/stable\n").unwrap();
        fs::write(sub.join(".git"), "gitdir: ../../.git/modules/lib\n").unwrap();
        assert_eq!(branch_of(&sub), Some("stable".into()));
    }

    #[test]
    fn no_repository_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let inner = dir.path().join("a/b");
        fs::create_dir_all(&inner).unwrap();
        // The temporary folder itself is not inside a repository.
        assert_eq!(branch_of(&inner), None);
        assert_eq!(branch_of(Path::new("/definitely/not/here")), None);
    }

    #[test]
    fn an_unreadable_or_garbage_head_is_none_not_an_error() {
        assert_eq!(branch_of(repo_with_head("").path()), None);
        assert_eq!(branch_of(repo_with_head("garbage\n").path()), None);
        assert_eq!(branch_of(repo_with_head("ref: \n").path()), None);
        assert_eq!(
            branch_of(repo_with_head("ref: refs/heads/a\u{1b}[31mred\n").path()),
            None
        );
        assert_eq!(branch_of(repo_with_head(&"x".repeat(10_000)).path()), None);
        // HEAD missing, or a folder instead of a file.
        let repo = tempfile::tempdir().unwrap();
        fs::create_dir_all(repo.path().join(".git/HEAD")).unwrap();
        assert_eq!(branch_of(repo.path()), None);
        // A .git file that points nowhere.
        let broken = tempfile::tempdir().unwrap();
        fs::write(broken.path().join(".git"), "nonsense").unwrap();
        assert_eq!(branch_of(broken.path()), None);
    }

    /// The `sh` script a remote command carries, decoded by the system's `base64 -d` (which also
    /// checks [`base64`] against a real decoder).
    pub(super) fn sh_script(command: &str) -> String {
        let payload = command
            .strip_prefix("echo ")
            .and_then(|rest| rest.strip_suffix(" | base64 -d | sh 2>/dev/null"))
            .unwrap_or_else(|| panic!("{command}"));
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("echo {payload} | base64 -d"))
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap()
    }

    #[test]
    fn the_remote_command_quotes_the_folder_and_always_succeeds() {
        let script = sh_script(&remote_command("/srv/it's here").unwrap());
        assert!(script.contains(r"-C '/srv/it'\''s here'"), "{script}");
        assert!(script.contains("symbolic-ref --short -q HEAD") && script.ends_with("exit 0"));
        assert_eq!(remote_command(""), None);
        assert_eq!(remote_command("/a\0b"), None);
    }

    /// The command really runs in `sh` and prints the branch, here with a real git when there is one.
    #[cfg(unix)]
    #[test]
    fn the_remote_command_runs_in_sh() {
        let outside = tempfile::tempdir().unwrap();
        let dir = outside.path().join("it's a repo; $(touch pwned)");
        fs::create_dir_all(&dir).unwrap();
        let run = |folder: &Path| {
            let out = std::process::Command::new("sh")
                .arg("-c")
                .arg(remote_command(folder.to_str().unwrap()).unwrap())
                .output()
                .unwrap();
            assert!(out.status.success(), "{out:?}");
            parse_remote(&String::from_utf8(out.stdout).unwrap())
        };
        assert_eq!(run(&dir), None);
        assert!(!dir.join("pwned").exists() && !Path::new("pwned").exists());
        let has_git = std::process::Command::new("git")
            .arg("--version")
            .output()
            .is_ok();
        if has_git {
            let init = std::process::Command::new("git")
                .args(["init", "-q", "-b", "topic"])
                .current_dir(&dir)
                .output()
                .unwrap();
            assert!(init.status.success(), "{init:?}");
            assert_eq!(run(&dir), Some("topic".into()));
        }
    }

    #[test]
    fn parses_the_remote_output() {
        assert_eq!(parse_remote("main\n"), Some("main".into()));
        assert_eq!(parse_remote("a1b2c3d\n"), Some("a1b2c3d".into()));
        assert_eq!(parse_remote(""), None);
        assert_eq!(parse_remote("\n"), None);
    }
}

#[cfg(test)]
mod status_tests {
    use super::FileStatus::*;
    use super::*;
    use std::fs;
    use std::process::Command;

    fn has_git() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .is_ok_and(|o| o.status.success())
    }

    /// Runs git in `dir` without the user's or system's configuration.
    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args([
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@example.com",
                "-c",
                "commit.gpgsign=false",
            ])
            .args([
                "-c",
                "init.defaultBranch=main",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {out:?}");
    }

    /// A repository with `a.txt`, `src/lib.rs` and `src/deep/x.rs` committed.
    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q"]);
        fs::create_dir_all(p.join("src/deep")).unwrap();
        fs::write(p.join("a.txt"), "a\n").unwrap();
        fs::write(p.join("src/lib.rs"), "lib\n").unwrap();
        fs::write(p.join("src/deep/x.rs"), "x\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "init"]);
        dir
    }

    fn entry(path: &str, status: FileStatus) -> StatusEntry {
        StatusEntry {
            path: path.into(),
            status,
        }
    }

    fn sorted(mut entries: Vec<StatusEntry>) -> Vec<StatusEntry> {
        entries.sort_by(|a, b| {
            a.path
                .cmp(&b.path)
                .then((a.status as u8).cmp(&(b.status as u8)))
        });
        entries
    }

    #[test]
    fn maps_the_xy_codes_like_vs_code() {
        assert_eq!(statuses_of_code(b'?', b'?'), vec![Untracked]);
        assert_eq!(statuses_of_code(b'!', b'!'), vec![Ignored]);
        assert_eq!(statuses_of_code(b'M', b' '), vec![IndexModified]);
        assert_eq!(statuses_of_code(b' ', b'M'), vec![Modified]);
        assert_eq!(statuses_of_code(b'M', b'M'), vec![IndexModified, Modified]);
        assert_eq!(statuses_of_code(b'A', b' '), vec![IndexAdded]);
        assert_eq!(statuses_of_code(b'A', b'D'), vec![IndexAdded, Deleted]);
        assert_eq!(statuses_of_code(b'D', b' '), vec![IndexDeleted]);
        assert_eq!(statuses_of_code(b'R', b' '), vec![IndexRenamed]);
        assert_eq!(statuses_of_code(b'C', b'M'), vec![IndexCopied, Modified]);
        assert_eq!(statuses_of_code(b'T', b' '), vec![IndexTypeChanged]);
        assert_eq!(statuses_of_code(b' ', b'T'), vec![TypeChanged]);
        assert_eq!(statuses_of_code(b' ', b'A'), vec![IntentToAdd]);
        assert_eq!(statuses_of_code(b' ', b'R'), vec![IntentToRename]);
        assert_eq!(statuses_of_code(b' ', b'D'), vec![Deleted]);
        assert_eq!(statuses_of_code(b'D', b'D'), vec![BothDeleted]);
        assert_eq!(statuses_of_code(b'A', b'U'), vec![AddedByUs]);
        assert_eq!(statuses_of_code(b'U', b'D'), vec![DeletedByThem]);
        assert_eq!(statuses_of_code(b'U', b'A'), vec![AddedByThem]);
        assert_eq!(statuses_of_code(b'D', b'U'), vec![DeletedByUs]);
        assert_eq!(statuses_of_code(b'A', b'A'), vec![BothAdded]);
        assert_eq!(statuses_of_code(b'U', b'U'), vec![BothModified]);
        assert_eq!(statuses_of_code(b' ', b' '), Vec::<FileStatus>::new());
    }

    #[test]
    fn parses_renames_prefixes_and_drops_a_cut_record() {
        let out = b"src/\0 M src/a.rs\0R  src/new.rs\0src/old.rs\0?? src/tmp/\0 M other/b.rs\0!! src/target/\0 M src/cu";
        assert_eq!(
            parse_status(out),
            vec![
                entry("a.rs", Modified),
                entry("new.rs", IndexRenamed),
                entry("tmp/", Untracked),
                entry("target/", Ignored),
            ]
        );
        // Inside an ignored folder: the listed folder itself is covered.
        assert_eq!(
            parse_status(b"node_modules/pkg/\0!! node_modules/\0"),
            vec![entry("", Ignored)]
        );
        assert_eq!(parse_status(b"src/\0?? src/\0"), vec![entry("", Untracked)]);
        // Nothing before the prefix separator (not a repository): nothing.
        assert_eq!(parse_status(b""), vec![]);
        assert_eq!(parse_status(b" M a.rs\0"), vec![]);
        // Garbage records are skipped.
        assert_eq!(
            parse_status(b"\0x\0M\0 M ok\0"),
            vec![entry("ok", Modified)]
        );
    }

    #[test]
    fn caps_the_number_of_entries() {
        let mut out = b"\0".to_vec();
        for i in 0..(MAX_STATUS_ENTRIES + 50) {
            out.extend_from_slice(format!("!! ignored/{i}\0").as_bytes());
        }
        assert_eq!(parse_status(&out).len(), MAX_STATUS_ENTRIES);
    }

    #[test]
    fn reads_modified_staged_untracked_ignored_deleted_and_renamed_files() {
        if !has_git() {
            return;
        }
        let repo = repo();
        let p = repo.path();
        fs::write(p.join("a.txt"), "changed\n").unwrap();
        fs::write(p.join("src/lib.rs"), "staged\n").unwrap();
        git(p, &["add", "src/lib.rs"]);
        fs::write(p.join("new.txt"), "new\n").unwrap();
        fs::write(p.join(".gitignore"), "build/\n*.log\n").unwrap();
        fs::create_dir_all(p.join("build/out")).unwrap();
        fs::write(p.join("build/out/big.bin"), "x").unwrap();
        fs::write(p.join("debug.log"), "x").unwrap();
        git(p, &["mv", "src/deep/x.rs", "src/deep/y.rs"]);
        fs::write(p.join("added.txt"), "added\n").unwrap();
        git(p, &["add", "added.txt"]);
        let got = sorted(status_of(p));
        assert_eq!(
            got,
            sorted(vec![
                entry(".gitignore", Untracked),
                entry("a.txt", Modified),
                entry("added.txt", IndexAdded),
                entry("build/", Ignored),
                entry("debug.log", Ignored),
                entry("new.txt", Untracked),
                entry("src/deep/y.rs", IndexRenamed),
                entry("src/lib.rs", IndexModified),
            ])
        );
        fs::remove_file(p.join("a.txt")).unwrap();
        assert!(status_of(p).contains(&entry("a.txt", Deleted)));
        git(p, &["rm", "-q", "--cached", "src/lib.rs"]);
        assert!(status_of(p).contains(&entry("src/lib.rs", IndexDeleted)));
    }

    #[test]
    fn a_nested_folder_gets_paths_relative_to_it_and_only_its_own() {
        if !has_git() {
            return;
        }
        let repo = repo();
        let p = repo.path();
        fs::write(p.join("a.txt"), "changed\n").unwrap();
        fs::write(p.join("src/deep/x.rs"), "changed\n").unwrap();
        fs::write(p.join("src/new.rs"), "new\n").unwrap();
        assert_eq!(
            sorted(status_of(&p.join("src"))),
            vec![entry("deep/x.rs", Modified), entry("new.rs", Untracked)]
        );
        // Inside an untracked folder, everything is untracked.
        fs::create_dir_all(p.join("fresh/inner")).unwrap();
        fs::write(p.join("fresh/inner/f.txt"), "f").unwrap();
        assert_eq!(
            status_of(&p.join("fresh/inner")),
            vec![entry("", Untracked)]
        );
    }

    #[test]
    fn reads_a_conflict() {
        if !has_git() {
            return;
        }
        let repo = repo();
        let p = repo.path();
        git(p, &["checkout", "-q", "-b", "other"]);
        fs::write(p.join("a.txt"), "other\n").unwrap();
        git(p, &["commit", "-q", "-am", "other"]);
        git(p, &["checkout", "-q", "main"]);
        fs::write(p.join("a.txt"), "main\n").unwrap();
        git(p, &["commit", "-q", "-am", "main"]);
        let merge = Command::new("git")
            .args([
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@example.com",
                "merge",
                "-q",
                "other",
            ])
            .current_dir(p)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(!merge.status.success());
        assert_eq!(status_of(p), vec![entry("a.txt", BothModified)]);
    }

    #[test]
    fn outside_a_repository_or_without_the_folder_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "f").unwrap();
        assert_eq!(status_of(dir.path()), vec![]);
        assert_eq!(status_of(Path::new("/definitely/not/here")), vec![]);
    }

    #[test]
    fn the_remote_status_command_quotes_the_folder() {
        use super::tests::sh_script;
        let script = sh_script(&remote_status_command("/srv/it's here").unwrap());
        assert!(script.contains(r"-C '/srv/it'\''s here'"), "{script}");
        assert!(script.contains("--porcelain=v1") && script.ends_with("exit 0"));
        assert_eq!(remote_status_command(""), None);
        assert_eq!(remote_status_command("/a\0b"), None);
    }

    /// What the login shell reads is only `echo <base64> | base64 -d | sh`: fish, bash, zsh and
    /// tcsh all read that the same way, whatever the folder name holds.
    #[test]
    fn the_login_shell_only_sees_base64_letters() {
        for folder in [
            "/tmp/x\\';touch PWN_A;echo '",
            "/tmp/x\\'(touch PWN_B)",
            "/a b/$(c)`d`",
            "x&calc&y",
        ] {
            for command in [
                remote_command(folder).unwrap(),
                remote_status_command(folder).unwrap(),
            ] {
                let payload = command
                    .strip_prefix("echo ")
                    .and_then(|rest| rest.strip_suffix(" | base64 -d | sh 2>/dev/null"))
                    .unwrap_or_else(|| panic!("{command}"));
                assert!(
                    payload
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c)),
                    "{command}"
                );
            }
        }
    }

    /// The fish reproduction from the verifier: a folder name with `\'` runs nothing in fish.
    #[cfg(unix)]
    #[test]
    fn a_hostile_folder_name_runs_nothing_when_the_login_shell_is_fish() {
        let Ok(fish) = which_fish() else { return };
        let outside = tempfile::tempdir().unwrap();
        for folder in ["x\\';touch PWN_A;echo '", "x\\'(touch PWN_B)"] {
            for command in [
                remote_command(folder).unwrap(),
                remote_status_command(folder).unwrap(),
            ] {
                let out = Command::new(&fish)
                    .args(["--no-config", "-c", &command])
                    .current_dir(outside.path())
                    .output()
                    .unwrap();
                assert!(out.status.success(), "{out:?}");
            }
        }
        for leaked in ["PWN_A", "PWN_B"] {
            assert!(
                !outside.path().join(leaked).exists(),
                "{leaked} was created"
            );
        }
    }

    #[cfg(unix)]
    fn which_fish() -> Result<std::path::PathBuf, ()> {
        std::env::var_os("PATH")
            .and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|p| p.join("fish"))
                    .find(|p| p.is_file())
            })
            .ok_or(())
    }

    /// Run in `sh`, a hostile folder name runs nothing, and the output is the local one.
    #[cfg(unix)]
    #[test]
    fn the_remote_status_command_runs_in_sh_and_a_hostile_name_runs_nothing() {
        let outside = tempfile::tempdir().unwrap();
        let dir = outside
            .path()
            .join("it's a repo; $(touch pwned) `touch pwned2`");
        fs::create_dir_all(&dir).unwrap();
        let run = |folder: &Path| {
            let out = Command::new("sh")
                .arg("-c")
                .arg(remote_status_command(folder.to_str().unwrap()).unwrap())
                .current_dir(outside.path())
                .output()
                .unwrap();
            assert!(out.status.success(), "{out:?}");
            parse_status(&out.stdout)
        };
        assert_eq!(run(&dir), vec![]);
        if has_git() {
            git(&dir, &["init", "-q"]);
            fs::create_dir_all(dir.join("sub")).unwrap();
            fs::write(dir.join("sub/new.txt"), "n").unwrap();
            fs::write(dir.join("top.txt"), "t").unwrap();
            assert_eq!(
                sorted(run(&dir)),
                vec![entry("sub/", Untracked), entry("top.txt", Untracked)]
            );
            // Inside the untracked folder, the whole folder is untracked.
            assert_eq!(run(&dir.join("sub")), vec![entry("", Untracked)]);
        }
        for leaked in ["pwned", "pwned2"] {
            assert!(!dir.join(leaked).exists() && !outside.path().join(leaked).exists());
        }
    }
}
