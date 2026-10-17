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
