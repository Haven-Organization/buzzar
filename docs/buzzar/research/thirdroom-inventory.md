# Third Room Source Inventory (for the Buzzar / VRChat-parity gap checklist)

Repo: `/home/user/.local/src/claude/buzzar` (upstream matrix-org/thirdroom, July 2023 snapshot). All paths are relative to the repo root.
Legend: **[OK]** implemented and working, **[PARTIAL]** partial, stubbed or TODO, **[ABSENT]** not present.

---

## 1. Architecture overview

### Stack and dependencies (`package.json`)

- **Renderer:** three.js, a fork pinned as `"three": "npm:@thirdroom/three@^0.148.3"`. Also `3d-tiles-renderer` (a matrix-org fork), KTX2/basis, draco3dgltf and meshoptimizer.
- **ECS:** bitECS, `"bitecs": "NateTheGreatt/bitECS"` from git. The world is created in `src/engine/GameWorker.ts:43` with `maxEntities = 100000` (`src/engine/config.common.ts:1`).
- **Physics:** Rapier, `@dimforge/rapier3d-compat ^0.11.2`, running in the game worker (`src/engine/physics/physics.game.ts`).
- **Matrix:** Hydrogen, `@thirdroom/hydrogen-view-sdk 0.1.2`, typed in `src/hydrogen-view-sdk.d.ts`, plus `@matrix-org/olm`.
- **UI:** React 17, jotai, radix-ui, Monaco (script editor), and `@thirdroom/manifold-editor-components` (hierarchy tree).
- **Scripting:** a QuickJS-to-WASM runtime built with emscripten (`src/engine/scripting/emscripten/build.sh`), with a prebuilt `build/scripting-runtime.wasm` checked in.
- **UI layout in-world:** `yoga-wasm-web` (flexbox for the WebSG UI canvas).
- **Tooling:** Vite 4 as an MPA (`vite.config.ts`, `src/vite/mpa-router.ts`), cross-origin isolation (needed for SharedArrayBuffer), a service worker (`sw.ts`), vitest, storybook, vitepress docs with a typedoc API build, eslint/stylelint and husky.

### Threads (`src/engine/MainThread.ts`, `GameWorker.ts`, `renderer/RenderWorker.ts`)

- **Main thread** (`config.main.ts`): React UI, WebAudio (`audio/audio.main.ts`), WebRTC data channels (`network/network.main.ts`), Matrix widget bridge (`matrix/matrix.main.ts`), raw input capture and the editor bridge.
- **Game worker** (`config.game.ts`): ECS simulation. It has 19 modules and about 35 ordered systems: input, network in, world loader, character controllers, interaction, physics, interpolation, scripting, animation, nametags, network out, and resource commit. It runs a 60 Hz `setInterval` loop (`tickRate = 60`, `GameWorker.ts:130-161`).
- **Render worker** (`renderer/config.render.ts`): three.js rendering into an OffscreenCanvas. **It falls back to running on the main thread when WebXR is supported, OffscreenCanvas is missing, or `?renderMain` is set** (`MainThread.ts:110`, `useOffscreenCanvas = supportsOffscreenCanvas && renderMain === null && !supportedXRSessionModes`). In practice, any XR-capable browser renders on the main thread.
- **Inter-thread data:** SharedArrayBuffer triple buffers (`allocator/TripleBuffer.ts`, `ObjectBufferView.ts`) and ring buffers (`resource/ResourceRingBuffer.ts`, `network/RingBuffer.ts`, `common/InputRingBuffer.ts`). "Remote resources" are defined by a schema DSL (`resource/schema.ts`, `ResourceDefinition.ts`) and mirrored to the render and main threads.
- **Module system:** `module/module.common.ts` (`defineModule` / `registerMessageHandler`).
- **Plugins:** `src/plugins/{interaction,portals,spawnables,thirdroom}`.

### packages/

- **[OK]** The only package is `packages/websg-types` (v0.1.5): a TypeScript declaration file (`types/websg.d.ts`, about 2850 lines) for the JS script globals `world`, `network`, `matrix` and `thirdroom`.
- **[ABSENT]** No `websg` runtime package and no in-repo Unity exporter. The Unity exporter is external (`github.com/matrix-org/thirdroom-unity-exporter` plus a UnityGLTF fork at `#thirdroom/dev`; see `docs/guides/unity/index.md:38-48`).

### Other directories

- `src/asset-pipeline/`: CLI and web glTF optimizer using gltf-transform (`pipeline.ts`, `cli.ts`, `web.ts`, `functions/compressTextures.ts`). It has gltf-transform extension classes for KHR_audio, MX_background, MX_lightmap, MX_lights_shadows, MX_portal, MX_postprocessing, MX_reflection_probes, MX_scene_ar, MX_spawn_point, MX_static, MX_texture_rgbm, OMI_collider and OMI_link. UI lives at `src/ui/views/asset-pipeline/`.
- `src/ui/views/gltf-viewer/`: a standalone glTF viewer page.
- `logviewer/`: a rageshake log viewer.
- `public/`: static assets, including the default avatar `/gltf/full-animation-rig.glb`, controller and headset models, audio and cubemaps.

---

## 2. Matrix integration

### SDK

