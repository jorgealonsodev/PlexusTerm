import { describe, expect, it } from "vitest";
import { programsDir } from "./programsDir";

describe("programsDir", () => {
  it("is where each system keeps its programs", () => {
    expect(programsDir("linux")).toBe("/usr/bin");
    expect(programsDir("windows")).toBe("C:\\Program Files");
    expect(programsDir("macos")).toBe("/Applications");
  });
});
