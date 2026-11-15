# glTF tools for building Buzzar worlds

Small command-line helpers used to turn downloaded 3D models (CGTrader, Sketchfab, Blender exports…) into Buzzar
worlds. They use glTF-Transform v4, so they have their own dependencies (the app itself pins v2):

```sh
cd scripts/buzzar/gltf-tools && npm install
```

Each script prints its usage in the comment at the top of the file.

| Script | What it does |
| --- | --- |
| `optimize-world.mjs` | Merges draw calls, welds, prunes, resizes textures to ≤ 1024 px, JPEGs opaque textures. Uses no compression extensions the engine can't decode. |
| `tune-lights.mjs` | Tames Blender's watt→candela light export and caps emissive strength; optional per-material overrides. Set `STRIP_EXTENSIONS` to drop extensions (e.g. clearcoat/transmission). |
| `add-ground.mjs` | Adds a large tiled ground quad so walking off the model doesn't drop you into the void. |
| `add-walls.mjs` | Encloses an outline polygon with walls using one of the scene's own materials. |
| `add-roof.mjs` | Adds a downward-facing roof over a rectangle so gaps in a ceiling don't show sky. |
| `heightmap.mjs` | Top-down height map (PGM + JSON) for finding floors, spawn points and gaps. |
| `raycast.mjs` | Casts rays from a point and reports the first hit's material, distance and facing; for checking enclosures. |
| `fix-ripped-avatar.py` | Python: makes a game-ripped Sketchfab avatar usable (3ds Max Biped body + separate accessory skeletons): attaches accessories to the body, drops bones that move nothing, renames body bones to CATS names. `python3 -I fix-ripped-avatar.py in.glb out.glb`, then `gltf-transform prune`. |
| `check-normals.mjs` | Finds NaN / zero-length normals (they show as black bloom blow-outs) and can repair them. |

Typical order: export → `optimize-world` → `tune-lights` (Blender scenes) → `add-ground` / `add-walls` /
`add-roof` as needed → check with `heightmap` and `raycast` → `../finish-world.mjs` (ground at y=0, lights,
spawn point, sky) → upload as the world's scene.
