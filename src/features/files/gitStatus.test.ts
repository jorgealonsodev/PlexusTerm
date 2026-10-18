import { describe, expect, it } from "vitest";
import { decorationFor, indexGitStatus, rootDecoration, type GitStatusEntry } from "./gitStatus";

const e = (path: string, status: GitStatusEntry["status"]): GitStatusEntry => ({ path, status });
const deco = (entries: GitStatusEntry[], path: string, isDir = false) => decorationFor(indexGitStatus(entries), path, isDir);

describe("git status decorations (VS Code)", () => {
  it("gives files VS Code's letter, colour and label", () => {
    expect(deco([e("a.ts", "modified")], "a.ts")).toMatchObject({ letter: "M", color: "modified", label: "modified" });
    expect(deco([e("a.ts", "indexModified")], "a.ts")).toMatchObject({ letter: "M", color: "stageModified", label: "stagedModified" });
    expect(deco([e("a.ts", "indexAdded")], "a.ts")).toMatchObject({ letter: "A", color: "added", label: "added" });
    expect(deco([e("a.ts", "intentToAdd")], "a.ts")).toMatchObject({ letter: "A", color: "added" });
    expect(deco([e("a.ts", "indexDeleted")], "a.ts")).toMatchObject({ letter: "D", color: "stageDeleted", label: "stagedDeleted", strike: true });
    expect(deco([e("a.ts", "deleted")], "a.ts")).toMatchObject({ letter: "D", color: "deleted", label: "deleted", strike: true });
    expect(deco([e("a.ts", "indexRenamed")], "a.ts")).toMatchObject({ letter: "R", color: "renamed", label: "renamed" });
    expect(deco([e("a.ts", "intentToRename")], "a.ts")).toMatchObject({ letter: "R", color: "renamed" });
    expect(deco([e("a.ts", "indexCopied")], "a.ts")).toMatchObject({ letter: "C", color: "renamed", label: "copied" });
    expect(deco([e("a.ts", "typeChanged")], "a.ts")).toMatchObject({ letter: "T", color: "modified", label: "typeChanged" });
    expect(deco([e("a.ts", "untracked")], "a.ts")).toMatchObject({ letter: "U", color: "untracked", label: "untracked" });
    expect(deco([e("a.ts", "ignored")], "a.ts")).toMatchObject({ letter: "I", color: "ignored", label: "ignored", faded: true });
    for (const status of ["bothModified", "bothAdded", "bothDeleted", "addedByUs", "addedByThem", "deletedByUs", "deletedByThem"] as const) {
      expect(deco([e("a.ts", status)], "a.ts")).toMatchObject({ letter: "!", color: "conflicting", label: "conflict" });
    }
    expect(deco([e("a.ts", "modified")], "b.ts")).toBeNull();
  });

  it("picks the highest priority when the index and the working tree differ", () => {
    // modified (2) over added (1); conflict (4) over everything; equal priority: the working tree.
    expect(deco([e("a", "indexAdded"), e("a", "modified")], "a")?.status).toBe("modified");
    expect(deco([e("a", "modified"), e("a", "bothModified")], "a")?.status).toBe("bothModified");
    expect(deco([e("a", "indexModified"), e("a", "modified")], "a")?.status).toBe("modified");
    expect(deco([e("a", "indexAdded"), e("a", "deleted")], "a")?.status).toBe("deleted");
  });

  it("colours a folder like its most important descendant, without a letter, never for deleted or ignored ones", () => {
    const entries = [e("src/a.ts", "untracked"), e("src/deep/b.ts", "modified"), e("src/gone.ts", "deleted"), e("src/x.log", "ignored")];
    expect(deco(entries, "src", true)).toMatchObject({ status: "modified", letter: null, color: "modified" });
    expect(deco(entries, "src/deep", true)).toMatchObject({ status: "modified", letter: null });
    expect(deco([e("lib/gone.ts", "deleted"), e("lib/old.ts", "indexDeleted")], "lib", true)).toBeNull();
    expect(deco([e("lib/x.log", "ignored")], "lib", true)).toBeNull();
    expect(deco([e("src/c.ts", "bothModified"), e("src/a.ts", "modified")], "src", true)?.color).toBe("conflicting");
    expect(deco([e("srcx/a.ts", "modified")], "src", true)).toBeNull();
  });

  it("treats a folder entry as covering everything inside it", () => {
    const entries = [e("node_modules/", "ignored"), e("fresh/", "untracked")];
    expect(deco(entries, "node_modules", true)).toMatchObject({ status: "ignored", letter: null, faded: true });
    expect(deco(entries, "node_modules/react/index.js")).toMatchObject({ status: "ignored", letter: "I" });
    expect(deco(entries, "fresh", true)).toMatchObject({ status: "untracked", letter: null });
    expect(deco(entries, "fresh/a.txt")).toMatchObject({ status: "untracked", letter: "U" });
    // The listed folder itself inside an ignored one.
    expect(deco([e("", "ignored")], "anything.js")).toMatchObject({ status: "ignored" });
    // An ignored folder does not grey its parent.
    expect(deco(entries, "", true)).toBeNull();
    expect(deco([e("web/node_modules/", "ignored")], "web", true)).toBeNull();
  });
});

describe("a workspace root's decoration", () => {
  it("is a dot coloured by the most important change inside, as a folder's", () => {
    const deco = rootDecoration([
      { path: "src/a.ts", status: "untracked" },
      { path: "b.ts", status: "modified" },
    ]);
    expect(deco).toEqual(expect.objectContaining({ letter: null, color: "modified" }));
  });

  it("is none when nothing changed, or only ignored files are listed", () => {
    expect(rootDecoration([])).toBeNull();
    expect(rootDecoration([{ path: "node_modules/", status: "ignored" }])).toBeNull();
  });
});
