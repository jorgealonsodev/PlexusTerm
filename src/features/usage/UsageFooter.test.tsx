// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { UsageFooter } from "./UsageFooter";
import { providerFor, resetUsageCache, type Usage } from "./aiUsage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const CODEX: Usage = {
  windows: [
    { kind: "fiveHour", percent: 3, resetsAt: 1_792_695_835, limited: false, group: null },
    { kind: "weekly", percent: 85, resetsAt: 1_793_082_826, limited: false, group: null },
  ],
};

beforeEach(() => {
  mockedInvoke.mockReset();
  resetUsageCache();
});
afterEach(cleanup);

describe("providerFor", () => {
  it("follows the CLI running in the terminal on Auto", () => {
    expect(providerFor("auto", "claude")).toBe("claude");
    expect(providerFor("auto", "codex")).toBe("codex");
    expect(providerFor("auto", "opencode")).toBe("opencodeGo");
    expect(providerFor("auto", "agy")).toBe("agy");
    expect(providerFor("auto", "pi")).toBeNull();
    expect(providerFor("auto", null)).toBeNull();
  });

  it("shows the chosen provider whatever runs in the terminal", () => {
    expect(providerFor("codex", null)).toBe("codex");
    expect(providerFor("opencodeGo", "claude")).toBe("opencodeGo");
    expect(providerFor("off", "claude")).toBeNull();
  });
});

describe("UsageFooter", () => {
  it("shows the 5-hour and weekly windows, read once for every bar showing the provider", async () => {
    mockedInvoke.mockImplementation(async (command: string) => (command === "usage_codex" ? CODEX : null));
    render(
      <>
        <UsageFooter provider="codex" choice="auto" active onChoose={vi.fn()} />
        <UsageFooter provider="codex" choice="auto" active onChoose={vi.fn()} />
      </>,
    );
    expect(await screen.findAllByText("5h 3%")).toHaveLength(2);
    expect(screen.getAllByText("7d 85%")[0].className).toContain("usage-footer__window--high");
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "usage_codex")).toHaveLength(1);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-label")).toContain("Codex plan usage");
  });

  it("opens a card with every window's bar, percentage and reset when the pointer rests on it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: 1_792_690_000_000 });
    try {
      mockedInvoke.mockImplementation(async (command: string) => (command === "usage_codex" ? CODEX : null));
      render(<UsageFooter provider="codex" choice="auto" active onChoose={vi.fn()} />);
      const button = await screen.findByRole("button");
      await screen.findByText("5h 3%");
      expect(button.title).toBe("");
      fireEvent.mouseEnter(button);
      const card = await screen.findByRole("tooltip");
      expect(card.textContent).toContain("Codex plan usage");
      expect(card.textContent).toContain("5-hour window");
      expect(card.textContent).toContain("Resets in 1 h 37 min");
      const bars = card.querySelectorAll<HTMLElement>(".usage-card__fill");
      expect([...bars].map((bar) => bar.style.width)).toEqual(["3%", "85%"]);
      expect(bars[1].className).toContain("usage-card__fill--high");
      fireEvent.mouseLeave(button);
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
      // The keyboard opens it too.
      fireEvent.focus(button);
      expect(await screen.findByRole("tooltip")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the fullest model group of each window and every group in the tooltip", async () => {
    const agy: Usage = {
      windows: [
        { kind: "fiveHour", percent: 0, resetsAt: null, limited: false, group: "Gemini Models" },
        { kind: "fiveHour", percent: 90, resetsAt: null, limited: false, group: "Claude and GPT models" },
        { kind: "weekly", percent: 25, resetsAt: null, limited: false, group: "Gemini Models" },
      ],
    };
    mockedInvoke.mockImplementation(async (command: string) => (command === "usage_agy" ? agy : null));
    render(<UsageFooter provider="agy" choice="auto" active onChoose={vi.fn()} />);
    expect(await screen.findByText("5h 90%")).toBeTruthy();
    expect(screen.getByText("7d 25%")).toBeTruthy();
    expect(screen.queryByText("5h 0%")).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("button"));
    const card = await screen.findByRole("tooltip");
    expect(card.textContent).toContain("Gemini Models · 5-hour window0%");
    expect(card.textContent).toContain("Claude and GPT models · 5-hour window90%");
  });

  it("is not read while the bar is off screen", () => {
    render(<UsageFooter provider="codex" choice="auto" active={false} onChoose={vi.fn()} />);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("explains a failed read in the tooltip", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "ai_opencode_go_usage") throw { kind: "noKey", message: "No OpenCode Go API key is saved." };
      return null;
    });
    render(<UsageFooter provider="opencodeGo" choice="auto" active onChoose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button").getAttribute("aria-label")).toContain("No OpenCode Go API key is saved."));
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect((await screen.findByRole("tooltip")).textContent).toContain("No OpenCode Go API key is saved.");
  });

  it("chooses whose usage to show from its menu", async () => {
    mockedInvoke.mockImplementation(async (command: string) => (command === "usage_codex" ? CODEX : null));
    const onChoose = vi.fn();
    render(<UsageFooter provider="codex" choice="auto" active onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button"));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "✓ Auto (the CLI running in the terminal)",
      "Claude Code",
      "Codex",
      "Antigravity",
      "OpenCode Go",
      "Off",
      "Refresh now",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "OpenCode Go" }));
    expect(onChoose).toHaveBeenCalledWith("opencodeGo");
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Off" }));
    expect(onChoose).toHaveBeenLastCalledWith("off");
  });

  it("turned off, keeps an off icon that reads nothing and whose menu turns it on again", async () => {
    const onChoose = vi.fn();
    render(<UsageFooter provider={null} choice="off" active onChoose={onChoose} />);
    const button = screen.getByRole("button", { name: "AI usage is off. Click to show it again" });
    expect(button.className).toContain("usage-footer--off");
    expect(screen.queryByText(/5h/)).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
    fireEvent.click(button);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Auto (the CLI running in the terminal)",
      "Claude Code",
      "Codex",
      "Antigravity",
      "OpenCode Go",
      "✓ Off",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Auto (the CLI running in the terminal)" }));
    expect(onChoose).toHaveBeenCalledWith("auto");
  });
});
