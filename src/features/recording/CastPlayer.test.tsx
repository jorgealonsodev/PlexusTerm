// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeTerminal {
  options: Record<string, unknown>;
  cols: number;
  rows: number;
  written: string[];
  resets: number;
  disposed: boolean;
}
const terms = vi.hoisted(() => [] as FakeTerminal[]);
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols: number;
    rows: number;
    written: string[] = [];
    resets = 0;
    disposed = false;
    unicode = { activeVersion: "6" };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      this.cols = options.cols as number;
      this.rows = options.rows as number;
      terms.push(this as unknown as FakeTerminal);
    }
    loadAddon() {}
    open() {}
    write(data: string) {
      this.written.push(data);
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    reset() {
      this.resets++;
      this.written = [];
    }
    dispose() {
      this.disposed = true;
    }
  },
}));

import { CastPlayer } from "./CastPlayer";

const CAST = [
  '{"version":2,"width":100,"height":30,"timestamp":1700000000,"env":{"TERM":"xterm-256color"}}',
  '[1, "o", "one "]',
  '[2, "r", "90x20"]',
  '[3, "o", "two"]',
  '[65, "o", " end"]',
].join("\n");

const term = () => terms[terms.length - 1];

beforeEach(() => {
  terms.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderPlayer = async (load: () => Promise<string> = async () => CAST) => {
  const onClose = vi.fn();
  render(<CastPlayer path="/rec/demo.cast" load={load} onClose={onClose} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { onClose };
};

describe("CastPlayer", () => {
  it("shows the recording in a read-only terminal of the recorded size, with its length", async () => {
    await renderPlayer();
    expect(screen.getByRole("heading", { name: "demo.cast" })).toBeTruthy();
    expect(term().cols).toBe(100);
    expect(term().rows).toBe(30);
    expect(term().options.disableStdin).toBe(true);
    expect(screen.getByText("0:00 / 1:05")).toBeTruthy();
  });

  it("plays and pauses, showing the time", async () => {
    await renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(term().written.join("")).toBe("one two");
    expect(term().cols).toBe(90);
    expect(screen.getByText("0:03 / 1:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });
    expect(term().written.join("")).toBe("one two");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("plays faster at 4×", async () => {
    await renderPlayer();
    fireEvent.click(screen.getByRole("radio", { name: "4×" }));
    expect(screen.getByRole("radio", { name: "4×" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(term().written.join("")).toBe("one two");
  });

  it("seeks from the progress bar: starts again and writes everything up to there at once", async () => {
    await renderPlayer();
    fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "2.5" } });
    expect(term().resets).toBe(1);
    expect(term().written.join("")).toBe("one ");
    expect(term().cols).toBe(90);
    expect(screen.getByText("0:02 / 1:05")).toBeTruthy();
  });

  it("says why a file that is not a recording cannot be played", async () => {
    await renderPlayer(async () => "hello world");
    expect(screen.getByRole("alert").textContent).toMatch(/^This is not an asciicast v2 recording: line 1/);
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("says when the file cannot be read", async () => {
    await renderPlayer(async () => {
      throw "file is too large (limit 104857600 bytes)";
    });
    expect(screen.getByRole("alert").textContent).toBe("Could not read the recording: file is too large (limit 104857600 bytes)");
  });

  it("closes from its header and stops playing when it goes", async () => {
    const { onClose } = await renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Close player" }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(term().disposed).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(term().written).toEqual([]);
  });
});
