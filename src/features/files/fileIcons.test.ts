import { Folder, FolderGit2, FolderOpen, FileSymlink } from "lucide-react";
import { describe, expect, it } from "vitest";
import { fileIconFor } from "./fileIcons";

const id = (name: string, kind: "file" | "dir" | "symlink" = "file", open = false) => fileIconFor(name, kind, open).id;

describe("fileIconFor (VS Code's Seti icons)", () => {
  it("gives the files of a project the icons VS Code shows", () => {
    expect(id("Cargo.toml")).toBe("_config");
    expect(id("tauri.conf.json")).toBe("_json");
    expect(id("package.json")).toBe("_json");
    expect(id("pnpm-lock.yaml")).toBe("_yml");
    expect(id("README.md")).toBe("_info");
    expect(id("SECURITY.md")).toBe("_markdown");
    expect(id("LICENSE")).toBe("_license");
    expect(id("tsconfig.json")).toBe("_tsconfig");
    expect(id("vite.config.ts")).toBe("_vite");
    expect(id(".gitignore")).toBe("_git");
    expect(id(".gitattributes")).toBe("_git");
    expect(id("index.html")).toBe("_html_3");
  });

  it("finds the language of an extension, ignoring case, as VS Code's language registry does", () => {
    expect(id("main.ts")).toBe("_typescript");
    expect(id("App.TSX")).toBe("_react");
    expect(id("index.mjs")).toBe("_javascript");
    expect(id("lib.rs")).toBe("_rust");
    expect(id("app.py")).toBe("_python");
    expect(id("deploy.sh")).toBe("_shell");
    expect(id(".bashrc")).toBe("_shell");
    expect(id("Dockerfile")).toBe("_docker");
    expect(id("Makefile")).toBe("_makefile");
    expect(id("profile.ps1")).toBe("_powershell");
  });

  it("prefers the longest known extension and exact names", () => {
    expect(id("button.spec.ts")).toBe("_typescript_1");
    expect(id(".eslintrc.json")).toBe("_eslint");
    expect(id("yarn.lock")).toBe("_yarn");
    expect(id(".env")).toBe("_config");
    expect(id("photo.PNG")).toBe("_image");
  });

  it("draws a glyph of the Seti font, with VS Code's colours for dark and light schemes", () => {
    const json = fileIconFor("data.json", "file");
    expect(json.glyph).toBe("");
    expect(json.color).toEqual({ dark: "#cbcb41", light: "#b7b73b" });
    expect(json.icon).toBeUndefined();
  });

  it("uses the default file glyph for unknown types; folders and links keep their own icons", () => {
    expect(fileIconFor("mystery.qqq", "file")).toMatchObject({ id: "_default", glyph: "" });
    expect(id("notes.txt")).toBe("_default");
    expect(id("noextension")).toBe("_default");
    expect(fileIconFor("src", "dir")).toMatchObject({ id: "folder", icon: Folder });
    expect(fileIconFor("src", "dir", true)).toMatchObject({ id: "folder-open", icon: FolderOpen });
    expect(fileIconFor(".git", "dir")).toMatchObject({ id: "folder-git", icon: FolderGit2 });
    expect(fileIconFor("link", "symlink")).toMatchObject({ id: "symlink", icon: FileSymlink });
    // A folder named like a file type is still a folder.
    expect(id("app.py", "dir")).toBe("folder");
  });
});
