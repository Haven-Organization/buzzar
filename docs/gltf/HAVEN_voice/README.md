# HAVEN_voice

## Contributors

- Buzzar contributors

## Status

Experimental (Buzzar)

## Dependencies

Written against the glTF 2.0 spec.

## Overview

This extension sets how far voices carry in a world. Voices are spatial: full volume within 2 metres, then falling off fast (with the default 25 m range: about 40% at 10 m, 20% at 15 m, 6% at 20 m) and silent at `range`. Groups a little way apart can talk without hearing each other. Past that you don't hear someone at all, and in a LiveKit world call their voice isn't even downloaded, so crowded worlds stay light. Movement is still received from everyone.

People standing in a stage area ([HAVEN_voice_zone](../HAVEN_voice_zone/README.md)) are heard by everyone regardless of range.

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
      "HAVEN_voice": { "range": 20 }
    }
  }
]
```

| Property | Type     | Description                                      | Default |
| -------- | -------- | ------------------------------------------------ | ------- |
| `range`  | `number` | Metres at which voices fall silent (at least 5). | `25`    |
