/** An IPv4 range a.b.c.start-end, one field per part (the network scanner's input). */
export interface IpRange {
  a: string;
  b: string;
  c: string;
  start: string;
  end: string;
}

export const DEFAULT_RANGE: IpRange = { a: "192", b: "168", c: "1", start: "1", end: "254" };

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** The target the backend scans: `a.b.c.start-end`, or one address when start equals end. */
export function rangeTarget(range: IpRange): { ok: true; target: string } | { ok: false; error: string } {
  const parts = [range.a, range.b, range.c, range.start, range.end].map((p) => p.trim());
  if (!parts.every((p) => OCTET.test(p))) {
    return { ok: false, error: "Each part of the address must be a number from 0 to 255" };
  }
  const [a, b, c, start, end] = parts;
  if (Number(start) > Number(end)) return { ok: false, error: "The range start must not be greater than its end" };
  const base = `${a}.${b}.${c}.${start}`;
  return { ok: true, target: start === end ? base : `${base}-${end}` };
}

/** Fills every field from a pasted address, `a.b.c.d-e` range or `/24` network; null otherwise. */
export function parsePastedRange(text: string): IpRange | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:-(\d{1,3})|\/(24))?$/.exec(text.trim());
  if (!match) return null;
  const [, a, b, c, d, end, cidr] = match;
  if (cidr) return { a, b, c, start: "1", end: "254" };
  return { a, b, c, start: d, end: end ?? d };
}
