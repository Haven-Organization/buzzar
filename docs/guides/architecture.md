# Engine and Architecture

How the Buzzar client is built: the Manifold engine it inherits from Third Room, and how worlds use Matrix.

## Matrix

Buzzar is a Matrix client built on [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk), with end-to-end encryption from its Rust crypto. Matrix carries almost everything:

- **Identity:** your account.
- **Text chat.**
- **Room permissions.**
- **Files:** worlds, avatars and other 3D files, stored as Matrix media.
- **World settings:** state events in each world's room.

A world is a Matrix room. Third Room started a Matrix spec for virtual worlds, [MSC3815](https://github.com/matrix-org/matrix-spec-proposals/pull/3815). Buzzar plans to propose a successor MSC that forks it while keeping existing MSC3815 worlds working.

Voice and game networking run in a world's call, set up over Matrix (see [Networking](#networking)).

## Manifold engine

Manifold, the engine Buzzar inherits from Third Room, lives in [`src/engine`](https://github.com/Haven-Organization/buzzar/tree/develop/src/engine). It's built with bitECS and Three.js. Third Room meant to publish it as a standalone project, usable with or without Matrix, but it isn't ready for that yet.

### Entity Component System (ECS)

Manifold is built with [bitECS](https://github.com/NateTheGreatt/bitECS), a high-performance ECS library written in JavaScript. bitECS is built around [Data Oriented Design](https://www.dataorienteddesign.com/dodbook/) and JavaScript's TypedArrays, to improve CPU cache performance.

ECS also gives predictable execution of systems, and makes issues in the game loop easier to debug. bitECS's functional programming patterns are used throughout the engine, for simpler abstractions, better tree shaking and faster iteration.

### Multithreading

Manifold splits its core across threads, to make full use of your hardware. Lock-free scene graph data structures, backed by [SharedArrayBuffers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) and [Atomics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics), let the renderer and the game logic run on separate threads at different rates:

- On a high refresh rate monitor, rendering can run at 120 Hz or more while game logic runs at a steady 60 Hz.
- The render thread submits draw calls as early in the frame as possible, keeping the GPU busy.
- The game thread gets a full 16 ms for physics and the rest.
- The render thread interpolates object transforms, so motion stays smooth.

SharedArrayBuffers are also why Buzzar needs a [cross-origin isolated context](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements), and why world and avatar files must be loadable across origins.

**An option for lower input latency:** a locking, double-buffered approach that runs the game simulation at the monitor's refresh rate. The game thread computes the next frame while the render thread draws the last one.
- **Catch:** the simulation must finish within one refresh, or frames drop. That's a bad trade when the game's simulation is the bottleneck, but a good one for simple simulations.
- The engine might switch between the two approaches depending on how long the game thread takes on a given device.

Browser limits, and how widely APIs like [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) and [Atomics.waitAsync](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync) are supported, constrain the design in ways fairly unique to the web. The current architecture leaves room to adapt as browsers improve.

### Rendering

Manifold renders with Three.js (a fork of 0.148), but Buzzar code doesn't use the Three.js API directly. Instead there is a multithreaded scene graph API shaped like the [glTF](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html) data model:

1. glTF content loads on the game thread.
2. It's passed to the render thread with [MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) `postMessage`.
3. Changes to transforms or materials are made synchronously on the game thread, in SharedArrayBuffer-backed data structures.
4. The renderer applies them on the next frame.

The renderer runs on its own Web Worker when OffscreenCanvas is available, and on the main browser thread otherwise. It targets WebGL2.

Manifold has its own glTF loader, built for the multithreaded design, rather than Three.js's GLTFLoader. As Three.js improves its glTF rendering, Buzzar can pick that up, and the loader can sometimes support a material feature before Three.js does.

Most rendering features follow the glTF [specification](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html) and [extensions](https://github.com/KhronosGroup/glTF/tree/main/extensions). Supported:

- [KHR_materials_unlit](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md)
- [KHR_materials_emissive_strength](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md)
- [KHR_materials_ior](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_ior/README.md)
- [KHR_materials_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md)
- [KHR_materials_volume](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md)
- [KHR_materials_clearcoat](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_clearcoat/README.md)
- [KHR_materials_sheen](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_sheen/README.md)
- [KHR_materials_specular](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_specular/README.md)
- [KHR_materials_iridescence](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_iridescence/README.md)
- [KHR_texture_transform](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform/README.md)
- [KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md)
- [EXT_texture_webp](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_webp/README.md)
- [KHR_draco_mesh_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md)
- [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md)
- [KHR_mesh_quantization](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md)
- [EXT_mesh_gpu_instancing](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md)
- [KHR_lights_punctual](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md)
- [MOZ_lightmap](https://github.com/takahirox/MOZ_lightmap) (draft; as used by Mozilla Hubs scenes) and Third Room's own `MX_lightmap`
- [KHR_lights_shadows](https://github.com/takahirox/KHR_lights_shadows) (draft) and Third Room's own `MX_lights_shadows`

To do:

- [KHR_materials_anisotropy](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_anisotropy/README.md): needs Three.js r153 or later.
- [KHR_materials_diffuse_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_diffuse_transmission/README.md) and [KHR_materials_sss](https://github.com/KhronosGroup/glTF/blob/5784a1edc85ad3323dc0ff1fa42ad49525d3f598/extensions/2.0/Khronos/KHR_materials_sss/README.md): need custom shaders (Three.js doesn't draw them).
- [EXT_texture_video](https://github.com/takahirox/EXT_texture_video) (draft): video textures. Not started; it wants the synced video playback planned for world scripts first.

Beyond glTF materials, the renderer has:

- bloom;
- a hover and selection outline;
- mirrors ([HAVEN_mirror](/gltf/HAVEN_mirror/README));
- reflection probes;
- light maps;
- sun shadows that a world can turn on.

For performance, it:

- draws repeated meshes as one instanced mesh;
- compiles shaders behind the loading screen;
- scales resolution to hold the frame rate;
- can hide avatars beyond a distance (Avatar Culling, like VRChat's).

Cascaded shadow maps and level of detail are still to come.

### Physics

Manifold uses [Rapier.js](https://www.rapier.rs/docs/user_guides/javascript/getting_started_js) for physics: a WebAssembly build of the Rapier Rust physics engine. It's fast and fairly light, with well-documented APIs and active development. Physics runs on the game thread, for synchronous access to the physics world.

Physics data in glTF files follows the [Open Metaverse Interoperability Group](https://omigroup.org/)'s extensions:

- [OMI_collider](https://github.com/omigroup/gltf-extensions/blob/b14522f7b000cfc9d2c0fc4fc9de38af68d0394e/extensions/2.0/OMI_collider/README.md)
- [OMI_physics_body](https://github.com/omigroup/gltf-extensions/blob/3f5a9f3bfd3117d8a201b20d48acb7f02244edff/extensions/2.0/OMI_physics_body/README.md)

### Audio

Manifold uses the Web Audio API for spatial audio, both other players' voices and sounds in the world. Possible future directions include [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) and libraries such as [Oddio](https://github.com/Ralith/oddio).

### Networking

Everyone in a world is in its call: that's how players see each other move and hear each other talk. Manifold's game networking runs over per-player data channels, behind an interface you can plug your own network into.

Buzzar connects it to Matrix in one of two ways, chosen per world in **World Settings → Calls** (stored in the world's `software.haven.world.call` state event).

**LiveKit** ([MatrixRTC, MSC4143](https://github.com/matrix-org/matrix-spec-proposals/pull/4143), with a [LiveKit SFU, MSC4195](https://github.com/matrix-org/matrix-spec-proposals/pull/4195)) is the default for worlds that don't choose, and what Buzzar's public worlds use.
- Everyone connects to a LiveKit server, which forwards voices and game data, so a world holds far more players than a full mesh.
- Membership is a MatrixRTC session in the world room (slot `software.haven.world#main`), kept by matrix-js-sdk.
- Where the homeserver supports it, a delayed leave event (MSC4140) means players who vanish drop out within seconds.
- The LiveKit server comes from the homeserver's `org.matrix.msc4143.rtc_foci` (`.well-known/matrix/client`). Everyone in a call uses the oldest member's server, so they all meet on one.
- Game data travels as reliable LiveKit data packets addressed to each player, chunked to fit LiveKit's packet size.
- A busy world splits into **instances** (like VRChat's). Each is its own MatrixRTC slot (`software.haven.world#<instance>`) and LiveKit room. The world sets how many players fit in one (40 by default).

**Peer-to-peer** ([MSC3401](https://github.com/matrix-org/matrix-spec-proposals/blob/matthew/group-voip/proposals/3401-group-voip.md) group calls, as in Third Room) is spoken by every Buzzar version, and by Third Room.
- Every player connects to every other over WebRTC, through the homeserver's TURN relay when a direct path fails.
- It holds 16 players: each one sends their voice and movement to everyone else, about 55 kbit/s per other player while talking and moving.

Players only see and hear others in the same call. If someone arrives while a call of the other type is open, Buzzar asks which one to join, saying who is in each. If a LiveKit call can't connect, Buzzar says why and offers a peer-to-peer call instead.

Voices are spatial, modelled on VRChat's per-player voice settings:
- They're at full volume close by, fall off fast and sound muffled with distance, and go silent past the world's voice range (25 m by default).
- In a LiveKit call, you don't even receive voices you can't hear, which keeps crowded worlds light.
- Worlds set their voice defaults in their glTF ([HAVEN_voice](/gltf/HAVEN_voice/README)), and mark stages and other voice zones ([HAVEN_voice_zone](/gltf/HAVEN_voice_zone/README)).
- World scripts can adjust how a player is heard (`peer.setVoice`, like VRChat's `SetVoice*`).

Data channels are ordered and reliable today. Unreliable delivery for fast-changing data like transforms is planned, as is end-to-end encrypted LiveKit media.

The network protocol is documented in the [protocol docs](/protocol/), with the aim of standardising it as part of a virtual world Matrix spec.

### WebXR

Buzzar runs in immersive VR and AR through WebXR, with:

- controllers, shown with their input-profile models;
- smooth locomotion;
- snap turning.

In XR the renderer moves to the main thread, for the lowest input latency. Hand tracking, in-headset menus and full-body tracking are still to come.

On phones and tablets, touch controls (a joystick, drag to look, and on-screen buttons) stand in for keyboard and mouse.

### Editor

Third Room started an editor built into the engine, which can be opened at any time in a scene. Buzzar inherited it, unfinished.
- It was designed from the start for building worlds together.
- It uses glTF as both its authoring and its runtime format.
- glTF was designed for delivering real-time graphics, not for authoring in tools like Blender or Maya. The aim is a middle ground: a format built on glTF that composes assets the way HTML embeds images, video and iframes.

### Scripting

Worlds and avatars are glTF files owned by their creators, hosted on Matrix or elsewhere.
- Creators can embed WebAssembly scripts in that content to add behaviour.
- Manifold's APIs give a WebAssembly module safe, fast control of a glTF scene graph, so Buzzar can run partly untrusted scripts as you move from world to world.
- A script asks the player before it uses their Matrix account, for example to read the world chat or post a message.

World scripts work today through an early version of the Web Scene Graph API: see [Web Scene Graph](/guides/websg/). The aim is to standardise this API through the Open Metaverse Interoperability Group's [Scripting Working Group](https://github.com/omigroup/omi-scripting-group).
