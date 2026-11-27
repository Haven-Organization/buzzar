#!/usr/bin/env python3
"""
Buzzar: turns the "Water gun" model by Mr.Nein (Sketchfab, CC-BY-4.0) into a Buzzar Thing that sprays water.

    python3 scripts/buzzar/make-water-gun-thing.py water_gun.glb pump.wav spray-loop.wav out.glb \
        [--spray-start start.wav] [--sound-credits "..."] [--version 0.3.0]

With --spray-start, that clip plays once when spraying begins and the loop takes over where it ends.

- Scales it to a real water gun's length (0.55 m) and puts its origin at the pistol grip.
- Embeds the sounds (KHR_audio, as WAV): a pump stroke and a seamless spray loop, cut from Freesound 720433
  ("water gun sucking air" by ccovi, CC0) and 537941 ("Water Gun Shot" by belanhud, CC0).
- HAVEN_sprayer: the nozzle, the stream, a tank of 6 seconds' spraying, a pump that refills it.
- Splits the pump handle (and the ring at its front) out of the single mesh into its own node, "Pump", so it slides
  back and forth with the hand on it when you pump.
- HAVEN_thing: a box collider, it spawns straight into your hold, and how your avatar holds it (hold).
- HAVEN_metadata: name, description with the credits, author and source.

The geometry and textures are copied unchanged. Positions below were measured from the model (scene space, its
own units): the nozzle tip is at z = -7.65 (y 1.78-2.20), the pistol grip around z 0.55, y -0.1.
"""
import argparse
import json
import struct
import wave

LENGTH_M = 0.55
MODEL_LENGTH = 11.506  # scene units, nozzle tip to stock
GRIP = (0.0, -0.1, 0.55)  # scene units: where the hand holds it
NOZZLE = (0.0, 1.99, -7.70)  # scene units: just past the tip
SOURCE_URL = "https://sketchfab.com/3d-models/water-gun-35b90924eb764da78ff1f9d7514f302f"


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, "not a glTF 2 .glb"
    json_len, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(data[20 : 20 + json_len])
    offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", data, offset)
    assert bin_type == 0x004E4942
    return gltf, bytearray(data[offset + 8 : offset + 8 + bin_len])


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    binary = bytes(binary) + b"\0" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


# The pump handle: the pieces of the mesh that lie wholly inside this box (scene units), round the barrel's
# underside from z -5.2 to -2.55 (the tube behind it, z -2.64 to -1.55, stays put).
PUMP_BOX = ((-1.0, 0.95, -5.2), (1.0, 2.4, -2.55))
PUMP_TRAVEL_M = 0.04  # its handle can slide about 5 cm before it meets the body


def read_accessor(gltf, binary, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = {5126: ("f", 4), 5125: ("I", 4), 5123: ("H", 2), 5121: ("B", 1)}[acc["componentType"]]
    count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    stride = view.get("byteStride") or size * count
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [struct.unpack_from("<" + fmt * count, binary, base + i * stride) for i in range(acc["count"])]


def node_matrix(node):
    """The node's local transform as a function on points."""
    if "matrix" in node:
        m = node["matrix"]
        return lambda p: tuple(m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i] for i in range(3))
    t = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sc = node.get("scale", [1, 1, 1])
    r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return lambda p: tuple(sum(r[i][j] * p[j] * sc[j] for j in range(3)) + t[i] for i in range(3))


