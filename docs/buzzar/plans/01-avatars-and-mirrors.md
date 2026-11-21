# Plan 01: custom avatars + mirrors

Status: **done** (2026-11-21). Drafted 2026-11-13 as the first two features to ship (user priority). Custom avatars,
mirrors and avatar pedestals have shipped; what's left is listed under [Still open](#still-open), and each of those
items is tracked in the parity checklist. The design notes below are kept as a record of how it was built.
Checklist refs: §1 Avatars, §2 Mirrors.

## Prerequisite: authenticated media (both features need it)

Uploads made after the 2024 media freeze can only be downloaded via `/_matrix/client/v1/media/download`
with an `Authorization` header. Hydrogen 0.1.2 builds legacy `/_matrix/media/r0/download` URLs
(`src/ui/hooks/useWorldLoader.ts:60`, `src/ui/utils/avatar.ts:68`, …), so **new avatar uploads won't load**.
Older media, like the reference worlds' scenes, still loads.

- [x] Extend the existing service worker (`sw.ts`, which already intercepts and caches `/_matrix/media/r0/download`):
      rewrite the request to `/_matrix/client/v1/media/download/…` and add `Authorization: Bearer <token>`.
      The page passes the token to the SW over `postMessage`, which is the pattern Element Web uses.
      Fall back to the legacy URL for homeservers without authenticated media (check `/versions` ≥ v1.11).
- [x] Keep the cache keyed by mxc URI, never by a URL containing the token.

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
  "name": "Devil"                          // shown on the Avatars screen
}
```

Resolution per player: member-event key → profile field → default rig. (The draft also had `sha256` and `stats`
fields; they were never needed, since every client checks limits itself when it loads an avatar.)

Built-in avatars (Devil, Rose) are worn from one shared copy on matrix.org each (`res/sharedMedia.json`), so wearing
one never uploads anything.

**Caveats** (neither followed up yet, see [Still open](#still-open)):
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

## Progress

- [x] Authenticated media in the SW (`sw.ts`, `src/ui/utils/mediaAuth*.ts`), in use with real logins.
- [x] Render layers `Avatar` + `Lights`. Your own avatar is hidden from the first-person camera via layers
      instead of `visible = false`, so mirrors show it (`src/engine/player/avatarLayers.ts`).
- [x] `HAVEN_mirror` + Hubs `mirror`: resource on all three threads, `Mirror` render object, toggle system
      (`src/plugins/mirrors/`), including world-defined state buttons (Home World, test room).
- [x] Toggle interaction checked by hand.
- [x] Avatar engine (`src/engine/avatar/`):
      - humanoid mapping for VRM 1.0, VRM 0.x, Mixamo and CATS names;
      - limits check;
      - retargeting of the built-in locomotion clips (bind pose from inverse bind matrices, handling both
        the spec and the "world-space IBM" exporter conventions);
      - swap into the player container;
      - camera and nametag at the avatar's eye height;
      - spring bones (`springBones.ts`), expressions, lip sync, blinking and eye gaze (`face.ts`).
- [x] Fixed two upstream bugs found along the way: skins with inverse bind matrices at accessor 0 lost
      them, and animated nodes that aren't skin joints never synced.
- [x] Matrix protocol (`src/ui/utils/avatarMatrix.ts`): profile field + member-event key, resolution
      order, publishing.
- [x] Main-thread sync per world (`src/engine/avatar/avatar.main.ts`): resolves us + every call peer and
      re-resolves on member-event changes (live switching).
- [x] Avatars screen: upload (`.glb` / `.vrm`, preview before upload), Wear / Wear Only in This World, saved and
      bookmarked avatars (account data `software.haven.world.avatars`), stock avatars, avatars of people in the world.
- [x] End-to-end tests with real logins: two accounts in one world, switching in-world.
- [x] Avatar pedestals (section C).

### Still open

Each of these is tracked in `docs/buzzar/parity-checklist.md` (§1 Avatars, §2 Mirrors, §5 Personal safety).

- [ ] Client setting for the mirror quality cap: `setMaxMirrorState` exists but no setting uses it. Mirror state
      isn't remembered per world either.
- [ ] WebXR check of the per-eye reflections in a real headset.
- [ ] MToon shading (VRM avatars render with standard materials).
- [ ] Per-viewer hide/show of other people's avatars (§5 Personal safety).
- [ ] User-adjustable height and world height limits (§1).
- [ ] Performance ranking and hard limits beyond today's load-time check (§1).
- [ ] Cache retargeted clips per avatar URL (retargeting costs ~70 ms per load).
- [ ] Check whether Synapse keeps our member-event key when a user changes their global displayname/avatar.
- [ ] (Maybe) "Import my Third Room avatar" from the old private profile room.

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

"Buzzar Test Room", `#test-room-buzzar:matrix.org` (public, room v12, type `org.matrix.msc3815.world`). It started on
2026-11-14 as "Buzzar Mirror Test" and is now the general debug/physics test room. It has:

- the two mirrors (the one you spawn facing starts on, so avatars under test are visible at once);
- pedestals for Default, Devil and Rose along the right-hand wall;
- an 8 m ladder up to a platform past the front-left corner, with the pillars clear of the pedestals.

Its scene is `public/gltf/test/test-room-compressed.glb`, made from `mirror-room-matrix.glb`:

```
node scripts/buzzar/make-mirror-test-scene.mjs \
  --devil-uri=mxc://matrix.org/… --rose-uri=mxc://matrix.org/… --out=mirror-room-matrix.glb
node scripts/buzzar/gltf-tools/compress-world.mjs public/gltf/test/mirror-room-matrix.glb \
  public/gltf/test/test-room-compressed.glb
```

To update it, regenerate the .glb, upload it to matrix.org and change `scene_url` in the room's
`org.matrix.msc3815.world` state event. When a pedestal avatar's file changes, upload the new .vrm and regenerate
with its mxc first; otherwise the pedestal keeps offering the old upload. Locally, the same scene opens with
`/viewer?src=/gltf/test/mirror-room.glb&avatar=/avatars/031_Devil.vrm`.
