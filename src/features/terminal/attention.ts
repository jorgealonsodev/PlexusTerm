/**
 * Requests for attention that programs send to the terminal: AI command-line tools (Claude Code,
 * Codex...) ring the bell or send a desktop notification sequence when they finish or wait for the
 * user. A bell is a notice with neither title nor body.
 */
export interface AttentionNotice {
  title: string | null;
  body: string | null;
}

/** Longest title or body kept: a notification only shows a line or two anyway. */
const MAX_TEXT = 1000;
/** Kitty notifications sent in several parts that are still waiting for their last part. */
const MAX_PENDING = 16;

const clean = (text: string): string | null => {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  return trimmed === "" ? null : trimmed;
};

/**
 * OSC 9 (iTerm2): `ESC ] 9 ; message BEL`. ConEmu and Windows Terminal use OSC 9 with a number for
 * other commands (`9;4;state;progress` is a progress bar that Claude Code sends while it works);
 * those are not notifications.
 */
export function parseOsc9(data: string): AttentionNotice | null {
  if (/^\d+(;|$)/.test(data)) return null;
  return { title: null, body: clean(data) };
}

/** OSC 777 (urxvt, Ghostty, foot...): `ESC ] 777 ; notify ; title ; body BEL`. */
export function parseOsc777(data: string): AttentionNotice | null {
  const [command, title = "", ...body] = data.split(";");
  if (command !== "notify") return null;
  return { title: clean(title), body: clean(body.join(";")) };
}

/** UTF-8 text from base64, or "" when it is not valid base64. */
function fromBase64(text: string): string {
  try {
    const bytes = Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

interface PendingKitty {
  title: string;
  body: string;
}

/**
 * OSC 99 (kitty desktop notifications): `ESC ] 99 ; key=value:key=value ; payload ST`. A
 * notification may come in parts with the same `i` (id), `d=0` marking that more follow; `p` says
 * whether the payload is the title (the default) or the body, and `e=1` that it is base64. Queries
 * (`p=?`), icons, buttons and the other payload types are ignored. Returns a reader that keeps the
 * unfinished notifications of one terminal.
 */
export function createOsc99Reader(): (data: string) => AttentionNotice | null {
  const pending = new Map<string, PendingKitty>();
  return (data) => {
    const split = data.indexOf(";");
    const metadata = split === -1 ? data : data.slice(0, split);
    const raw = split === -1 ? "" : data.slice(split + 1);
    const keys = new Map<string, string>();
    for (const pair of metadata.split(":")) {
      const eq = pair.indexOf("=");
      if (eq > 0) keys.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const part = keys.get("p") ?? "title";
    if (part !== "title" && part !== "body" && part !== "buttons") return null;
    const id = keys.get("i") ?? "";
    const notice = pending.get(id) ?? { title: "", body: "" };
    // Re-inserted so the oldest unfinished notification is the first one dropped.
    pending.delete(id);
    const payload = keys.get("e") === "1" ? fromBase64(raw) : raw;
    if (part === "title") notice.title = (notice.title + payload).slice(0, MAX_TEXT);
    else if (part === "body") notice.body = (notice.body + payload).slice(0, MAX_TEXT);
    if (keys.get("d") === "0") {
      pending.set(id, notice);
      while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
      return null;
    }
    return { title: clean(notice.title), body: clean(notice.body) };
  };
}
