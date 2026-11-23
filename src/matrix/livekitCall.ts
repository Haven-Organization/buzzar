/**
 * Buzzar: a world call through a LiveKit server (MatrixRTC, MSC4143 + MSC4195), the "livekit" call method
 * (callMethod.ts).
 *
 * - Membership: a MatrixRTC session in the world room, slot `software.haven.world#main`, kept by matrix-js-sdk (it
 *   sends our call.member state event, keeps it fresh, and has the server drop it if we vanish). Other apps' calls in
 *   the same room (e.g. Element Call's `m.call`) are a different slot and aren't counted.
 * - Media and data: one LiveKit room for the world. Its address and access token come from the LiveKit JWT service
 *   (`/sfu/get` with a Matrix OpenID token); everyone uses the service of the call's oldest member, so they all meet
 *   on one server. Our microphone is published as an audio track; the game's data goes as reliable data packets to
 *   each player (LiveKitDataChannel), so the engine sees the same per-player channels as in a mesh call.
 * - Players: one Member per membership (user + device), matched to its LiveKit participant by identity
 *   (`@user:server:DEVICE`). LiveKit participants without a membership in our slot are ignored.
 *
 * Media isn't end-to-end encrypted yet (world rooms are public); the LiveKit server can hear the voices.
 */
import {
  Room as LiveKitRoom,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  Track,
  LocalTrackPublication,
  ConnectionState,
} from "livekit-client";
import { MatrixEvent, RoomStateEvent } from "matrix-js-sdk";
import { MatrixRTCSession, MatrixRTCSessionEvent } from "matrix-js-sdk/lib/matrixrtc/MatrixRTCSession";

import type { CallMembership } from "matrix-js-sdk/lib/matrixrtc/CallMembership";
import { EventEmitter, ObservableMap } from "./observable";
import { Stream, toStream } from "./platform";
import type { Room, RoomMember } from "./room";
import type { Session } from "./session";
import type { GroupCall, Member } from "./calls";
import { CallIntent, LocalMedia, MuteSettings } from "./calls";
import { LiveKitDataChannel } from "./livekitDataChannel";

export const WORLD_RTC_SLOT = { application: "software.haven.world", id: "main" };
const DATA_TOPIC = "buzzar";
/** Most packets kept from one player before we know them (a world snapshot is a few hundred at most). */
const MAX_EARLY_PACKETS = 4000;
const CALL_MEMBER_EVENT = "org.matrix.msc3401.call.member";
/** How long our membership lasts unless refreshed (js-sdk refreshes it shortly before). */
const MEMBERSHIP_EXPIRY_MS = 5 * 60 * 1000;
const RTC_FOCI_KEY = "org.matrix.msc4143.rtc_foci";

export function liveKitCallId(roomId: string) {
  return `livekit:${roomId}`;
}

/** The world's current LiveKit call memberships (not expired), oldest first. */
export async function liveKitMemberships(room: Room): Promise<CallMembership[]> {
  const memberships = await MatrixRTCSession.sessionMembershipsForSlot(room.sdk, WORLD_RTC_SLOT, {
    listenForStickyEvents: false,
    listenForMemberStateEvents: true,
  });
  return memberships.filter((membership) => !membership.isExpired());
}

function identityOf(userId: string, deviceId: string) {
  return `${userId}:${deviceId}`;
}

/** The LiveKit JWT service our homeserver advertises (`org.matrix.msc4143.rtc_foci` in its .well-known). */
async function homeserverLiveKitService(session: Session): Promise<string | undefined> {
  const fromFoci = (wellKnown: unknown) => {
    const foci = (wellKnown as Record<string, unknown> | undefined)?.[RTC_FOCI_KEY];
    if (!Array.isArray(foci)) return undefined;
    const focus = foci.find((f) => f?.type === "livekit" && typeof f.livekit_service_url === "string");
    return focus?.livekit_service_url as string | undefined;
  };
  const cached = fromFoci(session.client.getClientWellKnown());
  if (cached) return cached;
  const serverName = session.userId.slice(session.userId.indexOf(":") + 1);
  try {
    const response = await fetch(`https://${serverName}/.well-known/matrix/client`);
    if (response.ok) return fromFoci(await response.json());
  } catch {
    // No .well-known: no LiveKit service.
  }
  return undefined;
}

function serviceUrlOf(membership: CallMembership): string | undefined {
  for (const transport of membership.transports) {
    if (transport.type === "livekit" && typeof transport.livekit_service_url === "string") {
      return transport.livekit_service_url;
    }
  }
  return undefined;
}

/** One device of one player in the LiveKit call (not us). */
export class LiveKitMember implements Member {
  readonly channel: LiveKitDataChannel;
  private participant?: RemoteParticipant;
  private stream?: Stream;

