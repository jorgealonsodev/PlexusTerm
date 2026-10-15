// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { PlatformProvider, usePlatform } from "./usePlatform";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

function Probe() {
  return <span data-testid="platform">{usePlatform()}</span>;
}

const renderProbe = () =>
  render(
    <PlatformProvider>
      <Probe />
    </PlatformProvider>,
  );

describe("usePlatform", () => {
  it("returns the platform reported by the backend", async () => {
    vi.mocked(invoke).mockResolvedValue("windows");
    renderProbe();
    expect(await screen.findByText("windows")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("platform");
  });

  it("assumes linux until the backend answers, and when it answers nonsense or fails", async () => {
    vi.mocked(invoke).mockResolvedValue(["/dev/ttyUSB0"]);
    renderProbe();
    expect(screen.getByTestId("platform").textContent).toBe("linux");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByTestId("platform").textContent).toBe("linux");
    cleanup();

    vi.mocked(invoke).mockRejectedValue(new Error("no backend"));
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByTestId("platform").textContent).toBe("linux");
  });

  it("is linux without a provider, so components render alone in tests", () => {
    render(<Probe />);
    expect(screen.getByTestId("platform").textContent).toBe("linux");
    expect(invoke).not.toHaveBeenCalled();
  });
});
