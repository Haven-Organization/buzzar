# Builds Buzzar's stock Trampoline Thing (public/gltf/things/trampoline.glb) from the Sketchfab model:
#   "Trampoline" by 1-3D.com, CC BY-SA 4.0, https://sketchfab.com/3d-models/trampoline-052aaef6c5c34c5bac94607bcc12d2f9
# Changes: Z-up centimetres -> Y-up metres standing on y=0, the Buzzar bee logo (res/brand/icon-512.png) on the
# middle of the mat, and a HAVEN_trampoline node marking the mat as bouncy (docs/gltf/HAVEN_trampoline).
# Usage: python3 scripts/buzzar/make-trampoline-thing.py <trampoline.glb> [out.glb]
import json
import math
import struct
import sys

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "public/gltf/things/trampoline.glb"
LOGO = "res/brand/icon-512.png"

b = open(src, "rb").read()
jlen = struct.unpack("<I", b[12:16])[0]
gltf = json.loads(b[20 : 20 + jlen])
rest = b[20 + jlen :]
blen = struct.unpack("<I", rest[:4])[0]
assert rest[4:8] == b"BIN\0"
binary = bytearray(rest[8 : 8 + blen])


def pad4():
    while len(binary) % 4:
        binary.append(0)


def add_view(data, target=None):
    pad4()
    view = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
    if target:
        view["target"] = target
    binary.extend(data)
    gltf["bufferViews"].append(view)
    return len(gltf["bufferViews"]) - 1


def add_accessor(view, ctype, count, typ, **extra):
    gltf["accessors"].append({"bufferView": view, "componentType": ctype, "count": count, "type": typ, **extra})
    return len(gltf["accessors"]) - 1


# Model units: centimetres, Z up (under Sketchfab's Y-up root), mat top at z=0, feet at z=-49.95.
SCALE = 0.01
FEET_Z = -49.9503173828125
MAT_TOP = -FEET_Z * SCALE  # 0.4995 m above the ground
MAT_RADIUS = 1.28  # metres (the mat mesh is 2.56 m across)

# --- the logo: a disc on the mat, textured with the round bee icon ---
SEGMENTS = 64
LOGO_DIAMETER = 1.0
r = LOGO_DIAMETER / 2
pos, nor, uv = [(0.0, 0.0, 0.0)], [(0.0, 1.0, 0.0)], [(0.5, 0.5)]
for i in range(SEGMENTS):
    a = 2 * math.pi * i / SEGMENTS
    x, z = math.cos(a) * r, math.sin(a) * r
    pos.append((x, 0.0, z))
    nor.append((0.0, 1.0, 0.0))
    # Seen from above with -Z ahead: image right is +X, image down is +Z (toward you).
    uv.append((0.5 + x / LOGO_DIAMETER, 0.5 + z / LOGO_DIAMETER))
idx = []
for i in range(SEGMENTS):
    j = (i + 1) % SEGMENTS
    idx += [0, j + 1, i + 1]  # counter-clockwise seen from above (+Y)
pv = add_view(b"".join(struct.pack("<3f", *p) for p in pos), 34962)
nv = add_view(b"".join(struct.pack("<3f", *n) for n in nor), 34962)
uvv = add_view(b"".join(struct.pack("<2f", *t) for t in uv), 34962)
iv = add_view(b"".join(struct.pack("<H", i) for i in idx), 34963)
pa = add_accessor(pv, 5126, len(pos), "VEC3", min=[-r, 0, -r], max=[r, 0, r])
na = add_accessor(nv, 5126, len(nor), "VEC3")
ua = add_accessor(uvv, 5126, len(uv), "VEC2")
ia = add_accessor(iv, 5123, len(idx), "SCALAR")
img_view = add_view(open(LOGO, "rb").read())
gltf.setdefault("images", []).append({"name": "buzzar-logo", "mimeType": "image/png", "bufferView": img_view})
gltf.setdefault("samplers", []).append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
gltf.setdefault("textures", []).append({"source": len(gltf["images"]) - 1, "sampler": len(gltf["samplers"]) - 1})
gltf["materials"].append(
    {
        "name": "buzzar-logo",
        "pbrMetallicRoughness": {
            "baseColorTexture": {"index": len(gltf["textures"]) - 1},
            "metallicFactor": 0.0,
            "roughnessFactor": 0.9,
        },
    }
)
gltf["meshes"].append(
    {
        "name": "Logo",
        "primitives": [
            {
                "attributes": {"POSITION": pa, "NORMAL": na, "TEXCOORD_0": ua},
                "indices": ia,
                "material": len(gltf["materials"]) - 1,
            }
        ],
    }
)

# --- node tree: Trampoline (metres, Y up, feet on y=0) ---
nodes = gltf["nodes"]
scene = gltf.get("scene", 0)
old_roots = gltf["scenes"][scene]["nodes"]
# (The Sketchfab root node already turns Z-up into Y-up.)
nodes.append({"name": "Model", "children": old_roots, "translation": [0, MAT_TOP, 0], "scale": [SCALE, SCALE, SCALE]})
model = len(nodes) - 1
nodes.append({"name": "Logo", "mesh": len(gltf["meshes"]) - 1, "translation": [0, MAT_TOP + 0.004, 0]})
logo = len(nodes) - 1
nodes.append(
    {
        "name": "Trampoline Bed",
        "translation": [0, MAT_TOP, 0],
        "extensions": {"HAVEN_trampoline": {"size": [2 * MAT_RADIUS, 2 * MAT_RADIUS], "shape": "round"}},
    }
)
bed = len(nodes) - 1
nodes.append({"name": "Trampoline", "children": [model, logo, bed]})
gltf["scene"] = scene
gltf["scenes"][scene]["nodes"] = [len(nodes) - 1]
gltf["extensionsUsed"] = sorted(set(gltf.get("extensionsUsed", []) + ["HAVEN_trampoline"]))
gltf["asset"]["generator"] = "Buzzar make-trampoline-thing.py (from Sketchfab-12.78.0)"
gltf["asset"]["copyright"] = (
    '"Trampoline" by 1-3D.com (https://sketchfab.com/1-3D.com), CC BY-SA 4.0; adapted for Buzzar '
    "(rescaled, Buzzar logo added, bounce marker). This adaptation is also CC BY-SA 4.0."
)

pad4()
gltf["buffers"][0]["byteLength"] = len(binary)
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
glb = (
    b"glTF"
    + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(binary))
    + struct.pack("<I", len(js))
    + b"JSON"
    + js
    + struct.pack("<I", len(binary))
    + b"BIN\0"
    + bytes(binary)
)
open(out, "wb").write(glb)
print(f"wrote {out} ({len(glb)} bytes)")
