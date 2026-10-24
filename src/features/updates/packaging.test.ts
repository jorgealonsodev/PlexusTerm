// @ts-expect-error type error without @types/node package (same as license contracts)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

describe("native update packaging contract", () => {
  it("declares the system authorization helper without replacing inferred GUI dependencies", () => {
    // Tauri adds GTK/WebKit dependencies to these explicit helper requirements.
    expect(config.bundle.linux.deb.depends).toEqual(["pkexec"]);
    expect(config.bundle.linux.rpm?.depends).toEqual(["polkit"]);
  });

  it("preserves product identity and keeps release versions synchronized", () => {
    expect(config.productName).toBe("PlexusTerm");
    expect(config.identifier).toBe("dev.plexusterm.app");
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.mainBinaryName).toBeUndefined();
    expect(config.bundle.linux.deb.section).toBe("net");
    expect(config.bundle.linux.deb.desktopTemplate).toBe("linux/plexusterm.desktop");
    const manifest = readFileSync("src-tauri/Cargo.toml", "utf8");
    expect(manifest).toMatch(/name = "plexusterm"/);
    expect(manifest.match(/^version = "([^"]+)"/m)?.[1]).toBe(config.version);
    expect(JSON.parse(readFileSync("package.json", "utf8")).version).toBe(config.version);
    const lockfile = readFileSync("src-tauri/Cargo.lock", "utf8");
    expect(lockfile.match(/\[\[package\]\]\r?\nname = "plexusterm"\r?\nversion = "([^"]+)"/)?.[1]).toBe(config.version);
    expect(readFileSync("packaging/README.md", "utf8")).toContain(`V=${config.version} `);
  });
});
