# Plan 01: custom avatars + mirrors

Status: draft, 2026-11-13. These are the first two features to ship (user priority).
Checklist refs: §1 Avatars, §2 Mirrors.

## Prerequisite: authenticated media (both features need it)

Uploads made after the 2024 media freeze can only be downloaded via `/_matrix/client/v1/media/download`
with an `Authorization` header. Hydrogen 0.1.2 builds legacy `/_matrix/media/r0/download` URLs
(`src/ui/hooks/useWorldLoader.ts:60`, `src/ui/utils/avatar.ts:68`, …), so **new avatar uploads won't load**.
Older media, like the reference worlds' scenes, still loads.

- [ ] Extend the existing service worker (`sw.ts`, which already intercepts and caches `/_matrix/media/r0/download`):
      rewrite the request to `/_matrix/client/v1/media/download/…` and add `Authorization: Bearer <token>`.
      The page passes the token to the SW over `postMessage`, which is the pattern Element Web uses.
      Fall back to the legacy URL for homeservers without authenticated media (check `/versions` ≥ v1.11).
- [ ] Keep the cache keyed by mxc URI, never by a URL containing the token.

This is a stopgap until the matrix-js-sdk migration (checklist §0), but the SW approach carries over to it.

## A. Custom avatars

### A1. Protocol (pure Matrix, works in existing MSC3815 rooms)

Two places to publish an avatar, both writable by the user themselves at PL 0:

| What | Where | Why |
|---|---|---|
| **Default avatar** (follows you everywhere) | MSC4133 custom profile field `software.haven.world.avatar` (named `software.haven.avatar` until 2026-11-17) | MSC4133 is merged (Jan 2025). matrix.org advertises `m.profile_fields: enabled` (checked 2026-11-13). Anyone can read it via `GET /profile/{user}/software.haven.avatar`. |
| **Per-world choice** (avatar you enter *this* world with / switch to in-world) | Extra key `software.haven.world.avatar` in your own `m.room.member` content in the world room | The server only lets you change your own member event, so it's spoof-proof. Needs no power level, so it **works in the reference worlds as they are today** (their PL map would block a new state event at `state_default: 50`). |

Content (same shape in both places):

```json
{
  "url": "mxc://example.org/abc",          // glb / vrm
  "preview_url": "mxc://example.org/def",  // png thumbnail
  "format": "vrm1" | "vrm0" | "glb",
  "sha256": "…",                            // integrity + cache key
  "stats": { "triangles": 52000, "bones": 74, "texture_bytes": 41943040, "size_bytes": 12000000 }
}
```

Resolution per player: member-event key → profile field → default rig.
`stats` is advisory. Every client recomputes limits on load and never trusts the numbers.

**Caveats to handle:**
- When a user changes their global displayname/avatar, Synapse rewrites member events in every room.
  Check whether it keeps unknown keys; if not, re-apply ours after detecting the change.
- Third Room's old avatar storage (`org.matrix.msc3815.world.profile` in a *private* profile room) was
  never visible to others. Read it only to offer "import my Third Room avatar".

### A2. Loading and rigging

- Formats for v1:
  - **VRM 1.0 + 0.x**: the common export target from Unity (UniVRM), VRoid and Blender, and the realistic way to bring VRChat-style avatars over.
  - **Mixamo-rigged glb**: same skeleton as the built-in `full-animation-rig.glb`, so no retargeting is needed.
- Parse the humanoid bone map from `VRMC_vrm` / `VRM` (0.x) in `src/engine/gltf/gltf.game.ts` (JSON only; we
  don't use three-vrm's GLTFLoader plugin because glTF is loaded into RemoteNodes in the game worker).
- **Retarget the built-in Mixamo locomotion clips** (Idle/Walk/Run/Strafe/Turn/Fall, `animation.game.ts`)
  onto the avatar's humanoid bones. Correct for rest pose (the three-vrm `loadMixamoAnimation` approach), plus
  VRM0's 180° facing and hip-height scaling.
- **Eye height from the avatar:** the camera goes at the head/eye bone (VRM `lookAt` offset), not the fixed 1.7 m.
  Collider height scales with it, clamped. This is the base for the later height-scaling feature (§1).
- First person: hide the head from your own camera with a new render layer
  (`Layer.FirstPersonHidden`, which also lets your mirror reflection show your full body, see B).
  Today the whole local avatar is set `visible = false` (`embodyAvatar.ts`).
- Loading is async: show the default rig (or a "loading" impostor) until the avatar arrives, then swap.

### A3. Safety limits (client-enforced, per viewer)

- Hard caps before parsing: file size (e.g. 50 MB). After load: triangles, bones, materials, texture
  memory, skinned meshes. Anything over the limit falls back to the default rig with a "hidden: too heavy" badge.
- Per-user "show avatar / hide avatar" override (local; later stored in account data).
- No scripts and no audio in avatars in v1 (emotes with audio come later, checklist §1).

### A4. UI

