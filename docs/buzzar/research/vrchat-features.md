# VRChat Feature Inventory for Buzzar Parity

This is a research inventory of VRChat's creator and user features, for Buzzar (a Matrix/WebXR/three.js social VR client forked from Third Room). It was compiled 2026-11-13 from creators.vrchat.com, docs.vrchat.com, the VRChat creator guidelines, ask.vrchat.com developer updates, and community wiki/guides.

**Confidence markers:**

- **[doc]** means the official documentation states it.
- **[community]** means it comes from the wiki, feedback boards, or third-party guides.
- **[inferred]** means it is my own synthesis or recollection and should be verified.

Most fetches went through a summarizing fetcher. Treat exact numbers as "as documented at time of fetch" and re-check before you hard-code them.

---

## 0. Buzzar parity priorities (summary)

| Priority | Feature cluster                                                                                                          | Why it matters                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| P0       | Instance ownership, synced state (manual and continuous), network events with sender identity, late-joiner state         | Every game world (Audience Anarchy) depends on these |
| P0       | Player API: teleport, speed, jump, gravity, immobilize, voice gain and distance per player, tags                         | Stage and audience control, broadcast "host" voice   |
| P0       | Avatar scaling with world-set min and max, plus eye-height-changed events                                                | The user's requirement and anti-exploit              |
| P0       | Safety and shield system, block, mute, hide avatar, performance ranks                                                    | Table stakes for public social VR                    |
| P1       | Group roles and permissions, instance types, instance moderation (warn, mute, kick, ban), audit log, age-gated instances | Communities and events                               |
| P1       | Pickups, ObjectSync, ObjectPool, Stations, PlayerObjects, Persistence (PlayerData)                                       | Interactive worlds                                   |
| P1       | Expression menu, parameters, Action layer emotes with audio, PhysBones, Contacts, OSC                                    | Avatar expressiveness                                |
| P1       | Purchase and entitlement queries from world script (Udon Store API equivalent), backed by external servers               | Paid benefits                                        |
| P2       | Video players with URL allowlist, string and image loading with allowlist and rate limits, MIDI                          | Media and dynamic content                            |
| P2       | Items/props inventory, placement zones                                                                                   | User-spawned objects                                 |

---

## 1. Avatars (SDK3)

### 1.1 Avatar Descriptor and core

- **View Position.** The eye or camera point, placed between the eyes. It defines "prefab eye height" for scaling. [doc] https://creators.vrchat.com/avatars/creating-your-first-avatar/
- **Lip sync modes (6):** Default/Auto Detect, Jaw Flap Bone, Viseme Blend Shape (recommended; 15 Oculus visemes, auto-detected), Jaw Flap Blend Shape, Viseme Parameter Only (drives the `Viseme` animator int), and Viseme Blend Shape via Face Tracking. [doc] same URL
- **Eye Look / eyelids.** Configured in the Face Tracking section. Eye look can be driven by bone rotation, by face tracking, or both. The client provides automatic eye movement and blinking. [doc] https://creators.vrchat.com/avatars/
- **Native face tracking.** Avatars SDK 3.10.6+ adds SDK-level face tracking authoring with Unified Expressions (VRCFT standard). It syncs about 102 expression values without using the synced parameter budget. It reached the live release around 2026.4.1 (October 2026). [community: UploadVR, mixed-news, vr.org]
- **Built-in parameters `UserEyeTracking` and `UserFaceTracking`.** These are not counted toward the bit budget. [doc] https://creators.vrchat.com/avatars/animator-parameters/
- **"Face Tracking Operations" performance stat.** Ranks: Excellent 2,000, Good 4,000, Medium 8,000, Poor 16,000. [doc] https://creators.vrchat.com/avatars/avatar-performance-ranking-system/
- **Poses: T-Pose, IK Pose, Sitting Pose.** These are calibration and seated poses (wingspan, IPD, joint bend directions). [doc] https://creators.vrchat.com/avatars/playable-layers/
- **Humanoid vs Generic rigs.** Humanoid avatars get 5 playable layers; generic avatars get 3 (Base, Action, FX). [doc] same

### 1.2 Playable layers

https://creators.vrchat.com/avatars/playable-layers/ [doc]

- **Base:** locomotion (walk, run, strafe, jump, fall, crouch, crawl). Transforms only.
- **Additive:** additive blending on top of Base (for example, breathing). Transforms only.
- **Gesture:** hand gestures (driven by `GestureLeft`/`GestureRight` ints 0–7, plus weights) and non-humanoid idle motion (tails, ears). Transforms only, and masks are used.
- **Action:** a full-body override for emotes and dances. Its weight is 0 by default; you blend it to 1 with Playable Layer Control, then back.
- **FX:** everything that isn't a humanoid transform: object toggles, material swaps, shader and blendshape animation, component properties. Only FX content is copied to the mirror clone.
- **Sitting, T-Pose, IK Pose:** special controllers.

### 1.3 State behaviors (animator "scripting")

https://creators.vrchat.com/avatars/state-behaviors/ [doc]

- **Avatar Parameter Driver:** Set, Add, Random, or Copy on state entry. It has an optional Local Only setting.
- **Animator Tracking Control:** switches head, hands, hips, feet, eyes, eyelids, and mouth/jaw between tracking and animation (needed for dances).
- **Animator Layer Control and Playable Layer Control:** weight blending over a duration.
- **Animator Temporary Pose Space:** moves the viewpoint, for lying down or sitting.
- **Animator Locomotion Control:** disables locomotion; room-scale movement still works.
- **Animator Play Audio.** This is the core of "scripted actions with audio":
  - Changes an AudioSource's clip, pitch, volume, and loop, and plays or stops on state enter or exit.
  - Clips can be chosen randomly, in rotation, or by an int parameter.
  - Volume is 0–1, pitch is −3 to 3, and the delay is up to 60 s.
- **Animator Face Tracking Blendshapes Set:** sets face-tracking blendshape-set weights.

**Emote/dance with audio pattern.** An expression-menu toggle sets a parameter, which triggers an Action-layer state. That state uses Playable Layer Control (blend in), Tracking Control (animation for body), Play Audio (music), and Locomotion Control (optional). On exit it reverses. Avatar audio is subject to the limits in 1.8. [doc, pattern inferred from components]

### 1.4 Expression menus and parameters

https://creators.vrchat.com/avatars/expression-menu-and-controls/ and https://creators.vrchat.com/avatars/animator-parameters/ [doc]

- **Control types:** Button (about 1 s pulse), Toggle, Sub-Menu (may set a parameter), Two-Axis Puppet (−1..1 ×2), Four-Axis Puppet (0..1 ×4), Radial Puppet (0..1).
- **Menu size:** up to 8 controls per menu. Sub-menus nest; no documented depth limit. Each control can have an icon.
- **Parameter types:** Int (0–255, 8 bits), Float (−1..1, 8 bits), Bool (1 bit).
  - Int and float bit-width can be reduced to a minimum of 2 bits (newer SDK).
  - Options include Lerp Duration and Signed/Unsigned representation.
  - Per-parameter flags: **Saved** (persists across avatar loads) and **Synced**.
- **Budget:** 256 bits of synced custom parameters. Up to 8,192 total custom parameters (synced and local). Built-ins don't count.
- **Sync rates:**
  - "Playable" sync is about 1–10 Hz.
  - "IK" sync is about 10 Hz. A puppet control switches its parameters to IK sync while open.
  - "Speech" parameters (`Viseme`, `Voice`) are computed locally from audio.
