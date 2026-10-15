// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { serializeMacros, type Macro } from "./macros";
import { useMacros } from "./useMacros";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const macro: Macro = { id: "m1", name: "ls", steps: [{ kind: "send", text: "ls\\r" }] };

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

describe("useMacros (S16.5)", () => {
  it("loads macros.json and saves every change", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === "macros_load" ? serializeMacros({ version: 1, macros: [macro] }) : undefined,
    );
    const { result } = renderHook(() => useMacros());
    await waitFor(() => expect(result.current.status).toEqual({ state: "ready" }));
    expect(result.current.list.macros).toEqual([macro]);

    await act(async () => result.current.dispatch({ type: "delete", id: "m1" }));
    expect(result.current.list.macros).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("macros_save", { contents: serializeMacros({ version: 1, macros: [] }) });
  });

  it("disables editing when the file cannot be read, never overwriting it", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => (command === "macros_load" ? "{broken" : undefined));
    const { result } = renderHook(() => useMacros());
    await waitFor(() => expect(result.current.status.state).toBe("error"));
    await act(async () => result.current.dispatch({ type: "save", macro }));
    expect(result.current.list.macros).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith("macros_save", expect.anything());
  });
});
