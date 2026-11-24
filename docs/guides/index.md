# Getting Started

![The Buzzar Home world: a campfire clearing with log seats and avatar pedestals](/images/BuzzarHome.jpg)

Welcome to Buzzar, an open-source platform for shared virtual worlds built on the Matrix protocol. You can visit 3D worlds together on desktop, phone, tablet or in VR, talk with spatial voice, and chat with anyone on Matrix. This guide covers the basics.

## What is Buzzar?

Buzzar is a Matrix client for 3D worlds. Every world is a Matrix room, so your account, friends and chats come with you from world to world, and the people in a world can talk to you from any Matrix app, like Element.

Buzzar continues [Third Room](/guides/third-room), the Matrix.org Foundation's virtual world client, whose development stopped in 2023. It keeps Third Room's full history and still opens Third Room worlds, and it's adding what Third Room didn't get to: custom avatars, mirrors, seats, things you can pick up, scripted worlds, VR, and moderation tools for worlds.

## Key Features

- :globe_with_meridians: **3D worlds**: Join public worlds or make your own, for hanging out, events or projects.
- :link: **Decentralized**: Your data lives on your homeserver, not with one company. Anyone can run a homeserver.
- :bust_in_silhouette: **Your own avatar**: Wear the same avatar everywhere, or a different one per world. See [Avatars](/guides/avatars).
- :house: **A home world**: Every account gets its own Home world to start in.
- :handshake: **Interoperable**: Worlds are ordinary Matrix rooms, and Buzzar reads Third Room's world format and glTF extensions.

## Getting Started

### 1. Sign in

![Screenshot of the sign-in page](/images/SignUp.png)

Buzzar isn't publicly hosted yet. To try it, run it yourself (see [Self Hosting](/guides/self-hosting)) and sign in with an account on any Matrix homeserver, such as matrix.org or your own.

Your homeserver is where your account data is stored. The sign-in page lets you pick one from a list or type in your own.

Homeservers that use Matrix Authentication Service (MAS), like matrix.org, show **Continue** and **Create Account** buttons that take you to your homeserver's own sign-in page. Others ask for your username and password.

After signing in, if your account uses secure messaging, Buzzar asks you to **confirm your identity**: approve the request on another device where you're signed in (for example Element) and compare emoji, or enter your recovery key. You can skip this and do it later from the menu under your profile picture.

### 2. Join or create worlds

![Screenshot of the world list with the create world menu open](/images/CreateWorld.png)

After you sign in you start in your Home world. Your worlds are listed in the panel on the left; click one to go there.

- **Discover** (the compass button) lists public worlds from a server's room directory. Search your own server or type another server's name to see its worlds.
- **Create a world** with the plus button at the top of the left panel. New worlds start with a starter scene you can replace with your own (see [Importing Worlds](/guides/importing-worlds)).
- **Portals** in a world take you to another world when you walk up to them and press E or click.

### 3. Get around

| Action                        | Keyboard and mouse                           |
| ----------------------------- | -------------------------------------------- |
| Move                          | W A S D                                      |
| Look                          | Mouse (click the world to capture the mouse) |
| Jump                          | Space                                        |
| Run                           | Left Shift                                   |
| Crouch                        | C                                            |
| First / third person          | V                                            |
| Interact, sit, enter a portal | E or left click                              |
| Free / capture the mouse      | Shift + Tab                                  |
| Menu                          | Tab (or Escape)                              |
| Hide / show the HUD           | H                                            |

You can change any of these keys in **Settings → Controls**: click an action's key, then press the new one.

With a game controller (Xbox, PlayStation, Switch Pro, Steam Deck…), press any button on it once so the browser
sees it:

| Action                    | Controller       |
| ------------------------- | ---------------- |
| Move (all the way to run) | Left stick       |
| Look                      | Right stick      |
| Jump                      | A (Cross)        |
| Crouch (hold to go prone) | Left stick click |
| Grab, use, let go         | R1 or R2         |
| Throw what you're holding | X (Square)       |
| Mute                      | Y (Triangle)     |
| Names / hide the HUD      | D-pad up / down  |
| Fly mode                  | D-pad right      |
| Delete your object        | D-pad left       |
| Menu / controls           | Start / Back     |

