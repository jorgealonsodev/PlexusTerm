import { describe, expect, it } from "vitest";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
import data from "./licenses.generated.json";

const root = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

/** The `[dependencies]` names of Cargo.toml (the platform-specific tables included). */
function cargoDependencies(): string[] {
  const names: string[] = [];
  let inside = false;
  for (const line of read("src-tauri/Cargo.toml").split("\n")) {
    const table = /^\[(.+)\]\s*$/.exec(line.trim());
    if (table) inside = /(^|\.)dependencies$/.test(table[1]) && !/(dev|build)-dependencies$/.test(table[1]);
    else if (inside) {
      const name = /^([A-Za-z0-9_-]+)\s*=/.exec(line.trim());
      if (name) names.push(name[1]);
    }
  }
  return names;
}

describe("third-party licenses (regenerate with `pnpm licenses:generate`)", () => {
  const listed = (ecosystem: string) => new Set(data.packages.filter((p) => p.ecosystem === ecosystem).map((p) => p.name));

  it("lists every npm production dependency of package.json", () => {
    const deps = Object.keys(JSON.parse(read("package.json")).dependencies as Record<string, string>);
    expect(deps.filter((name) => !listed("npm").has(name))).toEqual([]);
  });

  it("lists every Rust dependency of Cargo.toml", () => {
    expect(cargoDependencies().filter((name) => !listed("rust").has(name))).toEqual([]);
  });

  it("gives every package its declared license and at least one license text", () => {
    for (const p of data.packages) {
      expect(p.license, p.name).not.toBe("");
      expect(p.texts.length, p.name).toBeGreaterThan(0);
      for (const index of p.texts) expect(data.texts[index]?.trim(), p.name).toBeTruthy();
    }
    expect(data.packages.some((p) => p.name === "plexusterm")).toBe(false);
  });
});
