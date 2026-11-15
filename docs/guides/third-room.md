# Coming from Third Room

[Third Room](https://github.com/matrix-org/thirdroom) was the Matrix.org Foundation's virtual world client. Its development stopped in 2023 and thirdroom.io has since shut down. Buzzar is a fork that keeps going from where Third Room stopped, with Third Room's full commit history.

## What stays the same

- **Worlds are Third Room worlds.** Buzzar creates and opens rooms with the same `org.matrix.msc3815.world` room type and state ([MSC3815](https://github.com/matrix-org/matrix-spec-proposals/pull/3815)). Existing Third Room worlds open in Buzzar, and Buzzar worlds open in Third Room (without Buzzar's extras).
- **Scenes and scripts.** The glTF extensions (`MX_*`, `OMI_link`, `KHR_audio`…), the Web Scene Graph scripting API and the Third Room Unity Exporter all still work.
- **Networking and voice** still use Matrix group calls (MSC3401), so people on Buzzar and Third Room can share a world.
- **Code names.** Some APIs keep Third Room's names so existing scripts don't break, such as the `thirdroom` global in world scripts and `thirdroom.h`.

## What's new in Buzzar

- Your own avatar (VRM or glTF), everywhere or per world. See [Avatars](/guides/avatars).
- Seats, objects you can pick up, mirrors and avatar pedestals, as [glTF extensions](/gltf/).
- A Home world for every account, and a starter scene for new worlds.
- A Discover page that lists worlds from any homeserver's public room directory.
- Portals understand `matrix.to` links and `?via=` servers, follow upgraded rooms, and ask before opening a website.
- Room version 12 and authenticated media, so it works on current homeservers.
- Better mouse look, respawn when you fall out of a world, and fixes for leftover collisions between worlds.
- Command-line tools for [turning 3D models into worlds](/guides/importing-worlds).

## What Third Room services are gone

thirdroom.io hosted the client, a homeserver, a "repository room" of featured worlds and the in-app news. None of these exist any more, so Buzzar doesn't use them. Worlds and media stored on the thirdroom.io homeserver can't be reached, and portals to them show "This world no longer exists".

## Buzzar's own names

New Matrix event types and fields use the `software.haven.*` prefix (Buzzar is made by Haven Software) until they are proposed as Matrix spec changes. New glTF extensions use `HAVEN_*`. Third Room clients ignore both.
