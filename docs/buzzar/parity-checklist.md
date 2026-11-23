# Buzzar ⇄ VRChat parity checklist

Baseline: upstream Third Room `01bc731b` (2023-07-11). Research date: 2026-11-13.
Evidence lives in [`research/`](research/) (agent-written reports with citations; treat
VRChat numbers marked *verify* as unconfirmed) and [`reference-worlds.md`](reference-worlds.md).

**Status:** ✅ exists and works · 🟡 partial/stub/buggy · ❌ missing
**Size (rough, one experienced dev):** S ≤ 1 wk · M 1–4 wk · L 1–3 mo · XL 3 mo+
**Matrix impact:** 🅼 needs new or changed event types (goes into the Buzzar MSC)

> Namespace (decided 2026-11-13): Buzzar's own event, room and RTC application types use the
> `software.haven.*` prefix until a Buzzar MSC exists. They may later move to an
> `org.matrix.mscXXXX.*` prefix, so keep event-type strings in one constants module and read both
> prefixes during any cut-over.

> **Design principle: pure Matrix (decided 2026-11-13).** Rules, roles, grants, admissions and
> world-level data are Matrix events, authorized by Matrix's own rules (power levels, state keys,
> delayed events). Nothing a client relies on lives only in a Buzzar server or in one host's memory.
> Any Matrix bot can then observe and act on a world just like a human moderator, and bots can
> appear in-world with avatars (§9). A "world server" is just an optional bot, never a requirement.

---

## 0. Foundation (blocks everything else)

These aren't features VRChat has. Without them, Third Room doesn't run properly on 2026 Matrix
infrastructure and can't scale to VRChat-sized instances.

- [ ] ❌ **L** Replace Hydrogen (`@thirdroom/hydrogen-view-sdk` 0.1.2, unmaintained, libolm) with
      **matrix-js-sdk** (Rust crypto WASM). This touches all of `src/ui` and `src/engine/matrix`. Plan: [plans/02-matrix-js-sdk-migration.md](plans/02-matrix-js-sdk-migration.md).
- [x] ✅ **S** Authenticated media (`/_matrix/client/v1/media/*`), done in `src/ui/utils/mediaAuth.ts`. Hydrogen builds legacy URLs, so new
      scenes, avatars and scripts fail on modern homeservers. *Note: the reference rooms loaded fine through matrix.org's authenticated endpoint.*
- [x] ✅ **S** Room v12 compatibility (done: no `users` entry in power-level overrides; Backrooms on glowers.club is a v12 world). World, home and profile creation puts the creator in
      `power_levels.users` (`CreateWorldForm.tsx:129`, `useHomeWorld.ts`, `useUserProfile.ts`), which v12
      rejects. Treat creators as having infinite power. Room IDs no longer contain a server name. *Verify with an integration test.*
- [ ] 🟡 **XL** 🅼 **Move voice and data to MatrixRTC (MSC4143) + LiveKit (MSC4195).** This replaces the
      MSC3401 full mesh (which struggles at 10–20 users) with an SFU that scales to 40–80+ users.
      - **Done 2026-11-22:** LiveKit world calls alongside the mesh (`src/matrix/livekitCall.ts`): slot
        `software.haven.world#main`, membership through matrix-js-sdk's MatrixRTCSession (legacy state-event format,
        5-minute expiry kept fresh), media and data through the LiveKit server from the oldest member's
        `/sfu/get` service; game data as reliable data packets per player, chunked (`livekitDataChannel.ts`).
        Worlds recommend a call type (`software.haven.world.call`, World Settings → Calls, default mesh); a dialog asks
        which call to join when one of another type is open; Developer Mode can override the type for new calls.
        Tested live with two clients (voice track, data channel, movement, the dialog).
      - **Done 2026-11-23:** voices by distance: they fade out at the world's voice range (`HAVEN_voice`, default
        30 m) and LiveKit calls only receive the voices within earshot; stage areas (`HAVEN_voice_zone`): whoever
        stands in one is heard by everyone. A failed LiveKit connection says why and offers a peer-to-peer call.
      - Still to do: one slot per instance (`software.haven.world#<instance>`); lossy packets for poses; media E2EE; sticky `m.rtc.member` events plus a delayed leave event
        (MSC4140/MSC4354: the homeserver must enable delayed events, otherwise a vanished player's membership lasts
        until it expires).
      - **Done 2026-11-23:** world tiles and the overlay show who's in a world's LiveKit call before you join; joining
        drops this device's membership of the other kind of call; closing the page leaves the call (keepalive).
- [ ] 🟡 **S** Legacy MSC3401 call compatibility in old worlds: choose the call deterministically.
      `#uk-city-1` has a call created by an unrelated PL0 user; ignore stale `call.member` events.
- [ ] 🟡 **L** **Authority and validation layer.** Today any peer can spawn any prefab or take ownership of any
      object, and the object cap is enforced only locally (`spawnables.game.ts:334`). Needed:
      - host or world-server authority based on power levels (`HostElection.ts` is dead code, `createMatrixNetworkInterface.ts:198`);
      - validation of incoming spawns, ownership and limits (**done 2026-11-16, receiver-side:** see §4 "Enforced limits");
      - any member with enough power level can be host, including a bot account (§9). Hosting must never depend on a Buzzar-specific server.
