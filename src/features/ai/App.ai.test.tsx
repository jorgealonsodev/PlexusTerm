// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import type { AiSuggestContext, AssistTarget } from "../terminal/TerminalView";
import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const clipboard = vi.hoisted(() => ({ readText: vi.fn(async () => ""), writeText: vi.fn(async () => {}) }));
vi.mock("../terminal/clipboard", () => clipboard);

interface StubProps {
  onCwd?: (path: string) => void;
  registerWriter?: (write: (data: string) => void) => () => void;
  registerAssistTarget?: (target: AssistTarget) => () => void;
  aiSuggest?: (context: AiSuggestContext) => Promise<string | null>;
}

/** What the fake pane was sent, its selection, and the latest aiSuggest it was given. */
const pane = vi.hoisted(() => ({
  written: [] as string[],
  selection: "",
  focus: vi.fn(),
  aiSuggest: null as null | ((context: { line: string; hostKey: string; cwd: string | null; history: string[] }) => Promise<string | null>),
}));

vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({ onCwd, registerWriter, registerAssistTarget, aiSuggest }: StubProps) {
    pane.aiSuggest = aiSuggest ?? null;
    useEffect(() => {
      onCwd?.("/srv/app");
      const a = registerWriter?.((data) => pane.written.push(data));
      const b = registerAssistTarget?.({ selection: () => pane.selection, focus: pane.focus });
      return () => {
        a?.();
        b?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="terminal" />;
  },
}));

/** Answers per backend command; anything else resolves null. */
let answers: Record<string, (args: unknown) => unknown> = {};
const withSettings = (patch: Partial<TerminalSettings>) => {
  answers.settings_load = () => JSON.stringify({ ...DEFAULT_SETTINGS, ...patch });
};
const calls = (cmd: string) =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([c]) => c === cmd)
    .map(([, args]) => args as Record<string, unknown>);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const renderApp = async () => {
  render(<App />);
  await settle();
  await settle();
};

const pressShortcut = () =>
  act(() => {
    fireEvent.keyDown(window, { key: " ", ctrlKey: true, shiftKey: true });
  });

const assistant = () => screen.queryByRole("dialog", { name: "AI assistant" });
const brandImg = () => screen.getByAltText("PlexusTerm");

const mockReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  pane.written = [];
  pane.selection = "";
  pane.focus.mockClear();
  answers = {
    platform: () => "linux",
    history_load: () =>
      JSON.stringify({
        version: 1,
        hosts: { local: ["ls", "cd /srv", "git status", "make", "make test"].map((command, i) => ({ command, count: 1, last: i + 1 })) },
      }),
    ai_key_status: () => true,
  };
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const answer = answers[cmd];
    return answer ? answer(args) : null;
  });
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.useRealTimers();
});

