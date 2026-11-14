# Buzzar: Matrix-protocol research for a Third Room fork

Research date: 2026-11-13. Source tree examined: `/home/user/.local/src/claude/buzzar` (Third Room `main` as of its last commit, 2023-07-11). MSC statuses were taken from the GitHub API for `matrix-org/matrix-spec-proposals` on the research date. "Merged" means the MSC was accepted, not that it has appeared in a published spec release.

---

## 0. TL;DR

- **MSC3815 is an abandoned draft.** It is still marked `[WIP]` and has been untouched since 2023-06-28. Its Potential issues, Alternatives and Security sections are all "TODO", and the only review thread is unresolved. **Third Room's code does not match the MSC text** (field names, the profile store, avatars, member events). Buzzar has to stay compatible with what Third Room *emitted*, not with what the MSC *says*.
- **Third Room's realtime stack is obsolete.** MSC3401 was closed as obsolete in Sept 2026. MSC3757 and MSC3779 were rejected in Oct 2025. MatrixRTC replaced all of them: MSC4143 core, MSC4195 LiveKit transport, MSC4196 `m.call`, MSC4354 sticky events and MSC4140 delayed events were all accepted between Sept and Oct 2026. MSC4143 even names Third Room as an example application.
- **Hydrogen is effectively unmaintained** (last release v0.5.1 in Oct 2024, relicensed to AGPL-3.0). Third Room pins a private fork, `@thirdroom/hydrogen-view-sdk@0.1.2`, from before authenticated media and still on libolm. **matrix-js-sdk** (Apache-2.0, Rust crypto via WASM, built-in `MatrixRTCSession`) is the recommended web path.
- **Room version 12 is the default room version, and it breaks Third Room's world creation.** `createWorld` and the home-world/profile creation put the creator in `power_levels.users`, and MSC4289 auth rules reject that.
- **Networking recommendation:** move to MatrixRTC with LiveKit as the transport. Use LiveKit audio tracks, LiveKit data tracks (lossy) for pose, and reliable data packets for commands. Define a custom MatrixRTC application such as `software.haven.world`, with one slot per instance. Full mesh cannot reach 40–80 users; Third Room's own estimate was that it bogs down at 10–20.
- **Security:** today, any world script runs in every visitor's client. Without asking the visitor, it can **post `m.text` messages as them** and **read the room timeline**, including decrypted E2EE messages and up to 1000 events of history. It can also exfiltrate that data over the networking API. Section 4 proposes a default-deny, intent-based capability model.

---

## 1. MSC3815 "3D Worlds" and related MSCs

### 1.1 Status

| Item | Value |
|---|---|
| PR | https://github.com/matrix-org/matrix-spec-proposals/pull/3815 |
| Title | `[WIP] MSC3815: 3D Worlds` |
| Author | robertlong (Robert Long, Third Room lead; now at Bezi) |
| State | OPEN, **draft**, created 2022-05-13, last updated **2023-06-28** |
| Labels | `proposal`, `A-Client Server`, `kind:feature`, `needs-implementation` |
| File | `proposals/3815-worlds.md` (branch `robertlong/worlds` on `robertlong/matrix-spec-proposals`) |
| Sections not written | Potential issues, Alternatives, Security considerations (all "TODO") |
| Dependencies | MSC3401 (group calls), MSC4032 (asset collections / attribution), MSC3948 (repository rooms) |

### 1.2 What the MSC text defines

**Unstable prefixes:** `org.matrix.msc3815.world`, `org.matrix.msc3815.world.avatars`, `org.matrix.msc3815.world.profile`, `org.matrix.msc3815.world.member`.

1. **Room type `m.world`**, set in `m.room.create.content.type`. 3D-capable clients render a scene. Other clients treat the room as a normal room. The example uses `room_version: "9"`.
2. **State event `m.world`** (state key unspecified, implicitly `""`). It describes the scene:
   - `scene_name`, `scene_description`
   - `scene_url`: an mxc or URL to a `.glb`, using Third Room's glTF extensions (`MX_*`, `OMI_collider`, `KHR_audio`, and others)
   - `thumbnail_url` (a 16:9 image) and `thumbnail_info` (`ThumbnailInfo`)
   - `script_url`: a JS or WASM WebSG script
   - `attribution[]`: `{title, source_url, author_name, author_url, license}` (from MSC4032), appended to the base scene's attributions
   - `base_scene`: an MSC3948 asset object `{version, name, description, url, asset_type: "m.world.scene", info:{mimetype,size,vertices,textures,materials,animations,audio,boundingBox{min,max},thumbnail_info,thumbnail_url,script_info,script_url}, attribution[]}`
   - `base_scene_from`: `{room_id, state_key}`, which points into a repository room. If the repository version is newer, users with permission are prompted to update and warned that local edits will be lost.
   - The top-level fields override the matching `base_scene` fields. Each of name, url and thumbnail must come from one or the other.
3. **State event `m.world.avatars`.** `allow_custom_avatars` (default true) and `avatars[]`, an array of asset objects with `asset_type: "m.world.avatar"`. If the event is absent, any avatar is allowed.
4. **Account data `m.world.profile`.** The text says `home_world_id` and `avatar_url`, but the example uses `default_avatar_url`, so the MSC contradicts itself. Clients create it on first sign-in.
5. **State event `m.world.member`**, with `state_key` set to the user's mxid and content `{avatar_url}`. It holds per-world overrides and is copied from the profile when the user joins.

The JSON examples in the MSC contain trailing commas, so they are not valid JSON.

**Unresolved review thread** (ara4n, on the `m.world` state event): "what's the state key? presumably we should be able to support multiple GLBs per world in order to represent the compose hierarchy?" Rob replied that composition should happen inside glTF through a future Khronos extension. ara4n's follow-up, "will the GLTFs (or GLB) binary diff nicely against each other?", was never answered. There were no other review comments and the MSC never reached FCP.

