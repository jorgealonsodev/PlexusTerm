import { t } from "../../../i18n/i18n";

/** The well-known ports scanned by default. */
export const DEFAULT_PORTS = "21,22,23,25,53,80,110,143,443,445,3306,3389,5432,5900,8080";

export type PortMode = "known" | "range" | "custom";

export interface PortChoice {
  mode: PortMode;
  /** Range fields. */
  from: string;
  to: string;
  /** Custom list, e.g. `22,80,8000-8100`. */
  list: string;
}

export const DEFAULT_PORT_CHOICE: PortChoice = { mode: "known", from: "1", to: "65535", list: "" };

const PORT = /^\d{1,5}$/;

/** The port list sent to the backend for the chosen option. */
export function portsFor(choice: PortChoice): { ok: true; ports: string } | { ok: false; error: string } {
  if (choice.mode === "known") return { ok: true, ports: DEFAULT_PORTS };
  if (choice.mode === "custom") return { ok: true, ports: choice.list.trim() || DEFAULT_PORTS };
  const [from, to] = [choice.from.trim(), choice.to.trim()];
  const valid = (p: string) => PORT.test(p) && Number(p) >= 1 && Number(p) <= 65535;
  if (!valid(from) || !valid(to)) return { ok: false, error: t("tools.scan.invalidPorts") };
  if (Number(from) > Number(to)) return { ok: false, error: t("tools.scan.invalidPortOrder") };
  return { ok: true, ports: from === to ? from : `${from}-${to}` };
}
