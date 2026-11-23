/**
 * Buzzar's Matrix layer (plan 02): world calls. Voice and the game's data channel ride matrix-js-sdk's MSC3401
 * group calls (full mesh), wrapped in the shapes the engine and UI were written against: a call with an observable
 * map of members, each with a connection state, a data channel and a remote audio stream.
 *
 * A world can also use a MatrixRTC + LiveKit call instead (livekitCall.ts, chosen per world: callMethod.ts). Both
 * kinds of call have the same shape (the GroupCall and Member interfaces below), so the engine and UI don't care
 * which one they have.
 */
import {
  GroupCall as SdkGroupCall,
  GroupCallEvent,
  GroupCallIntent,
  GroupCallState,
  GroupCallType,
  MatrixClient,
  RoomStateEvent,
} from "matrix-js-sdk";
import { CallEvent, CallState, MatrixCall } from "matrix-js-sdk/lib/webrtc/call";
import { GroupCallEventHandlerEvent } from "matrix-js-sdk/lib/webrtc/groupCallEventHandler";

import { EventEmitter, ObservableMap } from "./observable";
import type { CallMethod, OpenWorldCalls } from "./callMethod";
import { LiveKitCall, liveKitCallId, liveKitMemberships } from "./livekitCall";
import { Stream, toStream } from "./platform";
import type { Room, RoomMember } from "./room";
import type { Session } from "./session";

export enum CallIntent {
  Ring = "m.ring",
  Prompt = "m.prompt",
  Room = "m.room",
}

const CALL_MEMBER_EVENT = "org.matrix.msc3401.call.member";
const DATA_CHANNEL_OPTIONS = { ordered: true, protocol: "" } as RTCDataChannelInit;

/** What the local user brings to a call: a microphone stream and/or a data channel. */
export class LocalMedia {
  constructor(
    readonly userMedia?: Stream,
    readonly screenShare?: Stream,
    readonly dataChannelOptions?: RTCDataChannelInit
  ) {}

  withUserMedia(stream: MediaStream) {
    return new LocalMedia(toStream(stream), this.screenShare, this.dataChannelOptions);
  }

  withScreenShare(stream: MediaStream) {
    return new LocalMedia(this.userMedia, toStream(stream), this.dataChannelOptions);
  }

  withDataChannel(options: RTCDataChannelInit) {
    return new LocalMedia(this.userMedia, this.screenShare, options);
  }

  clone() {
    return new LocalMedia(this.userMedia, this.screenShare, this.dataChannelOptions);
  }

  dispose() {
    this.userMedia?.getTracks().forEach((track) => track.stop());
  }
}

/** `microphone: true` means the microphone is muted. */
export class MuteSettings {
  constructor(readonly microphone = false, readonly camera = true) {}

  toggleMicrophone() {
    return new MuteSettings(!this.microphone, this.camera);
  }

  toggleCamera() {
    return new MuteSettings(this.microphone, !this.camera);
  }
}

/** One device of one user in a world call (not us), whichever kind of call it is. */
export interface Member {
  readonly userId: string;
  readonly deviceId: string;
  readonly member: RoomMember;
  readonly isConnected: boolean;
  readonly dataChannel: RTCDataChannel | undefined;
  readonly remoteMedia: { userMedia?: Stream } | undefined;
  /** When this member joined the call (older = earlier; used to pick the host). */
  readonly eventTimestamp: number;
  readonly deviceIndex: number;
}

/** A world call, whichever method carries it (callMethod.ts). */
export interface GroupCall extends EventEmitter<{ change: undefined }> {
  readonly method: CallMethod;
  readonly members: ObservableMap<string, Member>;
  readonly id: string;
  readonly roomId: string;
  readonly name: string;
  readonly intent: CallIntent;
  readonly hasJoined: boolean;
  readonly localMedia: LocalMedia | undefined;
  readonly muteSettings: MuteSettings | undefined;
  readonly eventTimestamp: number | undefined;
  readonly deviceIndex: number | undefined;
  join(localMedia: LocalMedia): Promise<void>;
  setMedia(localMedia: LocalMedia): Promise<void>;
  setMuted(settings: MuteSettings): Promise<void>;
  leave(): Promise<void>;
  dispose(): void;
}

