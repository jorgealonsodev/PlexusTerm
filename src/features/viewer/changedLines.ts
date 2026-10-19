/**
 * The lines of a file that differ from its last commit, as VS Code marks them in the gutter:
 * added lines, modified lines, and where lines were deleted.
 */
export interface LineChange {
  /** 1-based line of the current text. */
  line: number;
  /**
   * `deleted`: lines were removed just above this line; `deletedBelow`: just below it (the end of
   * the file).
   */
  kind: "added" | "modified" | "deleted" | "deletedBelow";
}

/** Past this many differing lines the rest of the middle is marked modified as one block. */
const MAX_EDITS = 1000;

const linesOf = (text: string) => (text === "" ? [] : text.split(/\r\n|\r|\n/));

export function changedLines(committed: string, current: string): LineChange[] {
  const a = linesOf(committed);
  const b = linesOf(current);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const marks: LineChange[] = [];
  for (const hunk of hunks(a, b, start, endA, endB)) mark(hunk, b.length, marks);
  return marks;
}

/** A run of deleted lines of `a` and inserted lines of `b` between equal ones. */
interface Hunk {
  /** Where it starts in `b` (0-based). */
  at: number;
  deleted: number;
  inserted: number;
}

function mark({ at, deleted, inserted }: Hunk, lines: number, marks: LineChange[]) {
  const modified = Math.min(deleted, inserted);
  for (let i = 0; i < inserted; i++) marks.push({ line: at + i + 1, kind: i < modified ? "modified" : "added" });
  if (inserted > 0 || deleted === 0) return;
  if (at < lines) marks.push({ line: at + 1, kind: "deleted" });
  else marks.push(lines === 0 ? { line: 1, kind: "deleted" } : { line: lines, kind: "deletedBelow" });
}

/** The hunks between `a[start..endA)` and `b[start..endB)` (Myers' shortest edit script). */
function hunks(a: string[], b: string[], start: number, endA: number, endB: number): Hunk[] {
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ at: start, deleted: n, inserted: m }];
  const offset = MAX_EDITS + 1;
  let v: Int32Array<ArrayBufferLike> = new Int32Array(2 * offset + 1);
  const trace: Int32Array<ArrayBufferLike>[] = [];
  let found = -1;
  for (let d = 0; d <= MAX_EDITS && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  // Too different to diff line by line: one block.
  if (found < 0) return [{ at: start, deleted: n, inserted: m }];
  // Back from the end: each step is one deleted or inserted line, between runs of equal ones.
  const steps: ("del" | "ins" | "eq")[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push("eq");
      x--;
      y--;
    }
    steps.push(down ? "ins" : "del");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push("eq");
    x--;
    y--;
  }
  steps.reverse();
  const result: Hunk[] = [];
  let atB = start;
  let current: Hunk | null = null;
  for (const step of steps) {
    if (step === "eq") {
      if (current) result.push(current);
      current = null;
      atB++;
      continue;
    }
    current ??= { at: atB, deleted: 0, inserted: 0 };
    if (step === "del") current.deleted++;
    else {
      current.inserted++;
      atB++;
    }
  }
  if (current) result.push(current);
  return result;
}
