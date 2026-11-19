# HAVEN_mirror

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension turns a node into a planar mirror.

The reflective plane lies in the node's local XY plane, centered on the node's origin, and faces the node's local +Z axis. The node does not need a mesh; a mirror is usually an empty node placed just in front of a modeled frame.

A mirror has three states:

| State    | Meaning                                                       |
| -------- | ------------------------------------------------------------- |
| `"off"`  | No reflection is rendered.                                    |
| `"low"`  | Reflects avatars only, over a solid `backgroundColor`. Cheap. |
| `"high"` | Reflects everything.                                          |

Mirror state is local to each user, following VRChat's convention: turning a mirror on or off never changes it for anyone else. Pressing the mirror surface (unless `clickToToggle` is `false`) or one of its toggle nodes cycles the state Off, High, Low, Off. Pressing one of its state buttons sets that state directly.

A mirror can be controlled either way, or both. A mirror you face on arrival (as in Buzzar's Home World) reads better with `clickToToggle: false` and a High / Low / Off button panel beside it: otherwise the "Interact" prompt sits in the middle of your view as you arrive.

Each client also has a quality cap (for example on low-end devices). A mirror never renders above the cap; the cycle skips states above it, and the `defaultState` is clamped to it.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_mirror"
]
```

The `HAVEN_mirror` extension can be added to any `node`.

```json
"nodes": [
  {
    "name": "BackMirrorToggle",
    "mesh": 2,
    "translation": [2.1, 1.2, -5.9]
  },
  {
    "name": "BackMirror",
    "translation": [0, 1.6, -5.88],
    "extensions": {
      "HAVEN_mirror": {
        "size": [3, 2],
        "defaultState": "high",
        "toggles": [0]
      }
    }
  }
]
```

| Property          | Type        | Description                                                                                                            | Required                        |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `size`            | `number[2]` | Width and height in meters of the reflective plane in the node's local XY plane.                                       | No, default: `[1, 1]`           |
| `defaultState`    | `string`    | State when the world loads: `"off"`, `"low"` or `"high"` (case-insensitive). Unrecognized values fall back to `"off"`. | No, default: `"off"`            |
| `resolutionScale` | `number`    | Multiplier on the viewport resolution for the reflection render target.                                                | No, default: `1`                |
| `maxDistance`     | `number`    | The reflection is not rendered when the viewer is farther than this many meters away.                                  | No, default: `30`               |
| `backgroundColor` | `number[3]` | Linear RGB background used by `"low"` (avatars-only) reflections.                                                      | No, default: `[0.1, 0.1, 0.12]` |
| `toggles`         | `integer[]` | Indices of nodes that act as toggle buttons for this mirror.                                                           | No, default: none               |
| `clickToToggle`   | `boolean`   | Whether pressing the mirror surface itself cycles its state.                                                           | No, default: `true`             |
| `buttons`         | `object`    | State buttons: `{"high": [nodes], "low": [nodes], "off": [nodes]}`. Pressing one sets the mirror to that state.        | No, default: none               |

### Toggle nodes

Each entry in `toggles` is a glTF node index in the same file. A toggle node needs a mesh or an explicit collider (for example `OMI_collider`) to be pressable. Buzzar gives it a static physics body and makes it interactable; if it has no collider of its own, Buzzar gives it a box centred on the node's origin that holds its whole mesh. A toggle node with neither is logged as a warning and cannot be pressed. One node can toggle several mirrors, and pressing it cycles each of them.

Prefer a mesh over `OMI_collider` for these nodes. In Buzzar, as in Third Room, a file that lists `OMI_collider` in `extensionsUsed` is taken to declare all of its own collision, so no collision is generated for its other meshes: adding one collider for a button makes the rest of the scene, the ground included, walk-through.

### State buttons

Each key of `buttons` is a state (`"off"`, `"low"` or `"high"`, case-insensitive; other keys are ignored) and each value is a list of glTF node indices in the same file. Pressing one of those nodes sets the mirror to that state, clamped to the client's quality cap. Like toggle nodes, a button node needs a mesh or an explicit collider. The interaction prompt shows the node's name, so name buttons for what they do (Buzzar's Home World uses "Mirror: High", "Mirror: Low" and "Mirror: Off").

The button for the mirror's current state is highlighted: its materials glow in their own base colour, and the other buttons' materials are dimmed to 40%. Give each button its own materials, since a material shared between buttons can only show one of those looks.

```json
"HAVEN_mirror": {
  "size": [3, 2],
  "defaultState": "high",
  "clickToToggle": false,
  "buttons": { "high": [148], "low": [149], "off": [150] }
}
```

### Clicking the mirror surface

When `clickToToggle` is not `false`, Buzzar gives the mirror node a box collider of `size` by 0.02 m (unless the node already has a collider) and a static physics body. This box is solid, not a sensor.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "HAVEN_mirror",
  "type": "object",
  "description": "A planar mirror in the node's local XY plane, facing local +Z.",
  "properties": {
    "size": {
      "type": "array",
      "description": "Width and height in meters of the reflective plane.",
      "items": { "type": "number", "exclusiveMinimum": 0 },
      "minItems": 2,
      "maxItems": 2,
      "default": [1, 1]
    },
    "defaultState": {
      "type": "string",
      "description": "State when the world loads. Matched case-insensitively.",
      "enum": ["off", "low", "high"],
      "default": "off"
    },
    "resolutionScale": {
      "type": "number",
      "description": "Multiplier on the viewport resolution for the reflection.",
      "exclusiveMinimum": 0,
      "default": 1
    },
    "maxDistance": {
      "type": "number",
      "description": "Distance in meters beyond which the reflection is not rendered.",
      "exclusiveMinimum": 0,
      "default": 30
    },
    "backgroundColor": {
      "type": "array",
      "description": "Linear RGB background for low (avatars-only) reflections.",
      "items": { "type": "number", "minimum": 0, "maximum": 1 },
      "minItems": 3,
      "maxItems": 3,
      "default": [0.1, 0.1, 0.12]
    },
    "toggles": {
      "type": "array",
      "description": "Indices of nodes that act as toggle buttons for this mirror. Each needs a mesh or a collider.",
      "items": { "type": "integer", "minimum": 0 }
    },
    "clickToToggle": {
      "type": "boolean",
      "description": "Whether pressing the mirror surface toggles it.",
      "default": true
    },
    "buttons": {
      "type": "object",
      "description": "Node indices of state buttons, by the state each sets. Each needs a mesh or a collider.",
      "properties": {
        "off": { "type": "array", "items": { "type": "integer", "minimum": 0 } },
        "low": { "type": "array", "items": { "type": "integer", "minimum": 0 } },
        "high": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
      }
    },
    "extensions": {},
    "extras": {}
  }
}
```

