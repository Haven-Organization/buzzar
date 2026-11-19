#!/usr/bin/env python3
"""
Buzzar: gives the Home World mirror a High / Low / Off button panel on its right-hand side, and stops the mirror
surface itself being pressable, so you don't arrive with the mirror's "Interact" prompt in your face.

Edits a finished home.glb in place (run after finish-world.mjs): adds a panel, three labelled buttons, and points the
mirror's HAVEN_mirror `buttons` at them. Only appends to the binary chunk.

The buttons get no OMI_collider: Buzzar boxes a mirror control's mesh itself, and a file that uses OMI_collider anywhere
loses the collision Buzzar otherwise generates for all its meshes (the ground included).

Usage: python3 add-mirror-buttons.py <home.glb> [--font /path/to/Bold.ttf]
"""
import io
import json
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = 0x46546C67, 0x4E4F534A, 0x004E4942

path = sys.argv[1]
font_path = sys.argv[sys.argv.index("--font") + 1] if "--font" in sys.argv else "/usr/share/fonts/noto/NotoSans-Bold.ttf"

data = open(path, "rb").read()
json_len = struct.unpack("<I", data[12:16])[0]
gltf = json.loads(data[20 : 20 + json_len])
bin_len = struct.unpack("<I", data[20 + json_len : 24 + json_len])[0]
binary = bytearray(data[28 + json_len : 28 + json_len + bin_len])

nodes = gltf["nodes"]
if any(n.get("name", "").startswith("Mirror: ") for n in nodes):
    sys.exit("already has mirror buttons")
mirror_index = next(i for i, n in enumerate(nodes) if "HAVEN_mirror" in n.get("extensions", {}))
parent = next(n for n in nodes if mirror_index in n.get("children", []))


def add_view(raw: bytes, target=None) -> int:
    while len(binary) % 4:
        binary.append(0)
    view = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)}
    if target:
        view["target"] = target
    binary.extend(raw)
    gltf["bufferViews"].append(view)
    return len(gltf["bufferViews"]) - 1


