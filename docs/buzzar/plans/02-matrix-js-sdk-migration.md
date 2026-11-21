# Plan 02: replace Hydrogen with matrix-js-sdk

Status: in progress on branch `matrix-js-sdk-migration` (2026-11-21); see [Migration status](#migration-status). Checklist ref: §0 Foundation ("Replace Hydrogen").

## Is Hydrogen abandoned?

Effectively yes, and the copy Buzzar uses is frozen further back still (checked 2026-11-21):

| What                                                        | State                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@thirdroom/hydrogen-view-sdk` 0.1.2** (what Buzzar runs) | Third Room's fork of Hydrogen. Last and only line of releases: 0.1.2 on 2023-05-15. The Third Room repo's last push was 2023-08-30. Nobody maintains it. Buzzar already carries a local patch (`patches/@thirdroom+hydrogen-view-sdk+0.1.2.patch`) and a 2,800-line hand-written type file (`src/hydrogen-view-sdk.d.ts`). |
| **Upstream Hydrogen** (`element-hq/hydrogen-web`)           | Not archived, but no code release since v0.5.1 / SDK 0.3.1 on 2024-10-21. Every commit since is housekeeping: relicensing (Jan 2025) and a bug-report URL (Nov 2025, merged Apr 2026). Its README still says "not yet ready for primetime" and asks people not to file feature requests.                                   |
| **Licence**                                                 | Upstream Hydrogen moved to AGPL-3.0 (plus a commercial licence) in January 2025. Buzzar is Apache-2.0, so taking newer Hydrogen code would mean relicensing Buzzar. Our 0.1.2 copy stays Apache-2.0. matrix-js-sdk is Apache-2.0.                                                                                          |
| **Encryption**                                              | Hydrogen encrypts with **libolm** (`@matrix-org/olm` 3.2.14), which the Matrix.org Foundation deprecated in 2024 in favour of vodozemac (Rust), partly over known timing side-channel issues.                                                                                                                              |

So "upgrade Hydrogen" isn't a real option: the fork we use is dead, and upstream is in maintenance-only mode under a
licence we can't adopt.

**matrix-js-sdk** by contrast is the SDK Element Web is built on: 45.1.0 released 2026-11-11, with a release every
week or two. Its encryption is the Rust crypto SDK compiled to WebAssembly
(`@matrix-org/matrix-sdk-crypto-wasm` 19.0.1, 2026-11-06).

## What we gain

- **A maintained SDK**: spec changes (new room versions, authenticated media, MSC4133 profile fields, room
  summaries, …) arrive upstream instead of each one being a Buzzar patch or a hand-rolled `fetch`.
- **Modern encryption**: vodozemac instead of deprecated libolm.
- **Encryption features Hydrogen lacks**, including:
  - secret sharing after verification, so verifying a new device from another one restores old messages without the
    recovery key (backlog item: today Buzzar asks for the recovery key after every verification);
  - key backup, cross-signing, QR and emoji verification, dehydrated devices, all as Element uses them.
- **A path to MatrixRTC + LiveKit** (checklist §0, XL): matrix-js-sdk ships `MatrixRTCSession` and implements the
  widget API that the Element Call reference widget uses. Hydrogen has neither, so that migration needs this one first.
- **Faster startup** with simplified sliding sync (MSC4186) where the homeserver supports it.
- **Less code of our own**: the hand-written types, the patch, and the many hand-rolled `fetch` helpers
  (`avatarMatrix.ts`, `worldDirectory.ts`, `legacyAccountData.ts`, …) can lean on typed SDK calls.
- **More of Matrix**: threads, reactions, edits, read receipts, presence, all already handled by the SDK.

What it costs or risks:

- **Users sign in again once**, and verify the new session once. Hydrogen's libolm keys can't move into the Rust
  crypto store, so each user gets a new device. (Keeping the access token and only replacing the device is a
  possibility to investigate, but the device's encryption identity has to change.)
- **A bigger download**: the crypto WASM adds several MB (loaded once and cached).
- **The chat timeline UI is rewritten.** Buzzar's chat uses Hydrogen's own view layer (TemplateView tiles); that has
  no matrix-js-sdk equivalent and becomes React components.
- **matrix-js-sdk makes breaking releases often** (major versions every few weeks). Pin the version and upgrade on
  purpose.

## What Buzzar uses from Hydrogen today

- **130 source files** import from `@thirdroom/hydrogen-view-sdk` (≈17,500 lines in those files); 79 use the
  `useHydrogen` hook; 41 call `session.hsApi` directly.
- Most-used types: `Room` (56 files), `Session` (42), `Platform` (15), `StateEvent` (14), `GroupCall` (13),
  Hydrogen view-layer classes (`Builder`, `TemplateView`, `TileView`, tiles, `TimelineViewModel`,
  `ComposerViewModel`: 22 files).
- Subsystems:
  1. **Login and session** (`HydrogenRootView.tsx`, `oidc.ts`, login views): password, SSO, OIDC, session storage.
  2. **Sync, rooms, state, members, power levels, invites, room creation and upgrades.**
  3. **Chat**: timeline, composer, tiles (the Hydrogen view layer).
  4. **Encryption**: device verification (`deviceVerification.ts`), recovery key.
  5. **Calls and game networking**: Hydrogen's MSC3401 `GroupCall` carries voice _and_ the game's data channel
     (positions, avatars, objects) (`src/engine/network/createMatrixNetworkInterface.ts`, `avatar.main.ts`,
     19 files touch group calls).
  6. **Media** (`mediaRepository` thumbnails/URLs, uploads), rageshake bug reports, observables
     (`ObservableMap`, `ObservableValue`).

Already SDK-independent and unaffected: the engine (game/render workers), the glTF/HAVEN\_\* pipeline, the service
worker's authenticated media, and the `MatrixAuth` + `fetch` helpers.

## Approach

**Incremental, behind Buzzar's own interfaces, never a big-bang rewrite.**

1. Introduce thin Buzzar interfaces for what the UI needs (`BuzzarSession`, `BuzzarRoom`, `BuzzarCall`, observable
   hooks) and implement them over Hydrogen first. Move the 130 files onto them in small commits while the app keeps
   working the whole time.
2. Implement the same interfaces over matrix-js-sdk, behind a build or developer flag.
3. Switch subsystem by subsystem, then delete Hydrogen, libolm, the patch and the type file.

**Calls stay MSC3401 during the migration.** matrix-js-sdk still ships the legacy `GroupCall` (with data-channel
support), so the networking port is a like-for-like swap and stays compatible with existing worlds and with
clients that haven't updated. Moving to MatrixRTC + LiveKit is a separate project afterwards (checklist §0, XL).

## Phases and effort

Estimates are focused working days for the way we work now (with an AI pair doing most of the typing), and assume
no surprises in the SDK. Ranges, not promises.

| #   | Phase                                                                                                                                                                                                                 | Days | Done when                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| 0   | **Spike**: matrix-js-sdk + Rust crypto WASM in the Vite build next to Hydrogen; log in, sync, list world rooms; measure bundle size and startup.                                                                      | 2–3  | Go/no-go on bundling and performance.                                                   |
| 0b  | **Toolchain**: TypeScript 4.9 → 5.9, `@typescript-eslint` 5 → 7+, newer `@types/node` and `@types/webxr`; fix the 69 resulting type errors (25 files, nearly all the TS 5.7 typed-array change). See phase 0 results. | 1–2  | The app type-checks and lints on TypeScript 5.9.                                        |
| 1   | **Buzzar interfaces over Hydrogen**; move every import of `@thirdroom/hydrogen-view-sdk` behind them.                                                                                                                 | 4–6  | No file outside the adapter imports Hydrogen.                                           |
| 2   | **Session**: password, SSO and OIDC login; session storage; logout; the one-time "sign in again" path for existing users.                                                                                             | 3–4  | Log in on matrix.org and a Synapse with OIDC; restart keeps the session.                |
| 3   | **Rooms**: rooms/state/members/power levels/invites, creating worlds and the Home World, room upgrades, account data, profile fields.                                                                                 | 4–6  | Your Worlds, Explore, world settings, Home World and invites work.                      |
| 4   | **Chat**: React timeline, composer, tiles (text, images, files, world/avatar/Thing embeds), read markers.                                                                                                             | 6–9  | Chat parity with today, including embeds.                                               |
| 5   | **Encryption**: verification (emoji + QR), recovery key, key backup, **secret sharing after verification**.                                                                                                           | 3–5  | Verify from Element; old messages readable without the recovery key.                    |
| 6   | **Calls and networking**: port voice + data channel to matrix-js-sdk's `GroupCall`; peer join/leave, avatars, host election.                                                                                          | 5–8  | Two clients (one old, one new) in a world see each other move, talk, and share objects. |
| 7   | **Cleanup**: media, notifications, rageshake; remove Hydrogen, libolm, the patch and `hydrogen-view-sdk.d.ts`; docs.                                                                                                  | 3–4  | Hydrogen is gone from `package.json`.                                                   |

**Total: about 31–47 working days (roughly 6–9 weeks).** Phases 4 (chat) and 6 (networking) carry the most risk.
Phase 1 is worth doing even before committing to the rest: it pays off in cleaner code either way.

## Phase 0 results (2026-11-21)

The spike is in `spikes/matrix-js-sdk/` (its own Vite config, so the app's build is untouched):
`vite build --config spikes/matrix-js-sdk/vite.spike.config.ts`, then call `runSpike({ homeserver, accessToken,
userId, deviceId })` on the page. It reuses an existing login with encryption off, so it creates no device and
uploads no keys.

**Go.** matrix-js-sdk 45.1.0 works in our setup, with one prerequisite (TypeScript, below).

| Check                                                | Result                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builds with our Vite (4.3.9), default target         | Yes, first try.                                                                                                                                                                                                                                                                                                                                                                   |
| Sign in with an existing access token + initial sync | 1.3 s for an account in 46 rooms (lazy-loaded members, 1 event of history per room).                                                                                                                                                                                                                                                                                              |
| World rooms                                          | All 15 found by room type, with names, aliases, scenes and correct member counts.                                                                                                                                                                                                                                                                                                 |
| Server features                                      | The test homeserver advertises v1.17 and simplified sliding sync (MSC4186), so phase 2 can use it there.                                                                                                                                                                                                                                                                          |
| Rust crypto                                          | WASM load 44 ms and an in-memory `OlmMachine` set up in 23 ms (served locally; over a network add the download).                                                                                                                                                                                                                                                                  |
| Download size                                        | SDK ≈ 961 KB minified (276 KB gzip). Crypto WASM 7.8 MB (2.1 MB gzip, 1.4 MB brotli) plus 87 KB + 154 KB of glue. Hydrogen's libolm is 154 KB of WASM (73 KB gzip), so **encryption adds ≈1.3–2 MB to the first download** (cached after that); load it lazily after login.                                                                                                       |
| **TypeScript**                                       | **matrix-js-sdk 45's type definitions need TypeScript ≥ 5.2** (`Symbol.dispose`, `.ts` import paths). Buzzar is on 4.9.5, which can't read them. With TypeScript 5.9 the spike type-checks; the app then has 69 type errors in 25 files, almost all from TS 5.7's generic typed arrays (`Uint8Array<ArrayBufferLike>` vs `ArrayBuffer`), which are mechanical. Added as phase 0b. |

Noise seen: the SDK logs warnings about push rules missing from the server's defaults (it fills them in locally).

## Migration status

Done in one pass on branch `matrix-js-sdk-migration` (develop still runs Hydrogen), instead of the phased adapter
route above: the Matrix layer in `src/matrix/` keeps the shapes the UI and engine were written against, so most
call sites only changed their import. Hydrogen, libolm, the patch and the hand-written types are removed.

| Area                                                                                    | State                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain (TypeScript 5.9, typescript-eslint 7, ESLint 8.57)                            | Done.                                                                                                                                                               |
| Session: saved sessions, sync start-up, sign-out; old sessions signed out with a notice | Written; start-up from a saved session **tested**. Password and OIDC sign-in **not yet tried against a server**.                                                    |
| Rooms: lists, state, members, creating/joining, account data, media URLs                | Written. Your Worlds, entering worlds, avatars, the chat list **tested**; creating rooms, invites and settings writes not yet.                                      |
| Chat: React timelines for the chat window and in-world chat                             | In-world chat **tested** (history, join notes, live messages). Chat window, images, files, embeds, paging and encrypted media not yet.                              |
| Calls + game networking (matrix-js-sdk MSC3401 group calls)                             | **Tested** with two accounts on two homeservers in one world: both connect, data channel open, they see each other. Microphone audio not tested (headless browser). |
| Encryption: Rust crypto, verification by emoji or recovery key, key backup              | Written, **untested** (the smoke tests ran with encryption off).                                                                                                    |
| Typing notifications, unread state, bug reports                                         | Written, untested.                                                                                                                                                  |

Known gaps and things to check:

- **Old and new clients can't share a world call.** matrix-js-sdk requires a per-device `expires_ts` in call
  membership, which Hydrogen clients don't write, so each sees the other as absent. Everyone has to be on the new
  build (or the Matrix layer has to write/accept both forms).
- Call signalling is sent as plain to-device messages (`useE2eForGroupCall: false`); Hydrogen encrypted it.
- Host election orders members by their call-membership event's timestamp, which the SDK refreshes hourly.
- A link to a world you've already joined (`/world/<id>`) lands in your Home World on start-up (may predate this).
- The chat badge shows the homeserver's total notification count.
- Download size: the main bundle grew to 1.36 MB plus the 7.8 MB crypto WASM (2.1 MB gzip), not yet lazy-loaded.

To try the branch next to the installed app: build, copy `dist` to `dist-next`, then
`node scripts/buzzar/serve-dist.mjs dist-next 8091`.

## Testing

- Unit tests for each adapter (the interfaces make the two implementations swappable in tests).
- Mixed-client checks in a test world: a Hydrogen build and a matrix-js-sdk build in one world (calls, data
  channel, avatars, objects), since users won't all update at once.
- Login matrix: matrix.org, a Synapse with OIDC (MAS), an older Synapse, one server without uploads.
- Encryption: verify against Element Web and Element X; restore from key backup.

## Open questions

- Can an existing session keep its access token (skipping the sign-in) while replacing only its device keys?
- Sliding sync: use it where the server supports it from day one, or start with classic `/sync`?
- Chat UI: build our own React timeline, or adapt pieces from an existing Apache-2.0 client?
- When to do MatrixRTC + LiveKit: straight after, or only once instances regularly pass ~15 players?

## Sources

- [element-hq/hydrogen-web](https://github.com/element-hq/hydrogen-web) (commits, releases, README)
- [matrix-org/thirdroom](https://github.com/matrix-org/thirdroom)
- npm: [@thirdroom/hydrogen-view-sdk](https://www.npmjs.com/package/@thirdroom/hydrogen-view-sdk),
  [matrix-js-sdk](https://www.npmjs.com/package/matrix-js-sdk),
  [@matrix-org/matrix-sdk-crypto-wasm](https://www.npmjs.com/package/@matrix-org/matrix-sdk-crypto-wasm)
- [Element Call: the reference widget and the JS SDK](https://element.io/blog/element-call-redefining-conferencing-for-privacy-scale-and-sovereignty/)
- [This Week in Matrix, 2025-06-06](https://matrix.org/blog/2025/06/05/this-week-in-matrix-2025-06-06/) (matrix-js-sdk's crypto via matrix-sdk-crypto-wasm)