- Avatar picker in the user menu (replaces/extends `Edit3DAvatar.tsx`): upload, preview, list of
  previously used avatars (account data `software.haven.world.avatars`), "set as default", "use in this world".
- In-world switching: picking an avatar updates the member event. Everyone else (and you) swaps on
  receipt. No rejoin needed.

### A5. Tests

- Unit: VRM humanoid parsing (0.x/1.0 fixtures), resolution order, limit checks.
- Manual: two browsers in `#terra-2:thirdroom.io` with different avatars, then switching in-world.
  This sends **one member-event update per test account**; get the user's OK before running against real rooms.

## B. Mirrors

### B1. World format

New glTF node extension **`HAVEN_mirror`** (vendor prefix matching the `software.haven` namespace;
can be proposed to OMI as a standard later):

```json
"extensions": { "HAVEN_mirror": {
  "size": [3.0, 2.0],                  // plane in node's local XY, facing +Z (default [1, 1])
  "defaultState": "off" | "low" | "high", // default "off" (VRChat convention); low = avatars only
  "resolutionScale": 1.0,              // × viewport resolution (per eye in XR), capped at 2048
  "maxDistance": 30,                   // metres; beyond this a flat colour is drawn instead
  "backgroundColor": [0.1, 0.1, 0.12], // linear RGB behind avatars in "low"
  "toggles": [12, 13],                 // node indices acting as toggle buttons (need a collider)
  "clickToToggle": true                // pressing the mirror surface itself cycles it (default true)
}}
```

Pressing a toggle (or the mirror) cycles **Off → High → Low → Off**.

Also: Hubs-exported scenes with `MOZ_hubs_components.mirror` get mapped to the same component
(Third Room already partly reads `MOZ_hubs_components`).

### B2. Behaviour

- **The on/off state and quality are local to each user** (VRChat convention: toggling a mirror doesn't
  force it on for everyone). They're stored per world in local settings.
- Interacting with a toggle node (or the mirror's frame) cycles **Off → High → Low → Off**, or a
  world-defined set of buttons each picks one state.
- Global client setting: "Mirrors: allow / always off / max quality low". Low-end and Quest-browser
  defaults are capped at low.
- Disabled mirrors cost nothing (no render pass at all).

### B3. Rendering (render worker, plus main thread in XR)

- A render resource `RenderMirror` attached to the node. It's synced from the game worker like the existing
  `ReflectionProbe` resources (`schema.ts` → `RenderResources.ts` → a new `UpdateMirrorsSystem`).
- A planar reflection based on three.js `Reflector`: an oblique near-plane clip, a render target sized
  `viewport × resolutionScale`, and a mirrored camera.
- **Low quality = avatars only:** the mirror camera's layer mask contains only the `Avatar` layer (all player
  avatars, including your own full body) plus a flat background colour. Avatar nodes get the new
  `Layer.Avatar`. World geometry isn't rendered at all, which is the whole saving.
- **High quality:** all layers except the editor ones, so your own head is visible in the mirror while hidden
  from the first-person camera (`Layer.FirstPersonHidden` from A2).
- **XR:** one reflection render *per eye* using each eye's camera (three's stock Reflector renders once from
  the combined camera, which gives wrong parallax in a headset). Skip the render when the mirror is off-screen
  (frustum + facing check) or farther than N m.
- Recursion: a mirror never renders other mirrors (they draw black inside a reflection).

### B4. Authoring

- A test scene committed to the repo (`public/gltf/test/mirror-room.glb`), loadable through the local
  `/viewer` route. No Matrix writes needed to develop or test.
- Unity exporter / Blender: document the extension. The exporter fork comes later (checklist §2).
- WebSG script API (`world.createMirror`, `mirror.enabled`, `mirror.quality`) comes later, once the per-user
  local state model is settled. Scripts can only change the *local* user's mirror state.

### B5. Tests

- Unit: extension parsing, toggle state machine.
- Manual: `/viewer` with the test scene (desktop + WebXR emulator), then perf comparison off/low/high.

## Progress (2026-11-13)

- [x] Authenticated media in the SW (`sw.ts`, `src/ui/utils/mediaAuth*.ts`). Unit-tested; **not yet tested
      end to end** (needs a login in the dev build).
- [x] Render layers `Avatar` + `Lights`. Your own avatar is hidden from the first-person camera via layers
      instead of `visible = false`, so mirrors show it (`src/engine/player/avatarLayers.ts`).
- [x] `HAVEN_mirror` + Hubs `mirror`: resource on all three threads, `Mirror` render object, toggle system
      (`src/plugins/mirrors/`). Verified in `/viewer?src=/gltf/test/mirror-room.glb` (and `-low`, `-off`
      variants) for high/low/off rendering.
