# HAVEN_avatar_pedestal

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension marks a node as an avatar pedestal, similar to VRChat's avatar pedestals: a spot in the world that shows an avatar and lets visitors wear it.

The node marks the spot the avatar stands on (typically the top of a modeled podium), and the avatar faces the node's local +Z axis. The node does not need a mesh; the podium is modeled separately.

Buzzar adds, as children of the node:

- A live, idle-animated 3D preview of the avatar, scaled so it is `previewHeight` tall (unless `preview` says otherwise).
- An info panel 0.9 by 0.5 meters, 0.2 meters above the top of the preview, showing the picture (if `image` is set), the avatar's name, author, license and description, and the line "Click the avatar to wear it".
- A clickable box 0.9 meters wide and 0.7 meters deep that covers both the preview and the panel.

Clicking the pedestal switches the clicking user's avatar. Like VRChat, the choice is saved as the user's Matrix profile avatar, so it applies in every world, and any world-specific avatar the user set for the current world is cleared. Other users see the change when their cached copy of the profile expires.

## Avatar URIs

`avatar.uri` accepts these forms:

| Form                  | Example                    | Behavior                                                                                                                                                                                                                                                                                                              |
| --------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omitted               |                            | The built-in default avatar. Wearing it clears the user's profile avatar.                                                                                                                                                                                                                                             |
| `mxc://`              | `mxc://example.org/AbCdEf` | An avatar uploaded to Matrix. Loaded through the user's homeserver; wearing it saves this URI as the profile avatar.                                                                                                                                                                                                  |
| `buzzar-builtin:<id>` | `buzzar-builtin:devil`     | An avatar bundled with Buzzar, so a world works on any homeserver without uploading avatars alongside it. Current ids: `devil` (Devil, Polygonal Mind, CC0) and `rose` (Rose, Polygonal Mind, CC0). Wearing it first uploads it to the wearer's own homeserver, then saves it as an ordinary `mxc://` profile avatar. |
| Relative path         | `avatars/robot.vrm`        | Resolved against the glTF file's URL and allowed only if it stays on the same origin. Intended for local files and the dev viewer. Since it is not on a homeserver, wearing it applies only on the local client and is not saved or seen by others.                                                                   |

Any other absolute URI (`http:`, `https:`, `data:`, and so on), and any unknown `buzzar-builtin:` id, is refused so a world cannot make visitors fetch from third-party servers. A refused URI logs a warning and shows no 3D preview; the info panel and clickable box are still created.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_avatar_pedestal"
]
```

The `HAVEN_avatar_pedestal` extension can be added to any `node`.

```json
"nodes": [
  {
    "name": "Pedestal Devil",
    "translation": [4.5, 0.3, 0],
    "rotation": [0, -0.7071068, 0, 0.7071068],
    "extensions": {
      "HAVEN_avatar_pedestal": {
        "avatar": {
          "uri": "buzzar-builtin:devil",
          "name": "Devil",
          "author": "Polygonal Mind",
          "license": "CC0 1.0",
          "description": "100 Avatars #031"
        },
        "image": 0,
        "previewHeight": 1.2
      }
    }
  }
]
```

| Property        | Type      | Description                                                                                                                                                      | Required                                        |
| --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `avatar`        | `object`  | The avatar this pedestal offers. See below.                                                                                                                      | No, default: `{}` (the built-in default avatar) |
| `preview`       | `string`  | `"model"` shows the live 3D preview. `"image"` hides it and shows the picture at a larger size (264 instead of 160 panel pixels). `"none"` hides the 3D preview. | No, default: `"model"`                          |
| `image`         | `integer` | Index into the glTF `images` array of a picture shown on the info panel.                                                                                         | No                                              |
| `previewHeight` | `number`  | Height in meters of the 3D preview. It also sets how high the info panel sits.                                                                                   | No, default: `1.2`                              |

`avatar` properties:

| Property      | Type     | Description                                                       | Required                                                              |
| ------------- | -------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `uri`         | `string` | The avatar to offer. See [Avatar URIs](#avatar-uris).             | No, default: the built-in default avatar                              |
| `name`        | `string` | Display name, shown on the panel and used for the clickable node. | No, default: `"Avatar"` if `uri` is set, otherwise `"Default Avatar"` |
| `author`      | `string` | Shown on the panel as "by &lt;author&gt;".                        | No                                                                    |
| `license`     | `string` | Shown on the panel as "License: &lt;license&gt;".                 | No                                                                    |
| `description` | `string` | Shown on the panel.                                               | No                                                                    |

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "HAVEN_avatar_pedestal",
  "type": "object",
  "description": "An avatar pedestal. The node marks where the avatar stands; it faces local +Z.",
  "properties": {
    "avatar": {
      "type": "object",
      "properties": {
        "uri": {
          "type": "string",
          "description": "mxc:// URI, buzzar-builtin:<id>, or a path relative to the glTF file. Omit for the built-in default avatar."
        },
        "name": { "type": "string" },
        "author": { "type": "string" },
        "license": { "type": "string" },
        "description": { "type": "string" }
      }
    },
    "preview": {
      "type": "string",
      "enum": ["model", "image", "none"],
      "default": "model"
    },
    "image": {
      "type": "integer",
      "description": "Index into the glTF images array.",
      "minimum": 0
    },
    "previewHeight": {
      "type": "number",
      "description": "Height in meters of the 3D preview.",
      "exclusiveMinimum": 0,
      "default": 1.2
    },
    "extensions": {},
    "extras": {}
  }
}
```

## Authoring with extras

Some tools drop extensions they do not know (gltf-transform, for one), and authoring tools such as Blender export custom properties as node `extras`. Buzzar's `scripts/buzzar/finish-world.mjs` promotes any node `extras` key starting with `HAVEN_`, `MX_` or `OMI_` to a real extension and adds it to `extensionsUsed`. So a Blender custom property `HAVEN_avatar_pedestal` with a JSON object value becomes this extension once the file goes through `finish-world.mjs`. An `image` index must point at the right entry in the final file. Buzzar's loader itself only reads `extensions`, not `extras`.

## Compatibility

Third Room and other clients that do not know this extension ignore it. The node loads as a plain node: no preview, panel or clickable box appears, and only the separately modeled podium (if any) is visible. An image referenced only by `image` is not displayed. Do not list `HAVEN_avatar_pedestal` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/avatar-pedestals/pedestals.game.ts`; wearing is handled in `src/engine/avatar/avatar.main.ts`; built-in avatars are listed in `src/engine/avatar/avatar.common.ts`). Example scenes: `scripts/buzzar/home/compose-home.mjs` (default, Devil and Rose pedestals using `buzzar-builtin:`) and `scripts/buzzar/make-mirror-test-scene.mjs` (pedestals with pictures).
