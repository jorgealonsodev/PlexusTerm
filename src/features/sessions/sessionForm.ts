import { parseQuickConnect, type QuickConnectForm } from "../ssh/quickConnect";
import { normalizeFolder, type SavedAuth, type SavedSession } from "./library";

export interface SessionForm extends QuickConnectForm {
  name: string;
  folder: string;
}

export type SessionFormResult = { ok: true; session: SavedSession } | { ok: false; error: string };

/** Validates the edit form; secrets (password, passphrase) are never kept. */
export function parseSessionForm(form: SessionForm, id: string): SessionFormResult {
  const parsed = parseQuickConnect(form);
  if (!parsed.ok) return parsed;
  const { host, port, username, auth } = parsed.target;

  const saved: SavedAuth =
    auth.method === "key" ? { method: "key", path: auth.path } : { method: auth.method };

  return {
    ok: true,
    session: {
      id,
      name: form.name.trim() || `${username}@${host}`,
      folder: normalizeFolder(form.folder),
      host,
      port,
      username,
      auth: saved,
    },
  };
}

export function formFromSession(session: SavedSession): SessionForm {
  return {
    name: session.name,
    folder: session.folder,
    host: session.host,
    port: session.port === 22 ? "" : String(session.port),
    username: session.username,
    method: session.auth.method,
    password: "",
    keyPath: session.auth.method === "key" ? session.auth.path : "~/.ssh/id_ed25519",
    passphrase: "",
  };
}
