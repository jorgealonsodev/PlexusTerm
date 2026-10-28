import type { CSSProperties } from "react";

/** Where a cell of the screen is drawn in the pane, in pixels (zero before the terminal is laid out). */
export type CellBox = Pick<CSSProperties, "left" | "top" | "width" | "height">;

/** A quick select label: its letters, how many of them were typed, and the cell it sits on. */
export interface ShownLabel {
  label: string;
  typed: number;
  box: CellBox;
}

/**
 * What copy mode and quick select draw over the terminal: the copy cursor or the labels, and a
 * badge naming the mode with its keys. Purely visual: the pane handles the keys.
 */
export function KeyboardModes({
  badge,
  hint,
  cursor,
  labels = [],
}: {
  badge: string;
  hint: string;
  cursor?: { col: number; row: number; box: CellBox };
  labels?: readonly ShownLabel[];
}) {
  return (
    <>
      {cursor && (
        <div
          className="copy-mode__cursor"
          aria-hidden="true"
          data-col={cursor.col}
          data-row={cursor.row}
          style={cursor.box}
        />
      )}
      {labels.map((shown) => (
        <span key={shown.label} className="quick-select__label" aria-hidden="true" style={{ left: shown.box.left, top: shown.box.top }}>
          <span className="quick-select__typed">{shown.label.slice(0, shown.typed)}</span>
          {shown.label.slice(shown.typed)}
        </span>
      ))}
      <div className="keyboard-mode__badge" role="status">
        <strong>{badge}</strong> <span>{hint}</span>
      </div>
    </>
  );
}