- Hydrogen (`@thirdroom/hydrogen-view-sdk`) is used for login, sync, rooms, timelines, the media repository and group calls (`session.callHandler`).
- OIDC is supported (`config.json` `staticOidcClients`, Keycloak guest hint).

### Room types, events and account data

| Identifier                                                                    | Kind                                                                                 | Purpose                                                                                                                                                                                       | Where                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `org.matrix.msc3815.world`                                                    | room type and state event (key `""`)                                                 | Marks a room as a world. Content: `scene_url`, `scene_preview_url`, `script_url`, `max_member_object_cap`, `scene{url,preview_url,name,author_name,version}`, `scene_from{room_id,state_key}` | `create-world/CreateWorldForm.tsx:98-138`, `hooks/useWorldLoader.ts:50-63`, `world-settings/WorldSettings.tsx:130-135`, `editor/ScriptEditor.tsx:139-141`, `hooks/useUpdateScene.ts` |
| `m.world`                                                                     | state event (legacy)                                                                 | Read as a fallback                                                                                                                                                                            | `WorldSettings.tsx:75,125`                                                                                                                                                           |
| `org.matrix.msc3815.profile`                                                  | room type                                                                            | Per-user private "profile room"                                                                                                                                                               | `utils/matrixUtils.ts:74-79`, `hooks/useUserProfile.ts:64`                                                                                                                           |
| `org.matrix.msc3815.world.profile`                                            | state event in the profile room                                                      | `{avatar_url (mxc .glb), avatar_preview_url}`                                                                                                                                                 | `user-profile/Edit3DAvatar.tsx:38-49`, `hooks/use3DAvatar.ts:21`                                                                                                                     |
| `org.matrix.msc3815.world.member`                                             | state event in the world (key = userId)                                              | Copies `avatar_url` into the world                                                                                                                                                            | `utils/matrixUtils.ts:80-91`. **`updateWorldProfile` is never called anywhere** (dead code)                                                                                          |
| `org.matrix.msc3815.member.world`                                             | Power-level entry only                                                               | (none)                                                                                                                                                                                        | `CreateWorldForm.tsx:127`                                                                                                                                                            |
| `org.matrix.msc3815.world.home`                                               | account data                                                                         | Home world id                                                                                                                                                                                 | `hooks/useHomeWorld.ts:80-107`                                                                                                                                                       |
| `org.matrix.msc3401.call`, `org.matrix.msc3401.call.member`                   | group call (MSC3401)                                                                 | Voice plus data channels                                                                                                                                                                      | `CreateWorldForm.tsx:125-126`, `network/createMatrixNetworkInterface.ts:66`                                                                                                          |
| `msc3948.repository_room.{featured_world,featured_room,featured_scene,scene}` | state events in a "repository room" (`#repository-room:thirdroom.io`, `config.json`) | Discover page and scene catalog                                                                                                                                                               | `discover/DiscoverView.tsx:23-26`, `discover/*`                                                                                                                                      |
| `io.thirdroom.onboarding`, `io.thirdroom.whats_new`                           | account data                                                                         | UI flags                                                                                                                                                                                      | `hooks/useOnboarding.ts:5`, `hooks/useWhatsNew.ts:7`                                                                                                                                 |

### Default world power levels (`CreateWorldForm.tsx:107-131`)

- invite/kick/ban 100, `state_default` 50, `org.matrix.msc3815.world` 50, call/call.member 0, creator 100.
- Worlds are created **unencrypted**: `isEncrypted: false` (`CreateWorldForm.tsx:105`).

### Worlds, scenes and avatars storage

- A world is a Matrix room. The scene is a glb and the script a `.js` or `.wasm`, both uploaded as mxc and referenced from the world state event.
- The world reloads live when that state event changes (`world/WorldRootView.tsx:72-100`, `observeStateTypeAndKey`). Reload keeps the call and re-inits peers (`plugins/thirdroom/thirdroom.game.ts:424-446`).
- Scene versioning and update from the repository is in `hooks/useUpdateScene.ts`.

### Group call and WebRTC topology (`network/createMatrixNetworkInterface.ts`)

- **[OK]** One MSC3401 group call per world room (`createCall(world.id, "m.voice", "World Call", CallIntent.Room)`, line 66).
- **Topology: full mesh.** Every member gets an `RTCPeerConnection` with mic audio plus one data channel (`LocalMedia().withUserMedia(stream).withDataChannel({})`, lines 77-78). No SFU.
- **[PARTIAL]** Only **one ordered/reliable data channel** per peer. Unreliable traffic is sent over the reliable channel too: `// TODO: add unreliable channels` (`network/network.main.ts:240-258`), and only `dataChannel.ordered` channels are registered (line 149).
- **[PARTIAL]** Host election picks the oldest call member event and then the lowest device index (`getReliableHost`, lines 39-49). `// TODO: use powerlevels to determine host` (line 198).
  - `src/engine/network/HostElection.ts` (228 lines, power-level-aware and with connection states) is **dead code**: it is not imported anywhere.

### Network state sync (game worker; `network/*.ts`)

