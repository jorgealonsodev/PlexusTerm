/**
 * Command blocks: the prompt, the output and the exit code of each command, as the shell's OSC 133
 * marks place them in the buffer. They let the pane jump from prompt to prompt, copy one command's
 * output and mark the commands that failed. Without marks (a remote shell, integration off) there
 * are no blocks and every action does nothing.
 */
import type { ShellMark } from "./shellMarks";

interface Disposable {
  dispose(): void;
}
interface Marker extends Disposable {
  readonly line: number;
  readonly isDisposed: boolean;
}
interface Row {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}
interface Decoration extends Disposable {
  onRender(listener: (element: HTMLElement) => void): Disposable;
}

/** The part of xterm's Terminal this module uses. */
export interface BlockTerminal {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly type: "normal" | "alternate";
      readonly baseY: number;
      readonly viewportY: number;
      readonly cursorX: number;
      readonly cursorY: number;
      getLine(y: number): Row | undefined;
    };
  };
  registerMarker(cursorYOffset?: number): Marker | undefined;
  registerDecoration(options: {
    marker: Marker;
    x?: number;
    width?: number;
    backgroundColor?: string;
    layer?: "bottom" | "top";
  }): Decoration | undefined;
  scrollToLine(line: number): void;
  scrollToBottom(): void;
}

interface Block {
  /** The row where the prompt starts (A). */
  prompt: Marker;
  /** The row where the output starts (C); null until the command runs. */
  output: Marker | null;
  /** Where the command finished (D): the output ends before this column of this row. */
  end: { marker: Marker; col: number } | null;
  /** The bar beside a failed command's prompt. */
  failed: Decoration | null;
}

export interface CommandBlocks {
  /** Takes one shell mark at the cursor. */
  mark(mark: ShellMark): void;
  /** Whether there are prompts to jump to: the shell marks its commands and no full-screen program is up. */
  canJump(): boolean;
  /**
   * Scrolls the prompt before or after the last one jumped to (or the screen's top row) to the top
   * of the screen; going past the last prompt scrolls to the bottom. False when there is nowhere to go.
   */
  jump(direction: "previous" | "next"): boolean;
  /**
   * The output of the command whose prompt or output holds buffer row `row`, or of the last command
   * that ran when `row` is omitted; null when there is no such command or it printed nothing yet.
   */
  outputAt(row?: number): string | null;
  dispose(): void;
}

/** Most commands kept: xterm calls every marker's listener for each row a full scrollback drops. */
export const MAX_BLOCKS = 500;
/** How long the prompt a jump went to stays highlighted, so a jump to a prompt already on the screen shows. */
export const JUMP_FLASH_MS = 600;

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

const DEFAULT_JUMP = "#3a3d41";
const hex = (value: string | undefined) => (value && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : null);

/**
 * The scheme's selection colour as `#RRGGBB`, the only form decorations take: a translucent one
 * (`#RRGGBBAA`) is blended over the background.
 */
