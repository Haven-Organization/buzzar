# Reference worlds (known-good Third Room / MSC3815 rooms)

> Buzzar's own test world (mirrors + avatar pedestals) is `!roS2wueFnoGf7M-GOlSbtfvaXp7vxMMGt5V7w5AhROQ`.
> See `plans/01-avatars-and-mirrors.md`.

Captured 2026-11-13 by read-only inspection (room state via `/rooms/{id}/state`,
scene GLB JSON chunk via authenticated media). These rooms are the
**backwards-compatibility fixtures** for Buzzar: every release must still load
and navigate them, including their portals.

| Alias | Room ID | Joined | Scene (current `org.matrix.msc3815.world.scene_url`) | Size | Generator |
|---|---|---|---|---|---|
| `#terra-2:thirdroom.io` | `!GsfbPnBuhuhRgvSMTU:thirdroom.io` | 78 | `mxc://thirdroom.io/mdRnoSCxJctKfdRQxdepkoek` | 53.9 MB | glTF-Transform 2.4.3 (Unity exporter) |
| `#uk-city-1:thirdroom.io` | `!rLiMeLNygGOUzdqEsj:thirdroom.io` | 1462 | `mxc://thirdroom.io/cwDzwFqxknpmMEljfYPqfmkE` | 56.8 MB | glTF-Transform 2.4.3 (Unity exporter) |
| `#leon7.6.1:thirdroom.io` | `!cdvWhoyqVCyumiYQfn:thirdroom.io` | 1416 | `mxc://thirdroom.io/mJrDYWlVabyRpshezOPuDzWQ` | 73.0 MB | Blender glTF I/O 1.8.19 |
| `#uk-city-3:thirdroom.io` | `!QkkSlxwQqRMwFQiCXQ:thirdroom.io` | 188 | `mxc://thirdroom.io/bQHrwMaPtutzyLvdjKEzOGJd` | 56.8 MB | glTF-Transform 2.4.3 (Unity exporter) |

uk-city-1 and uk-city-3 point at different mxc URIs but the glTF JSON is identical
(same scene uploaded twice).

## Room-level state (identical shape in all four)

- `m.room.create`: `room_version: "9"`, `type: "org.matrix.msc3815.world"`.
- `m.room.join_rules: public`, `history_visibility: shared`, **unencrypted**.
- **Two world state events coexist:**
  - `m.world` (Sept 2022, legacy/unprefixed): `{scene_url, scene_preview_url}`, pointing at an *older* scene.
  - `org.matrix.msc3815.world` (2023, current): `{scene_url, scene_preview_url, max_member_object_cap: 10}`.
  - ⇒ Buzzar compat loader: prefer `org.matrix.msc3815.world`, fall back to `m.world`.
    No `script_url` is set on any of them (no WebSG scripts in these worlds).
- `m.room.power_levels` (all four identical):
  - `org.matrix.msc3815.world`: 50, `state_default`: 50, `ban`/`kick`/`invite`: 100.
  - `org.matrix.msc3401.call`: **0**, `org.matrix.msc3401.call.member`: 0,
    `org.matrix.msc3815.member.world`: 0.
- Voice: `org.matrix.msc3401.call` state (`m.intent: m.room`, `m.type: m.voice`,
  `m.name: "World Call"`), with 65 to 1527 `org.matrix.msc3401.call.member` events per room,
  almost all stale (expired `expires_ts` or empty `m.calls`).

### Problems these rooms reveal

1. **Call hijack / ambiguity.** Because `org.matrix.msc3401.call` is PL 0, any member can
   create a call. `#uk-city-1` has **two** call events, one from an unrelated user
   (`@bot_2:iot.hacknfun.camp`, 2023-02-11). Clients have to choose deterministically
   (e.g. the oldest call sent by a user with PL ≥ `state_default`) or they split into
   separate calls. Buzzar's own room template must not set this to PL 0.
2. **State bloat.** Each room holds thousands of `m.room.member` and `call.member` state
   events. When migrating to MatrixRTC (MSC4143), Buzzar should ignore the legacy
   call-member events entirely. Old rooms keep them forever.
3. **Huge single-file scenes (54–73 MB)** with `KHR_texture_basisu` required. We need
   streaming or progress UI, a cache (the service worker), and eventually LOD/chunking.

## Scene content (what the compat renderer must support)

`extensionsUsed` across the Unity-exported scenes:
`KHR_materials_emissive_strength, KHR_materials_unlit, KHR_texture_transform,
KHR_texture_basisu (required), KHR_audio, EXT_mesh_gpu_instancing, OMI_link,
OMI_collider, MX_lightmap, MX_reflection_probes, MX_background, MX_spawn_point,
MX_postprocessing (bloom), MX_texture_rgbm`.

