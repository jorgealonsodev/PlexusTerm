import {
  BookOpen,
  Braces,
  Container,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FileSpreadsheet,
  FileSymlink,
  FileTerminal,
  FileText,
  FileVideo,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Hammer,
  KeyRound,
  Lock,
  Package,
  Scale,
  type LucideIcon,
} from "lucide-react";

/** An icon colour readable on dark and on light colour schemes. */
export interface IconColor {
  dark: string;
  light: string;
}

export interface FileIcon {
  /** Stable name of the type (tests, `data-icon`). */
  id: string;
  icon: LucideIcon;
  /** Null: the muted text colour. */
  color: IconColor | null;
}

/** Language colours close to VS Code's common icon themes (Seti and friends). */
const C = {
  blue: { dark: "#519aba", light: "#2f6f9f" },
  tsBlue: { dark: "#3d8fd1", light: "#2b6cb0" },
  pyBlue: { dark: "#4b8bbe", light: "#306998" },
  yellow: { dark: "#cbcb41", light: "#8a7d00" },
  orange: { dark: "#e37933", light: "#b4531a" },
  rust: { dark: "#dea584", light: "#a0522d" },
  cyan: { dark: "#00add8", light: "#007d9c" },
  green: { dark: "#8dc149", light: "#4d8a1e" },
  purple: { dark: "#a074c4", light: "#7a4ea3" },
  pink: { dark: "#f55385", light: "#c0306a" },
  red: { dark: "#cc3e44", light: "#a8272d" },
  gold: { dark: "#e5c07b", light: "#946b00" },
  brown: { dark: "#c09553", light: "#8a6420" },
  grey: { dark: "#8c9aa6", light: "#5f6b75" },
} satisfies Record<string, IconColor>;

type Kind = readonly [id: string, icon: LucideIcon, color: IconColor | null];

const K = {
  typescript: ["typescript", FileCode, C.tsBlue],
  javascript: ["javascript", FileCode, C.yellow],
  rust: ["rust", FileCode, C.rust],
  python: ["python", FileCode, C.pyBlue],
  go: ["go", FileCode, C.cyan],
  html: ["html", FileCode, C.orange],
  css: ["css", FileCode, C.blue],
  sass: ["sass", FileCode, C.pink],
  c: ["c", FileCode, C.blue],
  java: ["java", FileCode, C.red],
  kotlin: ["kotlin", FileCode, C.purple],
  swift: ["swift", FileCode, C.orange],
  ruby: ["ruby", FileCode, C.red],
  php: ["php", FileCode, C.purple],
  csharp: ["csharp", FileCode, C.green],
  vue: ["vue", FileCode, C.green],
  svelte: ["svelte", FileCode, C.orange],
  lua: ["lua", FileCode, C.blue],
  code: ["code", FileCode, C.grey],
  json: ["json", Braces, C.yellow],
  config: ["config", FileCog, C.purple],
  xml: ["xml", FileCode, C.orange],
  markdown: ["markdown", FileText, C.blue],
  text: ["text", FileText, null],
  pdf: ["pdf", FileText, C.red],
  shell: ["shell", FileTerminal, C.green],
  image: ["image", FileImage, C.purple],
  video: ["video", FileVideo, C.purple],
  audio: ["audio", FileAudio, C.purple],
  archive: ["archive", FileArchive, C.brown],
  spreadsheet: ["spreadsheet", FileSpreadsheet, C.green],
  database: ["database", Database, C.pink],
  key: ["key", KeyRound, C.gold],
  lock: ["lock", FileLock, C.grey],
  env: ["env", Lock, C.gold],
  git: ["git", GitBranch, C.orange],
  docker: ["docker", Container, C.blue],
  make: ["make", Hammer, C.orange],
  npm: ["npm", Package, C.red],
  cargo: ["cargo", Package, C.rust],
  readme: ["readme", BookOpen, C.blue],
  license: ["license", Scale, C.gold],
} satisfies Record<string, Kind>;

