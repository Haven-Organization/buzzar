# HAVEN_trampoline

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks part of a scene as a trampoline: a player who lands on it, standing up, is thrown back up.

- **Bounce height.** Each bounce rises to `bounciness` × the height the player fell from, but never less than `minBounceHeight`. Simply walking or hopping on gets you bouncing straight away. Dropping on from high up sends you back up proportionally high, never higher than `maxBounceHeight`.
- **Higher.** Holding jump as you land adds `jumpBoost` metres to that bounce, so a player can work their way up.
- **Stopping.** Crouch (or go prone) to stop bouncing and stand on it normally.
- **Objects.** Things thrown or dropped on it (crates, balls, anything with a dynamic physics body) bounce too, back up to `bounciness` × the height they fell, so they bounce lower each time and settle. They get no jump boost, and their own minimum, `objectMinBounceHeight`, only on the first landing of a throw or drop (not while they are still bouncing), so even a ball thrown in from the side at a shallow angle bounces well. They bounce off at an angle the way they came in: their speed across the area carries on (90% of it) and their speed into it comes back out along the area's +Y, so a ball tossed in at an angle bounces on and away from the trampoline.

The bouncy area is a flat area in the node's XZ plane, centred on the node and facing the node's +Y. It is a rectangle, or the ellipse inside that rectangle for `"round"`. It counts for feet a little above or below it, so it can sit under a pad or frame. It doesn't block movement: give the trampoline its own collider for players to land on. In a world without `OMI_collider`, Buzzar builds one from every mesh, the mat included.

Buzzar's stock Trampoline Thing uses this extension on a "Trampoline Bed" node. Its bouncy area covers the mat and most of the padded edge, leaving an 8 cm rim to stand on.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_trampoline"
]
```

The `HAVEN_trampoline` extension can be added to any `node`:

```json
"nodes": [
  {
    "name": "Trampoline Bed",
    "translation": [0, 0.5, 0],
    "extensions": {
      "HAVEN_trampoline": { "size": [2.84, 2.84], "shape": "round" }
    }
  }
]
```

| Property                | Type        | Description                                                                                           | Required                            |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `size`                  | `number[2]` | Width (X) and depth (Z) in metres of the bouncy area, centred on the node, in the node's local space. | No, default: the node's mesh bounds |
| `shape`                 | `string`    | `"rectangle"` or `"round"` (the ellipse inside the rectangle).                                        | No, default: `"rectangle"`          |
| `minBounceHeight`       | `number`    | The lowest bounce in metres, however gently you land.                                                 | No, default: `2.5`                  |
| `bounciness`            | `number`    | Bounce height as a fraction of the height fallen (0–1.2; 1 keeps every bounce as high as the last).   | No, default: `0.85`                 |
| `maxBounceHeight`       | `number`    | The highest bounce in metres.                                                                         | No, default: `30`                   |
| `jumpBoost`             | `number`    | Extra metres added to a bounce you land holding jump.                                                 | No, default: `1.5`                  |
| `objectMinBounceHeight` | `number`    | The lowest bounce in metres for a Thing's first landing after it is thrown or dropped on.             | No, default: `2.7`                  |

A node with neither a `size` nor a mesh is ignored (with a console warning).
