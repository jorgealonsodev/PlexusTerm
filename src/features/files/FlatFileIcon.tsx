import {
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileKey,
  FileMusic,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideoCamera,
  Folder,
  FolderGit2,
  Link2,
  type LucideIcon,
} from "lucide-react";
import type { SftpEntry } from "../sftp/sftpClient";

/** A kind of file, by what it holds; each has its icon and colour (`flat-icon--<kind>`). */
export type FileCategory =
  | "code"
  | "data"
  | "config"
  | "script"
  | "text"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "sheet"
  | "key"
  | "file";

const EXTENSIONS: Record<Exclude<FileCategory, "file">, string[]> = {
  code: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift", "html", "css", "scss", "vue", "svelte", "lua", "sql"],
  data: ["json", "jsonc", "xml", "csv", "tsv"],
  config: ["yml", "yaml", "toml", "ini", "conf", "cfg", "env", "properties", "lock"],
  script: ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"],
  text: ["txt", "md", "markdown", "rst", "log", "pdf", "doc", "docx", "odt", "rtf"],
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif", "tif", "tiff"],
  audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  video: ["mp4", "mkv", "webm", "avi", "mov"],
  archive: ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst", "deb", "rpm", "iso", "jar"],
  sheet: ["xls", "xlsx", "ods"],
  key: ["pem", "key", "crt", "cer", "pub", "p12", "pfx", "gpg", "asc"],
};

const BY_EXTENSION = new Map(
  Object.entries(EXTENSIONS).flatMap(([category, exts]) => exts.map((ext) => [ext, category as FileCategory])),
);

/** Files known by their whole name. */
const BY_NAME: Record<string, FileCategory> = {
  dockerfile: "config",
  makefile: "script",
  ".gitignore": "config",
  ".gitattributes": "config",
  ".editorconfig": "config",
  ".env": "config",
  id_rsa: "key",
  id_ed25519: "key",
  id_ecdsa: "key",
  authorized_keys: "key",
  known_hosts: "key",
};

/** What a file holds, from its name (its extension, or the whole name for files such as Dockerfile). */
export function fileCategory(name: string): FileCategory {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  const dot = lower.lastIndexOf(".");
  return (dot > 0 && BY_EXTENSION.get(lower.slice(dot + 1))) || "file";
}

const ICONS: Record<FileCategory, LucideIcon> = {
  code: FileCode,
  data: FileBraces,
  config: FileCog,
  script: FileTerminal,
  text: FileText,
  image: FileImage,
  audio: FileMusic,
  video: FileVideoCamera,
  archive: FileArchive,
  sheet: FileSpreadsheet,
  key: FileKey,
  file: File,
};

/**
 * The icon of an entry in the plain list (outside DEV mode, which uses VS Code's file icons):
 * line icons, folders tinted, files by what they hold.
 */
export function FlatFileIcon({ entry }: { entry: SftpEntry }) {
  if (entry.kind === "dir") {
    const Icon = entry.name === ".git" ? FolderGit2 : Folder;
    return <Icon size={15} className="flat-icon flat-icon--folder" data-kind="folder" aria-hidden="true" />;
  }
  if (entry.kind === "symlink") {
    return <Link2 size={15} className="flat-icon flat-icon--link" data-kind="symlink" aria-hidden="true" />;
  }
  const category = fileCategory(entry.name);
  const Icon = ICONS[category];
  return <Icon size={15} className={`flat-icon flat-icon--${category}`} data-kind={category} aria-hidden="true" />;
}
