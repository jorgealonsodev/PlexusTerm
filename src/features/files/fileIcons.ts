import { FileSymlink, Folder, FolderGit2, FolderOpen, type LucideIcon } from "lucide-react";
import { SETI_DARK, SETI_ICONS, SETI_LIGHT, type SetiMap } from "./setiIcons.generated";

/** An icon colour readable on dark and on light colour schemes. */
export interface IconColor {
  dark: string;
  light: string;
}

export interface FileIcon {
  /** Stable name of the type (tests, `data-icon`): the Seti icon's name for files. */
  id: string;
  /** Files: the glyph of the Seti font (VS Code's default file icons). */
  glyph?: string;
  /** Folders and links: a drawn icon. */
  icon?: LucideIcon;
  /** Null: the muted text colour. */
  color: IconColor | null;
}

/**
 * The languages of VS Code's built-in language support that the Seti theme gives an icon, by the
 * file extensions (lower case, without the dot) and exact file names VS Code assigns them, so a
 * file gets the icon it has in VS Code when the theme names its language rather than its extension.
 */
const LANGUAGES: Record<string, { extensions?: string[]; names?: string[] }> = {
  bat: { extensions: ["bat", "cmd"] },
  c: { extensions: ["c", "i"] },
  clojure: { extensions: ["clj", "cljs", "cljc", "cljx", "clojure", "edn"] },
  coffeescript: { extensions: ["coffee", "cson", "iced"] },
  cpp: { extensions: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "h", "ii", "ino", "inl", "ipp", "ixx", "tpp", "txx"] },
  csharp: { extensions: ["cs", "csx", "cake"] },
  css: { extensions: ["css"] },
  "cuda-cpp": { extensions: ["cu", "cuh"] },
  dart: { extensions: ["dart"] },
  dockercompose: { names: ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"] },
  dockerfile: { extensions: ["dockerfile", "containerfile"], names: ["dockerfile", "containerfile"] },
  elixir: { extensions: ["ex", "exs"] },
  elm: { extensions: ["elm"] },
  erb: { extensions: ["erb", "rhtml"] },
  fsharp: { extensions: ["fs", "fsi", "fsx", "fsscript"] },
  "git-commit": { names: ["commit_editmsg", "merge_msg"] },
  go: { extensions: ["go"] },
  groovy: { extensions: ["groovy", "gvy", "jenkinsfile", "nf"], names: ["jenkinsfile"] },
  handlebars: { extensions: ["handlebars", "hbs", "hjs"] },
  haskell: { extensions: ["hs", "lhs"] },
  html: { extensions: ["html", "htm", "shtml", "xhtml", "xht", "mdoc", "jsp", "asp", "aspx", "jshtm", "volt", "ejs", "rhtml"] },
  ignore: { extensions: ["gitignore", "gitignore_global", "git-blame-ignore-revs", "npmignore"] },
  jade: { extensions: ["pug", "jade"] },
  java: { extensions: ["java", "jav"] },
  javascript: { extensions: ["js", "es6", "mjs", "cjs", "pac"], names: ["jakefile"] },
  javascriptreact: { extensions: ["jsx"] },
  jinja: { extensions: ["jinja", "j2", "jinja2"] },
  json: {
    extensions: ["json", "bowerrc", "jscsrc", "webmanifest", "har", "jslintrc", "jsonld", "geojson", "ipynb", "vuerc"],
    names: ["composer.lock", ".watchmanconfig"],
  },
  jsonc: { extensions: ["jsonc", "eslintrc", "jsfmtrc", "jshintrc", "swcrc", "hintrc", "babelrc", "code-workspace"] },
  jsonl: { extensions: ["jsonl", "ndjson"] },
  julia: { extensions: ["jl"] },
  kotlin: { extensions: ["kt", "kts"] },
  latex: { extensions: ["tex", "ltx", "ctx"] },
  less: { extensions: ["less"] },
  lua: { extensions: ["lua"] },
  makefile: { extensions: ["mak", "mk"], names: ["makefile", "gnumakefile", "ocamlmakefile"] },
  markdown: { extensions: ["md", "mkd", "mdwn", "mdown", "markdown", "markdn", "mdtxt", "mdtext", "workbook"] },
  "objective-c": { extensions: ["m"] },
  "objective-cpp": { extensions: ["mm"] },
  ocaml: { extensions: ["ml", "mli"] },
  perl: { extensions: ["pl", "pm", "pod", "t", "psgi"] },
  php: { extensions: ["php", "php4", "php5", "phtml", "ctp"] },
  postcss: { extensions: ["pcss", "postcss"] },
  powershell: { extensions: ["ps1", "psm1", "psd1", "pssc", "psrc"] },
  properties: {
    extensions: ["properties", "cfg", "conf", "directory", "gitattributes", "gitconfig", "gitmodules", "editorconfig", "repo"],
  },
  python: { extensions: ["py", "rpy", "pyw", "cpy", "gyp", "gypi", "pyi", "ipy", "pyt"] },
  r: { extensions: ["r", "rhistory", "rprofile", "rt"] },
  razor: { extensions: ["cshtml", "razor"] },
  rescript: { extensions: ["res", "resi"] },
  ruby: { extensions: ["rb", "rbx", "rjs", "gemspec", "rake", "ru", "podspec", "rbi"], names: ["rakefile", "gemfile", "guardfile", "podfile", "capfile"] },
  rust: { extensions: ["rs"] },
  sass: { extensions: ["sass"] },
  scss: { extensions: ["scss"] },
  shellscript: {
    extensions: [
      "sh", "bash", "bashrc", "bash_aliases", "bash_profile", "bash_login", "ebuild", "eclass", "profile", "bash_logout",
      "xprofile", "xsession", "xsessionrc", "zsh", "zshrc", "zprofile", "zlogin", "zlogout", "zshenv", "zsh-theme", "ksh",
      "csh", "cshrc", "tcshrc", "yashrc", "yash_profile",
    ],
    names: ["apkbuild", "pkgbuild", ".envrc", ".hushlogin", "zshrc", "zshenv", "zlogin", "zprofile", "zlogout", "bashrc_apple_terminal", "zshrc_apple_terminal"],
  },
  sql: { extensions: ["sql", "dsql"] },
  stylus: { extensions: ["styl"] },
  swift: { extensions: ["swift"] },
  terraform: { extensions: ["tf", "tfvars"] },
  tex: { extensions: ["sty", "cls", "bbx", "cbx"] },
  typescript: { extensions: ["ts", "cts", "mts"] },
  typescriptreact: { extensions: ["tsx"] },
  vala: { extensions: ["vala", "vapi"] },
  vue: { extensions: ["vue"] },
  xml: {
    extensions: [
      "xml", "xsd", "ascx", "atom", "axml", "axaml", "bpmn", "cpt", "csl", "csproj", "dita", "ditamap", "dtd", "ent", "mod", "dtml",
      "fsproj", "fxml", "iml", "isml", "jmx", "launch", "menu", "mxml", "nuspec", "opml", "owl", "proj", "props", "pt",
      "publishsettings", "pubxml", "rdf", "rng", "rss", "shproj", "storyboard", "targets", "tld", "tmx", "vbproj", "vcxproj",
      "wsdl", "wxi", "wxl", "wxs", "xaml", "xbl", "xib", "xlf", "xliff", "xpdl", "xul", "xoml", "plist",
    ],
  },
  yaml: { extensions: ["yml", "yaml", "eyaml", "eyml", "cff"] },
};

