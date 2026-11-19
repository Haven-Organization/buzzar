# HAVEN_thing

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension says how a Thing (an object people spawn, grab and throw) behaves physically: its collision shape, how heavy it is, whether it can tip over, and where it appears when someone spawns it. The behaviour travels with the file, so it isn't hard-coded in a client.

Buzzar's stock Trampoline uses it: a heavy drum that only turns about the vertical, so it always stands flat and nothing tips it over, and it appears a little way off so it doesn't land on you.

Buzzar keeps its own values for each stock Thing as a fallback, used until the file has loaded and for any property the file leaves out or gets wrong.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_thing"
]
```

`HAVEN_thing` goes in the glTF root's `extensions`. It describes the whole file, placed with its origin on the floor.

```json
"extensions": {
  "HAVEN_thing": {
    "collider": { "type": "cylinder", "radius": 1.5, "height": 0.53, "offset": [0, 0.265, 0] },
    "density": 40,
    "rotation": "yaw",
    "upright": true,
    "spawn": { "distance": 2.4, "upright": true }
  }
}
```

| Property   | Type      | Description                                                                                                                             | Default                    |
| ---------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `collider` | `object`  | The collision shape (below).                                                                                                            | The client's own           |
| `density`  | `number`  | Kilograms per cubic metre of the collider, which sets its weight.                                                                       | The client's own           |
| `rotation` | `string`  | `"free"`: turns any way. `"yaw"`: only turns about the vertical, so it can't tip over.                                                  | `"free"`                   |
| `upright`  | `boolean` | When held, it only turns to face the way you face, and when left tilted it settles back level.                                          | `false`                    |
| `spawn`    | `object`  | `{ "distance": metres, "upright": boolean }`: how far in front of you it appears, and whether it's stood level facing the way you look. | 1 m, tilted like your hand |

### collider

| `type`       | Properties                                          |
| ------------ | --------------------------------------------------- |
| `"box"`      | `size`: `[x, y, z]` in metres                       |
| `"sphere"`   | `radius`                                            |
| `"cylinder"` | `radius`, `height` (along the Thing's vertical, +Y) |

Every collider can have an `offset` (`[x, y, z]`, metres) from the Thing's origin to the shape's centre. A Thing whose origin is on its base usually needs half its height here. A collider with a missing or non-positive size is ignored.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "HAVEN_thing",
  "type": "object",
  "properties": {
    "collider": {
      "type": "object",
      "properties": {
        "type": { "enum": ["box", "sphere", "cylinder"] },
        "size": { "type": "array", "items": { "type": "number", "exclusiveMinimum": 0 }, "minItems": 3, "maxItems": 3 },
        "radius": { "type": "number", "exclusiveMinimum": 0 },
        "height": { "type": "number", "exclusiveMinimum": 0 },
        "offset": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 }
      },
      "required": ["type"]
    },
    "density": { "type": "number", "exclusiveMinimum": 0 },
    "rotation": { "enum": ["free", "yaw"] },
    "upright": { "type": "boolean" },
    "spawn": {
      "type": "object",
      "properties": {
        "distance": { "type": "number", "exclusiveMinimum": 0 },
        "upright": { "type": "boolean" }
      }
    },
    "extensions": {},
    "extras": {}
  }
}
```

## Compatibility

Clients that don't know this extension ignore it and give the Thing their own physics, if any. Don't list `HAVEN_thing` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/spawnables/thingFile.ts`, used by `spawnables.game.ts`). Example: `public/gltf/things/trampoline.glb`, made by `scripts/buzzar/make-trampoline-thing.py`.
