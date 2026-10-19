import type { DraggedPath, PathDrag } from "./pathDrag";

const trimmed = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, "") || path : path);

/** `path` is `dir` or one of its subfolders, whatever separator the paths use. */
const within = (path: string, dir: string) => {
  const inner = trimmed(path);
  const outer = trimmed(dir);
  return inner === outer || inner.startsWith(`${outer}/`) || inner.startsWith(`${outer}\\`);
};

/**
 * The dragged entries that a drop on the folder `dir` really moves (S2): not one already in it,
 * nor the folder itself or a folder dropped into one of its own subfolders.
 */
export function movesInto(drag: PathDrag, dir: string, parentPath: (path: string) => string): DraggedPath[] {
  return drag.paths.filter(({ path }) => trimmed(parentPath(path)) !== trimmed(dir) && !within(dir, path));
}
