# HAVEN_avatar_motion

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec. Used on avatar files (`.glb` or `.vrm`).

## Overview

This extension stores an avatar's secondary motion in the avatar file itself: which bones swing and bounce (hair, ears, tails, skirts, ribbons…), how stiff and heavy they are, how animal ears move on their own, and which parts of the face blink, look around and move with the voice. Because the behaviour travels with the file, every client that reads the extension animates the avatar the same way, and an author can tune or turn off anything Buzzar would otherwise guess.

**Without the extension**, Buzzar uses, in order:

1. VRM 1.0 `VRMC_springBone`.
2. VRM 0.x `secondaryAnimation`.
3. Guessing from bone names. Non-body bones named like `hair`, `ear`, `tail`, `skirt`, `ribbon`, `breast`, `hat` and so on get that kind's default settings.

Ears found any of these ways also get idle ear motion with Buzzar's defaults.

**With the extension**, `springs` replaces all of that: only the chains it lists move, and an empty list means none do. `earMotion` sets how the ears listed with `"kind": "ear"` move on their own, or turns it off. `face` chooses the face parts (see [face](#face)).

To write the extension from what Buzzar does today, then tune it by hand, see [Baking behaviour into a file](../../guides/asset-files#baking-behaviour-into-a-file).

## How a spring works

Each listed joint keeps a tail point a bone length away, moved by inertia and gravity and pulled back toward the joint's rest direction by its stiffness, then pushed out of colliders. This is the same model as VRM's spring bones. A joint that several listed joints branch from (a hair root, a hat's crown) stays put, and its strands swing. Springs follow the animated pose: they're simulated after the body animation each frame, by every viewer, and never sent over the network.

## Idle ear motion

Ears, meaning springs with `"kind": "ear"`, move on their own every so often, like a horse's or a cat's:

- **Flick:** the ear turns partway back and out, then springs back.
- **Fold:** the ear pins back and down for a moment.
- **Which ears:** a move is made with both ears or with one.
- **Speed:** each move has a random speed within its range.

The fold starts at the ear's first full-size joint, skipping tiny helper pivots.

## glTF Schema Updates

```json
"extensionsUsed": ["HAVEN_avatar_motion"],
"extensions": {
  "HAVEN_avatar_motion": {
    "springs": [
      {
        "kind": "ear",
        "joints": [264, 265, 266],
        "stiffness": 3.2,
        "gravityPower": 0,
        "gravityDir": [0, -1, 0],
        "dragForce": 0.6,
        "hitRadius": 0.01
      },
      { "kind": "tail", "joints": [301, 302, 303, 304], "stiffness": 1.2, "gravityPower": 0.1, "dragForce": 0.35 }
    ],
    "earMotion": {
      "enabled": true,
      "gapSeconds": [15, 40],
      "firstSeconds": [8, 20],
      "foldShare": 0.2,
      "bothEarsShare": 0.45,
      "flickSpeed": [1.6, 2.8],
      "foldSpeed": [0.35, 2.6]
    }
  }
}
```

The extension sits on the glTF root.

### Spring

| Property       | Type        | Description                                                                                                                                                                    | Default      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `joints`       | `number[]`  | Node indices of the chain, parent first. Usually skin joints; branching chains are fine (list every joint of every strand).                                                    | required     |
| `kind`         | `string`    | What it is: `ear`, `tail`, `hair`, `skirt`, `cloth`, `breast`, `hat`, or anything else. Only `ear` changes behaviour today (idle ear motion).                                  | none         |
| `stiffness`    | `number`    | Pull back toward the rest pose, roughly 0–4.                                                                                                                                   | `1`          |
| `gravityPower` | `number`    | Strength of gravity, roughly 0–2.                                                                                                                                              | `0`          |
| `gravityDir`   | `number[3]` | Gravity direction in world space.                                                                                                                                              | `[0, -1, 0]` |
| `dragForce`    | `number`    | 0 keeps swinging, 1 has no inertia.                                                                                                                                            | `0.5`        |
| `hitRadius`    | `number`    | Radius of each joint for collisions, in metres.                                                                                                                                | `0.02`       |
| `lastIsTip`    | `boolean`   | The last joint only marks where the one before it ends and isn't simulated (as in VRM 1.0).                                                                                    | `false`      |
| `colliders`    | `object[]`  | Spheres or capsules the chain can't pass through: `{ "node": n, "offset": [x, y, z], "radius": r }`, plus `"tail": [x, y, z]` for a capsule. Offsets are in that node's space. | none         |

### earMotion

`"earMotion": false` or `{ "enabled": false }` turns idle ear motion off; the ears still swing as springs.

| Property        | Type        | Description                                                               | Default       |
| --------------- | ----------- | ------------------------------------------------------------------------- | ------------- |
| `enabled`       | `boolean`   | Whether ears move on their own.                                           | `true`        |
| `gapSeconds`    | `number[2]` | Seconds between one move ending and the next starting: shortest, longest. | `[15, 40]`    |
| `firstSeconds`  | `number[2]` | Seconds before the first move after the avatar loads.                     | `[8, 20]`     |
| `foldShare`     | `number`    | Share of moves (0–1) that are slow folds; the rest are quick flicks.      | `0.2`         |
| `bothEarsShare` | `number`    | Share of moves (0–1) made with both ears; the rest move one ear.          | `0.45`        |
| `flickSpeed`    | `number[2]` | Speed range of flicks (1 = normal).                                       | `[1.6, 2.8]`  |
| `foldSpeed`     | `number[2]` | Speed range of folds (1 = normal).                                        | `[0.35, 2.6]` |

Joints that aren't valid node indices are skipped. At most 256 joints per avatar are simulated.

### face

Which parts of the face move. **Without it**, Buzzar finds them itself: VRM 1.0 expressions and VRM 0.x blend shape groups first, then morph targets and bones named like blinks, mouth shapes, eyes, eyelids, a jaw or lips. **With it**, each part it gives replaces that guess, and parts it leaves out are still found the usual way. The bake tool (`bake-gltf.ts --avatar`) writes what Buzzar finds today, so you can start from that.

| Property  | Type        | Description                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blink`   | `bind[]`    | Morph targets that close both eyes.                                                                                                                                                                                                                                                                                                                              |
| `eyelids` | `object`    | For rigs without blink shapes: `{ "upper": [nodes], "lower": [nodes] }`. Each upper-lid bone slides down to the nearest lower-lid bone on the same side. Or give `"moves": [{ "node": 12, "delta": [0, -0.03, 0] }]`: exactly how far each bone moves, in its parent's space, when the eyes are shut (any bone, so lower lids, lashes and creases can move too). |
| `eyes`    | `integer[]` | Eye bones that turn toward nearby people. `[]` keeps the eyes still.                                                                                                                                                                                                                                                                                             |
| `look`    | `object`    | How far the eyes turn, in degrees: `{ "yaw": 12, "pitchUp": 8, "pitchDown": 10 }`.                                                                                                                                                                                                                                                                               |
| `mouth`   | `bind[][]`  | Lip sync with blend shapes: five lists of morph targets, for the visemes aa, ih, ou, ee and oh in that order.                                                                                                                                                                                                                                                    |
| `jaw`     | `integer`   | Lip sync with a jaw bone, which opens with the voice.                                                                                                                                                                                                                                                                                                            |
| `lips`    | `object[]`  | Lip sync with lip bones: `{ "node": 12, "kind": "corner" }`, with `kind` one of `corner`, `upper`, `lower` or `teeth` (lower teeth). Buzzar works out how far each moves from where the bones sit in the rest pose.                                                                                                                                              |

A `bind` is `{ "mesh": 2, "index": 5, "weight": 1 }` (a morph target of every node using that mesh) or `{ "node": 7, "index": 5, "weight": 1 }` (a morph target of one node), with `weight` from 0 to 1.

`blink` and `eyelids` together say how the eyes close: give either and neither is guessed. Likewise `mouth`, `jaw` and `lips` together say how lip sync works: give one and the others are not guessed, so `"jaw": 3` alone means a jaw bone and nothing else.

```json
"face": {
  "blink": [{ "mesh": 1, "index": 12, "weight": 1 }],
  "eyes": [41, 42],
  "look": { "yaw": 12, "pitchUp": 8, "pitchDown": 10 },
  "lips": [
    { "node": 50, "kind": "corner" },
    { "node": 51, "kind": "corner" },
    { "node": 52, "kind": "upper" },
    { "node": 53, "kind": "lower" }
  ]
}
```

Invalid node, mesh or morph indices and unknown lip kinds are skipped.
