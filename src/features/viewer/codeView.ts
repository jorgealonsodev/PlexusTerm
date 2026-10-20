import { Annotation, Compartment, EditorState, Prec, RangeSet, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { changedLines, type LineChange } from "./changedLines";

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
  // The caret in the text colour: CodeMirror's default black is lost on dark schemes.
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent) !important",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 35%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)" },
  // VS Code's gutter colours for added, modified and deleted lines.
  ".cm-changes .cm-gutterElement": { width: "3px", padding: "0", position: "relative" },
  ".cm-change": { position: "absolute", inset: "0" },
  ".cm-change--added": { backgroundColor: "var(--git-added, #81b88b)" },
  ".cm-change--modified": { backgroundColor: "#1b81a8" },
  ".cm-change--deleted, .cm-change--deletedBelow": {
    insetInline: "0 -3px",
    height: "0",
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
    borderLeft: "4px solid var(--git-deleted, #c74e39)",
  },
  ".cm-change--deleted": { top: "-4px", bottom: "auto" },
  ".cm-change--deletedBelow": { top: "auto", bottom: "-4px" },
});

/** A bar in the changes gutter, coloured as VS Code colours added, modified and deleted lines. */
class ChangeMarker extends GutterMarker {
  constructor(readonly kind: LineChange["kind"]) {
    super();
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const bar = document.createElement("div");
    bar.className = `cm-change cm-change--${this.kind}`;
    return bar;
  }
}

const MARKERS = {
  added: new ChangeMarker("added"),
  modified: new ChangeMarker("modified"),
  deleted: new ChangeMarker("deleted"),
  deletedBelow: new ChangeMarker("deletedBelow"),
};

/** The file's text in its last commit, or null to mark no changed lines. */
const setCommitted = StateEffect.define<string | null>();

interface Changes {
  committed: string | null;
  marks: RangeSet<GutterMarker>;
}

function changeMarks(committed: string | null, state: EditorState): RangeSet<GutterMarker> {
  if (committed === null) return RangeSet.empty;
  const ranges = changedLines(committed, fileText(state))
    .filter((change) => change.line <= state.doc.lines)
    .map((change) => MARKERS[change.kind].range(state.doc.line(change.line).from));
  return RangeSet.of(ranges, true);
}

/** The lines that differ from the last commit, marked again after every change of the text. */
const changes = StateField.define<Changes>({
  create: () => ({ committed: null, marks: RangeSet.empty }),
  update(value, tr) {
    let committed = value.committed;
    for (const effect of tr.effects) if (effect.is(setCommitted)) committed = effect.value;
    if (committed === value.committed && !tr.docChanged) return value;
    return { committed, marks: changeMarks(committed, tr.state) };
  },
});

const changesGutter: Extension = [
  changes,
  gutter({ class: "cm-changes", markers: (view) => view.state.field(changes).marks }),
];

/** Marks the lines that differ from `committed` (the file's text in its last commit); null marks none. */
export function showChanges(view: EditorView, committed: string | null) {
  if (view.state.field(changes).committed !== committed) view.dispatch({ effects: setCommitted.of(committed) });
}

/** The changed lines the view marks, for tests. */
export function markedChanges(state: EditorState): LineChange[] {
  const found: LineChange[] = [];
  const cursor = state.field(changes).marks.iter();
  for (; cursor.value; cursor.next()) {
    found.push({ line: state.doc.lineAt(cursor.from).number, kind: (cursor.value as ChangeMarker).kind });
  }
  return found;
}

/** Marks the transaction that puts the file's new text in the view. */
const reload = Annotation.define<boolean>();

/** Shows the file's new text in place, at the same scroll position (the file changed on disk). */
export function reloadText(view: EditorView, text: string) {
  if (fileText(view.state) === text) return;
  const { scrollTop, scrollLeft } = view.scrollDOM;
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: head },
    // The file's own text: not an edit to undo.
    annotations: [reload.of(true), Transaction.addToHistory.of(false)],
  });
  view.scrollDOM.scrollTop = scrollTop;
  view.scrollDOM.scrollLeft = scrollLeft;
}