On a phone or tablet, Buzzar shows touch controls:

- **Move** with the joystick in the lower left. Push it all the way to run.
- **Look around** by dragging anywhere else on the world.
- **Jump, crouch, use and throw** with the round buttons in the lower right.
- **Flick** to keep the view turning for a moment; touch the world again to stop it.
- **Chat** by tapping the chat box above the joystick.
- **More** (the ⋯ button on the right edge, under the mic) holds your Things to spawn, and Menu, People, Names, Controls, Delete Aimed
  (removes your object at the centre of the screen), Fly, Straighten Held, Turn Held, Fullscreen and Leave World.

You can turn touch controls on or off in **Settings → Controls**, for example to use them on a touch-screen laptop.

#### Install Buzzar as an app

On a phone or tablet you can put Buzzar on your home screen, where it opens on its own like any other app:

- **Android (Chrome):** open the browser menu and choose **Add to Home screen** or **Install app**.
- **iPhone and iPad (Safari):** tap **Share**, then **Add to Home Screen**.
- **Desktop (Chrome, Edge, Brave):** click the install button in the address bar.

### 4. Invite people and manage your world

![Screenshot of the invite dialog](/images/InviteUsers.png)

Invite people to a world, or share its link. As the creator you can change the world's name, scene and privacy settings, and give others roles to help moderate.

#### Movement

Each world sets how fast you walk and run, how high you jump and whether you can fly, in **World Settings → Movement**. A world can turn off running, jumping or flying, for example one meant to be walked through. You can choose your own walk speed, run speed and controller top speed in **Settings → Controls**, up to the world's top speed. With a controller, pushing the stick all the way moves at your controller top speed.

Everyone's Buzzar holds other players to the world's limits: someone using a modified app to move faster than the world allows is held back on everyone else's screen, and the world's moderators are told.

#### World calls

Everyone in a world is in its call: that's how you see each other move and hear each other talk. A world's call can work two ways, chosen in **World Settings → Calls**:

- **Peer-to-peer (mesh)**, the default: every player connects to every other. Works with every Buzzar version; best for small groups.
- **LiveKit server**: everyone connects to a LiveKit server that passes voices and movement on, so far more people fit. Whoever starts the call needs a homeserver that offers LiveKit.

You only see and hear the players in the same call. If you arrive while a call of the other kind is open, Buzzar asks which one to join, and says who is in each.

#### Instances

A world with a LiveKit call can have several **instances**: separate copies of the world, each with its own players, voices and Things (chat is shared by all of them). When you enter, Buzzar puts you in the busiest instance with room, and starts a new one when they're all full. The world sets how many players fit in one in **World Settings → Calls**.

Open **Instances** from a world's ⋯ menu to see who is in which instance, join any of them (even a full one), copy a link to one to invite people, or start a new instance. Give it a name, or leave the name empty and it gets a number, like `#48213`.

#### Sharing your screen

In a world with a LiveKit call, press **Alt + S** or use the **Share Screen** button next to the call buttons in the Chat tab (on a computer) to show your screen to everyone there: as a floating screen in front of you, or on one of the world's own screens. A floating screen stands on a handle. Grab the handle to carry it, hold **R** and move the mouse to turn it around or tilt it, and press **X** while aiming at it to stop sharing. Its back tells people on the other side who is sharing. The world chooses who may share in **World Settings → Calls**. Your screen's sound isn't shared.

### 5. Set up your profile

![Screenshot of the profile menu](/images/ViewProfile.png)

Click your profile picture in the bottom left corner and choose "View Profile" to set your display name, picture and avatar.

---

Because Buzzar is built on Matrix, you can talk with people on any Matrix app, in or out of a world.

If you have questions or find a problem, open an issue on [GitHub](https://github.com/Haven-Organization/buzzar/issues).
