//! File operations on the local disk for the sidebar's Local tab.
//!
//! Entries have the same shape as the SFTP browser's, so both panels share their dialogs.
//! Paths are native strings (`/home/me` or `C:\Users\me`); errors read
//! `cannot <action> <path>: <cause>`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::platform;
use crate::sftp::commands::{OpenWith, launch};
use crate::sftp::{Entry, EntryKind, MAX_MODE};

fn failure(action: &str, path: &Path, err: impl std::fmt::Display) -> String {
    format!("cannot {action} {}: {err}", path.display())
}

fn entry_of(path: &Path, name: String) -> Result<Entry, std::io::Error> {
    let link = fs::symlink_metadata(path)?;
    // A symlink keeps its kind; its size and date are those of the file it points to, when it exists.
    let meta = if link.file_type().is_symlink() {
        fs::metadata(path).unwrap_or(link.clone())
    } else {
        link.clone()
    };
    let kind = if link.file_type().is_symlink() {
        EntryKind::Symlink
    } else if meta.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs());
    #[cfg(unix)]
    let (permissions, uid, gid) = {
        use std::os::unix::fs::MetadataExt;
        (
            Some(link.mode() & MAX_MODE),
            Some(link.uid()),
            Some(link.gid()),
        )
    };
    #[cfg(not(unix))]
    let (permissions, uid, gid) = (None, None, None);
    Ok(Entry {
        name,
        path: path.to_string_lossy().into_owned(),
        kind,
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
        permissions,
        uid,
        gid,
        user: None,
        group: None,
    })
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// The user's home folder.
pub fn home() -> Result<String, String> {
    platform::home_dir()
        .map(|home| home.to_string_lossy().into_owned())
        .ok_or_else(|| "cannot resolve the home folder".to_string())
}

/// Lists `path`: folders first, then by case-insensitive name. Unreadable entries are skipped.
pub fn list(path: &Path) -> Result<Vec<Entry>, String> {
    let dir = fs::read_dir(path).map_err(|err| failure("list", path, err))?;
    let mut entries: Vec<Entry> = dir
        .filter_map(Result::ok)
        .filter_map(|item| {
            entry_of(
                &item.path(),
                item.file_name().to_string_lossy().into_owned(),
            )
            .ok()
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

/// One file or folder; a symlink is reported as such.
pub fn stat(path: &Path) -> Result<Entry, String> {
    entry_of(path, name_of(path)).map_err(|err| failure("read", path, err))
}

pub fn mkdir(path: &Path) -> Result<(), String> {
    fs::create_dir(path).map_err(|err| failure("create", path, err))
}

/// Creates an empty file; fails if anything already has that name.
pub fn create_file(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(drop)
        .map_err(|err| failure("create", path, err))
}

/// Renames `from` to `to`; never replaces an existing `to`.
pub fn rename(from: &Path, to: &Path) -> Result<(), String> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(failure(
            "rename",
            from,
            format!("{} already exists", to.display()),
        ));
    }
    fs::rename(from, to).map_err(|err| failure("rename", from, err))
}

/// Moves `from` into the folder `dir`, keeping its name, and returns where it ended up.
/// Never replaces an existing entry, and never moves a folder into itself or one of its subfolders.
pub fn move_into(from: &Path, dir: &Path) -> Result<PathBuf, String> {
    let from = without_trailing_separators(from);
    let dir = without_trailing_separators(dir);
    let name = from
        .file_name()
        .ok_or_else(|| failure("move", &from, "not a file name"))?;
    if dir.starts_with(&from) {
        return Err(failure(
            "move",
            &from,
            "a folder cannot be moved into itself",
        ));
    }
    if from.parent() == Some(dir.as_path()) {
        return Err(failure(
            "move",
            &from,
            format!("it is already in {}", dir.display()),
        ));
    }
    let to = dir.join(name);
    if fs::symlink_metadata(&to).is_ok() {
        return Err(failure(
            "move",
            &from,
            format!("{} already exists", to.display()),
        ));
    }
    fs::rename(&from, &to).map_err(|err| failure("move", &from, err))?;
    Ok(to)
}

/// `name` in `dir`, or the first free "name copy", "name copy 2"... (before the extension), as VS
/// Code names a pasted copy.
fn free_name(dir: &Path, name: &std::ffi::OsStr, is_dir: bool) -> PathBuf {
    let first = dir.join(name);
    if fs::symlink_metadata(&first).is_err() {
        return first;
    }
    let name = name.to_string_lossy();
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 && !is_dir => (&name[..dot], &name[dot..]),
        _ => (&name[..], ""),
    };
    (1..)
        .map(|n| {
            let suffix = if n == 1 { " copy".to_string() } else { format!(" copy {n}") };
            dir.join(format!("{stem}{suffix}{ext}"))
        })
        .find(|candidate| fs::symlink_metadata(candidate).is_err())
        .expect("a free name")
}

fn copy_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        // A link is copied as a link, never as what it points to.
        #[cfg(unix)]
        return std::os::unix::fs::symlink(fs::read_link(from)?, to);
        #[cfg(not(unix))]
        return fs::copy(from, to).map(|_| ());
    }
    if meta.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        return Ok(());
    }
    fs::copy(from, to).map(|_| ())
}

