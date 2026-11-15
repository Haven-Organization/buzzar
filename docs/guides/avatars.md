# Avatars

Third Room gave every player the same built-in rig. Buzzar lets you wear your own 3D avatar, pick one up from a pedestal in a world, and see it in a mirror. This guide covers how to change your avatar, where Buzzar stores your choice on Matrix, what files work, and how to make an avatar that loads.

## Changing your avatar

Open the user menu and choose **Change Avatar**. The **Edit 3D Avatar** dialog has three parts:

- **Built-in Avatars**: **Default** (the standard Third Room rig) plus the avatars bundled with Buzzar (see [Built-in avatars](#built-in-avatars)).
- **Avatar**: upload your own `.vrm` or `.glb` file.
- **Avatar Preview**: upload an optional image that represents the avatar.

After uploading, choose how to apply it:

- **Save as Default** makes it your profile avatar, the one you wear in every world. If you're in a world when you save, it's also set as your avatar for that world, so the people there see it straight away.
- **Use Only in This World** appears only while you're in a world. It sets an avatar for that world alone and leaves your default untouched.

What the built-in buttons do depends on where you are. Outside a world, they set your default avatar, and **Default** removes it. Inside a world, they only change your avatar for that world. **Default** inside a world removes your world-only avatar, so you go back to your default avatar, which is the Default rig only if you haven't set one.

You don't need to rejoin a world after you switch. Your own avatar changes as soon as you save. Other clients re-check every player in the world every 10 seconds. They cache default (profile) avatars for a minute, so a change that only touches your default avatar can take up to about a minute to reach them.

### Your avatars

Every avatar you upload is saved to **Your Avatars** in the avatar editor, so you can wear it again later in any world, even one without a pedestal for it, without uploading it again. The list is kept in your Matrix account data (`software.haven.avatars`), which only you can see and which follows you to every device. Removing an avatar from the list doesn't delete the uploaded file.

### Avatar pedestals

Some worlds have pedestals that show an avatar on a stand with a name panel. Press a pedestal to wear its avatar. A pedestal works like VRChat's: the avatar becomes your **default** avatar in every world, and Buzzar clears any world-only avatar you had set for the current world so it doesn't take precedence.

Worlds can offer pedestal avatars stored on Matrix (`mxc://`), avatars bundled with Buzzar, or files shipped next to the world file. Buzzar can't publish an avatar from a file next to the world, so you wear it locally and other players keep seeing your previous avatar.

World creators: the pedestal format is specified in [HAVEN_avatar_pedestal](/gltf/HAVEN_avatar_pedestal/README).

### Mirrors

Worlds can include mirrors, which show your own full body, including the head that's hidden from your first-person camera. Pressing a mirror, or one of its toggle buttons, switches it between off, high quality and low quality (avatars only). The state is local to you and doesn't change for anyone else. World creators: see [HAVEN_mirror](/gltf/HAVEN_mirror/README).

## Which avatar other players see

For each player in a world, Buzzar looks in this order and uses the first avatar it finds:

1. The player's world-only avatar for this world.
2. The player's default (profile) avatar.
3. The built-in Default rig.

While an avatar downloads, other players see a placeholder with a progress bar. If a file can't be loaded, or breaks the [limits](#limits), the player keeps the Default rig, and a short message shows on the placeholder ("Couldn't load this avatar" or "Avatar hidden: …" with the reason). If Buzzar can't find any avatar setting for a newly joined player within 15 seconds, it shows them with the Default rig.

## How avatars are stored on Matrix

Buzzar only uses standard Matrix features, so nothing depends on a Buzzar server. Both places use the key `software.haven.avatar` and the same content:

```json
{
  "url": "mxc://example.org/abc",
  "preview_url": "mxc://example.org/def",
  "format": "glb",
  "name": "Rose"
}
```

| Field         | Required | Meaning                                                                                                                    |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `url`         | yes      | `mxc://` URI of the avatar file. Anything that isn't a valid `mxc://` URI makes the whole value invalid, and it's ignored. |
| `preview_url` | no       | `mxc://` URI of a preview image.                                                                                           |
| `format`      | no       | `"vrm0"`, `"vrm1"` or `"glb"`. Advisory only: the loader detects the rig type from the file itself.                        |
| `name`        | no       | Display name shown on the loading placeholder. Cut off at 100 characters.                                                  |

**Default avatar.** A custom profile field ([MSC4133](https://github.com/matrix-org/matrix-spec-proposals/pull/4133)), read and written at `/_matrix/client/v3/profile/{userId}/software.haven.avatar`. Resetting your default avatar deletes the field. Your homeserver needs to support custom profile fields for this to work.

**World-only avatar.** An extra `software.haven.avatar` key in your own `m.room.member` state event in the world room. Buzzar copies your current member event, adds or removes the key, and sends it back, so your display name and other fields stay as they were. Matrix only lets you change your own member event and needs no extra power level for it, so this works in any world you've joined, including worlds created with Third Room. You have to be joined to set it.

**Third Room's old storage.** When you **Save as Default** and you have a Third Room profile room, Buzzar also writes `avatar_url` and `avatar_preview_url` into that room's `org.matrix.msc3815.world.profile` state event, which is where Third Room's own avatar editor saved them.

Uploaded files go to your homeserver's media repository, and Buzzar downloads avatars with authenticated media.

## Built-in avatars

Buzzar ships two CC0 avatars from Polygonal Mind's 100 Avatars collection:

| ID      | Name  | File                     |
| ------- | ----- | ------------------------ |
| `devil` | Devil | `/avatars/031_Devil.vrm` |
| `rose`  | Rose  | `/avatars/057_Rose.vrm`  |

Other players need an `mxc://` URI to load your avatar, so the first time you pick a built-in avatar, Buzzar uploads the file to your homeserver and saves the resulting URI in your browser's local storage. After that it reuses the URI.

Worlds can refer to a built-in avatar with a `buzzar-builtin:<id>` URI (for example `buzzar-builtin:rose`), typically on a pedestal. That way the world works on any homeserver without uploading avatars alongside it. When you wear one, it's uploaded to your own homeserver like any other built-in avatar.

## Supported files

The upload button accepts `.vrm` and `.glb` files. Both are binary glTF 2.0. Buzzar recognizes the skeleton in one of four ways, tried in this order:

| Rig                         | How it's recognized                                                                                                                                                 | Requirement                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| VRM 1.0                     | `VRMC_vrm` extension, `humanoid.humanBones`                                                                                                                         | A `hips` bone                            |
| VRM 0.x                     | `VRM` extension, `humanoid.humanBones`                                                                                                                              | A `hips` bone                            |
| Mixamo                      | Node names like `mixamorig:Hips`, `mixamorigHips`, `mixamorig1:Hips`, `mixamorig_Hips`                                                                              | `Hips` plus at least 10 recognized bones |
| CATS / VRChat Blender names | Node names like `Hips`, `Spine`, `Chest`, `Neck`, `Head`, `Left arm`, `Left elbow`, `Left wrist`, `Left leg`, `Left knee`, `Left ankle`, `Left toe` (and `Right …`) | `Hips` plus at least 10 recognized bones |

For CATS names, matching ignores case, treats `.` and `_` as spaces, and also accepts a trailing `L`/`R` side (`Arm.L` is read as `Left arm`). Mixamo finger bones (`LeftHandIndex1`, …) are mapped too. A file without any of these is rejected as "not a humanoid avatar".

Buzzar doesn't use these VRM features yet: spring bones (hair and cloth physics), expressions and visemes, and MToon shading. VRM materials render with their standard glTF materials.

## Animation

Your avatar file doesn't need any animations. Buzzar plays its own clip set on every avatar: Idle, Walk, Walk Back, Run, Run Back, strafing left and right (walking and running), turning left and right, and two falling clips. These come from the built-in Mixamo-rigged Default rig and are retargeted onto your avatar's skeleton when it loads.

Retargeting works per humanoid bone, so it handles skeletons with a different number of spine bones or missing optional bones such as `upperChest`. It reads the rest pose from the skin's bind pose (the inverse bind matrices), not from the pose the file happened to be saved in. It scales hip movement by the ratio of your avatar's hip height to the Default rig's.

On seats, avatars play a **Sit** pose. Buzzar builds this pose procedurally on the Default rig (thighs forward, shins down, forearms resting on the thighs) and retargets it like the other clips, so it fits any avatar's proportions. The seat places your avatar's hips on the cushion.

**Eye height.** Your first-person camera and your nametag follow your avatar's height. Buzzar takes the eye height from the midpoint of the `leftEye` and `rightEye` bones, or 8 cm above the `head` bone if there are no eye bones. The result is clamped to between 0.2 m and 5 m. The physics capsule doesn't change size.

Avatars bound in an A-pose (arms angled down, common for game and VRChat models) are corrected to the animations' T-pose limb by limb, so their arms and legs move like a T-posed avatar's.

## Limits

Each client checks every avatar when it loads it. An avatar over any limit is hidden and the player keeps the Default rig. The defaults are roughly VRChat's PC "Poor" rank:

|                                            | Maximum |
| ------------------------------------------ | ------- |
| File data (binary buffers)                 | 60 MB   |
| Triangles                                  | 150,000 |
| Bones (skin joints, summed over all skins) | 400     |
| Materials                                  | 32      |
| Skinned meshes                             | 16      |
| Textures (images)                          | 40      |

The file size limit is checked after the download finishes, not before. There's no texture resolution limit, and no setting yet to change these limits or to hide a particular player's avatar.

## Making an avatar

The loader's needs, in short:

- **Use a humanoid skeleton.** Exporting as VRM (from VRoid Studio, UniVRM in Unity, or a Blender VRM add-on) is the most reliable route, because the bone mapping is stored in the file. A Mixamo-rigged character exported to `.glb`, or a CATS-processed VRChat model, also works through bone names.
- **Rest in a T-pose.** Retargeting assumes your bind pose matches the Default rig's T-pose. An avatar bound in an A-pose still loads, but its arms keep the A-pose angle in every animation.
- **Face forward.** For `.glb`, VRM 1.0 and Mixamo files, the character should face +Z, which is the glTF convention. VRM 0.x files face -Z, as that spec requires. Buzzar turns each kind around to match.
- **Model in metres.** glTF uses metres, and Buzzar takes your eye height straight from the skeleton, so a model exported at the wrong scale gets the wrong camera height (up to the 0.2–5 m clamp).
- **Include `leftEye` and `rightEye` bones** if you can, for an accurate camera height.
- **Make the skin's inverse bind matrices describe the rest pose.** Buzzar reads the rest pose from them, and accepts both the spec convention and the common "ignores the mesh node's transform" convention.
- **Stay under the [limits](#limits)** and pack everything into the single `.glb` or `.vrm` file.

To test an avatar without a Matrix account, run Buzzar locally and open `/viewer?src=<world .glb>&avatar=<avatar file>`. Both paths must be on the same origin as the viewer, for example `/viewer?src=/gltf/test/mirror-room.glb&avatar=/avatars/031_Devil.vrm`. The result (`loaded`, or `rejected` with the reason) is logged to the browser console with the prefix `[avatar]`.

## Third Room compatibility

Buzzar and Third Room can be in the same world, but they don't see each other's avatars:

- **Third Room clients** draw every player with the built-in Default rig. They ignore `software.haven.avatar` in profiles and member events, so a Buzzar player looks like the Default rig to them.
- **Buzzar** doesn't read Third Room's `org.matrix.msc3815.world.profile` avatar when choosing what to show, because Third Room never let other players see that event: it lived in a private profile room. A Third Room player with no `software.haven.avatar` setting appears as the Default rig in Buzzar.
- The extra key in your `m.room.member` event is ignored by Third Room and other Matrix clients.
