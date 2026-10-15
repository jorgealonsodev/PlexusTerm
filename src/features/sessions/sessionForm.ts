import { t } from "../../i18n/i18n";
import { emptyMoshForm, type MoshForm } from "../mosh/mosh";
import { emptyTelnetForm, parseTelnetForm, type TelnetForm } from "../telnet/telnetForm";
import { defaultSerialForm, formFromSettings, parseSerialForm, type SerialForm } from "../serial/serialSettings";
import { parseQuickConnect, type QuickConnectForm } from "../ssh/quickConnect";
import {
  isMoshSession,
  isSerialSession,
  isSshSession,
  isTelnetSession,
  MAX_JUMPS,
  normalizeFolder,
  resolveChain,
  type LibrarySession,
  type SavedAuth,
  type SavedSession,
  type SessionLibrary,
} from "./library";

export type SessionKind = "ssh" | "serial" | "telnet" | "mosh";

export interface SessionForm extends QuickConnectForm {
  kind: SessionKind;
  name: string;
  folder: string;
  serial: SerialForm;
  telnet: TelnetForm;
  mosh: MoshForm;
  /** SSH only: ids of the saved sessions to go through, outermost first. */
  jumpIds?: string[];
}

export type SessionFormResult = { ok: true; session: LibrarySession } | { ok: false; error: string };

/** Validates the edit form; secrets (password, passphrase) are never kept. */
/** `library`, when given, lets the whole jump chain be checked (cycles through other sessions). */
export function parseSessionForm(
  form: SessionForm,
  id: string,
  library?: Pick<SessionLibrary, "sessions">,
): SessionFormResult {
  const folder = normalizeFolder(form.folder);
  if (form.kind === "serial") {
    const parsed = parseSerialForm(form.serial);
    if (!parsed.ok) return parsed;
    const settings = parsed.settings;
    return {
      ok: true,
      session: { kind: "serial", id, name: form.name.trim() || settings.path, folder, ...settings },
    };
  }
  if (form.kind === "telnet") {
    const parsed = parseTelnetForm(form.telnet);
    if (!parsed.ok) return parsed;
    const { host, port } = parsed;
    return { ok: true, session: { kind: "telnet", id, name: form.name.trim() || host, folder, host, port } };
  }
  if (form.kind === "mosh") {
    const sshSessionId = form.mosh.sshSessionId;
    const ssh = library?.sessions.find((s) => s.id === sshSessionId);
    if (!sshSessionId || (library && (!ssh || !isSshSession(ssh)))) {
      return { ok: false, error: t("sessions.form.moshSessionRequired") };
    }
    const serverCommand = form.mosh.serverCommand.trim();
    return {
      ok: true,
      session: {
        kind: "mosh",
        id,
        name: form.name.trim() || (ssh ? `${ssh.name} (mosh)` : "Mosh"),
        folder,
        sshSessionId,
        ...(serverCommand ? { serverCommand } : {}),
      },
    };
  }

  const parsed = parseQuickConnect(form);
  if (!parsed.ok) return parsed;
  const jumpIds = form.jumpIds ?? [];
  if (jumpIds.length > MAX_JUMPS) return { ok: false, error: t("sessions.form.tooManyJumps", { max: MAX_JUMPS }) };
  if (new Set(jumpIds).size !== jumpIds.length) return { ok: false, error: t("sessions.form.jumpTwice") };
  if (jumpIds.includes(id)) return { ok: false, error: t("sessions.form.ownJump") };
  const { host, port, username, auth } = parsed.target;

  const saved: SavedAuth =
    auth.method === "key"
      ? { method: "key", path: auth.path }
      : { method: auth.method === "agent" ? "agent" : "password" };

  const session: SavedSession = {
    kind: "ssh",
    id,
    name: form.name.trim() || `${username}@${host}`,
    folder,
    host,
    port,
    username,
    auth: saved,
    ...(jumpIds.length ? { jumpIds: [...jumpIds] } : {}),
  };
  if (library && jumpIds.length) {
    // Check the chain as it will be once saved, so loops through other sessions are caught now.
    const sessions = [...library.sessions.filter((s) => s.id !== id), session];
    const chain = resolveChain({ sessions }, session);
    if (!chain.ok) return { ok: false, error: chain.error };
  }
  return { ok: true, session };
}

const emptySsh: QuickConnectForm = {
  host: "",
  port: "",
  username: "",
  method: "password",
  password: "",
  keyPath: "~/.ssh/id_ed25519",
  passphrase: "",
};

export function formFromSession(session: LibrarySession): SessionForm {
  const common = { name: session.name, folder: session.folder, telnet: emptyTelnetForm, mosh: emptyMoshForm };
  if (isSerialSession(session)) {
    return { ...emptySsh, ...common, kind: "serial", serial: formFromSettings(session) };
  }
  if (isTelnetSession(session)) {
    const telnet = { host: session.host, port: session.port === 23 ? "" : String(session.port) };
    return { ...emptySsh, ...common, kind: "telnet", serial: defaultSerialForm, telnet };
  }
  if (isMoshSession(session)) {
    const mosh = { sshSessionId: session.sshSessionId, serverCommand: session.serverCommand ?? "" };
    return { ...emptySsh, ...common, kind: "mosh", serial: defaultSerialForm, mosh };
  }
  return {
    ...common,
    kind: "ssh",
    host: session.host,
    port: session.port === 22 ? "" : String(session.port),
    username: session.username,
    method: session.auth.method,
    password: "",
    keyPath: session.auth.method === "key" ? session.auth.path : "~/.ssh/id_ed25519",
    passphrase: "",
    serial: defaultSerialForm,
    jumpIds: session.jumpIds ?? [],
  };
}
