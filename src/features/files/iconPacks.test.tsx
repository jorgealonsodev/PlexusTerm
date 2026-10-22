// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EntryIcon, materialIconFor } from "./iconPacks";
import { MATERIAL_ICONS } from "./materialIcons.generated";

afterEach(cleanup);

describe("file icon packs", () => {
  it("gives Material icons by file name, longest extension and folder name, with the generic ones otherwise", () => {
    expect(materialIconFor("main.ts", "file").dark).toBe("typescript");
    expect(materialIconFor("types.d.ts", "file").dark).toBe("typescript-def");
    expect(materialIconFor("Dockerfile", "file").dark).toBe("docker");
    expect(materialIconFor("README.md", "file").dark).toBe("readme");
    expect(materialIconFor("notes.txt", "file").dark).toBe("document");
    expect(materialIconFor("something.unknownext", "file").dark).toBe("file");
    expect(materialIconFor("src", "dir").dark).toBe("folder-src");
    expect(materialIconFor("src", "dir", true).dark).toBe("folder-src-open");
    expect(materialIconFor("my-stuff", "dir").dark).toBe("folder");
    expect(materialIconFor("my-stuff", "dir", true).dark).toBe("folder-open");
  });

  it("has every icon it can give", () => {
    for (const [name, kind, open] of [
      ["a.ts", "file", false],
      ["src", "dir", true],
      [".git", "dir", false],
      ["x.zzz", "file", false],
    ] as const) {
      const { dark, light } = materialIconFor(name, kind, open);
      expect(MATERIAL_ICONS[dark], dark).toMatch(/^data:image\/svg\+xml/);
      expect(MATERIAL_ICONS[light], light).toMatch(/^data:image\/svg\+xml/);
    }
  });

  it("draws an entry with the pack chosen", () => {
    const iconOf = (pack: "material" | "seti" | "lines" | "classic") => {
      const { container } = render(<EntryIcon pack={pack} name="main.ts" kind="file" />);
      const icon = container.querySelector(".sftp-row__icon")!;
      cleanup();
      return icon;
    };
    expect(iconOf("material").querySelector("img")).not.toBeNull();
    expect(iconOf("seti").classList.contains("file-icon")).toBe(true);
    expect(iconOf("lines").querySelector("svg")!.getAttribute("data-kind")).toBe("code");
    expect(iconOf("classic").textContent).toBe("📄");
  });
});
