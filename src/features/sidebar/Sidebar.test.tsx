// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar, type SidebarView } from "./Sidebar";

afterEach(cleanup);

const sidebar = (view: SidebarView, sftpAvailable: boolean, localAvailable: boolean) =>
  render(
    <Sidebar
      view={view}
      onViewChange={() => {}}
      sftpAvailable={sftpAvailable}
      localAvailable={localAvailable}
      sessions={<p>sessions panel</p>}
      sftp={<p>sftp panel</p>}
      local={<p>explorer panel</p>}
      tunnels={<p>tunnels panel</p>}
      macros={<p>macros panel</p>}
      collapsed={false}
      onExpand={() => {}}
      width={null}
      onWidthChange={() => {}}
    />,
  );

describe("Sidebar file browsers (L18)", () => {
  it("shows the file browser that fits the active tab instead of the one that does not", () => {
    sidebar("sftp", false, true);
    expect(screen.getByText("explorer panel")).toBeTruthy();
    cleanup();
    sidebar("explorer", true, false);
    expect(screen.getByText("sftp panel")).toBeTruthy();
    cleanup();
    sidebar("explorer", false, false);
    expect(screen.getByText("sessions panel")).toBeTruthy();
    cleanup();
    sidebar("macros", false, true);
    expect(screen.getByText("macros panel")).toBeTruthy();
  });
});

describe("Sidebar tabs", () => {
  it("lists the Explorer first, then Sessions, SFTP, Tunnels and Macros", () => {
    sidebar("sessions", true, true);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Explorer",
      "Sessions",
      "SFTP",
      "Tunnels",
      "Macros",
    ]);
  });
});