def add_accessor(values, kind, component=5126, target=34962) -> int:
    fmt = {5126: "f", 5123: "H"}[component]
    raw = struct.pack(f"<{len(values)}{fmt}", *values)
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[kind]
    acc = {"bufferView": add_view(raw, target), "componentType": component, "count": len(values) // width, "type": kind}
    if kind == "VEC3":
        acc["min"] = [min(values[i::3]) for i in range(3)]
        acc["max"] = [max(values[i::3]) for i in range(3)]
    gltf["accessors"].append(acc)
    return len(gltf["accessors"]) - 1


def box_primitive(size, material):
    sx, sy, sz = (v / 2 for v in size)
    faces = [
        ((1, 0, 0), [(sx, -sy, -sz), (sx, sy, -sz), (sx, sy, sz), (sx, -sy, sz)]),
        ((-1, 0, 0), [(-sx, -sy, sz), (-sx, sy, sz), (-sx, sy, -sz), (-sx, -sy, -sz)]),
        ((0, 1, 0), [(-sx, sy, -sz), (-sx, sy, sz), (sx, sy, sz), (sx, sy, -sz)]),
        ((0, -1, 0), [(-sx, -sy, sz), (-sx, -sy, -sz), (sx, -sy, -sz), (sx, -sy, sz)]),
        ((0, 0, 1), [(sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz), (-sx, -sy, sz)]),
        ((0, 0, -1), [(-sx, -sy, -sz), (-sx, sy, -sz), (sx, sy, -sz), (sx, -sy, -sz)]),
    ]
    pos, nrm, idx = [], [], []
    for f, (n, vs) in enumerate(faces):
        for v in vs:
            pos += v
            nrm += n
        idx += [f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3]
    return {
        "attributes": {"POSITION": add_accessor(pos, "VEC3"), "NORMAL": add_accessor(nrm, "VEC3")},
        "indices": add_accessor(idx, "SCALAR", 5123, 34963),
        "material": material,
    }


def face_primitive(width, height, z, material):
    """A label quad facing +Z, just in front of a box's front face."""
    w, h = width / 2, height / 2
    pos = [-w, -h, z, w, -h, z, w, h, z, -w, h, z]
    return {
        "attributes": {
            "POSITION": add_accessor(pos, "VEC3"),
            "NORMAL": add_accessor([0, 0, 1] * 4, "VEC3"),
            "TEXCOORD_0": add_accessor([0, 1, 1, 1, 1, 0, 0, 0], "VEC2"),
        },
        "indices": add_accessor([0, 1, 2, 0, 2, 3], "SCALAR", 5123, 34963),
        "material": material,
    }


def add_material(name, color, roughness=0.6, metallic=0.0, texture=None, unlit=False) -> int:
    pbr = {"baseColorFactor": color, "roughnessFactor": roughness, "metallicFactor": metallic}
    if texture is not None:
        pbr["baseColorTexture"] = {"index": texture}
    material = {"name": name, "pbrMetallicRoughness": pbr}
    if unlit:
        material["extensions"] = {"KHR_materials_unlit": {}}
    gltf["materials"].append(material)
    return len(gltf["materials"]) - 1


def label_texture(text, background) -> int:
    img = Image.new("RGB", (256, 176), background)
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((6, 6, 249, 169), radius=18, outline=(255, 255, 255), width=5)
    font = ImageFont.truetype(font_path, 64)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(((256 - (right - left)) / 2 - left, (176 - (bottom - top)) / 2 - top), text, font=font, fill=(255, 255, 255))
    png = io.BytesIO()
    img.save(png, "PNG", optimize=True)
    gltf.setdefault("images", []).append({"name": f"Mirror {text}", "mimeType": "image/png", "bufferView": add_view(png.getvalue())})
    gltf.setdefault("samplers", []).append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
    gltf.setdefault("textures", []).append({"source": len(gltf["images"]) - 1, "sampler": len(gltf["samplers"]) - 1})
    return len(gltf["textures"]) - 1


# Layout: the mirror frame is 3.3 m wide around x=0 and 0.12 m deep, centred at z=-6.06. The panel is a wing on its
# right-hand side (as you face the mirror from the spawn), at chest height: flush against the frame's edge and just as
# deep, so it reads as part of the frame rather than floating beside it.
FRAME_EDGE_X, FRAME_DEPTH = 1.65, 0.12
PANEL_WIDTH = 0.42
PANEL = {"size": [PANEL_WIDTH, 0.98, FRAME_DEPTH], "at": [FRAME_EDGE_X + PANEL_WIDTH / 2, 1.4, -6.06]}
BUTTON = [0.32, 0.24, 0.05]
BUTTON_Z = PANEL["at"][2] + PANEL["size"][2] / 2 + BUTTON[2] / 2
STATES = [("high", "HIGH", 1.72, (112, 0, 255)), ("low", "LOW", 1.4, (84, 52, 150)), ("off", "OFF", 1.08, (52, 52, 60))]

frame_material = next(i for i, m in enumerate(gltf["materials"]) if m.get("name") == "Mirror frame")
gltf["meshes"].append({"name": "Mirror button panel", "primitives": [box_primitive(PANEL["size"], frame_material)]})
panel_node = {"name": "Mirror button panel", "translation": PANEL["at"], "mesh": len(gltf["meshes"]) - 1}
nodes.append(panel_node)
parent["children"].append(len(nodes) - 1)

buttons = {}
for state, text, y, rgb in STATES:
    linear = [round((c / 255) ** 2.2, 4) for c in rgb] + [1]
    body = add_material(f"Mirror {text} button", linear, 0.5)
    label = add_material(f"Mirror {text} label", [1, 1, 1, 1], texture=label_texture(text, rgb), unlit=True)
    gltf["meshes"].append(
        {
            "name": f"Mirror {text} button",
            "primitives": [box_primitive(BUTTON, body), face_primitive(BUTTON[0] - 0.01, BUTTON[1] - 0.01, BUTTON[2] / 2 + 0.002, label)],
        }
    )
    nodes.append(
        {
            # The name is what the interaction tooltip shows.
            "name": f"Mirror: {text.title()}",
            "translation": [PANEL["at"][0], y, BUTTON_Z],
            "mesh": len(gltf["meshes"]) - 1,
        }
    )
    parent["children"].append(len(nodes) - 1)
    buttons[state] = [len(nodes) - 1]

mirror = nodes[mirror_index]["extensions"]["HAVEN_mirror"]
mirror["clickToToggle"] = False
mirror["buttons"] = buttons
if "KHR_materials_unlit" not in gltf["extensionsUsed"]:
    gltf["extensionsUsed"].append("KHR_materials_unlit")

while len(binary) % 4:
    binary.append(0)
gltf["buffers"][0]["byteLength"] = len(binary)
json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
total = 12 + 8 + len(json_bytes) + 8 + len(binary)
with open(path, "wb") as out:
    out.write(struct.pack("<III", GLB_MAGIC, 2, total))
    out.write(struct.pack("<II", len(json_bytes), JSON_CHUNK) + json_bytes)
    out.write(struct.pack("<II", len(binary), BIN_CHUNK) + bytes(binary))
print("added", ", ".join(f"{s}: node {i[0]}" for s, i in buttons.items()))
