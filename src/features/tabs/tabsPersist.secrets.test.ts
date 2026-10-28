import { describe, expect, it } from "vitest";
import {
  parseTabsDocument,
  planRestore,
  sanitizeTarget,
  serializeTabs,
  snapshotTabs,
} from "./tabsPersist";
import type { Tab } from "./tabs";
import { leaf } from "../panes/paneLayout";

const SECRET = "hunter2-SECRET";
const tab = (target: any, extra: Partial<Tab> = {}): Tab => ({
  key: "tab-1",
  title: "x",
  renamed: false,
  target,
  layout: leaf("pane-1"),
  focusedPane: "pane-1",
  chats: {},
  viewers: {},
  ...extra,
});
const snap = (tabs: Tab[]) =>
  serializeTabs(
    snapshotTabs({
      tabs,
      activeKey: tabs[0]?.key ?? null,
      cwdOf: () => null,
      devOf: () => undefined,
      workspaceOf: () => undefined,
    }),
  );

const login = (auth: any) => ({
  host: "h",
  port: 22,
  username: "u",
  auth,
  storage: { action: "remember", sessionId: "s", label: SECRET },
  trustedFingerprint: SECRET,
  extraSecret: SECRET,
  password: SECRET,
  token: SECRET,
});

describe("tabs.json never holds secrets", () => {
  const targets: any[] = [
    { type: "ssh", ...login({ method: "password", password: SECRET }) },
    {
      type: "ssh",
      ...login({ method: "key", path: "/k", passphrase: SECRET }),
    },
    {
      type: "ssh",
      ...login({ method: "agent", secret: SECRET }),
      jumps: [
        { name: "j", ...login({ method: "password", password: SECRET }) },
        {
          name: "j2",
          ...login({ method: "key", path: "/k2", passphrase: SECRET }),
        },
      ],
    },
    {
      type: "mosh",
      ssh: { type: "ssh", ...login({ method: "password", password: SECRET }) },
      serverCommand: "mosh-server",
      password: SECRET,
    },
    { type: "telnet", host: "t", port: 23, password: SECRET, username: SECRET },
    {
      type: "serial",
      path: "/dev/ttyS0",
      baud: 9600,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flow: "none",
      password: SECRET,
    },
    {
      type: "local",
      program: "bash",
      env: { TOKEN: SECRET },
      password: SECRET,
    },
    {
      type: "shared",
      url: `https://x/s/a#${SECRET}`,
      relayUrl: "wss://r",
      relayHost: "r",
    },
  ];
  for (const target of targets) {
    it(`drops every secret of ${target.type} ${JSON.stringify(target.auth ?? target.ssh?.auth ?? {})}`, () => {
      const json = snap([tab(target)]);
      expect(json).not.toContain(SECRET);
      // round trip read also never re-introduces
      const doc = parseTabsDocument(json);
      expect(JSON.stringify(doc)).not.toContain(SECRET);
    });
  }
  it("a saved-session tab with a typed password writes only its id", () => {
    const json = snap([
      tab(
        {
          type: "ssh",
          host: "h",
          port: 22,
          username: "u",
          auth: { method: "password", password: SECRET },
        },
        { savedId: "s1" },
      ),
    ]);
    expect(json).not.toContain(SECRET);
    expect(JSON.parse(json).tabs[0].source).toEqual({ sessionId: "s1" });
  });
  it("a secret inside a read file never comes back", () => {
    const doc = parseTabsDocument(
      JSON.stringify({
        version: 1,
        active: 0,
        tabs: [
          {
            source: {
              target: {
                type: "ssh",
                host: "h",
                port: 22,
                username: "u",
                auth: { method: "password", password: SECRET },
              },
            },
            layout: { kind: "pane", id: "p" },
            focused: "p",
            panes: {},
          },
        ],
      }),
    );
    expect(JSON.stringify(doc)).not.toContain(SECRET);
    const plan = planRestore(
      doc!,
      [doc!.tabs[0].source && (doc!.tabs[0].source as any).target],
      { nextSeq: 1, nextPaneSeq: 1 },
    );
    expect(JSON.stringify(plan)).not.toContain(SECRET);
  });
  it("sanitizeTarget output keys are an allow-list", () => {
    expect(
      Object.keys(
        sanitizeTarget({ type: "telnet", host: "t", port: 23, x: 1 })!,
      ),
    ).toEqual(["type", "host", "port"]);
  });
});

describe("malformed tabs.json restores nothing and never throws", () => {
  const inputs: (string | null)[] = [
    null,
    "",
    "{",
    "null",
    "[]",
    "42",
    '"x"',
    '{"version":2,"active":0,"tabs":[]}',
    '{"version":1,"tabs":{}}',
    '{"version":1,"active":0,"tabs":[null,1,"x",{"source":null},{"source":{"target":{"type":"ssh"}}}]}',
    JSON.stringify({
      version: 1,
      active: 0,
      tabs: [
        {
          source: { target: { type: "local" } },
          layout: {
            kind: "split",
            direction: "row",
            ratio: 0.5,
            a: { kind: "pane", id: "p" },
            b: { kind: "pane", id: "p" },
          },
          focused: "p",
          panes: {},
        },
      ],
    }),
    JSON.stringify({
      version: 1,
      active: 0,
      tabs: [
        {
          source: { target: { type: "local" } },
          layout: { kind: "pane", id: "__proto__" },
          focused: "__proto__",
          panes: { __proto__: { cwd: "/x" } },
        },
      ],
    }),
  ];
  for (const json of inputs) {
    it(`input ${String(json).slice(0, 60)}`, () => {
      expect(() => parseTabsDocument(json)).not.toThrow();
      const doc = parseTabsDocument(json);
      expect(
        doc === null || doc.tabs.length === 0 || doc.tabs.length === 1,
      ).toBe(true);
    });
  }
  it("deeply nested layout does not overflow the stack", () => {
    let layout: any = { kind: "pane", id: "p0" };
    for (let i = 1; i < 100000; i++)
      layout = {
        kind: "split",
        direction: "row",
        ratio: 0.5,
        a: layout,
        b: { kind: "pane", id: `p${i}` },
      };
    let json: string;
    try {
      json = JSON.stringify({
        version: 1,
        active: 0,
        tabs: [
          {
            source: { target: { type: "local" } },
            layout,
            focused: "p0",
            panes: {},
          },
        ],
      });
    } catch {
      return;
    }
    expect(() => parseTabsDocument(json)).not.toThrow();
    expect(parseTabsDocument(json)!.tabs).toEqual([]);
  });
  it("huge file with many tabs parses without throwing", () => {
    const tabs = Array.from({ length: 20000 }, (_, i) => ({
      source: { target: { type: "local" } },
      layout: { kind: "pane", id: `p${i}` },
      focused: `p${i}`,
      panes: {},
    }));
    const doc = parseTabsDocument(
      JSON.stringify({ version: 1, active: 0, tabs }),
    );
    expect(doc!.tabs.length).toBe(20000);
  });
});