**Open questions the MSC never addresses:** permissions and power levels for `m.world.member` (the MSC requires users to send their own member state at PL0, which is the exact problem MSC3757 tried to solve and failed); world instances and sharding; persistence of world state; trust and safety for scripts (`script_url` runs code); external (non-mxc) URLs and the IP-leak risk; avatar formats (VRM?); size limits; encryption of scene assets; and multi-GLB composition.

### 1.3 What Third Room actually emits (from the code)

Grep of `src/`:

| Concept | MSC3815 text | Third Room code | Location |
|---|---|---|---|
| World room type | `m.world` / `org.matrix.msc3815.world` | `org.matrix.msc3815.world`, via the Hydrogen fork's `RoomType.World` | `src/ui/hooks/useRoomsOfType.ts:17`, `MemberListDialog.tsx:69` |
| World state event | `m.world` (`""`) | `org.matrix.msc3815.world`, `state_key ""`. It also *reads* a legacy `m.world` state event as a fallback. | `WorldSettings.tsx:75,125`, `WorldRootView.tsx:19` |
| Scene URL | `scene_url` | `scene_url` ✓ | `CreateWorldForm.tsx:197`, `useWorldLoader.ts:52` |
| Thumbnail | `thumbnail_url` / `thumbnail_info` | **`scene_preview_url`**, with no info object | `CreateWorldForm.tsx:198`, `useHomeWorld.ts:46` |
| Script | `script_url` | `script_url` ✓. Arbitrary http(s) URLs are also accepted, not only mxc. | `ScriptEditor.tsx:139`, `useWorldLoader.ts:53` |
| Base scene | `base_scene`, `base_scene_from` | **`scene`** and **`from`** on write, **`scene_from`** on read. The read/write names don't match, which is a bug. | `useUpdateScene.ts:40-55` |
| Extra fields | – | `max_member_object_cap` (number), `home: true`, `version` (home world) | `WorldSettings.tsx:131`, `useHomeWorld.ts:44-47` |
| Profile | account data `m.world.profile` | A **private room** of type `org.matrix.msc3815.profile` ("Third Room - Profile", PL 100 for everything) holding state `org.matrix.msc3815.world.profile` `{avatar_url, avatar_preview_url}` | `useUserProfile.ts:63`, `Edit3DAvatar.tsx:38` |
| Home world | `m.world.profile.home_world_id` | Account data **`org.matrix.msc3815.world.home`** `{version, room_id}` | `useHomeWorld.ts:80-110` |
| World member | `m.world.member` `{avatar_url}` | `org.matrix.msc3815.world.member`, written only by `updateWorldProfile()`, which is **never called** (dead code). The PL override grants PL0 to the misspelled `org.matrix.msc3815.member.world`, so normal users could not send the real event anyway. | `matrixUtils.ts:80-91`, `CreateWorldForm.tsx:127` |
| World avatars | `m.world.avatars` | **Not implemented** | – |
| Remote avatars | – | Not implemented. Everyone is a mixamo bot; issues #265 and #266 are open. | – |
| Repository room (MSC3948) | `m.repository_room` … | `msc3948.repository_room.featured_world`, `.featured_room`, `.featured_scene`, `.scene`. These are **not** under `org.matrix.*`. | `DiscoverView.tsx:23-26` |
| Group call | MSC3401 | `org.matrix.msc3401.call`, `org.matrix.msc3401.call.member`, both at PL0 in world rooms; to-device `m.call.*`; `org.matrix.msc3077.sdp_stream_metadata` | `CreateWorldForm.tsx:125-126`, Hydrogen fork |
| Location | MSC3672 | Scripts may receive `org.matrix.msc3672.beacon` | `matrix.main.ts:136` |
| Pinned hosts | (TRNP doc) | `docs/protocol/index.md` says pinned hosts live in an `m.world` event. No code implements this. | – |
| Auth | MSC3861/MSC2967 | OIDC login with scope `urn:matrix:org.matrix.msc2967.client:api:*` | `LoginView.tsx:107` |
| Onboarding | – | Account data `io.thirdroom.onboarding`, `io.thirdroom.whats_new` | – |

**World room power levels as created by Third Room** (`CreateWorldForm.tsx:111-130`): invite, kick and ban at 100; redact 50; `state_default` 50; `events_default` 0; `m.room.encrypted` at **50** (so regular users cannot chat in an E2EE world); `org.matrix.msc3815.world` at 50; MSC3401 call events at 0; `users: {creator: 100}`. Worlds are created with `isEncrypted: false`.

**Compatibility consequences for Buzzar:**
- **Read:** the room type `org.matrix.msc3815.world`; the state `org.matrix.msc3815.world` (and the legacy `m.world`); `scene_url` with a fallback to `base_scene.url`; `scene_preview_url` with fallbacks to `thumbnail_url` and `base_scene.info.thumbnail_url`; `script_url`; `max_member_object_cap`; `scene` / `base_scene`; `from` / `scene_from` / `base_scene_from`.
- **Avatars:** read the profile room *and* the account-data variants. Read `org.matrix.msc3815.world.member` if present, but don't depend on it.
- **New data:** put Buzzar-specific data in **separate** namespaced state events (for example `software.haven.world.*`) rather than adding fields to the shared event. That way a Third Room client editing the world (with `{...content}` spreads) won't drop Buzzar fields, and the reverse holds too. Third Room's `WorldSettings` *does* drop unknown fields: it rebuilds content from scratch, keeping only `max_member_object_cap`, `scene_url`, `scene_preview_url` and `script_url`.

### 1.4 Related MSCs (status on 2026-11-13)

