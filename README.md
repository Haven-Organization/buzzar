<div align="center">
  <img
    src="res/brand/banner-purple.svg"
    alt="Buzzar"
    width="420px"
    padding="40px"
  />
  <br/>
  <br/>
  <h3>Try Buzzar at <a href="https://buzzar.haven.software">https://buzzar.haven.software</a></h3>
</div>

Buzzar is a platform for shared virtual worlds built on top of [Matrix](https://matrix.org). Buzzar aims to
make it easy to discover, create, and share 3D worlds with others.

Buzzar is a fork of [Third Room](https://github.com/matrix-org/thirdroom), the Matrix.org Foundation's virtual world
client, whose development was paused in 2023. Buzzar picks up where Third Room left off, working toward VRChat-level
features (custom avatars, mirrors, scripted worlds, full VR support, world moderation tools) while staying as close
to a standard Matrix client as possible and remaining compatible with existing Third Room
([MSC3815](https://github.com/matrix-org/matrix-spec-proposals/pull/3815)) worlds. Third Room's full commit history is
preserved in this repository. User and developer documentation: **[haven.software/buzzar/docs](https://haven.software/buzzar/docs/)**.
See [docs/buzzar](./docs/buzzar/) for the roadmap and feature-parity checklist.

## Getting Started

Use the hosted app at **[buzzar.haven.software](https://buzzar.haven.software)** with any Matrix account, or see
[Local Development](#local-development) to run it yourself. (Third Room's own hosted instance at thirdroom.io is no
longer running.)

## Homeserver Requirements

- **Synapse 1.62 or later** (or another homeserver that sends `Cross-Origin-Resource-Policy: cross-origin` on media
  downloads). Buzzar uses SharedArrayBuffers, which need a
  [secure, cross-origin isolated context](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements),
  so world and avatar files must be loadable across origins.
- **LiveKit**, for world calls (the default call type): a [LiveKit](https://livekit.io) server plus the MatrixRTC
  authorization service ([lk-jwt-service](https://github.com/element-hq/lk-jwt-service)), announced in your
  `.well-known/matrix/client` under `org.matrix.msc4143.rtc_foci`. It's the same setup Element Call uses; see its
  [self-hosting guide](https://github.com/element-hq/element-call/blob/main/docs/self_hosting.md). Only whoever starts
  a world's call needs it: everyone who joins after them uses that server.
- **Delayed events** ([MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140)), recommended: players
  who close the app without leaving drop out of the call within seconds instead of staying listed until their
  membership expires. In Synapse, set `max_event_delay_duration` (for example `24h`).
- **TURN**, for peer-to-peer (mesh) calls: a world can still choose a peer-to-peer call (World Settings → Calls), and
  Buzzar offers one when a LiveKit call can't connect. Those connect players directly, through your homeserver's TURN
  relay when a direct path fails; see Synapse's [TURN guide](https://element-hq.github.io/synapse/latest/turn-howto.html).

## About Buzzar

Buzzar enables people to discover and create virtual worlds while protecting their privacy and giving them ownership over their data. We use open standards to ensure that both the 3d content and social networking data is portable and interoperable with other platforms. We empower creators to design and program rich and interactive virtual worlds and avatars using a wide variety of 3D content creation tools and harnessing the power of the glTF file format.

The Buzzar client developed in this repository is only one implementation of a possible Matrix virtual world client and we welcome additional web or native clients to implement the protocols we design together. Buzzar itself is designed around the Matrix protocol, but pieces of this project can be utilized in other 3D web applications including other virtual world platforms. We intend to build the client in a modular fashion, improving the overall landscape for the 3D web ecosystem and being a good participant in the open source community that we are benefitting from.

We will be a good participant in the immersive web. Buzzar is just one piece of the overall immersive web. We believe platforms that intend to create their own "metaverse" are missing the point of that term. There is only one metaverse just as there is only one internet. We will embrace and encourage interoperability instead of accepting fragmentation.

Buzzar at its core is focused on creating spaces for people and communities to feel safe. We will foster an open community that is kind, respectful, and accepting of others. We will utilize Matrix's existing moderation tools and extend them to best protect our community members against trolls and harassment. We will put users in control of their own privacy and always design with a privacy and safety first mindset.

## Problems

- Virtual worlds are disconnected which makes multiplayer gaming and switching activities or applications difficult and clunky.
- Some virtual world platforms are monetized with an ad based model that uses sensitive user data to recommend ads.
- There is high demand from audiences for free user-generated content games on platforms where creators make next to nothing. The audiences and creators for these platforms heavily skew younger and are being exploited by platform operators.
- The quality of these user-generated games can be high but most are not due to the platform restrictions especially around monetization opportunities. Creators cannot afford to create indie/AAA content.

## The Pitch

- Buzzar is built on top of the Matrix protocol allowing for decentralized hosting of virtual worlds.
- Worlds can be traversed quickly by changing rooms.
- Your identity, network, and other shared data will be brought with you between these worlds.
- Worlds will have spatial voice chat and game networking that can be made end-to-end encrypted so that you know you are only sending data to the people in the room.
- Creators of all skill levels will be able to create worlds using either a beginner-friendly in-world collaborative tool or industry-standard 3D tools.
- Creators will be able to use the programming language of their choice compiled to WebAssembly to add interactivity to their worlds.
- Creators will also be able to monetize their worlds through marketplaces for 3D content including avatars, environments, and props as well as scripts. They also can monetize room or server membership.

### Matrix

Buzzar's voice and game networking run in a world's call, set up over Matrix: by default a MatrixRTC session
([MSC4143](https://github.com/matrix-org/matrix-spec-proposals/pull/4143)) through a LiveKit server
([MSC4195](https://github.com/matrix-org/matrix-spec-proposals/pull/4195)), or a peer-to-peer group call as in Third
Room ([MSC3401](https://github.com/matrix-org/matrix-spec-proposals/blob/matthew/group-voip/proposals/3401-group-voip.md)).
The Matrix client is [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk), with end-to-end encryption from its
Rust crypto. Matrix is also used for hosting
the 3D assets for these virtual worlds and your avatars as well as providing decentralized identity, end to end
encryption, text chat, room permissions, and more. Third Room started work on a Matrix spec for virtual worlds
([MSC3815](https://github.com/matrix-org/matrix-spec-proposals/pull/3815)); Buzzar plans to propose a successor MSC
that forks it while keeping existing MSC3815 worlds working.

### Open Source / License

Buzzar is completely open source under the [Apache 2.0 license](./LICENSE), the same license as Third Room. You can
check out this repository, fork it, and modify it as you please. Third Room, the project Buzzar is forked from, was
governed by the Matrix.org Foundation and developed in the open; its original development discussion took place in the
[#thirdroom-dev:matrix.org](https://matrix.to/#/%23thirdroom-dev:matrix.org) Matrix room. Buzzar is developed at
[Haven-Organization/buzzar](https://github.com/Haven-Organization/buzzar).

## Manifold Engine

Manifold, the engine Buzzar inherits from Third Room, lives under the [/src/engine](./src/engine/) directory of this project. It is developed
with the bitECS and Three.js libraries. It is eventually intended to be published as a standalone project for use with
or without Matrix, but it is currently under active development and not ready for a public release yet.

### Entity Component System (ECS)

Manifold is built with [bitECS](https://github.com/NateTheGreatt/bitECS), a high performance ECS library written in
JavaScript. bitECS is built around [Data Oriented Design](https://www.dataorienteddesign.com/dodbook/) and JavaScript's
TypedArrays to improve CPU cache performance.

In addition to performance, ECS design lets us have predictable execution of systems and more easily debug issues that
arise in our game loop.

We've also adopted bitECS's function programming patterns throughout our engine for simpler abstractions, better tree
shaking, and faster design iteration.

### Multithreading

Manifold is designed around a multithreaded architecture which allows us to fully utilize your system's hardware. As a
result, the core of the engine is split across these different threads. We have carefully built out lock-free scene
graph data structures backed by JavaScript's
[SharedArrayBuffers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
and [Atomics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics). This allows us
to split the renderer from the game thread and run each at different rates. With high refresh rate monitors becoming
the norm, this is becoming increasingly important. You can now get smooth 120hz+ rendering while your game logic runs
at a stable 60hz. Allowing for the renderer thread to submit draw calls as soon as possible in the frame and keep the
GPU saturated while your game logic gets a full 16ms to run complex physics simulations and more. The render thread
then uses interpolation to smoothly animate the transforms of objects in your scene.

Another short term option we are considering for reducing input latency is with a locking double buffered approach.
Where the game simulation is ran at the same rate as your monitor's refresh rate. This approach has the game thread
computing the state of the next frame and the render thread rendering the last frame's state. It requires the game
simulation to complete within the time frame of your monitor's refresh rate or you will drop frames which may not be
preferable when you are bound by your game's simulation. However, if your simulation is simple, this can be a good
option for reducing input latency. It's also possible that we may be able to switch between these two approaches
depending on the average execution time of your game thread on your particular device.

Browser limitations and API adoption of things like [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
and [Atomics.waitAsync](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync)
create design constraints that are fairly unique to the Web. Our current architecture lets us stay flexible and adapt
to advancements in browser technology.

### Rendering

Manifold uses Three.js as its rendering library. However, the Three.js API is not intended to be used directly by Buzzar
developers. We've built a multi-threaded scene graph API with a similar shape to the
[glTF](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html) data model. Our intention is for glTF content to
be loaded on the game thread, passed to the render thread via the
[MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) `postMessage` API, and then
modifications to transforms or materials can be made synchronously on the game thread with data structures backed by
SharedArrayBuffers. These rendering changes will be applied on the next render frame.

The renderer itself currently exists on either a dedicated WebWorker when OffscreenCanvas is available, or it shares
the main browser thread when it's not.

Three.js is built around the WebGL API and recently switched over to WebGL2 as the default. There is also early support
for the WebGPU support. We're currently focusing on the WebGL2 target as browser support is very good now and we can
get some performance improvements over WebGL1 with features like Uniform Buffer Objects and Vertex Array Objects.

Most of our rendering features will be tied to the glTF
[specification](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html) and
[extensions](https://github.com/KhronosGroup/glTF/tree/main/extensions).

Currently supported:

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
- [MOZ_lightmap](https://github.com/takahirox/MOZ_lightmap) (draft; as used by Mozilla Hubs scenes) and Third Room's
  own `MX_lightmap`
- [KHR_lights_shadows](https://github.com/takahirox/KHR_lights_shadows) (draft) and Third Room's own `MX_lights_shadows`

To Do:

- [KHR_materials_anisotropy](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_anisotropy/README.md):
  needs Three.js r153 or later (Buzzar uses a fork of 0.148).

These need custom shaders (Three.js doesn't draw them):

- [KHR_materials_diffuse_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_diffuse_transmission/README.md)
- [KHR_materials_sss](https://github.com/KhronosGroup/glTF/blob/5784a1edc85ad3323dc0ff1fa42ad49525d3f598/extensions/2.0/Khronos/KHR_materials_sss/README.md)

Not started:

- [EXT_texture_video](https://github.com/takahirox/EXT_texture_video) (draft): video textures. Wants the synced video
  playback planned for world scripts first.

Instead of the Three.js GLTFLoader, we've implemented our own glTF loader that works with our multithreaded
architecture. However, the renderer is still using Three.js. This means as Three.js improves support for glTF
rendering features we hope to add support as well. We may also be able to push support for certain glTF material
features faster than Three.js in our own loader.

Beyond glTF materials, the renderer has bloom, a hover and selection outline, mirrors
([HAVEN_mirror](./docs/gltf/HAVEN_mirror/README.md)), reflection probes, light maps, and sun shadows a world can turn
on. For performance it draws repeated meshes as one instanced mesh, compiles shaders behind the loading screen, scales
resolution to hold the frame rate, and can hide avatars beyond a distance (Avatar Culling, like VRChat's). Cascaded
shadow maps and level of detail are still to come.

### Physics

Manifold uses [Rapier.js](https://www.rapier.rs/docs/user_guides/javascript/getting_started_js) for physics which is a
WebAssembly port of the Rapier Rust physics engine. It's a fast and relatively light library with well-documented APIs
and active development. We run our physics system on the game thread for synchronous access to the physics world.

We're helping standardize embedding of physics data in glTF in the
[Open Metaverse Interoperability Group](https://omigroup.org/) with the following extensions:

- [OMI_collider](https://github.com/omigroup/gltf-extensions/blob/b14522f7b000cfc9d2c0fc4fc9de38af68d0394e/extensions/2.0/OMI_collider/README.md)
- [OMI_physics_body](https://github.com/omigroup/gltf-extensions/blob/3f5a9f3bfd3117d8a201b20d48acb7f02244edff/extensions/2.0/OMI_physics_body/README.md)

### Audio

Manifold uses the WebAudio API for spatialized audio from other users and environmental audio. We're still
investigating how we might best use features such as [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
and third party libraries such as [Oddio](https://github.com/Ralith/oddio).

### Networking

Everyone in a world is in its call: that's how players see each other move and hear each other talk. Manifold's game
networking runs over per-player data channels, behind an interface you can plug your own network into; Buzzar connects
it to Matrix in one of two ways, chosen per world (**World Settings → Calls**, stored in the world's
`software.haven.world.call` state event):

- **LiveKit** ([MatrixRTC, MSC4143](https://github.com/matrix-org/matrix-spec-proposals/pull/4143) with a
  [LiveKit SFU, MSC4195](https://github.com/matrix-org/matrix-spec-proposals/pull/4195)): everyone connects to a
  LiveKit server, which forwards voices and game data, so a world holds far more players than a full mesh. Membership is
  a MatrixRTC session in the world room (slot `software.haven.world#main`), kept by matrix-js-sdk with a delayed leave
  event (MSC4140) where the homeserver supports it, so players who vanish drop out within seconds. The LiveKit server
  comes from the homeserver's `org.matrix.msc4143.rtc_foci` (`.well-known/matrix/client`); everyone in a call uses the
  oldest member's, so they all meet on one server. Game data travels as reliable LiveKit data packets addressed to each
  player, chunked to fit LiveKit's packet size. It's the default for worlds that don't choose, and what Buzzar's
  public worlds use. A busy world splits into **instances** (like VRChat's), each its own MatrixRTC slot
  (`software.haven.world#<instance>`) and LiveKit room; the world sets how many players fit in one (40 by default).
- **Peer-to-peer** ([MSC3401](https://github.com/matrix-org/matrix-spec-proposals/blob/matthew/group-voip/proposals/3401-group-voip.md)
  group calls, as in Third Room): every player connects to every other over WebRTC, through the homeserver's TURN
  relay when a direct path fails. Every Buzzar version (and Third Room) speaks it. It holds 16 players: each one sends
  their voice and movement to everyone else (about 55 kbit/s per other player while talking and moving).

Players only see and hear the others in the same call. If someone arrives while a call of the other type is open,
Buzzar asks which one to join, saying who is in each. If a LiveKit call can't connect, Buzzar says why and offers a
peer-to-peer call instead.

Voices are spatial and modelled on VRChat's per-player voice settings: full volume close by, falling off fast and
muffled with distance, silent past the world's voice range (25 m by default). In a LiveKit call you don't even receive
the voices you can't hear, which keeps crowded worlds light. Worlds set their voice defaults in their glTF
([HAVEN_voice](./docs/gltf/HAVEN_voice/README.md)), mark stages and other voice zones
([HAVEN_voice_zone](./docs/gltf/HAVEN_voice_zone/README.md)), and world scripts can adjust how a player is heard
(`peer.setVoice`, like VRChat's `SetVoice*`).

Data channels are ordered and reliable today; unreliable delivery for fast-changing data like transforms is planned, as
is end-to-end encrypted LiveKit media. The network
protocol is documented in the [protocol docs](./docs/protocol/index.md), with the aim of standardising it as part of a
virtual world Matrix spec.

### WebXR

Buzzar runs in immersive VR and AR through WebXR: controllers with their input-profile models, smooth locomotion and
snap turning. In XR the renderer moves to the main thread, for the lowest input latency. Hand tracking, in-headset
menus and full-body tracking are still to come (see the [parity checklist](./docs/buzzar/parity-checklist.md)). On
phones and tablets, touch controls (a joystick, drag to look and on-screen buttons) stand in for keyboard and mouse.

### Editor

The Manifold Editor will be built into the game engine and will be able to be launched at any time while in a scene.
It is being designed from the start for collaborative world building. The editor will make use of glTF as both its
authoring and runtime format. glTF was designed as a transmission format for real-time graphics, not an authoring
format for DCC tools like Blender or Maya. However, we believe there is a middle ground where glTF can be the
foundation for a format that enables composition of assets similar to how HTML allows you to embed images, video,
iframes, and more.

### User Generated Content and Sandboxed Scripting

Buzzar worlds and avatars are owned by their creators. Worlds and avatars are published as glTF files hosted on the
Matrix network or elsewhere. Creators will also be able to embed WebAssembly scripts inside their glTF content,
enabling custom behaviors. Manifold's APIs are built around the ability to safely provide performant manipulation of a
glTF scene graph from a WebAssembly module. This enables us to run partially untrusted scripts safely in your
Buzzar client as you navigate from world to world.

We hope to standardize this WebAssembly Scene Graph API as a member of the Open Metaverse Interoperability Group's
[Scripting Working Group](https://github.com/omigroup/omi-scripting-group).

World scripts work today through an early version of the Web Scene Graph API: see the
[WebSG docs](https://haven.software/buzzar/docs/guides/websg/). A script asks the player before it uses their Matrix
account (reading the world chat, posting a message).

## Creating Your Own Scenes

Buzzar worlds are glTF files, so any tool that exports glTF (Blender, Unity, and others) can make one. Interactive
parts (mirrors, seats, grabbable objects, avatar pedestals, voice zones, screens and more) are described by Buzzar's
`HAVEN_*` glTF extensions, documented in [docs/gltf](./docs/gltf/index.md); scenes made for Mozilla Hubs keep many of
their components ([MOZ_hubs_components](./docs/gltf/MOZ_hubs_components/README.md)). The Third Room project's
[Unity exporter](https://github.com/matrix-org/thirdroom-unity-exporter) still works for Third Room style scenes. The
[creators guide](https://haven.software/buzzar/docs/guides/creators) walks through making and publishing one.

## Local Development

The Buzzar client can be ran locally against any Matrix homeserver in development.

After you've installed node.js locally, run the following commands.

```
npm install -g yarn
yarn
yarn dev
```

**NOTE: Vite does not transpile import statements in web workers and Chromium based browsers are the only browsers to support imports in Web Workers. In order to develop in non-chromium browsers, run the following command which will build the project after every change.**

```
yarn preview
```

Open http://localhost:3000

## Deployment

The Buzzar client can be deployed to any static web host with the ability for wildcard routing for single page web
apps and adding HTTP headers.

The [Dockerfile](./Dockerfile) builds the app and serves it with nginx, headers included
(`docker build -t buzzar . && docker run -p 8080:80 buzzar`); edit `config.json` first to choose the default
homeserver. Outside localhost, put it behind TLS: browsers only allow the microphone and shared memory on secure
origins.

Third Room deployed to Netlify with GitHub Actions workflows, which this repository still contains (they expect
Third Room's `main` and `prod` branches; Buzzar develops on `develop`). If you fork the repository and set the
`NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` secrets, they can deploy your fork the same way.

To setup OIDC login client configs needs to be added in `config.json`. Client configs includes `client_id` and `uris` issued by OIDC Provider.