/// Copies `from` (a file, or a folder with everything inside it) into the folder `dir`, and returns
/// where the copy is. An existing entry is never replaced: the copy takes the name "name copy"
/// (then "name copy 2"...). A folder cannot be copied into itself.
pub fn copy_into(from: &Path, dir: &Path) -> Result<PathBuf, String> {
    let from = without_trailing_separators(from);
    let dir = without_trailing_separators(dir);
    let name = from
        .file_name()
        .ok_or_else(|| failure("copy", &from, "not a file name"))?;
    if dir.starts_with(&from) {
        return Err(failure("copy", &from, "a folder cannot be copied into itself"));
    }
    let is_dir = fs::symlink_metadata(&from)
        .map_err(|err| failure("copy", &from, err))?
        .is_dir();
    let to = free_name(&dir, name, is_dir);
    if let Err(err) = copy_entry(&from, &to) {
        // A copy that stopped half-way is removed rather than left incomplete.
        let _ = if is_dir { fs::remove_dir_all(&to) } else { fs::remove_file(&to) };
        return Err(failure("copy", &from, err));
    }
    Ok(to)
}

/// Replaces the text of the existing file `path` with `content`, but only while it still holds
/// `expected` (the text that was opened), so changes made by someone else are never lost.
/// Writes in place, so a symlink, the file's mode and its owner are kept.
/// `encoding` is the id to write with (`None`: UTF-8); `expected_encoding` the one `expected` was
/// decoded with (`None`: the same as `encoding`).
pub fn write_text(
    path: &Path,
    expected: &str,
    content: &str,
    encoding: Option<&str>,
    expected_encoding: Option<&str>,
) -> Result<(), String> {
    use std::io::Write;
    let label = path.to_string_lossy();
    // Encoded first: characters the encoding cannot hold leave the file untouched.
    let bytes = encode_text(&label, content, encoding)?;
    let (current, truncated) = read_prefix(path, MAX_VIEW_BYTES)
        .map_err(|err| err.replacen("cannot read", "cannot save", 1))?;
    check_unchanged(
        &label,
        current,
        truncated,
        expected,
        expected_encoding.or(encoding),
    )?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|err| failure("save", path, err))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|err| failure("save", path, err))
}

/// Removes a file, a symlink (never what it points to), or a folder with everything inside it.
pub fn remove(path: &Path, is_dir: bool) -> Result<(), String> {
    // `link/` would resolve the symlink and delete what it points to.
    let path = &without_trailing_separators(path);
    let link = fs::symlink_metadata(path).map_err(|err| failure("delete", path, err))?;
    let result = if is_dir && link.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|err| failure("delete", path, err))
}

/// `path` without trailing `/` (or `\` on Windows); a root keeps its separator.
fn without_trailing_separators(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    let trimmed = text.trim_end_matches(std::path::is_separator);
    if trimmed.is_empty() || trimmed.ends_with(':') {
        return path.to_path_buf();
    }
    PathBuf::from(trimmed)
}

pub fn chmod(path: &Path, mode: u32) -> Result<(), String> {
    const ACTION: &str = "change permissions of";
    if mode > MAX_MODE {
        return Err(failure(ACTION, path, format!("invalid mode {mode:#o}")));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|err| failure(ACTION, path, err))
    }
    #[cfg(not(unix))]
    {
        Err(failure(ACTION, path, "not supported on this system"))
    }
}

/// Bytes read from one file attached to an AI question; the rest is left out.
pub const MAX_ATTACH_BYTES: usize = 64 * 1024;
/// Entries of a folder attached to an AI question.
const MAX_ATTACH_ENTRIES: usize = 500;
/// Bytes of a file shown in the file viewer; the rest is left out.
pub const MAX_VIEW_BYTES: usize = 4 * 1024 * 1024;

/// A file's text (or a folder's listing) attached to an AI question.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    /// The file is longer than what was read.
    pub truncated: bool,
    /// Id of the encoding `content` was decoded with (`utf-8`, `utf-16le`, `windows-1252`...).
    pub encoding: String,
}

/// The text of the first bytes of a file; refused when they hold a NUL byte or invalid UTF-8
/// (a character cut by the size limit is dropped, not refused).
pub fn text_from(path: &str, bytes: Vec<u8>, truncated: bool) -> Result<TextFile, String> {
    text_for("attach", path, bytes, truncated)
}

/// [`text_from`] for another action (`view`): its errors say `cannot <verb> <path>: ...`.
pub fn text_for(
    verb: &str,
    path: &str,
    bytes: Vec<u8>,
    truncated: bool,
) -> Result<TextFile, String> {
    let not_text = || format!("cannot {verb} {path}: it is not a text file");
    if bytes.contains(&0) {
        return Err(not_text());
    }
    let content = utf8(bytes, truncated).ok_or_else(not_text)?;
    Ok(TextFile {
        path: path.to_string(),
        content,
        truncated,
        encoding: "utf-8".to_string(),
    })
}

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
const UTF16LE_BOM: &[u8] = b"\xFF\xFE";
const UTF16BE_BOM: &[u8] = b"\xFE\xFF";
/// Ids of the non-Unicode encodings, as `encoding_rs` labels.
const LEGACY_ENCODINGS: [&str; 11] = [
    "windows-1252",
    "iso-8859-15",
    "iso-8859-2",
    "windows-1250",
    "windows-1251",
    "koi8-r",
    "shift_jis",
    "euc-jp",
    "gbk",
    "big5",
    "euc-kr",
];