- **Built-in parameters (read-only):** IsLocal, PreviewMode, IsAnimatorEnabled, Viseme, Voice, GestureLeft/Right(+Weight), AngularY, VelocityX/Y/Z, VelocityMagnitude, Upright, Grounded, Seated, AFK, TrackingType, VRMode, MuteSelf, InStation, Earmuffs, IsOnFriendsList, AvatarVersion, UserEyeTracking, UserFaceTracking, ScaleModified, ScaleFactor, ScaleFactorInverse, EyeHeightAsMeters, EyeHeightAsPercent.
- **Action Menu** (radial UI that hosts the Expressions menu):
  - Root items: Gesture Toggle, Config, Emojis, Expressions, Close.
  - Opened by joystick click (Index/Touch), Menu hold, or `R` on desktop. On hand tracking, a pinch gesture opens it (2024.4.1+).
  - Flick or Pick selection modes.
  - Sources: [doc] https://docs.vrchat.com/docs/action-menu and [doc] https://docs.vrchat.com/docs/vrchat-202441

### 1.5 Avatar Dynamics

**PhysBones** — [doc] https://creators.vrchat.com/common-components/physbones

- Secondary motion chains with Pull, Spring/Momentum, Stiffness, Gravity (+falloff), and Immobile settings.
- Limits: None, Angle, Hinge, or Polar.
- Collision radius; colliders can be global or listed.
- Stretch & Squish with max stretch and max squish.
- Grab and Pose (Allow Grabbing, Allow Posing, Snap to Hand) with permissions for self or others.
- Auto-generated parameters: `{p}_IsGrabbed`, `_IsPosed`, `_Angle`, `_Stretch`, `_Squish`. These are computed on every client, so they need no sync.
- An avatar can have up to 4 global colliders (hands and fingers are standard). Worlds have no limit.
- World Udon can call `ReleaseGrabs()` and `ReleasePoses()`; these are local only.

**Contacts** — [doc] https://creators.vrchat.com/common-components/contacts

- A sender/receiver pair with Sphere, Capsule, or Box shapes. Max radius is 3 m; max box dimension is 6 m.
- Collision tags are case-sensitive, up to 16 per contact.
- Built-in tags: Head, Torso, Hand, Foot, Finger\*.
- Avatar filters: Allow Self, Allow Others, Local Only. Local-only receivers don't count toward rank, up to 256.
- Receiver types: Constant, OnEnter (with min velocity), Proximity (0–1 float).
- In worlds, `OnContactEnter(ContactEnterInfo)` and `OnContactExit` Udon events fire. Content-type filters cover worlds, avatars, and items.
- Contacts enable "boops", headpats, and avatar-to-world interaction (for example, a world button an avatar finger can press).

**VRC Constraints** — [doc] https://creators.vrchat.com/common-components/constraints

- Types: Position, Rotation, Scale, Parent, Aim, Look At.
- Extras beyond Unity constraints: Target Transform, Smoothing, Solve in Local Space, Freeze To World (world-locked props on avatars), Rebake Offsets.
- Unity constraints are auto-converted.
- Ranked by count and depth.

### 1.6 Avatar performance ranks

[doc] https://creators.vrchat.com/avatars/avatar-performance-ranking-system/

Ranks are Excellent, Good, Medium, Poor, and Very Poor. An avatar takes the worst rank of any stat, and disabled components count.

**PC (Excellent / Good / Medium / Poor):**

| Stat                         | Excellent | Good  | Medium  | Poor    |
| ---------------------------- | --------- | ----- | ------- | ------- |
| Triangles                    | 32k       | 70k   | 70k     | 70k     |
| Texture memory               | 40 MB     | 75 MB | 110 MB  | 150 MB  |
| Skinned meshes               | 1         | 2     | 8       | 16      |
| Basic meshes                 | 4         | 8     | 16      | 24      |
| Material slots               | 4         | 8     | 16      | 32      |
| PhysBone components          | 4         | 8     | 16      | 32      |
| PhysBone affected transforms | 16        | 64    | 128     | 256     |
| PhysBone colliders           | 4         | 8     | 16      | 32      |
| PhysBone collision checks    | 32        | 128   | 256     | 512     |
| Contacts                     | 8         | 16    | 24      | 32      |
| Constraints                  | 100       | 250   | 300     | 350     |
| Constraint depth             | 20        | 50    | 80      | 100     |
| Animators                    | 1         | 4     | 16      | 32      |
| Bones                        | 75        | 150   | 256     | 400     |
| Lights                       | 0         | 0     | 0       | 1       |
| Particle systems             | 0         | 4     | 8       | 16      |
| Active particles             | 0         | 300   | 1,000   | 2,500   |
| Mesh-particle active polys   | 0         | 1,000 | 2,000   | 5,000   |
| Trail renderers              | 1         | 2     | 4       | 8       |
| Line renderers               | 1         | 2     | 4       | 8       |
| Raycasts                     | 1         | 4     | 8       | 15      |
| Cloths                       | 0         | 1     | 1       | 1       |
| Cloth vertices               | 0         | 50    | 100     | 200     |
| Physics colliders            | 0         | 1     | 8       | 8       |
| Rigidbodies                  | 0         | 1     | 8       | 8       |
| **Audio sources**            | 1         | 4     | 8       | 8       |
| Forwarded parameters         | 10        | 20    | 30      | 40      |
| Bounds                       | 2.5 m³    | 4 m³  | 5×6×5 m | 5×6×5 m |

**Mobile (Quest, Android, iOS):**

| Stat           | Excellent | Good  | Medium | Poor  |
| -------------- | --------- | ----- | ------ | ----- |
| Triangles      | 7.5k      | 10k   | 15k    | 20k   |
| Texture memory | 10 MB     | 18 MB | 25 MB  | 40 MB |

- Mobile avatars have no lights, cloth, rigidbodies, or audio sources.
- Hard caps strip the components even if "Show Avatar" is on: 8 PhysBones / 64 transforms / 16 colliders / 64 checks, 16 contacts, and 150 constraints at depth 50.

**Default blocking:**

- PC: Minimum Displayed Performance Rank defaults to Very Poor (nothing blocked).
- Mobile: defaults to Medium (Poor and Very Poor are hidden). It can be relaxed only to Poor.
- Bounds never block an avatar.

### 1.7 Avatar scaling

- **User scale dial** in the Action Menu, roughly 0.2–5.0 m eye height. Changes preview in mirrors, then apply and sync. [doc] https://creators.vrchat.com/avatars/avatar-scaling/
- **Sync and enforcement:**
  - Eye height syncs, quantized to 3 decimals, and is smoothed on remote clients.
  - Root localScale is enforced; only Udon scaling can override it.
- **World APIs (VRCPlayerApi, local player):** [doc] https://creators.vrchat.com/worlds/udon/players/player-avatar-scaling/
  - `Get/SetManualAvatarScalingAllowed(bool)`: player-controlled vs world-authoritative.
  - `SetAvatarEyeHeightMinimumByMeters` (≥0.2 m) and `SetAvatarEyeHeightMaximumByMeters` (≤5 m), with getters.
  - `GetAvatarEyeHeightAsMeters`, which works on remote players.
  - `SetAvatarEyeHeightByMeters` and `SetAvatarEyeHeightByMultiplier` (× prefab height).
  - The Udon range is 0.01–10,000 m; only 0.1–100 m is supported.
  - A website toggle can disable scaling for the whole world.
