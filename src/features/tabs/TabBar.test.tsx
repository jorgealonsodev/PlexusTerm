// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TabBar } from "./TabBar";
import { leaf } from "../panes/paneLayout";

afterEach(cleanup);

const tab = (key: string, title: string) => ({
  key,
  title,
  target: { type: "local" as const },
  layout: leaf(`${key}-p1`),
  focusedPane: `${key}-p1`,
});

describe("TabBar", () => {
  it("marks the tabs whose output is logged to a file", () => {
    render(
      <TabBar
        tabs={[tab("t1", "one"), tab("t2", "two")]}
        activeKey="t1"
        logging={new Set(["t2"])}
        onActivate={() => {}}
        onClose={() => {}}
        onNew={() => {}}
      />,
    );
    const marks = screen.getAllByLabelText("Logging to file");
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[role=tab]")?.textContent).toContain("two");
  });
});