/// How the text of one encoding id is read and written.
#[derive(Clone, Copy)]
enum Codec {
    Utf8,
    Utf8Bom,
    Utf16 { little_endian: bool },
    Legacy(&'static encoding_rs::Encoding),
}

fn codec_of(verb: &str, path: &str, id: &str) -> Result<Codec, String> {
    let codec = match id {
        "utf-8" => Some(Codec::Utf8),
        "utf-8-bom" => Some(Codec::Utf8Bom),
        "utf-16le" => Some(Codec::Utf16 {
            little_endian: true,
        }),
        "utf-16be" => Some(Codec::Utf16 {
            little_endian: false,
        }),
        _ if LEGACY_ENCODINGS.contains(&id) => {
            encoding_rs::Encoding::for_label(id.as_bytes()).map(Codec::Legacy)
        }
        _ => None,
    };
    codec.ok_or_else(|| format!("cannot {verb} {path}: unknown encoding {id}"))
}

/// Strict UTF-8; when `truncated`, a character cut at the end is dropped.
fn utf8(bytes: Vec<u8>, truncated: bool) -> Option<String> {
    match String::from_utf8(bytes) {
        Ok(text) => Some(text),
        Err(err) if truncated && err.utf8_error().error_len().is_none() => {
            let valid = err.utf8_error().valid_up_to();
            let mut bytes = err.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).ok()
        }
        Err(_) => None,
    }
}

/// UTF-16 without its BOM; when `truncated`, an odd final byte or a cut surrogate pair is dropped.
fn utf16(bytes: &[u8], truncated: bool, little_endian: bool) -> Option<String> {
    if bytes.len() % 2 == 1 && !truncated {
        return None;
    }
    // An odd final byte (only possible when truncated) is left out.
    let (pairs, _) = bytes.as_chunks::<2>();
    let mut units: Vec<u16> = pairs
        .iter()
        .map(|&pair| {
            if little_endian {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect();
    if truncated
        && units
            .last()
            .is_some_and(|unit| (0xD800..0xDC00).contains(unit))
    {
        units.pop();
    }
    char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .ok()
}

/// A non-Unicode encoding; when `truncated`, a multibyte character cut at the end is dropped.
fn legacy(
    encoding: &'static encoding_rs::Encoding,
    bytes: &[u8],
    truncated: bool,
) -> Option<String> {
    let mut decoder = encoding.new_decoder_without_bom_handling();
    let mut text =
        String::with_capacity(decoder.max_utf8_buffer_length_without_replacement(bytes.len())?);
    // Not the last chunk when truncated: an incomplete final sequence stays buffered, unreported.
    let (result, _) = decoder.decode_to_string_without_replacement(bytes, &mut text, !truncated);
    matches!(result, encoding_rs::DecoderResult::InputEmpty).then_some(text)
}

/// The text of the first bytes of a file decoded with the encoding id `encoding`; `None` detects a
/// UTF-8 or UTF-16 BOM (left out of the text) and otherwise reads UTF-8 like [`text_for`].
/// A character cut by the size limit is dropped, not refused.
pub fn decode_text(
    verb: &str,
    path: &str,
    bytes: Vec<u8>,
    truncated: bool,
    encoding: Option<&str>,
) -> Result<TextFile, String> {
    let not_text = || format!("cannot {verb} {path}: it is not a text file");
    let Some(id) = encoding else {
        let detected = if bytes.starts_with(UTF8_BOM) {
            "utf-8-bom"
        } else if bytes.starts_with(UTF16LE_BOM) {
            "utf-16le"
        } else if bytes.starts_with(UTF16BE_BOM) {
            "utf-16be"
        } else {
            return text_for(verb, path, bytes, truncated);
        };
        return decode_text(verb, path, bytes, truncated, Some(detected)).map_err(|_| not_text());
    };
    let codec = codec_of(verb, path, id)?;
    let malformed = || format!("cannot {verb} {path}: it is not a text file in {id}");
    if !matches!(codec, Codec::Utf16 { .. }) && bytes.contains(&0) {
        return Err(not_text());
    }
    let content = match codec {
        Codec::Utf8 => utf8(bytes, truncated).ok_or_else(not_text)?,
        Codec::Utf8Bom => {
            let body = bytes.strip_prefix(UTF8_BOM).unwrap_or(&bytes).to_vec();
            utf8(body, truncated).ok_or_else(not_text)?
        }
        Codec::Utf16 { little_endian } => {
            let bom = if little_endian {
                UTF16LE_BOM
            } else {
                UTF16BE_BOM
            };
            let body = bytes.strip_prefix(bom).unwrap_or(&bytes);
            utf16(body, truncated, little_endian).ok_or_else(malformed)?
        }
        Codec::Legacy(encoding) => legacy(encoding, &bytes, truncated).ok_or_else(malformed)?,
    };
    Ok(TextFile {
        path: path.to_string(),
        content,
        truncated,
        encoding: id.to_string(),
    })
}

/// `content` as the bytes of the encoding id `encoding` (`None`: UTF-8), with the BOM of UTF-8 with
/// BOM and UTF-16. Refused when the encoding cannot hold some of its characters.
pub fn encode_text(path: &str, content: &str, encoding: Option<&str>) -> Result<Vec<u8>, String> {
    let id = encoding.unwrap_or("utf-8");
    Ok(match codec_of("save", path, id)? {
        Codec::Utf8 => content.as_bytes().to_vec(),
        Codec::Utf8Bom => [UTF8_BOM, content.as_bytes()].concat(),
        // encoding_rs only decodes UTF-16.
        Codec::Utf16 { little_endian } => {
            let bom = if little_endian {
                UTF16LE_BOM
            } else {
                UTF16BE_BOM
            };
            let units = content.encode_utf16().flat_map(|unit| {
                if little_endian {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                }
            });
            bom.iter().copied().chain(units).collect()
        }
        Codec::Legacy(encoding) => {
            let (bytes, _, unmappable) = encoding.encode(content);
            if unmappable {
                return Err(format!(
                    "cannot save {path}: some characters cannot be written in {id}"
                ));
            }
            bytes.into_owned()
        }
    })
}

/// Whether `current` (the first bytes of a file, read up to [`MAX_VIEW_BYTES`]) still holds the
/// text `expected` once decoded with `encoding`; refused as changed on disk otherwise.
pub fn check_unchanged(
    path: &str,
    current: Vec<u8>,
    truncated: bool,
    expected: &str,
    encoding: Option<&str>,
) -> Result<(), String> {
    let id = encoding.unwrap_or("utf-8");
    codec_of("save", path, id)?;
    let unchanged = !truncated
        && decode_text("save", path, current, false, Some(id))
            .is_ok_and(|text| text.content == expected);
    if unchanged {
        Ok(())
    } else {
        Err(format!(
            "cannot save {path}: it changed on disk since it was opened"
        ))
    }
}

/// A folder's entries as text, one per line, folders ending in `/`.
pub fn listing_text(path: &str, entries: &[Entry]) -> TextFile {
    let lines: Vec<String> = entries
        .iter()
        .take(MAX_ATTACH_ENTRIES)
        .map(|entry| match entry.kind {
            EntryKind::Dir => format!("{}/", entry.name),
            _ => entry.name.clone(),
        })
        .collect();
    TextFile {
        path: path.to_string(),
        content: lines.join("\n"),
        truncated: entries.len() > MAX_ATTACH_ENTRIES,
        encoding: "utf-8".to_string(),
    }
}

/// The first [`MAX_ATTACH_BYTES`] of a text file, or a folder's listing.
pub fn read_text(path: &Path) -> Result<TextFile, String> {
    let label = path.to_string_lossy().into_owned();
    if fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false) {
        return Ok(listing_text(&label, &list(path)?));
    }
    let (bytes, truncated) = read_prefix(path, MAX_ATTACH_BYTES)?;
    text_from(&label, bytes, truncated)
}

/// The first [`MAX_VIEW_BYTES`] of a text file, for the file viewer, decoded with the encoding id
/// `encoding` (`None`: detected, see [`decode_text`]).
pub fn view_text(path: &Path, encoding: Option<&str>) -> Result<TextFile, String> {
    let label = path.to_string_lossy().into_owned();
    if fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(format!("cannot view {label}: it is a folder"));
    }
    let (bytes, truncated) = read_prefix(path, MAX_VIEW_BYTES)?;
    decode_text("view", &label, bytes, truncated, encoding)
}

/// Largest image the Markdown preview shows.
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];

