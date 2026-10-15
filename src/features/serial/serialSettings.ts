import { t } from "../../i18n/i18n";
import type { SerialFlow, SerialParity, SerialSettings } from "../sessions/types";

export const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/** Select value meaning "use `customBaud`". */
export const CUSTOM_BAUD = "custom";

/** Raw serial form fields, as strings from the inputs. */
export interface SerialForm {
  path: string;
  /** One of COMMON_BAUD_RATES as text, or CUSTOM_BAUD. */
  baud: string;
  customBaud: string;
  dataBits: string;
  parity: SerialParity;
  stopBits: string;
  flow: SerialFlow;
}

export const defaultSerialForm: SerialForm = {
  path: "",
  baud: "115200",
  customBaud: "",
  dataBits: "8",
  parity: "none",
  stopBits: "1",
  flow: "none",
};

export type SerialFormResult = { ok: true; settings: SerialSettings } | { ok: false; error: string };

const DATA_BITS = [5, 6, 7, 8] as const;
const STOP_BITS = [1, 2] as const;

export function parseSerialForm(form: SerialForm): SerialFormResult {
  const path = form.path.trim();
  if (!path) return { ok: false, error: t("sessions.serial.portRequired") };
  const baudText = (form.baud === CUSTOM_BAUD ? form.customBaud : form.baud).trim();
  const baud = Number(baudText);
  if (!/^\d+$/.test(baudText) || !Number.isSafeInteger(baud) || baud <= 0) {
    return { ok: false, error: t("sessions.serial.baudInvalid") };
  }
  const dataBits = DATA_BITS.find((n) => String(n) === form.dataBits);
  if (!dataBits) return { ok: false, error: t("sessions.serial.dataBitsInvalid") };
  const stopBits = STOP_BITS.find((n) => String(n) === form.stopBits);
  if (!stopBits) return { ok: false, error: t("sessions.serial.stopBitsInvalid") };
  return { ok: true, settings: { path, baud, dataBits, parity: form.parity, stopBits, flow: form.flow } };
}

export function formFromSettings(settings: SerialSettings): SerialForm {
  const common = COMMON_BAUD_RATES.includes(settings.baud);
  return {
    path: settings.path,
    baud: common ? String(settings.baud) : CUSTOM_BAUD,
    customBaud: common ? "" : String(settings.baud),
    dataBits: String(settings.dataBits),
    parity: settings.parity,
    stopBits: String(settings.stopBits),
    flow: settings.flow,
  };
}

/** Text for an error rejected by the serial commands (`{ kind, message }`). */
export function describeSerialError(err: unknown): string {
  if (typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}
