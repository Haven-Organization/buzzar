#!/usr/bin/env python3
"""
Buzzar: turns the "Water gun" model by Mr.Nein (Sketchfab, CC-BY-4.0) into a Buzzar Thing that sprays water.

    python3 scripts/buzzar/make-water-gun-thing.py water_gun.glb pump.wav spray-loop.wav out.glb

- Scales it to a real water gun's length (0.55 m) and puts its origin at the pistol grip.
- Embeds the sounds (KHR_audio, as WAV): a pump stroke and a seamless spray loop, cut from Freesound 720433
  ("water gun sucking air" by ccovi, CC0) and 537941 ("Water Gun Shot" by belanhud, CC0).
- HAVEN_sprayer: the nozzle, the stream, a tank of 6 seconds' spraying, a pump that refills it.
- HAVEN_thing: a box collider, it spawns straight into your hold, and how your avatar holds it (hold).
- HAVEN_metadata: name, description with the credits, author and source.

The geometry and textures are copied unchanged. Positions below were measured from the model (scene space, its
own units): the nozzle tip is at z = -7.65 (y 1.78-2.20), the pistol grip around z 0.55, y -0.1.
"""
import json
import struct
import sys
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


def main(src, pump_wav, spray_wav, out):
    gltf, binary = read_glb(src)
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

    gltf["extensions"]["HAVEN_sprayer"] = {
        "nozzle": {"position": thing_space(NOZZLE), "direction": [0, 0, -1]},
        "speed": 10,
        "spread": 1.2,
        "rate": 80,
        "dropSize": 0.018,
        "color": [0.62, 0.83, 1, 0.6],
        "capacity": 6,
        "refill": 6,
        "pumpTime": round(wav_seconds(pump_wav), 2),
        "sounds": {"spray": 0, "pump": 1},
    }
    gltf["extensions"]["HAVEN_thing"] = {
        "collider": collider,
        "density": 300,
        "rotation": "free",
        "upright": False,
        "spawn": {"distance": 1, "upright": False, "held": True},
        # Held like a Super Soaker: right hand round the pistol grip (it leans 25.5° forward at the top, so the
        # handshake frame is turned about X; the palm sits just right of the grip), left hand under the pump,
        # palm up (the left handshake frame turned 90° about Z). It aims along the nozzle (HAVEN_sprayer).
        "hold": {
            "pose": "aim",
            "hand": "right",
            "grip": {"position": [0.022, 0, 0], "rotation": [-0.2207, 0, 0, 0.9753]},
            "offhand": {"position": thing_space((0, 0.85, -3.75)), "rotation": [0, 0, 0.7071, 0.7071]},
            "curl": 75,
        },
    }
    gltf["extensions"]["HAVEN_metadata"] = {
        "name": "Water Gun",
        "description": (
            "A pump-action water gun. Hold left click to spray; it runs dry after a few seconds. "
            "Right click to pump it full again. E puts it down.\n\n"
            'Model: "Water gun" by Mr.Nein, CC-BY-4.0 (' + SOURCE_URL + ").\n"
            'Sounds: "water gun sucking air" by ccovi and "Water Gun Shot" by belanhud, Freesound, CC0.'
        ),
        "author": "Mr.Nein",
        "sourceUrl": SOURCE_URL,
        "version": "0.2.0",
    }
    used = set(gltf.get("extensionsUsed", []))
    used.update(["KHR_audio", "HAVEN_sprayer", "HAVEN_thing", "HAVEN_metadata"])
    gltf["extensionsUsed"] = sorted(used)

    write_glb(out, gltf, binary)
    print(f"wrote {out}: scale {s:.5f}, nozzle {thing_space(NOZZLE)}, collider {collider}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
