# HAVEN_seat

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks a node as a seat that avatars can sit on, similar to VRChat stations.

The node's position is the seat point: the spot the sitting avatar's hips are placed on (the hips are held 0.08 m above it). The sitter faces the node's local -Z axis, the same convention as `MX_spawn_point` and the player rig. Only the node's yaw is used for facing; pitch and roll are ignored.

Buzzar adds a clickable box (a physics sensor, so it never blocks movement) centered on the seat point. Clicking it, or pressing E while it is focused, sits the local user down:

- The user's character controller is suspended and their avatar plays a procedural sit animation. The animation is built on the default rig and retargeted, so it works with any avatar.
- While seated, the body can turn up to 60 degrees either side of the seat's facing.
- Moving or jumping stands the user up at the position they were standing on when they sat down.

Seat state is networked. When a user sits or stands, every peer is told which seat they are on, and the message is repeated every 2 seconds while seated so people who join later see them sitting. Seats are identified by their glTF node index, so all clients must load the same scene file. A seat holds one person: a seat a remote peer is sitting on cannot be clicked.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_seat"
]
```

The `HAVEN_seat` extension can be added to any `node`. The node does not need a mesh; seats are usually empty marker nodes placed on top of a separate piece of furniture.

```json
"nodes": [
  {
    "name": "Sofa seat left",
    "translation": [-0.95, 1.06, 2.595],
    "rotation": [0, 0, 0, 1],
    "extensions": {
      "HAVEN_seat": {
        "size": [0.55, 0.3, 0.55]
      }
    }
  }
]
```

| Property | Type        | Description                                                                                                                                                 | Required                        |
| -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `size`   | `number[3]` | Full width, height and depth in meters of the clickable box, centered on the seat point, in the node's local space. It is scaled by the node's world scale. | No, default: `[0.6, 0.35, 0.6]` |

An empty object (`"HAVEN_seat": {}`) is a valid seat with the default box.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "HAVEN_seat",
  "type": "object",
  "description": "Marks a node as a seat. The node's origin is where the sitter's hips go; the sitter faces local -Z.",
  "properties": {
    "size": {
      "type": "array",
      "description": "Full extents in meters of the clickable box centered on the seat point.",
      "items": { "type": "number", "exclusiveMinimum": 0 },
      "minItems": 3,
      "maxItems": 3,
      "default": [0.6, 0.35, 0.6]
    },
    "extensions": {},
    "extras": {}
  }
}
```

## Authoring with extras

Some tools drop extensions they do not know (gltf-transform, for one), and authoring tools such as Blender export custom properties as node `extras`. Buzzar's `scripts/buzzar/finish-world.mjs` promotes any node `extras` key starting with `HAVEN_`, `MX_` or `OMI_` to a real extension and adds it to `extensionsUsed`. So a Blender custom property `HAVEN_seat` with the value `{"size": [0.55, 0.35, 0.5]}` becomes this extension once the file goes through `finish-world.mjs`. Buzzar's loader itself only reads `extensions`, not `extras`.

## Compatibility

Third Room and other clients that do not know this extension ignore it. The node loads as a plain node: an empty marker stays invisible and nothing is clickable, and any furniture modeled separately is unaffected. Do not list `HAVEN_seat` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/seats/seats.game.ts`). Example scenes: `scripts/buzzar/home/compose-home.mjs` (log seats around a campfire) and `scripts/buzzar/make-living-room-world.mjs` (sofa and armchair).
