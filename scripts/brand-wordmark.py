"""Outline the OxyTerm wordmark (Manrope 800) with the crossing-routes x."""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

font = TTFont(sys.argv[1])
gs = font.getGlyphSet()
cmap = font.getBestCmap()
hmtx = font["hmtx"]
TRACK = -40  # -0.02em at 2000 upm
STEM = 272   # Manrope 800 stem ('l' width)


def pair_kern(left, right):
    total = 0
    for lookup in font["GPOS"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if lookup.LookupType == 9:
                st = st.ExtSubTable
            if getattr(st, "LookupType", 2) != 2 or not hasattr(st, "Format"):
                continue
            if left not in st.Coverage.glyphs:
                continue
            if st.Format == 1:
                ps = st.PairSet[st.Coverage.glyphs.index(left)]
                for pvr in ps.PairValueRecord:
                    if pvr.SecondGlyph == right and pvr.Value1:
                        return getattr(pvr.Value1, "XAdvance", 0) or 0
            else:
                c1 = st.ClassDef1.classDefs.get(left, 0)
                c2 = st.ClassDef2.classDefs.get(right, 0)
                v = st.Class1Record[c1].Class2Record[c2].Value1
                val = getattr(v, "XAdvance", 0) or 0 if v else 0
                if val:
                    return val
    return total


def build(text_parts):
    """text_parts: list of (chars, fill) with 'X' meaning the symbol."""
    paths, x = [], 0
    bounds = [None]
    seq = [(ch, fill) for chars, fill in text_parts for ch in chars]
    prev = None
    for ch, fill in seq:
        g = "x" if ch == "X" else cmap[ord(ch)]
        if prev:
            x += pair_kern(prev, g)
        if ch == "X":
            paths.append(("X", x))
        else:
            pen = SVGPathPen(gs)
            gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
            bp = BoundsPen(gs)
            gs[g].draw(TransformPen(bp, (1, 0, 0, -1, x, 0)))
            b = bp.bounds
            if b:
                o = bounds[0]
                bounds[0] = b if o is None else (min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3]))
            paths.append((fill, pen.getCommands()))
        x += hmtx[g][0] + TRACK
        prev = g
    return paths, bounds[0]


def symbol(x0, blue, green, mask_id):
    # Glyph box of Manrope 'x': 20..1106 wide, 0..1080 high (y up).
    r = STEM / 2
    a = (x0 + 20 + r, -(1080 - r))
    b = (x0 + 1106 - r, -r)
    c = (x0 + 1106 - r, -(1080 - r))
    d = (x0 + 20 + r, -r)
    line = lambda p, q: f"M{p[0]:.0f} {p[1]:.0f}L{q[0]:.0f} {q[1]:.0f}"
    return (
        f'<mask id="{mask_id}" maskUnits="userSpaceOnUse" x="{x0-200}" y="-1300" width="1600" height="1500">'
        f'<rect x="{x0-200}" y="-1300" width="1600" height="1500" fill="#fff"/>'
        f'<path d="{line(c, d)}" stroke="#000" stroke-width="{STEM*1.56:.0f}" stroke-linecap="round"/></mask>'
        f'<path d="{line(a, b)}" stroke="{blue}" stroke-width="{STEM}" stroke-linecap="round" mask="url(#{mask_id})"/>'
        f'<path d="{line(c, d)}" stroke="{green}" stroke-width="{STEM}" stroke-linecap="round"/>'
    )


def render(text, base, accent, green, mask_id, label="OxyTerm"):
    paths, (x0, y0, x1, y1) = build([("O", base), ("X", None), ("y", base), ("Term", accent)])
    body = []
    for fill, d in paths:
        if fill == "X":
            body.append(symbol(d, accent, green, mask_id))
        else:
            body.append(f'<path fill="{fill}" d="{d}"/>')
    pad = 40
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0-pad:.0f} {y0-pad:.0f} {x1-x0+2*pad:.0f} {y1-y0+2*pad:.0f}" '
        f'role="img" aria-label="{label}">\n'
        "  <!-- Manrope ExtraBold outlined; the x is two routes crossing. -->\n  "
        + "\n  ".join(body) + "\n</svg>\n"
    )


out = sys.argv[2]
open(f"{out}/oxyterm-wordmark.svg", "w").write(render("", "#e6edf3", "#5ec4ff", "#8bd49c", "nt-wm-gap"))
open(f"{out}/oxyterm-wordmark-light.svg", "w").write(render("", "#0f1419", "#1769aa", "#2f7d45", "nt-wml-gap"))
open(f"{out}/oxyterm-wordmark-black.svg", "w").write(render("", "#111111", "#111111", "#111111", "nt-wmb-gap"))
open(f"{out}/oxyterm-wordmark-white.svg", "w").write(render("", "#ffffff", "#ffffff", "#ffffff", "nt-wmw-gap"))
