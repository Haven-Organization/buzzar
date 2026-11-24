# Builds public/gltf/test/flightdeck-standin.glb (Third Room #589 stand-in: 20 identical two-material planes
# sharing one mesh, 8 nested in two squadrons, in a wall in front of the spawn).
# blender -b --python scripts/buzzar/flightdeck-standin.py -- public/gltf/test/flightdeck-standin.glb
import bpy, math, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1); return m
body, wing = mat("Body", (0.55, 0.6, 0.65)), mat("Wing", (0.9, 0.9, 0.9))
# One plane mesh: fuselage (Body) + wings and tail (Wing): two materials -> two glTF primitives.
bpy.ops.mesh.primitive_cube_add(size=1); f = bpy.context.object; f.scale = (4, 0.6, 0.6)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.3, 0, 0)); w = bpy.context.object; w.scale = (1.2, 7, 0.12)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.8, 0, 0.6)); t = bpy.context.object; t.scale = (0.6, 2.2, 0.1)
for o in (f, w, t): bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.transform_apply(scale=True)
f.data.materials.append(body); w.data.materials.append(wing); t.data.materials.append(wing)
bpy.ops.object.select_all(action="DESELECT")
for o in (f, w, t): o.select_set(True)
bpy.context.view_layer.objects.active = f; bpy.ops.object.join()
plane = f; plane.name = "Plane 01"; plane.data.name = "PlaneMesh"
# Ground.
bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, -0.5)); bpy.context.object.name = "Deck"
bpy.context.object.data.materials.append(mat("Deck", (0.2, 0.22, 0.25)))
planes = [plane]
for i in range(1, 20):
    p = plane.copy(); p.name = f"Plane {i+1:02d}"; bpy.context.collection.objects.link(p); planes.append(p)
# A grid like a flight deck; planes 13-20 nested under two squadron empties (one nested again).
for i, p in enumerate(planes):
    row, col = divmod(i, 5)
    p.location = (col * 10 - 20, 45, row * 5 + 2); p.rotation_euler = (0, 0, math.radians(90 + (i * 23) % 40 - 20))
sqa = bpy.data.objects.new("Squadron A", None); bpy.context.collection.objects.link(sqa)
sqb = bpy.data.objects.new("Squadron B", None); bpy.context.collection.objects.link(sqb); sqb.parent = sqa
sqa.location = (0, 0, 0)
for p in planes[12:16]: p.parent = sqa
for p in planes[16:20]: p.parent = sqb
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=False, export_lights=False)
print("exported", len(planes), "planes")