- **Ownership model: peer-authoritative per entity, no host authority.** Each client simulates and broadcasts its own `Owned` + `Networked` entities (`outbound.game.ts:89-133`).
  - New peers get a `NewPeerSnapshot` plus `InformPlayerNetworkId` plus `InformXRMode`.
  - After that each tick sends reliable `Create` and `Delete` messages and "unreliable" `UpdateChanged` deltas (position, velocity, quaternion, skipLerp with a change mask; `serialization.game.ts:165-190`).
- **Message types:** `NetworkAction` enum (`network/NetworkAction.ts`): Create, Delete, UpdateChanged, UpdateSnapshot, FullChanged, FullSnapshot, Prefab, InformPlayerNetworkId, NewPeerSnapshot, RemoveOwnershipMessage, UpdateNetworkId, BinaryScriptMessage, StringScriptMessage, InformXRMode.
- **Network IDs:** `(localId << 16) | peerIndex`. The peer index is `murmurHash(peerId) >>> 16`, a 16-bit hash with possible collisions and no host assignment (`network.game.ts:117-148`).
- **Send rate:** updates go out every game tick at 60 Hz. `network.tickRate: 10` is unused.
- **Interpolation:** there is an interpolation system, but `interpolate: false` by default (`network.game.ts:123`, `NetworkInterpolationSystem.ts:89`).
- **Ownership transfer:** `takeOwnership` (`network/ownership.game.ts:39-74`) despawns the remote copy, broadcasts `RemoveOwnershipMessage`, and re-creates the object locally from its prefab. Any peer can take any grabbable prefab; there is no permission check.
- **Trust:** creates are not validated. `deserializeCreates` instantiates whatever prefab name a peer sends (`serialization.game.ts:288-320`). There is no per-peer cap on received objects and no check that the network ID's peer bits match the sender.
- **Docs and code diverge.** `docs/protocol/index.md` (TRNP) describes host-authoritative HostSnapshot, PeerEntered, AuthorityTransfer, RPC, 64-bit IDs, pinned hosts and power-level host election. `docs/protocol/implementation.md` describes Authoring/Relaying components. **None of this is implemented**: the code uses the simpler peer-owned scheme above.
- **Matrix widget API bridge for scripts** (`matrix/matrix.main.ts:123-330`):
  - Capabilities are hard-coded: send `m.room.message#m.text`; receive `m.room.message` and `org.matrix.msc3672.beacon`.
  - `// TODO: Capabilities` (line 146). Only the `send_event` and `read_events` actions exist.

### Network TODO/HACK highlights

- `network.main.ts:82`: "add a backing buffer in case this fills". A full reliable ring buffer throws.
- `serialization.game.ts:73,81,471`: HACKs for the input tick and for awaiting entity creation.
- `inbound.game.ts:85`: only a single handler per message type.
- `NetworkComponents.ts:11`: split the network ID into two 32-bit ints.
- `PlayerRig.ts:268`: "add Authoring component...".

---

## 3. Avatars

| Feature                    | Status                                                                                                                                                                                                                                                                                         | Evidence                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Avatar format              | glTF/GLB only. **No VRM** (grep for vrm/blendshape/viseme returns nothing).                                                                                                                                                                                                                    | `player/PlayerRig.ts:58`                                                                          |
| **Custom avatar in-world** | **[ABSENT/BROKEN]** Every player, local and remote, is the hard-coded `createNodeFromGLTFURI(ctx, "/gltf/full-animation-rig.glb")`. The uploaded profile avatar (`org.matrix.msc3815.world.profile.avatar_url`) is only shown as a preview image in the profile UI; the engine never reads it. | `PlayerRig.ts:53-107`; `user-profile/Edit3DAvatar.tsx`; `user-profile/UserProfileOverview.tsx:57` |
| Avatar upload/selection UI | **[PARTIAL]** "Edit 3D Avatar" modal: upload `.glb` plus a preview image into profile room state. There is no avatar gallery or picker. (`AvatarPicker.tsx` is a 2D image picker for room/profile avatars.)                                                                                    | `user-profile/Edit3DAvatar.tsx:25-100`                                                            |
| Change avatar in-world     | **[ABSENT]**                                                                                                                                                                                                                                                                                   | (none)                                                                                            |
| Locomotion animations      | **[OK]** A fixed clip set (Idle, Walk, WalkBack, Run, RunBack, Strafe*, Turn*, Fall1/2) is chosen from rigid-body velocity and blended with a three.js `AnimationMixer` in the game worker. It requires the default rig's clip names.                                                          | `animation/animation.game.ts:23-37,95-125,180+`                                                   |
| Emotes / gestures          | **[ABSENT]** (`m.emote` only exists as a chat message type)                                                                                                                                                                                                                                    | (none)                                                                                            |
| IK / full body             | **[ABSENT]** In XR, remote avatars' bodies are **hidden** (`avatar.visible = !(theirXRMode === ImmersiveAR or ImmersiveVR)`); only the networked headset model and controller models are shown. No IK or bone sync.                                                                            | `input/WebXRAvatarRigSystem.ts:~200-215`                                                          |
| Bone/skeleton networking   | **[ABSENT]** Only root transform and velocity are sent. Animation is re-derived from velocity on each client.                                                                                                                                                                                  | `serialization.game.ts:165-190`                                                                   |
| Lip sync / visemes         | **[ABSENT]**. There is a speaking indicator in the UI nametag and member list (Hydrogen volume measurer).                                                                                                                                                                                      | `nametags/Nametags.tsx:110`, `MemberListDialog.tsx:100-110`                                       |
| Height/scale               | **[ABSENT]** Fixed capsule: `AVATAR_CAPSULE_HEIGHT=1`, radius 0.35, `AVATAR_HEIGHT=1.7`. The only scale change is a reset to 1 for AR.                                                                                                                                                         | `PlayerRig.ts:48-51`                                                                              |
| Size/perf limits           | **[ABSENT]** No polycount, texture or file-size validation for avatars                                                                                                                                                                                                                         | (none)                                                                                            |
| Nametags                   | **[OK]** A game-side anchor projects positions; React draws the overlay (name, avatar image, speaking state). Not shown for your own avatar.                                                                                                                                                   | `player/nametags.game.ts`, `ui/views/session/nametags/Nametags.tsx`, `PlayerRig.ts:232-235`       |
| First/third person         | **[OK]** V toggles third person; B toggles fly mode                                                                                                                                                                                                                                            | `player/CharacterController.ts:28-52`                                                             |
| Character controllers      | **[OK]** Kinematic (Rapier KCC: jump, crouch, sprint) and Fly. Fly is forced when the scene has no spawn points or `MX_character_controller` says fly.                                                                                                                                         | `player/KinematicCharacterController.ts`, `FlyCharacterController.ts`, `PlayerRig.ts:66-73`       |
| Footstep audio             | **[OK]** Positional emitter on every player                                                                                                                                                                                                                                                    | `PlayerRig.ts:187-230`                                                                            |

