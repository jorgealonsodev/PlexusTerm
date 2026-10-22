// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SftpEntry } from "../sftp/sftpClient";
import { FlatFileIcon, fileCategory } from "./FlatFileIcon";

afterEach(cleanup);

const entry = (name: string, kind: SftpEntry["kind"] = "file") => ({ name, kind, path: `/x/${name}` }) as SftpEntry;

describe("plain list icons", () => {
  it("tells files apart by what they hold, from the extension or the whole name", () => {
    expect(fileCategory("main.rs")).toBe("code");
    expect(fileCategory("package.json")).toBe("data");
    expect(fileCategory("sesiones-ssh.ini")).toBe("config");
    expect(fileCategory("deploy.SH")).toBe("script");
    expect(fileCategory("notes.md")).toBe("text");
    expect(fileCategory("logo.svg")).toBe("image");
    expect(fileCategory("backup.tar.gz")).toBe("archive");
    expect(fileCategory("id_ed25519")).toBe("key");
    expect(fileCategory(".gitignore")).toBe("config");
    expect(fileCategory("Dockerfile")).toBe("config");
    expect(fileCategory("README")).toBe("file");
    expect(fileCategory(".bashrc")).toBe("file");
  });

  it("draws folders, the .git folder and links with their own icons", () => {
    const kindOf = (e: SftpEntry) => {
      const { container } = render(<FlatFileIcon name={e.name} kind={e.kind} />);
      const kind = container.querySelector("svg")!.getAttribute("data-kind");
      cleanup();
      return kind;
    };
    expect(kindOf(entry("src", "dir"))).toBe("folder");
    expect(kindOf(entry("current", "symlink"))).toBe("symlink");
    expect(kindOf(entry("nuevo.txt"))).toBe("text");
    const { container } = render(<FlatFileIcon name=".git" kind="dir" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("lucide-folder-git");
  });
});
