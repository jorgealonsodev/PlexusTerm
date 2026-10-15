import { t } from "../../i18n/i18n";

/** Telnet fields as typed. */
export interface TelnetForm {
  host: string;
  /** Empty means 23. */
  port: string;
}

export const emptyTelnetForm: TelnetForm = { host: "", port: "" };

export type TelnetFormResult = { ok: true; host: string; port: number } | { ok: false; error: string };

/** Validates host and port (default 23). */
export function parseTelnetForm(form: TelnetForm): TelnetFormResult {
  const host = form.host.trim();
  if (!host) return { ok: false, error: t("sessions.form.hostRequired") };
  const portText = form.port.trim();
  if (!portText) return { ok: true, host, port: 23 };
  const port = /^\d+$/.test(portText) ? Number(portText) : NaN;
  if (!(port >= 1 && port <= 65535)) return { ok: false, error: t("sessions.form.portRange") };
  return { ok: true, host, port };
}