/// Whether a path names an image, by its extension: a Markdown file may point anywhere, so the
/// preview reads nothing else (not a key or a document named in an image link).
pub fn is_image_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|known| ext.eq_ignore_ascii_case(known))
        })
}

pub fn not_an_image(path: &str) -> String {
    format!("cannot show {path}: it is not an image")
}

pub fn image_too_large(path: &str) -> String {
    format!(
        "cannot show {path}: it is larger than {} MiB",
        MAX_IMAGE_BYTES / (1024 * 1024)
    )
}

/// The bytes of an image file a Markdown file shows, up to [`MAX_IMAGE_BYTES`].
pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let label = path.to_string_lossy().into_owned();
    // A network share or a device is never opened: Windows would sign in to the share's host with
    // the user's credentials. Only a regular file is read (a FIFO would never end).
    let remote = label.starts_with(r"\\") || label.starts_with("//");
    if remote || !is_image_path(&label) || !fs::metadata(path).is_ok_and(|m| m.is_file()) {
        return Err(not_an_image(&label));
    }
    let (bytes, truncated) = read_prefix(path, MAX_IMAGE_BYTES)?;
    if truncated {
        return Err(image_too_large(&label));
    }
    Ok(bytes)
}

/// The first `max` bytes of a file, and whether it is longer.
fn read_prefix(path: &Path, max: usize) -> Result<(Vec<u8>, bool), String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|err| failure("read", path, err))?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| failure("read", path, err))?;
    let truncated = bytes.len() > max;
    bytes.truncate(max);
    Ok((bytes, truncated))
}

fn native(path: &str) -> PathBuf {
    platform::expand_home(path)
}

#[tauri::command]
pub async fn local_home() -> Result<String, String> {
    home()
}

#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<Entry>, String> {
    list(&native(&path))
}

#[tauri::command]
pub async fn local_stat(path: String) -> Result<Entry, String> {
    stat(&native(&path))
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    mkdir(&native(&path))
}

#[tauri::command]
pub async fn local_create_file(path: String) -> Result<(), String> {
    create_file(&native(&path))
}

#[tauri::command]
pub async fn local_rename(from: String, to: String) -> Result<(), String> {
    rename(&native(&from), &native(&to))
}

#[tauri::command]
pub async fn local_remove(path: String, is_dir: bool) -> Result<(), String> {
    remove(&native(&path), is_dir)
}

#[tauri::command]
pub async fn local_chmod(path: String, mode: u32) -> Result<(), String> {
    chmod(&native(&path), mode)
}

/// A local file's text (or a folder's listing) to attach to an AI question.
#[tauri::command]
pub async fn local_read_text(path: String) -> Result<TextFile, String> {
    read_text(&native(&path))
}