Counts for terra-2: 1263 nodes, 405 colliders (271 box, 134 mesh, 0 triggers),
118 lightmapped nodes, 10 reflection probes, 63 instanced meshes, 3 spawn points,
5 KHR_audio emitters (looping positional mp3 ambience), 4 portals. No animations,
no `extras`, no scripts. Leon is a bare Blender export with only `KHR_materials_unlit`
and one `MX_spawn_point`.

## Portals (must keep working)

The Unity exporter emits each portal as this subtree:

```
Portal                      (empty transform; placed in world)
├── Circle                  mesh 122, rotated -90° X, MX_lightmap   ← visual ring
└── PortalTarget            T=[0, 1.756, 0]
      extensions:
        OMI_link:     { "uri": "matrix:r/<alias>:<server>" }   ← MSC2312 matrix: URI
        OMI_collider: { type: "box", extents: [0.03, 1.5, 1] } ← thin 3 m × 2 m slab, NOT a trigger
```

Third Room activates links on **click/interact**, not walk-through (`OMI_link` → interactable).
The URIs use the `matrix:r/` (alias) form. Destinations found:

| From | Targets |
|---|---|
| terra-2 | `mars:thirdroom.dev`, `leon7.6.1:thirdroom.io`, `webxr-hall:thirdroom.io`, `uk-city-1:thirdroom.io` |
| uk-city-1 / uk-city-3 | `mars:thirdroom.dev`, `webxr-hall:thirdroom.io`, `leon7.6.1:thirdroom.io`, `terra-1:thirdroom.io` |

Resolution check on 2026-11-13: `webxr-hall`, `terra-1`, `leon7.6.1` and `uk-city-1` resolve,
but **`#mars:thirdroom.dev` does not resolve** (the thirdroom.dev homeserver is unreachable).
⇒ Portal UX needs a "destination unavailable" state rather than a silent failure.

### Buzzar portal requirements (from this survey plus user requirements)

- [ ] Keep loading `OMI_link` + `OMI_collider` portals from scene glTF, with click-to-enter (compat).
- [ ] Optional walk-through activation: treat the PortalTarget collider as a trigger when
      the world opts in.
- [ ] Show the destination (room name, avatar, member count, preview image via
      `scene_preview_url`) before entering; resolve lazily and cache.
- [ ] Handle dead destinations gracefully (alias unresolvable, room not joinable,
      tombstoned room → follow `m.room.tombstone`).
- [ ] Support `matrix:roomid/…?via=` URIs as well as `matrix:r/…`, plus `https://matrix.to/#/…`.
- [ ] **User-placed portals:** a spawnable "portal" object that points at a world
      room the user chooses. It is gated by a world rule (e.g. `allow_user_portals`,
      the minimum PL needed to place one, max portals per user, destination
      allow/deny list), persisted as Buzzar state events so they survive reloads,
      and removable by moderators.
- [ ] Moderators can disable or retarget scene-baked portals without re-uploading the scene
      (state-event override keyed by node name or path).

## Copies on glowers.club (2026-11-15)

Copies of the Third Room worlds on @q:glowers.club, so they keep working if thirdroom.io goes away like
thirdroom.dev did. Scenes and previews were downloaded from thirdroom.io (and matrix.org for Third Room Public),
uploaded to glowers.club and kept on the NAS (`World Files/Third Room/downloads`). Invite-only, room v12.

| World | Room ID | Original |
| --- | --- | --- |
| UK City [Zone 1] | `!9gr2-kpFzlHOflp0pJ16iV3VT3YwXdzMKkLn1DMznmY` | `#uk-city-1:thirdroom.io` |
| UK City [Zone 3] | `!gux66cCAol1SAHBZVMBLP20rAAJF5myfMPmzXhRM2k8` | `#uk-city-3:thirdroom.io` (same scene as Zone 1) |
| Terra [Installation 2] | `!QyxR9XmoepVxRnQLtJ3hZnH-rK1RktbhB9GI3Pwhp14` | `#terra-2:thirdroom.io` |
| Leon Cathedral Cloisters | `!HKpwtijCCFWz36n2fAMF-kd6Syj6ywyXNmn1wSl0E0E` | `#leon7.6.1:thirdroom.io` |
| WebXR Hall | `!UhOvjM6EEWO1Hxh4pVhSOyiqZXZ7MMG70i6LZBz-tNQ` | `#webxr-hall:thirdroom.io` |
| The Court | `!N9o2hziggDT0JUMCZNJ5yKovcVVGzmfWBu81hc-9HAc` | porkyhorse's copy of a thirdroom.io scene (Basketball Court by Stew004, CC-BY 4.0) |
| Third Room Public | `!bk1FOsGHROP_NnCpa5zG8fX2IGS5fOrtGMBViy_7n70` | `!VLwehKMAfEmexXKEMQ:matrix.org` (archived); preview reuses its matrix.org file |

Not copied: `#terra-1:thirdroom.io` (needs joining to read its scene) and `#mars:thirdroom.dev` (server gone).
Scene-baked portals in these copies still point at the thirdroom.io originals.
