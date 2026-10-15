// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedSession } from "../sessions/library";
import { MoshDialog } from "./MoshDialog";

afterEach(cleanup);

const ssh = (id: string, name: string): SavedSession => ({
  kind: "ssh",
  id,
  name,
  folder: "",
  host: `${name}.example.com`,
  port: 22,
  username: "deploy",
  auth: { method: "agent" },
});

describe("MoshDialog", () => {
  it("connects over the chosen saved SSH session with the default server command", () => {
    const onConnect = vi.fn();
    render(<MoshDialog sessions={[ssh("a", "web"), ssh("b", "db")]} onConnect={onConnect} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("SSH session"), { target: { value: "b" } });
    expect(screen.getByLabelText<HTMLInputElement>("Server command").placeholder).toBe(
      "mosh-server new -s -c 256 -l LANG=en_US.UTF-8",
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith("b", undefined);
  });

  it("passes a custom server command", () => {
    const onConnect = vi.fn();
    render(<MoshDialog sessions={[ssh("a", "web")]} onConnect={onConnect} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Server command"), { target: { value: " mosh-server new -p 60010 " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith("a", "mosh-server new -p 60010");
  });

  it("explains that a saved SSH session is needed when there is none", () => {
    render(<MoshDialog sessions={[]} onConnect={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Mosh logs in with a saved SSH session/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Connect" }).disabled).toBe(true);
  });
});