/** One device of one user in a mesh call (not us). */
export class MeshMember implements Member {
  /** @internal */
  call?: MatrixCall;
  private channel?: RTCDataChannel;
  private stream?: Stream;
  private detach?: () => void;

  constructor(
    private groupCall: MeshCall,
    readonly member: RoomMember,
    readonly deviceId: string,
    private onChange: () => void
  ) {}

  get userId(): string {
    return this.member.userId;
  }

  get isConnected(): boolean {
    return this.call?.state === CallState.Connected;
  }

  get dataChannel(): RTCDataChannel | undefined {
    return this.channel && this.channel.readyState !== "closed" ? this.channel : undefined;
  }

  get remoteMedia(): { userMedia?: Stream } | undefined {
    const remote = this.call?.remoteUsermediaStream;
    if (!remote) return undefined;
    if (this.stream?.id !== remote.id) this.stream = toStream(remote);
    return { userMedia: this.stream };
  }

  /** When this member's call membership event was sent (older = joined earlier). */
  get eventTimestamp(): number {
    return this.groupCall.membershipOf(this.userId, this.deviceId).timestamp;
  }

  get deviceIndex(): number {
    return this.groupCall.membershipOf(this.userId, this.deviceId).index;
  }

  /** @internal */
  setCall(call: MatrixCall | undefined) {
    if (call === this.call) return;
    this.detach?.();
    this.detach = undefined;
    this.call = call;
    this.channel = undefined;
    if (call) {
      const changed = () => this.onChange();
      const onChannel = (channel: RTCDataChannel) => {
        this.channel = channel;
        channel.addEventListener("open", changed);
        channel.addEventListener("close", changed);
        changed();
      };
      call.on(CallEvent.State, changed);
      call.on(CallEvent.FeedsChanged, changed);
      call.on(CallEvent.DataChannel, onChannel);
      this.detach = () => {
        call.off(CallEvent.State, changed);
        call.off(CallEvent.FeedsChanged, changed);
        call.off(CallEvent.DataChannel, onChannel);
      };
    }
    this.onChange();
  }

  /** @internal */
  dispose() {
    this.detach?.();
    this.detach = undefined;
  }
}

/** An MSC3401 group call: every player connected to every other. */
export class MeshCall extends EventEmitter<{ change: undefined }> implements GroupCall {
  readonly method = "mesh" as const;
  readonly members = new ObservableMap<string, MeshMember>();
  private _localMedia?: LocalMedia;
  private disposers: (() => void)[] = [];

  constructor(private session: Session, private room: Room, readonly sdk: SdkGroupCall) {
    super();
    // Calls made by older clients don't say they carry a data channel; Buzzar's always do.
    const internals = sdk as unknown as {
      dataChannelsEnabled: boolean;
      dataChannelOptions: RTCDataChannelInit;
      allowCallWithoutVideoAndAudio: boolean;
    };
    internals.dataChannelsEnabled = true;
    internals.dataChannelOptions ??= DATA_CHANNEL_OPTIONS;
    internals.allowCallWithoutVideoAndAudio = true;

    const sync = () => this.syncMembers();
    const changed = () => this.emit("change");
    sdk.on(GroupCallEvent.ParticipantsChanged, sync);
    sdk.on(GroupCallEvent.CallsChanged, sync);
    sdk.on(GroupCallEvent.GroupCallStateChanged, changed);
    sdk.on(GroupCallEvent.LocalMuteStateChanged, changed);
    this.disposers.push(() => {
      sdk.off(GroupCallEvent.ParticipantsChanged, sync);
      sdk.off(GroupCallEvent.CallsChanged, sync);
      sdk.off(GroupCallEvent.GroupCallStateChanged, changed);
      sdk.off(GroupCallEvent.LocalMuteStateChanged, changed);
    });
    this.syncMembers();
  }

  get id(): string {
    return this.sdk.groupCallId;
  }

  get roomId(): string {
    return this.room.id;
  }

  get name(): string {
    return "World Call";
  }

  get intent(): CallIntent {
    return this.sdk.intent as unknown as CallIntent;
  }

  get hasJoined(): boolean {
    return this.sdk.state === GroupCallState.Entered;
  }

