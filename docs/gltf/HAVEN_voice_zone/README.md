# HAVEN_voice_zone

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks part of a world as a voice zone: whoever stands in it gets the zone's voice settings instead of the world's ([HAVEN_voice](../HAVEN_voice/README.md)). Like VRChat worlds setting a player's voice gain, near, far and low-pass from Udon, but declared in the file.

- **Stage** (`"mode": "broadcast"`, or a zone with no other settings): anyone standing in it is heard by everyone in the world at full volume and unmuffled, wherever the listener is. Their voice still comes from where they stand. An audience can chat with the people around them while the performers on stage reach the whole crowd.
- **Custom** (any of `gain`, `near`, `far`, `lowpass`): those values replace the world's for people in the zone; the rest stay as the world sets them. For example a quiet booth (`"far": 6`), a loud podium (`"gain": 6, "far": 60`), or a DJ spot that isn't muffled (`"lowpass": false`).

The area is a box centred on the node, in the node's space: its `size`, or the bounds of the node's mesh if it has no `size`. A player counts as inside it when their position (their feet) is in the box, so make it tall enough to cover someone standing there. It doesn't block movement or show anything. Where zones overlap, the first one in the file wins.

Each listener works out who is in which zone from the positions they already receive, so no extra network messages are needed.

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

| Property  | Type                        | Description                                                          | Default                                               |
| --------- | --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| `mode`    | `"broadcast"` or `"custom"` | A stage, or the settings below.                                      | `"broadcast"` without other settings, else `"custom"` |
| `gain`    | `number`                    | Decibels relative to normal (−40 to +12).                            | The world's                                           |
| `near`    | `number`                    | Metres within which this speaker is at full volume.                  | The world's                                           |
| `far`     | `number`                    | Metres at which this speaker falls silent.                           | The world's `range`                                   |
| `lowpass` | `boolean`                   | Whether distance muffles this speaker.                               | The world's                                           |
| `size`    | `number[3]`                 | Box size in metres along the node's X, Y and Z, centred on the node. | The node's mesh bounds                                |

A node needs a `size` or a mesh; otherwise it is ignored with a warning.
