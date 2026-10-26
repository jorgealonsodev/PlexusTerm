/** Marks a settings section or option the search leaves out (the stylesheet hides it). */
export const SEARCH_HIDDEN = "data-search-hidden";

/** Lower case without accents, so "Fuente" finds "fuente" and "cursor" finds "cursór". */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Whether every word of the query is in the text, in any order. */
export function matchesQuery(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const haystack = fold(text);
  return words.every((word) => haystack.includes(word));
}

/** What a setting is found by: its text, and the help of its (?) tips, which only show on hover. */
function searchText(el: Element): string {
  const tips = Array.from(el.querySelectorAll(".help-tip"), (tip) => tip.getAttribute("aria-label") ?? "");
  return [el.textContent ?? "", ...tips].join(" ");
}

/**
 * Leaves in each settings section only the options the query finds, and only the sections with
 * some: a section found by its name, or a group heading found by its text, keeps all its options.
 * An empty query shows everything again. Returns how many sections are left.
 */
export function filterSettings(panels: readonly HTMLElement[], query: string): number {
  const searching = query.trim() !== "";
  let shown = 0;
  for (const panel of panels) {
    const wholePanel = !searching || matchesQuery(panel.getAttribute("aria-label") ?? "", query);
    let any = false;
    let heading: Element | null = null;
    let headingFound = false;
    let headingHasItems = false;
    const closeGroup = () => {
      if (heading) heading.toggleAttribute(SEARCH_HIDDEN, !(wholePanel || headingFound || headingHasItems));
    };
    for (const child of Array.from(panel.children)) {
      if (child.classList.contains("settings__group")) {
        closeGroup();
        heading = child;
        headingFound = searching && matchesQuery(child.textContent ?? "", query);
        headingHasItems = false;
        any ||= headingFound;
        continue;
      }
      const found = wholePanel || headingFound || matchesQuery(searchText(child), query);
      child.toggleAttribute(SEARCH_HIDDEN, !found);
      if (found) {
        headingHasItems = true;
        any = true;
      }
    }
    closeGroup();
    panel.toggleAttribute(SEARCH_HIDDEN, !(wholePanel || any));
    if (wholePanel || any) shown += 1;
  }
  return shown;
}