  constructor(
    readonly member: RoomMember,
    readonly deviceId: string,
    private membership: CallMembership,
    send: (identity: string, chunk: Uint8Array<ArrayBuffer>) => Promise<void>
  ) {
    this.channel = new LiveKitDataChannel((chunk) => send(this.identity, chunk));
  }

  get userId(): string {
    return this.member.userId;
  }

  get identity(): string {
    return identityOf(this.userId, this.deviceId);
  }

  get isConnected(): boolean {
    return !!this.participant;
  }

  get dataChannel(): RTCDataChannel | undefined {
    return this.channel.readyState === "open" ? (this.channel as unknown as RTCDataChannel) : undefined;
  }

  get remoteMedia(): { userMedia?: Stream } | undefined {
    return this.stream ? { userMedia: this.stream } : undefined;
  }

  get eventTimestamp(): number {
    return this.membership.createdTs();
  }

  get deviceIndex(): number {
    return 0;
  }

  /** @internal */
  setMembership(membership: CallMembership) {
    this.membership = membership;
  }

  /** @internal Their LiveKit participant arrived or left. Returns whether anything changed. */
  setParticipant(participant: RemoteParticipant | undefined): boolean {
    if (participant === this.participant) return false;
    this.participant = participant;
    if (participant) {
      this.channel.open();
      const audio = [...participant.audioTrackPublications.values()].find((pub) => pub.track)?.track;
      this.setAudio(audio?.mediaStreamTrack);
    } else {
      this.setAudio(undefined);
      this.channel.close();
    }
    return true;
  }

  /** @internal */
  setAudio(track: MediaStreamTrack | undefined) {
    if (track && this.stream?.getAudioTracks()[0] === track) return;
    this.stream = track ? toStream(new MediaStream([track])) : undefined;
  }

  /** @internal */
  dispose() {
    this.channel.close();
  }
}

export class LiveKitCall extends EventEmitter<{ change: undefined }> implements GroupCall {
  readonly method = "livekit" as const;
  readonly members = new ObservableMap<string, LiveKitMember>();
  private rtc: MatrixRTCSession;
  private liveKit?: LiveKitRoom;
  private microphone?: LocalTrackPublication;
  private _localMedia?: LocalMedia;
  private joined = false;
  private disposers: (() => void)[] = [];

  constructor(private session: Session, private room: Room) {
    super();
    this.rtc = MatrixRTCSession.sessionForSlot(session.client, room.sdk, WORLD_RTC_SLOT, {
      listenForStickyEvents: false,
      listenForMemberStateEvents: true,
    });
    const sync = () => this.syncMembers();
    this.rtc.on(MatrixRTCSessionEvent.MembershipsChanged, sync);
    this.disposers.push(() => this.rtc.off(MatrixRTCSessionEvent.MembershipsChanged, sync));
    // A session made without matrix-js-sdk's session manager isn't told when call memberships change (the manager
    // does that for `m.call` only), so recalculate on every membership state event in the room.
    const onState = (event: MatrixEvent) => {
      if (event.getType() === CALL_MEMBER_EVENT) void this.rtc.ensureRecalculateSessionMembers();
    };
    room.sdk.on(RoomStateEvent.Events, onState);
    this.disposers.push(() => room.sdk.off(RoomStateEvent.Events, onState));
    this.rtc.initialMembershipCalculated.then(sync);
  }

  get id(): string {
    return liveKitCallId(this.room.id);
  }

  get roomId(): string {
    return this.room.id;
  }

  get name(): string {
    return "World Call";
  }

  get intent(): CallIntent {
    return CallIntent.Room;
  }

  get hasJoined(): boolean {
    return this.joined;
  }

  get localMedia(): LocalMedia | undefined {
    return this._localMedia;
  }

  get muteSettings(): MuteSettings | undefined {
    if (!this.joined) return undefined;
    return new MuteSettings(this.microphone ? this.microphone.isMuted : true, true);
  }

  private get ownMembership(): CallMembership | undefined {
    return this.rtc.memberships.find((m) => m.userId === this.session.userId && m.deviceId === this.session.deviceId);
  }

  get eventTimestamp(): number | undefined {
    return this.ownMembership?.createdTs() ?? (this.joined ? Date.now() : undefined);
  }

  get deviceIndex(): number | undefined {
    return 0;
  }

  /** The LiveKit JWT service to use: the oldest member's (so everyone meets on one server), else our homeserver's. */
  private async serviceUrl(): Promise<string> {
    const memberships = await liveKitMemberships(this.room);
    for (const membership of memberships) {
      const url = serviceUrlOf(membership);
      if (url) return url;
    }
    const own = await homeserverLiveKitService(this.session);
    if (!own) throw new Error("Your homeserver doesn't offer a LiveKit server for calls.");
    return own;
  }

