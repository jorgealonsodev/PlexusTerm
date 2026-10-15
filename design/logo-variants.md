# NexusTerm logo variants — round 3

Decision material produced with the `logo-design` framework (architecture → typographic register → symbol approach → application contexts → restraint). Rendered previews: the "NexusTerm logo concepts" canvas (round 3 boards 01–06). Round 1–2 concepts (A–H) were all line symbols in a dark tile; this round varies the **architecture** and the **typographic register** instead.

Shared palette (from the app): ground `#0f1419`, surface `#161d24`, accent `#5ec4ff`, signal green `#8bd49c`; on light: `#1769aa` and `#2f7d45`; one colour: `#111111` on white (or white on dark).

Audience test: sysadmins, DevOps and network engineers see the mark at 16–32 px in a dock, taskbar or launcher, usually next to other terminals. The silhouette has to survive there.

| # | Variant | Architecture | Typography | Symbol approach | 16 px | One colour | Signals | Rejects |
|---|---|---|---|---|---|---|---|---|
| 01 | x crossing | Letterform-as-symbol inside the wordmark (the **x** of Nexus) | Space Grotesk 700 | Letterform-derived: two routes crossing over/under | Strong (two diagonals) | Yes (white gap keeps the crossing) | "nexus" literally: where connections cross | Generic prompt icons |
| 02 | Cursor N | Lockup + letterform symbol | IBM Plex Sans 600 | Letterform-derived: N made of two block cursors | Very strong (solid blocks) | Yes | Terminal-native, solid, engineered | Thin line icons, gradients |
| 03 | nexus_term | Wordmark-only, `n_` fallback symbol | IBM Plex Mono 600 | Letterform fallback `n_` | Good via `n_` | Yes (pure type) | Written as typed: CLI culture, honest | Decorative symbols |
| 04 | `\|>` pipe | Symbol + wordmark lockup | Archivo 800 (lowercase) | Abstract gesture from shell syntax (pipe + redirect) | Very strong (bar + triangle) | Yes | Unix pipelines, data flowing between systems | Network-diagram clichés |
| 05 | Serif wordmark | Wordmark-only, serif `N` fallback | Source Serif 4 600 (Term italic) + mono `_` | Monogram fallback (serif N) | Fair (serif detail softens at 16 px) | Yes | Craft, longevity, "a tool you keep" | The category's sans/mono default |
| 06 | Hops `»` | Symbol + wordmark lockup | Sora 700 (lowercase) | Geometric reduction: two chevrons = one hop then the next | Strongest of the round | Yes | Jump hosts, tunnels, moving through servers | Literal servers, globes, clouds |

## Application notes

- **Favicon/app icon (16–32 px):** 02, 04 and 06 are solid or heavy-stroke and keep their silhouette; 01 needs the simplified 16 px version without the gap; 03 and 05 rely on their fallback symbols (`n_`, serif N).
- **Single colour / embroidery / foil:** all six collapse to one colour; 02, 04 and 06 have no fine detail and suit a 1.5" patch; 05's serifs need ≥ 18 mm.
- **Reverse:** all are designed on the dark ground first; light versions use the darker blue/green above (≥ 4.5:1 on `#f4f6f8`).
- **Motion:** 01 draws the two routes then crosses; 02 blinks the right cursor; 03 types itself; 04 slides the triangle out of the bar; 06 the chevrons step forward.

## Recommendation

For a terminal used daily at icon size: **06 (hops)** or **02 (cursor N)** as primary marks, both with clear silhouettes and a story tied to what NexusTerm does (jump hosts / the terminal cursor). **03** is the strongest pure wordmark if a typographic identity is preferred, paired with 02 or 06 as the icon.

Production refinement (exact construction grid, kerning, final SVG outlines with text converted to paths, icon set regeneration with `tauri icon`) happens only after a direction is chosen.