- [ ] Toggle interaction checked by hand (automation can't get pointer lock).
- [ ] WebXR check (per-eye reflections).
- [ ] Settings UI for the client quality cap (`setMaxMirrorState` exists; no UI yet); remember per-world state.
- [x] Avatar engine (`src/engine/avatar/`):
      - humanoid mapping for VRM 1.0, VRM 0.x, Mixamo and CATS names;
      - limits check;
      - retargeting of the built-in locomotion clips (bind pose from inverse bind matrices, handling both
        the spec and the "world-space IBM" exporter conventions);
      - swap into the player container;
      - camera and nametag at the avatar's eye height.
      Verified in `/viewer?src=/gltf/test/mirror-room-close.glb&avatar=/avatars/031_Devil.vrm`
      (and `057_Rose.vrm`): correct facing, height and idle animation; the mirror shows the avatar.
- [x] Fixed two upstream bugs found along the way: skins with inverse bind matrices at accessor 0 lost
      them, and animated nodes that aren't skin joints never synced.
- [x] Matrix protocol (`src/ui/utils/avatarMatrix.ts`): profile field + member-event key, resolution
      order, publishing.
- [x] Main-thread sync per world (`src/engine/avatar/avatar.main.ts`): resolves us + every call peer and
      re-resolves on member-event changes (live switching).
- [x] Avatar editor accepts `.vrm`: "Save as Default" (profile field + legacy profile room) and "Use Only in
      This World" (member event).
- [ ] **End-to-end test with a real login** (two accounts in one world, switching in-world). Not done yet;
      it writes a member event in a real room.
- [ ] Spring bones, expressions/visemes, MToon shading, per-viewer hide/show, avatar picker with history,
      height scaling (§1 of the checklist).
- [ ] Cache retargeted clips per avatar URL (retargeting costs ~70 ms per load today).

## Order of work

1. Authenticated media in the SW.
2. Render layers (`Avatar`, `FirstPersonHidden`) + local avatar head-hiding. This is shared by both features.
3. Mirrors (self-contained, testable offline via `/viewer`).
4. Avatar loading + VRM parsing + retargeting with the profile-field/member-event protocol.
5. Avatar picker UI, limits, in-world switching.

## C. Avatar pedestals (added 2026-11-14)

glTF node extension **`HAVEN_avatar_pedestal`** (`src/plugins/avatar-pedestals/`). The node marks where the
avatar stands (top of the podium), facing +Z:

```json
"extensions": { "HAVEN_avatar_pedestal": {
  "avatar": {
    "uri": "mxc://matrix.org/…",      // or a path relative to the .glb; omit for the built-in default avatar
    "name": "Rose", "author": "Polygonal Mind", "license": "CC0 1.0", "description": "100 Avatars #057"
  },
  "preview": "model" | "image" | "none", // default "model": live, idle-animated 3D preview
  "image": 3,                            // optional glTF image index shown on the info panel
  "previewHeight": 1.2                   // metres
}}
```

- **Pressing the preview wears the avatar in this world.** The engine (not a world script) sends the choice to
  the main thread, which updates your own member event (`setWorldAvatar`). Everyone picks it up through the
  normal avatar sync. In `/viewer`, it only changes the local avatar.
- **Allowed URIs:** `mxc://` or paths relative to the world file. Other absolute URLs are refused, so a world
  can't make visitors fetch from third-party servers (checklist §7).
- Previews use the same loader as players (limits, retargeting), so a rejected avatar shows only its panel.

## Test world on matrix.org

`!roS2wueFnoGf7M-GOlSbtfvaXp7vxMMGt5V7w5AhROQ` ("Buzzar Mirror Test", invite-only, room v12,
type `org.matrix.msc3815.world`). It was created with Third Room's own `createWorld()` (which validates the
v12 power-level fix) from `public/gltf/test/mirror-room-matrix.glb`, generated by:

```
node scripts/buzzar/make-mirror-test-scene.mjs \
  --devil-uri=mxc://glowers.club/uNVIIrOMFNxhmMVMfOgmMOtj \
  --rose-uri=mxc://matrix.org/UBOGinazYEjdBpSRsgIkCCoo --out=mirror-room-matrix.glb
```

It contains the two mirrors plus pedestals for Default, Devil and Rose along the right-hand wall. Since 2026-11-17 it is the general debug/physics test room ("Buzzar Test Room", now owned by q as
`!x3wwBjFMWtFb4hPc4Kb7prOxe4Ure_Kf8_XOyTVcnh4`) and also has an 8 m ladder up to a platform past the front-left corner. The pillars stand clear of the pedestals. The room's scene is the compressed copy
(`node scripts/buzzar/gltf-tools/compress-world.mjs public/gltf/test/mirror-room-matrix.glb public/gltf/test/test-room-compressed.glb`,
146 KB → 30 KB), uploaded as q: `mxc://glowers.club/oQaOjwzfnfaEseqOuDWtZFpd`. When a pedestal avatar changes (e.g. the Devil's tail, 2026-11-18), upload the new .vrm, regenerate with its mxc, and re-upload the scene; the pedestal otherwise keeps offering the old upload. To update it,
regenerate the .glb, upload it, and change `scene_url` in the `org.matrix.msc3815.world` state event.
