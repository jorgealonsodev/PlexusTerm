import type { CSSProperties } from "react";
import { fileIconFor } from "./fileIcons";

/**
 * The type icon at the left of a list entry. Its colour is the type's (switching with the
 * light or dark scheme through CSS), never the git status colour, like VS Code.
 */
export function FileTypeIcon({ name, kind, open = false }: { name: string; kind: "file" | "dir" | "symlink"; open?: boolean }) {
  const { id, icon: Icon, color } = fileIconFor(name, kind, open);
  const style = color ? ({ "--icon-dark": color.dark, "--icon-light": color.light } as CSSProperties) : undefined;
  return (
    <span className="sftp-row__icon file-icon" data-icon={id} style={style} aria-hidden="true">
      <Icon size={15} strokeWidth={1.75} />
    </span>
  );
}