| MSC | Topic | Status | Relevance |
|---|---|---|---|
| 3401 | Native group VoIP (full mesh, `m.call` / `m.call.member` state, to-device `m.call.*`) | **CLOSED, obsolete** | Third Room's transport. Replaced by MatrixRTC. |
| 3077 | Multi-stream VoIP (`sdp_stream_metadata`) | Merged 2023 | Used by Hydrogen's call stack |
| 3948 | Repository room for Third Room | OPEN draft, stale since 2023-06 | Discover page |
| 4032 | Asset collections (asset and attribution objects) | OPEN, stale since 2023-11 | Data structures for MSC3815 |
| 1767 | Extensible events | Merged 2023 (spec PR missing, blocked on a room version) | Text fallbacks for custom events; useful for "world posted X" fallbacks |
| 3489 / 3672 | Live location (history / ephemeral) | OPEN | 3672 beacons are exposed to scripts. 3489 is being rebased onto sticky events. |
| 2762 | Widgets send/receive events (capabilities) | OPEN (de facto standard) | Model for script capabilities |
| 2871 | Tell widgets which capabilities were approved | OPEN | " |
| 2974 | Capability re-exchange | OPEN | " |
| 3819 | Widgets send/receive to-device | OPEN | Needed by Element Call in widget mode. Dangerous for scripts. |
| 4039 | Widget media upload/download | OPEN | – |
| 4157 | Delayed events for widgets | OPEN draft | – |
| 4407 | Sticky events for widgets | OPEN | – |
| 1960 | OpenID token for widgets | Merged 2020 | Identity leak to third parties if exposed to scripts |
| 2931 | Widgets navigate via matrix.to | OPEN | Portals |
| 3861 / 2967 | Next-gen auth (OAuth 2.0) / API scopes | **Merged 2025-04** | Third Room already used OIDC through Keycloak |

---

## 2. Matrix real-time infrastructure in 2025–2026

### 2.1 MSC timeline

| MSC | Title | Status |
|---|---|---|
| 3401 | Native Group VoIP Signalling | **Closed, obsolete** (updated 2026-09-16) |
| 3757 | Restricting who can overwrite a state event | **Closed, rejected** (2025-10) |
| 3779 | "Owned" state events | **Closed, rejected** (2025-10) |
| 4140 | Cancellable delayed events | **Merged 2026-09-08** |
| 4143 | MatrixRTC core | **Merged 2026-10-21** (spec PR missing) |
| 4195 | LiveKit transport for MatrixRTC | **Merged 2026-10-21** (spec PR missing) |
| 4196 | `m.call` voice/video application | **Merged 2026-10-21** |
| 4354 | Sticky events | **Merged 2026-10-20** (spec PR in review) |
| 4158 | MatrixRTC focus in .well-known | Closed, obsolete (replaced by the `/rtc/transports` endpoint) |
| 4310 | `m.rtc.decline` | Closed, obsolete |
| 4075 | MatrixRTC invites/notifications | OPEN |
| 4222 | `state_after` in /sync | Merged 2025-07 |
| 4186 | Simplified Sliding Sync | **Merged 2026-06-29** (MSC3575 closed as obsolete) |
| 3861 / 2967 | OAuth 2.0 next-gen auth / scopes | Merged 2025-04 |
| 4108 | QR-code login and E2EE setup | OPEN, proposed FCP (disposition merge) |
| 4153 | Exclude non-cross-signed devices | Merged 2025-10 |
| 4268 | Share room keys for past messages | Merged 2026-04 |
| 3414 / 4362 | Encrypted state events | OPEN drafts |
| 4304 | **Room version 12**: MSC4289 + MSC4291 + MSC4297 (+ MSC4307) | Merged; v12 is the **default** room version |

Spec releases: v1.17 (2025-12-18), v1.18 (2026-03-26, trust and safety: policy servers and invite blocking), v1.19 (2026-07-08). At the Oct 2026 Matrix Conference the next release was billed as "Matrix 2.0", bundling MatrixRTC, sticky events, delayed events and Simplified Sliding Sync. On the research date the MatrixRTC MSCs were accepted but their spec PRs were still outstanding.

### 2.2 MatrixRTC (MSC4143) in brief

- **Slots** are `m.rtc.slot` state events (unstable `org.matrix.msc4143.rtc.slot`) with `state_key = "{application_type}#{application_slot_id}"`. Content is `{status: "open"|"closed", application:{type,...}, encryption:{type:"m.per_member"}}`. Slots need the state power level, which means admins decide which RTC applications a room allows. MSC4196 uses `m.call#room`.
- **Membership** is `m.rtc.member`, sent as **sticky events** (MSC4354) rather than state, with a recommended stickiness of 1 hour that is refreshed. Content is `{slot_id, member:{id}, membership:"join"|"leave", application:{type,...}, transports:{published:[{type:"m.livekit", ...}], can_subscribe:[...]}, sticky_key}`. Leave-on-disconnect uses an **MSC4140 delayed event** that the client (or the SFU, via the delegated restart/send endpoints) keeps restarting.
- **MSC4143 explicitly mentions Third Room:** "a Third Room application could include approximate map positions [in `application`], allowing clients to avoid connecting to members outside their area of interest."
- **Transport discovery:** `GET /_matrix/client/v1/rtc/transports` (unstable `/_matrix/client/unstable/org.matrix.msc4143/rtc/transports`; the reference implementation returns `rtc_transports`).
- **E2EE (`m.per_member`):** each member generates a sender key and sends it to the devices of joined members as Olm-encrypted to-device `m.rtc.encryption_key` messages (unstable `io.element.call.encryption_keys`). Keys rotate on membership change and periodically, with a recommended 5 s delay before use. Clients should drop keys from non-cross-signed devices (MSC4153).
- **Reference implementation:** `matrix-js-sdk/src/matrixrtc/` (`MatrixRTCSession`, `MembershipManager`, `RTCEncryptionManager`, `ToDeviceKeyTransport`, `LivekitTransport`), plus Element Call, Element Web and Synapse.

### 2.3 LiveKit transport (MSC4195)

