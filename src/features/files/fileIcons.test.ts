import { File, FileArchive, FileCode, FileTerminal, Folder, FolderOpen } from "lucide-react";
import { describe, expect, it } from "vitest";
import { fileIconFor } from "./fileIcons";

const id = (name: string, kind: "file" | "dir" | "symlink" = "file", open = false) => fileIconFor(name, kind, open).id;

describe("fileIconFor", () => {
  it("picks an icon and a language colour by extension, ignoring case", () => {
    expect(id("main.ts")).toBe("typescript");
    expect(id("App.TSX")).toBe("typescript");
    expect(id("index.js")).toBe("javascript");
    expect(id("lib.rs")).toBe("rust");
    expect(id("app.py")).toBe("python");
    expect(id("main.go")).toBe("go");
    expect(id("index.html")).toBe("html");
    expect(id("App.css")).toBe("css");
    expect(id("data.json")).toBe("json");
    expect(id("notes.md")).toBe("markdown");
    expect(id("deploy.sh")).toBe("shell");
    expect(id("config.yaml")).toBe("config");
    expect(id("photo.PNG")).toBe("image");
    expect(id("movie.mp4")).toBe("video");
    expect(id("song.mp3")).toBe("audio");
    expect(id("table.csv")).toBe("spreadsheet");
    expect(id("server.pem")).toBe("key");
    expect(fileIconFor("main.ts", "file").icon).toBe(FileCode);
    expect(fileIconFor("deploy.sh", "file").icon).toBe(FileTerminal);
    const ts = fileIconFor("main.ts", "file").color!;
    expect(ts.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(ts.light).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("handles names with several dots and dotfiles", () => {
    expect(id("backup.tar.gz")).toBe("archive");
    expect(fileIconFor("backup.tar.gz", "file").icon).toBe(FileArchive);
    expect(id("types.d.ts")).toBe("typescript");
    expect(id("vite.config.ts")).toBe("typescript");
    expect(id(".bashrc")).toBe("shell");
    expect(id(".eslintrc.json")).toBe("json");
    expect(id(".env")).toBe("env");
    expect(id(".env.local")).toBe("env");
    expect(id(".gitignore")).toBe("git");
  });

  it("recognises well-known file names", () => {
    expect(id("Dockerfile")).toBe("docker");
    expect(id("Dockerfile.dev")).toBe("docker");
    expect(id("Makefile")).toBe("make");
    expect(id("package.json")).toBe("npm");
    expect(id("Cargo.toml")).toBe("cargo");
    expect(id("README.md")).toBe("readme");
    expect(id("LICENSE")).toBe("license");
    expect(id("id_rsa")).toBe("key");
    expect(id("id_ed25519.pub")).toBe("key");
    expect(id("pnpm-lock.yaml")).toBe("lock");
  });

  it("keeps the generic icon, uncoloured, for unknown types; folders open and close", () => {
    expect(fileIconFor("mystery.qqq", "file")).toMatchObject({ id: "file", icon: File, color: null });
    expect(fileIconFor("noextension", "file")).toMatchObject({ id: "file", color: null });
    expect(fileIconFor("src", "dir")).toMatchObject({ id: "folder", icon: Folder });
    expect(fileIconFor("src", "dir", true)).toMatchObject({ id: "folder-open", icon: FolderOpen });
    expect(id("link", "symlink")).toBe("symlink");
    // A folder named like a file type is still a folder.
    expect(id("app.py", "dir")).toBe("folder");
  });
});
