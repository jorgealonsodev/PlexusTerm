// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DIR_DROP_EVENT, deliverDrop, dropTargetAt, type DirDrop, type PathDrag } from "./pathDrag";
import { movesInto } from "./dirDrop";
import { parentPath } from "../local/localPath";

const drag = (...paths: [string, boolean][]): PathDrag => ({
  origin: { kind: "local" },
  paths: paths.map(([path, isDir]) => ({ path, isDir })),
});

describe("movesInto (S2)", () => {
  it("keeps what would really move into the folder", () => {
    expect(movesInto(drag(["/p/a.txt", false], ["/p/src", true]), "/p/dest", parentPath)).toEqual([
      { path: "/p/a.txt", isDir: false },
      { path: "/p/src", isDir: true },
    ]);
  });

  it("leaves out an entry already in the folder, the folder itself and a folder dropped into its own subfolder", () => {
    expect(movesInto(drag(["/p/dest/a.txt", false]), "/p/dest", parentPath)).toEqual([]);
    expect(movesInto(drag(["/p/dest", true]), "/p/dest", parentPath)).toEqual([]);
    expect(movesInto(drag(["/p/src", true]), "/p/src/lib", parentPath)).toEqual([]);
    expect(movesInto(drag(["C:\\p\\src", true]), "C:\\p\\src\\lib", parentPath)).toEqual([]);
    // A sibling that starts with the same name is not inside it.
    expect(movesInto(drag(["/p/src", true]), "/p/src2", parentPath)).toEqual([{ path: "/p/src", isDir: true }]);
  });
});

describe("folder drop targets (S2)", () => {
  it("finds a folder row under the pointer and hands it the drop instead of the app", () => {
    document.body.innerHTML = '<ul data-drop-dir="/p"><li data-drop-dir="/p/src"><span>src</span></li></ul>';
    const span = document.querySelector("span")!;
    document.elementFromPoint = vi.fn(() => span);
    const row = dropTargetAt(1, 1)!;
    expect(row.getAttribute("data-drop-dir")).toBe("/p/src");

    const received: DirDrop[] = [];
    document.querySelector("ul")!.addEventListener(DIR_DROP_EVENT, (e) => received.push((e as CustomEvent<DirDrop>).detail));
    const dragged = drag(["/p/a.txt", false]);
    deliverDrop(dragged, row);
    expect(received).toEqual([{ drag: dragged, dir: "/p/src" }]);
  });
});