  private async token(serviceUrl: string): Promise<{ url: string; jwt: string }> {
    let openIdToken;
    try {
      openIdToken = await this.session.client.getOpenIdToken();
    } catch (error) {
      throw new Error(
        `Your homeserver didn't give Buzzar a sign-in token for the LiveKit server (${
          error instanceof Error ? error.message : error
        }).`
      );
    }
    const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/sfu/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: this.room.id, openid_token: openIdToken, device_id: this.session.deviceId }),
    });
    if (!response.ok) throw new Error(`The LiveKit service refused the call (${response.status}).`);
    const body = await response.json();
    if (typeof body?.url !== "string" || typeof body?.jwt !== "string") {
      throw new Error("The LiveKit service sent an unexpected reply.");
    }
    return body;
  }

  private send = async (identity: string, chunk: Uint8Array<ArrayBuffer>) => {
    const liveKit = this.liveKit;
    if (!liveKit || liveKit.state !== ConnectionState.Connected) return;
    await liveKit.localParticipant.publishData(chunk, {
      reliable: true,
      destinationIdentities: [identity],
      topic: DATA_TOPIC,
    });
  };

  /** The LiveKit room while we're connected (screen sharing uses it: engine/screenshare/screenShare.main.ts). */
  get liveKitRoom(): LiveKitRoom | undefined {
    return this.liveKit;
  }

  /** The Matrix user behind a LiveKit identity ("@user:server:DEVICE"). */
  userIdOf(identity: string): string | undefined {
    for (const [, member] of this.members) if (member.identity === identity) return member.userId;
    return undefined;
  }

  async join(localMedia: LocalMedia): Promise<void> {
    if (this.joined) return;
    this._localMedia = localMedia;
    const serviceUrl = await this.serviceUrl();
    const { url, jwt } = await this.token(serviceUrl);

    const liveKit = new LiveKitRoom({ adaptiveStream: false, dynacast: false });
    this.liveKit = liveKit;
    const refresh = () => this.syncParticipants();
    const onTrack = (track: RemoteTrack, _pub: unknown, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const member = this.memberFor(participant.identity);
      if (!member) return;
      member.setAudio(track.mediaStreamTrack);
      this.members.update(this.keyOf(member.userId, member.deviceId));
    };
    const onTrackGone = (track: RemoteTrack, _pub: unknown, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const member = this.memberFor(participant.identity);
      if (!member) return;
      member.setAudio(undefined);
      this.members.update(this.keyOf(member.userId, member.deviceId));
    };
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== DATA_TOPIC || !participant) return;
      const member = this.memberFor(participant.identity);
      if (member && member.isConnected) {
        member.channel.receive(payload);
        return;
      }
      // Their call membership (or LiveKit presence) hasn't reached us yet: keep what they sent until it does.
      const early = this.early.get(participant.identity) ?? [];
      if (early.length < MAX_EARLY_PACKETS) early.push(payload.slice());
      this.early.set(participant.identity, early);
    };
    liveKit.on(RoomEvent.ParticipantConnected, refresh);
    liveKit.on(RoomEvent.ParticipantDisconnected, refresh);
    liveKit.on(RoomEvent.ConnectionStateChanged, refresh);
    liveKit.on(RoomEvent.TrackSubscribed, onTrack);
    liveKit.on(RoomEvent.TrackUnsubscribed, onTrackGone);
    liveKit.on(RoomEvent.DataReceived, onData);
    const onPublished = () => this.applyAudioSubscriptions();
    liveKit.on(RoomEvent.TrackPublished, onPublished);
    this.disposers.push(() => liveKit.off(RoomEvent.TrackPublished, onPublished));
    this.disposers.push(() => {
      liveKit.off(RoomEvent.ParticipantConnected, refresh);
      liveKit.off(RoomEvent.ParticipantDisconnected, refresh);
      liveKit.off(RoomEvent.ConnectionStateChanged, refresh);
      liveKit.off(RoomEvent.TrackSubscribed, onTrack);
      liveKit.off(RoomEvent.TrackUnsubscribed, onTrackGone);
      liveKit.off(RoomEvent.DataReceived, onData);
    });

    try {
      await liveKit.connect(url, jwt, { autoSubscribe: true });
      const track = localMedia.userMedia?.getAudioTracks()[0];
      if (track) {
        this.microphone = await liveKit.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      }
    } catch (error) {
      // Nothing joined yet: undo the connection so a fallback (or a retry) starts clean.
      await liveKit.disconnect().catch(() => undefined);
      this.liveKit = undefined;
      this.microphone = undefined;
      throw new Error(`The LiveKit server couldn't be reached (${error instanceof Error ? error.message : error}).`);
    }

    this.rtc.join(
      {
        userId: this.session.userId,
        deviceId: this.session.deviceId,
        memberId: identityOf(this.session.userId, this.session.deviceId),
      },
      [{ type: "livekit", livekit_service_url: serviceUrl, livekit_alias: this.room.id }],
      {
        manageMediaKeys: false,
        callIntent: "audio",
        // Short-lived and kept fresh while we're in the call: homeservers without delayed events (MSC4140) can't
        // remove a membership when its client vanishes, so it must expire on its own soon.
        membershipEventExpiryMs: MEMBERSHIP_EXPIRY_MS,
      }
    );
    this.joined = true;
    this.syncMembers();
    this.emit("change");
  }

  async setMedia(localMedia: LocalMedia): Promise<void> {
    const old = this._localMedia;
    this._localMedia = localMedia;
    const track = localMedia.userMedia?.getAudioTracks()[0];
    const liveKit = this.liveKit;
    if (liveKit && track) {
      const wasMuted = this.microphone?.isMuted ?? false;
      if (this.microphone?.track) await this.microphone.track.replaceTrack(track);
      else this.microphone = await liveKit.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      if (wasMuted) await this.microphone.mute();
    }
    if (old && old.userMedia !== localMedia.userMedia) old.dispose();
    this.emit("change");
  }

  async setMuted(settings: MuteSettings): Promise<void> {
    if (settings.microphone) await this.microphone?.mute();
    else await this.microphone?.unmute();
    this.emit("change");
  }

  async leave(): Promise<void> {
    if (!this.joined) return;
    this.joined = false;
    await this.rtc.leave(5000).catch(() => false);
    await this.liveKit?.disconnect();
    this.liveKit = undefined;
    this.microphone = undefined;
    this._localMedia = undefined;
    this.early.clear();
    this.syncMembers();
    this.emit("change");
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    for (const [, member] of this.members) member.dispose();
    void this.rtc.stop();
  }

  /**
   * Only receive the voices of these people (user IDs): the ones within earshot or on a stage (voice.game.ts).
   * Undefined: everyone's. Data (movement) is still received from everyone.
   */
  setAudibleUsers(userIds: string[] | undefined) {
    this.audibleUsers = userIds ? new Set(userIds) : undefined;
    this.applyAudioSubscriptions();
  }

  private audibleUsers?: Set<string>;

  private applyAudioSubscriptions() {
    const liveKit = this.liveKit;
    if (!liveKit) return;
    for (const [, member] of this.members) {
      const participant = liveKit.remoteParticipants.get(member.identity);
      if (!participant) continue;
      const wanted = !this.audibleUsers || this.audibleUsers.has(member.userId);
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.isDesired !== wanted) publication.setSubscribed(wanted);
      }
    }
  }

  private keyOf(userId: string, deviceId: string) {
    return `${userId}|${deviceId}`;
  }

  private memberFor(identity: string): LiveKitMember | undefined {
    for (const [, member] of this.members) if (member.identity === identity) return member;
    return undefined;
  }

  private syncMembers() {
    const seen = new Set<string>();
    for (const membership of this.rtc.memberships) {
      if (membership.isExpired()) continue;
      if (membership.userId === this.session.userId && membership.deviceId === this.session.deviceId) continue;
      const key = this.keyOf(membership.userId, membership.deviceId);
      seen.add(key);
      const existing = this.members.get(key);
      if (existing) {
        existing.setMembership(membership);
        continue;
      }
      const roomMember = this.room.getMember(membership.userId);
      if (!roomMember) continue;
      this.members.add(key, new LiveKitMember(roomMember, membership.deviceId, membership, this.send));
    }
    for (const [key, member] of [...this.members]) {
      if (seen.has(key)) continue;
      member.dispose();
      this.members.remove(key);
    }
    this.syncParticipants();
    this.emit("change");
  }

  /** Packets from players we didn't know yet (by LiveKit identity), delivered once we do. */
  private early = new Map<string, Uint8Array[]>();

  private syncParticipants() {
    const participants = this.joined && this.liveKit ? this.liveKit.remoteParticipants : undefined;
    for (const [key, member] of this.members) {
      if (member.setParticipant(participants?.get(member.identity))) this.members.update(key);
      const early = member.isConnected ? this.early.get(member.identity) : undefined;
      if (early) {
        this.early.delete(member.identity);
        for (const packet of early) member.channel.receive(packet);
      }
    }
    this.applyAudioSubscriptions();
    this.emit("change");
  }
}
