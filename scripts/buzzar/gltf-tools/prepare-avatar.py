# Makes a game-ripped avatar (e.g. from Sketchfab) usable in Buzzar, editing the glTF directly (no Blender round trip)
# and without changing how it looks:
# - body and finger bones are renamed to CATS names (Hips, Spine, Left arm, IndexFinger1_L, …), which Buzzar
#   recognises, using a preset for the game's rig naming (--rig);
# - joints that weight no vertices and have none below them (IK handles, locators, helpers) are dropped from each
#   skin, keeping under the bone limit;
# - game face bones are renamed so Buzzar's lip sync finds them (Umamusume: lip corners, upper and lower lips);
# - --atlas-mouth: for a face drawn from a texture sheet of mouth shapes (Pokémon), adds lip-sync blend shapes
#   (mouth_a/i/u/e/o) that bring copies of the mouth patch, showing other cells of the sheet, in front of it;
# - UV sets no material reads are dropped, and embedded animations removed (Buzzar brings its own);
# - the binary is repacked from the data still in use (each accessor copied byte for byte, nothing re-encoded).
# Usage: python3 -I prepare-avatar.py --rig umamusume|pokemon [--atlas-mouth SPEC] in.glb out.glb
#   SPEC: mesh=<mesh index>,grid=<columns>x<rows>,a=<col>:<row>,i=…,u=…,e=…,o=… (cells for each vowel; the mesh's
#   own UVs show the closed mouth). Pikachu: mesh=2,grid=2x4,a=0:2,i=0:1,e=0:1,u=1:0,o=1:0
import argparse
import json
import re
import struct

parser = argparse.ArgumentParser()
parser.add_argument("--rig", required=True, choices=["umamusume", "pokemon"])
parser.add_argument("--atlas-mouth")
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
        # Face (lip sync): Mouth_middle_L/R are the corners (Mouth_L/R are pivots at the mouth's centre); each lip
        # has bones at the centre (01) and toward the corners (02, 03).
        CATS[f"Mouth_middle_{S}"] = f"Lip_Corner_{S}"
        for k in ("02", "03"):
            CATS[f"Mouth_up_{k}_{S}"] = f"UpperLip_{k}_{S}"
            CATS[f"Mouth_bottom_{k}_{S}"] = f"LowerLip_{k}_{S}"
    for C in ("C", "L", "R"):
        CATS[f"Mouth_up_01_{C}"] = f"UpperLip_01_{C}"
        CATS[f"Mouth_bottom_01_{C}"] = f"LowerLip_01_{C}"
    # (The lower teeth stay put: Buzzar's general teeth movement pushes these through the chin.)
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
    if acc_i in new_accessor_rows:
        return new_accessor_rows[acc_i]
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


def new_accessor(rows, type_, component, target=None, bounds=False):
    a = {"bufferView": None, "componentType": component, "count": len(rows), "type": type_, "_target": target}
    if bounds:
        a["min"] = [min(r[k] for r in rows) for k in range(len(rows[0]))]
        a["max"] = [max(r[k] for r in rows) for k in range(len(rows[0]))]
    gltf["accessors"].append(a)
    new_accessor_rows[len(gltf["accessors"]) - 1] = rows
    return len(gltf["accessors"]) - 1