---

## 4. Scripting (WebSG)

### Runtime

- `src/engine/scripting/scripting.game.ts` loads `script_url`:
  - With a JS content type, the source is passed to the prebuilt QuickJS WASM (`emscripten/build/scripting-runtime.wasm`).
  - With `application/wasm`, it runs a raw WASM module that you can write in C or any language.
- WASI shim: `scripting/wasi.ts`.
- Memory is a fixed 64 MB (`WebAssembly.Memory({initial:1024, maximum:1024})`, `scripting.game.ts:75`; `-s ALLOW_MEMORY_GROWTH=0`, `build.sh`).
- **Import modules** (`scripting.game.ts:117-126`): `websg`, `websg_networking`, `matrix`, `thirdroom`, `wasi_snapshot_preview1`.
- **Wiring:** 284 C-header imports exist. All are implemented in TypeScript except `websg_query_get_component_indices`, which is declared in the header with no TS implementation (my cross-check).

### Lifecycle

- `ScriptState`: Uninitialized, Initialized, Loaded, Entered, Error (`scripting.game.ts:14-20`).
- Exports called: `websg_initialize`, `websg_load`, `websg_enter`, `websg_update(dt, time)`, `websg_peer_entered(peerIndex)`, `websg_peer_exited(peerIndex)`.
- In JS these surface as `world.onload`, `world.onenter`, `world.onupdate`, `network.onpeerentered` and `network.onpeerexited`.
- `ScriptingSystem` runs after physics and before animation (`config.game.ts`).
- `// TODO: Use a networked global time variable instead of elapsed` (`scripting.game.ts:52`).

### Who can run scripts

- **[PARTIAL]** **Exactly one script per world**: the environment script from the world state event `script_url`. It is attached to the environment scene (`plugins/thirdroom/thirdroom.game.ts:322-325,419-422`).
- Setting it requires power to send `org.matrix.msc3815.world` (PL 50 by default).
- There are no per-object, per-avatar or per-prefab scripts and no user-spawned scripts.
- An in-browser Monaco script editor saves a new `script_url` (`ui/views/session/editor/ScriptEditor.tsx:69-141`).

### Sandbox and permissions

- Scripts run in a WASM sandbox inside the game worker.
- Resource access is scoped to the script's resource manager via `getScriptResource(wasmCtx, ...)`. Scripts cannot touch avatar nodes directly; they can only read peer translation and rotation.
- **There is no CPU or time budget**: no QuickJS interrupt handler and no watchdog. A runaway script stalls the game loop. `GameWorker.ts:135` only logs breaches of the tick time.
- **There is no capability or permission model** beyond the hard-coded Matrix widget capabilities (`matrix.main.ts:131-146`).
- TODOs at `websg.ts:376-380`: resource ownership scoping, and disposal of script entities on unload.

### API surface (from `src/engine/scripting/websg.ts` and `packages/websg-types/types/websg.d.ts`)

