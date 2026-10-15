// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { PasswordPrompt } from "./PasswordPrompt";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const CHECKBOX = "Save password in the system keyring";

beforeEach(() => mockedInvoke.mockReset());
afterEach(cleanup);

function submit(password: string) {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByText("Connect"));
}

describe("PasswordPrompt", () => {
  it("has no keyring checkbox when the session cannot be saved (quick connect)", () => {
    const onSubmit = vi.fn();
    render(<PasswordPrompt label="u@h" onSubmit={onSubmit} onCancel={() => {}} />);
    expect(screen.queryByLabelText(CHECKBOX)).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
    submit("pw");
    expect(onSubmit).toHaveBeenCalledWith("pw", false);
  });

  it("offers the checkbox unticked by default and reports it when ticked", async () => {
    mockedInvoke.mockResolvedValue(true);
    const onSubmit = vi.fn();
    render(<PasswordPrompt label="u@h" remember={{ initial: false }} onSubmit={onSubmit} onCancel={() => {}} />);
    const box = screen.getByLabelText<HTMLInputElement>(CHECKBOX);
    expect(box.checked).toBe(false);
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    expect(mockedInvoke).toHaveBeenCalledWith("secret_available");
    fireEvent.click(box);
    submit("pw");
    expect(onSubmit).toHaveBeenCalledWith("pw", true);
  });

  it("starts ticked when asked to (a saved password was rejected) and reports unticking", async () => {
    mockedInvoke.mockResolvedValue(true);
    const onSubmit = vi.fn();
    render(<PasswordPrompt label="u@h" remember={{ initial: true }} onSubmit={onSubmit} onCancel={() => {}} />);
    const box = screen.getByLabelText<HTMLInputElement>(CHECKBOX);
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    submit("pw");
    expect(onSubmit).toHaveBeenCalledWith("pw", false);
  });

  it("disables the checkbox with an explanation when no keyring is available", async () => {
    mockedInvoke.mockResolvedValue(false);
    const onSubmit = vi.fn();
    render(<PasswordPrompt label="u@h" remember={{ initial: true }} onSubmit={onSubmit} onCancel={() => {}} />);
    await screen.findByText(/No system keyring/);
    expect(screen.getByLabelText<HTMLInputElement>(CHECKBOX).disabled).toBe(true);
    submit("pw");
    expect(onSubmit).toHaveBeenCalledWith("pw", false);
  });
});
