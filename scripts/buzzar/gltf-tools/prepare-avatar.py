# Makes a game-ripped avatar (e.g. from Sketchfab) usable in Buzzar, editing the glTF directly (no Blender round trip)
# and without changing how it looks:
# - body and finger bones are renamed to CATS names (Hips, Spine, Left arm, IndexFinger1_L, …), which Buzzar
#   recognises, using a preset for the game's rig naming (--rig);
# - joints that weight no vertices (IK handles, locators, helpers) are dropped from each skin, keeping under the bone
#   limit;
# - UV sets no material reads are dropped, and embedded animations removed (Buzzar brings its own);
# - the binary is repacked from the data still in use (each accessor copied byte for byte, nothing re-encoded).
# Usage: python3 -I prepare-avatar.py --rig umamusume|pokemon in.glb out.glb
import argparse
import json
import re
import struct

parser = argparse.ArgumentParser()
parser.add_argument("--rig", required=True, choices=["umamusume", "pokemon"])
parser.add_argument("src")
parser.add_argument("dst")
args = parser.parse_args()

data = open(args.src, "rb").read()
json_len = struct.unpack("<I", data[12:16])[0]
gltf = json.loads(data[20 : 20 + json_len])
bin_start = 20 + json_len
bin_len = struct.unpack("<I", data[bin_start : bin_start + 4])[0]
binary = bytes(data[bin_start + 8 : bin_start + 8 + bin_len])
nodes = gltf["nodes"]
base = lambda n: re.sub(r"_\d+$", "", n or "")

# --- Bone names --------------------------------------------------------------------------------------------------
CATS = {}
SIDES = (("L", "Left"), ("R", "Right"))
if args.rig == "umamusume":
    # Hip → UpBody_Ctrl → Waist → Spine → Chest → Neck → Head; Shoulder_L → Arm_L → Elbow_L → Wrist_L → fingers.
    CATS.update({"Hip": "Hips", "Waist": "Spine", "Spine": "Chest", "Chest": "Upper Chest", "Neck": "Neck", "Head": "Head"})
    for S, side in SIDES:
        CATS.update({f"Shoulder_{S}": f"{side} shoulder", f"Arm_{S}": f"{side} arm", f"Elbow_{S}": f"{side} elbow",
                     f"Wrist_{S}": f"{side} wrist", f"Thigh_{S}": f"{side} leg", f"Knee_{S}": f"{side} knee",
                     f"Ankle_{S}": f"{side} ankle", f"Toe_{S}": f"{side} toe"})
        for k in (1, 2, 3):
            CATS[f"Thumb_0{k}_{S}"] = f"Thumb{k - 1}_{S}"
            for game, cats in (("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Pinky", "Little")):
                CATS[f"{game}_0{k}_{S}"] = f"{cats}Finger{k}_{S}"
elif args.rig == "pokemon":
    # Waist is the parent of both the pelvis ("Hips") and the spine, so it is the humanoid hips.
    CATS.update({"Waist": "Hips", "Hips": "Pelvis", "Spine1": "Spine", "Spine2": "Chest", "Head": "Head"})
    for S, side in SIDES:
        CATS.update({f"{S}Shoulder": f"{side} shoulder", f"{S}Arm": f"{side} arm", f"{S}ForeArm": f"{side} elbow",
                     f"{S}Hand": f"{side} wrist", f"{S}Thigh": f"{side} leg", f"{S}Leg": f"{side} knee",
                     f"{S}Foot": f"{side} ankle", f"{S}Toe": f"{side} toe"})

renamed = 0
for n in nodes:
    b = base(n.get("name"))
    if b in CATS:
        n["name"] = CATS[b]
        renamed += 1
print(f"renamed {renamed} of {len(CATS)} bones")
missing = sorted(set(CATS) - {re.sub(r"_\d+$", "", k) for k in CATS if any(nn.get("name") == CATS[k] for nn in nodes)})
if missing:
    print("not found:", missing)

# --- Accessor helpers --------------------------------------------------------------------------------------------
FMT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def layout(acc_i):
    a = gltf["accessors"][acc_i]
    bv = gltf["bufferViews"][a["bufferView"]]
    fmt, size = FMT[a["componentType"]]
    n = NCOMP[a["type"]]
    stride = bv.get("byteStride", size * n)
    return a, bv.get("byteOffset", 0) + a.get("byteOffset", 0), stride, fmt, size, n


def read(acc_i):
    a, off, stride, fmt, size, n = layout(acc_i)
    return [list(struct.unpack_from("<" + fmt * n, binary, off + k * stride)) for k in range(a["count"])]


def raw(acc_i):
    """The accessor's elements, tightly packed, exactly as stored."""
    a, off, stride, fmt, size, n = layout(acc_i)
    elem = size * n
    if stride == elem:
        return binary[off : off + elem * a["count"]]
    return b"".join(binary[off + k * stride : off + k * stride + elem] for k in range(a["count"]))


new_accessor_rows = {}  # accessor index -> (rows) to write instead of the stored data

# --- Drop joints that weight no vertices -------------------------------------------------------------------------
skins = gltf.get("skins", [])