/**
 * The file's text in an editor state, with its own line breaks: the view splits lines only on the
 * separator the file uses (see `createCodeView`), so any other `\r` or `\n` is kept as it was.
 */
export const fileText = (state: EditorState) => state.sliceDoc();

/** The length of `fileText(state)`, without building it. */
export const fileTextLength = (state: EditorState) =>
  state.doc.length + (state.doc.lines - 1) * (state.lineBreak.length - 1);

/** What an editable view does with the text typed in it. */
export interface Editing {
  /** Called after each edit (not after a reload); `fileText(state)` is the text to save. */
  onEdit: (state: EditorState) => void;
  /** Ctrl+S (Cmd+S on macOS). */
  onSave: () => void;
}

/** Typing, undo/redo and Ctrl+S; without `editing`, a viewer where only a reload changes the text. */
function editingExtensions(editing?: Editing): Extension {
  if (!editing) {
    return [
      EditorState.readOnly.of(true),
      EditorState.changeFilter.of((tr) => tr.annotation(reload) === true),
    ];
  }
  return [
    history(),
    Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            editing.onSave();
            return true;
          },
        },
      ]),
    ),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && update.transactions.some((tr) => !tr.annotation(reload))) {
        editing.onEdit(update.state);
      }
    }),
  ];
}

/** A file's line break: what its lines are split on and joined with. */
export type LineBreak = "\n" | "\r\n";

/** The line break a text uses: CRLF when it has one, LF otherwise. */
export const lineBreakOf = (text: string): LineBreak => (text.includes("\r\n") ? "\r\n" : "\n");

/** The languages a viewer can highlight, by name, in alphabetical order. */
export const languageNames = () => languages.map((l) => l.name).sort((a, b) => a.localeCompare(b));

/** The language a file's name says, or null for plain text. */
export const languageOf = (fileName: string) => LanguageDescription.matchFilename(languages, fileName)?.name ?? null;

/** The parts of a view's configuration the status bar changes. */
const slots = new WeakMap<EditorView, { language: Compartment; lineBreak: Compartment; seq: number }>();

/** Highlights the view's text as `name` (a name of `languageNames()`), or plain with null. */
export function setLanguage(view: EditorView, name: string | null) {
  const slot = slots.get(view);
  if (!slot) return;
  // A language still loading must not replace one chosen after it.
  const seq = ++slot.seq;
  const description = name === null ? null : LanguageDescription.matchLanguageName(languages, name, false);
  if (!description) return void view.dispatch({ effects: slot.language.reconfigure([]) });
  description
    .load()
    .then((support) => {
      // The view may have been closed while the language loaded.
      if (view.dom.isConnected && seq === slot.seq) view.dispatch({ effects: slot.language.reconfigure(support) });
    })
    .catch(() => {});
}

/**
 * Joins the view's lines with another line break: `fileText` then gives the converted text. Not a
 * change of the document, so the caller tells the edit itself.
 */
export function setLineBreak(view: EditorView, lineBreak: LineBreak) {
  const slot = slots.get(view);
  if (slot) view.dispatch({ effects: slot.lineBreak.reconfigure(EditorState.lineSeparator.of(lineBreak)) });
}

/**
 * A CodeMirror view of a file (S2): line numbers, long lines wrapped to the width (S5), search
 * with Ctrl+F, and the language its name says highlighted once loaded (S3). Read-only unless
 * `editing` says what to do with the edits. Lines split only on `lineBreak`, the file's own one
 * by default.
 */
export function createCodeView(
  parent: HTMLElement,
  text: string,
  fileName: string,
  editing?: Editing,
  lineBreak: LineBreak = lineBreakOf(text),
): EditorView {
  const languageSlot = new Compartment();
  const lineBreakSlot = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        changesGutter,
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        // Lines split only on the file's own line break, so saving writes back the same ones.
        lineBreakSlot.of(EditorState.lineSeparator.of(lineBreak)),
        editingExtensions(editing),
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
  slots.set(view, { language: languageSlot, lineBreak: lineBreakSlot, seq: 0 });
  setLanguage(view, languageOf(fileName));
  return view;
}