/** Extension (lower case, without the first dot; may hold dots like `tar.gz`) → type. */
const EXTENSIONS: Record<string, Kind> = {
  ...Object.fromEntries(["ts", "tsx", "mts", "cts", "d.ts"].map((e) => [e, K.typescript])),
  ...Object.fromEntries(["js", "jsx", "mjs", "cjs"].map((e) => [e, K.javascript])),
  rs: K.rust,
  ...Object.fromEntries(["py", "pyw", "pyi", "ipynb"].map((e) => [e, K.python])),
  go: K.go,
  ...Object.fromEntries(["html", "htm", "xhtml"].map((e) => [e, K.html])),
  ...Object.fromEntries(["css", "less"].map((e) => [e, K.css])),
  ...Object.fromEntries(["scss", "sass"].map((e) => [e, K.sass])),
  ...Object.fromEntries(["c", "h", "cpp", "cc", "cxx", "hpp", "hh"].map((e) => [e, K.c])),
  ...Object.fromEntries(["java", "class", "jar"].map((e) => [e, K.java])),
  ...Object.fromEntries(["kt", "kts"].map((e) => [e, K.kotlin])),
  swift: K.swift,
  rb: K.ruby,
  php: K.php,
  cs: K.csharp,
  vue: K.vue,
  svelte: K.svelte,
  lua: K.lua,
  ...Object.fromEntries(["dart", "scala", "zig", "ex", "exs", "erl", "hs", "clj", "pl", "r", "jl", "nim"].map((e) => [e, K.code])),
  ...Object.fromEntries(["json", "jsonc", "json5"].map((e) => [e, K.json])),
  ...Object.fromEntries(["yaml", "yml", "toml", "ini", "cfg", "conf", "properties", "editorconfig"].map((e) => [e, K.config])),
  ...Object.fromEntries(["xml", "xsd", "plist"].map((e) => [e, K.xml])),
  ...Object.fromEntries(["md", "markdown", "mdx", "rst"].map((e) => [e, K.markdown])),
  ...Object.fromEntries(["txt", "log", "text"].map((e) => [e, K.text])),
  pdf: K.pdf,
  ...Object.fromEntries(
    ["sh", "bash", "zsh", "fish", "ksh", "ps1", "psm1", "bat", "cmd", "bashrc", "zshrc", "profile", "bash_profile", "zprofile"].map(
      (e) => [e, K.shell],
    ),
  ),
  ...Object.fromEntries(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tiff", "avif", "heic"].map((e) => [e, K.image])),
  ...Object.fromEntries(["mp4", "mkv", "mov", "avi", "webm", "m4v"].map((e) => [e, K.video])),
  ...Object.fromEntries(["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"].map((e) => [e, K.audio])),
  ...Object.fromEntries(
    ["zip", "tar", "gz", "tgz", "tar.gz", "bz2", "tar.bz2", "xz", "tar.xz", "7z", "rar", "zst", "tar.zst", "deb", "rpm", "dmg", "iso"].map(
      (e) => [e, K.archive],
    ),
  ),
  ...Object.fromEntries(["csv", "tsv", "xls", "xlsx", "ods"].map((e) => [e, K.spreadsheet])),
  ...Object.fromEntries(["sql", "db", "sqlite", "sqlite3"].map((e) => [e, K.database])),
  ...Object.fromEntries(["pem", "key", "crt", "cer", "der", "p12", "pfx", "pub", "gpg", "asc", "ppk"].map((e) => [e, K.key])),
  lock: K.lock,
  ...Object.fromEntries(["gitignore", "gitattributes", "gitmodules", "gitkeep"].map((e) => [e, K.git])),
  dockerfile: K.docker,
  dockerignore: K.docker,
  mk: K.make,
};

/** Exact file names (lower case). */
const NAMES: Record<string, Kind> = {
  "package.json": K.npm,
  "package-lock.json": K.lock,
  "pnpm-lock.yaml": K.lock,
  "yarn.lock": K.lock,
  "cargo.toml": K.cargo,
  "cargo.lock": K.lock,
  "docker-compose.yml": K.docker,
  "docker-compose.yaml": K.docker,
  "compose.yml": K.docker,
  "compose.yaml": K.docker,
  "known_hosts": K.key,
  "authorized_keys": K.key,
};

/** Names whose part before the first dot gives the type: `README.md`, `Dockerfile.dev`, `id_rsa.pub`. */
const BASENAMES: Record<string, Kind> = {
  readme: K.readme,
  license: K.license,
  licence: K.license,
  copying: K.license,
  dockerfile: K.docker,
  containerfile: K.docker,
  makefile: K.make,
  gnumakefile: K.make,
  id_rsa: K.key,
  id_ed25519: K.key,
  id_ecdsa: K.key,
  id_dsa: K.key,
};

const icon = ([id, icon, color]: Kind): FileIcon => ({ id, icon, color });

/** The icon of a list entry: folders (open or closed), symlinks, and files by name and extension. */
export function fileIconFor(name: string, kind: "file" | "dir" | "symlink", open = false): FileIcon {
  if (kind === "dir") {
    if (name === ".git") return { id: "folder-git", icon: FolderGit2, color: C.orange };
    return open ? { id: "folder-open", icon: FolderOpen, color: null } : { id: "folder", icon: Folder, color: null };
  }
  if (kind === "symlink") return { id: "symlink", icon: FileSymlink, color: null };
  const lower = name.toLowerCase();
  const exact = NAMES[lower] ?? (lower.startsWith(".") ? undefined : BASENAMES[lower.split(".")[0]]);
  if (exact) return icon(exact);
  if (lower === ".env" || lower.startsWith(".env.")) return icon(K.env);
  // The longest extension first: `backup.tar.gz` is `tar.gz` before `gz`.
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const kindOf = EXTENSIONS[parts.slice(i).join(".")];
    if (kindOf) return icon(kindOf);
  }
  return { id: "file", icon: File, color: null };
}