def mesh_prims(si):
    return [p for n in nodes if n.get("skin") == si and "mesh" in n for p in gltf["meshes"][n["mesh"]]["primitives"]
            if "JOINTS_0" in p["attributes"]]


for si, s in enumerate(skins):
    prims = mesh_prims(si)
    used = set()
    for p in prims:
        for js, ws in zip(read(p["attributes"]["JOINTS_0"]), read(p["attributes"]["WEIGHTS_0"])):
            used.update(j for j, w in zip(js, ws) if w > 0)
    # Keep the humanoid bones even if unweighted (e.g. a shoulder), so the rig stays recognisable.
    named = {k for k, j in enumerate(s["joints"]) if nodes[j].get("name") in CATS.values()}
    keep = sorted(used | named)
    remap = {old: new for new, old in enumerate(keep)}
    done = set()
    for p in prims:
        acc = p["attributes"]["JOINTS_0"]
        if acc in done:
            continue
        done.add(acc)
        weights = read(p["attributes"]["WEIGHTS_0"])
        new_accessor_rows[acc] = [[remap.get(j, 0) if w > 0 else 0 for j, w in zip(js, ws)] for js, ws in zip(read(acc), weights)]
    ibms = read(s["inverseBindMatrices"])
    print(f"skin {si}: {len(s['joints'])} -> {len(keep)} joints")
    s["joints"] = [s["joints"][k] for k in keep]
    new_accessor_rows[s["inverseBindMatrices"]] = [ibms[k] for k in keep]
    # The accessor's count changes with the rows.
    gltf["accessors"][s["inverseBindMatrices"]]["count"] = len(keep)

# --- Drop UV sets no material reads, and animations -------------------------------------------------------------
def tex_coords(material):
    sets = set()

    def scan(o):
        if isinstance(o, dict):
            if "index" in o and isinstance(o.get("index"), int):
                sets.add(o.get("texCoord", 0))
            for v in o.values():
                scan(v)
        elif isinstance(o, list):
            for v in o:
                scan(v)

    scan(material)
    return sets


dropped_uv = 0
for m in gltf["meshes"]:
    for p in m["primitives"]:
        sets = tex_coords(gltf["materials"][p["material"]]) if "material" in p else set()
        for k in list(p["attributes"]):
            mt = re.fullmatch(r"TEXCOORD_(\d+)", k)
            if mt and int(mt.group(1)) not in sets and int(mt.group(1)) > max(sets | {0}):
                del p["attributes"][k]
                dropped_uv += 1
print("dropped", dropped_uv, "unused UV sets")
gltf.pop("animations", None)

# --- Repack: only accessors and images still referenced, each in its own packed buffer view -----------------------
used_acc = []
for m in gltf["meshes"]:
    for p in m["primitives"]:
        used_acc += list(p["attributes"].values())
        if "indices" in p:
            used_acc.append(p["indices"])
        for t in p.get("targets", []):
            used_acc += list(t.values())
for s in skins:
    if "inverseBindMatrices" in s:
        used_acc.append(s["inverseBindMatrices"])
used_acc = sorted(set(used_acc))
acc_map = {old: new for new, old in enumerate(used_acc)}

out_bin = bytearray()
views = []


def add_view(chunk, target=None):
    while len(out_bin) % 4:
        out_bin.append(0)
    view = {"buffer": 0, "byteOffset": len(out_bin), "byteLength": len(chunk)}
    if target:
        view["target"] = target
    out_bin.extend(chunk)
    views.append(view)
    return len(views) - 1


accessors = []
for old in used_acc:
    a = dict(gltf["accessors"][old])
    assert "sparse" not in a, "sparse accessors aren't handled"
    if "bufferView" in a:
        target = gltf["bufferViews"][a["bufferView"]].get("target")
        if old in new_accessor_rows:
            fmt, size = FMT[a["componentType"]]
            chunk = b"".join(struct.pack("<" + fmt * len(r), *r) for r in new_accessor_rows[old])
        else:
            chunk = raw(old)
        a["bufferView"] = add_view(chunk, target)
        a.pop("byteOffset", None)
    accessors.append(a)
for im in gltf.get("images", []):
    if "bufferView" in im:
        bv = gltf["bufferViews"][im["bufferView"]]
        off = bv.get("byteOffset", 0)
        im["bufferView"] = add_view(binary[off : off + bv["byteLength"]])

for m in gltf["meshes"]:
    for p in m["primitives"]:
        p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
        if "indices" in p:
            p["indices"] = acc_map[p["indices"]]
        if "targets" in p:
            p["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in p["targets"]]
for s in skins:
    if "inverseBindMatrices" in s:
        s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
gltf["accessors"] = accessors
gltf["bufferViews"] = views

while len(out_bin) % 4:
    out_bin.append(0)
gltf["buffers"] = [{"byteLength": len(out_bin)}]
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(out_bin))
out += struct.pack("<I", len(js)) + b"JSON" + js + struct.pack("<I", len(out_bin)) + b"BIN\0" + bytes(out_bin)
open(args.dst, "wb").write(out)
print(f"wrote {args.dst}: {len(data) / 1048576:.2f} MB -> {len(out) / 1048576:.2f} MB")