describe("AI assistant (S3, S5)", () => {
  it("opens with the shortcut, focused on its input", async () => {
    await renderApp();
    expect(assistant()).toBeNull();
    pressShortcut();
    expect(assistant()).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Ask anything…"));
    fireEvent.keyDown(screen.getByPlaceholderText("Ask anything…"), { key: "Escape" });
    expect(assistant()).toBeNull();
  });

  it("follows a changed assistant shortcut", async () => {
    withSettings({ assistantShortcut: "Alt+K" });
    await renderApp();
    pressShortcut();
    expect(assistant()).toBeNull();
    act(() => void fireEvent.keyDown(window, { key: "k", altKey: true }));
    expect(assistant()).toBeTruthy();
  });

  it("opens from the X button, whose tooltip names the shortcut", async () => {
    await renderApp();
    const x = screen.getByRole("button", { name: "AI assistant" });
    expect(x.title).toBe("AI assistant (Ctrl+Shift+Space)");
    expect(x.contains(brandImg())).toBe(true);
    fireEvent.click(x);
    expect(assistant()).toBeTruthy();
  });

  it("spins the X once on every open, restarting it on a new trigger", async () => {
    await renderApp();
    expect(brandImg().classList.contains("brand--spin")).toBe(false);
    pressShortcut();
    const first = brandImg();
    expect(first.classList.contains("brand--spin")).toBe(true);
    fireEvent.keyDown(screen.getByPlaceholderText("Ask anything…"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    // A new element: the animation starts over instead of continuing.
    expect(brandImg()).not.toBe(first);
    expect(brandImg().classList.contains("brand--spin")).toBe(true);
    // jsdom has no AnimationEvent, so React listens for the prefixed name.
    fireEvent.animationEnd(brandImg());
    fireEvent(brandImg(), new Event("webkitAnimationEnd", { bubbles: true }));
    expect(brandImg().classList.contains("brand--spin")).toBe(false);
  });

  it("does not spin the X when the system asks for reduced motion", async () => {
    mockReducedMotion(true);
    await renderApp();
    pressShortcut();
    expect(assistant()).toBeTruthy();
    expect(brandImg().classList.contains("brand--spin")).toBe(false);
  });

  it("asks with the context and inserts the answer into the focused pane without Enter", async () => {
    withSettings({ aiProvider: "openai-compatible", aiBaseUrl: "http://localhost:11434/v1", aiModel: "llama3.2", aiHistoryContext: 2 });
    answers.ai_assist = () => ({ answer: "Sizes of the entries, smallest first.", command: "du -sh * | sort -h" });
    await renderApp();
    pressShortcut();
    const input = screen.getByPlaceholderText("Ask anything…");
    fireEvent.change(input, { target: { value: "what uses the most space here" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(calls("ai_assist")).toEqual([
      {
        config: { provider: "openai-compatible", model: "llama3.2", baseUrl: "http://localhost:11434/v1", sessionId: expect.any(String) },
        request: { prompt: "what uses the most space here", os: "linux", cwd: "/srv/app", history: ["make", "make test"], selection: null },
      },
    ]);
    expect(screen.getByText("du -sh * | sort -h")).toBeTruthy();
    expect(screen.getByText("Sizes of the entries, smallest first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(clipboard.writeText).toHaveBeenCalledWith("du -sh * | sort -h");
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(pane.written).toEqual(["du -sh * | sort -h"]);
    expect(assistant()).toBeNull();
    expect(pane.focus).toHaveBeenCalled();
  });

  const askAssistant = async (question: string) => {
    pressShortcut();
    const input = screen.getByPlaceholderText("Ask anything…");
    fireEvent.change(input, { target: { value: question } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
  };

  it("shows a general answer with no command box, Insert or Copy when no command fits (S8)", async () => {
    answers.ai_assist = () => ({ answer: "¡Hola! ¿En qué te ayudo?\nPuedo explicar errores.", command: null });
    await renderApp();
    await askAssistant("hola");
    const answer = screen.getByLabelText("Answer");
    expect(answer.textContent).toContain("¡Hola! ¿En qué te ayudo?");
    expect(answer.textContent).toContain("Puedo explicar errores.");
    expect(answer.querySelectorAll("br")).toHaveLength(1);
    expect(screen.queryByLabelText("Suggested command")).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.queryByText(/No command/)).toBeNull();
    expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
  });

  it("shows the answer above the command box with Insert and Copy when a command fits", async () => {
    answers.ai_assist = () => ({ answer: "Muestra el espacio libre.", command: "df -h" });
    await renderApp();
    await askAssistant("¿cuánto disco queda?");
    expect(screen.getByLabelText("Answer").textContent).toBe("Muestra el espacio libre.");
    expect(screen.getByLabelText("Suggested command").textContent).toBe("df -h");
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(pane.written).toEqual(["df -h"]);
  });

  it("renders fenced code in an answer as monospace blocks and never as HTML", async () => {
    answers.ai_assist = () => ({
      answer: "Lista con inodos:\n```sh\nls -i\nstat a.txt\n```\nY <b>esto</b> es texto.",
      command: null,
    });
    await renderApp();
    await askAssistant("inodos");
    const answer = screen.getByLabelText("Answer");
    const blocks = answer.querySelectorAll("pre");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe("ls -i\nstat a.txt");
    expect(answer.querySelector("b")).toBeNull();
    expect(answer.textContent).toContain("Y <b>esto</b> es texto.");
    expect(answer.textContent).not.toContain("```");
  });

  it("starts a new AI session for every assistant opening", async () => {
    answers.ai_assist = () => ({ answer: "", command: "ls" });
    await renderApp();
    const askOnce = async () => {
      pressShortcut();
      const input = screen.getByPlaceholderText("Ask anything…");
      fireEvent.change(input, { target: { value: "list" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await settle();
      fireEvent.change(input, { target: { value: "list again" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await settle();
      fireEvent.keyDown(input, { key: "Escape" });
    };
    await askOnce();
    await askOnce();
    const ids = calls("ai_assist").map((args) => (args.config as { sessionId: string }).sessionId);
    expect(ids).toHaveLength(4);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it("sends no history when command history is off, and Shift+Enter does not ask", async () => {
    withSettings({ commandHistory: false });
    answers.ai_assist = () => ({ answer: "", command: "ls" });
    await renderApp();
    pressShortcut();
    const input = screen.getByPlaceholderText("Ask anything…");
    fireEvent.change(input, { target: { value: "list" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await settle();
    expect(calls("ai_assist")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    expect(calls("ai_assist")[0]).toMatchObject({ config: { provider: "anthropic", model: "claude-opus-5-5" } });
    expect(calls("ai_assist")[0].config).not.toHaveProperty("baseUrl");
    expect((calls("ai_assist")[0].request as { history: string[] }).history).toEqual([]);
  });

  it("starts with the selected text ticked and shown, sends it with Ask, and not once unticked", async () => {
    answers.ai_assist = () => ({ answer: "", command: "sudo chown me file" });
    await renderApp();
    pane.selection = "error: permission denied";
    pressShortcut();
    const box = screen.getByLabelText("Include selected text") as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(true);
    expect(screen.getByLabelText("Selected text to send").textContent).toBe("error: permission denied");
    const input = screen.getByPlaceholderText("Ask anything…");
    fireEvent.change(input, { target: { value: "fix this" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(screen.queryByLabelText("Selected text to send")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    expect(calls("ai_assist").map((c) => (c.request as { selection: string | null }).selection)).toEqual([
      "error: permission denied",
      null,
    ]);
  });

  it("ticks the selected text also when opened from the X button", async () => {
    await renderApp();
    pane.selection = "make: *** [all] Error 2";
    fireEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    expect((screen.getByLabelText("Include selected text") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Selected text to send").textContent).toBe("make: *** [all] Error 2");
  });

  it("leaves Include selected text unticked and disabled without a selection", async () => {
    answers.ai_assist = () => ({ answer: "", command: "ls" });
    await renderApp();
    pressShortcut();
    const box = screen.getByLabelText("Include selected text") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.queryByLabelText("Selected text to send")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Ask anything…"), { target: { value: "list" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    expect((calls("ai_assist")[0].request as { selection: string | null }).selection).toBeNull();
  });

  it("says when no key is saved and opens Settings from there", async () => {
    answers.ai_key_status = () => false;
    await renderApp();
    pressShortcut();
    await settle();
    expect(screen.getByText(/No API key is saved for Anthropic/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(assistant()).toBeNull();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "AI" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows provider errors and lets a slow request be cancelled", async () => {
    let fail: (err: unknown) => void = () => {};
    answers.ai_assist = () => new Promise((_, reject) => (fail = reject));
    await renderApp();
    pressShortcut();
    fireEvent.change(screen.getByPlaceholderText("Ask anything…"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    await act(async () => fail({ kind: "rateLimit", message: "Too many requests; wait a minute." }));
    expect(screen.getByText("Too many requests; wait a minute.")).toBeTruthy();
  });
});

describe("AI suggestions (S2)", () => {
  const context = { line: "git comm", hostKey: "local", cwd: "/srv/app", history: ["git add .", "git status"] };

  it("is not offered to the panes while AI suggestions are off", async () => {
    await renderApp();
    expect(pane.aiSuggest).toBeNull();
  });

  it("asks the provider with only the line, OS, folder and history, returning the whole line", async () => {
    withSettings({ aiSuggestions: true, aiProvider: "gemini", aiModel: "gemini-3.5-flash-lite", aiBaseUrl: "http://ignored" });
    answers.ai_complete = () => ({ completion: "it -m wip" });
    await renderApp();
    let full: string | null = null;
    await act(async () => void (full = await pane.aiSuggest!(context)));
    expect(full).toBe("git commit -m wip");
    expect(calls("ai_complete")).toEqual([
      {
        config: { provider: "gemini", model: "gemini-3.5-flash-lite", sessionId: expect.any(String) },
        request: { line: "git comm", os: "linux", cwd: "/srv/app", history: ["git add .", "git status"] },
      },
    ]);
  });

  it("keeps one AI session per pane for its inline suggestions", async () => {
    withSettings({ aiSuggestions: true, aiProvider: "opencode-go", aiModel: "kimi-k3" });
    answers.ai_complete = () => ({ completion: "" });
    await renderApp();
    vi.useFakeTimers();
    await act(async () => {
      await pane.aiSuggest!(context);
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      const next = pane.aiSuggest!({ ...context, line: "git commi" });
      await vi.advanceTimersByTimeAsync(1000);
      await next;
    });
    const configs = calls("ai_complete").map((args) => args.config as { provider: string; model: string; sessionId: string });
    expect(configs).toHaveLength(2);
    expect(configs[0]).toEqual({ provider: "opencode-go", model: "kimi-k3", sessionId: expect.stringMatching(/^[A-Za-z0-9._-]{1,128}$/) });
    expect(configs[1].sessionId).toBe(configs[0].sessionId);
  });

  it("gives null for an empty completion", async () => {
    withSettings({ aiSuggestions: true });
    answers.ai_complete = () => ({ completion: "" });
    await renderApp();
    let full: string | null = "unset";
    await act(async () => void (full = await pane.aiSuggest!(context)));
    expect(full).toBeNull();
  });

  it("keeps one request in flight per pane and spaces them out", async () => {
    withSettings({ aiSuggestions: true });
    let finish: (value: unknown) => void = () => {};
    answers.ai_complete = () => new Promise((resolve) => (finish = resolve));
    await renderApp();
    vi.useFakeTimers();
    let first: Promise<string | null> = Promise.resolve(null);
    let second: Promise<string | null> = Promise.resolve(null);
    act(() => {
      first = pane.aiSuggest!(context);
      second = pane.aiSuggest!({ ...context, line: "git commi" });
    });
    expect(calls("ai_complete")).toHaveLength(1);
    await act(async () => finish({ completion: "it" }));
    await expect(first).resolves.toBe("git commit");
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(calls("ai_complete")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(calls("ai_complete")).toHaveLength(2);
    await act(async () => finish({ completion: "t" }));
    await expect(second).resolves.toBe("git commit");
  });

  it("is silent on errors except a small hint in the pane, cleared by the next answer", async () => {
    withSettings({ aiSuggestions: true });
    answers.ai_complete = () => Promise.reject({ kind: "noKey", message: "No API key is saved for Anthropic." });
    await renderApp();
    let full: string | null = "unset";
    await act(async () => void (full = await pane.aiSuggest!(context)));
    expect(full).toBeNull();
    const hint = screen.getByText("AI: no API key");
    expect(hint.title).toBe("No API key is saved for Anthropic.");
    answers.ai_complete = () => ({ completion: "it" });
    vi.useFakeTimers();
    await act(async () => {
      const next = pane.aiSuggest!(context);
      await vi.advanceTimersByTimeAsync(1000);
      await next;
    });
    expect(screen.queryByText("AI: no API key")).toBeNull();
  });
});