/// A local text file for the file viewer.
#[tauri::command]
pub async fn local_view_text(path: String, encoding: Option<String>) -> Result<TextFile, String> {
    view_text(&native(&path), encoding.as_deref())
}

/// A local image for the Markdown preview, as raw bytes.
#[tauri::command]
pub async fn local_read_image(path: String) -> Result<tauri::ipc::Response, String> {
    read_image(&native(&path)).map(tauri::ipc::Response::new)
}

/// Saves the file viewer's text over a local file that still holds `expected`.
#[tauri::command]
pub async fn local_write_text(
    path: String,
    expected: String,
    content: String,
    encoding: Option<String>,
    expected_encoding: Option<String>,
) -> Result<(), String> {
    write_text(
        &native(&path),
        &expected,
        &content,
        encoding.as_deref(),
        expected_encoding.as_deref(),
    )
}

/// Copies a local file or folder into another folder; returns the copy's path.
#[tauri::command]
pub async fn local_copy(from: String, dir: String) -> Result<String, String> {
    copy_into(&native(&from), &native(&dir)).map(|to| to.to_string_lossy().into_owned())
}

/// Moves a local file or folder into another folder; returns its new path.
#[tauri::command]
pub async fn local_move(from: String, dir: String) -> Result<String, String> {
    move_into(&native(&from), &native(&dir)).map(|to| to.to_string_lossy().into_owned())
}

