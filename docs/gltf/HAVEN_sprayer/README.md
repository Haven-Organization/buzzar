# HAVEN_sprayer

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec. Sounds use [KHR_audio](https://github.com/KhronosGroup/glTF/pull/2137) sources in the same file.

## Overview

This extension makes a Thing spray a liquid when you hold it: a water gun, a spray bottle, a hose. It says where the nozzle is, how the stream flies, how much a full tank holds, how pumping refills it, and which sounds play.

While you hold a sprayer:

- **Hold left click** (gamepad RT) to spray. With a `start` sound, that plays once and the `spray` loop carries on from where it leaves off. The stream drains the tank and stops when the tank is empty.
- **Right click** (gamepad X) works the pump, and so does **left click** once the tank is empty. The pump sound plays, the hand on the pump (the [hold](../HAVEN_thing/README.md)'s `offhand`) slides it back and forward again (`pumpStroke`), and when the stroke is done the tank has `refill` seconds more. You can't spray mid-stroke.
- **E** (gamepad RB) puts it down. A sprayer can't be thrown.

Whoever holds a sprayer tells everyone else when it starts and stops spraying and when it's pumped. Every client draws the stream from the Thing's nozzle and plays the sounds there. The tank itself is only kept by its holder.

The stream is drawn as one unbroken jet: each drop draws a tube to the drop fired after it, and the newest one to the nozzle. Each drop falls under gravity, so the jet arcs; it thickens as it goes, sways a little within `spread`, and ends where it hits anything solid (players excepted). Where it hits a loose object (a ball, a crate), it pushes it with `force`: light things are swept along, heavy ones hardly move.

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_sprayer"
]
```

`HAVEN_sprayer` goes in the glTF root's `extensions`. Positions and directions are in the file's scene space, the same space as [HAVEN_thing](../HAVEN_thing/README.md).

```json
"extensions": {
  "HAVEN_sprayer": {
    "nozzle": { "position": [0, 0.1, -0.394], "direction": [0, 0, -1] },
    "speed": 10,
    "spread": 1.2,
    "rate": 80,
    "dropSize": 0.018,
    "color": [0.62, 0.83, 1, 0.6],
    "capacity": 6,
    "refill": 6,
    "pumpTime": 2.05,
    "pumpStroke": { "offset": [0, 0, 0.04], "node": "Pump" },
    "force": 4,
    "sounds": { "spray": 0, "pump": 1 }
  }
}
```

| Property      | Type       | Description                                                                                                                                                                                                                                                       | Default                                    |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `nozzle`      | `object`   | `position`: where the stream leaves (metres). `direction`: which way it leaves.                                                                                                                                                                                   | origin, `[0, 0, -1]`                       |
| `speed`       | `number`   | Metres per second the stream leaves at (0.5–50).                                                                                                                                                                                                                  | 9                                          |
| `spread`      | `number`   | How much the stream wanders, in degrees (0–45).                                                                                                                                                                                                                   | 1.5                                        |
| `rate`        | `number`   | Drops per second (1–120): how solid the stream looks.                                                                                                                                                                                                             | 70                                         |
| `dropSize`    | `number`   | Drop radius in metres.                                                                                                                                                                                                                                            | 0.025                                      |
| `color`       | `number[]` | RGBA of the liquid (0–1). Alpha below 1 makes it see-through.                                                                                                                                                                                                     | light blue, 0.6                            |
| `capacity`    | `number`   | Seconds of spraying a full tank holds.                                                                                                                                                                                                                            | 5                                          |
| `refill`      | `number`   | Seconds of spraying one pump adds.                                                                                                                                                                                                                                | a full tank                                |
| `pumpTime`    | `number`   | Seconds a pump stroke takes. Match it to the pump sound.                                                                                                                                                                                                          | 1                                          |
| `pumpStroke`  | `object`   | How a pump stroke moves. `offset`: how far the pump handle travels, in metres in the file's scene space (out and back over `pumpTime`). `node`: the name of the node that is the handle, which moves by that much. The hand on the pump moves with it either way. | 7 cm back from `nozzle.direction`, no node |
| `force`       | `number`   | Newtons the whole stream pushes loose objects with (0–100). A 1 kg ball is pushed along at about `force` m/s². 0: it pushes nothing.                                                                                                                              | 4                                          |
| `sounds`      | `object`   | KHR_audio **source** indices: `start` (once, when spraying begins), `spray` (looped while spraying, after `start`), `pump` (each stroke), `empty` (when the tank runs dry). All optional.                                                                         | none                                       |
| `startLength` | `number`   | Seconds into `start` where the `spray` loop takes over. Make `start` a little longer and fade it out, so the two overlap rather than leave a gap.                                                                                                                 | 0                                          |

## Compatibility

Clients that don't know this extension show the Thing as an ordinary object. Don't list `HAVEN_sprayer` in `extensionsRequired`.

## Known Implementations

- Buzzar (`src/plugins/sprayers/`). Example: `scripts/buzzar/make-water-gun-thing.py`, which makes a water gun from a Sketchfab model and two CC0 Freesound recordings.
