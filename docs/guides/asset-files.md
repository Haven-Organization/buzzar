# Asset files: behaviour travels with the file

Buzzar keeps everything that decides how a world, avatar or Thing behaves **in its glTF file**, as glTF extensions, rather than in Buzzar's own code. Three reasons:

- **Consistency and portability.** Every client that reads the file sees the same behaviour, today and later, in Buzzar or in any other Matrix 3D client that supports the extensions.
- **Overriding the defaults.** When a file says nothing, Buzzar guesses: spring bones from bone names, ear motion with default timing, and so on. A file that states its behaviour replaces those guesses, so authors aren't stuck with them.
- **No waiting on clients.** Authors can describe the behaviour they want in the file with documented extensions instead of waiting for every client to add a special case for their content.

## What can be stored where

| File          | Extension                                                                                                                                                                                              | What it holds                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Avatar        | [HAVEN_avatar_motion](../gltf/HAVEN_avatar_motion/README)                                                                                                                                              | Spring bones (hair, ears, tails, skirts…), idle ear motion, and face parts (blink, eyes, lip sync) |
| Avatar, Thing | [HAVEN_metadata](../gltf/HAVEN_metadata/README)                                                                                                                                                        | Name, multi-line description, author, source link, version                                         |
| Thing         | [HAVEN_thing](../gltf/HAVEN_thing/README)                                                                                                                                                              | Collider, weight, tipping, spawn place                                                             |
| Thing, world  | [HAVEN_trampoline](../gltf/HAVEN_trampoline/README)                                                                                                                                                    | Bouncy surfaces and how they bounce                                                                |
| Thing, world  | [HAVEN_grabbable](../gltf/HAVEN_grabbable/README)                                                                                                                                                      | Objects people can pick up                                                                         |
| World         | [HAVEN_seat](../gltf/HAVEN_seat/README), [HAVEN_climbable](../gltf/HAVEN_climbable/README), [HAVEN_mirror](../gltf/HAVEN_mirror/README), [HAVEN_avatar_pedestal](../gltf/HAVEN_avatar_pedestal/README) | Seats, ladders, mirrors, avatar pedestals                                                          |

VRM avatars can keep using VRM's own spring bones (`VRMC_springBone`, or VRM 0.x `secondaryAnimation`). Buzzar reads them when there's no `HAVEN_avatar_motion`.

## Baking behaviour into a file

`scripts/buzzar/bake-gltf.ts` writes these extensions into a `.glb` or `.vrm`. It changes only the file's JSON; meshes, textures and every other byte of binary data are copied unchanged. Run it from the repository root:

```sh
# An avatar's springs and ear motion, as Buzzar would do them today, plus its details:
node_modules/.bin/vite-node scripts/buzzar/bake-gltf.ts -- in.glb out.glb --avatar \
  --name "Haru Urara" --author "symbol aughhhh" --version 1 \
  --source "https://sketchfab.com/3d-models/umamusume-haru-urara-race-e7d6fb19f0724eb7b90c2bdf2f4e4e74" \
  --description-file description.txt
```

| Option                                        | What it does                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--avatar`                                    | Writes `HAVEN_avatar_motion` from the springs Buzzar uses for this avatar now (its own, its VRM ones, or ones guessed from bone names), its ear motion settings, and the face parts it uses for blinking, looking and lip sync. |
| `--face-json file`                            | Sets parts of the face from a JSON file before baking, such as hand-tuned `eyelids.moves` for a rig whose eyelid bones Buzzar can't guess.                                                                                      |
| `--no-ear-motion`                             | With `--avatar`: turns idle ear motion off.                                                                                                                                                                                     |
| `--name`, `--author`, `--source`, `--version` | Set those `HAVEN_metadata` fields. Fields you don't give are kept.                                                                                                                                                              |
| `--description` / `--description-file`        | Set the description, from the command line or from a text file (for several lines).                                                                                                                                             |

Then open the output's JSON (for example with `gltf-transform inspect` or any glTF editor) to tune it: change an ear's `stiffness`, make ear moves rarer with `earMotion.gapSeconds`, remove a chain you don't want to move, or add one Buzzar didn't find.
