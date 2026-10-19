/**
 * Parses the payload of an OSC 7 sequence (`ESC ] 7 ; file://host/path BEL`),
 * which shells emit to report their working directory.
 * Returns the percent-decoded path (`C:/...` for Windows drives), or null when the payload is not usable.
 */
export function parseOsc7(data: string): string | null {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data);
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[1]);
    // `file:///C:/Users/me` from Windows shells: the drive path has no leading slash.
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

/**
 * Parses the payload of an OSC 9;9 sequence (`ESC ] 9 ; 9 ; "C:\path" ESC \`), how Windows shells
 * report their working directory to ConEmu and Windows Terminal. The quotes are optional.
 * Returns the path, or null for every other OSC 9 payload (notifications, progress).
 */
export function parseOsc9Cwd(data: string): string | null {
  if (!data.startsWith("9;")) return null;
  let path = data.slice(2);
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  return path === "" ? null : path;
}
