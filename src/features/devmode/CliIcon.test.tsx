// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CliIcon, cliName } from "./CliIcon";

afterEach(cleanup);

describe("CliIcon (S13)", () => {
  it("draws each known CLI with its own mark and name", () => {
    const cases: [string, string, string][] = [
      ["claude", "Claude Code", "cli-icon--claude"],
      ["codex", "Codex", "cli-icon--codex"],
      ["agy", "Antigravity", "cli-icon--agy"],
      ["opencode", "OpenCode", "cli-icon--opencode"],
      ["pi", "pi", "cli-icon--pi"],
    ];
    for (const [cli, name, className] of cases) {
      const { unmount } = render(<CliIcon cli={cli} />);
      const icon = screen.getByRole("img", { name });
      expect(icon.classList.contains(className), cli).toBe(true);
      unmount();
    }
  });

  it("draws a terminal for any other program or none", () => {
    for (const cli of [null, "aider"]) {
      const { unmount } = render(<CliIcon cli={cli} />);
      expect(document.querySelector(".cli-icon--terminal"), String(cli)).not.toBeNull();
      unmount();
    }
    expect(cliName("aider")).toBe("aider");
  });
});

describe("Antigravity mark", () => {
  it("is the official favicon's arch, without its background, with ids of its own in every copy", () => {
    render(
      <>
        <CliIcon cli="agy" />
        <CliIcon cli="agy" />
      </>,
    );
    const [first, second] = screen.getAllByRole("img", { name: "Antigravity" });
    expect(first.tagName.toLowerCase()).toBe("svg");
    expect(first.querySelector("circle")).toBeNull();
    expect(first.querySelectorAll("filter").length).toBe(10);
    const ids = (svg: Element) => [...svg.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
    // Every reference points at an id of the same copy.
    for (const svg of [first, second]) {
      for (const el of svg.querySelectorAll("[mask], [filter]")) {
        const ref = /url\(#([^)]+)\)/.exec(el.getAttribute("mask") ?? el.getAttribute("filter") ?? "")?.[1];
        expect(ids(svg)).toContain(ref);
      }
    }
  });
});

describe("pi mark", () => {
  it("is the three blocks of pi.dev's favicon, in the text colour", () => {
    render(<CliIcon cli="pi" />);
    const icon = screen.getByRole("img", { name: "pi" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("viewBox")).toBe("0 0 560 560");
    expect(icon.querySelectorAll("path").length).toBe(3);
    expect(icon.getAttribute("fill")).toBe("currentColor");
  });
});

describe("OpenCode mark", () => {
  it("is opencode.ai's icon, its frame and lower block, without its background, in the text colour", () => {
    render(<CliIcon cli="opencode" />);
    const icon = screen.getByRole("img", { name: "OpenCode" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("viewBox")).toBe("34 34 112 112");
    expect(icon.querySelectorAll("path").length).toBe(2);
    expect(icon.getAttribute("fill")).toBe("currentColor");
    expect(icon.classList.contains("cli-icon--opencode")).toBe(true);
  });
});

describe("gentle-shell mark", () => {
  it("is gentle-ai's rose, traced to two paths, named gentle-shell", () => {
    render(<CliIcon cli="gentle-shell" />);
    const icon = screen.getByRole("img", { name: "gentle-shell" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("viewBox")).toBe("0 0 200 261");
    expect(icon.querySelectorAll("path").length).toBe(2);
    expect(icon.classList.contains("cli-icon--gentle-shell")).toBe(true);
  });
});
