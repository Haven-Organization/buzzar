# Generates res/svg/logo-full.svg (bee logomark + "buzzar" wordmark).
# Letters are Noto Sans Bold (SIL OFL 1.1) converted to outlines; the bee matches res/svg/logo.svg.
# Writes res/brand/{wordmark-black,wordmark-white,banner-purple}.svg (copy wordmark-black.svg to
# res/svg/logo-full.svg for the app). See res/brand/README.md.
# Usage: python -m venv .venv && .venv/bin/pip install fonttools && .venv/bin/python scripts/buzzar/make-wordmark.py [out_dir]
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font = TTFont("/usr/share/fonts/noto/NotoSans-Bold.ttf")
glyphset = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
xh = font["OS/2"].sxHeight
asc_b = 760  # approx ascender of 'b'

HEIGHT = 27.0            # ascender height, matches Third Room's logo-full (≈27 units)
scale = HEIGHT / asc_b
baseline = 27.5          # y of baseline in output space (Third Room letters sit on y≈27.3)
tracking = 0.5

paths = []
x = 0.25
def glyph(ch):
    global x
    name = cmap[ord(ch)]
    g = glyphset[name]
    pen = SVGPathPen(glyphset)
    # font y-up -> svg y-down
    tpen = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
    g.draw(tpen)
    paths.append(pen.getCommands())
    x += g.width * scale + tracking

# Bee logomark to the left of the letters, then "buzzar". Local bee space: body centred at 0,0 (rx 15.5,
# ry 11), head to the left, stinger to the right, wings above. Local extents: x -28..23 (51 wide), y -30..17.
xh_px = xh * scale
s = (xh_px * 0.92) / 22.0           # body height ≈ 92% of x-height
bee_left = x
bx = bee_left + 28.0 * s            # local x=-28 lands at bee_left
by = baseline - xh_px / 2           # body centred on the x-height
x = bee_left + 51.0 * s + 3.5       # gap between bee and text
for ch in "buzzar":
    glyph(ch)
width = x + 0.25
top = min(0.0, by - 32.5 * s) - 0.5  # wings may rise above the letters
bottom = max(29.0, by + 15.0 * s + 0.5)  # body outline may dip below the baseline

print(f"xh_px={xh_px:.2f} s={s:.3f} bee_left={bee_left:.2f} width={width:.2f} top={top:.2f}", file=sys.stderr)

bee = f'''
  <g transform="translate({bx:.3f} {by:.3f}) scale({s:.4f})">
    <defs>
      <mask id="bee-gap" maskUnits="userSpaceOnUse" x="-40" y="-40" width="80" height="70">
        <rect x="-40" y="-40" width="80" height="70" fill="white"/>
        <ellipse cx="0" cy="0" rx="15.5" ry="11" transform="rotate(-14)" fill="black" stroke="black" stroke-width="9"/>
      </mask>
      <mask id="head-gap" maskUnits="userSpaceOnUse" x="-40" y="-40" width="80" height="70">
        <rect x="-40" y="-40" width="80" height="70" fill="white"/>
        <circle cx="-19.5" cy="5.5" r="8.6" fill="black"/>
      </mask>
      <clipPath id="bee-body"><ellipse cx="0" cy="0" rx="15.5" ry="11"/></clipPath>
    </defs>
    <g mask="url(#bee-gap)">
      <ellipse cx="-5.5" cy="-19" rx="9.4" ry="5.5" transform="rotate(-62 -5.5 -19)" stroke="{{INK}}" stroke-width="4.7"/>
      <ellipse cx="7.2" cy="-17.5" rx="9.4" ry="5.5" transform="rotate(-26 7.2 -17.5)" stroke="{{INK}}" stroke-width="4.7"/>
    </g>
    <g mask="url(#head-gap)"><g transform="rotate(-14)">
      <g clip-path="url(#bee-body)">
        <rect x="-5" y="-15" width="4.7" height="30" fill="{{INK}}"/>
        <rect x="4.4" y="-15" width="4.7" height="30" fill="{{INK}}"/>
      </g>
      <ellipse cx="0" cy="0" rx="15.5" ry="11" stroke="{{INK}}" stroke-width="5.8"/>
      <path d="M17.8 0 L23 0" stroke="{{INK}}" stroke-width="4.2" stroke-linecap="round"/>
    </g></g>
    <circle cx="-19.5" cy="5.5" r="5.8" fill="{{INK}}"/>
    <path d="M-22.3 0.5 C-23.4 -2.8 -25.6 -5 -27.8 -5.6" stroke="{{INK}}" stroke-width="3" stroke-linecap="round"/>
    <path d="M-17.9 0 C-17.9 -3.3 -19 -6.1 -20.6 -8.3" stroke="{{INK}}" stroke-width="3" stroke-linecap="round"/>
  </g>'''

height = bottom - top
PURPLE = "#7000FF"  # same as the favicon (res/svg/logo.svg)


def wordmark_body(ink):
    letters = "".join(f'  <path d="{d}" fill="{ink}"/>\n' for d in paths)
    return letters + bee.replace("{INK}", ink)


def wordmark_svg(ink):
    return (
        f'<svg width="{width:.0f}" height="{height:.0f}" viewBox="0 {top:.2f} {width:.2f} {height:.2f}" '
        f'fill="none" xmlns="http://www.w3.org/2000/svg">\n{wordmark_body(ink)}\n</svg>\n'
    )


def banner_svg(pad_x=26.0, pad_y=16.0, radius=12.0):
    w, h = width + 2 * pad_x, height + 2 * pad_y
    return (
        f'<svg width="{w * 4:.0f}" height="{h * 4:.0f}" viewBox="0 0 {w:.2f} {h:.2f}" fill="none" '
        f'xmlns="http://www.w3.org/2000/svg">\n'
        f'  <rect width="{w:.2f}" height="{h:.2f}" rx="{radius}" fill="{PURPLE}"/>\n'
        f'  <g transform="translate({pad_x:.2f} {pad_y - top:.2f})">\n{wordmark_body("white")}  </g>\n</svg>\n'
    )


out_dir = sys.argv[1] if len(sys.argv) > 1 else "res/brand"
import os

os.makedirs(out_dir, exist_ok=True)
outputs = {
    "wordmark-black.svg": wordmark_svg("black"),
    "wordmark-white.svg": wordmark_svg("white"),
    "banner-purple.svg": banner_svg(),
}
for name, content in outputs.items():
    with open(os.path.join(out_dir, name), "w") as f:
        f.write(content)
    print("wrote", os.path.join(out_dir, name), file=sys.stderr)