export function jumpColor(theme: { selectionBackground?: string; background?: string }): string {
  const selection = hex(theme.selectionBackground);
  if (!selection) return DEFAULT_JUMP;
  if (selection.length === 7) return selection;
  const background = hex(theme.background)?.slice(0, 7) ?? "#000000";
  const alpha = parseInt(selection.slice(7), 16) / 255;
  const channel = (i: number) => {
    const over = parseInt(selection.slice(i, i + 2), 16);
    const under = parseInt(background.slice(i, i + 2), 16);
    return Math.round(over * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function attachCommandBlocks(
  term: BlockTerminal,
  options: {
    /** The colour of the bar beside a failed command's prompt (`#RRGGBB`). */
    failedColor: () => string;
    /** The background of the prompt row a jump went to, for a moment (`#RRGGBB`). */
    jumpColor: () => string;
    maxBlocks?: number;
  },
): CommandBlocks {
  const maxBlocks = options.maxBlocks ?? MAX_BLOCKS;
  let blocks: Block[] = [];
  /** The prompt the last jump went to, and the screen's top row it left: the next jump starts there. */
  let jumped: { prompt: Marker; viewportY: number } | null = null;
  let flash: { decoration: Decoration | undefined; timer: ReturnType<typeof setTimeout> } | null = null;
  const endFlash = () => {
    if (!flash) return;
    clearTimeout(flash.timer);
    flash.decoration?.dispose();
    flash = null;
  };

  const disposeBlock = (block: Block) => {
    block.failed?.dispose();
    block.end?.marker.dispose();
    block.output?.dispose();
    block.prompt.dispose();
  };
  /** The blocks still in the buffer: a prompt row that left the scrollback (or was cleared) takes its block. */
  const live = () => {
    const kept = blocks.filter((block) => !block.prompt.isDisposed);
    if (kept.length !== blocks.length) {
      blocks.filter((block) => block.prompt.isDisposed).forEach(disposeBlock);
      blocks = kept;
    }
    return blocks;
  };
  const cursorRow = () => term.buffer.active.baseY + term.buffer.active.cursorY;

  const finish = (block: Block, exit: number | null) => {
    const marker = term.registerMarker(0);
    if (!marker) return;
    block.end = { marker, col: term.buffer.active.cursorX };
    // A command that never ran (an empty line, Ctrl+C at the prompt) has no output to mark.
    if (exit === null || exit === 0 || !block.output) return;
    const color = options.failedColor();
    const decoration = term.registerDecoration({ marker: block.prompt, x: 0, width: 1, layer: "top" });
    decoration?.onRender((element) => {
      element.classList.add("command-failed");
      // Drawn in the pane's padding, left of the prompt, so it never covers the first character.
      element.style.boxShadow = `-4px 0 0 0 ${color}`;
      // Clicks on the prompt's first cell still select text.
      element.style.pointerEvents = "none";
    });
    block.failed = decoration ?? null;
  };

  const mark = (shellMark: ShellMark) => {
    // Marks a program prints in the alternate screen (a full-screen app) are not the shell's.
    if (term.buffer.active.type !== "normal") return;
    const current = last(live());
    switch (shellMark.kind) {
      case "A": {
        // fish 4 sends its own marks besides ours: a second A on the same row is the same prompt.
        if (current && !current.output && current.prompt.line === cursorRow()) return;
        const prompt = term.registerMarker(0);
        if (!prompt) return;
        blocks.push({ prompt, output: null, end: null, failed: null });
        while (blocks.length > maxBlocks) disposeBlock(blocks.shift()!);
        return;
      }
      case "C":
        if (current && !current.output && !current.end) current.output = term.registerMarker(0) ?? null;
        return;
      case "D":
        if (current && !current.end) finish(current, shellMark.exit);
        return;
      case "B":
        return;
    }
  };

  const jump = (direction: "previous" | "next") => {
    const buffer = term.buffer.active;
    const prompts = live().map((block) => block.prompt);
    let from: number;
    if (jumped && !jumped.prompt.isDisposed && jumped.viewportY === buffer.viewportY) from = jumped.prompt.line;
    // At the bottom the current prompt is the start; scrolled up, the screen's top row.
    else from = buffer.viewportY >= buffer.baseY ? cursorRow() : buffer.viewportY;
    const target =
      direction === "previous"
        ? last(prompts.filter((prompt) => prompt.line < from))
        : prompts.find((prompt) => prompt.line > from);
    if (!target) {
      jumped = null;
      if (direction === "next" && buffer.viewportY < buffer.baseY) {
        term.scrollToBottom();
        return true;
      }
      return false;
    }
    term.scrollToLine(target.line);
    jumped = { prompt: target, viewportY: term.buffer.active.viewportY };
    endFlash();
    const decoration = term.registerDecoration({
      marker: target,
      width: term.cols,
      backgroundColor: options.jumpColor(),
      layer: "bottom",
    });
    flash = { decoration, timer: setTimeout(endFlash, JUMP_FLASH_MS) };
    return true;
  };

  const outputAt = (row?: number) => {
    const all = live();
    const block =
      row === undefined
        ? last(all.filter((b) => b.output && !b.output.isDisposed))
        : last(all.filter((b) => b.prompt.line <= row));
    if (!block?.output || block.output.isDisposed) return null;
    const buffer = term.buffer.active;
    const endRow = block.end && !block.end.marker.isDisposed ? block.end.marker.line : cursorRow();
    const endCol = block.end && !block.end.marker.isDisposed ? block.end.col : buffer.cursorX;
    const lines: string[] = [];
    for (let y = block.output.line; y <= endRow; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      // The finishing row holds output only before the column where the command finished.
      if (y === endRow && endCol === 0) break;
      const text = line.translateToString(true, 0, y === endRow ? endCol : undefined);
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    const trimmed = lines.map((line) => line.trimEnd());
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
    return trimmed.join("\n");
  };

  return {
    mark,
    canJump: () => term.buffer.active.type === "normal" && live().length > 0,
    jump,
    outputAt,
    dispose: () => {
      endFlash();
      blocks.forEach(disposeBlock);
      blocks = [];
      jumped = null;
    },
  };
}
