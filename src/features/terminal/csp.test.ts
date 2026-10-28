// @ts-expect-error type error without @types/node package (same as license contracts)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const security = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app.security;
const scriptSrc = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "))!;

describe("the content security policy", () => {
  it("lets the image addon compile its sixel decoder (WebAssembly), and nothing else run as code", () => {
    for (const csp of [security.csp, security.devCsp]) {
      const sources = scriptSrc(csp).split(/\s+/).slice(1);
      expect(sources).toContain("'wasm-unsafe-eval'");
      expect(sources).not.toContain("'unsafe-eval'");
      expect(sources).not.toContain("'unsafe-inline'");
    }
  });
});
