import { describe, expect, it } from "vitest";
import { pathCompletion, pathQuery, type FolderEntry } from "./pathCompletion";

const file = (name: string): FolderEntry => ({ name, kind: "file" });
const dir = (name: string): FolderEntry => ({ name, kind: "dir" });

describe("pathQuery", () => {
  it("reads the last word of the line relative to the folder", () => {
    expect(pathQuery("cd n", "/home/u", null, false)).toEqual({ folder: "/home/u", prefix: "n", dirsOnly: true, windows: false });
    expect(pathQuery("./", "/home/u", null, false)).toEqual({ folder: "/home/u/./", prefix: "", dirsOnly: false, windows: false });
    expect(pathQuery("cat src/ma", "/p", null, false)?.folder).toBe("/p/src/");
    expect(pathQuery("ls /etc/ho", "/p", null, false)).toMatchObject({ folder: "/etc/", prefix: "ho" });
    expect(pathQuery("vim ~/.ba", "/p", "/home/u", false)).toMatchObject({ folder: "/home/u", prefix: ".ba" });
    expect(pathQuery("type C:\\Users\\a", "C:\\x", null, true)).toMatchObject({ folder: "C:\\Users\\", prefix: "a" });
  });

  it("leaves the command itself, an empty word and quoted or escaped words alone", () => {
    expect(pathQuery("gi", "/p", null, false)).toBeNull();
    expect(pathQuery("cd ", "/p", null, false)).toBeNull();
    expect(pathQuery('cat "my f', "/p", null, false)).toBeNull();
    expect(pathQuery("cat my\\ f", "/p", null, false)).toBeNull();
    expect(pathQuery("cat $HOME/a", "/p", null, false)).toBeNull();
    expect(pathQuery("cd ~/a", "/p", null, false)).toBeNull();
  });
});

describe("pathCompletion", () => {
  const q = (prefix: string, dirsOnly = false, windows = false) => ({ folder: "/", prefix, dirsOnly, windows });

  it("completes the only match, with a slash after a folder", () => {
    expect(pathCompletion(q(""), [file("run.sh")])).toBe("run.sh");
    expect(pathCompletion(q("n"), [dir("notes"), file("a")])).toBe("otes/");
  });

  it("gives what several matches share, or nothing", () => {
    expect(pathCompletion(q("p"), [file("project-a"), file("project-b")])).toBe("roject-");
    expect(pathCompletion(q("a"), [file("ab"), file("ac")])).toBeNull();
    expect(pathCompletion(q("z"), [file("a")])).toBeNull();
  });

  it("takes folders only for cd, and hidden names only after a dot", () => {
    expect(pathCompletion(q("n", true), [file("notes.txt"), dir("node")])).toBe("ode/");
    expect(pathCompletion(q(""), [file(".env"), file("main.rs")])).toBe("main.rs");
    expect(pathCompletion(q(".e"), [file(".env")])).toBe("nv");
  });

  it("escapes what a POSIX shell needs, and leaves names with spaces to Tab on Windows", () => {
    expect(pathCompletion(q("my"), [file("my file (1).txt")])).toBe("\\ file\\ \\(1\\).txt");
    expect(pathCompletion(q("my", false, true), [file("my file.txt")])).toBeNull();
    expect(pathCompletion(q("DO", false, true), [dir("Documents")])).toBe("cuments\\");
  });
});
