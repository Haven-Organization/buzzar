# Makes a game-ripped Sketchfab avatar (3ds Max Biped body skeleton plus separate accessory skeletons) usable in
# Buzzar, editing the glTF directly (no Blender round trip):
# - accessory "adjust" bones (copies of body bones) and their cloth roots are re-parented under the matching body
#   bones, with local transforms from the bind matrices, so each accessory sits where it was bound and follows the body;
# - joints that weight no vertices are dropped from each skin (JOINTS_0 remapped), keeping under the bone limit;
# - body bones are renamed to CATS names (Hips, Spine, Left arm, …), which Buzzar recognises;
# - embedded animations are removed (Buzzar brings its own).
# Usage: python3 -I fix-ripped-avatar.py in.glb out.glb
import json
import math
import re
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, "rb").read()
json_len = struct.unpack("<I", data[12:16])[0]
gltf = json.loads(data[20 : 20 + json_len])
bin_start = 20 + json_len
bin_len = struct.unpack("<I", data[bin_start : bin_start + 4])[0]
binary = bytearray(data[bin_start + 8 : bin_start + 8 + bin_len])
nodes = gltf["nodes"]
base = lambda n: re.sub(r"_\d+$", "", n or "")

# --- 4x4 column-major matrix helpers ---
def mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def inverse(m):
    # Gauss-Jordan on a row-major copy.
    a = [[m[c * 4 + r] for c in range(4)] + [1.0 if r == i else 0.0 for i in range(4)] for r in range(4)]
    for col in range(4):
        piv = max(range(col, 4), key=lambda r: abs(a[r][col]))
        a[col], a[piv] = a[piv], a[col]
        p = a[col][col]
        a[col] = [v / p for v in a[col]]
        for r in range(4):
            if r != col:
                f = a[r][col]
                a[r] = [v - f * w for v, w in zip(a[r], a[col])]
    return [a[r][4 + c] for c in range(4) for r in range(4)]


def decompose(m):
    t = [m[12], m[13], m[14]]
    cols = [[m[c * 4 + r] for r in range(3)] for c in range(3)]
    s = [math.sqrt(sum(v * v for v in col)) for col in cols]
    rcol = [[v / s[i] for v in cols[i]] for i in range(3)]
    m00, m10, m20 = rcol[0]
    m01, m11, m21 = rcol[1]
    m02, m12, m22 = rcol[2]
    tr = m00 + m11 + m22
    if tr > 0:
        S = math.sqrt(tr + 1.0) * 2
        q = [(m21 - m12) / S, (m02 - m20) / S, (m10 - m01) / S, 0.25 * S]
    elif m00 > m11 and m00 > m22:
        S = math.sqrt(1.0 + m00 - m11 - m22) * 2
        q = [0.25 * S, (m01 + m10) / S, (m02 + m20) / S, (m21 - m12) / S]
    elif m11 > m22:
        S = math.sqrt(1.0 + m11 - m00 - m22) * 2
        q = [(m01 + m10) / S, 0.25 * S, (m12 + m21) / S, (m02 - m20) / S]
    else:
        S = math.sqrt(1.0 + m22 - m00 - m11) * 2
        q = [(m02 + m20) / S, (m12 + m21) / S, 0.25 * S, (m10 - m01) / S]
    return t, q, s


# --- accessor helpers ---
FMT = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def view(acc_i):
    a = gltf["accessors"][acc_i]
    bv = gltf["bufferViews"][a["bufferView"]]
    fmt, size = FMT[a["componentType"]]
    n = NCOMP[a["type"]]
    stride = bv.get("byteStride", size * n)
    return a, bv.get("byteOffset", 0) + a.get("byteOffset", 0), stride, fmt, size, n


def read(acc_i):
    a, off, stride, fmt, size, n = view(acc_i)
    return [list(struct.unpack_from("<" + fmt * n, binary, off + k * stride)) for k in range(a["count"])]


