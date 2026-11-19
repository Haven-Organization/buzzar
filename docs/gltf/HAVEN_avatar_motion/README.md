# HAVEN_avatar_motion

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec. Used on avatar files (`.glb` or `.vrm`).

## Overview

This extension stores an avatar's secondary motion in the avatar file itself: which bones swing and bounce (hair, ears, tails, skirts, ribbons…), how stiff and heavy they are, and how animal ears move on their own. Because the behaviour travels with the file, every client that reads the extension animates the avatar the same way, and an author can tune or turn off anything Buzzar would otherwise guess.

**Without the extension**, Buzzar uses, in order:

1. VRM 1.0 `VRMC_springBone`.
2. VRM 0.x `secondaryAnimation`.
3. Guessing from bone names. Non-body bones named like `hair`, `ear`, `tail`, `skirt`, `ribbon`, `breast`, `hat` and so on get that kind's default settings.

Ears found any of these ways also get idle ear motion with Buzzar's defaults.

**With the extension**, `springs` replaces all of that: only the chains it lists move, and an empty list means none do. `earMotion` sets how the ears listed with `"kind": "ear"` move on their own, or turns it off.

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
