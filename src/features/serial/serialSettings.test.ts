import { describe, expect, it } from "vitest";
import {
  COMMON_BAUD_RATES,
  defaultSerialForm,
  describeSerialError,
  formFromSettings,
  parseSerialForm,
  type SerialForm,
} from "./serialSettings";

const form = (overrides: Partial<SerialForm> = {}): SerialForm => ({
  ...defaultSerialForm,
  path: "/dev/ttyUSB0",
  ...overrides,
});

describe("defaultSerialForm", () => {
  it("defaults to 115200 8N1 without flow control", () => {
    expect(defaultSerialForm).toMatchObject({
      baud: "115200",
      dataBits: "8",
      parity: "none",
      stopBits: "1",
      flow: "none",
    });
  });

  it("offers the common baud rates", () => {
    expect(COMMON_BAUD_RATES).toEqual([9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]);
  });
});

describe("parseSerialForm", () => {
  it("builds serial settings", () => {
    expect(parseSerialForm(form({ path: " /dev/ttyACM0 ", baud: "9600", parity: "even", stopBits: "2" }))).toEqual({
      ok: true,
      settings: {
        path: "/dev/ttyACM0",
        baud: 9600,
        dataBits: 8,
        parity: "even",
        stopBits: 2,
        flow: "none",
      },
    });
  });

  it("accepts a custom baud rate", () => {
    expect(parseSerialForm(form({ baud: "custom", customBaud: "250000" }))).toMatchObject({
      ok: true,
      settings: { baud: 250000 },
    });
  });

  it("reports validation errors", () => {
    expect(parseSerialForm(form({ path: "  " }))).toEqual({ ok: false, error: "Serial port is required" });
    expect(parseSerialForm(form({ baud: "custom", customBaud: "abc" }))).toEqual({
      ok: false,
      error: "Baud rate must be a positive whole number",
    });
    expect(parseSerialForm(form({ baud: "custom", customBaud: "0" }))).toMatchObject({ ok: false });
  });

  it("round-trips through formFromSettings, including custom baud rates", () => {
    for (const baud of ["115200", "custom"]) {
      const parsed = parseSerialForm(form({ baud, customBaud: "250000", dataBits: "7", flow: "hardware" }));
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parseSerialForm(formFromSettings(parsed.settings))).toEqual(parsed);
    }
  });
});

describe("describeSerialError", () => {
  it("shows the backend message", () => {
    expect(describeSerialError({ kind: "permissionDenied", message: "join the dialout group" })).toBe(
      "join the dialout group",
    );
  });

  it("falls back to the raw text", () => {
    expect(describeSerialError("boom")).toBe("boom");
  });
});