  get localMedia(): LocalMedia | undefined {
    return this._localMedia;
  }

  get muteSettings(): MuteSettings | undefined {
    if (!this.hasJoined) return undefined;
    return new MuteSettings(this.sdk.isMicrophoneMuted(), true);
  }

  /** Our own call membership: when it was sent, and our device's place in it. */
  get eventTimestamp(): number | undefined {
    return this.membershipOf(this.session.userId, this.session.deviceId).timestamp;
  }

  get deviceIndex(): number | undefined {
    return this.membershipOf(this.session.userId, this.session.deviceId).index;
  }

  /** @internal */
  membershipOf(userId: string, deviceId: string): { timestamp: number; index: number } {
    const event = this.room.sdk.currentState.getStateEvents(CALL_MEMBER_EVENT, userId);
    if (!event) return { timestamp: Number.MAX_SAFE_INTEGER, index: 0 };
    const calls = event.getContent()["m.calls"];
    const call = Array.isArray(calls) ? calls.find((c) => c?.["m.call_id"] === this.id) : undefined;
    const devices: { device_id?: string }[] = Array.isArray(call?.["m.devices"]) ? call["m.devices"] : [];
    const index = devices.findIndex((d) => d.device_id === deviceId);
    return { timestamp: event.getTs(), index: Math.max(0, index) };
  }

  private syncMembers() {
    const seen = new Set<string>();
    for (const [sdkMember, devices] of this.sdk.participants) {
      for (const deviceId of devices.keys()) {
        if (sdkMember.userId === this.session.userId && deviceId === this.session.deviceId) continue;
        const key = `${sdkMember.userId}|${deviceId}`;
        seen.add(key);
        let member = this.members.get(key);
        if (!member) {
          const roomMember = this.room.getMember(sdkMember.userId);
          if (!roomMember) continue;
          member = new MeshMember(this, roomMember, deviceId, () => this.members.update(key));
          this.members.add(key, member);
        }
        member.setCall(this.callFor(sdkMember.userId, deviceId));
      }
    }
    for (const [key, member] of [...this.members]) {
      if (seen.has(key)) continue;
      member.dispose();
      this.members.remove(key);
    }
    this.emit("change");
  }

  private callFor(userId: string, deviceId: string): MatrixCall | undefined {
    // The group call's own table of calls by user and device (a call we placed has no opponent member until it's
    // answered, so asking each call who it's with misses those).
    const calls = (this.sdk as unknown as { calls: Map<string, Map<string, MatrixCall>> }).calls;
    return calls?.get(userId)?.get(deviceId);
  }

  /** Joins with the given microphone stream (or none: data channel only). */
  async join(localMedia: LocalMedia): Promise<void> {
    if (this.hasJoined) return;
    this._localMedia = localMedia;
    const handler = this.session.client.getMediaHandler();
    const original = handler.getUserMediaStream;
    // The group call asks the media handler for a microphone; hand it the stream Buzzar already opened
    // (the chosen device), or fail so it joins without audio.
    handler.getUserMediaStream = async () => {
      if (localMedia.userMedia) return localMedia.userMedia;
      throw new Error("No microphone");
    };
    try {
      await this.sdk.enter();
    } finally {
      handler.getUserMediaStream = original;
    }
    this.syncMembers();
  }

  /** Swaps the microphone stream without leaving. */
  async setMedia(localMedia: LocalMedia): Promise<void> {
    this._localMedia = localMedia;
    if (localMedia.userMedia) await this.sdk.updateLocalUsermediaStream(localMedia.userMedia);
    this.emit("change");
  }

  async setMuted(settings: MuteSettings): Promise<void> {
    await this.sdk.setMicrophoneMuted(settings.microphone);
    this.emit("change");
  }

  async leave(): Promise<void> {
    if (this.sdk.state !== GroupCallState.Ended) this.sdk.leave();
    this._localMedia = undefined;
    this.syncMembers();
  }

  /** @internal */
  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    for (const [, member] of this.members) member.dispose();
  }
}

/** The calls in the user's rooms, by call ID (mesh calls by their call ID, LiveKit calls by their slot). */
export class CallHandler {
  readonly calls = new ObservableMap<string, GroupCall>();
  private disposers: (() => void)[] = [];

