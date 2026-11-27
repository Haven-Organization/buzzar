# HAVEN_thing

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension says how a Thing (an object people spawn, grab and throw) behaves physically: its collision shape, how heavy it is, whether it can tip over, and where it appears when someone spawns it. The behaviour travels with the file, so it isn't hard-coded in a client.

Buzzar's stock Trampoline uses it: a heavy drum that only turns about the vertical, so it always stands flat and nothing tips it over, and it appears a little way off so it doesn't land on you.

Buzzar keeps its own values for each stock Thing as a fallback, used until the file has loaded and for any property the file leaves out or gets wrong.

Your own Things (a `.glb` you upload or bookmark in **Things**) work the same way. Without `HAVEN_thing`, Buzzar fits a box collider around the file's scene and spawns it just clear of you. Your Buzzar loads the file before spawning it, so it has its own shape from the start. Other players' Buzzar loads it when the object arrives: it starts as a small box and takes the file's collider once the file has loaded. Each client also checks the file's behaviours (like `HAVEN_trampoline`) against the world's Things rules as it loads.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_thing"
]
```

`HAVEN_thing` goes in the glTF root's `extensions`. It describes the whole file, placed with its origin on the floor.

```json
"extensions": {
  "HAVEN_thing": {
    "collider": { "type": "cylinder", "radius": 1.5, "height": 0.53, "offset": [0, 0.265, 0] },
    "density": 40,
    "rotation": "yaw",
    "upright": true,
    "spawn": { "distance": 2.4, "upright": true }
  }
}
```

| Property   | Type      | Description                                                                                                                                                                                                                                | Default                              |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `collider` | `object`  | The collision shape (below).                                                                                                                                                                                                               | The client's own                     |
| `density`  | `number`  | Kilograms per cubic metre of the collider, which sets its weight.                                                                                                                                                                          | The client's own                     |
| `rotation` | `string`  | `"free"`: turns any way. `"yaw"`: only turns about the vertical, so it can't tip over.                                                                                                                                                     | `"free"`                             |
| `upright`  | `boolean` | When held, it only turns to face the way you face, and when left tilted it settles back level.                                                                                                                                             | `false`                              |
| `spawn`    | `object`  | `{ "distance": metres, "upright": boolean, "held": boolean }`: how far in front of you it appears, whether it's stood level facing the way you look, and whether it appears in your hold (for things you carry) instead of being set down. | 1 m, tilted like your hand, not held |

### spawn.held

A Thing with `"held": true` appears where held things sit (1.5 m in front of you), already in your hold, as if you had just grabbed it. That way a hand-held Thing doesn't have to be picked up off the floor. When you're already holding something, or in VR (where controllers hold with squeeze), it's set down as usual. **Upload Thing → Appears in Your Hold** writes this into the file.

### hold

How your avatar holds the Thing in its hands. Without it, a held Thing floats in front of you. With it, Buzzar places the Thing for your pose, and turns your arms (two-bone IK), wrists and fingers so your hands sit on its grips. Everyone else sees your avatar holding it.

```json
"hold": {
  "pose": "aim",
  "hand": "right",
  "grip": { "position": [0.022, 0, 0], "rotation": [-0.2207, 0, 0, 0.9753], "trigger": { "position": [0, 0.035, -0.072], "pull": 10 } },
  "offhand": { "position": [-0.03, 0.045, -0.206], "rotation": [-0.5964, -0.3799, 0.3799, 0.5964], "curl": 40 },
  "curl": 75
}
```

| Property  | Type     | Description                                                                                                                                                               | Default                                         |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `pose`    | `string` | `"aim"`: held out from your shoulder and pointed where you look (a gun's aim follows your crosshair). `"hand"`: carried in your hand, swinging with your arm as you walk. | `"aim"`                                         |
| `hand`    | `string` | `"right"` or `"left"`: the hand on `grip`.                                                                                                                                | `"right"`                                       |
| `grip`    | `object` | Where that hand holds it: a hand frame (below). Required.                                                                                                                 |                                                 |
| `offhand` | `object` | Where the other hand holds it, for two-handed Things. Leave it out for one hand.                                                                                          | none                                            |
| `curl`    | `number` | Degrees the fingers curl round the grip (the thumb half as much), 0–120. `grip` and `offhand` can each give their own `curl`, and a `trigger` (below).                    | 70                                              |
| `aim`     | `object` | `{ "position", "direction" }`: what points where you look in the `"aim"` pose.                                                                                            | a HAVEN_sprayer's nozzle, else -Z from the grip |

A **hand frame** is `{ "position": [x, y, z], "rotation": [x, y, z, w] }` in the Thing's space. Picture a hand held out for a handshake, with:

- the palm's centre at `position`;
- the fingers pointing along -Z;
- the thumb up (+Y);
- the palm facing the other hand: -X for a right hand, +X for a left.

`rotation` turns that hand onto the grip. A vertical handle held in a fist runs along +Y through the curled fingers, so a pistol grip is a handshake frame tilted to match the handle. A hand on a forend or pump handle holds it like a shotgun's: palm underneath, fingers across under it and up its far side, thumb along the near side pointing forward. For the left hand that maps the handshake frame's fingers (−Z) to +X, its thumb (+Y) to −Z and its palm (+X) to +Y, `[-0.5, -0.5, 0.5, 0.5]`; the water gun tilts that 25° so the palm faces up and a little outward. A slim handle needs less `curl` than a pistol grip, or the fingertips come over the top.

A hand frame can also have a `trigger`: `{ "position": [0, 0.035, -0.072], "pull": 10 }` puts that hand's index finger on a trigger instead of round the grip. `position` is where the finger's pad touches the trigger, in the Thing's space; Buzzar turns and curls the finger to reach it, so it fits any hand. While the Thing is in use, such as a water gun spraying, the finger curls `pull` degrees further (default 10). Put the trigger about a finger's length in front of where the index knuckle sits: much closer and the finger can't curl onto it.

An aimed Thing is held out from your shoulder, but never further than your other hand can reach its `offhand` grip: a long Thing comes back towards you until that arm reaches with its elbow a little bent.

In VR, your controllers are your hands, so `hold` isn't used there.

### collider

| `type`       | Properties                                          |
| ------------ | --------------------------------------------------- |
| `"box"`      | `size`: `[x, y, z]` in metres                       |
| `"sphere"`   | `radius`                                            |
| `"cylinder"` | `radius`, `height` (along the Thing's vertical, +Y) |

Every collider can have an `offset` (`[x, y, z]`, metres) from the Thing's origin to the shape's centre. A Thing whose origin is on its base usually needs half its height here. A collider with a missing or non-positive size is ignored.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "HAVEN_thing",
  "type": "object",
  "properties": {
    "collider": {
      "type": "object",
      "properties": {
        "type": { "enum": ["box", "sphere", "cylinder"] },
        "size": { "type": "array", "items": { "type": "number", "exclusiveMinimum": 0 }, "minItems": 3, "maxItems": 3 },
        "radius": { "type": "number", "exclusiveMinimum": 0 },
        "height": { "type": "number", "exclusiveMinimum": 0 },
        "offset": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 }
      },
      "required": ["type"]
    },
    "density": { "type": "number", "exclusiveMinimum": 0 },
    "rotation": { "enum": ["free", "yaw"] },
    "upright": { "type": "boolean" },
    "spawn": {
      "type": "object",
      "properties": {
        "distance": { "type": "number", "exclusiveMinimum": 0 },
        "upright": { "type": "boolean" },
        "held": { "type": "boolean" }
      }
    },
    "extensions": {},
    "extras": {}
  }
}
```

## Compatibility

Clients that don't know this extension ignore it and give the Thing their own physics, if any. Don't list `HAVEN_thing` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/spawnables/thingFile.ts`, used by `spawnables.game.ts`). Example: `public/gltf/things/trampoline.glb`, made by `scripts/buzzar/make-trampoline-thing.py`.