| Area                              | Status                                                                                      | API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene graph                       | **[OK]**                                                                                    | Scenes and nodes: create, find by name, children and parent, TRS, matrix and world matrix, visible, `is_static`. Also `node_start_orbit` (camera orbit) and `node_set_forward_direction`.                                                                                                                                                                                                                                                                                                                                    |
| Meshes / materials / accessors    | **[OK]**                                                                                    | `create_mesh`, `create_box_mesh`, primitives (draw range, hologram material). Accessors (`create_accessor_from`, `accessor_update_with` for dynamic geometry). PBR and unlit materials (base color, metal/rough, emissive, base color texture). Find texture or image by name, but **no texture creation from script**.                                                                                                                                                                                                      |
| Lights                            | **[OK]**                                                                                    | `create_light` (KHR_lights_punctual types), color and intensity                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ECS components                    | **[OK]**                                                                                    | `MX_components`-defined components, queries, component stores (`world_create_query`, `node_add_component`, etc.; `docs/guides/websg/ecs.md`)                                                                                                                                                                                                                                                                                                                                                                                 |
| Physics                           | **[OK]**                                                                                    | `create_collider` (box/sphere/capsule/cylinder/hull/trimesh, `is_trigger`), physics body (kinematic/rigid/static), `apply_impulse`, collision listeners (start/end events between script-owned nodes)                                                                                                                                                                                                                                                                                                                        |
| Triggers                          | **[OK]** via `is_trigger` sensors plus collision listeners (`websg.ts:2036-2045,2142-2175`) | (see left)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Interactables                     | **[OK]**                                                                                    | `node_add_interactable`, pressed/held/released                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| In-world UI                       | **[OK]**                                                                                    | `UICanvas` and `UIElement` with flexbox (yoga), `UIButton`, `UIText`, rendered to a texture (`renderer/ui.ts`)                                                                                                                                                                                                                                                                                                                                                                                                               |
| Input                             | **[PARTIAL]**                                                                               | Only `get_primary_input_source_origin_element` and `direction_element` (the ray). No key or axis access.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Networking                        | **[PARTIAL]**                                                                               | `network.broadcast(msg, reliable)`, where **unreliable returns an error** ("Unreliable broadcast currently not supported", `network/scripting.game.ts:~107`). `listen()`, host and local peers, peer translation and rotation, `peer_is_host`, `defineReplicator()` for spawn/despawn with data (`network/scripting.game.ts:337-560`). **No networked/synced variables, no RPC to a specific peer and no state persistence.** Bug: the StringScriptMessage handler passes `binary=true` (`network/scripting.game.ts:48-49`). |
| Matrix                            | **[PARTIAL]**                                                                               | `matrix.listen/send/receive/close`. Widget-API-like, fixed capabilities (text messages in the current room)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ThirdRoom-specific                | **[OK]**                                                                                    | `enable_matrix_material`, audio analyser data (`get_audio_frequency_data` / `time_data`), `in_ar`, action bar (`action_bar_set_items` plus a listener)                                                                                                                                                                                                                                                                                                                                                                       |
| Audio from script                 | **[ABSENT]**                                                                                | No create or play of audio emitters or sources (schema props are flagged `script: true`, but there are no WebSG functions)                                                                                                                                                                                                                                                                                                                                                                                                   |
| Animation from script             | **[ABSENT]**                                                                                | No animation, clip or mixer API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Raycast                           | **[ABSENT]**                                                                                | (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Avatar / player control, teleport | **[ABSENT]**                                                                                | (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| glTF extras                       | **[ABSENT]**                                                                                | `// TODO: Implement glTF extras in WebSG API` (`WASMModuleContext.ts:338`)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Persistence / storage             | **[ABSENT]**                                                                                | (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Examples (`examples/`, built by `examples/build.sh`)

- JS: basketball, ecs-basic, interactable, math, matrix, physics, platformer, presentation, procgen, ui, ui-basic, widget-echo, and `websg-v1/websg.js`.
- C: interactable, matrix, network, procgen, widget-hello-world.
- A tutorial matches the basketball example: `docs/guides/websg/basketball/part-1..3.md`.

---

## 5. World / scene features

### glTF extensions handled (`src/engine/gltf/gltf.game.ts`, `GLTF.ts`)

| Extension                                                                 | Status        | Effect                                                                                               |
| ------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| KHR_lights_punctual                                                       | **[OK]**      | Lights                                                                                               |
| KHR_materials_unlit, \_emissive_strength, \_ior, \_transmission, \_volume | **[OK]**      | Materials                                                                                            |
| KHR_texture_transform                                                     | **[OK]**      | Texture transforms                                                                                   |
| KHR_texture_basisu                                                        | **[OK]**      | Compressed textures                                                                                  |
| KHR_mesh_quantization                                                     | **[OK]**      | Quantized meshes                                                                                     |
| EXT_mesh_gpu_instancing                                                   | **[OK]**      | GPU instancing                                                                                       |
| KHR_audio                                                                 | **[OK]**      | Global and positional emitters                                                                       |
| OMI_collider                                                              | **[OK]**      | Colliders                                                                                            |
| OMI_physics_body                                                          | **[OK]**      | Physics bodies                                                                                       |
| OMI_link                                                                  | **[OK]**      | Becomes a portal                                                                                     |
| MX_portal                                                                 | **[OK]**      | Portals                                                                                              |
| MX_spawn_point                                                            | **[OK]**      | Spawn points                                                                                         |
| MX_static                                                                 | **[OK]**      | Static nodes                                                                                         |
| MX_lightmap                                                               | **[OK]**      | Lightmaps                                                                                            |
| MX_reflection_probes                                                      | **[OK]**      | Reflection probes                                                                                    |
| MX_background                                                             | **[OK]**      | Background texture                                                                                   |
| MX_postprocessing                                                         | **[OK]**      | Bloom only                                                                                           |
| MX_lights_shadows                                                         | **[OK]**      | Shadow settings                                                                                      |
| MX_texture_rgbm                                                           | **[OK]**      | RGBM textures                                                                                        |
| MX_character_controller                                                   | **[OK]**      | Character controller choice                                                                          |
| MX_scene_ar                                                               | **[OK]**      | AR support flag                                                                                      |
| MX_tiles_renderer                                                         | **[OK]**      | 3D Tiles                                                                                             |
| MX_components                                                             | **[OK]**      | ECS component data                                                                                   |
| MOZ_hubs_components (partial compat)                                      | **[PARTIAL]** | spawn-point, waypoint, trimesh/nav-mesh, visible, scene-preview-camera only (`gltf.game.ts:833-858`) |

Draco and meshopt decoders are dependencies. Each extension has a README and schema under `docs/gltf/MX_*`.
**Absent:** KHR_materials_clearcoat, sheen, variants and specular; KHR_animation_pointer; video textures.

### Feature status

| Feature                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Spawn points                           | **[OK]** Random among MX_spawn_point nodes; with none, spawn at the origin in fly mode                                                                                                                                                                                                                                                                                                                                                                                                            | `PlayerRig.ts:275-282`, `component/SpawnPoint.ts`, `utils/spawnEntity.ts`                                              |
| Portals                                | **[OK]** but **click-to-activate** (an interactable), not walk-through. It navigates to a Matrix room or alias (joining if needed) or opens an `http(s)` URL with `window.location`.                                                                                                                                                                                                                                                                                                              | `plugins/portals/portals.game.ts`, `interaction.game.ts:876-878`, `ui/views/session/world/WorldInteraction.tsx:55-100` |
| In-world teleport (same world)         | **[ABSENT]** as a feature. Only an internal `teleportEntity` util exists.                                                                                                                                                                                                                                                                                                                                                                                                                         | (none)                                                                                                                 |
| Colliders / triggers                   | **[OK]** OMI_collider, OMI_physics_body, auto trimesh colliders for the environment (`createDefaultMeshColliders: true`, `thirdroom.game.ts:372`), sensors via `isTrigger` (`physics.game.ts:213,238,264`)                                                                                                                                                                                                                                                                                        | (see left)                                                                                                             |
| Moving objects                         | **[PARTIAL]** Scripts can move nodes and kinematic bodies **locally only**. Environment nodes are not networked, so sync requires the script to broadcast or use a Replicator.                                                                                                                                                                                                                                                                                                                    | (none)                                                                                                                 |
| Scene glTF animations                  | **[PARTIAL/BROKEN]** Animations load into a mixer with every action **`enabled = false`**. `AnimationSystem` only drives clips from the parent physics body's velocity, intended for avatars. For an environment scene with no parent it logs "cannot find parent container" and skips. So **world animations do not autoplay**, and there is no API to play them.                                                                                                                                | `gltf.game.ts:561-638`, `animation.game.ts:95-104`                                                                     |
| Audio emitters                         | **[OK]** KHR_audio: positional (HRTF PannerNode with cone, distance model, ref/max distance, rolloff) and global; mp3/ogg/wav up to `MAX_AUDIO_BYTES = 640_000`                                                                                                                                                                                                                                                                                                                                   | `audio/audio.main.ts:215,700-770`, `resource/schema.ts:171-198`                                                        |
| Video                                  | **[ABSENT]** (no HTMLVideoElement or VideoTexture anywhere in the engine)                                                                                                                                                                                                                                                                                                                                                                                                                         | (none)                                                                                                                 |
| Mirrors                                | **[ABSENT]** No planar reflector. The "mirror balls" are metallic spheres using reflection probes.                                                                                                                                                                                                                                                                                                                                                                                                | `spawnables.game.ts:150-165`                                                                                           |
| Reflection probes                      | **[OK]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `renderer/ReflectionProbe.ts`, `systems/UpdateReflectionProbesSystem.ts`, `UpdateNodeReflectionsSystem.ts`             |
| Lightmaps                              | **[OK]** MX_lightmap plus RGBM                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `materials/patchShaderChunks.ts`, `RenderResources.ts`                                                                 |
| Post-processing                        | **[PARTIAL]** Bloom only                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `gltf.game.ts:685`                                                                                                     |
| Render quality tiers                   | **[OK]** detect-gpu auto tiers Low/Medium/High/Ultra                                                                                                                                                                                                                                                                                                                                                                                                                                              | `MainThread.ts:65-100`                                                                                                 |
| 3D Tiles                               | **[OK]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `systems/UpdateTileRenderersSystem.ts`                                                                                 |
| Special materials                      | **[OK]** MatrixMaterial ("matrix rain"), HologramMaterial, DepthMaskMaterial                                                                                                                                                                                                                                                                                                                                                                                                                      | `renderer/materials/`                                                                                                  |
| World editor                           | **[PARTIAL]** In-browser "Scene Inspector/Editor": hierarchy tree, properties panel (`onSetProperty` sets any resource prop), rename, Monaco script editor. **`onReparentEntities` and `onFocusEntity` are empty functions** (`editor.game.ts:215,225`). The Transform mode/orientation/pivot/snapping toolbar (`EditorToolbar.tsx:33-370`) is **UI-only**: nothing in the engine consumes it, and there are no gizmos. **Edits are neither networked nor saved or exported** (no glTF exporter). | `engine/editor/*`, `ui/views/session/editor/*`                                                                         |
| Runtime scene switching                | **[OK]** Changing the world state event reloads scene and script in place while keeping the call                                                                                                                                                                                                                                                                                                                                                                                                  | `WorldRootView.tsx:72-100`, `thirdroom.game.ts:424-446`                                                                |
| Home world, Discover, scene repository | **[OK]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `hooks/useHomeWorld.ts`, `discover/*`                                                                                  |
| In-world chat                          | **[OK]** Matrix timeline overlay                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ui/views/session/world-chat/`                                                                                         |

---

## 6. Spawnable objects

- **Prefabs** (`plugins/spawnables/spawnables.game.ts:69-175`): `small-crate`, `medium-crate`, `large-crate`, `small-ball`, `mirror-ball`, `black-mirror-ball`, `emissive-ball`. Each has a box or sphere collider, a rigid body, the Grabbable interactable and hit/bounce audio.
- **How users spawn them:** an action bar (keys 1-9; the XR "a" button maps only to slot 1) with hard-coded `defaultActionBarItems` (`plugins/thirdroom/action-bar.game.ts:16-85`). Scripts can replace the action bar items. Objects spawn 1 m in front of the camera or controller (`spawnPrefab`, `spawnables.game.ts:325-370`).
- **No user-uploaded or custom glTF spawnables**, and no inventory.
- **Networking:** each spawned object is `Owned` + `Networked` by its spawner and simulated in the spawner's physics. Others receive transform deltas. Grabbing a remote object **steals ownership** by despawning and re-creating it (`ownership.game.ts`). Objects despawn when the owner leaves.
- **Interaction** (`plugins/interaction/interaction.game.ts`):
  - Desktop: hitscan focus at 3.3 m; grab with E or the left mouse button; held distance 1.5-8 m adjustable by scroll; throw with the right mouse button (`THROW_FORCE=10`); delete your own objects with X (`// TODO: For now we only delete owned objects`, line 518).
  - XR: squeeze grabs and the trigger interacts (`updateGrabThrowXR`, line 728).
- **Limits:** a per-client cap `max_member_object_cap` (default `MAX_OBJECT_CAP = 100`, `config.common.ts:5`) is set in World Settings (`WorldSettings.tsx:84-219`) and enforced **only locally** in `spawnPrefab`. TODO: "send this message to the other clients" and "add two configs: max objects per client and max objects per room" (`spawnables.game.ts:334-335`). Received creates are never capped.

---

## 7. VR / XR

- **Session modes:** `immersive-vr` and `immersive-ar` (`MainThread.ts:43-62`). `optionalFeatures: ["local-floor","bounded-floor","hand-tracking","layers"]` (`ui/hooks/useWebXRSession.ts:9`). multiviewStereo is enabled (`renderer.render.ts:189`).
- **Controllers [OK]:** WebXR input profiles models (`renderer/xr/WebXRInputProfiles.ts`, copied in `vite.config.ts`). Controller models and rays are networked as separate `xr-hand-*`, `xr-ray` and `xr-head` prefabs (`PlayerRig.ts:110-176`, `WebXRAvatarRigSystem.ts`).
- **Hand tracking [PARTIAL]:** requested, and hand joint poses are written to a triple buffer on the render side (`renderer.common.ts:228-236`, `renderer.render.ts:526`). **Nothing on the game side consumes `handPoses`**, so there is no hand rendering, gestures or networking.
- **Locomotion:** smooth movement on the secondary thumbstick (`KinematicCharacterController.ts:44-46`); jump and sprint on the thumbstick buttons; **snap turn of 30° on the primary thumbstick [OK]** (`CameraRig.ts:73-80,328-336`). **No teleport locomotion, no smooth turn option and no comfort vignette [ABSENT].**
- **IK body [ABSENT]:** the remote VR user's body is hidden; you see only the head and controllers.
- **XR UI [PARTIAL]:** there is no XR menu. React overlays are unavailable in a headset and there is no dom-overlay. Only WebSG UICanvas in-world panels and the action bar slot-1 button work.
- **Input reliability:** `// TODO: In WebXR the pressed/release state doesn't work correctly.` (`input/ActionMappingSystem.ts:21`); `input.game.ts:47` TODO.
- **AR [PARTIAL/OK]:** scenes with `MX_scene_ar` support passthrough. The reference space resets via a thumbstick press (`WebXRAvatarRigSystem.ts` `ARActionMap`); AR participants hide each other's heads and hands. No hit-test or anchors.
- **Rendering cost:** XR forces rendering onto the main thread (see section 1).

---

## 8. Moderation / permissions

- **Power levels [OK]:** `usePowerLevels` (`ui/hooks/usePowerLevels.ts`) gates scene and script edits (`canSendStateEvent("org.matrix.msc3815.world")` in `WorldView.tsx:57`, `WorldSettings.tsx:188-223`).
- **Kick / ban / role changes [OK]:** the member list dialog offers Kick and Ban when `myPL > userPL`, and Make Member/Mod/Admin (0/50/100) when you are PL 100 (`ui/views/session/dialogs/MemberListDialog.tsx:85-145`, `utils/matrixUtils.ts:240`). These are standard Matrix actions. **The engine does not react to kicks explicitly**: removal relies on the user dropping out of the group call.
- **Per-user mute [OK, local]:** `toggleMutePeer` disables the remote audio tracks (`network/network.main.ts:185-202`).
- **"Ignore" [PARTIAL, local and session-only]:** calls `removePeer` to drop the peer's data channel and entities (`MemberListDialog.tsx:122-124`). It does not use Matrix `m.ignored_user_list`, is not persisted, and can be re-added when the member updates.
- **Block / hide avatar / safety shield / personal space bubble [ABSENT].**
- **Per-world rules:** only `max_member_object_cap`. No rules for who can spawn, who can grab, script permissions, voice zones or access-control zones **[ABSENT]**.
- **Host privileges:** none. The host is not chosen by power level (dead `HostElection.ts`), and any peer can steal ownership of any spawnable.
- **Report user/content [ABSENT].** Only a rageshake bug report exists (`ui/views/session/rageshake`).

---

## 9. Audio (`src/engine/audio/`)

- **Graph:** a WebAudio graph on the main thread with an ASCII diagram at `audio.main.ts:10-30`: limiter, master gain, and per-output gains (Environment, Music, Voice per `AudioEmitterOutput`), plus an analyser exposed to scripts.
- **Spatial voice [OK]:** each remote peer's MediaStream becomes an `AudioSource` with `uri: mediastream:<peerId>` on a positional emitter attached to their avatar (`PlayerRig.ts:205-212`; `audio.main.ts:252-253,774-800`).
  - It uses the emitter defaults: Inverse distance, `refDistance 1`, `maxDistance 10000`, rolloff 1 (`schema.ts:185-198`).
  - **No tuned voice falloff, no voice-range or broadcast zones, and no per-user volume slider.**
- **Emitters [OK]:** global and positional emitters with HRTF panner, cones, distance models and rolloff (`audio.main.ts:700-770`). One-shot SFX for footsteps and collisions (`audio.game.ts`). Music/environment/voice output buses.
- **Mic:** mute-on-join preference (`createMatrixNetworkInterface.ts:82-85`), a mute button in the world controls and the cmd panel, and a speaking detector via Hydrogen.
- **Absent:** occlusion, reverb zones, script-driven audio playback.

---

## 10. Tests, docs, known-incomplete areas

### Tests (vitest; `package.json` `"test": "vitest"`)

- `test/engine/network/index.test.ts`: network ID and transform/update/create/delete serialization. Contains `it.skip("should #createNetworkId")` at line 63.
- `test/engine/network/CursorView.test.ts`, `test/engine/component/transform.test.ts`.
- `test/ui/hooks/*`: observable hooks.
- `src/engine/scripting/scripting.test.ts`: thirdroom and matrix WASM module imports.
- `src/engine/resource/ResourceRingBuffer.test.ts`, `src/engine/RecycleBin.test.ts`, and `src/engine/utils/{AsyncTaskRunner,SpatialGrid,Historian,Pool}.test.ts`.
- No tests cover the renderer, physics, avatars, XR or end-to-end multiplayer.

### docs/ (vitepress)

- `index.md`
- `guides/`: creators, developers, self-hosting (Caddy, COOP/COEP headers), a full Unity exporter workflow (`unity/index.md`, 335 lines), and WebSG guides (scenegraph, meshes, materials, lighting, physics, interactables, UI, ECS, networking, action bar, plus the basketball tutorial).
- `gltf/`: a README and JSON schema per MX\_\* extension, plus MOZ_hubs_components notes.
- `protocol/`: an aspirational TRNP spec. **The implemented protocol differs**; see section 2.
- API docs are generated from `websg-types` via typedoc (`typedoc.json`, `docs/.vitepress/plugins/vitepress-plugin-typedoc.ts`).

### Notable known-incomplete or dead code

1. Custom 3D avatars are uploaded but never loaded in-engine (`PlayerRig.ts:58`), and `updateWorldProfile` is unused.
2. `HostElection.ts` is unused; host is "oldest member" (`createMatrixNetworkInterface.ts:198` TODO).
3. There are no unreliable data channels (`network.main.ts:240`), and script unreliable broadcast is unsupported.
4. Interpolation is off by default; `network.tickRate` is unused.
5. Scene animations never play (section 5).
6. Hand-tracking poses are captured but unused.
7. Editor reparent, focus and transform tools are stubs; edits are not persisted or networked.
8. Object caps are local-only (`spawnables.game.ts:334-335`).
9. Scripts have no CPU budget or capability model (`matrix.main.ts:146` TODO).
10. `websg.ts:376-380` TODOs: resource ownership and disposal of script entities on unload.
11. Peer index is a 16-bit murmurhash (collision risk); network IDs are 32-bit, not 64-bit as in the spec.
12. Renderer TODOs (`grep` found 41 TODO/FIXME/HACK in `src/engine/renderer`, `src/engine/input` and `src/plugins`): `UpdateNodeResourcesSystem.ts:85,160` ("Handle node.visible"), `:641` (mesh morph weights unsupported), `:431` (skinned-mesh frustum culling), `renderer.render.ts:262` HACK, `ui.ts:213` (independent border widths).
13. `GameWorker.ts:60` HACK; `RenderWorker.ts:9,94` TODOs.
14. Worlds are created unencrypted (`CreateWorldForm.tsx:105`).
