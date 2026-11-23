/**
 * Buzzar (Third Room #398): screen sharing on the main thread (see screenShare.common.ts).
 *
 * - Sharing: publishes your screen to the LiveKit call and tells everyone where it goes (SCREEN_TOPIC), again to each
 *   newcomer.
 * - Watching: each screen track in the call (yours too) becomes frames for the render thread, shown where its sharer
 *   placed it, if the world lets them share. Two screens on one world screen: the newer one is shown.
 * - The UI drives it through `getScreenShare()` (null outside LiveKit calls).
 */
import {
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RoomEvent,
  Track,
} from "livekit-client";

import { MainContext } from "../MainThread";
import { registerMessageHandler, Thread } from "../module/module.common";
import type { LiveKitCall } from "../../matrix/livekitCall";
import {
  floatingPlacement,
  poseMatrix,
  ScreenHandleMessage,
  parseScreenAnnouncement,
  ScreenAnnouncement,
  ScreenFrameMessage,
  ScreenHideMessage,
  ScreenPlacement,
  ScreenQueryMessage,
  ScreenQueryResultMessage,
  ScreenShareMessageType,
  ScreenShowMessage,
  ScreenSize,
  SCREEN_TOPIC,
  SCREEN_WIDTHS,
  WorldScreen,
} from "./screenShare.common";

/** Pictures are sent at most this wide (px) and this often (per second). */
const MAX_FRAME_WIDTH = 1280;
const MAX_FPS = 15;
const LOCAL_ID = "local";
/** How often a carried screen's place is sent to everyone (they glide between). */
const ANNOUNCE_PER_SECOND = 8;

/** Turns a video track into ImageBitmaps for the render thread. */
class FrameFeed {
  private video = document.createElement("video");
  private stopped = false;
  private busy = false;
  private last = 0;
  private timer?: number;

  constructor(private ctx: MainContext, private id: string, track: MediaStreamTrack) {
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([track]);
    this.video.play().catch(() => undefined);
    this.schedule();
  }

  private schedule() {
    if (this.stopped) return;
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => this.capture());
    else this.timer = window.setTimeout(() => this.capture(), 1000 / MAX_FPS);
  }

  private capture() {
    if (this.stopped) return;
    const now = performance.now();
    const { videoWidth, videoHeight } = this.video;
    if (this.busy || now - this.last < 1000 / MAX_FPS || !videoWidth || !videoHeight) {
      this.schedule();
      return;
    }
    this.last = now;
    this.busy = true;
    const scale = Math.min(1, MAX_FRAME_WIDTH / videoWidth);
    createImageBitmap(this.video, {
      resizeWidth: Math.round(videoWidth * scale),
      resizeHeight: Math.round(videoHeight * scale),
      resizeQuality: "medium",
    })
      .then((bitmap) => {
        if (this.stopped) {
          bitmap.close();
          return;
        }
        this.ctx.sendMessage<ScreenFrameMessage>(
          Thread.Render,
          { type: ScreenShareMessageType.Frame, id: this.id, bitmap },
          [bitmap]
        );
      })
      .catch(() => undefined)
      .finally(() => {
        this.busy = false;
        this.schedule();
      });
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.video.srcObject = null;
  }
}

interface Shown {
  /** Whose screen (user ID), when we know. */
  userId?: string;
  track: MediaStreamTrack;
  feed: FrameFeed;
  /** When it started, for "the newer one wins" on a world screen. */
  since: number;
  /** Where it's shown now (to skip repeats), or undefined while hidden. */
  shownKey?: string;
}

export interface ScreenShareState {
  sharing: boolean;
  placement?: ScreenPlacement;
  /** The world's screens, and who's showing on each (user IDs). */
  screens: { name: string; usedBy?: string }[];
  /** Whether the world lets you share (its screen_share rule). */
  allowed: boolean;
}

