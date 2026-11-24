# HAVEN_screen

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks a node as a screen that players can share their computer screen onto, like a cinema screen, a meeting-room display or a TV. When someone shares their screen in Buzzar, they choose either a floating screen in front of them or one of the world's screens by name.

- The picture is fitted inside the screen's area keeping its own shape, centred on the node and facing the node's +Z axis. It is drawn a centimetre in front of the node, so it covers the world's own screen surface (a blank panel, for example).
- If two people pick the same screen, the newer one shows. The other's screen comes back when the newer one stops sharing.
- Screen sharing goes through the world's LiveKit call (World Settings → Calls). Players in a peer-to-peer call don't see shared screens.
- Who may share at all is a world setting (World Settings → Calls → Who Can Share Their Screen: everyone, moderators only or nobody). Every player's Buzzar applies it, hiding screens from people it doesn't allow.

The node isn't changed or hidden; it only says where shared pictures may go. Scaling the node scales its screen.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_screen"
]
```

The `HAVEN_screen` extension can be added to any `node`:

```json
"nodes": [
  {
    "name": "Cinema Screen",
    "translation": [0, 3, -15],
    "extensions": {
      "HAVEN_screen": { "name": "Cinema", "size": [8, 4.5] }
    }
  }
]
```

| Property | Type        | Description                                                                         | Default                    |
| -------- | ----------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `name`   | `string`    | The name players pick the screen by. Names are made unique by numbering duplicates. | The node's name            |
| `size`   | `number[2]` | Width and height in metres along the node's X and Y, centred on the node.           | The node's mesh X×Y bounds |

A node needs a `size` or a mesh; otherwise it is ignored with a warning.