- [ ] 🟡 **S** Network correctness:
      - peer index is a 16-bit hash, so collisions are possible;
      - unreliable channels are a TODO (`network.main.ts:240`);
      - ~~interpolation is off by default~~ on since 2026-11-22, with a playback delay fitted to each peer (`playbackClock.ts`, Third Room #237);
      - ~~the string/binary flag bug (`network/scripting.game.ts:48`)~~ fixed 2026-11-17.
- [ ] ❌ **M** Instances (VRChat Public/Friends+/Invite/Group). One world room, many concurrent
      instances, each a MatrixRTC slot with a capacity and a join queue. 🅼
- [ ] 🟡 **S** Rebrand: package name, app text and help links done; `/landing` kept as Third Room's page on purpose; `config.json` homeserver defaults.
      Keep the `upstream` remote for cherry-picks.
- [ ] 🟡 **M** Tests. Today there are unit tests only. Add:
      - headless multi-client integration tests against a local Synapse;
      - the four reference worlds as load and portal fixtures.

## 1. Avatars

| | Item | Size | Notes |
|---|---|---|---|
| ✅ | **Load custom avatars in the engine** | M | Upload UI stores `.glb` in the profile room, but everyone renders the hard-coded `full-animation-rig.glb` (`PlayerRig.ts:62`). **Buzzar:** Done: glb/VRM avatars from profile or per-world member state, loaded by every client. |
| ✅ | VRM 0.x/1.0 import (humanoid mapping, spring bones, expressions) | L | Most likely interchange format for VRChat-style avatars. **Buzzar:** Done: humanoid mapping, spring bones (VRM 0/1 + name-detected), morph-target expressions. Still to do: MToon shading, and caching retargeted clips per avatar URL (~70 ms per load). |
| ✅ | Choose avatar per world entry + **switch in-world** without rejoining | M | 🅼 Per-world `world.member` writer exists but is never called, and its PL entry is misspelled (`member.world`). **Buzzar:** Done: Avatars screen (Wear / Wear Only in This World), live switch announced to peers. |
| ✅ | Avatar library / favourites / pedestals in worlds | M | 🅼 Pedestal = world node that offers an avatar. Store the library in account data or a profile room. **Buzzar:** Done: Avatars screen (Stock, Bookmarked in account data, In World) and HAVEN_avatar_pedestal. |
| ❌ | **User-adjustable height** (VRChat ≈0.2–5 m eye height, *verify*) + world min/max/forced height | M | Capsule fixed at 1.7 m. The engine enforces world limits on every avatar change; scripts don't have to (fixes VRChat's `OnAvatarEyeHeightChanged` bypass). 🅼 limits in world rules. |
| ❌ | Full skeleton networking (IK targets + bones) | L | Only the root transform is synced today. |
| ❌ | IK: 3-point (head + hands) VR body, then full-body trackers (WebXR has limited tracker access; consider OSC/SlimeVR bridge) | L–XL | In VR, other players currently show as a headset plus controllers only. |
| ✅ | Lip sync / visemes from voice, blink, eye look-at | M | **Buzzar:** Done: LPC-formant visemes from voice, blinking, eye gaze and eyelid bones. |
| ❌ | **Emotes / dances with synced audio** (VRChat Action layer + Play Audio) | L | Clips + audio embedded in the avatar glb (`KHR_audio` + animation). A radial "action menu" triggers them. Broadcast as a reliable network event with a start timestamp so everyone plays in sync. Audio is limited by world/user safety settings (VRChat caps: 10 dB, 40 m, *verify*). |
| ❌ | Expression parameters + toggles menu (VRChat 256-bit synced budget) | L | Generic "avatar parameters" synced over the data track. Drives blendshapes, material swaps, object toggles. |
| 🟡 | Secondary motion (PhysBones equivalent), contacts/colliders on avatars | L | VRM spring bones as a start. **Buzzar:** Spring bones done; avatar colliders/contacts not yet. |
| ✅ | Locomotion animation set, nametags, speaking indicator, 1st/3rd person | – | Fixed clip set (Idle/Walk/Run/Strafe/Fall). |
| ❌ | **Performance ranking + hard limits** (tris, texture MB, bones, audio sources, file size) | M | Prerequisite for moderation §5. Compute at upload and re-check on load. |
| ❌ | Impostors / fallback avatar for blocked or over-limit avatars | M | |
| ❌ | Avatar scripting (per-avatar WebSG) | L | Needs §7 sandbox. Default off; worlds can forbid it. |

## 2. Scripted worlds