# --- Texture-sheet mouth -> lip-sync blend shapes ------------------------------------------------------------------
if args.atlas_mouth:
    spec = dict(part.split("=", 1) for part in args.atlas_mouth.split(","))
    mesh = gltf["meshes"][int(spec["mesh"])]
    assert len(mesh["primitives"]) == 1, "the mouth mesh should have one primitive"
    prim = mesh["primitives"][0]
    cols, rows = (int(x) for x in spec["grid"].split("x"))
    du, dv = 1 / cols, 1 / rows
    vowels = ["a", "i", "u", "e", "o"]
    cell_of = {v: tuple(int(x) for x in spec[v].split(":")) for v in vowels if v in spec}
    cells = sorted(set(cell_of.values()))
    attrs = prim["attributes"]
    pos = read(attrs["POSITION"])
    nor = read(attrs["NORMAL"]) if "NORMAL" in attrs else None
    uv = read(attrs["TEXCOORD_0"])
    joints = read(attrs["JOINTS_0"]) if "JOINTS_0" in attrs else None
    weights = read(attrs["WEIGHTS_0"]) if "WEIGHTS_0" in attrs else None
    idx = [r[0] for r in read(prim["indices"])]
    n = len(pos)
    assert nor, "the mouth mesh needs normals"
    size = max(max(p[k] for p in pos) - min(p[k] for p in pos) for k in range(3))
    # The closed mouth never moves (it fills a hole in the face). Each other shape is a copy of it, the same outline
    # showing another cell of the sheet, waiting just behind it; its vowel brings it forward until it passes in front,
    # at half weight, so shapes swap cleanly like the game's texture swap instead of morphing.
    gap = 0.004 * size
    def along(p, q, t):
        return [p[0] + q[0] * t, p[1] + q[1] * t, p[2] + q[2] * t]
    new_pos = [list(p) for p in pos]
    new_uv = [list(t) for t in uv]
    for c, (col, row) in enumerate(cells):
        new_pos += [along(p, nor[i], -gap) for i, p in enumerate(pos)]
        new_uv += [[t[0] + col * du, t[1] + row * dv] for t in uv]
    copies = len(cells) + 1
    new_idx = [[i + n * c] for c in range(copies) for i in idx]
    targets = []
    names = []
    for v in vowels:
        if v not in cell_of:
            continue
        c = cells.index(cell_of[v])
        # Forward through the closed mouth to just in front of it (each copy a little further, so two half-raised
        # shapes never fight over the same depth).
        travel = gap * (2 + 0.2 * c)
        delta = [[0.0, 0.0, 0.0]] * n
        for k in range(len(cells)):
            delta += [along([0.0, 0.0, 0.0], nor[i], travel) if k == c else [0.0, 0.0, 0.0] for i in range(n)]
        targets.append({"POSITION": new_accessor(delta, "VEC3", 5126, bounds=True)})
        names.append(f"mouth_{v}")
    comp = lambda a: gltf["accessors"][a]["componentType"]
    attrs["POSITION"] = new_accessor(new_pos, "VEC3", 5126, 34962, bounds=True)
    attrs["TEXCOORD_0"] = new_accessor(new_uv, "VEC2", 5126, 34962)
    if nor:
        attrs["NORMAL"] = new_accessor(nor * copies, "VEC3", 5126, 34962)
    if joints:
        attrs["JOINTS_0"] = new_accessor(joints * copies, "VEC4", comp(attrs["JOINTS_0"]), 34962)
        attrs["WEIGHTS_0"] = new_accessor(weights * copies, "VEC4", comp(attrs["WEIGHTS_0"]), 34962)
    prim["indices"] = new_accessor(new_idx, "SCALAR", 5125 if n * copies > 65535 else comp(prim["indices"]), 34963)
    prim["targets"] = targets
    mesh["weights"] = [0.0] * len(targets)
    mesh.setdefault("extras", {})["targetNames"] = names
    print(f"atlas mouth: {len(cells)} extra mouth shapes, blend shapes {names}")

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
    # And every joint above a kept one (e.g. a mouth corner that moves only its child lip bones): a joint keeps its
    # bind pose only while it's in the skin, and its children are placed under it.
    parent_of = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    slot = {j: k for k, j in enumerate(s["joints"])}
    keep = set(used | named)
    for k in list(keep):
        node = parent_of.get(s["joints"][k])
        while node is not None:
            if node in slot:
                keep.add(slot[node])
            node = parent_of.get(node)
    keep = sorted(keep)
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
    if "_target" in a:  # made by this script
        target = a.pop("_target")
        fmt, size = FMT[a["componentType"]]
        chunk = b"".join(struct.pack("<" + fmt * len(r), *r) for r in new_accessor_rows[old])
        a["bufferView"] = add_view(chunk, target)
    elif "bufferView" in a:
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
