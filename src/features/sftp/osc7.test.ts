import { describe, expect, it } from "vitest";
import { parseOsc7 } from "./osc7";

describe("parseOsc7", () => {
  it("extracts the path from file://host/path", () => {
    expect(parseOsc7("file://web01/home/u/projects")).toBe("/home/u/projects");
  });

  it("accepts an empty host", () => {
    expect(parseOsc7("file:///tmp")).toBe("/tmp");
  });

  it("percent-decodes the path", () => {
    expect(parseOsc7("file://h/home/u/my%20docs/%C3%B1")).toBe("/home/u/my docs/ñ");
  });

  it("rejects anything that is not a file URL with a path", () => {
    expect(parseOsc7("http://h/x")).toBeNull();
    expect(parseOsc7("file://host")).toBeNull();
    expect(parseOsc7("")).toBeNull();
  });

  it("rejects malformed percent escapes", () => {
    expect(parseOsc7("file://h/bad%ZZ")).toBeNull();
    expect(parseOsc7("file://h/bad%FF")).toBeNull();
  });

  it("keeps a Windows drive path without the leading slash", () => {
    expect(parseOsc7("file:///C:/Users/me/My%20Docs")).toBe("C:/Users/me/My Docs");
    expect(parseOsc7("file://pc/d:/")).toBe("d:/");
  });
});