| | Item | Size | Notes |
|---|---|---|---|
| ✅ | WebSG runtime (QuickJS or raw WASM), scene graph, materials, lights, physics bodies, colliders, triggers, interactables, in-world flexbox UI | – | 284 C API functions wired. One script per world (`script_url`). |
| ❌ | **Play glTF animations** (doors, moving platforms, set changes) | M | Scene animations never play (`gltf.game.ts:561-638`). The reference worlds have none, so this is new functionality. |
| ❌ | Script animation API (play/stop/blend/seek, animator state) | M | |
| ❌ | Script audio playback API (play/stop/seek clips, synced music) | M | Today scripts can only read audio-analyser data. |
| ❌ | **Synced variables** (VRChat UdonSynced: continuous + manual, ownership, late-joiner state) | L | Today there's only reliable broadcast + `defineReplicator`. Late joiners get nothing unless the script handles it. |
| 🟡 | Network events with verified sender (VRChat `NetworkCalling.CallingPlayer`) | S | Broadcast exists; the sender must be attested by the transport, not claimed by the payload. |
| ❌ | **Player API**: teleport, set walk/run/jump/gravity, immobilize, get/set eye height, player list with Matrix IDs + power level/roles | M | Needed for Audience Anarchy (pick volunteer → teleport to stage). |
| 🟡 | Seats / stations (sit, lock movement, exit control) | M | **Buzzar:** Seats exist (sit, exit); a seat race with two people is known. |
| ❌ | Object sync + object pools (VRChat ObjectSync/ObjectPool) | M | Partly covered by the replicator. |
| ❌ | Raycasts / overlap queries, input beyond the pointer ray | S | |
| ❌ | Server-synchronized clock | S | For cue timelines, synced music and dance sync. Derive from RTC/host. |
| ❌ | Random selection with fairness (host-authoritative RNG) | S | Falls out of host authority + synced vars. |
| ❌ | **Runtime set swapping**: enable/disable node subtrees, load extra glTF "sets" at runtime, swap skybox/lighting/reflection probes | M | Live scene reload exists for state changes, but it reloads everything. Needed: additive per-set loading + toggling. |
| ❌ | Persistence (per-player + per-world data, VRChat 100 KB/player, *verify*) | L | 🅼 Per-user state events (`state_key = @user`) or room account data. World-level data is written by members with the right PL, often a world bot (§9). |
| ❌ | Video players (URL + mxc, synced playback) | M | Respect §7 URL policy. |
| ✅ | Mirrors (planar, quality levels) | M | Only reflective spheres exist today. **Buzzar:** Done: HAVEN_mirror planar mirrors. Still to do: a client setting for the quality cap (`setMaxMirrorState` is unused), remembering mirror state per world, and checking the per-eye reflections in a headset. |
| ❌ | MIDI input/playback | S | WebMIDI. Low priority. |
| ❌ | Multiple scripts per world / per-node scripts | L | Today: exactly one script per world. |
| 🟡 | Script CPU/memory budget + watchdog; a script error must not block world load | M | No budget today. #619: a script error stops the world loading. **Buzzar:** #619 done: a script that fails to load or errors is stopped with a notice and the world keeps running. No CPU/memory budget yet. |
| 🟡 | In-browser world editor | XL | Mostly a stub (reparent/focus empty, gizmos do nothing, nothing saved). Unity/Blender export is the realistic primary pipeline short term. |
| 🟡 | Unity exporter (separate repo) / Blender support | M | Fork the Unity exporter and add Buzzar components (seats, pickups, sync, rules). |
| ❌ | Scene loading UX for 50–70 MB worlds: progress, cache, chunk/LOD | M | See reference-worlds.md. |

**Audience-Anarchy readiness** needs: player API (teleport/immobilize) · synced vars ·
verified network events · host-authoritative RNG · set swapping · seats · clock · audio playback ·
per-player voice override (§5 voice zones/broadcast). All are listed above.

## 3. VR

