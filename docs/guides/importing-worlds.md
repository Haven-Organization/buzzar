# Importing Worlds

This guide turns a 3D model — a Blender scene, or a model downloaded from a store like CGTrader or Sketchfab — into a world you can walk around in. It's how the Living Room, Convenience Store, Mobile Home Camping Resort and Backrooms worlds were made.

A Buzzar world is a single `.glb` file (glTF binary) uploaded as a world's scene. Every mesh becomes a static collider unless the file says otherwise, so a model that looks right is usually walkable as-is. The work is mostly in making it light enough to download, lit well, and in the right place.

## What you need

- [Node](https://nodejs.org) 18 or newer, and a clone of the [Buzzar repository](https://github.com/Haven-Organization/buzzar).
- The glTF helpers, installed once:

  ```bash
  cd scripts/buzzar/gltf-tools && npm install
  ```

- [Blender](https://www.blender.org) if your model is a `.blend`, `.fbx` or `.obj`.

Check the model's license before you upload it. Worlds are shared with everyone who joins them.

## 1. Export to glTF

From Blender: **File → Export → glTF 2.0**, format **glTF Binary (.glb)**, with **Apply Modifiers** on. Draco compression is fine to leave on: Buzzar decodes it, as well as Meshopt, quantized meshes, WebP and KTX2 textures.

Items that often go wrong:

- **Lights are far too bright.** Blender converts watts to candela physically. Fix it with `tune-lights.mjs` (step 3).
- **Missing textures.** Downloaded `.blend` files often point at texture paths on the author's computer. Relink them in Blender (**File → External Data → Find Missing Files**) before exporting.
- **Black screen or black patches.** Clearcoat and transmission materials don't render correctly yet. Strip them with `STRIP_EXTENSIONS=KHR_materials_clearcoat,KHR_materials_transmission` when running `tune-lights.mjs`. NaN normals also cause black blow-outs; `check-normals.mjs` finds and fixes them.

## 2. Optimize

```bash
node scripts/buzzar/gltf-tools/optimize-world.mjs model.glb model-opt.glb
```

This merges draw calls, welds vertices, removes unused data, resizes textures to at most 1024 px and turns opaque textures into JPEGs. A 200 MB download often comes out under 20 MB. Aim for under 30 MB so worlds load quickly for everyone.

**Compress last.** Once the world is finished (after step 6 below, just before uploading), compress it to roughly halve the download again:

```bash
node scripts/buzzar/gltf-tools/compress-world.mjs world.glb world-small.glb
```

It compresses the geometry (Meshopt with quantization) and turns textures into WebP, keeping everything else, including Buzzar's own extensions (spawn points, seats, mirrors, ladders, the sky), exactly as it was. Two of our worlds went from 20 to 10 MB and from 49 to 22 MB with no visible difference. Compressed worlds need Buzzar from November 2026 or later; other Third Room clients can't open them.

## 3. Fix lighting (Blender scenes)

```bash
node scripts/buzzar/gltf-tools/tune-lights.mjs model-opt.glb model-lit.glb 8 2
```

The arguments are the candela to give every point/spot light and the highest emissive strength to allow. An optional JSON file can override individual materials' colour, roughness, metalness or transparency.

## 4. Close it in

Models are often only the visible parts: a room with no ceiling, a shop with no back wall, a building with no ground around it. These helpers add the missing pieces using the scene's own materials:

| Problem                            | Fix                                            |
| ---------------------------------- | ---------------------------------------------- |
| You fall off the edge of the model | `add-ground.mjs` adds a large tiled ground     |
| You can walk out through gaps      | `add-walls.mjs` encloses an outline with walls |
| Sky shows through the ceiling      | `add-roof.mjs` adds a roof over a rectangle    |

To find coordinates, `heightmap.mjs` draws a top-down height map of the scene, and `raycast.mjs` casts rays from a point and tells you what they hit (and whether it's the front or back of a face). Casting rays in every direction from inside the space is a quick check that nothing is open to the sky.

Each script lists its arguments in the comment at the top of the file.

## 5. Finish the world

```bash
node scripts/buzzar/finish-world.mjs model-lit.glb --out world.glb \
  --ground 0.0 --center 1.5,-2 --spawn 0,3,180 --name "My World" --sky sky.hdr
```

| Option            | What it does                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| `--ground <y>`    | The height of the floor you walk on, which becomes y = 0                   |
| `--center x,z`    | The point that becomes the world's origin                                  |
| `--spawn x,z,yaw` | Where people appear and which way they face (yaw 0 faces +Z, 180 faces −Z) |
| `--sun`, `--fill` | Strength of the added sun and sky-fill lights                              |
| `--lighting even` | Four equal lights from every side instead of a sun, for indoor spaces      |
| `--sky sky.hdr`   | Embeds an equirectangular HDR image as the sky and reflections             |

Coordinates are in the model's own space, before the move.

## 6. Add things to do

Buzzar reads extra behaviour from glTF extensions on nodes. In Blender, add them as **custom properties** on an object (they're exported as glTF `extras`); `finish-world.mjs` turns any `HAVEN_*`, `MX_*` or `OMI_*` extras into real extensions.

- [HAVEN_seat](/gltf/HAVEN_seat/README): a place to sit. Click it to sit, move to stand up.
- [HAVEN_climbable](/gltf/HAVEN_climbable/README): a ladder. Walk into it to climb. Meshes named "ladder" are climbable even without it.
- [HAVEN_grabbable](/gltf/HAVEN_grabbable/README): an object people can pick up and throw, like a mug.
- [HAVEN_mirror](/gltf/HAVEN_mirror/README): a mirror, off by default to save performance.
- [HAVEN_avatar_pedestal](/gltf/HAVEN_avatar_pedestal/README): a stand that lets people try on and wear an avatar.
- [MX_portal](/gltf/MX_portal/README): a portal to another world.

## 7. Test and upload

Open `/viewer` on your Buzzar site and drag in `world.glb` to try it before uploading. Then create a world (or open an existing world's settings) and choose `world.glb` as its scene, with a preview image.

If you get stuck in a wall or fall through the floor, open the command panel (Ctrl+K) and run **Toggle Physics Debug** to see the colliders, and check the ground height you passed to `finish-world.mjs`.