const languageByExtension = new Map<string, string>();
const languageByName = new Map<string, string>();
for (const [language, { extensions = [], names = [] }] of Object.entries(LANGUAGES)) {
  for (const extension of extensions) languageByExtension.set(extension, language);
  for (const name of names) languageByName.set(name, language);
}

/** The extensions of a lower-case name, longest first: `a.spec.ts` → `spec.ts`, `ts`; `.env` → `env`. */
function extensionsOf(name: string): string[] {
  const out: string[] = [];
  for (let i = name.indexOf("."); i !== -1; i = name.indexOf(".", i + 1)) out.push(name.slice(i + 1));
  return out.filter(Boolean);
}

/** The Seti icon VS Code shows for a file: its name, then its longest known extension, then its language. */
function setiIconOf(map: SetiMap, lower: string): string {
  const named = map.fileNames[lower];
  if (named) return named;
  const extensions = extensionsOf(lower);
  for (const extension of extensions) {
    const icon = map.fileExtensions[extension];
    if (icon) return icon;
  }
  const language = languageByName.get(lower) ?? extensions.map((e) => languageByExtension.get(e)).find(Boolean);
  return (language && map.languageIds[language]) || map.file;
}

/** The icon of a list entry: folders (open or closed), symlinks, and files as VS Code's Seti theme shows them. */
export function fileIconFor(name: string, kind: "file" | "dir" | "symlink", open = false): FileIcon {
  if (kind === "dir") {
    if (name === ".git") return { id: "folder-git", icon: FolderGit2, color: { dark: "#e37933", light: "#b4531a" } };
    return open ? { id: "folder-open", icon: FolderOpen, color: null } : { id: "folder", icon: Folder, color: null };
  }
  if (kind === "symlink") return { id: "symlink", icon: FileSymlink, color: null };
  const lower = name.toLowerCase();
  const dark = setiIconOf(SETI_DARK, lower);
  const light = setiIconOf(SETI_LIGHT, lower);
  const [glyph, darkColor] = SETI_ICONS[dark];
  const lightColor = SETI_ICONS[light]?.[1] || darkColor;
  return { id: dark, glyph, color: darkColor ? { dark: darkColor, light: lightColor } : null };
}
