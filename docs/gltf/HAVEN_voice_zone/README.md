# HAVEN_voice_zone

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks part of a world as a stage area. Anyone standing in it is heard by everyone in the world, at full volume, wherever the listener is. Their voice still comes from where they stand.

Everywhere else, voices are spatial: they get quieter with distance and stop at the world's voice range (see [HAVEN_voice](../HAVEN_voice/README.md)). That way an audience can chat with the people around them while the performers on stage reach the whole crowd.

The area is a box centred on the node, in the node's space: its `size`, or the bounds of the node's mesh if it has no `size`. A player counts as inside it when their position (their feet) is in the box, so make it tall enough to cover someone standing on the stage. It doesn't block movement or show anything.

Each listener works out who is on a stage from the positions they already receive, so no extra network messages are needed.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_voice_zone"
]
```

The `HAVEN_voice_zone` extension can be added to any `node`:

```json
"nodes": [
  {
    "name": "Stage",
    "translation": [0, 1, -12],
    "extensions": {
      "HAVEN_voice_zone": { "mode": "broadcast", "size": [10, 3, 6] }
    }
  }
]
```

| Property | Type          | Description                                                          | Default                |
| -------- | ------------- | -------------------------------------------------------------------- | ---------------------- |
| `mode`   | `"broadcast"` | Everyone hears whoever stands here. The only mode so far.            | `"broadcast"`          |
| `size`   | `number[3]`   | Box size in metres along the node's X, Y and Z, centred on the node. | The node's mesh bounds |

A node needs a `size` or a mesh; otherwise it is ignored with a warning.