def split_pump(gltf, binary):
    """Moves the pump handle's triangles into a mesh of their own on a new node, "Pump", next to the gun's."""
    # The one mesh node, and the chain of nodes above it (scene units are what those make of it).
    parents = {c: i for i, n in enumerate(gltf["nodes"]) for c in n.get("children", [])}
    mesh_node = next(i for i, n in enumerate(gltf["nodes"]) if "mesh" in n)
    chain = [mesh_node]
    while chain[-1] in parents:
        chain.append(parents[chain[-1]])
    transforms = [node_matrix(gltf["nodes"][i]) for i in chain]

    def to_scene(p):
        for f in transforms:
            p = f(p)
        return p

    mesh = gltf["meshes"][gltf["nodes"][mesh_node]["mesh"]]
    assert len(mesh["primitives"]) == 1, "expected the model's single primitive"
    prim = mesh["primitives"][0]
    points = [to_scene(p) for p in read_accessor(gltf, binary, prim["attributes"]["POSITION"])]
    tris = [t for t in zip(*[iter(i[0] for i in read_accessor(gltf, binary, prim["indices"]))] * 3)]

    # Pieces: triangles joined by shared vertices (or vertices in the same place).
    parent = list(range(len(points)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    seen = {}
    for i, p in enumerate(points):
        key = tuple(round(c, 5) for c in p)
        if key in seen:
            parent[find(i)] = find(seen[key])
        else:
            seen[key] = i
    for a, b, c in tris:
        parent[find(b)] = find(a)
        parent[find(c)] = find(a)
    pieces = {}
    for t in tris:
        pieces.setdefault(find(t[0]), []).append(t)
    lo, hi = PUMP_BOX
    inside = lambda p: all(lo[k] <= p[k] <= hi[k] for k in range(3))
    pump, rest = [], []
    for piece in pieces.values():
        (pump if all(inside(points[v]) for t in piece for v in t) else rest).extend(piece)
    assert len(pump) > 1000, f"didn't find the pump handle ({len(pump)} triangles)"

    def index_accessor(triangles):
        flat = [v for t in triangles for v in t]
        view = add_buffer_view(gltf, binary, struct.pack("<%dI" % len(flat), *flat))
        gltf["accessors"].append({"bufferView": view, "componentType": 5125, "count": len(flat), "type": "SCALAR"})
        return len(gltf["accessors"]) - 1

    prim["indices"] = index_accessor(rest)
    pump_prim = dict(prim, indices=index_accessor(pump))
    gltf["meshes"].append({"name": "Pump", "primitives": [pump_prim]})
    # Same place as the gun's mesh node, under the same parent, so it sits where it was until it moves.
    original = gltf["nodes"][mesh_node]
    pump_node = {k: v for k, v in original.items() if k in ("translation", "rotation", "scale", "matrix")}
    pump_node.update(name="Pump", mesh=len(gltf["meshes"]) - 1)
    gltf["nodes"].append(pump_node)
    gltf["nodes"][parents[mesh_node]]["children"].append(len(gltf["nodes"]) - 1)
    return len(pump), len(rest)


def wav_seconds(path):
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def add_buffer_view(gltf, binary, payload):
    while len(binary) % 4:
        binary.append(0)
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload)})
    binary.extend(payload)
    gltf["buffers"][0]["byteLength"] = len(binary)
    return len(gltf["bufferViews"]) - 1


CC0_SOUNDS = 'Sounds: "water gun sucking air" by ccovi and "Water Gun Shot" by belanhud, Freesound, CC0.'


