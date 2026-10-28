// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickConnectDialog } from "./QuickConnectDialog";

afterEach(cleanup);

describe("QuickConnectDialog", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Remote host"), { target: { value: "u@h" } });
  };

  it("connects with a plain shell and no agent forwarding by default", () => {
    const onConnect = vi.fn();
    render(<QuickConnectDialog onConnect={onConnect} onCancel={() => {}} />);
    fill();
    fireEvent.click(screen.getByText("Connect"));
    const target = onConnect.mock.calls[0][0];
    expect(target).toMatchObject({ type: "ssh", host: "h", username: "u" });
    expect(target).not.toHaveProperty("forwardAgent");
    expect(target).not.toHaveProperty("tmuxSession");
  });

  it("connects with agent forwarding and the tmux session ticked", () => {
    const onConnect = vi.fn();
    render(<QuickConnectDialog onConnect={onConnect} onCancel={() => {}} />);
    fill();
    fireEvent.click(screen.getByLabelText("Forward SSH agent"));
    fireEvent.click(screen.getByLabelText("Keep the shell in tmux"));
    fireEvent.click(screen.getByText("Connect"));
    expect(onConnect.mock.calls[0][0]).toMatchObject({ forwardAgent: true, tmuxSession: "plexus" });
  });
});
