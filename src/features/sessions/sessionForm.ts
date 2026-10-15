import { defaultSerialForm, formFromSettings, parseSerialForm, type SerialForm } from "../serial/serialSettings";
import { parseQuickConnect, type QuickConnectForm } from "../ssh/quickConnect";
import { isSerialSession, normalizeFolder, type LibrarySession, type SavedAuth } from "./library";

export type SessionKind = "ssh" | "serial";

export interface SessionForm extends QuickConnectForm {
  kind: SessionKind;
  name: string;
  folder: string;
  serial: SerialForm;
}

export type SessionFormResult = { ok: true; session: LibrarySession } | { ok: false; error: string };

/** Validates the edit form; secrets (password, passphrase) are never kept. */
export function parseSessionForm(form: SessionForm, id: string): SessionFormResult {
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

  const parsed = parseQuickConnect(form);
  if (!parsed.ok) return parsed;
  const { host, port, username, auth } = parsed.target;

  const saved: SavedAuth =
    auth.method === "key" ? { method: "key", path: auth.path } : { method: auth.method };

  return {
    ok: true,
    session: {
      kind: "ssh",
      id,
      name: form.name.trim() || `${username}@${host}`,
      folder,
      host,
      port,
      username,
      auth: saved,
    },
  };
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
  const common = { name: session.name, folder: session.folder };
  if (isSerialSession(session)) {
    return { ...emptySsh, ...common, kind: "serial", serial: formFromSettings(session) };
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
  };
}