  constructor(private session: Session, private client: MatrixClient) {
    const add = (sdk: SdkGroupCall) => this.adopt(sdk);
    const ended = (sdk: SdkGroupCall) => {
      const call = this.calls.get(sdk.groupCallId);
      if (!call) return;
      call.dispose();
      this.calls.remove(sdk.groupCallId);
    };
    client.on(GroupCallEventHandlerEvent.Incoming, add);
    client.on(GroupCallEventHandlerEvent.Outgoing, add);
    client.on(GroupCallEventHandlerEvent.Ended, ended);
    // Member state arriving for a call we wrap refreshes timestamps used for host election.
    const onState = () => undefined;
    client.on(RoomStateEvent.Events, onState);
    this.disposers.push(() => {
      client.off(GroupCallEventHandlerEvent.Incoming, add);
      client.off(GroupCallEventHandlerEvent.Outgoing, add);
      client.off(GroupCallEventHandlerEvent.Ended, ended);
      client.off(RoomStateEvent.Events, onState);
    });
  }

  private adopt(sdk: SdkGroupCall): MeshCall | undefined {
    const existing = this.calls.get(sdk.groupCallId);
    if (existing) return existing as MeshCall;
    const room = this.session.rooms.get(sdk.room.roomId);
    if (!room) return undefined;
    const call = new MeshCall(this.session, room, sdk);
    this.calls.add(sdk.groupCallId, call);
    return call;
  }

  /** Picks up calls that already exist in joined rooms. */
  async loadCalls(_intent?: CallIntent): Promise<void> {
    const handler = this.client.groupCallEventHandler;
    if (!handler) return;
    for (const sdk of handler.groupCalls.values()) this.adopt(sdk);
  }

  /** The room's mesh call, once the room's state is loaded. */
  async getCallForRoom(roomId: string): Promise<MeshCall | undefined> {
    await this.client.waitUntilRoomReadyForGroupCalls(roomId).catch(() => undefined);
    const sdk = this.client.getGroupCallForRoom(roomId);
    return sdk ? this.adopt(sdk) : undefined;
  }

  async createCall(roomId: string, _type: "m.voice" | "m.video", _name: string, intent = CallIntent.Room) {
    const existing = await this.getCallForRoom(roomId);
    if (existing) return existing;
    const sdk = await this.client.createGroupCall(
      roomId,
      GroupCallType.Voice,
      false,
      intent as unknown as GroupCallIntent,
      true,
      DATA_CHANNEL_OPTIONS as never
    );
    const call = this.adopt(sdk);
    if (!call) throw new Error("Couldn't start the world call: the room isn't loaded");
    return call;
  }

  /**
   * Who is in each kind of call in a world right now (not counting this device). Mesh members come from the room's
   * MSC3401 call, LiveKit members from its MatrixRTC session (expired memberships aren't counted).
   */
  async openWorldCalls(roomId: string): Promise<OpenWorldCalls> {
    const open: OpenWorldCalls = { mesh: [], livekit: [] };
    const self = (userId: string, deviceId: string) =>
      userId === this.session.userId && deviceId === this.session.deviceId;
    const mesh = await this.getCallForRoom(roomId);
    if (mesh) {
      for (const [member, devices] of mesh.sdk.participants) {
        for (const deviceId of devices.keys()) if (!self(member.userId, deviceId)) open.mesh.push(member.userId);
      }
    }
    const room = this.session.rooms.get(roomId);
    if (room) {
      for (const membership of await liveKitMemberships(room)) {
        if (!self(membership.userId, membership.deviceId)) open.livekit.push(membership.userId);
      }
    }
    return open;
  }

  /** The world's LiveKit call (created on first use; it isn't joined until `join`). */
  liveKitCall(roomId: string): LiveKitCall {
    const id = liveKitCallId(roomId);
    const existing = this.calls.get(id);
    if (existing) return existing as LiveKitCall;
    const room = this.session.rooms.get(roomId);
    if (!room) throw new Error("Couldn't start the world call: the room isn't loaded");
    const call = new LiveKitCall(this.session, room);
    this.calls.add(id, call);
    return call;
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    for (const [, call] of this.calls) call.dispose();
  }
}