- `m.livekit` transport `{type, url}`. It is a **multi-SFU** design: each member publishes on its own homeserver's SFU, or on a remote one, and subscribers connect to the SFU of each publisher. No SFU election is needed.
- Tokens come from `POST /_matrix/client/v1/rtc/livekit/get_token` and the federation variant. Today they are usually served by Element's `lk-jwt-service` (AGPL-3.0). LiveKit room names and participant identities are pseudonymised hashes.
- E2EE uses LiveKit's frame encryption through a custom key provider fed by MatrixRTC keys.
- **Documented weaknesses:**
  - **SFrame has no per-sender authentication.** A joined member, or a colluding SFU, holding another member's key can forge that member's frames.
  - Encrypted `m.rtc.member` events can't be checked by the server, so a room member can obtain a token and observe metadata (who is speaking or publishing) without joining. Clients SHOULD flag unmappable participants.
  - The design depends on a commercial vendor's protocol (Apache-2.0).
  - There is no P2P transport.
- **LiveKit features relevant to VR:**
  - Data packets (reliable or lossy) and text/byte streams. These are E2EE when the room's `encryption` option is set ("encrypts all text messages, byte streams, and data packets").
  - **Data tracks** (announced 2026-04-03): arbitrary binary data published as a track over unordered, lossy data channels. The SFU **forwards only to subscribed participants** (selective subscription), and payloads are E2EE when enabled. SDKs: JS, Rust, Python, C++, Unity.
  - Per-track subscription and adaptive stream for audio and video.

### 2.4 Other relevant infrastructure

- **Sticky events (MSC4354)** are the new primitive for per-user, per-device, last-write-wins ephemeral room data with guaranteed eventual delivery. They are ideal for **Buzzar presence in a world, per-world avatar selection, live position/area hints, and "instance membership"**, replacing the PL0 state-event pattern that MSC3815's `m.world.member` relies on. Unstable names: `msc4354_sticky` and `org.matrix.msc4354.sticky_duration_ms`. Sliding-sync extension: `org.matrix.msc4354.sticky_events` (MSC4480 pending).
- **Delayed events (MSC4140):** `PUT /_matrix/client/v1/rooms/{roomId}/delayed_event/{eventType}/{txnId}`, and `POST /_matrix/client/v1/delayed_events/{delay_id}/{restart|send|cancel}`. Use them for leave-on-disconnect, and potentially for "dead-man switch" world-instance cleanup.
- **Room version 12 (MSC4304)** is the default for new rooms. Three changes matter:
  - **MSC4289:** creators (the `m.room.create` sender plus `additional_creators`) have *infinite* power level, and **`power_levels.users` must not contain them, or the event is rejected.** Third Room's `createWorld`, `createHomeWorld` and profile-room creation all pass `powerLevelContentOverride.users: {[me]: 100}`. **That fails on v12 servers**, so Buzzar must either omit the creator or pin `room_version: "11"`. Third Room's UI PL checks (`getPowerLevel`) and the TRNP host election ("highest power level") must also treat creators as infinite.
  - **MSC4291:** room IDs are hashes of the create event, with no `:server` part. Don't parse server names out of room IDs, and use `via` servers instead.
  - **MSC4297:** state resolution v2.1.
- **Encrypted state (MSC3414/MSC4362)** is still in draft. World state (scene URLs, scripts) stays **plaintext** to servers even in E2EE rooms, so private worlds leak their scene metadata to homeservers.
- **Authenticated media (MSC3916, merged 2024-06; matrix.org froze unauthenticated media in 2024).** Third Room's Hydrogen fork predates Hydrogen 0.5.0's authenticated-media support and generates `/_matrix/media/v3/download` URLs. On modern servers, **new uploads (scenes, scripts, avatars) will not load.** Buzzar needs `/_matrix/client/v1/media/download` with a bearer token, fetched inside workers. That breaks plain `<img src>` and `fetch` without headers, so a service-worker auth shim is needed (Element uses one).
- **Rooms, policy and moderation:**
  - Policy lists (MSC2313, in spec) and **policy servers** (MSC4284, merged 2026-02; in v1.18).
  - Invite filtering (MSC4155, open).
  - Restricted joins (MSC3083, in spec), which can gate world instances on space membership.
  - Role-based PLs (MSC2812 and MSC4056) remain drafts. For "world rules", use the existing per-event-type `power_levels.events` map plus custom namespaced state events, such as `software.haven.world.rules` restricted to moderators.
  - Service members (MSC4171, open) mark bots and world-service accounts.
  - Reporting (MSC4260, MSC4277) is merged.
- **Matrix 2.0 pieces:** native OAuth 2.0/OIDC (MSC3861, merged; MAS is the reference server), Simplified Sliding Sync (MSC4186, merged; Synapse has it natively, so no proxy is needed), MatrixRTC, and QR login (MSC4108, near FCP).

### 2.5 SDK choice

