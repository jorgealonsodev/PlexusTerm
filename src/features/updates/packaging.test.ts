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

  it("preserves the existing product, executable, identifier and version", () => {
    expect(config.productName).toBe("PlexusTerm");
    expect(config.identifier).toBe("dev.plexusterm.app");
    expect(config.version).toBe("0.2.18");
    expect(config.mainBinaryName).toBeUndefined();
    expect(config.bundle.linux.deb.section).toBe("net");
    expect(config.bundle.linux.deb.desktopTemplate).toBe("linux/plexusterm.desktop");
    const manifest = readFileSync("src-tauri/Cargo.toml", "utf8");
    expect(manifest).toMatch(/name = "plexusterm"/);
    expect(manifest).toMatch(/version = "0\.2\.18"/);
    expect(JSON.parse(readFileSync("package.json", "utf8")).version).toBe(config.version);
  });
});
