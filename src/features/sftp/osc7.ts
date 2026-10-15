/**
 * Parses the payload of an OSC 7 sequence (`ESC ] 7 ; file://host/path BEL`),
 * which shells emit to report their working directory.
 * Returns the percent-decoded path, or null when the payload is not usable.
 */
export function parseOsc7(data: string): string | null {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