| SDK | Status (2026-11) | Licence | Verdict |
|---|---|---|---|
| Hydrogen (`element-hq/hydrogen-web`) | Last release v0.5.1 (2024-10). Commits since then are trivial (bug-report URL, AGPL relicence 2025-01). Not archived, but maintenance-only. Uses deprecated **libolm**. Its MSC3401 call stack is obsolete. No MatrixRTC, sticky events or delayed events. | **AGPL-3.0** since 2025 (Third Room's fork derives from the earlier Apache-2.0 code) | **Migrate away** |
| `@thirdroom/hydrogen-view-sdk@0.1.2` | Frozen private fork from 2023. No authenticated media. libolm. | Apache-2.0 | Dead end |
| **matrix-js-sdk** | Very active. Crypto is Rust (`matrix-sdk-crypto-wasm`, vodozemac). **Ships MatrixRTC** (`MatrixRTCSession`, LiveKit transport, per-member to-device E2EE). Supports sliding sync and OIDC. | Apache-2.0 | **Recommended for the web client** |
| matrix-rust-sdk | Very active, powers Element X. Rich high-level APIs (sliding sync, `matrix-sdk-ui`), FFI to Kotlin, Swift and others. The WASM target for the full client is less mature than the crypto-wasm crate. | Apache-2.0 | Recommended for a future **native** client (Godot, Unity or Unreal plugin, or a Rust engine) |
| matrix-widget-api | Active, host side (`ClientWidgetApi`, `WidgetDriver`) | Apache-2.0 | Reuse for the script bridge (section 4) |
| Element Call / lk-jwt-service | Active | AGPL-3.0 | Run lk-jwt-service as a service, or depend on homeserver-native `get_token`. Do not vendor Element Call code into an Apache client without considering the licence. |

### 2.6 Networking recommendation: full mesh vs MatrixRTC with LiveKit

**Third Room today (TRNP, `docs/protocol/index.md`):** MSC3401 full mesh. Every pair of peers has an `RTCPeerConnection` carrying audio plus reliable and unreliable data channels. On top of that sits a **host-authoritative** layer: the host is elected by power level, then join time, then mxid, and it relays all non-owned entity updates and sends `HostSnapshot`. Third Room's own blog said "after 10–20 users, things can start to bog down", and issue #126 ("Determine maximum world capacity without SFU") aimed for about 20.

**Back-of-envelope figures for 80 users** (Opus at about 32 kbps, plus full-body pose at about 20–30 Hz, roughly 20–60 kbps per avatar with IK/FBT):
- **Full mesh:** each client runs 79 PeerConnections, with 79 ICE, DTLS and SRTP contexts and 79 Opus *encodes* (browsers encode per connection unless you use insertable streams). Upload is about 79 × 80 kbps ≈ 6+ Mbps, and the TRNP host relays everyone's updates on top of that, so host upload is O(N²). That is impossible on residential uplinks and in the Quest browser.
- **SFU:** each client publishes once (about 100 kbps up). Download is O(subscribed), and you can subscribe by distance or interest: voice for the nearest ~20, pose at reduced rate for far avatars. LiveKit handles hundreds of participants per room, and its data tracks give **selective forwarding of pose streams**, which is exactly VR interest management.

**Recommendation:**
1. **Adopt MatrixRTC with `m.livekit` as the primary transport** through matrix-js-sdk's `MatrixRTCSession`. Define a Buzzar MatrixRTC application, for example `software.haven.world` (stable name `m.world` in the forked MSC). Use **slot ID `software.haven.world#<instance>`** to get VRChat-style **instances**: several concurrent sessions per world room, capped at about 40–80 each. Put coarse position or area hints and the avatar reference in `m.rtc.member.application`, as MSC4143 itself suggests for Third Room.
2. **Map channels:**
   - Voice: LiveKit audio tracks, spatialised locally, subscribed by distance.
   - Pose and transforms: **data tracks** (lossy, selective, E2EE). Use one track per avatar so subscribers can drop distant ones.
   - Reliable RPC (spawn/despawn, authority transfer, script messages): LiveKit reliable data packets or byte streams.
   - Large blobs: Matrix media.
3. **Keep TRNP's logical model** (network IDs, schemas, host authority and authority transfer) but carry it over the new channels. Host election can stay deterministic from `m.rtc.member` order, after fixing the v12 creator-PL issue. For persistent or authoritative worlds, add an optional **"world server" participant**: a headless Buzzar or LiveKit-agent client under a service account (MSC4171) that hosts authority instead of a random user.
4. **Fallbacks:** MatrixRTC has no P2P transport. If small P2P instances (2–8 people, no SFU available) are worth keeping, define an experimental transport such as `software.haven.p2p_mesh` in `transports.published`. That is legal under MSC4143's transport abstraction. Don't stay on MSC3401: it is closed as obsolete and no maintained SDK speaks it.
5. **Deployment:** Buzzar homeservers need a LiveKit SFU and a token endpoint. Members on SFU-less servers can publish on a remote member's SFU (MSC4195 multi-SFU), subject to that server's trust policy. Element Call restricts automatic room creation to trusted homeservers.
6. **Security caveats:** SFrame and LiveKit E2EE do not authenticate the sender within the key-holding group, so any member can in principle forge another member's pose or audio frames *if* the SFU colludes. LiveKit's own participant identity, enforced by the JWT, prevents ordinary clients from publishing on someone else's track. Rotate keys on every join and leave (per MSC4143). Treat all network data from peers as untrusted input to the engine.

---

## 3. Third Room's roadmap, promises and post-layoff status

### 3.1 Timeline

- 2021-09: repo created. 2022-04: Development Update (Discussion #47).
- **2022-09-27, Tech Preview 1** ([blog](https://matrix.org/blog/2022/09/27/announcing-third-room-tech-preview-1/)). "What's left": custom avatars (everyone was a mixamo Y-bot), user-generated content and scripting (sandboxed WASM), a full editor, **persistence** (store glTF blobs in the room), VR/AR, mobile web, **SFU VoIP** (full mesh limits rooms to about 10–20), engine features (realtime shadows, TRAA, DoF, animated assets).
- **2023-06-07, TP2 "The Creator Update"** ([blog](https://matrix.org/blog/2023/06/07/introducing-third-room-tp-2-the-creator-update/)). Shipped WebSG scripting (JS via QuickJS-in-WASM, or C to WASM), in-world UI, Action Bar, collision listeners, an ECS API, a networking API, **Matrix widget API inside scripts**, an in-world editor/inspector (admin-only, with a Monaco script editor), **opt-in authoritative networking**, the Discover page (MSC3948 repository room), basic WebXR, and a docs site. Remaining: finalise authoritative networking and interpolation, **persistence**, the Firefox GC regression, **custom avatars**, shadows, **mobile web**, a **full editor** (gizmos, create/copy/delete nodes, debugger), and content. The next release was meant to be "final tech preview and first beta". The post also asked organisations to fund the project.
- 2023-06-29: "TP3 refactor" merged. **Last commit 2023-07-11.** Last push 2023-08-30.
- **~2023-07-27: "Third Room is paused due to lack of funding"** (topic of #thirdroom-dev:matrix.org, linking https://twitter.com/thirdroomio/status/1684643892195631104). The July 2023 matrix.org funding post described the Third Room team as "a tiny band formed by Robert, Nate and Ajay" operating outside core Matrix work, in the context of Element cutting core-team staffing. Robert Long now lists Third Room as past work. In issue #643 a commenter wrote "This project is dead. The matrix foundation laid off the people working on it."
- The repo is **not archived** (658 stars, 70 forks, no releases). thirdroom.io still serves a shell page.

### 3.2 Promised but unfinished (Buzzar backlog candidates)

From the blog posts, the epics (#62 Manifold Editor, #63 Manifold Engine, #64 Third Room UI) and open issues:

- **Avatars:** custom avatar loading (Edit3DAvatar uploads one, but the engine never renders remote custom avatars: #265 "Honour remote avatars", #266 "pick x-bot or y-bot", #246 and #385 "see my own avatar"); **VRM support**; Hubs avatar support; `m.world.avatars` allow-lists; per-world member avatars.
- **Scaling:** an SFU (#126, about 20 users without one), room caps, discovery and load balancing across instances (#201, #395), dynamic network interpolation buffers (#237).
- **Persistence** of world edits and object state into Matrix (never started).
- **Editor:** the full property panel (#473), hierarchy context menu (rename, delete, duplicate, group), prefabs, 3D gizmos, multiplayer and **in-XR collaborative editing**, script editor history (#578), and a debugger.
- **WebSG expansion:** `world.setCharacterController()` (#615), basketball APIs (#600), C and other language docs, robust error handling (#619 script errors prevent world loading; #605 disposal leak).
- **XR/VR:** WebXR "flip the bit" was done in TP2 without UI overlays. In-VR UI, full body tracking (Discussion #343), and VR locomotion features (e.g. #367 climbing ladders) were not done.
- **Mobile:** touch controls (#156) and mobile web.
- **Social/UI:** presence, participant lists, mic/speaker device selection, typing indicators on nametags (#236), unread notifications (#456), power-level selector (#549), map view (#461), screen sharing (#398), a11y (#399), configurable keybindings (#382).
- **Profile interop:** use the standard profile key/value store (#380, which is now possible with extended profiles) and send avatars as attachments (#379).
- **Engine:** realtime shadows with lightmaps (#204), LOD, light probes, postprocessing, dynamic resolution (#211), instanced physics (#128), perf telemetry (#476).
- **Ops:** Dockerfile and static hosting (#591, #590), token lifetimes (#455), oversized Keycloak tokens (#168).
- **Specs:** MSC3815, MSC3948 and MSC4032 never left draft. The glTF `MX_*` extension READMEs are mostly "TODO".

**Notable open bugs:**
- #619: a script error prevents the world from loading.
- #613: objects fall through the floor on script reload.
- #404 and #348: world members show no display name or avatar, or appear as "Player".
- #384: spamming spheres overloads audio and the client goes silent (a DoS vector).
- #358: spatial audio drops off too fast.
- #519: dark materials on Mali GPUs (Quest-relevant).
- #525: frame pacing on high-refresh Windows.
- #342: can't join a remote room because no `via` servers are given.
- #304: Hydrogen makes an invalid device-key query for guests.
- #643: auto-placing users into a crowded public home world reveals their mxid. This is a privacy concern.

From the code audit: the `from`/`scene_from` mismatch, the misspelled `member.world` PL entry, dead `updateWorldProfile`, v12 creator-PL rejection, no authenticated media, and `m.room.encrypted` at PL50 in worlds.

### 3.3 Forks

None is a maintained continuation.

| Fork | Ahead of upstream | Activity |
|---|---|---|
| `XCDRorg/multiverzum` | 14 commits | Security dependency bumps and Podman deployment (2026-07); live KHR_audio streaming (2026-09). Small, but the only one recently active. |
| `kevzettler/thirdroom` | 12 commits | 2024. Strips the Third Room modules to make an offline glTF scene viewer. |
| `emberian/ea-grl` | 9 commits | "a sandbox" (2024) |
| `zkhin`, `luvnft` | 1–2 commits | – |

None of them migrated off Hydrogen or MSC3401.

---

## 4. Security: world scripts and the user's Matrix session

### 4.1 What Third Room does today

The bridge lives in `src/engine/matrix/matrix.main.ts` and `matrix.game.ts`, and scripts call it through `matrix.listen/send/receive`.

- Scripts speak a **postMessage-style Widget API** (`fromWidget`/`toWidget`, `content_loaded`, `send_event`, `read_events`), passed as JSON strings from the WASM sandbox to the game worker and on to the main thread.
- On `content_loaded`, the host **silently grants hard-coded capabilities** (`// TODO: Capabilities`): `m.send.event` → `m.room.message#m.text`, and `m.receive.event` → `m.room.message` and `org.matrix.msc3672.beacon`. **The user is never asked**, and the script cannot negotiate capabilities.
- Every new timeline entry of those types is pushed to the script. This includes **decrypted** messages in E2EE rooms, because Hydrogen surfaces them as `m.room.message`. `read_events` can pull up to **1000** historical events (`DEFAULT_TIMELINE_LOAD_LIMIT`) and **state events by type** (it checks `m.receive.event` instead of `m.receive.state_event`).
- Sends go through `room.sendEvent` and `hsApi.sendState` **as the visiting user**. The `widgetId` is chosen by the script, and there are no rate limits.
- The script itself comes from `script_url` in world state. **Anyone with PL ≥ 50 on `org.matrix.msc3815.world`** can change it, from the in-world editor or WorldSettings, and it then runs on **every** visitor's client, or on the host only in authoritative mode. `script_url` may also be an arbitrary http(s) URL. Scenes may reference external URLs too, which leaks visitors' IPs.
- Scripts also get the **networking API** (`network.broadcast`, `peer.send`), so a script can read chat and **exfiltrate** it to a colluding peer.

**Abuse scenarios:**
- A malicious world owner, or a compromised moderator account, ships a script that posts spam, phishing or harassment *as each visitor*. The ready-made `widget-echo` example is one regex away from this.
- A script harvests every visitor's chat and history in E2EE worlds.
- An auto-joined home or public world (#643) exposes users to scripts they never chose.

If the bridge were extended with the rest of the Widget API, more becomes possible: to-device spam and fake key requests (MSC3819), state changes, OpenID tokens that leak identity to the script's backend (MSC1960), media upload abuse (MSC4039), navigating users into other rooms or joining them (MSC2931), and sticky or delayed events (MSC4407/MSC4157).

**In-VR UI spoofing:** a script that controls the 3D scene can draw a fake "Allow?" dialog, or a fake system UI that phishes for passwords.

### 4.2 Existing patterns

- **Widget API capability negotiation** (MSC2762, with MSC2871 and MSC2974). Capability strings: `m.send.event:<type>`, `m.send.event:m.room.message#<msgtype>`, `m.send.state_event:<type>#<state_key>`, `m.receive.event:<type>`, `m.receive.state_event:<type>`, `m.timeline:<room_id|*>`, `org.matrix.msc3819.send.to_device:<type>`, `org.matrix.msc4039.upload_file`, `org.matrix.msc4157.send.delayed_event`, `org.matrix.msc2931.navigate`, and others.
  - The client shows a consent dialog, can remember approvals per widget, and Element Web auto-approves some well-known widgets such as Element Call.
  - **Element Call runs as a widget** with exactly this model, so it is the prior art for "RTC application embedded in a client".
  - Implementation: `matrix-widget-api`'s `ClientWidgetApi` and a `WidgetDriver.validateCapabilities()`.
- **OAuth 2.0 scopes** (MSC2967) are coarse (`urn:matrix:client:api:*`), so they are not useful for in-client sandboxing.
- **Web platform analogues:** permissions with a user-gesture requirement, trusted UI surfaces, origin-bound grants, and Web Intents (the app *proposes* an action and the user agent *executes* it after confirmation).

### 4.3 Recommended capability model

1. **Default deny.** A world script gets **no Matrix capabilities**. It keeps only engine APIs (scene graph, physics, UI) and instance networking, and peer IDs on the network are stamped by the transport, never by the script.
2. **Declared manifest.** The world's Buzzar state event lists requested capabilities using MSC2762 strings, plus a script hash. For example: `software.haven.world.script: {url, sha256, capabilities:[...]}`. Capabilities are always **scoped to the current world room**. `m.timeline:*`, other room IDs, `join`, `invite`, `kick` and `ban`, account data, to-device, OpenID and key-related types are **never grantable**.
3. **Grants are bound to (room_id, script sha256, capability set).** Any change to `script_url` or its content by any PL50 user **invalidates the grants and re-prompts**. Store grants client-side, or in encrypted account data, never in the room.
4. **Tiered consent:**
   - **Tier 0, auto-granted:** read world-room state of Buzzar-namespaced types (`software.haven.*`), membership, and `m.rtc.member` for the instance. The script author, as an admin, already sees these. Send-capability here is limited to *per-user* sticky or app events under a Buzzar namespace that render as non-messages, for example a score, and only under the user's own `sticky_key` or `state_key`.
   - **Tier 1, prompt once per world and script version, revocable:** receive the live `m.room.message` timeline (no history), with a stronger warning in E2EE rooms; send namespaced custom events (`software.haven.app.<world-defined>`); upload media up to a quota.
   - **Tier 2, per-action intent and never silent:** anything **attributable to the user in human-readable form**, such as `m.room.message`, reactions, profile or avatar changes, navigating or joining another room (portals), or sharing location. The script calls `matrix.requestSend(event)`. The **client** renders a preview ("<World> wants to post as you: '…' [Send] [Edit] [Cancel]") in a **trusted UI layer**: a client-owned overlay or wrist panel that scripts cannot draw over or occlude, with an unforgeable indicator. "Always allow for this world" is offered only for low-risk custom types, never for `m.room.message`.
   - **Never:** to-device, encryption and key events, `m.room.power_levels`, `join_rules`, member kicks and bans, cross-room actions, OpenID token export, delayed or sticky events with long durations, raw `/sync` access, reading history beyond join time.
5. **Attribution on the wire.** Events sent on behalf of a script carry `software.haven.via_script: {world: <room_id>, script_sha256}` (or a proposed `m.client_app` field in Buzzar's MSC). Clients can then render "sent via <World> script", and moderators can redact by origin.
6. **Rate limits and quotas** per script and per world: events per minute, bytes uploaded, network messages per second. A kill switch: "Disable scripts in this world", plus a global "safe mode" that loads the scene without scripts.
7. **World-owned actions use a world identity, not visitors.** Things like scoreboards and persistent world state should be sent by a **world service account** (an appservice or headless authoritative client, flagged with MSC4171) or by the elected host *only* with tier-2 consent. Never broadcast them as arbitrary visitors.
8. **Implementation:** replace the ad-hoc bridge with `matrix-widget-api`'s `ClientWidgetApi`. Keep the JSON wire format, which Third Room's scripts already speak, so existing scripts mostly keep working. Write a `WidgetDriver` that enforces the tiers and handles MSC2871 approved-capability notifications and MSC2974 renegotiation. Keep scripts in the worker sandbox with no `fetch`/DOM. Allow only `mxc://` (authenticated media) for `script_url` and scene assets, or proxy external URLs, to prevent IP leaks.
9. **Joining policy:** never auto-join users into public worlds with scripts enabled (#643). Show a world preview with the scripts' declared capabilities before entry, like app-store permission sheets.
10. **Standardise it:** put the manifest, consent tiers and attribution field into Buzzar's forked MSC. The MSC3815 "Security considerations" section is empty, so this is a clear area where the fork improves on it.

---

## 5. Suggestions for the forked MSC (compatible with MSC3815 worlds)

- **Keep the room type `org.matrix.msc3815.world` as accepted input.** It is immutable on existing rooms. Create new worlds with the Buzzar unstable type and list both in the MSC as equivalents, or keep creating `org.matrix.msc3815.world` rooms so they stay discoverable by any surviving Third Room clients.
- **Keep reading `org.matrix.msc3815.world` state with the field fallbacks in section 1.3.** Add Buzzar data in separate events: instances/slots, rules, avatar allow-lists, script manifest, persistence pointers.
- **Replace `m.world.member` PL0 state** with **sticky events** (MSC4354) for presence and per-world avatar, and use `m.rtc.member.application` for in-instance data.
- **Replace the MSC3401 dependency with MSC4143 + MSC4195**, plus a `world` application type and instance slots.
- **Profile:** move off the private profile room and account data towards **extended profile fields** (MSC4133, merged 2025-01-31; custom keys must be namespaced, e.g. `software.haven.avatar`. Note profiles are public, which is fine for avatars) for the default avatar, so other clients can see it.
- **Specify v12 behaviour:** no creator in `users`; host election treats creators as infinite PL.
- **Specify authenticated media and size limits**, plus `info` (`mimetype`, `size`, vertex and texture counts) for avatar and scene assets so clients can enforce VRChat-like performance ranks before download.
- **Fill in Security considerations** with section 4 and Potential issues with: plaintext world state in E2EE rooms, external URLs, script trust, SFrame sender authentication, and SFU metadata exposure.

---

## Sources

- MSC3815 PR and text: https://github.com/matrix-org/matrix-spec-proposals/pull/3815 (file `proposals/3815-worlds.md` on `robertlong/matrix-spec-proposals@robertlong/worlds`)
- MSC3948 https://github.com/matrix-org/matrix-spec-proposals/pull/3948 · MSC4032 https://github.com/matrix-org/matrix-spec-proposals/pull/4032 · MSC3401 https://github.com/matrix-org/matrix-spec-proposals/pull/3401
- MSC4143 https://github.com/matrix-org/matrix-spec-proposals/pull/4143 (`proposals/4143-matrix-rtc.md`) · MSC4195 https://github.com/matrix-org/matrix-spec-proposals/pull/4195 · MSC4196 https://github.com/matrix-org/matrix-spec-proposals/pull/4196 · MSC4354 https://github.com/matrix-org/matrix-spec-proposals/pull/4354 · MSC4140 https://github.com/matrix-org/matrix-spec-proposals/pull/4140
- MSC3757 https://github.com/matrix-org/matrix-spec-proposals/pull/3757 · MSC3779 https://github.com/matrix-org/matrix-spec-proposals/pull/3779
- MSC4304 (room v12) `proposals/4304-room-version-12.md` · MSC4289 `proposals/4289-privilege-creators.md` · MSC4291 · MSC4297
- MSC2762 https://github.com/matrix-org/matrix-spec-proposals/pull/2762 · MSC2871 · MSC2974 · MSC3819 · MSC4039 · MSC4157 · MSC4407 · MSC1960 · MSC2931
- MSC3861, MSC2967, MSC4186, MSC4108, MSC4153, MSC4268, MSC3414, MSC4362, MSC3916, MSC4284, MSC4155, MSC2812, MSC4056, MSC4171
- Matrix spec releases: https://matrix.org/blog/category/releases · TWIM 2026-09-25 https://matrix.org/blog/2026/09/25/this-week-in-matrix-2026-09-25/ · TWIM 2026-10-16 https://matrix.org/blog/2026/10/16/this-week-in-matrix-2026-10-16/
- LiveKit data tracks: https://livekit.com/blog/livekit-data-tracks-realtime-streaming · LiveKit encryption: https://docs.livekit.io/transport/encryption/
- lk-jwt-service https://github.com/element-hq/lk-jwt-service · Element Call https://github.com/element-hq/element-call · matrix-js-sdk MatrixRTC https://github.com/matrix-org/matrix-js-sdk/tree/develop/src/matrixrtc · matrix-widget-api https://github.com/matrix-org/matrix-widget-api
- Hydrogen https://github.com/element-hq/hydrogen-web (releases v0.5.0 authenticated media, v0.5.1 latest; AGPL-3.0)
- Third Room TP1 https://matrix.org/blog/2022/09/27/announcing-third-room-tech-preview-1/ · TP2 https://matrix.org/blog/2023/06/07/introducing-third-room-tp-2-the-creator-update/ · Room topic (paused) https://matrixrooms.info/room/thirdroom-dev:matrix.org → https://twitter.com/thirdroomio/status/1684643892195631104
- Third Room repo, issues and discussions: https://github.com/matrix-org/thirdroom (epics #62/#63/#64, #126, #201, #643, and others)
- Local code: `src/engine/matrix/matrix.main.ts`, `src/engine/matrix/matrix.game.ts`, `src/ui/views/session/create-world/CreateWorldForm.tsx`, `src/ui/hooks/useHomeWorld.ts`, `src/ui/hooks/useUpdateScene.ts`, `src/ui/hooks/useUserProfile.ts`, `src/ui/utils/matrixUtils.ts`, `src/ui/views/session/world-settings/WorldSettings.tsx`, `src/ui/views/session/discover/DiscoverView.tsx`, `docs/protocol/index.md`, `docs/guides/websg/networking.md`, `examples/widget-echo/js/widget.js`
