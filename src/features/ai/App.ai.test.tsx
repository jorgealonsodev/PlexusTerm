// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  focused?: boolean;
  onCwd?: (path: string) => void;
  onExit?: (code: number | null) => void;
  onSession?: (id: number | null) => void;
  onInput?: (data: string) => void;
  registerWriter?: (write: (data: string) => void) => () => void;
  registerAssistTarget?: (target: AssistTarget) => () => void;
  aiSuggest?: (context: AiSuggestContext) => Promise<string | null>;
}

/** What the fake terminals were sent (by terminal number), their selection, and the latest aiSuggest. */
const pane = vi.hoisted(() => ({
  written: [] as [number, string][],
  selection: "",
  focus: vi.fn(),
  mounts: 0,
  next: 1,
  aiSuggest: null as null | ((context: { line: string; hostKey: string; cwd: string | null; history: string[] }) => Promise<string | null>),
}));

vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({
    focused,
    onCwd,
    onExit,
    onSession,
    onInput,
    registerWriter,
    registerAssistTarget,
    aiSuggest,
  }: StubProps) {
    const [id] = useState(() => pane.next++);
    pane.aiSuggest = aiSuggest ?? null;
    useEffect(() => {
      pane.mounts += 1;
      onCwd?.("/srv/app");
      onSession?.(id);
      const a = registerWriter?.((data) => pane.written.push([id, data]));
      const b = registerAssistTarget?.({ selection: () => pane.selection, focus: pane.focus });
      return () => {
        a?.();
        b?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="terminal" data-focused={focused}>
        <button onClick={() => onInput?.(`typed in ${id}`)}>type in {id}</button>
        <button onClick={() => onExit?.(0)}>exit {id}</button>
      </div>
    );
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
const press = (key: string) =>
  act(() => {
    fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey: true });
  });

const chats = () => screen.queryAllByRole("region", { name: "AI chat" });
const chat = () => screen.getByRole("region", { name: "AI chat" });
const chatInput = () => within(chat()).getByPlaceholderText("Ask anything…");
const terminals = () => screen.queryAllByTestId("terminal");
const focusedTerminal = () => terminals().findIndex((t) => t.dataset.focused === "true");
const paneOf = (el: HTMLElement) => el.closest<HTMLElement>(".pane")!;
const brandImg = () => screen.getByAltText("PlexusTerm");

const ask = async (question: string) => {
  const input = chatInput();
  fireEvent.change(input, { target: { value: question } });
  fireEvent.keyDown(input, { key: "Enter" });
  await settle();
};

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
  pane.mounts = 0;
  pane.next = 1;
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

describe("AI chat pane (S3, S5, S9)", () => {
  it("opens with the shortcut as a pane below the focused terminal, without restarting it, focused on its input", async () => {
    await renderApp();
    expect(chats()).toHaveLength(0);
    pressShortcut();
    expect(chats()).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    const terminalPane = paneOf(terminals()[0]);
    const chatPane = paneOf(chat());
    expect(terminalPane.style.top).toBe("0%");
    expect(terminalPane.style.height).toBe("50%");
    expect(chatPane.style.top).toBe("50%");
    expect(chatPane.style.width).toBe("100%");
    expect(chatPane.classList.contains("pane--focused")).toBe(true);
    expect(document.activeElement).toBe(chatInput());
    expect(terminals()).toHaveLength(1);
    expect(pane.mounts).toBe(1);
  });

  it("splits the focused terminal, not another one", async () => {
    await renderApp();
    press("D"); // terminal 2, focused, right of terminal 1
    pressShortcut();
    const second = paneOf(terminals()[1]);
    const chatPane = paneOf(chat());
    expect(chatPane.style.left).toBe(second.style.left);
    expect(chatPane.style.top).toBe("50%");
    expect(paneOf(terminals()[0]).style.height).toBe("100%");
    expect(pane.mounts).toBe(2);
  });

  it("follows a changed assistant shortcut", async () => {
    withSettings({ assistantShortcut: "Alt+K" });
    await renderApp();
    pressShortcut();
    expect(chats()).toHaveLength(0);
    act(() => void fireEvent.keyDown(window, { key: "k", altKey: true }));
    expect(chats()).toHaveLength(1);
  });

  it("opens from the X button, whose tooltip names the shortcut", async () => {
    await renderApp();
    const x = screen.getByRole("button", { name: "AI assistant" });
    expect(x.title).toBe("AI assistant (Ctrl+Shift+Space)");
    expect(x.contains(brandImg())).toBe(true);
    fireEvent.click(x);
    expect(chats()).toHaveLength(1);
  });

  it("focuses the terminal's existing chat instead of opening another, and from the chat goes back to the terminal", async () => {
    await renderApp();
    pressShortcut();
    // Back to the terminal: the shortcut in the chat toggles.
    pressShortcut();
    expect(chats()).toHaveLength(1);
    expect(focusedTerminal()).toBe(0);
    expect(pane.focus).toHaveBeenCalled();
    expect(paneOf(chat()).classList.contains("pane--focused")).toBe(false);
    // From the terminal again: the same chat takes the focus.
    fireEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    expect(chats()).toHaveLength(1);
    expect(paneOf(chat()).classList.contains("pane--focused")).toBe(true);
    expect(document.activeElement).toBe(chatInput());
  });

  it("says so when the tab is full instead of opening a chat", async () => {
    await renderApp();
    press("D");
    press("D");
    press("D");
    expect(terminals()).toHaveLength(4);
    pressShortcut();
    expect(chats()).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain("This tab already has 4 panes");
  });

  it("spins the X once on every open, restarting it on a new trigger", async () => {
    await renderApp();
    expect(brandImg().classList.contains("brand--spin")).toBe(false);
    pressShortcut();
    const first = brandImg();
    expect(first.classList.contains("brand--spin")).toBe(true);
    pressShortcut(); // back to the terminal
    fireEvent.click(screen.getByRole("button", { name: "AI assistant" })); // focuses the chat again
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
    expect(chats()).toHaveLength(1);
    expect(brandImg().classList.contains("brand--spin")).toBe(false);
  });

  it("shows the provider and model in its header", async () => {
    withSettings({ aiProvider: "opencode-go", aiModel: "kimi-k3" });
    await renderApp();
    pressShortcut();
    expect(within(chat()).getByText("AI")).toBeTruthy();
    expect(within(chat()).getByText("OpenCode Go · kimi-k3")).toBeTruthy();
  });

  it("asks with the context and inserts the answer's command into the linked terminal without Enter", async () => {
    withSettings({ aiProvider: "openai-compatible", aiBaseUrl: "http://localhost:11434/v1", aiModel: "llama3.2", aiHistoryContext: 2 });
    answers.ai_assist = () => ({ answer: "Sizes of the entries, smallest first.", command: "du -sh * | sort -h" });
    await renderApp();
    press("D"); // terminal 2 gets the chat; terminal 1 must receive nothing
    pressShortcut();
    await ask("what uses the most space here");
    expect(calls("ai_assist")).toEqual([
      {
        config: { provider: "openai-compatible", model: "llama3.2", baseUrl: "http://localhost:11434/v1", sessionId: expect.any(String) },
        request: {
          prompt: "what uses the most space here",
          os: "linux",
          cwd: "/srv/app",
          history: ["make", "make test"],
          selection: null,
          conversation: [],
        },
      },
    ]);
    expect(within(chat()).getByLabelText("Question").textContent).toBe("what uses the most space here");
    expect(within(chat()).getByLabelText("Answer").textContent).toBe("Sizes of the entries, smallest first.");
    expect(within(chat()).getByLabelText("Suggested command").textContent).toBe("du -sh * | sort -h");
    expect((chatInput() as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(within(chat()).getByRole("button", { name: "Copy" }));
    expect(clipboard.writeText).toHaveBeenCalledWith("du -sh * | sort -h");
    fireEvent.click(within(chat()).getByRole("button", { name: "Insert" }));
    expect(pane.written).toEqual([[2, "du -sh * | sort -h"]]);
    expect(focusedTerminal()).toBe(1);
    expect(pane.focus).toHaveBeenCalled();
    // The chat stays open.
    expect(chats()).toHaveLength(1);
  });

  it("sends the earlier turns with a follow-up question, in one AI session per chat pane", async () => {
    let n = 0;
    answers.ai_assist = () => (++n === 1 ? { answer: "Use du.", command: "du -sh *" } : { answer: "Add sort.", command: null });
    await renderApp();
    pane.selection = "disk full";
    pressShortcut();
    await ask("what uses space?");
    await ask("and sorted?");
    const [first, second] = calls("ai_assist");
    expect((first.request as { conversation: unknown[] }).conversation).toEqual([]);
    expect((second.request as { conversation: unknown[]; selection: string | null })).toMatchObject({
      prompt: "and sorted?",
      selection: null,
      conversation: [{ question: "what uses space?", selection: "disk full", answer: "Use du.", command: "du -sh *" }],
    });
    const id = (args: Record<string, unknown>) => (args.config as { sessionId: string }).sessionId;
    expect(id(first)).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(id(second)).toBe(id(first));
    expect(within(chat()).getAllByLabelText("Answer").map((a) => a.textContent)).toEqual(["Use du.", "Add sort."]);
    // Another terminal's chat is another conversation.
    press("T");
    pressShortcut();
    await settle();
    const other = chats().find((c) => !c.closest(".tab-panes")!.hasAttribute("hidden"))!;
    const input = within(other).getByPlaceholderText("Ask anything…");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(id(calls("ai_assist")[2])).not.toBe(id(first));
    expect((calls("ai_assist")[2].request as { conversation: unknown[] }).conversation).toEqual([]);
  });

  it("shows a general answer with no command box, Insert or Copy when no command fits (S8)", async () => {
    answers.ai_assist = () => ({ answer: "¡Hola! ¿En qué te ayudo?\nPuedo explicar errores.", command: null });
    await renderApp();
    pressShortcut();
    await ask("hola");
    const answer = within(chat()).getByLabelText("Answer");
    expect(answer.textContent).toContain("¡Hola! ¿En qué te ayudo?");
    expect(answer.textContent).toContain("Puedo explicar errores.");
    expect(answer.querySelectorAll("br")).toHaveLength(1);
    expect(screen.queryByLabelText("Suggested command")).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.queryByText(/No command/)).toBeNull();
  });

  it("renders fenced code in an answer as monospace blocks and never as HTML", async () => {
    answers.ai_assist = () => ({
      answer: "Lista con inodos:\n```sh\nls -i\nstat a.txt\n```\nY <b>esto</b> es texto.",
      command: null,
    });
    await renderApp();
    pressShortcut();
    await ask("inodos");
    const answer = within(chat()).getByLabelText("Answer");
    const blocks = answer.querySelectorAll("pre");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe("ls -i\nstat a.txt");
    expect(answer.querySelector("b")).toBeNull();
    expect(answer.textContent).toContain("Y <b>esto</b> es texto.");
    expect(answer.textContent).not.toContain("```");
  });

  it("sends no history when command history is off, and Shift+Enter does not send", async () => {
    withSettings({ commandHistory: false });
    answers.ai_assist = () => ({ answer: "", command: "ls" });
    await renderApp();
    pressShortcut();
    fireEvent.change(chatInput(), { target: { value: "list" } });
    fireEvent.keyDown(chatInput(), { key: "Enter", shiftKey: true });
    await settle();
    expect(calls("ai_assist")).toHaveLength(0);
    fireEvent.click(within(chat()).getByRole("button", { name: "Send" }));
    await settle();
    expect(calls("ai_assist")[0]).toMatchObject({ config: { provider: "anthropic", model: "claude-opus-5-5" } });
    expect(calls("ai_assist")[0].config).not.toHaveProperty("baseUrl");
    expect((calls("ai_assist")[0].request as { history: string[] }).history).toEqual([]);
  });

  it("attaches the terminal selection to the first question as a chip shown before sending", async () => {
    answers.ai_assist = () => ({ answer: "Use sudo.", command: null });
    await renderApp();
    pane.selection = "error: permission denied";
    pressShortcut();
    expect(within(chat()).getByLabelText("Selected text to send").textContent).toBe("error: permission denied");
    await ask("fix this");
    expect(screen.queryByLabelText("Selected text to send")).toBeNull();
    await ask("and without sudo?");
    expect(calls("ai_assist").map((c) => (c.request as { selection: string | null }).selection)).toEqual([
      "error: permission denied",
      null,
    ]);
  });

  it("sends no selection once its chip is removed, and cuts it to 2000 characters", async () => {
    answers.ai_assist = () => ({ answer: "ok", command: null });
    await renderApp();
    pane.selection = "x".repeat(2500);
    pressShortcut();
    expect(within(chat()).getByLabelText("Selected text to send").textContent).toHaveLength(2000);
    fireEvent.click(within(chat()).getByRole("button", { name: "Remove selected text" }));
    expect(screen.queryByLabelText("Selected text to send")).toBeNull();
    await ask("hi");
    expect((calls("ai_assist")[0].request as { selection: string | null }).selection).toBeNull();
  });

  it("shows no chip without a selection", async () => {
    await renderApp();
    pressShortcut();
    expect(screen.queryByLabelText("Selected text to send")).toBeNull();
  });

  it("says when no key is saved and opens Settings on the AI section from there", async () => {
    answers.ai_key_status = () => false;
    await renderApp();
    pressShortcut();
    await settle();
    expect(within(chat()).getByText(/No API key is saved for Anthropic/)).toBeTruthy();
    fireEvent.change(chatInput(), { target: { value: "x" } });
    expect((within(chat()).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(chat()).getByRole("button", { name: "Open AI settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "AI" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Stop cancels the request in flight and puts the question back; errors show in their turn", async () => {
    let fail: (err: unknown) => void = () => {};
    let late: (value: unknown) => void = () => {};
    let n = 0;
    answers.ai_assist = () => new Promise((resolve, reject) => (++n === 1 ? (late = resolve) : (fail = reject)));
    await renderApp();
    pressShortcut();
    await ask("slow one");
    expect(within(chat()).getByText("Asking…")).toBeTruthy();
    fireEvent.click(within(chat()).getByRole("button", { name: "Stop" }));
    expect(within(chat()).queryByText("Asking…")).toBeNull();
    expect(within(chat()).queryByLabelText("Question")).toBeNull();
    expect((chatInput() as HTMLTextAreaElement).value).toBe("slow one");
    // A cancelled answer arriving late is dropped.
    await act(async () => late({ answer: "too late", command: null }));
    expect(screen.queryByText("too late")).toBeNull();
    await ask("slow one");
    await act(async () => fail({ kind: "rateLimit", message: "Too many requests; wait a minute." }));
    expect(within(chat()).getByRole("alert").textContent).toBe("Too many requests; wait a minute.");
    expect(within(chat()).getByLabelText("Question").textContent).toBe("slow one");
  });

  it("is never a multi-execution target and gets no exclude toggle", async () => {
    await renderApp();
    press("D");
    pressShortcut(); // chat under terminal 2
    press("M");
    expect(screen.getByRole("status").textContent).toContain("input goes to 2 terminals");
    expect(screen.getAllByRole("button", { name: "Exclude from multi-execution" })).toHaveLength(2);
    // Typing in the chat reaches no terminal.
    fireEvent.change(chatInput(), { target: { value: "ls" } });
    expect(pane.written).toEqual([]);
  });

  it("closes like a pane: Ctrl+Shift+W and its corner × (no second × in its header), leaving the terminal running", async () => {
    await renderApp();
    pressShortcut();
    press("W");
    expect(chats()).toHaveLength(0);
    expect(terminals()).toHaveLength(1);
    expect(focusedTerminal()).toBe(0);
    pressShortcut();
    const corner = paneOf(chat()).querySelector(".pane__corner")!;
    fireEvent.mouseEnter(corner);
    fireEvent.click(within(paneOf(chat())).getByRole("button", { name: "Close pane" }));
    expect(chats()).toHaveLength(0);
    pressShortcut();
    expect(within(chat()).queryByRole("button", { name: "Close AI chat" })).toBeNull();
    expect(pane.mounts).toBe(1);
  });

  it("closes with its terminal", async () => {
    await renderApp();
    press("D");
    pressShortcut(); // chat under terminal 2
    fireEvent.click(screen.getByRole("button", { name: "exit 2" }));
    expect(chats()).toHaveLength(0);
    expect(terminals()).toHaveLength(1);
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