def main(src, pump_wav, spray_wav, out, spray_start=None, sound_credits=CC0_SOUNDS, version="0.2.0", start_length=None):
    gltf, binary = read_glb(src)
    pump_tris, rest_tris = split_pump(gltf, binary)
    s = LENGTH_M / MODEL_LENGTH
    scene = gltf["scenes"][gltf.get("scene", 0)]

    # A new root: scaled to metres, with the grip at the origin.
    gltf["nodes"].append(
        {
            "name": "Water Gun",
            "children": scene["nodes"],
            "scale": [s, s, s],
            "translation": [-GRIP[0] * s, -GRIP[1] * s, -GRIP[2] * s],
        }
    )
    scene["nodes"] = [len(gltf["nodes"]) - 1]

    def thing_space(p):
        return [round((p[i] - GRIP[i]) * s, 4) for i in range(3)]

    # The model's box (scene units, measured): x ±0.665, y -1.157..3.639, z -7.653..3.854.
    lo, hi = thing_space((-0.665, -1.157, -7.653)), thing_space((0.665, 3.639, 3.854))
    collider = {
        "type": "box",
        "size": [round(hi[i] - lo[i], 4) for i in range(3)],
        "offset": [round((hi[i] + lo[i]) / 2, 4) for i in range(3)],
    }

    audio = gltf.setdefault("extensions", {}).setdefault("KHR_audio", {})
    audio["audio"] = [
        {"name": "Spray", "bufferView": add_buffer_view(gltf, binary, open(spray_wav, "rb").read()), "mimeType": "audio/wav"},
        {"name": "Pump", "bufferView": add_buffer_view(gltf, binary, open(pump_wav, "rb").read()), "mimeType": "audio/wav"},
    ]
    audio["sources"] = [
        {"name": "Spray", "audio": 0, "loop": True, "gain": 0.8},
        {"name": "Pump", "audio": 1, "gain": 1.0},
    ]
    sounds = {"spray": 0, "pump": 1}
    if spray_start:
        audio["audio"].append(
            {"name": "Spray Start", "bufferView": add_buffer_view(gltf, binary, open(spray_start, "rb").read()), "mimeType": "audio/wav"}
        )
        audio["sources"].append({"name": "Spray Start", "audio": 2, "gain": 0.8})
        sounds["start"] = 2
        # Where the loop takes over: the clip's end, or earlier when the clip overlaps the loop's start.
        start_length = round(start_length or wav_seconds(spray_start), 3)

    gltf["extensions"]["HAVEN_sprayer"] = {
        "nozzle": {"position": thing_space(NOZZLE), "direction": [0, 0, -1]},
        "speed": 10,
        "spread": 0.8,
        "rate": 110,
        "dropSize": 0.013,
        "color": [0.62, 0.83, 1, 0.55],
        "capacity": 6,
        "refill": 6,
        "pumpTime": round(wav_seconds(pump_wav), 2),
        # The handle slides back towards you and forward again; the hand on it goes with it.
        "pumpStroke": {"offset": [0, 0, PUMP_TRAVEL_M], "node": "Pump"},
        "sounds": sounds,
    }
    if start_length:
        gltf["extensions"]["HAVEN_sprayer"]["startLength"] = start_length
    gltf["extensions"]["HAVEN_thing"] = {
        "collider": collider,
        "density": 300,
        "rotation": "free",
        "upright": False,
        "spawn": {"distance": 1, "upright": False, "held": True},
        # Held like a Super Soaker: right hand round the pistol grip (it leans 25.5° forward at the top, so the
        # handshake frame is turned about X; the palm sits just right of the grip). Left hand on the pump like a
        # shotgun's forend: palm under it (tilted 25° to face up and right), fingers across underneath and curled
        # less (it's slim) so they come up its far side, thumb along the near side pointing forward. It aims along
        # the nozzle (HAVEN_sprayer).
        "hold": {
            "pose": "aim",
            "hand": "right",
            "grip": {"position": [0.022, 0, 0], "rotation": [-0.2207, 0, 0, 0.9753]},
            "offhand": {
                "position": [-0.03, 0.045, thing_space((0, 0.85, -3.75))[2]],
                "rotation": [-0.5964, -0.3799, 0.3799, 0.5964],
                "curl": 40,
            },
            "curl": 75,
        },
    }
    gltf["extensions"]["HAVEN_metadata"] = {
        "name": "Water Gun",
        "description": (
            "A pump-action water gun. It runs dry after a few seconds of spraying; pump it full again.\n\n"
            'Model: "Water gun" by Mr.Nein, CC-BY-4.0 (' + SOURCE_URL + ").\n"
            + sound_credits
        ),
        # What each input does with it (shown when you pick it up; each client shows its own keys).
        "controls": [
            {"action": "use", "label": "Spray (hold)"},
            {"action": "secondary", "label": "Pump to refill"},
            {"action": "drop", "label": "Put down"},
        ],
        "author": "Mr.Nein",
        "sourceUrl": SOURCE_URL,
        "version": version,
    }
    used = set(gltf.get("extensionsUsed", []))
    used.update(["KHR_audio", "HAVEN_sprayer", "HAVEN_thing", "HAVEN_metadata"])
    gltf["extensionsUsed"] = sorted(used)

    write_glb(out, gltf, binary)
    print(f"pump: {pump_tris} triangles split off, {rest_tris} left")
    print(f"wrote {out}: scale {s:.5f}, nozzle {thing_space(NOZZLE)}, collider {collider}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model")
    parser.add_argument("pump")
    parser.add_argument("spray_loop")
    parser.add_argument("out")
    parser.add_argument("--spray-start")
    parser.add_argument("--sound-credits", default=CC0_SOUNDS)
    parser.add_argument("--version", default="0.2.0")
    parser.add_argument("--start-length", type=float, help="seconds into the start clip where the loop takes over")
    a = parser.parse_args()
    main(a.model, a.pump, a.spray_loop, a.out, a.spray_start, a.sound_credits, a.version, a.start_length)
