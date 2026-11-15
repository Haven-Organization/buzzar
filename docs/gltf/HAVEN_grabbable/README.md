# HAVEN_grabbable

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks a mesh node as an object that anyone in the world can pick up, like Buzzar's spawnable props but placed into the scene by the world author (a cup on a table, a rock by a campfire).

The node must have a `mesh`. Its collider is generated from the convex hull of that mesh; Buzzar does not give it the default triangle-mesh collider that other scene meshes get.

Behavior in Buzzar:

- Every client loads the scene copy: a kinematic, grabbable object that stays where the author placed it until someone picks it up.
- The first grab replaces the scene copy with a networked copy owned by the person who grabbed it, in the same place. The networked copy is a dynamic rigid body, so it falls and collides once let go.
- Creating any networked copy (locally, or when a peer's copy arrives, including for people who join later) hides the scene copy and disables its physics, so there is only ever one of each object.
- Later grabs use Buzzar's normal ownership hand-over between networked copies.
- If no networked copy is left for 1.5 seconds (for example its owner left the world), the scene copy reappears at its original position.

Networked copies are matched across clients by the glTF node index, so all clients must load the same scene file.

The networked copy is created at the world root with the node's world scale, and it contains only the node's own mesh. Children of the grabbable node are not part of the picked-up object. Keep grabbables as top-level nodes with the mesh on the node itself.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_grabbable"
]
```

The `HAVEN_grabbable` extension can be added to any `node` that has a `mesh`. On a node without a mesh, Buzzar ignores it and logs a warning.

```json
"nodes": [
  {
    "name": "Mug",
    "mesh": 4,
    "translation": [0.42, 0.51, -0.3],
    "extensions": {
      "HAVEN_grabbable": {}
    }
  }
]
```

The extension has no properties. Its value is an empty object.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "HAVEN_grabbable",
  "type": "object",
  "description": "Marks a mesh node as an object anyone can pick up. Has no properties.",
  "properties": {
    "extensions": {},
    "extras": {}
  },
  "additionalProperties": false
}
```

## Authoring with extras

Some tools drop extensions they do not know (gltf-transform, for one), and authoring tools such as Blender export custom properties as node `extras`. Buzzar's `scripts/buzzar/finish-world.mjs` promotes any node `extras` key starting with `HAVEN_`, `MX_` or `OMI_` to a real extension and adds it to `extensionsUsed`. So a Blender custom property `HAVEN_grabbable` with the value `{}` becomes this extension once the file goes through `finish-world.mjs`. Buzzar's loader itself only reads `extensions`, not `extras`.

## Compatibility

Third Room and other clients that do not know this extension ignore it. The node loads as ordinary static scenery: it is drawn where it was placed and, like any other scene mesh, gets the default triangle-mesh collider (unless the file uses `OMI_collider`, in which case only explicit colliders exist). Nobody can pick it up. Do not list `HAVEN_grabbable` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/scene-grabbables/grabbables.game.ts`, with the ownership hook in `src/engine/network/ownership.game.ts`). Example scenes: `scripts/buzzar/make-living-room-world.mjs` (two coffee mugs) and `scripts/buzzar/home/compose-home.mjs` (rocks, tagged through `extras`).