- **Events:** `OnAvatarChanged(player)` and `OnAvatarEyeHeightChanged(player, prevEyeHeight)`. Worlds must re-apply limits in these events, or users bypass them by switching avatars. [doc] https://creators.vrchat.com/worlds/udon/avatar-events
- **Animator parameters** let avatars react to scale: ScaleModified, ScaleFactor, EyeHeightAsMeters, EyeHeightAsPercent.

### 1.8 Avatar audio

- **Audio source count:** limited by rank on PC (1/4/8/8). Mobile avatars have none.
- **VRC_SpatialAudioSource on avatars:** gain is capped at 10 dB and Far is capped at 40 m, enforced at runtime. A custom volume curve is allowed. [doc] https://creators.vrchat.com/worlds/components/vrc_spatialaudiosource
- **World override of avatar audio:** per player via Udon (`SetAvatarAudioGain` 0–10 dB default 10, FarRadius default 40, Near, VolumetricRadius, ForceSpatial, CustomCurve) — see §2.3. The legacy region-based `VRC_PlayerAudioOverride` is deprecated (limits only, not boosts; Gain<0 or Far=0 mutes avatar audio). [doc] https://docs.vrchat.com/docs/vrc_playeraudiooverride
- **Safety controls:** the "Audio" toggle per trust rank disables avatar audio (§6).

### 1.9 Impostors, fallbacks, pedestals, switching, favorites

- **Impostors:** auto-generated low-cost "body doubles" shown in place of blocked or unloaded avatars. Only owners can generate them. Humanoid only. Customize with the `VRCImpostorSettings` component. [doc] https://creators.vrchat.com/avatars/avatar-impostors
- **Fallback avatars:** were removed from the client in 2025.2.2 in favor of impostors; the website selection may remain. [community] https://wiki.vrchat.com/wiki/Fallbacks
- **VRC_AvatarPedestal:** shows an avatar by blueprint ID.
  - `SwitchAvatar(id)` changes the displayed avatar.
  - `SetAvatarUse(localPlayer)` puts the user into it, with ChangeAvatarsOnUse.
  - Release status rules: Public (everyone), Private (owner only), Marketplace (non-owners see the purchase page).
  - World Udon cannot force-change a user's avatar outside pedestal interaction; this is a policy prohibition (§6.6).
  - Source: [doc] https://creators.vrchat.com/worlds/components/vrc_avatarpedestal
- **Favorites:** avatar favorites groups (larger with VRC+), avatar search, and personal uploads. [inferred, user-facing]
- **Avatar Marketplace:** creator-economy Avatar Products, with `VRCOpenMenu.OpenAvatarListing(avatarId)` from a world. [doc] §3

### 1.10 OSC

[doc] https://docs.vrchat.com/docs/osc-overview and https://docs.vrchat.com/docs/osc-avatar-parameters

- UDP. The client receives on 9000 and sends on 9001 by default; override with `--osc=in:ip:out`. Enabled in the Action Menu under OSC.
- **Avatar parameters:**
  - `/avatar/parameters/<name>` in and out (Int, Bool, Float).
  - `/avatar/change` carries the avatar ID.
  - A per-avatar JSON config is stored under `VRChat/OSC/{userId}/Avatars/{avatarId}.json`.
  - Locally set floats are stored as 32-bit, then synced at the parameter's bit width.