| | Item | Size | Notes |
|---|---|---|---|
| ✅ | Immersive VR/AR sessions, controllers with input-profile models, smooth locomotion, 30° snap turn | – | XR forces main-thread rendering (`MainThread.ts:110`). Measure the perf cost. |
| 🟡 | Hand tracking | M | Joint poses are captured on the render side, but nothing on the game side uses them. Need hand → avatar fingers + pinch UI. |
| ✅ | Fix pressed/released input state in WebXR (`ActionMappingSystem.ts:21`) | S | **Buzzar (2026-11-17):** analog triggers press at 0.6 and release below 0.3 instead of on any non-zero value. Not yet tried on a headset. |
| ❌ | Teleport locomotion, smooth turn, comfort options (vignette, seated mode, height calibration) | M | |
| ❌ | **XR menus**: quick menu, radial action menu (emotes/toggles), avatar picker, moderation panel, settings | L | React overlays don't exist in the headset today. Needs an in-world UI layer the world cannot draw over (also needed for §7 consent prompts). |
| ❌ | Full-body IK + trackers | XL | See §1. |
| ❌ | Gesture → avatar expression mapping | S | |
| ❌ | Haptics API | S | |
| 🟡 | Desktop/mobile/touch parity (#156) | M | **2026-11-22:** touch controls (joystick, drag to look, Jump/Crouch/Use/Throw/Straighten/Fly buttons; on by default in mobile browsers) and installing as an app (web app manifest). Still desktop-sized: the menus and world settings aren't laid out for phones yet. |
| ❌ | Performance: LOD, foveation, fixed-foveated rendering, frame budget on Quest browser | L | |

## 3b. Controls and controller support

**Requirement:** every core action for moving around and interacting has an equivalent on each input
device (keyboard + mouse, gamepad, VR controllers), modelled on VRChat's controls.

**Today:**
- Third Room has keyboard, mouse and WebXR controller bindings only. **There is no gamepad support:**
  `navigator.getGamepads` is never called.
- The input layer is already a good base. Action maps bind named input paths (`Keyboard/KeyW`,
  `XRInputSource/primary/xr-standard-trigger`, …) to actions (`src/engine/input/ActionMap.ts`,
  `RawInputSystems.ts`), so gamepad support means adding `Gamepad/*` raw paths and bindings.
- Bindings are scattered across the systems that use them (`KinematicCharacterController.ts`,
  `interaction.game.ts`, `CameraRig.ts`, …) and can't be rebound.

### Binding parity table

VRChat columns come from VRChat's docs ([keyboard-and-mouse](https://docs.vrchat.com/docs/keyboard-and-mouse),
[gamepad](https://docs.vrchat.com/docs/gamepad) (its diagram), [touch](https://docs.vrchat.com/docs/touch),
[valve-index](https://docs.vrchat.com/docs/valve-index), [action-menu](https://docs.vrchat.com/docs/action-menu)).
The "Buzzar" column is the proposed default. Where a VRChat default exists, Buzzar matches it so muscle memory transfers.

| Action | VRChat KB+M | VRChat gamepad (Xbox layout) | VRChat VR (Touch / Index) | Third Room today | Buzzar default (gamepad) |
|---|---|---|---|---|---|
| Move | WASD | Left stick | Left stick | WASD; XR left stick ✅ | Left stick |
| Look / turn | Mouse; `<` `>` rotate | Right stick | Right stick (snap/smooth) | Mouse; XR snap turn 30° | Right stick (look; sensitivity + invert-Y settings) |
| Sprint | Shift | – (stick magnitude) | – | Shift | Stick magnitude, or toggle sprint on L3 double-click (setting) |
| Jump | Space | A | A (right) | Space; XR thumbstick press | A |
| Crouch / prone | C / Z | L3 click = crouch, L3 hold = prone | – (physical) | C crouch, no prone | L3 click / hold |
| Interact / use | Left click | R1 primary grab/interact | Trigger | E / left click; XR trigger | R1 (center-screen reticle) |
| Grab / pick up | Left click | R1 primary / L2 secondary | Grip | Left click hold; XR squeeze | R1 (primary hand) / L2 (secondary hand) |
| Drop / throw | Right click; RMB+F throw | B primary / X secondary drop/throw | Release grip | Right click | B / X (hold to charge throw) |
| Move held object near/far | Mouse wheel | – | Physical | Mouse wheel | D-pad left/right while holding (or right stick + modifier) |
| Rotate held object | Middle mouse; IJKL/UO | L1 rotate held item | Physical | ❌ | L1 + right stick |
| Quick menu | Esc | Menu | B/Y (top button) | Esc (2D overlay only); ❌ in XR | Menu (Start) |
| Action / radial menu (emotes, expressions, gestures) | R | R3 click | Thumbstick click (per hand) | ❌ | R3 click; flick-select with right stick |
| Gesture wheel | Shift+F1–F8 | R2 | Finger pose / capacitive | ❌ | R2 |
| Mute mic | V (PTT or toggle) | Y | X (left Touch) / A (left Index) | Local mute in UI | Y |
| Chatbox | Y | – | – | Chat overlay (2D) | Via quick menu + on-screen keyboard |
| Toggle nameplates | Ctrl+N | D-pad up | – | ✅ N (banners / names / off) | D-pad up |
| Toggle HUD | Ctrl+H | D-pad down | – | ✅ H (browsers keep Ctrl+H for history) | D-pad down |
| Screenshot | F12 | View (Back) | – | ❌ | View |
| Safe / panic mode | Shift+F11 | – | Both triggers + both menu buttons | ❌ | Hold View + Menu (and a quick-menu button) |
| 1st/3rd person | – | – | – | V | Settings / quick menu |
| Fly (when the world allows) | – | – | – | B | Quick menu toggle; A/L3 for up/down while flying |
| Spawn prop (action bar 1–9) | – | – | – | Keys 1–9; XR slot 1 only | Via quick-menu inventory (§4) |

### Gamepad and controller checklist

- [x] ✅ **M** Gamepad API polling into the raw input buffer (`Gamepad/<index>/button/*`, `Gamepad/<index>/axis/*`)
      on the main thread, using the W3C `standard` mapping. Fallback profiles for non-standard pads.
      Hot-plug, multiple pads, deadzones, response curves.
      **Buzzar (2026-11-17):** `src/engine/input/gamepad.main.ts` polls every 8 ms, merges all pads, radial dead
      zone, squared look curve, analog walking speed, sprint at full tilt; layout as in the table above (L3 hold for
      prone, R1/R2 grab, X throw, Y mute, D-pad names/HUD, Start menu, Back controls). Non-standard pads aren't
      remapped yet. Tested with a simulated pad only.
      **Buzzar (2026-11-18):** Settings → Controls lists the connected controllers (a light shows which one you're
      pressing) and picks which to use: any (merged), one in particular, or none; plus the keyboard/mouse and
      controller layouts (`gamepadPreference.ts`, `ControlsSettings.tsx`).
- [ ] 🟡 **M** **Centralized, rebindable action registry**, with a rebinding UI per device and saved
      bindings in Matrix account data (`software.haven.input_bindings`) so they follow the user across devices.
      **Buzzar (2026-11-22, Third Room #382):** keyboard keys can be rebound in Settings → Controls
      (`keyBindings.ts`, `KeyBindingsEditor.tsx`), saved in this browser. Game actions are remapped where keys enter
      the engine; interface shortcuts, the HUD, tooltips and the controls help read the same bindings. Still to do:
      controller rebinding and syncing the bindings through account data.
- [ ] ❌ **M** **Gamepad UI navigation:** every 2D menu (React overlays) and in-world UI panel can be
      driven by D-pad/stick with a visible focus, plus A to confirm and B to go back. No action may require a mouse.
- [ ] ❌ **S** Center-screen reticle and aim assist (snap the reticle to nearby interactables) for interacting with a gamepad.
- [ ] ❌ **S** Correct button prompts and glyphs per pad family (Xbox / PlayStation / Switch) and per XR
      controller (WebXR input-profile IDs).
- [ ] ❌ **S** Haptics: gamepad `vibrationActuator` + WebXR `hapticActuators`, exposed to world scripts (§2).
- [ ] ❌ **M** Radial **action menu** shared by all devices: mouse, gamepad stick-flick, VR thumbstick-flick or
      point-and-trigger (VRChat offers both "flick" and "pick"). One menu per hand in VR.
- [ ] ❌ **S** On-screen / in-XR keyboard for the chatbox and search when there's no physical keyboard.
- [ ] ❌ **S** Gamepad while in WebXR (seated VR with an Xbox pad): VRChat lacks this (VRChat feedback #1482). Cheap differentiator.
- [ ] 🟡 **S** VR controller bindings: map the `a-button`/`b-button`/`x-button`/`y-button` components of
      WebXR input profiles to jump, quick menu and mute (**2026-11-17:** right A jumps; the quick menu and mute
      need the XR menu layer first. Before that only trigger, squeeze and thumbstick press were bound;
      pressed/released state fixed 2026-11-17).
- [ ] ❌ **M** Finger-curl gestures from capacitive touch where WebXR exposes `touched` (Touch/Index thumb and
      trigger), and from hand tracking. **Browser limit:** WebXR doesn't expose Index per-finger curl, so full
      Index finger tracking needs hand-tracking emulation or an OSC/OpenXR bridge.
- [ ] ❌ **S** Accessibility: one-handed mode (VRChat added one only via third-party overlays), hold-vs-toggle
      for every hold action, sensitivity, invert axes, left-handed swap.
- [ ] ❌ **S** World scripts get *action-level* input events (`jump`, `use`, `grab`), never raw devices.
      A world built for keyboard then works on gamepad and VR for free (VRChat Udon's `InputJump`/`InputUse` model).
- [ ] ❌ **S** Steam Deck / Linux browser testing (Chromium + Firefox gamepad mapping differences;
      the Gamepad API only reports pads after a button press).

## 4. Scriptable spawnable objects (props)

VRChat only lets people spawn its own official items. **User-authored scripted props go beyond VRChat**, so
the rules in §5 matter more for Buzzar than they do there.

| | Item | Size | Notes |
|---|---|---|---|
| ✅ | 7 hard-coded prefabs (3 crates, 4 balls); grab/throw/scroll-distance/delete own | – | Action bar keys 1–9; XR maps only slot 1. |
| ❌ | **Prop format**: glb + optional WebSG script + manifest (name, size, scripted capabilities, per-user limit) | M | 🅼 `software.haven.prop` asset; share via repository rooms (MSC3948-style) or the user's own inventory room. |
| ❌ | Inventory UI (my props, favourites, world-provided props) | M | |
| ❌ | Per-prop scripts with held/use/drop/collide hooks (gun, laser, flower-petal picker) | L | Needs multi-script runtime + per-prop sandbox (§7). |
| ❌ | Network ownership rules for props (who can grab others' props; spawner keeps rights) | M | Grabbing someone else's object currently despawns and re-creates it. |
| ❌ | Physics interaction props (trampoline = bounce volume; needs a player-impulse API) | S | |
| ❌ | **User-placed portals** (prop that opens a portal to a chosen world) | M | See reference-worlds.md. Gated by world rules. |
| 🟡 | Enforced limits (count, allowed types, size, triangles, script on/off) | M | **Buzzar (2026-11-16):** every client validates what peers send (`src/engine/network/spawnRules.game.ts`): which Things (`software.haven.world.rules` → `objects`: a block or allow list of stock Things and exact custom Thing files, plus `blocked_behaviours` such as `HAVEN_trampoline`, which wins over the list; World Settings → Things, since 2026-11-20), per-person count (`max_member_object_cap`), and ownership (a peer may only create/move/delete/rename objects under its own peer index and only claim to be itself; nobody can remove a player). Violators are dropped and moderators get an in-world notice. Still to do: size/triangle limits for user props, a moderation bot acting on reports. |

## 5. World rules, moderation and access control

| | Item | Size | Notes |
|---|---|---|---|
| ✅ | Power levels gate scene/script edits; kick/ban/role change in the member list | – | No engine reaction to kicks: a kicked user's peer data must be dropped immediately. |
| ✅ | Per-world object cap | S | `max_member_object_cap` (reference worlds = 10). **Buzzar:** enforced by every receiving client, not just the spawner (2026-11-16). |
| ❌ | **World rules state event** 🅼 `software.haven.world.rules` | M | - max props per user, max prop/avatar size and perf rank<br>- avatar height min/max/forced<br>- allow avatar/prop scripts<br>- allow user portals (+ destination allow/deny)<br>- allow avatar audio/emote audio<br>- which power levels can spawn |
| ❌ | **Access zones**: named volumes in the scene + state event mapping zone → required power level / role / allowlist; engine-enforced (colliders block or teleport out) and host-validated | L | 🅼 The world doesn't depend on display names (VRChat does). |
| ❌ | **Gatekeeper admission flow** (lobby → main area, decided by people) | M | 🅼 This is the "human checks you at the door" pattern from VRChat lobby worlds. It's a judgement call by a person, not identity verification.<br>- A visitor in the lobby zone presses "request entry".<br>- Gatekeepers see a queue (in-world panel + 2D/XR UI) with who is asking, and click admit/deny. They can also admit someone directly by pointing at them.<br>- Admit has two modes, both stored as Matrix state:<br>&nbsp;&nbsp;- **this visit only**: a grant with `expires_ts`, plus a MSC4140 delayed event that clears it when the visitor leaves or disconnects;<br>&nbsp;&nbsp;- **persistent**: a grant with no expiry.<br>- A pending request is a per-user state event (`software.haven.zone.request`, state_key = visitor). Bots can watch the queue as well as humans.<br>- Gatekeepers can send people back to the lobby.<br>- The engine enforces it: zone colliders and the host reject or teleport out anyone without a grant. Scripts can't bypass it.<br>- Every admit, deny and revoke is logged. |
| ❌ | **Delegated gatekeeper role** (can admit to zone X, but isn't a full moderator; can be any visitor) | M | 🅼 **Decided: pure Matrix.** Zone access and "gatekeeper for zone X" are both roles in the *Role model* below:<br>- access to a zone = a role whose control is that zone;<br>- gatekeeper = a role whose control is "admit to zone X".<br>Persistent grants are PL-gated per role event type (`software.haven.role.<role_id>`), so the homeserver enforces them. Visitor-held gatekeeper roles admit through the role-granter path.<br>**Limitation:** whatever is enforced by power levels is a single ladder (lobby → main → VIP). Arbitrary delegation goes through roles checked by clients, or through a bot. |
| ❌ | **World roles** (Director, Gatekeeper, Actor, Stage crew, VIP, …) that **any visitor, even PL 0, can be given** | L | 🅼 See *Role model* below. Roles grant control of in-world things (gates, set changes, lights, picking volunteers) without touching `m.room.power_levels`. Can later be granted by entitlements (§7). |
| ❌ | Moderator in-world tools: kick from instance (vs. room), mute for everyone, freeze, teleport-to-lobby, delete anyone's props, hide an avatar for everyone | M | Instance-level actions go over RTC as authenticated commands. Room-level actions use Matrix kick/ban. |
| ❌ | **Personal safety**: per-user block (use Matrix `m.ignored_user_list`, not session-only), hide/show avatar, mute, personal space bubble, per-user volume | M | Today "ignore" lasts only for the session. |
| ❌ | Safety "shield" presets by trust (friends / room members / strangers): toggle avatars, avatar audio, scripts, particles, animations | M | Matrix has no trust ranks. Use: DM/friend status, shared rooms, account age, moderation-list membership (MSC2313 policy lists). |
| ❌ | **Anti-jumpscare / malicious-content protections** | M | - avatar audio loudness limiter<br>- max emote audio duration<br>- scale-rate limiting<br>- full-screen/near-camera geometry culling<br>- strobe/flash limiter<br>- script output rate limits<br>- per-user "panic" button that hides all non-friend avatars and props |
| ❌ | Report user/content (`/report` API) + moderation policy list subscription (MSC2313) | S | |
| ❌ | Group/community moderation across many worlds (VRChat Groups) | L | Matrix Spaces + shared policy lists + role sync. |
| ❌ | Audit log of moderation actions | S | Most of it comes free from the room timeline. Instance-level actions need logging events. |
| ❌ | Privacy: don't expose the Matrix ID on auto-join to crowded public worlds (#643); optional per-world display identity | M | |

### Role model (draft, pure Matrix)

**Requirement:** a random visitor can be handed control of things: a gate, the Director role in an
Audience-Anarchy-style world, a stage light board. Raising their power level is the wrong tool:
- edits to `m.room.power_levels` rewrite the whole map, so concurrent edits lose updates;
- the map grows with every visitor ever promoted;
- PL is a single ladder, so "Director" would also unlock every unrelated action at or below that level.

**Roles are separate from power levels:**

- **Role definitions:** a `software.haven.world.roles` state event. For each role it sets:
  - **controls:** which world objects or actions the role unlocks (gate IDs, `set.swap`, `lights.*`,
    `volunteers.pick`, `players.teleport_to_stage`, `audience.mute`, …);
  - **how it's granted:** one or more of the grant paths below;
  - **max holders, default duration, whether it ends on leave, and who may revoke it.**
- **Role grants:** per-user state, `software.haven.role.<role_id>` with state_key = the holder.
  Content: `expires_ts`, `granted_by`, an optional instance ID. A MSC4140 delayed event clears it on
  leave or expiry.
- **Using a role:** the holder's actions (open gate, swap set, pick a volunteer) are sent as in-world
  commands. **Every client and the host check the sender against current room state** before applying
  them. Scripts and widgets can only ask; the engine decides.

**Grant paths** (configured per role; worlds pick what fits):

| Path | Who writes the grant | Enforced by | Use for |
|---|---|---|---|
| **Granted** | A member with ≥ the role event's PL (moderator, gatekeeper, or a bot) | Homeserver (power levels) | Gatekeeper, VIP, persistent roles |
| **Self-claim** | The visitor themselves (role event type at PL 0) | Clients: claim is valid only if `state_key == sender`, a world rule allows self-claiming, and it's within the max holders (earliest valid claims win), with a mandatory short `expires_ts` | "Press the button to become Stage crew" |
| **Chosen by a world mechanic** (random from volunteers, queue, vote) | The current **role-granter**: a bot or moderator account (homeserver-enforced), or, if the world opts in, the elected instance host (client-checked; weakest trust) | Homeserver or clients, as noted | Director picked at random from volunteers |

Notes and open questions:
- **The Audience Anarchy flow:**
  1. Volunteers self-claim `volunteer`.
  2. The granter randomly picks from the valid volunteer claims.
  3. It writes a `director` grant (expires at the end of the scene) and clears the volunteer claims.
  4. All clients pick up the new state, and the stage controls unlock for that user.

  With a bot or moderator present, every step is enforced by the homeserver.
- **Worlds with nobody in charge present:** with no moderator or bot online, only the host-assigned path
  works. The weakness is that a modified client acting as host can assign roles to itself. VRChat has the
  same weakness (its "instance master" isn't a security boundary). Worlds that care should run a bot.
- **Self-claims rely on clients agreeing**, because Matrix rejected "owned state" (MSC3757/MSC3779).
  Any PL-0 member can technically write a claim for someone else; clients ignore claims where
  `state_key != sender`. The Buzzar MSC could revisit this if per-user state ownership is needed.
- Moderators can always revoke any role. Roles never grant Matrix moderation powers (kick, ban, PL changes).

## 6. Portals and world navigation

- [x] ✅ `OMI_link` portals with `matrix:r/` URIs, click-to-activate (reference worlds).
- [x] ✅ **S** Destination preview card (name, scene_preview, members, instance count). **Buzzar (2026-11-17):** the portal tooltip shows the picture, name, topic and member count (room summary API for worlds you haven't joined). Instance count waits for instances.
- [x] ✅ **S** Dead-destination handling (`#mars:thirdroom.dev` no longer resolves), plus following tombstones.
- [x] ✅ **S** Accept `matrix:roomid/…?via=` and `https://matrix.to/#/…`. Web-link portals now ask first and open in a new tab.
- [ ] ❌ **S** Optional walk-through activation (world opt-in).
- [ ] ❌ **M** 🅼 User-placed portals (see §4), moderator removal, world allow/deny.
- [ ] ❌ **S** 🅼 Moderator override of scene-baked portals (disable/retarget without re-upload).
- [ ] 🟡 **M** World discovery (Explore tab reads any server's room directory with the world room-type filter): Third Room uses `msc3948.repository_room.*` in `#repository-room:thirdroom.io`.
      Replace it with Spaces/room directory + `software.haven.*` metadata; keep reading the old format.

## 7. Script security, consent and external servers

Third Room gave every world script permission to send `m.room.message` as the visitor and to read
live and historic messages (including decrypted ones), with no prompt. **Buzzar v1 lockdown (2026-11-16)**
replaced that with default-deny and consent (`src/engine/matrix/scriptConsent.main.ts`, `matrix.main.ts`,
`src/ui/views/session/world/ScriptConsent.tsx`):

- [x] ✅ **Deny everything by default.** Scripts get no Matrix capabilities on `content_loaded`.
- [x] ✅ Consent tiers (v1):
      - **Free:** read the world room's *state* (any member can see it).
      - **Once per world and script version** (keyed on `script_url`; mxc URIs are immutable): read the *live*
        chat, never history. Remembered in account data `software.haven.world.script_grants` if the visitor ticks
        "Remember"; listed and revocable in Settings → World Scripts.
      - **Every time, showing the exact text:** post an `m.text`/`m.emote`/`m.notice` as the visitor. One prompt
        at a time; after 3 declines in a visit the world's sends are refused without asking.
      - **Never:** state events, any other event type, chat history, other rooms (and still: to-device, keys,
        power levels, moderation, OpenID).
      - The prompt is client UI (a React dialog) that scripts can't draw over. **Still to do:** an XR version.
- [x] ✅ Tag script-originated events: `software.haven.world.via_script: { world, script }` in the content.
- [x] ✅ "Run world scripts" setting (off = every world loads without its script, with a notice).
- [x] ✅ Scripts only from `mxc://` by default; http(s) script URLs need the visitor's opt-in
      ("Allow scripts from web addresses", which warns that it reveals their IP). *Scene/asset URLs not yet.*
- [ ] 🟡 **M** Rebuild the bridge on matrix-widget-api `ClientWidgetApi` with a Buzzar driver, with MSC2762
      capability negotiation and MSC2871 approved-capability notifications. The v1 lockdown keeps Third Room's
      wire format, so existing scripts work unchanged (they just ask first).
- [ ] ❌ **M** 🅼 The world event declares its capabilities + a **script content hash** (shown before entry,
      like an app permission sheet). v1 keys grants on `script_url` instead.
- [x] ✅ **S** Rate limits on script networking messages; per-world "disable this world's script".
      **Buzzar (2026-11-17):** each world script may send 30 messages and 32 KB a second (2 s burst); each peer's
      incoming script messages are capped at twice that, and excess is dropped with a warning. A world's ⋯ menu has
      "Enter Without Script", for that visit only (the next Enter runs it again, so it can't stay off by accident).
      **2026-11-18:** it only shows with Developer Mode on (Settings → Developer).
- [ ] ❌ **M** World-originated actions (scoreboards, persistence) are written by a world bot account
      (§9) with the right PL, never through visitors' accounts.
- [ ] ❌ **L** 🅼 **External server access (later phase).** VRChat's model is a good start:
      - URLs come only from a declared allowlist in the world event, never built at runtime;
      - rate-limited and GET-only by default;
      - no visitor identity sent unless the user consents.
- [ ] ❌ **L** 🅼 **Paid benefits / entitlements.** VRChat's equivalent is `DoesPlayerOwnProduct`, `OnPurchaseExpired`, etc. A world's
      entitlement server issues **signed entitlement claims** (e.g. a per-user state event or a verifiable token)
      that every client can verify. Clients never assert their own entitlements. The entitlement service
      runs as a Matrix bot (§9) that writes signed grant state events, so paid roles flow through the
      same zone/role machinery as §5.

## 8. Matrix protocol and MSC plan

- [ ] **Compatibility reader** for Third Room worlds:
      - read `org.matrix.msc3815.world`, falling back to `m.world`;
      - accept both `scene_preview_url` and `thumbnail_url`, and both `scene_from`/`from`;
      - read `max_member_object_cap`;
      - read the profile room `org.matrix.msc3815.world.profile`;
      - read account data `org.matrix.msc3815.world.home`.
- [ ] **Never rewrite** `org.matrix.msc3815.world` with Buzzar-only fields. Third Room's settings UI drops
      unknown fields, so Buzzar data goes in separate `software.haven.*` state events
      (`world.rules`, `world.zones`, `world.roles`, `role.<role_id>`, `world.portals`, `prop`, `avatar`, …).
- [ ] Buzzar room template:
      - room v12;
      - `software.haven.world` room type, or keep the msc3815 type + Buzzar events for maximum compat (**decision needed**);
      - restricted call/RTC permissions (not PL0 like the reference worlds);
      - encryption decision per world.
- [ ] Buzzar MSC (fork of MSC3815). Fill in Security/Alternatives, which upstream left as TODO. Cover:
      - capability/consent model (§7);
      - role model (grant paths, client-checked self-claims), §5;
      - MatrixRTC application `software.haven.world`;
      - avatar, prop and portal assets;
      - rules/zones/roles;
      - entitlements.
- [ ] Track and adopt: MSC4143/4195/4196/4354/4140 (all accepted 2025–26), MSC2313 policy lists,
      MSC3948 repository rooms (or replacement), MSC4032 attribution.

---

## 9. Bots as world participants

Because everything is Matrix events (see the design principle at the top), a bot is just a Matrix account
running a headless Buzzar client.

- [ ] ❌ **M** Bot SDK (Node, built on the same engine/networking packages as the web client):
      - join the world room and its MatrixRTC slot;
      - read and write world state (rules, zones, grants, requests);
      - receive in-world events (interactions, triggers, chat).
- [ ] ❌ **M** **Bots with avatars:** a bot publishes a pose stream and an avatar like any player:
      - move, emote and speak (TTS or audio file into its voice track);
      - interact with props and seats.
      Use cases: NPC hosts, game-show emcees, tour guides, auto-gatekeepers, bridged users.
- [ ] ❌ **S** Bots are always labelled: a bot badge on the nameplate, from a profile field or a world
      list of bot accounts set by moderators. Users can hide all bots through the safety settings (§5).
- [ ] ❌ **S** Bots follow the same rules as humans: power levels, world rules, zone grants, rate limits.
      They get no special server-side privileges.
- [ ] ❌ **S** Reference bots:
      - auto-gatekeeper (admits on criteria, e.g. a moderator-maintained allowlist);
      - scoreboard/persistence keeper;
      - entitlement bot (§7).
- [ ] ❌ **S** Headless mode doubles as the multi-client integration-test harness (§0).

## Suggested phase order

1. **Foundation:** matrix-js-sdk, authenticated media, room v12, script capability lockdown (§7 first bullets),
   reference-world regression tests.
2. **Avatars v1:** load custom glb/VRM, in-world switching, height scaling with world limits, perf limits, block/hide.
3. **Networking v2:** MatrixRTC + LiveKit, host authority + validation, instances, synced vars.
4. **Worlds v2:** animations, player API, seats, set swapping, audio API, clock, persistence. Ends with an
   Audience-Anarchy-style demo world as the acceptance test.
5. **VR & controls v2:** gamepad support + rebinding + gamepad UI navigation, the shared radial action menu, XR menus,
   hand tracking, 3-point IK, comfort options, then full-body.
6. **Props & rules:** prop format + scripts, inventory, world rules, access zones, roles, user portals.
7. **External servers & entitlements**, then the MSC write-up.
