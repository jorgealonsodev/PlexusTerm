import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";

/**
 * Syntax colours from the window's colour scheme (`--syntax-*`, set from its ANSI palette by
 * uiTheme.ts), so code reads like the terminal around it.
 */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.inserted], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.constant(tags.name)], color: "var(--syntax-number)" },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: "var(--syntax-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.labelName], color: "var(--syntax-type)" },
  { tag: [tags.tagName, tags.deleted, tags.invalid], color: "var(--syntax-tag)" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--syntax-property)" },
  { tag: tags.heading, color: "var(--syntax-function)", fontWeight: "bold" },
  { tag: [tags.link, tags.url], color: "var(--syntax-string)", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--bg)" },
  ".cm-scroller": { fontFamily: "var(--viewer-font, ui-monospace, monospace)", lineHeight: "1.5" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent) !important",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 35%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)" },
});

/**
 * A read-only CodeMirror view of a file (S2): line numbers, long lines wrapped to the width (S5),
 * search with Ctrl+F, and the language its name says highlighted once loaded (S3).
 */
export function createCodeView(parent: HTMLElement, text: string, fileName: string): EditorView {
  const languageSlot = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        EditorState.readOnly.of(true),
        // A viewer: nothing changes the text, typed or not (another file gets a new view).
        EditorState.changeFilter.of(() => false),
        EditorView.lineWrapping,
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of(searchKeymap),
        syntaxHighlighting(highlight),
        theme,
        languageSlot.of([]),
      ],
    }),
  });
  const description = LanguageDescription.matchFilename(languages, fileName);
  description
    ?.load()
    .then((support) => {
      // The view may have been closed while the language loaded.
      if (view.dom.isConnected) view.dispatch({ effects: languageSlot.reconfigure(support) });
    })
    .catch(() => {});
  return view;
}