/// Opens a local file in its default program, the text editor or a chosen program.
#[tauri::command]
pub async fn local_open(path: String, with: OpenWith) -> Result<(), String> {
    launch(&with, &native(&path)).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_folders_first_then_by_case_insensitive_name() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("b.txt"), "hello").unwrap();
        fs::write(dir.path().join("A.txt"), "").unwrap();
        fs::create_dir(dir.path().join("zeta")).unwrap();
        fs::create_dir(dir.path().join("Alpha")).unwrap();
        let entries = list(dir.path()).unwrap();
        assert_eq!(names(&entries), ["Alpha", "zeta", "A.txt", "b.txt"]);
        let b = &entries[3];
        assert_eq!(b.kind, EntryKind::File);
        assert_eq!(b.size, 5);
        assert_eq!(b.path, dir.path().join("b.txt").to_string_lossy());
        assert!(b.modified.is_some());
        assert_eq!(entries[0].kind, EntryKind::Dir);
    }

    #[test]
    fn listing_a_missing_folder_names_it() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        let err = list(&missing).unwrap_err();
        assert!(
            err.starts_with(&format!("cannot list {}: ", missing.display())),
            "{err}"
        );
    }

    #[test]
    fn stat_reports_a_folder_and_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        fs::write(&file, "abc").unwrap();
        assert_eq!(stat(dir.path()).unwrap().kind, EntryKind::Dir);
        let entry = stat(&file).unwrap();
        assert_eq!(
            (entry.name.as_str(), entry.kind, entry.size),
            ("f", EntryKind::File, 3)
        );
        assert!(
            stat(&dir.path().join("x"))
                .unwrap_err()
                .starts_with("cannot read ")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_reported_and_removed_without_its_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), "").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(stat(&link).unwrap().kind, EntryKind::Symlink);
        remove(&link, true).unwrap();
        assert!(!link.exists());
        assert!(target.join("keep").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_trailing_slash_never_deletes_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), "").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        remove(Path::new(&format!("{}/", link.display())), true).unwrap();
        assert!(fs::symlink_metadata(&link).is_err(), "the link is removed");
        assert!(target.join("keep").exists(), "its target is kept");
    }

    #[test]
    fn creates_renames_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("new");
        mkdir(&folder).unwrap();
        assert!(mkdir(&folder).unwrap_err().starts_with("cannot create "));
        let file = folder.join("a.txt");
        create_file(&file).unwrap();
        assert!(
            create_file(&file)
                .unwrap_err()
                .starts_with("cannot create ")
        );
        let other = folder.join("b.txt");
        create_file(&other).unwrap();
        let err = rename(&file, &other).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert!(file.exists());
        rename(&file, &folder.join("c.txt")).unwrap();
        assert!(folder.join("c.txt").exists() && !file.exists());
        remove(&other, false).unwrap();
        assert!(!other.exists());
        remove(&folder, true).unwrap();
        assert!(!folder.exists());
        assert!(
            remove(&folder, true)
                .unwrap_err()
                .starts_with("cannot delete ")
        );
    }

    #[test]
    fn reads_text_files_up_to_the_limit_and_refuses_binary_ones() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("notes.txt");
        fs::write(&small, "line 1\nline 2").unwrap();
        let read = read_text(&small).unwrap();
        assert_eq!(read.content, "line 1\nline 2");
        assert!(!read.truncated);
        assert_eq!(read.path, small.to_string_lossy());

        // A two-byte character cut by the limit is dropped, not refused.
        let big = dir.path().join("big.txt");
        let mut text = "a".repeat(MAX_ATTACH_BYTES - 1);
        text.push('ñ');
        text.push_str("tail");
        fs::write(&big, &text).unwrap();
        let read = read_text(&big).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content, "a".repeat(MAX_ATTACH_BYTES - 1));

        let binary = dir.path().join("a.bin");
        fs::write(&binary, [0x7f, b'E', b'L', b'F', 0, 1]).unwrap();
        let err = read_text(&binary).unwrap_err();
        assert_eq!(
            err,
            format!("cannot attach {}: it is not a text file", binary.display())
        );
        fs::write(&binary, [0xff, 0xfe, b'a']).unwrap();
        assert!(read_text(&binary).unwrap_err().contains("not a text file"));
        assert!(
            read_text(&dir.path().join("x"))
                .unwrap_err()
                .starts_with("cannot read ")
        );
    }

    #[test]
    fn reads_images_for_the_markdown_preview_and_refuses_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("shot.PNG");
        fs::write(&png, [0x89, b'P', b'N', b'G', 1, 2, 3]).unwrap();
        assert_eq!(read_image(&png).unwrap(), [0x89, b'P', b'N', b'G', 1, 2, 3]);

        let key = dir.path().join("id_ed25519");
        fs::write(&key, "secret").unwrap();
        assert_eq!(
            read_image(&key).unwrap_err(),
            format!("cannot show {}: it is not an image", key.display())
        );
        let folder = dir.path().join("pics.png");
        fs::create_dir(&folder).unwrap();
        assert_eq!(
            read_image(&folder).unwrap_err(),
            format!("cannot show {}: it is not an image", folder.display())
        );
        let big = dir.path().join("big.jpg");
        fs::write(&big, vec![0u8; MAX_IMAGE_BYTES + 1]).unwrap();
        assert_eq!(
            read_image(&big).unwrap_err(),
            format!("cannot show {}: it is larger than 20 MiB", big.display())
        );
        assert!(read_image(&dir.path().join("missing.gif")).is_err());
        // Network shares and devices are never opened: Windows would sign in to the share's host.
        for path in [
            r"\\attacker.example\s\x.png",
            r"\\?\C:\x.png",
            "//attacker.example/s/x.png",
        ] {
            assert_eq!(
                read_image(Path::new(path)).unwrap_err(),
                not_an_image(path),
                "{path}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_image_name_on_something_that_is_not_a_file_is_not_read() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("pipe.png");
        assert!(
            std::process::Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(
            read_image(&fifo).unwrap_err(),
            not_an_image(&fifo.to_string_lossy())
        );
    }

    #[test]
    fn views_text_files_up_to_the_view_limit_and_refuses_folders_and_binary_ones() {
        let dir = tempfile::tempdir().unwrap();
        // Longer than an attachment, within the viewer's limit: read whole.
        let long = dir.path().join("long.rs");
        let text = "x".repeat(MAX_ATTACH_BYTES * 2);
        fs::write(&long, &text).unwrap();
        let read = view_text(&long, None).unwrap();
        assert_eq!(read.content, text);
        assert!(!read.truncated);

        let huge = dir.path().join("huge.log");
        fs::write(&huge, "y".repeat(MAX_VIEW_BYTES + 10)).unwrap();
        let read = view_text(&huge, None).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content.len(), MAX_VIEW_BYTES);

        let binary = dir.path().join("a.bin");
        fs::write(&binary, [0x7f, b'E', b'L', b'F', 0, 1]).unwrap();
        assert_eq!(
            view_text(&binary, None).unwrap_err(),
            format!("cannot view {}: it is not a text file", binary.display())
        );
        assert_eq!(
            view_text(dir.path(), None).unwrap_err(),
            format!("cannot view {}: it is a folder", dir.path().display())
        );
        assert!(
            view_text(&dir.path().join("x"), None)
                .unwrap_err()
                .starts_with("cannot read ")
        );
    }

    #[test]
    fn a_folder_is_attached_as_its_listing() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("README.md"), "").unwrap();
        let read = read_text(dir.path()).unwrap();
        assert_eq!(read.content, "src/\nREADME.md");
        assert!(!read.truncated);
    }

    #[test]
    fn write_text_saves_over_the_text_that_was_opened() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "old").unwrap();
        write_text(&file, "old", "new text", None, None).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new text");
    }

    #[test]
    fn write_text_refuses_a_file_that_changed_since_it_was_opened() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "changed by someone else").unwrap();
        let err = write_text(&file, "old", "mine", None, None).unwrap_err();
        assert!(err.contains("changed on disk"), "{err}");
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "changed by someone else"
        );
    }

    #[test]
    fn write_text_refuses_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("gone.txt");
        let err = write_text(&file, "old", "mine", None, None).unwrap_err();
        assert!(err.starts_with("cannot save"), "{err}");
        assert!(!file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_text_keeps_a_symlink_and_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("real.sh");
        fs::write(&target, "echo 1").unwrap();
        chmod(&target, 0o755).unwrap();
        let link = dir.path().join("link.sh");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        write_text(&link, "echo 1", "echo 2", None, None).unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), "echo 2");
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o7777;
        assert_eq!(mode, 0o755);
    }

    /// Writes `bytes` to a new file in `dir` and views it with `encoding`.
    fn view_bytes(dir: &Path, bytes: &[u8], encoding: Option<&str>) -> Result<TextFile, String> {
        let file = dir.join("f.txt");
        fs::write(&file, bytes).unwrap();
        view_text(&file, encoding)
    }

    #[test]
    fn viewing_plain_utf8_reports_utf8_as_before() {
        let dir = tempfile::tempdir().unwrap();
        let read = view_bytes(dir.path(), "año\n".as_bytes(), None).unwrap();
        assert_eq!(
            (read.content.as_str(), read.encoding.as_str()),
            ("año\n", "utf-8")
        );
        let attached = read_text(&dir.path().join("f.txt")).unwrap();
        assert_eq!(attached.encoding, "utf-8");
        assert_eq!(read_text(dir.path()).unwrap().encoding, "utf-8");
    }

    #[test]
    fn viewing_detects_a_bom_and_leaves_it_out() {
        let dir = tempfile::tempdir().unwrap();
        let read = view_bytes(dir.path(), b"\xEF\xBB\xBFhi \xC3\xA9", None).unwrap();
        assert_eq!(
            (read.content.as_str(), read.encoding.as_str()),
            ("hi é", "utf-8-bom")
        );
        let read = view_bytes(dir.path(), b"\xFF\xFEh\0i\0\xE9\0", None).unwrap();
        assert_eq!(
            (read.content.as_str(), read.encoding.as_str()),
            ("hié", "utf-16le")
        );
        let read = view_bytes(dir.path(), b"\xFE\xFF\0h\0i\0\xE9", None).unwrap();
        assert_eq!(
            (read.content.as_str(), read.encoding.as_str()),
            ("hié", "utf-16be")
        );
    }

    #[test]
    fn viewing_with_an_encoding_decodes_with_it() {
        let dir = tempfile::tempdir().unwrap();
        let read = view_bytes(dir.path(), b"caf\xE9 \x80", Some("windows-1252")).unwrap();
        assert_eq!(
            (read.content.as_str(), read.encoding.as_str()),
            ("café €", "windows-1252")
        );
        let read = view_bytes(dir.path(), b"\x93\xFA\x96\x7B", Some("shift_jis")).unwrap();
        assert_eq!(read.content, "日本");
        // UTF-16 text holds NUL bytes; without a BOM it is decoded as asked.
        let read = view_bytes(dir.path(), b"a\0b\0", Some("utf-16le")).unwrap();
        assert_eq!(
            (read.content.as_str(), read.encoding.as_str()),
            ("ab", "utf-16le")
        );
        let read = view_bytes(dir.path(), b"\xEF\xBB\xBFx", Some("utf-8-bom")).unwrap();
        assert_eq!(read.content, "x");
    }

    #[test]
    fn viewing_refuses_unknown_encodings_and_malformed_text() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        let label = file.display();
        assert_eq!(
            view_bytes(dir.path(), b"x", Some("klingon")).unwrap_err(),
            format!("cannot view {label}: unknown encoding klingon")
        );
        // A Shift_JIS lead byte with nothing after it, and an odd UTF-16 length.
        assert_eq!(
            view_bytes(dir.path(), b"a\x93", Some("shift_jis")).unwrap_err(),
            format!("cannot view {label}: it is not a text file in shift_jis")
        );
        assert_eq!(
            view_bytes(dir.path(), b"a\0b", Some("utf-16le")).unwrap_err(),
            format!("cannot view {label}: it is not a text file in utf-16le")
        );
        assert_eq!(
            view_bytes(dir.path(), b"a\0b", Some("windows-1252")).unwrap_err(),
            format!("cannot view {label}: it is not a text file")
        );
        assert_eq!(
            view_bytes(dir.path(), b"\xC3(", Some("utf-8")).unwrap_err(),
            format!("cannot view {label}: it is not a text file")
        );
    }

    #[test]
    fn a_character_cut_by_the_view_limit_is_dropped_in_any_encoding() {
        let dir = tempfile::tempdir().unwrap();
        // UTF-16: a surrogate pair cut after its first unit.
        let text = format!("{}😀", "a".repeat(MAX_VIEW_BYTES / 2 - 2));
        let mut bytes = b"\xFF\xFE".to_vec();
        bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        let read = view_bytes(dir.path(), &bytes, None).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content, "a".repeat(MAX_VIEW_BYTES / 2 - 2));
        // Shift_JIS: a two-byte character cut after its first byte.
        let mut bytes = b"a".repeat(MAX_VIEW_BYTES - 1);
        bytes.extend(b"\x93\xFAtail");
        let read = view_bytes(dir.path(), &bytes, Some("shift_jis")).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content, "a".repeat(MAX_VIEW_BYTES - 1));
    }

    #[test]
    fn writing_keeps_the_encoding_and_its_bom() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        let cases: [(&str, &[u8], &[u8]); 5] = [
            ("utf-8", b"old", b"n\xC3\xA9w"),
            ("utf-8-bom", b"\xEF\xBB\xBFold", b"\xEF\xBB\xBFn\xC3\xA9w"),
            ("utf-16le", b"\xFF\xFEo\0l\0d\0", b"\xFF\xFEn\0\xE9\0w\0"),
            ("utf-16be", b"\xFE\xFF\0o\0l\0d", b"\xFE\xFF\0n\0\xE9\0w"),
            ("windows-1252", b"old", b"n\xE9w"),
        ];
        for (encoding, before, after) in cases {
            fs::write(&file, before).unwrap();
            assert_eq!(view_text(&file, Some(encoding)).unwrap().content, "old");
            write_text(&file, "old", "néw", Some(encoding), None).unwrap();
            assert_eq!(fs::read(&file).unwrap(), after, "{encoding}");
            assert_eq!(view_text(&file, Some(encoding)).unwrap().content, "néw");
        }
    }

    #[test]
    fn writing_with_another_encoding_compares_with_the_one_it_was_opened_with() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        fs::write(&file, "café").unwrap();
        // Opened as UTF-8, saved as Windows-1252.
        write_text(&file, "café", "café!", Some("windows-1252"), Some("utf-8")).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"caf\xE9!");
    }

    #[test]
    fn writing_refuses_characters_the_encoding_cannot_hold() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        fs::write(&file, b"old").unwrap();
        let err = write_text(&file, "old", "日本", Some("windows-1252"), None).unwrap_err();
        assert_eq!(
            err,
            format!(
                "cannot save {}: some characters cannot be written in windows-1252",
                file.display()
            )
        );
        assert_eq!(fs::read(&file).unwrap(), b"old");
        let err = write_text(&file, "old", "x", Some("klingon"), None).unwrap_err();
        assert_eq!(
            err,
            format!("cannot save {}: unknown encoding klingon", file.display())
        );
        assert_eq!(fs::read(&file).unwrap(), b"old");
    }

    #[test]
    fn writing_with_an_encoding_still_refuses_a_file_that_changed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        fs::write(&file, b"caf\xE9 changed").unwrap();
        let err = write_text(&file, "café", "mine", Some("windows-1252"), None).unwrap_err();
        assert!(err.contains("changed on disk"), "{err}");
        assert_eq!(fs::read(&file).unwrap(), b"caf\xE9 changed");
        // Bytes that do not decode in the encoding count as changed too.
        fs::write(&file, b"a\0b").unwrap();
        let err = write_text(&file, "ab", "mine", Some("utf-16le"), None).unwrap_err();
        assert!(err.contains("changed on disk"), "{err}");
    }

    #[test]
    fn copy_into_copies_files_and_folders_and_names_a_clash_like_vs_code() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.path().join("f.txt"), "x").unwrap();
        fs::create_dir_all(dir.path().join("sub").join("deep")).unwrap();
        fs::write(dir.path().join("sub").join("deep").join("inner"), "y").unwrap();

        let copied = copy_into(&dir.path().join("f.txt"), &dest).unwrap();
        assert_eq!(copied, dest.join("f.txt"));
        assert_eq!(fs::read_to_string(&copied).unwrap(), "x");
        assert!(dir.path().join("f.txt").exists());
        copy_into(&dir.path().join("sub"), &dest).unwrap();
        assert_eq!(fs::read_to_string(dest.join("sub/deep/inner")).unwrap(), "y");

        // Into its own folder (or wherever the name is taken): "copy", then "copy 2"; never replaced.
        assert_eq!(copy_into(&dir.path().join("f.txt"), dir.path()).unwrap(), dir.path().join("f copy.txt"));
        assert_eq!(copy_into(&dir.path().join("f.txt"), dir.path()).unwrap(), dir.path().join("f copy 2.txt"));
        assert_eq!(copy_into(&dir.path().join("sub"), &dest).unwrap(), dest.join("sub copy"));
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "x");

        assert!(copy_into(&dir.path().join("sub"), &dir.path().join("sub").join("deep")).is_err());
        assert!(copy_into(&dir.path().join("missing"), &dest).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn copy_into_copies_a_link_as_a_link() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("target"), "t").unwrap();
        std::os::unix::fs::symlink("target", dir.path().join("link")).unwrap();
        let dest = dir.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let copied = copy_into(&dir.path().join("link"), &dest).unwrap();
        assert_eq!(fs::read_link(copied).unwrap(), Path::new("target"));
    }

    #[test]
    fn move_into_moves_a_file_and_a_folder_into_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.path().join("f.txt"), "x").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("inner"), "y").unwrap();

        let moved = move_into(&dir.path().join("f.txt"), &dest).unwrap();
        assert_eq!(moved, dest.join("f.txt"));
        assert_eq!(fs::read_to_string(dest.join("f.txt")).unwrap(), "x");
        assert!(!dir.path().join("f.txt").exists());

        move_into(&dir.path().join("sub"), &dest).unwrap();
        assert_eq!(
            fs::read_to_string(dest.join("sub").join("inner")).unwrap(),
            "y"
        );
        assert!(!dir.path().join("sub").exists());
    }

    #[test]
    fn move_into_never_replaces_an_entry_with_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("f.txt"), "kept").unwrap();
        fs::write(dir.path().join("f.txt"), "moving").unwrap();
        let err = move_into(&dir.path().join("f.txt"), &dest).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(fs::read_to_string(dest.join("f.txt")).unwrap(), "kept");
        assert_eq!(
            fs::read_to_string(dir.path().join("f.txt")).unwrap(),
            "moving"
        );
    }

    #[test]
    fn move_into_refuses_a_folder_into_itself_or_its_subfolders() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("a");
        fs::create_dir_all(folder.join("b")).unwrap();
        for target in [folder.clone(), folder.join("b")] {
            let err = move_into(&folder, &target).unwrap_err();
            assert!(err.contains("into itself"), "{err}");
        }
        // A sibling whose name starts the same is not inside it.
        fs::create_dir(dir.path().join("ab")).unwrap();
        move_into(&folder, &dir.path().join("ab")).unwrap();
        assert!(dir.path().join("ab").join("a").join("b").is_dir());
    }

    #[test]
    fn move_into_its_own_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "x").unwrap();
        let err = move_into(&dir.path().join("f.txt"), dir.path()).unwrap_err();
        assert!(err.contains("already in"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn chmod_sets_the_mode_and_rejects_invalid_ones() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        fs::write(&file, "").unwrap();
        chmod(&file, 0o640).unwrap();
        assert_eq!(stat(&file).unwrap().permissions, Some(0o640));
        let err = chmod(&file, 0o17777).unwrap_err();
        assert!(err.contains("invalid mode"), "{err}");
    }
}
