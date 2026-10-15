/** Pure helpers for Unix permission bits (`0o7777`: special bits plus rwx for owner, group and others). */

export const MAX_MODE = 0o7777;

const SPECIAL: [number, number, string][] = [
  // [special bit, execute bit it shares a position with, letter]
  [0o4000, 0o100, "s"],
  [0o2000, 0o010, "s"],
  [0o1000, 0o001, "t"],
];

/** `ls -l` style text, e.g. `rwxr-xr-x`, `rwsr-xr-x`, `rwxrwxrwT`. */
export function modeString(mode: number): string {
  const chars = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001].map(
    (bit, i) => (mode & bit ? "rwx"[i % 3] : "-"),
  );
  SPECIAL.forEach(([special, exec, letter], i) => {
    if (mode & special) chars[i * 3 + 2] = mode & exec ? letter : letter.toUpperCase();
  });
  return chars.join("");
}

/** Four octal digits, e.g. `0755`. */
export const octalString = (mode: number) => (mode & MAX_MODE).toString(8).padStart(4, "0");

/** The mode written as one to four octal digits, or `null`. */
export function parseOctal(text: string): number | null {
  const trimmed = text.trim();
  return /^[0-7]{1,4}$/.test(trimmed) ? parseInt(trimmed, 8) : null;
}