def write(acc_i, rows):
    a, off, stride, fmt, size, n = view(acc_i)
    for k, row in enumerate(rows):
        struct.pack_into("<" + fmt * n, binary, off + k * stride, *row)


def append_accessor(rows, type_, component=5126):
    fmt, size = FMT[component]
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    for row in rows:
        binary.extend(struct.pack("<" + fmt * len(row), *row))
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(binary) - offset})
    gltf["accessors"].append({"bufferView": len(gltf["bufferViews"]) - 1, "componentType": component, "count": len(rows), "type": type_})
    return len(gltf["accessors"]) - 1


parent = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []):
        parent[c] = i

skins = gltf["skins"]
main_i = next(i for i, s in enumerate(skins) if any(base(nodes[j].get("name")) == "Bip001-Pelvis" for j in s["joints"]))
main = skins[main_i]
bind_world = {}  # node -> bind-pose world matrix (inverse of its inverse bind matrix), per skin
for si, s in enumerate(skins):
    for j, ibm in zip(s["joints"], read(s["inverseBindMatrices"])):
        bind_world[(si, j)] = inverse(ibm)
main_by_base = {base(nodes[j]["name"]): j for j in main["joints"]}

ADJUST = {"pelvis_adjust": "Bip001-Pelvis", "spine_adjust": "Bip001-Spine", "spine_01_adjust": "Bip001-Spine1",
          "spine_02_adjust": "Bip001-Spine2", "neck_01_adjust": "Bip001-Neck", "head_adjust": "Bip001-Head"}
for side, S in (("l", "L"), ("r", "R")):
    ADJUST.update({f"clavicle_{side}_adjust": f"Bip001-{S}-Clavicle", f"upperarm_{side}_adjust": f"Bip001-{S}-UpperArm",
                   f"thigh_{side}_adjust": f"Bip001-{S}-Thigh"})


def trs_matrix(n):
    if "matrix" in n:
        return list(n["matrix"])
    t = n.get("translation", [0, 0, 0])
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1]
    for c in range(3):
        for k in range(3):
            m[c * 4 + k] *= s[c]
    return m


def world(i):
    m = trs_matrix(nodes[i])
    p = parent.get(i)
    return mul(world(p), m) if p is not None else m


def set_local(i, m):
    t, q, s = decompose(m)
    for k in ("matrix", "translation", "rotation", "scale"):
        nodes[i].pop(k, None)
    nodes[i].update({"translation": t, "rotation": q, "scale": s})


def reparent(i, new_parent, local):
    old = parent.get(i)
    if old is not None:
        nodes[old]["children"].remove(i)
        if not nodes[old]["children"]:
            del nodes[old]["children"]
    if new_parent is None:
        roots = gltf["scenes"][gltf.get("scene", 0)]["nodes"]
        roots.append(i)
        parent.pop(i, None)
    else:
        nodes[new_parent].setdefault("children", []).append(i)
        parent[i] = new_parent
    set_local(i, local)


def mesh_nodes_for(si):
    return [n for n in nodes if n.get("skin") == si and "mesh" in n]


def joint_weights(si):
    totals = {}
    s = skins[si]
    for n in mesh_nodes_for(si):
        for p in gltf["meshes"][n["mesh"]]["primitives"]:
            if "JOINTS_0" not in p["attributes"]:
                continue
            for js, ws in zip(read(p["attributes"]["JOINTS_0"]), read(p["attributes"]["WEIGHTS_0"])):
                for j, w in zip(js, ws):
                    if w > 0:
                        node = s["joints"][j]
                        totals[node] = totals.get(node, 0) + w
    return totals