- **Also documented** (not fetched in detail; [inferred] from doc index):
  - `/input/*` virtual buttons and axes (move, look, jump, use, grab, voice).
  - `/chatbox/input` and `/chatbox/typing` for the chatbox.
  - `/tracking/trackers/*` for OSC full-body trackers and head alignment (https://docs.vrchat.com/docs/osc-trackers).
  - Eye-tracking OSC.
  - OSCQuery (mDNS/Zeroconf discovery).
- **"Scripted actions with audio" via OSC:** an external app (for example, a music or dance sync tool, TTS, or a heart-rate monitor) drives parameters. Those trigger Action-layer emotes with Play Audio, or chatbox text. OSC can drive parameter-driven animator logic but cannot inject new audio clips; the audio must be baked into the avatar.

---

## 2. Worlds (SDK3 + Udon)

### 2.1 Scripting stack

- **Udon:**
  - A bytecode VM (Udon Assembly) authored via Udon Graph (visual) or UdonSharp (a C# subset compiled to Udon).
  - No reflection, threads, IO, or arbitrary .NET. Only whitelisted "externs" (Unity and VRC types) can be called.
  - No complete public extern reference; use the UdonSharp class-exposure tree.
  - Source: [doc] https://creators.vrchat.com/worlds/udon/vm-and-assembly/
- **Udon topics:** Player API, AI Navigation (NavMesh), Animation Events, Avatar Events, Data Containers, Event Execution Order, External URLs, Image Loading, Input Events, MIDI, Networking, Persistence, String Loading, UI Events, Video Players, VRCBillboard, VRCGraphics (Blit/compute-like rendering helpers), VRCTween (tweening), World Debug Views. [doc] https://creators.vrchat.com/worlds/udon/
- **Data Containers:** DataList, DataDictionary, DataToken (nestable), and VRCJson parse/serialize for remote JSON. [doc] https://creators.vrchat.com/worlds/udon/data-containers/
- **Events:**
  - Unity lifecycle (Start, Update, LateUpdate, FixedUpdate, OnEnable/Disable; no Awake).
  - Physics trigger and collision; mouse; rendering.
  - `PostLateUpdate`, the place to read bone and tracking data.
  - Player-specific physics: `OnPlayerTriggerEnter/Stay/Exit`, `OnPlayerCollisionEnter...`, `OnPlayerParticleCollision`, plus `OnDrone*` equivalents.
  - Source: [doc] https://creators.vrchat.com/worlds/udon/event-execution-order/
- **Graph events:** `Interact` (click or use a collider with an interaction text), `OnPlayerJoined/Left`, `OnPlayerRespawn`, `OnStationEntered/Exited`, `OnPickup/OnDrop/OnPickupUseDown/Up`, `OnVideo*`, `OnStringLoadSuccess/Error`, `OnImageLoadSuccess/Error`, `OnMidiNoteOn/Off/ControlChange`, `OnLanguageChanged`, `OnPlayerSuspendChanged`, and others. [doc/community] https://creators.vrchat.com/worlds/udon/graph/event-nodes
- **Input events:**
  - `InputJump`, `InputUse`, `InputGrab`, `InputDrop` (bool).
  - `InputMoveHorizontal/Vertical` and `InputLookHorizontal/Vertical` (axes).
  - `InputManager.GetLastUsedInputMethod()` and `IsUsingHandController()`.
  - `OnInputMethodChanged(VRCInputMethod)`, with values such as Keyboard, Mouse, Controller, Touch, SteamVR2, Embodied (hand tracking), Vive, ViveXr.
  - Input is not received while menus are open.
  - Source: [doc] https://creators.vrchat.com/worlds/udon/input-events/
- **Language:** `GetCurrentLanguage` and `GetAvailableLanguages` for localization. [doc] https://creators.vrchat.com/worlds/udon/players/

### 2.2 Networking

[doc] https://creators.vrchat.com/worlds/udon/networking/ and the pages below.

- **Ownership:**
  - Every networked object has exactly one owner. The first player in the instance owns everything initially.
  - Calls: `Networking.SetOwner(player, obj)`, `IsOwner`, `GetOwner`.
  - `OnOwnershipRequest(requester, newOwner) → bool` approves or denies, running on both sides.
  - `OnOwnershipTransferred(player)`.
- **Master vs instance owner:**
  - `Networking.Master` is the longest-present player. It migrates via `OnMasterTransferred` and **must not be used for security**.
  - `Networking.InstanceOwner` / `isInstanceOwner` is the person who created the instance. It is always false in Public, Group, and Group Public instances.
  - Source: [doc] https://creators.vrchat.com/worlds/udon/networking/network-components/
- **Synced variables:** `[UdonSynced]` with optional tweening (None, Linear, Smooth).
  - Per-behaviour sync modes: **None**, **Continuous** (about 200 bytes per serialization, lossy, high rate), and **Manual** (`RequestSerialization()`, about 280,496 bytes per serialization, reliable).
  - Size per type: bool/byte 1, short/char 2, int/float 4, long/double/Vector2 8, Vector3 12, Quaternion/Color/Vector4 16, string/VRCUrl 2 bytes per char. Arrays are allowed.
  - Source: [doc] https://creators.vrchat.com/worlds/udon/networking/network-details/
- **Bandwidth:**
  - About 11 KB/s outbound per client for Udon (community stress tests report roughly 4 KB/s practical).
  - `Networking.IsClogged` reports congestion. Continuous sync drops data; manual sync retries.
  - Hard ceiling: a late joiner can't join with more than about 6 MB synced state [community feedback].
- **Serialization events:** `OnPreSerialization`, `OnPostSerialization(result: success, byteCount)`, `OnDeserialization(DeserializationResult: sendTime, receiveTime)`, and `OnVariableChanged`/FieldChangeCallback.
- **Network events:** [doc] https://creators.vrchat.com/worlds/udon/networking/events/
  - `SendCustomNetworkEvent(target, name, ...args)` with targets All, Others, Owner, Self.
  - Up to **8 parameters** of syncable types.
  - `[NetworkCallable(maxEventsPerSecond)]`: default **5/s**, configurable **1–100/s**, with a global cap of about 100 events/s.
  - **16 KB** max parameter size per event, and about **18 KB/s** hard outgoing cap (8–10 KB/s practical). Payloads over 1,024 bytes are split.
  - **`NetworkCalling.CallingPlayer`** identifies the sender (security-relevant), and `InNetworkCall` reports whether code is in one.
  - Events are **not** replayed to late joiners; use synced variables for state.
- **Time:**
  - `GetServerTimeInSeconds/Milliseconds` (wraps; use `CalculateServerDeltaTime`) and `GetNetworkDateTime`.
  - `SimulationTime` for latency.
  - `IsNetworkSettled` and `IsObjectReady`.
- **Late joiners:** all synced variables are sent on join. [doc]
- **Components:**
  - **VRCObjectSync:** syncs transform and rigidbody, with `FlagDiscontinuity`, `Respawn`, `SetGravity`, `SetKinematic`.
  - **VRCObjectPool:** owner-only `TryToSpawn()` and `Return(obj)`; active state syncs to late joiners. This is the recommended dynamic spawning, since `Networking.Instantiate` isn't networked in SDK3.
  - Source: [doc] https://creators.vrchat.com/worlds/udon/networking/network-components/

### 2.3 VRCPlayerApi

**Identity** — [doc] https://creators.vrchat.com/worlds/udon/players/

- `displayName`, `playerId`, `isLocal`, `isMaster`, `isInstanceOwner`, `isVRCPlus`, `isSuspended`, `IsUserInVR()`, `IsValid`, and `IsOwner(go)`.
- No stable cross-session user ID is exposed to Udon. The display name is the only identifier, which matters for allowlists.

**Getting players and tags** — [doc] https://creators.vrchat.com/worlds/udon/players/getting-players/

- `GetPlayers(array)`, `GetPlayerCount`, `GetPlayerById`.
- `SetPlayerTag(key, value)`, `GetPlayerTag`, `ClearPlayerTags`. Tags are **local only**, not synced.
- `GetPlayersWithTag` is broken.

**Positions** — [doc] https://creators.vrchat.com/worlds/udon/players/player-positions/

- `GetPosition`, `GetRotation`, `GetBonePosition/Rotation(HumanBodyBones)`, `GetTrackingData(Head/LeftHand/RightHand/Origin/AvatarRoot)`, `GetVelocity`, `SetVelocity`, `IsPlayerGrounded`.
- `TeleportTo(pos, rot, orientation?, lerpOnRemote?)` works on the local player only.
- `Respawn()`.

**Forces** (local player only) — [doc] https://creators.vrchat.com/worlds/udon/players/player-forces/

| Method             | Default                                  | Range |
| ------------------ | ---------------------------------------- | ----- |
| `Set/GetWalkSpeed` | 2                                        | ~0–5  |
| `RunSpeed`         | 4                                        | ~0–10 |
| `StrafeSpeed`      | 2                                        | ~0–5  |
| `JumpImpulse`      | 0, i.e. no jump (VRCWorld prefab sets 3) | ~0–10 |
| `GravityStrength`  | 1                                        | ~0–10 |

- `Immobilize(bool)` and `UseLegacyLocomotion`.

**Voice, per remote player, set locally** — [doc] https://creators.vrchat.com/worlds/udon/players/player-audio/

| Method                     | Range     | Default |
| -------------------------- | --------- | ------- |
| `SetVoiceGain`             | 0–24 dB   | 15      |
| `SetVoiceDistanceNear`     | 0–1e6 m   | 0       |
| `SetVoiceDistanceFar`      | 0–1e6 m   | 25 m    |
| `SetVoiceVolumetricRadius` | 0–1,000 m | 0       |

- `SetVoiceLowpass(bool)`.
- These calls are **per-listener**: each client sets how it hears another player. That is how "stage microphones", "megaphones", and private rooms work.

**Avatar audio, per player** — [doc] same page

| Method               | Default            |
| -------------------- | ------------------ |
| `SetAvatarAudioGain` | 10 dB (range 0–10) |
| `FarRadius`          | 40                 |
| `NearRadius`         | 0                  |
| `VolumetricRadius`   | 0                  |
| `ForceSpatial`       | off                |
| `CustomCurve`        | off                |

**Scaling:** see §1.7.

**Interaction:**

- `EnablePickups(bool)`, `GetPickupInHand(hand)`, `UseAttachedStation()`.
- `PlayHapticEventInHand(hand, duration, amplitude, frequency)`.
- Source: [doc] https://creators.vrchat.com/worlds/udon/players/

**PlayerObjects:** `GetPlayerObjects` and `FindComponentInPlayerObjects` (§2.6).

**Drone API:** a VRC+ camera drone. Worlds get `OnDrone*` collision events and can detect drones. [doc, sidebar only]

### 2.4 World components

[doc] https://creators.vrchat.com/worlds/components/

**VRC_SceneDescriptor** (required) — [doc] https://creators.vrchat.com/worlds/components/vrc_scenedescriptor

- Spawns[] with Spawn Radius.
- Spawn Order: First, Sequential, Random, Demo.
- Spawn Orientation.
- Reference Camera (clip planes, post-processing).
- Respawn Height −Y.
- Object Behaviour At Respawn (Destroy or Respawn).
- Forbid User Portals.
- User Custom Voice Falloff.
- Interact Passthrough layer mask.

**VRC_Pickup** — [doc] https://creators.vrchat.com/worlds/components/vrc_pickup

- AutoHold, UseText, InteractionText, Proximity.
- Orientation (Any, Gun, Grip) with ExactGun/ExactGrip.
- `pickupable`, DisallowTheft, allowManipulationWhenEquipped, momentum transfer, ThrowVelocityBoost.
- `currentPlayer`, `currentHand`, `IsHeld`.
- `Drop()`, `Drop(player)`, `GenerateHapticEvent`.
- Events `OnPickup`, `OnDrop`, `OnPickupUseDown/Up`.
- VR hover sphere of 0.4 m × avatar scale.

**VRC_Station** (seats, vehicles, also used to "lock" players in place) — [doc] https://creators.vrchat.com/worlds/components/vrc_station

- PlayerMobility: Mobile, Immobilize, ImmobilizeForVehicle.
- canUseStationFromStation.
- Custom animatorController for seated or other poses.
- disableStationExit, so a script must release the player.
- Enter and exit locations.
- `UseStation(player)`, `ExitStation(player)`.
- `OnStationEntered/Exited(player)`.

**Other components:**

- **VRC_MirrorReflection:** reflect layers; resolution Auto (≤2048² per eye) or Unlimited; MSAA cap; disable pixel lights; clear flags and custom skybox; alpha clear for cutouts. Mirrors should be off by default and toggled. [doc] https://creators.vrchat.com/worlds/components/vrc_mirrorreflection
- **VRC_PortalMarker:** portals to other worlds or instances. [doc]
- **VRC_PlacementZone:** box zones with per-content-type modes (Unaffected, Block Here, Only Allow Here) for portals, stickers, sharing pedestals, and surface-attached items. [doc] https://creators.vrchat.com/worlds/components/vrc_placementzone
- **VRC_UIShape:** world-space Unity UI interaction with laser or mouse. [doc]
- **VRC_SpatialAudioSource:** 3D audio with gain, near, far, volumetric radius, and custom curve. [doc]
- **VRC_CameraDolly:** dolly paths for the user camera. [doc]
- **VRC_VelocityTracker** and **VRCBillboard**. [doc]
- **TextMeshPro.** [doc]
- **World PhysBones and Contacts:** no world limits. [doc]
- **Video players** (§2.7).
- **MIDI** (§2.9).
- **AI Navigation:** NavMesh agents for NPCs.

### 2.5 Dynamic world changes

- Udon can toggle GameObjects; drive Animators (SetBool, SetTrigger, ...); swap materials; move transforms; change lights, post-processing volumes, skyboxes, particle systems, and audio; and set `RenderSettings`. [inferred from Unity API exposure]
- State must be synced through synced variables, so late joiners get the same "stage set" state. Events alone don't reach them.
- VRCTween handles animations; VRCGraphics handles render-texture effects. [doc, sidebar]

### 2.6 PlayerObjects and Persistence

**Persistence** — [doc] https://creators.vrchat.com/worlds/udon/persistence/

- Per-world, per-user server-side storage, shared across instances and platforms.
- Limits: **100 KB PlayerData + 100 KB PlayerObject data per player per world**, compressed (more than 300 KB raw if compressible). Saves over the limit fail.
- Can't be shared across worlds. Users can wipe their data.

**PlayerData** — [doc] https://creators.vrchat.com/worlds/udon/persistence/player-data/

- A key-value store with typed accessors: ints, floats, doubles, vectors, colors, strings, byte[].
- Anyone can **read** any player's data; only the local player **writes** their own.
- Keys can't be deleted.
- Events: `OnPlayerDataUpdated(player, Info[])` and `OnPlayerRestored(player)`. Wait for `OnPlayerRestored` before reading or writing.
- Storage calls: `GetPlayerDataStorageLimit/Usage` and `OnPlayerDataStorageWarning/Exceeded`.
- Any change re-sends all of that player's data.

**PlayerObjects** (`VRCPlayerObject`) — [doc] https://creators.vrchat.com/worlds/udon/persistence/player-object/

- A template GameObject is auto-instantiated per player on join.
- Ownership is fixed to that player and can't be transferred.
- `VRCEnablePersistence` makes its synced variables persistent.
- Use cases: per-player inventory, health, scores, and per-player networking channels that avoid ownership contention.
- No save can happen in `OnPlayerLeft`; save before leaving.

### 2.7 Video players

[doc] https://creators.vrchat.com/worlds/udon/video-players/ and https://creators.vrchat.com/worlds/udon/external-urls

- **Players:** `VRCAVProVideoPlayer` (livestreams such as Twitch and YouTube Live; up to 5.1 audio, 7.1 on PC) and `VRCUnityVideoPlayer` (mp4/webm).
- **Calls:** `LoadURL`/`PlayURL`, `GetTime`/`SetTime` for sync, `OnVideoReady/Start/End/Error`.
- **Errors:** Unknown, InvalidURL, AccessDenied, PlayerError, RateLimited.
- **URL resolution:** the client runs a resolver (yt-dlp) for YouTube etc. [inferred]
- **Rate limit:** one new URL per **5 s** per client, globally.
- **Allowlist:**
  - Hosts not on the video allowlist need the user setting **"Allow Untrusted URLs"**.
  - In Public and Group Public instances, the world creator must also add the domain to "Video Player Allowed Domains" on the website.
- **VRCUrl:**
  - Udon cannot construct one at runtime; URLs must be baked into the world or typed by a user in a `VRCUrlInputField`.
  - `GetUrl()` returns a VRCUrl; the raw string is hidden.
  - This is the key anti-exfiltration measure: a world can't build `https://evil/?user=name`.

### 2.8 Remote string and image loading

**VRCStringDownloader** — [doc] https://creators.vrchat.com/worlds/udon/string-loading/

- `LoadUrl(VRCUrl, behaviour)` then `OnStringLoadSuccess` or `OnStringLoadError`, with `Result` (UTF-8) or `ResultBytes`.
- Size up to 100 MB.
- **One request per 5 s** per world, with a queue of 1,000 served in random order.
- **Trusted domains:** `*.github.io`, `gist.githubusercontent.com`, `pastebin.com`, `*.disbridge.com`, `*.vrcdn.cloud`. All others require "Allow Untrusted URLs".
- GET only. No headers, POST, or cookies [inferred].

**VRCImageDownloader** — [doc] https://creators.vrchat.com/worlds/udon/image-loading/

- Up to 2048×2048, one image per 5 s per scene, queue of 1,000, 32 MB buffers.
- No redirects.
- Allowlist: Dropbox, GitHub Pages, Imgur, ImgBB, imgbox, ImageBam, Postimages, Reddit, Twitter pbs, VRCDN, assets.vrchat.com, ytimg, DisBridge.
- TextureInfo options: mipmaps, filter, wrap, aniso forced ≥9.

**Implication for "external servers":** Udon cannot POST. Communication is one-way and pull-only, from pre-baked or user-typed URLs (a URL-per-state trick is common), and limited to the allowlist unless the user opts in. Server-validated entitlements must instead go through the Creator Economy Store API (§3).

### 2.9 MIDI

- **Realtime:** a `VRC Midi Listener` component routes `MidiNoteOn/Off` (channel, number, velocity) and `MidiControlChange` to an UdonBehaviour. The client opens the first device, or `--midi=<name>` selects one. [doc] https://creators.vrchat.com/worlds/udon/midi/realtime-midi/
- **Playback:** `VRC Midi Player` plays a MIDI file synced to an AudioClip and sends note events to behaviours. This is used for light shows synced to music. [doc] https://creators.vrchat.com/worlds/udon/midi/midi-playback

### 2.10 World audio

- Unity AudioSources plus VRC_SpatialAudioSource (Steam Audio/ONSP spatialization), audio reverb zones, and per-player voice and avatar audio overrides via Udon (§2.3).
- The world sets user "earmuffs" behavior only indirectly; earmuffs is a user setting. [inferred]

### 2.11 Instances

- **Types:**
  - Public.
  - Friends+ (friends of anyone inside).
  - Friends (the owner's friends).
  - Invite+ (anyone inside can invite; others request to join).
  - Invite (owner invites).
  - Group (members, optionally limited to specific roles).
  - Group+ (friends of members inside).
  - Group Public.
  - Sources: [community] https://wiki.vrchat.com/wiki/Instances and https://guildorder.com/games/vrchat/wiki/group-instance-types
- **Instance owner:**
  - The creator of a non-group instance can warn, mute, and kick in Friends+/Friends/Invite+/Invite instances. The world author has the same tools.
  - In group instances, moderation comes from group roles.
  - Sources: [community] wiki
- **Capacity:**
  - The world sets a soft cap (recommended capacity) and a hard cap (about 2× soft, with an absolute ceiling of about 80; more for some events) [inferred].
  - Group instances can use a **queue** and "Queue priority" permission.
  - Regions: US West, US East, EU, JP.
- **Age gating:** age-gated group instances (§6.4).
- **Instance content settings:** the creator or group can toggle emoji, stickers, pedestals, prints, drones, and items, within what the world creator allows. Item spawning can be disabled by world or group moderators. [doc/community] https://ask.vrchat.com/t/developer-update-26-june-2025/44933
- **Udon visibility:** `IsInstanceOwner` and `InstanceOwner` are available. Udon has **no** API for instance type, group membership, or group role; that is a long-standing feature request. [community] https://feedback.vrchat.com/udon/p/give-udon-u-access-to-instance-information-group-information

---

## 3. Creator Economy (paid world features)

[doc] https://creators.vrchat.com/economy/ and https://creators.vrchat.com/economy/sdk/udon-documentation

**Model:**

- Sellers apply and are approved.
- **Products** unlock content:
  - Avatar Product: avatar access.
  - Subscription Role Product: a group role.
  - **Udon Product:** a world feature flag.
- **Listings** sell one or more products for VRChat Credits. They can be permanent, temporary or duration-based, or instant (quantity 1–99).
- **Subscriptions** are tied to Groups.
- **Stores:** world store, group store, marketplace.
- **Payouts** go through Tilia and PayPal.

**Udon Products** — [doc] https://creators.vrchat.com/economy/products/udon

- Created on the website (Marketplace → Storefront → My Products).
- An `UdonProduct` asset (ID, Name, Description) is referenced in the world.
- "Owner Names in Udon" is optional.
- Editing doesn't require re-upload.

**Store API (`VRC.Economy.Store`):**

- `DoesPlayerOwnProduct(player, product)`, `DoesAnyPlayerOwnProduct`, `GetPlayersWhoOwnProduct` — an **instance-wide view of others' entitlements**, which matters for group perks like "if anyone owns X, unlock for all".
- `ListPurchases(behaviour, player)` → `OnListPurchases`.
- `ListAvailableProducts` → `OnListAvailableProducts`.
- `ListProductOwners(behaviour, product)` → `OnListProductOwners(product, string[] names)`, covering global owners, not just the instance.
- `SendProductEvent(behaviour, product)` → `OnProductEvent`, a server-verified broadcast that the sender owns the product (anti-spoof).
- `OpenListing(id)`, `OpenWorldStorePage()`, `OpenGroupPage(groupId)`, `OpenGroupStorePage(groupId)`, `OpenMarketplaceStore(section, listingId, ctx)`, `VRCOpenMenu.OpenAvatarListing(avatarId)`.

**Events:**

- `OnPurchaseConfirmedMultiple(product, player, isNew, quantity)` (the older `OnPurchaseConfirmed` is deprecated).
- `OnPurchasesLoaded(products[], player)`; wait for it before `DoesPlayerOwnProduct`.
- `OnPurchaseExpired(product, player)`.

**Rules:** the Creator Guidelines prohibit paywalling pornographic content. External Patreon-style perks via allowlisted string downloads (display-name lists on GitHub Pages or pastebin) are a common community pattern. [doc] https://hello.vrchat.com/creator-guidelines

**Buzzar mapping:** a server-signed entitlement API. Each client asks a trusted server (or a Matrix state event signed by an entitlement bot) "does user X own product P". Expose `ownsProduct(player, id)`, `onPurchasesLoaded`, `onPurchaseExpired`, and `sendProductEvent` (server-verified) to world scripts. Never trust client claims.

---

## 4. VR support, input, UI

- **Platforms:** PC (SteamVR/OpenXR, Oculus PC), Desktop (keyboard and mouse), Quest standalone (Android), Android and iOS mobile (touch), plus Pico. Cross-platform worlds and avatars need a mobile build. [doc/community]
- **Controllers:** Index (skeletal finger tracking), Touch, Vive wands, WMR, Vive XR, Pico. SteamVR Input 2.0 bindings. Hard bindings: Jump, Mic Toggle, Gesture Toggle, Action Menu L/R. [doc] https://docs.vrchat.com/docs/valve-index and https://docs.vrchat.com/docs/steamvr-input-20
- **Hand gestures:** 8 gestures per hand (Neutral, Fist, HandOpen, FingerPoint, Victory, RockNRoll, HandGun, ThumbsUp), mapped to GestureLeft/Right ints 0–7 that drive the Gesture/FX layers. [doc] https://creators.vrchat.com/avatars/animator-parameters/
- **Finger tracking:**
  - Index skeletal input and Quest/Pico hand tracking ("Embodied" input method).
  - A per-avatar "Legacy Fingers" toggle and a global "Avatars Use Finger Tracking" setting.
  - Hand-tracking pinch gestures open the Quick Menu (left index and thumb) and the Action Menu (right).
  - Wrist "Quick Menu openers" were added in 2024.4.1.
  - Sources: [community] https://wiki.vrchat.com/wiki/Finger_Tracking and [doc] https://docs.vrchat.com/docs/vrchat-202441
- **Full-body tracking (IK 2.0):** [doc] https://docs.vrchat.com/docs/full-body-tracking and https://docs.vrchat.com/docs/ik-20-features-and-options
  - Up to **8 extra trackers**: hip, chest, feet, knees, elbows.
  - "Calibrate FBT" in the Quick Menu, with calibration saving.
  - Avatar measurement by height or arm span.
  - Lock Hip, Lock Head, or Lock Both.
  - A locomotion animation toggle.
  - `--calibration-range` (0.6 m default) and `--freeze-tracking-on-disconnect`.
  - OSC trackers allow IMU and SlimeVR via OSC (`/tracking/trackers/1..8/position|rotation`, head). [doc index] https://docs.vrchat.com/docs/osc-trackers
- **IK modes:** 3-point (head and hands) with procedural legs, 4-point (+hip), 6-point, up to 11-point. Avatars can override tracking with Tracking Control. [doc/inferred]
- **Locomotion and comfort:**
  - Smooth locomotion (head- or hand-oriented).
  - Comfort turning (snap turn) vs smooth turning.
  - Teleport-style comfort locomotion with a "holoport" option for some users.
  - Vignette, seated play mode, height calibration.
  - Settings tabs: Audio & Voice, Comfort & Safety, Graphics, Avatars, Mirrors, UI, Controls, Tracking & IK, Accessibility, Debugging.
  - Sources: [community] https://wiki.vrchat.com/wiki/Controls and https://wiki.vrchat.com/wiki/Settings
- **Menus:**
  - **Quick Menu:** the wrist or hand menu with instance info, user selection and per-user moderation, camera, emoji, mic, and safety shields.
  - **Main Menu:** worlds, avatars, social, settings, safety, inventory.
  - **Action Menu:** radial; expressions, emojis, OSC, gestures, scale dial (§1.4).
  - **Chatbox:** typed text above the head; OSC-drivable.
  - **Nameplates** show trust rank colors, a VRC+ badge, an age-verified badge, and a speaking indicator.
- **Camera:** the user camera with photo and stream modes, a drone camera (VRC+), and prints (in-world photos, VRC+). Stickers and emoji can be placed in the world. [community/inferred]
- **Mobile/touch:** a touch Quick Menu. Input methods include Touch. Udon handles touch through standard input events.

---

## 5. User-spawnable objects (Items/props)

- **Items:** introduced in 2025.2.3 alongside the Inventory and Content Drops. [doc] https://ask.vrchat.com/t/developer-update-26-june-2025/44933
  - Spawned from the Action Menu Items submenu or from the Inventory.
  - **One of each owned item** per user.
  - **Removed when the owner leaves.**
  - Some attach to floors, walls, or ceilings; others spawn as pickups.
  - Items sit on a dedicated Item layer that collides only with other Items. The initial items are kinematic.
  - Items can run Udon and use Stations, Pickups, and ObjectSync internally. **World Udon cannot interact with Items.**
  - Items are VRChat-authored only, with no UGC prop SDK; staff said UGC is "really far" off.
  - Obtained through Content Drops (seasonal, VRC+ monthly drops) and purchases.
  - Examples: Pride Ribbon, Reference Cube. A portable mirror item has been reported in community sources [unverified]. No trampoline item was confirmed.
  - The Items FAQ (403 to fetcher) is at https://help.vrchat.com/hc/en-us/articles/45059565610387-Items-FAQ.
- **Controls:**
  - A world can disallow items entirely, with a reason.
  - Group moderators can turn item spawning off in Group and Group Public instances, but cannot override the world.
  - Users can hide individual items. Items of blocked users are hidden.
  - Placement Zones restrict surface-attached items (§2.4).
- **Other user-placed content:**
  - Portals: user-dropped; `ForbidUserPortals` blocks them.
  - Stickers: 18 slots; custom stickers need VRC+.
  - Emoji: 18 slots; custom and animated emoji need VRC+.
  - Prints, drones, and sharing pedestals (share an avatar or world).
  - Instance content settings toggle these.
- **Buzzar mapping:** the inventory maps naturally to Matrix account data. Props would be glTF plus a script sandbox spawned as user-owned networked entities. Add per-world and per-instance allow flags, placement zones, a one-per-type limit, despawn on leave, and a dedicated physics layer.

---

## 6. Safety and moderation

### 6.1 Trust and Safety system

[doc] https://docs.vrchat.com/docs/vrchat-safety-and-trust-system

- **Trust ranks:**
  - Visitor (cannot upload).
  - New User (blue).
  - User (green).
  - Known User (orange).
  - Trusted User (purple).
  - Friends.
  - Nuisance (avatars blocked by default).
  - VRChat Team.
  - Known and Trusted users can display as "User".
- **Shield levels:** Maximum, Normal (recommended default), None, Custom.
- **Per-rank toggles:**
  - Voice.
  - Avatar (show or hide; hidden shows an impostor or robot).
  - User Icons & Emoji.
  - Audio (avatar SFX).
  - Lights & Particles (also line and trail renderers).
  - Shaders (fall back to Standard).
  - Custom Animations.
  - Animated Emoji.
- **Per-user overrides:**
  - **Show Avatar** and **Hide Avatar** (force-show bypasses shields and performance blocks, except mobile hard caps).
  - **Mute** (voice), **Block** (mutual invisibility and silence; blocked users can't join your instances), **Report**.
  - Avatar-specific blocks ("Block Avatar" hides that avatar on anyone).
- **Performance-rank blocking:** "Minimum Displayed Performance Rank" (§1.6). Avatars over limits are stripped or hidden and replaced by an impostor. Users can also cap avatar download size and turn off "Allow avatar copying".
- **Anti-crasher protections:** [inferred/community]
  - Mobile hard caps on PhysBones, contacts, and constraints (stripped regardless).
  - Avatar audio gain and distance caps (10 dB, 40 m) enforced at runtime.
  - Shader blocking, avatar file-size limits, and server-side "extremely unoptimized avatars may be blocked from use".
  - Particle limits, and mesh read/write disabled forces Very Poor.
  - Easy Anti-Cheat (since 2022) to stop modded clients.
  - "Panic" safe mode: a hotkey that hides all avatars and mutes.
  - Users can hold a button to hide everyone. Avatar distance culling and max-avatars-shown settings exist.

### 6.2 Groups

[community] https://wiki.vrchat.com/wiki/Groups and https://guildorder.com/games/vrchat/wiki/groups-roles-and-permissions

- **Features:** Group pages with a description, rules, banner and icon, gallery, posts and announcements, and a group calendar of events. Public or private, with join modes: open, request, or invite.
- **Membership:** Members join a limited number of groups and "represent" one group on their nameplate. Users can create a small number of groups, more with VRC+ [inferred].
- **Roles:** Assign On Join, Self Assignable, or Require 2FA.
- **Permissions:**
  - Invite, accept requests, remove members.
  - Manage member data and roles.
  - Warn, mute, kick, ban (group bans).
  - Edit group.
  - Create Group Public, Group+, or Members-Only instances; role-restrict Members-Only instances.
  - **Create Age Gated Instances.**
  - Create instance announcements, manage the calendar, queue priority.
  - Manage gallery and posts.
  - **View Audit Log**.
- **Instance moderation:** In group instances, role-holders can warn, mute, kick, and ban (instance or group ban), toggle instance content settings, and close or lock the instance. Kicks and bans carry over to future group instances. [community]
- **Audit log:** records actions (bans, kicks, role changes, instance creation) with the actor and target, but no reasons. [community]

### 6.3 Instance moderation (non-group)

- The instance creator and world author can **warn, mute, and kick** in Friends+/Friends/Invite+/Invite instances. A kick bans the user from that instance; they can't rejoin. Users can **vote-kick** in public instances [inferred]. [community] https://wiki.vrchat.com/wiki/Instances

### 6.4 Age verification

[community] https://wiki.vrchat.com/wiki/Age_Assurance, https://hello.vrchat.com/blog/age-verification, https://ask.vrchat.com/t/age-verification-faq/28458

- Optional verification through **Persona**: a government ID checked against a selfie.
  - Earlier it was gated to VRC+ subscribers; it is now rolling out more broadly as part of "Age Assurance".
  - It yields a "**Age Verified 18+**" badge (display optional) or "Age Verified" for under 18.
- **Age-gated (18+) instances:**
  - Only group instances can be age-gated, created by verified 18+ users with the "Create Age Gated Instances" group permission.
  - Only verified 18+ users can join.
  - The gate covers instances only; there is no content-level age lock. Age gating doesn't waive the ToS (no porn).
- **Udon:** no documented API to check a player's age-verification status. Worlds rely on the instance gate. [inferred, no API found]

### 6.5 World-level restriction patterns (Udon)

- **Allowlists by display name:** the most common pattern. A hard-coded or remote list (via string download from GitHub Pages or pastebin) is compared to `displayName`. It controls access to stage, DJ booth, staff rooms, teleporters, and colliders that push players out. It is fragile because names can change. [community/inferred]
- **Role checks:**
  - `isInstanceOwner` works only in non-group instances; `isMaster` is insecure.
  - Udon has **no group-role API**, so group events use name allowlists or passwords (keypad doors).
  - `Store.DoesPlayerOwnProduct` gates by purchase or subscription (Subscription Role products).
- **"Age gate rooms":** before native age gating, worlds used honor-system "I am 18+" buttons and later display-name allowlists maintained by staff. Today they rely on age-gated group instances. [community/inferred]
- **Area enforcement techniques:**
  - Trigger colliders with `OnPlayerTriggerEnter` → `TeleportTo` out.
  - Toggle wall colliders locally for non-allowed users.
  - Lock players in a `VRCStation` with `disableStationExit` (a "jail" or timeout).
  - `SetVoiceGain` to 0 locally ("mute" in world).
  - `EnablePickups(false)`.
  - `Immobilize`.
- **Policy constraints** ([doc] https://hello.vrchat.com/creator-guidelines):
  - Allowed: post rules at the entrance; inform moderated users; teleport or mute misbehaving users; allowlists to _enable_ features.
  - Forbidden: forcibly changing avatars; crashing users; preventing users from leaving; **preemptive static or dynamic block lists** (ban lists for people who haven't misbehaved in the instance).

### 6.6 Content gating

- **Avatars:** content warnings and tags (adult themes, violence, etc.), and a "show avatars with content warnings" toggle. Private, Public, or Marketplace release status. [inferred]
- **Worlds:** labs vs public publish; content tags filter world search; "Video Player Allowed Domains"; capacity. [inferred/doc]

---

## 7. Audience Anarchy–style game worlds

I found no public source for "Audience Anarchy". This section treats it as a live audience game show, and builds it from documented Udon primitives.

- **Volunteer queue and random selection:**
  - Volunteers press a button (`Interact`). The button sends a `[NetworkCallable]` event to the Owner (the host or game-state object owner). The owner reads `NetworkCalling.CallingPlayer` (sender verified) and appends the `playerId` to a synced `int[]` (manual sync).
  - The host (allowlist or `isInstanceOwner` check) picks one with `UnityEngine.Random` or `Utilities.ShuffleArray`, then `RequestSerialization`.
  - Clients see the selection in `OnDeserialization`. The selected client runs `TeleportTo` (local only) on stage, or the owner seats them with a `VRCStation`.
  - Alternatively, PlayerObjects give each player their own "volunteer" flag with no ownership contention.
- **Stage set swapping:** a synced `int sceneIndex`. Each client toggles GameObject sets, animator triggers, and skybox or lighting on change. Late joiners get the state automatically. Use VRCObjectPool for spawned props.
- **Stage lights and scripted cameras:**
  - Animator timelines driven by a synced cue index plus server-time offsets (`GetServerTimeInSeconds`) to keep time-aligned.
  - MIDI Playback for music-synced lights, or realtime MIDI from a lighting desk.
  - Camera: Unity Cameras to RenderTextures (screens) and `VRC_CameraDolly` for user-camera paths. A world "stream camera" is a toggled Camera with `targetDisplay` (desktop overlay for streamers) [inferred]. VRCGraphics handles effects.
- **Host voice and broadcast:** `SetVoiceDistanceFar` and `SetVoiceGain` on the host for every listener (a "microphone" zone via OnPlayerTriggerEnter). The host's avatar audio is overridden the same way.
- **Audience control:**
  - `Immobilize` or stations for seated audiences; `SetWalkSpeed`/`SetJumpImpulse` 0.
  - Per-player tags (local) for roles.
  - `EnablePickups` for buzzers.
  - Pickups with `OnPickupUseDown` for buzzer devices.
  - Contacts on buzzers for hand-touch input.
  - `PlayHapticEventInHand` feedback.
- **Scores:** a synced scoreboard (manual), persistent lifetime stats via PlayerData/PlayerObjects, and paid perks via Udon Products (for example, a cosmetic buzzer).
- **Scaling for staging:** world-authoritative avatar scale (contestants normalized to the same eye height) via `SetAvatarEyeHeightByMeters` + `OnAvatarEyeHeightChanged`.
- **Instance setup:** Group+ or Group Public with queue, group moderators, and an optional age gate.

---

## Sources (main)

- https://creators.vrchat.com/avatars/avatar-performance-ranking-system/
- https://creators.vrchat.com/avatars/animator-parameters/
- https://creators.vrchat.com/avatars/avatar-scaling/
- https://creators.vrchat.com/avatars/playable-layers/
- https://creators.vrchat.com/avatars/state-behaviors/
- https://creators.vrchat.com/avatars/expression-menu-and-controls/
- https://creators.vrchat.com/avatars/avatar-impostors
- https://creators.vrchat.com/common-components/physbones
- https://creators.vrchat.com/common-components/contacts
- https://creators.vrchat.com/common-components/constraints
- https://creators.vrchat.com/worlds/udon/networking/ (+ /network-details/, /events/, /network-components/)
- https://creators.vrchat.com/worlds/udon/players/ (+ player-forces, player-audio, player-avatar-scaling, player-positions, getting-players)
- https://creators.vrchat.com/worlds/udon/avatar-events
- https://creators.vrchat.com/worlds/udon/input-events/
- https://creators.vrchat.com/worlds/udon/persistence/ (+ player-data, player-object)
- https://creators.vrchat.com/worlds/udon/string-loading/ , /image-loading/ , /external-urls , /video-players/
- https://creators.vrchat.com/worlds/udon/midi/realtime-midi/
- https://creators.vrchat.com/worlds/udon/data-containers/ , /vm-and-assembly/
- https://creators.vrchat.com/worlds/components/ (+ scenedescriptor, pickup, station, mirrorreflection, avatarpedestal, placementzone, spatialaudiosource)
- https://creators.vrchat.com/economy/ , /economy/sdk/udon-documentation , /economy/products/ , /economy/products/udon
- https://docs.vrchat.com/docs/vrchat-safety-and-trust-system
- https://docs.vrchat.com/docs/osc-overview , /osc-avatar-parameters , /osc-trackers
- https://docs.vrchat.com/docs/action-menu , /full-body-tracking , /ik-20-features-and-options , /vrchat-202441 , /vrc_playeraudiooverride
- https://hello.vrchat.com/creator-guidelines
- https://ask.vrchat.com/t/developer-update-26-june-2025/44933
- https://wiki.vrchat.com/wiki/Age_Assurance , /Instances , /Groups , /Finger_Tracking , /Fallbacks
- https://guildorder.com/games/vrchat/wiki/groups-roles-and-permissions , /group-instance-types
