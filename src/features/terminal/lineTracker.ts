/**
 * Follows the command line being typed from the keys sent to the session (S1), without
 * shell integration. Anything that may move the shell's cursor or rewrite the line
 * (arrows, history search, completion) makes the line uncertain until the next Enter.
 */
export interface LineState {
  text: string;
  uncertain: boolean;
}

export const EMPTY_LINE: LineState = { text: "", uncertain: false };

const UNCERTAIN = (text: string): LineState => ({ text, uncertain: true });

/** The length of the escape sequence at `i` (data[i] is ESC). */
function escapeLength(data: string, i: number): number {
  const next = data[i + 1];
  if (next === undefined) return 1;
  if (next === "[") {
    let j = i + 2;
    while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) <= 0x3f) j++;
    return Math.min(j + 1, data.length) - i;
  }
  if (next === "O") return Math.min(3, data.length - i);
  return 2; // Alt+key
}

/** Applies typed data to the line; returns the lines committed with Enter, in order. */
export function feedInput(state: LineState, data: string): { state: LineState; commits: string[] } {
  let { text, uncertain } = state;
  const commits: string[] = [];
  /** Shells insert the newlines of a bracketed paste into the line instead of running it. */
  let inPaste = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const code = data.charCodeAt(i);
    if (inPaste && (ch === "\r" || ch === "\n")) {
      uncertain = true;
    } else if (ch === "\r" || ch === "\n") {
      if (!uncertain) commits.push(text);
      text = "";
      uncertain = false;
      // CR LF is one Enter.
      if (ch === "\r" && data[i + 1] === "\n") i++;
    } else if (ch === "\x1b") {
      const length = escapeLength(data, i);
      const sequence = data.slice(i, i + length);
      // Bracketed paste markers wrap pasted text, which is typed as is.
      if (sequence === "\x1b[200~") inPaste = true;
      else if (sequence === "\x1b[201~") inPaste = false;
      else uncertain = true;
      i += length - 1;
    } else if (ch === "\x7f" || ch === "\b") {
      text = [...text].slice(0, -1).join("");
    } else if (ch === "\x03") {
      text = "";
      uncertain = false;
    } else if (ch === "\x15") {
      if (!uncertain) text = "";
    } else if (ch === "\x17") {
      text = text.replace(/\s+$/, "").replace(/\S+$/, "");
    } else if (code < 0x20) {
      uncertain = true;
    } else {
      text += ch;
    }
  }
  return { state: uncertain ? UNCERTAIN(text) : { text, uncertain }, commits };
}

/**
 * Data written to the session from elsewhere (multi-execution, snippets) is never
 * recorded: it makes the line uncertain, and whatever follows its last Enter too.
 */
export function feedExternal(state: LineState, data: string): LineState {
  const lastEnter = Math.max(data.lastIndexOf("\r"), data.lastIndexOf("\n"));
  if (lastEnter === -1) return UNCERTAIN(state.text);
  return lastEnter === data.length - 1 ? EMPTY_LINE : UNCERTAIN("");
}

/** The prompt part of the cursor line: what is left once the typed text echoed at its end is removed. */
export function promptBefore(lineToCursor: string, typed: string): string {
  return typed && lineToCursor.endsWith(typed) ? lineToCursor.slice(0, -typed.length) : lineToCursor;
}

/**
 * Words that announce a secret ("Password: ", "[sudo] password for u: ", "Enter passphrase for key …: ",
 * "PIN:", "Verification code:", "OTP:"): English first, then the other interface languages and Russian,
 * as sudo, ssh, PAM, cryptsetup and gpg print them.
 */
const SECRET_WORDS = [
  "pass(?:word|phrase|code)",
  "\\bpin\\b",
  "\\b(?:otp|2fa|mfa|token|one[- ]time|(?:verification|authenticator|security|auth) code)\\b",
  "contrase(?:ñ|n)a",
  "frase de paso",
  "c(?:ó|o)digo de verifica(?:ci(?:ó|o)n|(?:ç|c)(?:ã|a)o)",
  "passwort",
  "kennwort",
  "best(?:ä|a)tigungscode",
  "mot de passe",
  "phrase secr(?:è|e)te",
  "code de v(?:é|e)rification",
  "senha",
  "パスワード",
  "パスフレーズ",
  "暗証番号",
  "密码",
  "密碼",
  "口令",
  "암호",
  "비밀번호",
  "كلمة (?:السر|المرور)",
  "पासवर्ड",
  "пароль",
].join("|");

/** A secret word followed, on the same line, by a closing ":" or "?" (ASCII or full-width). */
const SECRET_PROMPT = new RegExp(`(?:${SECRET_WORDS})[^\\n]*[:?：？]\\s*$`, "i");

export const isSecretPrompt = (prompt: string) => SECRET_PROMPT.test(prompt);
