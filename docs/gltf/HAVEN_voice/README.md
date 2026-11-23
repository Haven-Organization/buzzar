# HAVEN_voice

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension sets how voices carry in a world. It follows VRChat's per-player voice settings (their Udon "Player Audio" page), with the same defaults where those are documented:

- **Far** (`range`): voices fall silent at this distance. Default 25 m, VRChat's default. Past it, in a LiveKit world call, the voice isn't even downloaded, so crowded worlds stay light. Movement is still received from everyone.
- **Near** (`near`): full volume within this distance. Default 0, as VRChat recommends for realistic, well-placed voices.
- **Falloff:** between near and far the volume drops fast (with the defaults: about 36% at 10 m, 16% at 15 m, 4% at 20 m), so groups a little way apart can talk without hearing each other. VRChat doesn't document its curve; this one is Buzzar's.
- **Muffling** (`lowpass`): distant voices are low-pass filtered, more the further they are, which makes nearby speech easier to pick out in a busy world. On by default; turn it off for worlds where voices should stay clear at any distance.
- **Gain** (`gain`): in decibels, relative to normal.

World scripts can change these for a particular player with `peer.setVoice({ gain, near, far, lowpass })` and undo it with `peer.resetVoice()`, like VRChat's `SetVoice*` calls; a script's settings win over the world's and zones'. A voice always comes from where the speaker stands. People in a [HAVEN_voice_zone](../HAVEN_voice_zone/README.md) get that zone's settings instead; a stage zone is heard by everyone.

World sounds are separate: a [KHR_audio](https://github.com/KhronosGroup/glTF/pull/2137) emitter is `"global"` (heard the same everywhere) or `"positional"` (from a place, with its own distance settings).

## glTF Schema Updates

Usage of the extension must be listed in the `extensionsUsed` array:

```json
"extensionsUsed": [
  "HAVEN_voice"
]
```

The `HAVEN_voice` extension is added to the world's `scene`:

```json
"scenes": [
  {
    "nodes": [0],
    "extensions": {
      "HAVEN_voice": { "range": 20, "lowpass": true }
    }
  }
]
```

| Property  | Type      | Description                                      | Default |
| --------- | --------- | ------------------------------------------------ | ------- |
| `range`   | `number`  | Metres at which voices fall silent (at least 3). | `25`    |
| `near`    | `number`  | Metres within which voices are at full volume.   | `0`     |
| `lowpass` | `boolean` | Whether distance muffles voices.                 | `true`  |
| `gain`    | `number`  | Decibels relative to normal (−40 to +12).        | `0`     |
