import { describe, expect, it } from "vitest";
import { findQuickMatches, quickLabels, quickSelectKey, viewportLines, type QuickMatch } from "./quickSelect";

const texts = (line: string) => findQuickMatches([{ text: line, row: 0 }], 200).map((m) => [m.kind, m.text]);
const key = (k: string, shiftKey = false) => ({
  key: k,
  shiftKey,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
});

describe("quick select matcher", () => {
  it("finds URLs, without a sentence's final punctuation", () => {
    expect(texts("see https://example.com/a?b=1, or (http://x.org/p).")).toEqual([
      ["url", "https://example.com/a?b=1"],
      ["url", "http://x.org/p"],
    ]);
  });

  it("finds file paths with a folder in them, like the Ctrl+click links", () => {
    expect(texts("Wrote docs/PRD.md and /etc/hosts:12, not README.md")).toEqual([
      ["path", "docs/PRD.md"],
      ["path", "/etc/hosts"],
    ]);
  });

  it("finds IPv4 and IPv6 addresses, not times or C++ names", () => {
    expect(texts("from 192.168.1.20 via fe80::1 and 2001:db8:0:0:0:0:2:1 at 12:30:45 std::vector 999.1.1.1")).toEqual([
      ["ip", "192.168.1.20"],
      ["ip", "fe80::1"],
      ["ip", "2001:db8:0:0:0:0:2:1"],
    ]);
  });

  it("finds git hashes of 7 to 40 hex characters with digits and letters", () => {
    const full = "0123456789abcdef0123456789abcdef01234567";
    expect(texts(`commit ${full} (4a1b2c3) 1234567 defaced 12ab3`)).toEqual([
      ["hash", full],
      ["hash", "4a1b2c3"],
    ]);
  });

  it("finds e-mail addresses, not as paths", () => {
    expect(texts("Author: Jane Doe <jane.doe+git@example.co.uk>")).toEqual([["email", "jane.doe+git@example.co.uk"]]);
  });

  it("keeps each match's row and column; a URL inside a path line is one match", () => {
    const matches = findQuickMatches(
      [
        { text: "x https://a.io/q", row: 3 },
        { text: "ok 10.0.0.1", row: 4 },
      ],
      80,
    );
    expect(matches.map(({ row, col, text }) => ({ row, col, text }))).toEqual([
      { row: 3, col: 2, text: "https://a.io/q" },
      { row: 4, col: 3, text: "10.0.0.1" },
    ]);
  });

  it("places a match of a wrapped line on the row it starts on", () => {
    const [match] = findQuickMatches([{ text: "0123456789 https://wrapped.example/x", row: 5 }], 10);
    expect(match).toMatchObject({
      row: 6,
      col: 1,
      text: "https://wrapped.example/x",
    });
  });

  it("joins wrapped rows of the viewport into one line", () => {
    const rows = [
      { text: "abc https://ex", wrapped: false },
      { text: "ample.com/z", wrapped: true },
      { text: "next", wrapped: false },
    ];
    expect(viewportLines(rows, 7)).toEqual([
      { text: "abc https://example.com/z", row: 7 },
      { text: "next", row: 9 },
    ]);
  });
});

describe("quick select labels", () => {
  it("gives one letter each while there are few matches, home row first", () => {
    expect(quickLabels(4)).toEqual(["a", "s", "d", "f"]);
    expect(new Set(quickLabels(26)).size).toBe(26);
    expect(quickLabels(26).every((label) => label.length === 1)).toBe(true);
  });

  it("then two letters, unique and never starting with a one-letter label", () => {
    for (const count of [27, 60, 300, 676]) {
      const labels = quickLabels(count);
      expect(labels).toHaveLength(count);
      expect(new Set(labels).size).toBe(count);
      const singles = labels.filter((label) => label.length === 1);
      expect(labels.some((label) => label.length === 2 && singles.includes(label[0]))).toBe(false);
    }
    // More matches than two letters can name: the extra ones get no label.
    expect(quickLabels(1000)).toHaveLength(676);
  });
});

describe("quick select keys", () => {
  const matches = (count: number): QuickMatch[] =>
    quickLabels(count).map((label, i) => ({
      kind: "url",
      text: `https://site${i}.example`,
      row: i,
      col: 0,
      label,
    }));

  it("copies the match whose label is typed", () => {
    expect(quickSelectKey("", key("s"), matches(3))).toEqual({
      typed: "",
      pick: { match: matches(3)[1], open: false },
    });
  });

  it("opens it when the label is typed with Shift", () => {
    expect(quickSelectKey("", key("D", true), matches(3))).toEqual({
      typed: "",
      pick: { match: matches(3)[2], open: true },
    });
  });

  it("waits for the second letter of a two-letter label", () => {
    const many = matches(40);
    const two = many.find((m) => m.label.length === 2)!;
    const first = quickSelectKey("", key(two.label[0]), many);
    expect(first).toEqual({ typed: two.label[0] });
    expect(quickSelectKey(first.typed, key(two.label[1]), many).pick).toEqual({
      match: two,
      open: false,
    });
    // Backspace takes the letter back; a letter no label goes on with starts over.
    expect(quickSelectKey(first.typed, key("Backspace"), many)).toEqual({
      typed: "",
    });
  });

  it("leaves with Esc and ignores other keys", () => {
    expect(quickSelectKey("", key("Escape"), matches(3))).toEqual({
      typed: "",
      exit: true,
    });
    expect(quickSelectKey("", key("z"), matches(3))).toEqual({ typed: "" });
    expect(quickSelectKey("", key("1"), matches(3))).toEqual({ typed: "" });
  });
});
