# PlexusTerm brand assets

The logo is the "x" of PlexusTerm drawn as two routes crossing (blue over a gap, green on top). The wordmark is Manrope ExtraBold (800) outlined to paths, so no font is needed to display it. The gap between the routes is a mask, so every file has a transparent background.

| Use | Dark background | Light background | One colour, black | One colour, white |
|---|---|---|---|---|
| Wordmark | `plexusterm-wordmark.svg` | `plexusterm-wordmark-light.svg` | `plexusterm-wordmark-black.svg` | `plexusterm-wordmark-white.svg` |
| Mark (no tile) | `plexusterm-mark.svg` | `plexusterm-mark-light.svg` | `plexusterm-mark-black.svg` | `plexusterm-mark-white.svg` |
| App icon (tile) | `plexusterm-icon.svg` | — | — | — |

Colours: dark ground `#0f1419`, text `#e6edf3`, accent `#5ec4ff`, green `#8bd49c`; on light: text `#0f1419`, `#1769aa`, `#2f7d45`; one colour: `#111111` or `#ffffff`.

`png/` holds raster exports: wordmarks at 256 px high, marks at 512 px, and the app icon at 16–512 px. `plexusterm-icon-1024.png` is the source for `pnpm tauri icon`.

Regenerate:

```bash
# Wordmarks (Manrope variable font, OFL, not vendored)
fonttools varLib.instancer 'Manrope[wght].ttf' wght=800 -o Manrope-800.ttf
python3 scripts/brand-wordmark.py Manrope-800.ttf assets/brand
cp assets/brand/plexusterm-wordmark.svg src/assets/

# Platform icons
rsvg-convert -w 1024 -h 1024 assets/brand/plexusterm-icon.svg -o assets/brand/plexusterm-icon-1024.png
pnpm tauri icon assets/brand/plexusterm-icon-1024.png   # then drop src-tauri/icons/{android,ios}

# PNG exports
for f in wordmark wordmark-light wordmark-black wordmark-white; do rsvg-convert -h 256 assets/brand/plexusterm-$f.svg -o assets/brand/png/plexusterm-$f-256h.png; done
for f in mark mark-light mark-black mark-white; do rsvg-convert -h 512 assets/brand/plexusterm-$f.svg -o assets/brand/png/plexusterm-$f-512.png; done
for n in 16 32 64 128 256 512; do rsvg-convert -w $n -h $n assets/brand/plexusterm-icon.svg -o assets/brand/png/plexusterm-icon-$n.png; done
```
