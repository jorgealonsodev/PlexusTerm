// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { filterSettings, matchesQuery, SEARCH_HIDDEN } from "./settingsSearch";

/** A settings section as the dialog draws it: options, and group headings between them. */
function section(name: string, html: string): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings__panel";
  panel.setAttribute("aria-label", name);
  panel.innerHTML = html;
  return panel;
}

const hidden = (el: Element | null) => el!.hasAttribute(SEARCH_HIDDEN);

describe("matchesQuery", () => {
  it("finds every word of the query in any order, ignoring case and accents", () => {
    expect(matchesQuery("Tamaño de la fuente del terminal", "FUENTE tamano")).toBe(true);
    expect(matchesQuery("Tamaño de la fuente", "fuente cursor")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("filterSettings", () => {
  const build = () => [
    section(
      "Appearance",
      `<h3 class="settings__group">Fonts</h3>
       <label id="size">Font size</label>
       <label id="weight">Weight</label>
       <h3 class="settings__group">Colours</h3>
       <label id="scheme">Colour scheme<span class="help-tip" aria-label="Palette of the terminal"></span></label>`,
    ),
    section("Terminal", `<label id="blink">Blinking cursor</label>`),
  ];

  it("leaves only the options found, their headings and their sections, and counts the sections", () => {
    const [appearance, terminal] = build();
    expect(filterSettings([appearance, terminal], "size")).toBe(1);
    expect(hidden(appearance.querySelector("#size"))).toBe(false);
    expect(hidden(appearance.querySelector("#weight"))).toBe(true);
    expect(hidden(appearance.querySelector("h3"))).toBe(false);
    expect(hidden(appearance.querySelectorAll("h3")[1])).toBe(true);
    expect(hidden(terminal)).toBe(true);
  });

  it("finds an option by the help of its tip, a group by its heading and a section by its name", () => {
    const [appearance, terminal] = build();
    filterSettings([appearance, terminal], "palette");
    expect(hidden(appearance.querySelector("#scheme"))).toBe(false);
    filterSettings([appearance, terminal], "fonts");
    expect(hidden(appearance.querySelector("#weight"))).toBe(false);
    expect(hidden(appearance.querySelector("#scheme"))).toBe(true);
    filterSettings([appearance, terminal], "terminal");
    expect(hidden(terminal.querySelector("#blink"))).toBe(false);
  });

  it("shows everything again for an empty query, and counts no sections when nothing is found", () => {
    const [appearance, terminal] = build();
    expect(filterSettings([appearance, terminal], "nothing-like-this")).toBe(0);
    expect(filterSettings([appearance, terminal], "")).toBe(2);
    expect([appearance, terminal, ...appearance.children, ...terminal.children].some(hidden)).toBe(false);
  });
});
