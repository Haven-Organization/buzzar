# HAVEN_climbable

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks a node as something people can climb, like a ladder.

Within reach of the climbable box (it counts up to 0.4 m out to the sides), a player who walks forward while facing it climbs up at 2 m/s. Walking backward climbs down. Gravity is off while they're on it, so letting go of the keys holds them in place, and sideways input moves them along it. Once their feet pass the top of the box they're off the ladder and can walk onto whatever it leads to. Jumping lets go, pushing them away from the ladder. Climbing works when standing, not when crouched or prone.

The box is only for climbing: it doesn't block movement, so give the ladder its own collider (or let Buzzar build one from its mesh, as it does for every mesh in a world without `OMI_collider`).

**Worlds without the extension:** in a world scene, any node with a mesh whose name contains "ladder" (any case) is climbable automatically, using its mesh's bounds. That covers existing worlds that already have ladders. A file that uses `HAVEN_climbable` anywhere gets no guessing: only the nodes it marks are climbable.

**Climb Down:** every climbable gets an invisible "Climb Down" target over its top end. Standing up there, aim at it and press interact (E, click or trigger) to be put on the ladder just below the top, on the side away from where you stood, facing it and holding on.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_climbable"
]
```

The `HAVEN_climbable` extension can be added to any `node`:

```json
"nodes": [
  {
    "name": "Loft ladder",
    "mesh": 4,
    "translation": [0, 1.5, -0.95],
    "extensions": {
      "HAVEN_climbable": {}
    }
  }
]
```

| Property | Type        | Description                                                                                                  | Required                            |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `size`   | `number[3]` | Full width, height and depth in metres of the climbable box, centred on the node, in the node's local space. | No, default: the node's mesh bounds |

A node with neither a `size` nor a mesh is ignored (with a console warning).
