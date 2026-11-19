#!/usr/bin/env python3
"""
Buzzar: blink for Umamusume avatars. Their faces have no blink blend shapes, and their eyelid bones aren't named like
eyelids ("Eye_up_01_L", "Eye_bottom_01_L", "Eyelashes_L"…), so Buzzar can't find them. This writes the exact eyelid
moves for HAVEN_avatar_motion `face.eyelids.moves`, tuned by rendering Kitasan Black, Haru Urara, Mejiro McQueen and
Calstone Light O closed in Blender:

- Upper lid bones (Eye_up_01-04, Eye_up_11-14 and Eye_sub_01) drop straight down onto the lower lid line, taken
  across the Eye_bottom bones at each bone's x, and a little past it. Past the outer corner they drop a third as far.
- The lash bone follows Eye_up_01, slightly further; the crease (Eye_double) follows the nearest upper lid at 80%.
- The lower lid rises a little and the inner corner (Eye_middle_01) drops a little, so no iris shows between them.

Eye_up_05 / Eye_up_15 are deep pivots that no vertices follow, so they're left alone. All these bones are children of
Head, so the deltas are in Head's space.

Usage: python3 umamusume-eyelids.py avatar.glb face.json
  then: node_modules/.bin/vite-node scripts/buzzar/bake-gltf.ts -- avatar.glb out.glb --avatar --face-json face.json
"""
import json
import re
import struct
import sys

OVERLAP = 0.004  # metres past the lower lid line the upper lid closes to
CORNER_SLOP = 0.003  # upper bones this far past the last lower bone still count as over the lower lid
CORNER_SHARE = 0.35  # how far, of the way down to the last lower bone, the outer-corner bones drop
LASH_SCALE = 1.1
CREASE_SHARE = 0.8
LOWER_RAISE = 0.004
INNER_CORNER_DROP = 0.004

src, out = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
json_len = struct.unpack("<I", data[12:16])[0]
nodes = json.loads(data[20 : 20 + json_len])["nodes"]
named = [(i, n.get("name", ""), n.get("translation", [0, 0, 0])) for i, n in enumerate(nodes)]


def find(pattern):
    return [(i, name, t) for i, name, t in named if re.match(pattern, name)]


moves, upper, lower = [], [], []
for side in "LR":
    low = sorted(((t[0], t[1]) for _, _, t in find(rf"Eye_bottom_\d+_{side}_\d+$")), key=lambda p: abs(p[0]))
    if not low:
        sys.exit(f"no Eye_bottom bones on side {side}: not an Umamusume face rig?")

    def lower_y(x):
        ax = abs(x)
        if ax <= abs(low[0][0]):
            return low[0][1]
        for (x0, y0), (x1, y1) in zip(low, low[1:]):
            if abs(x0) <= ax <= abs(x1):
                return y0 + (ax - abs(x0)) / (abs(x1) - abs(x0)) * (y1 - y0)
        return low[-1][1] if ax <= abs(low[-1][0]) + CORNER_SLOP else None

    lid_drop = {}
    for i, name, (x, y, _) in find(rf"Eye_(up_(0[1-4]|1[1-4])|sub_01)_{side}_\d+$"):
        target = lower_y(x)
        target = y + (low[-1][1] - y) * CORNER_SHARE if target is None else target + OVERLAP
        drop = min(0.0, target - y)
        lid_drop[name] = (x, drop)
        moves.append({"node": i, "delta": [0, round(drop, 5), 0]})
        upper.append(i)
    row1 = [(x, d) for name, (x, d) in lid_drop.items() if name.startswith("Eye_up_0")]
    first = next(d for name, (x, d) in lid_drop.items() if name.startswith("Eye_up_01"))
    for i, _, _ in find(rf"Eyelashes_{side}_\d+$"):
        moves.append({"node": i, "delta": [0, round(first * LASH_SCALE, 5), 0]})
        upper.append(i)
    for i, _, (x, _, _) in find(rf"Eye_double_\d+_{side}_\d+$"):
        drop = min(row1, key=lambda p: abs(p[0] - x))[1]
        moves.append({"node": i, "delta": [0, round(drop * CREASE_SHARE, 5), 0]})
    for i, _, _ in find(rf"Eye_bottom_\d+_{side}_\d+$"):
        moves.append({"node": i, "delta": [0, LOWER_RAISE, 0]})
        lower.append(i)
    for i, _, _ in find(rf"Eye_middle_01_{side}_\d+$"):
        moves.append({"node": i, "delta": [0, -INNER_CORNER_DROP, 0]})

json.dump({"eyelids": {"upper": upper, "lower": lower, "moves": moves}}, open(out, "w"), indent=1)
print(f"{len(moves)} eyelid moves ({len(upper)} upper, {len(lower)} lower)")