body_mesh = next(i for i, n in enumerate(nodes) if n.get("skin") == main_i and "mesh" in n)
body_mesh_world = world(body_mesh)
for si, s in enumerate(skins):
    if si == main_i:
        continue
    # The accessory skeleton is a copy of the body skeleton parked elsewhere in the scene. Move it rigidly so its
    # most-weighted body-bone copy (e.g. head_adjust for the hat) lands on the real body bone, and follow that bone.
    weights = joint_weights(si)
    mapped = {x: main_by_base.get(ADJUST.get(base(nodes[x]["name"]), "")) for x in s["joints"]}
    mapped = {x: y for x, y in mapped.items() if y is not None}
    anchor = max(mapped, key=lambda x: weights.get(x, 0))
    if weights.get(anchor, 0) == 0:
        anchor = next(x for x in mapped if base(nodes[x]["name"]) == "head_adjust")
    body_bone = mapped[anchor]
    root = s["joints"][0]
    while parent.get(root) in s["joints"]:
        root = parent[root]
    local = mul(inverse(world(anchor)), world(root))
    print(f"skin {si}: anchored {nodes[anchor]['name']} on {nodes[body_bone]['name']}")
    reparent(root, body_bone, local)
    # Skinned meshes are placed by their joints; give them the body mesh's transform so they share its space.
    for n in mesh_nodes_for(si):
        idx = nodes.index(n)
        reparent(idx, parent.get(body_mesh), trs_matrix(nodes[body_mesh]))


# Drop joints that weight no vertices.
for si, s in enumerate(skins):
    used = set()
    prims = [p for n in mesh_nodes_for(si) for p in gltf["meshes"][n["mesh"]]["primitives"] if "JOINTS_0" in p["attributes"]]
    for p in prims:
        for js, ws in zip(read(p["attributes"]["JOINTS_0"]), read(p["attributes"]["WEIGHTS_0"])):
            used.update(j for j, w in zip(js, ws) if w > 0)
    keep = sorted(used)
    remap = {old: new for new, old in enumerate(keep)}
    done = set()
    for p in prims:
        acc = p["attributes"]["JOINTS_0"]
        if acc in done:
            continue
        done.add(acc)
        weights = read(p["attributes"]["WEIGHTS_0"])
        write(acc, [[remap.get(j, 0) if w > 0 else 0 for j, w in zip(js, ws)] for js, ws in zip(read(acc), weights)])
    ibms = read(s["inverseBindMatrices"])
    print(f"skin {si}: {len(s['joints'])} -> {len(keep)} joints")
    s["joints"] = [s["joints"][k] for k in keep]
    s["inverseBindMatrices"] = append_accessor([ibms[k] for k in keep], "MAT4")

CATS = {"Bip001-Pelvis": "Hips", "Bip001-Spine": "Spine", "Bip001-Spine1": "Chest", "Bip001-Spine2": "Upper Chest",
        "Bip001-Neck": "Neck", "Bip001-Head": "Head"}
for S, side in (("L", "Left"), ("R", "Right")):
    CATS.update({f"Bip001-{S}-Clavicle": f"{side} shoulder", f"Bip001-{S}-UpperArm": f"{side} arm",
                 f"Bip001-{S}-Forearm": f"{side} elbow", f"Bip001-{S}-Hand": f"{side} wrist",
                 f"Bip001-{S}-Thigh": f"{side} leg", f"Bip001-{S}-Calf": f"{side} knee",
                 f"Bip001-{S}-Foot": f"{side} ankle", f"Bip001-{S}-Toe0": f"{side} toe"})
renamed = 0
for n in nodes:
    if base(n.get("name")) in CATS:
        n["name"] = CATS[base(n["name"])]
        renamed += 1
print("renamed", renamed, "body bones")
gltf.pop("animations", None)

while len(binary) % 4:
    binary.append(0)
gltf["buffers"][0]["byteLength"] = len(binary)
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(binary))
out += struct.pack("<I", len(js)) + b"JSON" + js + struct.pack("<I", len(binary)) + b"BIN\0" + bytes(binary)
open(dst, "wb").write(out)
print("wrote", dst, len(out), "bytes")
