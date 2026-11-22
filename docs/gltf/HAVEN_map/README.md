# HAVEN_map

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension gives a world its own map picture: a top-down image of the world that Buzzar shows when someone presses O, with a dot for everyone in the world and an arrow for themselves.

Use it for a hand-drawn or stylised map. Without it, a world's creator can generate a map in World Settings → Map, which draws the world from straight above. A world file's own map takes priority over a generated one.

The extension goes on the glTF root. It names one of the file's images and the ground area the image covers:

- The image's top edge is north (-Z), its right edge east (+X), the same convention as `MX_spawn_point` and the player rig.
- `min` is the `[x, z]` world position, in metres, of the image's top-left corner. `max` is the position of its bottom-right corner.
- The image is stretched to that area. Give it the same aspect ratio as the area, so it isn't distorted.

The image can be embedded (`bufferView` and `mimeType`) or referenced by `uri`. PNG, JPEG and WebP all work. It is only used for the map: it doesn't need to be used by any material.

Keep the image small: up to 2048 pixels on its longer side is plenty.

Buzzar's `scripts/buzzar/bake-gltf.ts` can add one to a `.glb`: `--map picture.webp --map-min x,z --map-max x,z`. A picture generated in World Settings → Map works for this.

## glTF Schema Updates

```json
{
  "extensionsUsed": ["HAVEN_map"],
  "extensions": {
    "HAVEN_map": {
      "image": 3,
      "min": [-40, -25],
      "max": [40, 25]
    }
  }
}
```

### Properties

| Property | Type        | Description                                                                         | Required |
| -------- | ----------- | ----------------------------------------------------------------------------------- | -------- |
| `image`  | `integer`   | Index of the map picture in `images`.                                               | Yes      |
| `min`    | `number[2]` | `[x, z]` world position (metres) of the picture's top-left (north-west) corner.     | Yes      |
| `max`    | `number[2]` | `[x, z]` world position (metres) of the picture's bottom-right (south-east) corner. | Yes      |

`max` must be greater than `min` on both axes, or the extension is ignored.

## Known Implementations

- Buzzar
