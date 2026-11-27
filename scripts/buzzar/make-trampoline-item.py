# Builds Buzzar's stock Trampoline Item (public/gltf/items/trampoline.glb) from the Sketchfab model:
#   "Trampoline" by 1-3D.com, CC BY-SA 4.0, https://sketchfab.com/3d-models/trampoline-052aaef6c5c34c5bac94607bcc12d2f9
# Changes: Z-up centimetres -> Y-up metres standing on y=0, the full Buzzar logo (bee + "buzzar",
# res/brand/banner-purple.png) on the middle of the mat, and a HAVEN_trampoline node marking the mat as bouncy (docs/gltf/HAVEN_trampoline).
# Needs Pillow. Usage: python3 scripts/buzzar/make-trampoline-item.py <trampoline.glb> [out.glb]
import io
import json
import struct
import sys

from PIL import Image  # Pillow

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "public/gltf/items/trampoline.glb"
LOGO = "res/brand/banner-purple.png"

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
# The bouncy area reaches out over most of the purple pad (radius 1.21-1.5 m), leaving an 8 cm rim to stand on, so
# things tossed at the trampoline don't have to hit the black mat itself to bounce.
BOUNCY_RADIUS = 1.42
ITEM = {
    "collider": {"type": "cylinder", "radius": 1.5, "height": 0.53, "offset": [0, 0.265, 0]},
    "density": 40,
    "rotation": "yaw",
    "upright": True,
    "spawn": {"distance": 2.4, "upright": True},
}

# --- the logo: a flat rectangle on the mat, textured with the full Buzzar banner (bee + "buzzar") ---
# Seen from above with -Z ahead (the way the spawner faces it), it reads left to right: image right is +X, image down
# is +Z (toward you). Its rounded corners are transparent (alpha mask).
LOGO_WIDTH = 1.8
LOGO_DEPTH = LOGO_WIDTH * 420 / 1280  # the banner's aspect ratio
hw, hd = LOGO_WIDTH / 2, LOGO_DEPTH / 2
pos = [(-hw, 0.0, -hd), (hw, 0.0, -hd), (hw, 0.0, hd), (-hw, 0.0, hd)]
nor = [(0.0, 1.0, 0.0)] * 4
uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
idx = [0, 3, 2, 0, 2, 1]  # counter-clockwise seen from above (+Y)
pv = add_view(b"".join(struct.pack("<3f", *p) for p in pos), 34962)
nv = add_view(b"".join(struct.pack("<3f", *n) for n in nor), 34962)
uvv = add_view(b"".join(struct.pack("<2f", *t) for t in uv), 34962)
iv = add_view(b"".join(struct.pack("<H", i) for i in idx), 34963)
pa = add_accessor(pv, 5126, len(pos), "VEC3", min=[-hw, 0, -hd], max=[hw, 0, hd])
na = add_accessor(nv, 5126, len(nor), "VEC3")
ua = add_accessor(uvv, 5126, len(uv), "VEC2")
ia = add_accessor(iv, 5123, len(idx), "SCALAR")
# The banner is a 16-bit PNG; an 8-bit 1024 px copy is plenty and far smaller.
logo_png = io.BytesIO()
Image.open(LOGO).convert("RGBA").resize((1024, 336), Image.LANCZOS).save(logo_png, "PNG", optimize=True)
img_view = add_view(logo_png.getvalue())
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
        "alphaMode": "MASK",
        "alphaCutoff": 0.5,
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

# --- the pad round the edge: Buzzar purple (#7000FF; glTF colours are linear, so sRGB 0x70 -> 0.162) ---
for m in gltf["materials"]:
    if m.get("name") == "blue-plastic":
        m["name"] = "buzzar-purple-plastic"
        m["pbrMetallicRoughness"]["baseColorFactor"] = [0.162, 0.0, 1.0, 1.0]

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
        "extensions": {"HAVEN_trampoline": {"size": [2 * BOUNCY_RADIUS, 2 * BOUNCY_RADIUS], "shape": "round"}},
    }
)
bed = len(nodes) - 1
nodes.append({"name": "Trampoline", "children": [model, logo, bed]})
gltf["scene"] = scene
gltf["scenes"][scene]["nodes"] = [len(nodes) - 1]
gltf["extensionsUsed"] = sorted(set(gltf.get("extensionsUsed", []) + ["HAVEN_trampoline", "HAVEN_metadata", "HAVEN_item"]))
# How it behaves as an object (docs/gltf/HAVEN_item): a heavy drum, about 150 kg, that only turns about the vertical,
# settles level, and appears clear of you, level and facing the way you look.
gltf["extensions"] = gltf.get("extensions", {})
gltf["extensions"]["HAVEN_item"] = ITEM
# What it is and where it's from (docs/gltf/HAVEN_metadata). Bump the version with each change to this file.
gltf.setdefault("extensions", {})["HAVEN_metadata"] = {
    "name": "Trampoline",
    "description": (
        "A 3 m trampoline with the Buzzar logo on the mat.\n"
        "Land on it to bounce (at least 2.5 m, higher the further you fall). Hold jump as you land to go higher; "
        "crouch to stop. Crates, balls and other Items bounce on it too.\n"
        "Adapted from \"Trampoline\" by 1-3D.com (CC BY-SA 4.0); this adaptation is CC BY-SA 4.0 as well."
    ),
    "author": "1-3D.com",
    "sourceUrl": "https://sketchfab.com/3d-models/trampoline-052aaef6c5c34c5bac94607bcc12d2f9",
    "version": "0.1.4",
}
gltf["asset"]["generator"] = "Buzzar make-trampoline-item.py (from Sketchfab-12.78.0)"
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
