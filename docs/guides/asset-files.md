# Asset files: behaviour travels with the file

Buzzar keeps everything that decides how a world, avatar or Item behaves **in its glTF file**, as glTF extensions, rather than in Buzzar's own code. Three reasons:

- **Consistency and portability.** Every client that reads the file sees the same behaviour, today and later, in Buzzar or in any other Matrix 3D client that supports the extensions.
- **Overriding the defaults.** When a file says nothing, Buzzar guesses: spring bones from bone names, ear motion with default timing, and so on. A file that states its behaviour replaces those guesses, so authors aren't stuck with them.
- **No waiting on clients.** Authors can describe the behaviour they want in the file with documented extensions instead of waiting for every client to add a special case for their content.

## What can be stored where

| File         | Extension                                                                                                                                                                                              | What it holds                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Avatar       | [HAVEN_avatar_motion](../gltf/HAVEN_avatar_motion/README)                                                                                                                                              | Spring bones (hair, ears, tails, skirts…), idle ear motion, and face parts (blink, eyes, lip sync) |
| Avatar, Item | [HAVEN_metadata](../gltf/HAVEN_metadata/README)                                                                                                                                                        | Name, multi-line description, author, source link, version                                         |
| Item         | [HAVEN_item](../gltf/HAVEN_item/README)                                                                                                                                                                | Collider, weight, tipping, spawn place                                                             |
| Item         | [HAVEN_sprayer](../gltf/HAVEN_sprayer/README)                                                                                                                                                          | Spraying: nozzle, stream, tank, pump, sounds                                                       |
| Item, world  | [HAVEN_trampoline](../gltf/HAVEN_trampoline/README)                                                                                                                                                    | Bouncy surfaces and how they bounce                                                                |
| Item, world  | [HAVEN_grabbable](../gltf/HAVEN_grabbable/README)                                                                                                                                                      | Objects people can pick up                                                                         |
| World        | [HAVEN_seat](../gltf/HAVEN_seat/README), [HAVEN_climbable](../gltf/HAVEN_climbable/README), [HAVEN_mirror](../gltf/HAVEN_mirror/README), [HAVEN_avatar_pedestal](../gltf/HAVEN_avatar_pedestal/README) | Seats, ladders, mirrors, avatar pedestals                                                          |

VRM avatars can keep using VRM's own spring bones (`VRMC_springBone`, or VRM 0.x `secondaryAnimation`). Buzzar reads them when there's no `HAVEN_avatar_motion`.

## Baking behaviour into a file

`scripts/buzzar/bake-gltf.ts` writes these extensions into a `.glb` or `.vrm`, so an avatar or Item behaves the same in every client instead of depending on what each client would guess. It changes only the file's JSON (and adds embedded sounds or a map picture to the end of its binary data); meshes, textures and everything else are copied unchanged. Run it from the repository root:

```sh
# An avatar's springs and ear motion, as Buzzar would do them today, plus its details:
node_modules/.bin/vite-node scripts/buzzar/bake-gltf.ts -- in.glb out.glb --avatar \
  --name "Haru Urara" --author "symbol aughhhh" --version 1 \
  --source "https://sketchfab.com/3d-models/umamusume-haru-urara-race-e7d6fb19f0724eb7b90c2bdf2f4e4e74" \
  --description-file description.txt

# An Item: its physics as Buzzar would work them out (a box fitted round it), how it's held, its sounds, what
# it does (a water gun's HAVEN_sprayer), and its controls:
node_modules/.bin/vite-node scripts/buzzar/bake-gltf.ts -- gun.glb out.glb --item --item-json hold.json \
  --sound Spray=spray-loop.wav --sound Pump=pump.wav --sprayer-json sprayer.json \
  --control use="Spray (hold)" --control secondary="Pump to refill" --control drop="Put down"
```

| Option                                        | What it does                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--avatar`                                    | Writes `HAVEN_avatar_motion` from the springs Buzzar uses for this avatar now (its own, its VRM ones, or ones guessed from bone names), its ear motion settings, and the face parts it uses for blinking, looking and lip sync. |
| `--face-json file`                            | Sets parts of the face from a JSON file before baking, such as hand-tuned `eyelids.moves` for a rig whose eyelid bones Buzzar can't guess.                                                                                      |
| `--no-ear-motion`                             | With `--avatar`: turns idle ear motion off.                                                                                                                                                                                     |
| `--name`, `--author`, `--source`, `--version` | Set those `HAVEN_metadata` fields. Fields you don't give are kept.                                                                                                                                                              |
| `--description` / `--description-file`        | Set the description, from the command line or from a text file (for several lines).                                                                                                                                             |
| `--item`                                      | Writes `HAVEN_item` from what Buzzar would do with the Item now: a box collider fitted round it and how far off it appears. Whatever the file already says is kept.                                                             |
| `--item-json file`                            | Merges a JSON file into `HAVEN_item` first, e.g. `{ "spawn": { "held": true }, "hold": { … } }`.                                                                                                                                |
| `--sound Name=file`                           | Embeds a sound (`.wav`, `.mp3` or `.ogg`) as a KHR_audio source called Name. Repeat for each sound.                                                                                                                             |
| `--sprayer-json file`                         | Writes `HAVEN_sprayer`. Its `sounds` can name sounds embedded with `--sound` (`"spray": "Spray"`) instead of giving source indices.                                                                                             |
| `--control action=label`                      | An Item's controls (`use`, `secondary`, `drop`, `throw`, `rotate`), shown when it's picked up. Repeat for each; replaces the file's list.                                                                                       |

**Upload Item** in Buzzar does part of this for you: with **Save to file** on, an Item whose file doesn't say how it behaves physically gets Buzzar's fitted box written into it, and **Appears in Your Hold** is saved too.

Then open the output's JSON (for example with `gltf-transform inspect` or any glTF editor) to tune it: change an ear's `stiffness`, make ear moves rarer with `earMotion.gapSeconds`, remove a chain you don't want to move, or add one Buzzar didn't find.