## Hubs mirrors

Buzzar also loads the Hubs mirror component (`MOZ_hubs_components.mirror`) as a mirror with `defaultState` `"high"` and every other property at its default, including a 1 by 1 meter plane. If a node has both, `HAVEN_mirror` wins.

## Authoring with extras

Some tools drop extensions they do not know (gltf-transform, for one), and authoring tools such as Blender export custom properties as node `extras`. Buzzar's `scripts/buzzar/finish-world.mjs` promotes any node `extras` key starting with `HAVEN_`, `MX_` or `OMI_` to a real extension and adds it to `extensionsUsed`. So a Blender custom property `HAVEN_mirror` with the value `{"size": [3, 2]}` becomes this extension once the file goes through `finish-world.mjs`. Node indices in `toggles` and `buttons` must be correct in the final file, so set them after any step that reorders nodes. Buzzar's loader itself only reads `extensions`, not `extras`.

## Compatibility

Third Room and other clients that do not know this extension ignore it. The node loads as a plain node: an empty mirror node shows nothing (the modeled frame, if any, is still drawn), and toggle and button nodes are inert scenery. Do not list `HAVEN_mirror` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/mirrors/mirrors.game.ts`, loaded from `src/engine/gltf/gltf.game.ts`). Example scenes: `scripts/buzzar/make-mirror-test-scene.mjs` (one mirror with a separate toggle button, one without) and `scripts/buzzar/home/compose-home.mjs` with `add-mirror-buttons.py` (High / Low / Off buttons, surface not pressable).
