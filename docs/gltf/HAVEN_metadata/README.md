# HAVEN_metadata

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec. Used on avatar and Item files; worlds can carry it too.

## Overview

This extension says what a file is and where it came from: its name, a description, its author, a link to its source and its version. Buzzar shows these wherever the file appears, for example on the tile when someone posts it in chat, so people can see what an avatar or Item is and credit its maker.

When a field is missing, Buzzar falls back to what the file already says elsewhere:

- **VRM 1.0 `meta`:** `name`, `authors`, `version`.
- **VRM 0.x `meta`:** `title`, `author`, `version`, `reference`.
- **`asset.extras`:** the `title`, `author` and `source` that Sketchfab and other exporters write.

## glTF Schema Updates

```json
"extensionsUsed": ["HAVEN_metadata"],
"extensions": {
  "HAVEN_metadata": {
    "name": "Trampoline",
    "description": "A 3 m trampoline.\nLand on it to bounce; hold jump to go higher, crouch to stop.",
    "author": "1-3D.com, adapted by Buzzar",
    "sourceUrl": "https://sketchfab.com/3d-models/trampoline-052aaef6c5c34c5bac94607bcc12d2f9",
    "version": "1.1"
  }
}
```

The extension sits on the glTF root.

| Property      | Type     | Description                                                                                                                       |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string` | What it's called (up to 200 characters).                                                                                          |
| `description` | `string` | What it is and how to use it. Can span several lines (`\n`); line breaks are kept when shown. Up to 10,000 characters.            |
| `author`      | `string` | Who made it, or who made it and who adapted it.                                                                                   |
| `sourceUrl`   | `string` | An `https://` or `http://` page for it: the original listing, the author's page or a download page. Other links are ignored.      |
| `version`     | `string` | Any version label, such as `1`, `1.2.0` or `2026-11-18`. Bump it when you change the file.                                        |
| `controls`    | `array`  | Items only: what each input does with it while held, shown for a few seconds when someone picks it up. See [controls](#controls). |

Every field is optional. For licences, keep using `asset.copyright` (and VRM's own licence fields).

### controls

An Item lists its controls by **action**, not by key, so every client shows its own bindings:

```json
"controls": [
  { "action": "use", "label": "Spray (hold)" },
  { "action": "secondary", "label": "Pump to refill" },
  { "action": "drop", "label": "Put down" }
]
```

| `action`    | In Buzzar               |
| ----------- | ----------------------- |
| `use`       | Left click (gamepad RT) |
| `secondary` | Right click (gamepad X) |
| `drop`      | E (gamepad RB)          |
| `throw`     | Right click (gamepad X) |
| `rotate`    | R: turn what you hold   |

`label` (up to 80 characters) says what that input does with this Item. Unknown actions are skipped, and at most 8 controls are shown. Keep controls out of `description`: Buzzar shows them in a card when you pick the Item up.
