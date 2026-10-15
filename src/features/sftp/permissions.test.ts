import { describe, expect, it } from "vitest";
import { modeString, octalString, parseOctal } from "./permissions";

describe("modeString", () => {
  it("shows the rwx triplets", () => {
    expect(modeString(0o755)).toBe("rwxr-xr-x");
    expect(modeString(0o640)).toBe("rw-r-----");
    expect(modeString(0)).toBe("---------");
  });

  it("shows setuid, setgid and sticky in the execute positions", () => {
    expect(modeString(0o4755)).toBe("rwsr-xr-x");
    expect(modeString(0o2644)).toBe("rw-r-Sr--");
    expect(modeString(0o1777)).toBe("rwxrwxrwt");
    expect(modeString(0o1776)).toBe("rwxrwxrwT");
  });
});

describe("octalString", () => {
  it("uses four octal digits", () => {
    expect(octalString(0o755)).toBe("0755");
    expect(octalString(0o4711)).toBe("4711");
    expect(octalString(0)).toBe("0000");
  });
});

describe("parseOctal", () => {
  it("accepts one to four octal digits", () => {
    expect(parseOctal("755")).toBe(0o755);
    expect(parseOctal(" 0644 ")).toBe(0o644);
    expect(parseOctal("4755")).toBe(0o4755);
    expect(parseOctal("7")).toBe(0o7);
  });

  it("rejects anything else", () => {
    for (const text of ["", "8", "75a", "17777", "-1", "0o755"]) expect(parseOctal(text)).toBeNull();
  });
});
