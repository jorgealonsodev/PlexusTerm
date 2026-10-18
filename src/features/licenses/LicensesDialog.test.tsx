// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LicensesDialog, type LicensesData } from "./LicensesDialog";

afterEach(cleanup);

const data: LicensesData = {
  packages: [
    { ecosystem: "npm", name: "react", version: "19.3.1", license: "MIT", source: "https://react.dev/", texts: [0] },
    { ecosystem: "rust", name: "russh", version: "0.64.1", license: "Apache-2.0", source: "https://github.com/warp-tech/russh", texts: [1] },
    { ecosystem: "rust", name: "serialport", version: "4.10.1", license: "MPL-2.0", source: "https://github.com/serialport/serialport-rs", texts: [2] },
  ],
  texts: ["MIT License\nCopyright (c) Meta", "Apache License\nVersion 2.0", "Mozilla Public License Version 2.0"],
};

describe("Open-source licenses", () => {
  it("lists every shipped library with its version and license, loaded when opened", async () => {
    const load = vi.fn(async () => data);
    render(<LicensesDialog load={load} onClose={() => {}} onOpenLink={() => {}} />);
    expect(load).toHaveBeenCalledTimes(1);
    const list = await screen.findByRole("list", { name: "Libraries" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["react 19.3.1MIT", "russh 0.64.1Apache-2.0", "serialport 4.10.1MPL-2.0"]);
    expect(screen.getByText("3 libraries")).toBeTruthy();
  });

  it("filters by name or license", async () => {
    render(<LicensesDialog load={async () => data} onClose={() => {}} onOpenLink={() => {}} />);
    await screen.findByRole("list", { name: "Libraries" });
    const search = screen.getByRole("searchbox", { name: "Search libraries" });
    fireEvent.change(search, { target: { value: "mpl" } });
    expect(within(screen.getByRole("list", { name: "Libraries" })).getAllByRole("button").map((r) => r.textContent)).toEqual([
      "serialport 4.10.1MPL-2.0",
    ]);
    fireEvent.change(search, { target: { value: "RUS" } });
    expect(screen.getByText("1 library")).toBeTruthy();
  });

  it("shows a library's license text and its source, opened in the browser", async () => {
    const onOpenLink = vi.fn();
    render(<LicensesDialog load={async () => data} onClose={() => {}} onOpenLink={onOpenLink} />);
    const row = await screen.findByRole("button", { name: /russh/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Apache License\s+Version 2.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "https://github.com/warp-tech/russh" }));
    expect(onOpenLink).toHaveBeenCalledWith("https://github.com/warp-tech/russh");
  });

  it("closes with its button and with Escape", async () => {
    const onClose = vi.fn();
    render(<LicensesDialog load={async () => data} onClose={onClose} onOpenLink={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