export interface ScreenShareOptions {
  /** Whether this user may share here (the world's rule and their power level). */
  mayShare: (userId: string) => boolean;
  /** A person's name, for the back of their screen. */
  displayName: (userId: string) => string;
  ourUserId: string;
}

export class ScreenShare {
  private shown = new Map<string, Shown>();
  /** Placements by LiveKit identity (theirs from SCREEN_TOPIC; ours as LOCAL_ID). */
  private placements = new Map<string, ScreenPlacement>();
  private worldScreens: WorldScreen[] = [];
  private publication?: LocalTrackPublication;
  private ourPlacement?: ScreenPlacement;
  private disposers: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private queries = new Map<number, (result: ScreenQueryResultMessage) => void>();
  private nextQuery = 1;

  constructor(private ctx: MainContext, private call: LiveKitCall, private options: ScreenShareOptions) {
    const room = call.liveKitRoom;
    if (!room) return;

    const onSubscribed = (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.source !== Track.Source.ScreenShare || track.kind !== Track.Kind.Video) return;
      this.watch(participant.identity, track.mediaStreamTrack, call.userIdOf(participant.identity));
    };
    const onUnsubscribed = (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.source !== Track.Source.ScreenShare) return;
      this.unwatch(participant.identity);
    };
    const heard = (identity: string, payload: Uint8Array) => {
      const announcement = parseScreenAnnouncement(payload);
      if (!announcement) return;
      if (announcement.placement) this.placements.set(identity, announcement.placement);
      else this.placements.delete(identity);
    };
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== SCREEN_TOPIC || !participant) return;
      heard(participant.identity, payload);
      void this.refresh();
    };
    // Placements sent before we were set up (on arriving, each sharer tells us where their screen is).
    for (const [identity, payload] of call.screenAnnouncements) heard(identity, payload);
    const onJoined = (participant: Participant) => {
      // Newcomers need to know where our screen is.
      if (this.ourPlacement) void this.announce(this.ourPlacement, [participant.identity]);
    };
    const onLeft = (participant: Participant) => {
      this.placements.delete(participant.identity);
      this.unwatch(participant.identity);
    };
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    this.disposers.push(() => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    });
    // Our screen's handle (plugins/screen-share): carried around, or Delete pressed on it.
    this.disposers.push(
      registerMessageHandler(ctx, ScreenShareMessageType.HandleMoved, (_ctx, message) => {
        const { position, rotation } = message as unknown as ScreenHandleMessage;
        const placement = this.ourPlacement;
        if (placement?.kind !== "floating") return;
        this.ourPlacement = { ...placement, position, rotation };
        this.placements.set(LOCAL_ID, this.ourPlacement);
        void this.refresh();
        this.announceSoon();
      }),
      registerMessageHandler(ctx, ScreenShareMessageType.HandleDeleted, () => void this.stop())
    );
    this.disposers.push(
      registerMessageHandler(ctx, ScreenShareMessageType.QueryResult, (_ctx, message: ScreenQueryResultMessage) => {
        const resolve = this.queries.get(message.requestId);
        this.queries.delete(message.requestId);
        resolve?.(message);
      })
    );

    // Screens already being shared when we arrived.
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        if (publication.source === Track.Source.ScreenShare && publication.track) {
          this.watch(participant.identity, publication.track.mediaStreamTrack, call.userIdOf(participant.identity));
        }
      }
    }
    void this.query().then(() => this.refresh());
  }

  /** Ask the game thread where the world's screens are and where we're looking. */
  private query(): Promise<ScreenQueryResultMessage> {
    const requestId = this.nextQuery++;
    return new Promise((resolve) => {
      this.queries.set(requestId, (result) => {
        this.worldScreens = result.screens;
        resolve(result);
      });
      this.ctx.sendMessage<ScreenQueryMessage>(Thread.Game, { type: ScreenShareMessageType.Query, requestId });
    });
  }

  private watch(id: string, track: MediaStreamTrack, userId: string | undefined) {
    const existing = this.shown.get(id);
    if (existing?.track === track) return;
    if (existing) this.unwatch(id);
    this.shown.set(id, { userId, track, feed: new FrameFeed(this.ctx, id, track), since: performance.now() });
    void this.refresh();
  }

  private unwatch(id: string) {
    const shown = this.shown.get(id);
    if (!shown) return;
    shown.feed.stop();
    this.shown.delete(id);
    this.ctx.sendMessage<ScreenHideMessage>(Thread.Render, { type: ScreenShareMessageType.Hide, id });
    void this.refresh();
  }

  /** Show every screen where it belongs (or hide it). */
  private async refresh() {
    // Which share each world screen shows: the newest.
    const onWorldScreen = new Map<string, string>();
    const byAge = [...this.shown.entries()].sort((a, b) => a[1].since - b[1].since);
    for (const [id, shown] of byAge) {
      const placement = this.placements.get(id);
      if (placement?.kind === "world" && this.allowedToShow(shown)) onWorldScreen.set(placement.screen, id);
    }

    for (const [id, shown] of this.shown) {
      const placement = this.placements.get(id);
      let show: Omit<ScreenShowMessage, "type" | "id"> | undefined;
      if (placement && this.allowedToShow(shown)) {
        const label = shown.userId ? this.options.displayName(shown.userId) : "Someone";
        if (placement.kind === "floating") {
          const width = SCREEN_WIDTHS[placement.size];
          show = {
            matrix: poseMatrix(placement.position, placement.rotation),
            width,
            height: width,
            anchor: "bottom",
            handle: true,
            label,
            // Others' moves arrive a few times a second: glide between them. Ours follow the handle every frame.
            smooth: id !== LOCAL_ID,
          };
        } else if (onWorldScreen.get(placement.screen) === id) {
          const screen = this.worldScreens.find((s) => s.name === placement.screen);
          if (screen) {
            show = {
              matrix: screen.matrix,
              width: screen.width,
              height: screen.height,
              anchor: "center",
              handle: false,
              label,
              smooth: false,
            };
          }
        }
      }
      const key = show ? JSON.stringify(show) : undefined;
      if (key === shown.shownKey) continue;
      shown.shownKey = key;
      if (show) {
        this.ctx.sendMessage<ScreenShowMessage>(Thread.Render, { type: ScreenShareMessageType.Show, id, ...show });
      } else {
        this.ctx.sendMessage<ScreenHideMessage>(Thread.Render, { type: ScreenShareMessageType.Hide, id });
      }
    }
    this.changed();
  }

  private allowedToShow(shown: Shown) {
    return !shown.userId || this.options.mayShare(shown.userId);
  }

  /** The world's rules changed (who may share): show or hide screens again. */
  rulesChanged() {
    void this.refresh();
  }

  private async announce(placement: ScreenPlacement | null, to?: string[]) {
    const room = this.call.liveKitRoom;
    if (!room) return;
    const announcement: ScreenAnnouncement = { placement };
    await room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(announcement)), {
        reliable: true,
        topic: SCREEN_TOPIC,
        destinationIdentities: to,
      })
      .catch((error) => console.warn("Screen share: couldn't send the screen's place", error));
  }

  private announceTimer?: number;
  private lastAnnounced = 0;

  /** While the screen is carried: tell everyone where it is, at most ANNOUNCE_PER_SECOND times a second. */
  private announceSoon() {
    if (this.announceTimer !== undefined) return;
    const wait = Math.max(0, this.lastAnnounced + 1000 / ANNOUNCE_PER_SECOND - performance.now());
    this.announceTimer = window.setTimeout(() => {
      this.announceTimer = undefined;
      this.lastAnnounced = performance.now();
      if (this.ourPlacement) void this.announce(this.ourPlacement);
    }, wait);
  }

  /** Put our screen's handle where the placement says (floating), or take it away. */
  private placeHandle(placement: ScreenPlacement | undefined) {
    if (placement?.kind === "floating") {
      this.ctx.sendMessage<ScreenHandleMessage>(Thread.Game, {
        type: ScreenShareMessageType.SetHandle,
        position: placement.position,
        rotation: placement.rotation,
      });
    } else {
      this.ctx.sendMessage(Thread.Game, { type: ScreenShareMessageType.RemoveHandle });
    }
  }

  /** A floating screen in front of us now. */
  async floatingHere(size: ScreenSize): Promise<ScreenPlacement | undefined> {
    const result = await this.query();
    if (!result.eye || result.yaw === undefined) return undefined;
    return floatingPlacement(result.eye, result.yaw, size);
  }

  /** Start sharing (asks the browser which screen or window), or move the screen if we already are. */
  async share(placement: ScreenPlacement) {
    const room = this.call.liveKitRoom;
    if (!room) throw new Error("Not connected to the LiveKit call.");
    if (!this.options.mayShare(this.options.ourUserId))
      throw new Error("This world doesn't let you share your screen.");
    // Say where first, so the screen appears in the right place for everyone.
    this.ourPlacement = placement;
    this.placements.set(LOCAL_ID, placement);
    await this.announce(placement);
    if (!this.publication) {
      let publication: LocalTrackPublication | undefined;
      try {
        publication = await room.localParticipant.setScreenShareEnabled(true, {
          audio: false,
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
        });
      } catch (error) {
        await this.stop();
        throw error;
      }
      const track = publication?.track?.mediaStreamTrack;
      if (!publication || !track) {
        await this.stop();
        return;
      }
      this.publication = publication;
      // The browser's own "Stop sharing" button.
      track.addEventListener("ended", () => void this.stop());
      this.watch(LOCAL_ID, track, this.options.ourUserId);
    }
    this.placeHandle(placement);
    await this.refresh();
  }

  async stop() {
    const room = this.call.liveKitRoom;
    const wasSharing = !!this.ourPlacement;
    this.ourPlacement = undefined;
    this.placements.delete(LOCAL_ID);
    window.clearTimeout(this.announceTimer);
    this.announceTimer = undefined;
    if (wasSharing) this.placeHandle(undefined);
    if (this.publication) {
      this.publication = undefined;
      await room?.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
    }
    this.unwatch(LOCAL_ID);
    if (wasSharing) await this.announce(null);
    this.changed();
  }

  get state(): ScreenShareState {
    const usedBy = new Map<string, string>();
    const byAge = [...this.shown.entries()].sort((a, b) => a[1].since - b[1].since);
    for (const [id, shown] of byAge) {
      const placement = this.placements.get(id);
      if (placement?.kind === "world" && shown.userId && this.allowedToShow(shown)) {
        usedBy.set(placement.screen, shown.userId);
      }
    }
    return {
      sharing: !!this.publication,
      placement: this.ourPlacement,
      screens: this.worldScreens.map((screen) => ({ name: screen.name, usedBy: usedBy.get(screen.name) })),
      allowed: this.options.mayShare(this.options.ourUserId),
    };
  }

  /** Fetch the world's screens again (they're known once the world has loaded). */
  async refreshScreens() {
    await this.query();
    await this.refresh();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  dispose() {
    void this.stop();
    for (const id of [...this.shown.keys()]) this.unwatch(id);
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.listeners.clear();
  }
}

let current: ScreenShare | undefined;
const currentListeners = new Set<() => void>();

/** The screen sharing of the world you're in, if its call can carry screens (LiveKit). */
export function getScreenShare(): ScreenShare | undefined {
  return current;
}

export function setScreenShare(screenShare: ScreenShare | undefined) {
  current = screenShare;
  for (const listener of currentListeners) listener();
}

export function onScreenShareChanged(listener: () => void) {
  currentListeners.add(listener);
  return () => {
    currentListeners.delete(listener);
  };
}
