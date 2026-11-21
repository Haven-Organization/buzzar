/**
 * Buzzar's Matrix layer (plan 02): rooms, members, invites and timelines over matrix-js-sdk, with the shapes the
 * UI was written against (observable state, `{ event }` state lookups, member lists).
 */
import {
  EventTimeline,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  NotificationCountType,
  Room as SdkRoom,
  RoomEvent,
  RoomMember as SdkRoomMember,
  RoomMemberEvent,
  RoomStateEvent,
} from "matrix-js-sdk";

import { BaseObservableList, EventEmitter, ObservableMap, ObservableValue } from "./observable";
import type { MediaRepository } from "./session";
import { LIST_STATE_TYPES } from "./syncSettings";

/** A state event as it comes from the server. */
export interface StateEvent {
  type: string;
  state_key: string;
  content: Record<string, any>;
  sender: string;
  origin_server_ts: number;
  event_id: string;
  room_id?: string;
  unsigned?: Record<string, any>;
}

export type TimelineEvent = StateEvent;

/** An event's content. */
export type Content = Record<string, any>;

function toStateEvent(event: MatrixEvent): StateEvent {
  return {
    type: event.getType(),
    state_key: event.getStateKey() ?? "",
    content: event.getContent(),
    sender: event.getSender() ?? "",
    origin_server_ts: event.getTs(),
    event_id: event.getId() ?? "",
    room_id: event.getRoomId(),
    unsigned: event.getUnsigned(),
  };
}

const entries = new WeakMap<MatrixEvent, TimelineEntry>();

/** A timeline event with the fields views read. One per event, so identity is stable across refreshes. */
let lookupRoom: ((roomId: string) => SdkRoom | null) | undefined;

export class TimelineEntry {
  /** Stable for the life of the page (a message being sent keeps its local ID after it's sent). */
  readonly id: string;

  /** How entries find their room (for current member profiles); set by the client when it starts. */
  static setRoomLookup(lookup: (roomId: string) => SdkRoom | null) {
    lookupRoom = lookup;
  }

  private constructor(readonly sdk: MatrixEvent) {
    this.id = sdk.getId() ?? sdk.getTxnId() ?? `local-${Math.random()}`;
  }

  static of(event: MatrixEvent): TimelineEntry {
    let entry = entries.get(event);
    if (!entry) entries.set(event, (entry = new TimelineEntry(event)));
    return entry;
  }

  get eventId(): string | undefined {
    return this.sdk.getId();
  }

  get eventType(): string {
    return this.sdk.getType();
  }

  /** The event as sent (decrypted, and with edits applied to `content`). */
  get event(): StateEvent {
    return toStateEvent(this.sdk);
  }

  get content(): Record<string, any> {
    return this.sdk.getContent();
  }

  get sender(): string {
    return this.sdk.getSender() ?? "";
  }

  /**
   * The sender as the room knew them when the event was sent, or as it knows them now when that's missing: with
   * lazy-loaded members (and sliding sync) older events often arrive before the sender's member event, and then the
   * SDK's per-event sender is a bare placeholder (the user ID, no avatar).
   */
  private get senderMember() {
    const atTheTime = this.sdk.sender;
    if (atTheTime?.events.member) return atTheTime;
    const roomId = this.sdk.getRoomId();
    return (roomId && lookupRoom?.(roomId)?.getMember(this.sender)) || atTheTime;
  }

  get displayName(): string {
    return this.senderMember?.name || this.sender;
  }

  get avatarUrl(): string | undefined {
    return this.senderMember?.getMxcAvatarUrl() ?? undefined;
  }

  get timestamp(): number {
    return this.sdk.getTs();
  }

  get isRedacted(): boolean {
    return this.sdk.isRedacted();
  }

  get isPending(): boolean {
    return this.sdk.isSending();
  }

  get isEdit(): boolean {
    return this.sdk.isRelation("m.replace");
  }

  /** Encrypted and not (yet) readable on this device. */
  get isUndecrypted(): boolean {
    return this.sdk.isEncrypted() && (this.sdk.isBeingDecrypted() || this.sdk.isDecryptionFailure());
  }

  get replyToId(): string | undefined {
    return this.sdk.replyEventId;
  }

  get isGap(): false {
    return false;
  }
}

export class RoomMember {
  constructor(readonly roomId: string, readonly userId: string, private sdk?: SdkRoomMember) {}

  /** @internal */
  setSdk(member: SdkRoomMember) {
    this.sdk = member;
  }

  get name(): string {
    return this.sdk?.name || this.userId;
  }

  get displayName(): string | undefined {
    return this.sdk?.rawDisplayName || undefined;
  }

  get avatarUrl(): string | undefined {
    return this.sdk?.getMxcAvatarUrl() ?? undefined;
  }

  get membership(): string {
    return this.sdk?.membership ?? "leave";
  }

  get powerLevel(): number {
    return this.sdk?.powerLevel ?? 0;
  }
}

export class MemberList {
  constructor(readonly members: ObservableMap<string, RoomMember>) {}
}

/** The live end of a room's history, oldest first, with paging back. */
export class Timeline {
  readonly entries: TimelineEntries;
  private disposers: (() => void)[] = [];
  private loadingMore?: Promise<boolean>;

  constructor(private client: MatrixClient, readonly sdkRoom: SdkRoom) {
    this.entries = new TimelineEntries(() => this.sdkRoom.getLiveTimeline().getEvents());
    const refresh = () => this.entries.refresh();
    const onTimeline = (_event: MatrixEvent, room: SdkRoom | undefined) => {
      if (room?.roomId === sdkRoom.roomId) refresh();
    };
    sdkRoom.on(RoomEvent.Timeline, onTimeline);
    sdkRoom.on(RoomEvent.Redaction, refresh);
    sdkRoom.on(RoomEvent.LocalEchoUpdated, refresh);
    sdkRoom.on(RoomEvent.TimelineReset, refresh);
    const onReplaced = (event: MatrixEvent) => {
      if (event.getRoomId() === sdkRoom.roomId) refresh();
    };
    client.on(MatrixEventEvent.Replaced, onReplaced);
    const onDecrypted = (event: MatrixEvent) => {
      if (event.getRoomId() === sdkRoom.roomId) refresh();
    };
    client.on(MatrixEventEvent.Decrypted, onDecrypted);
    this.disposers.push(() => {
      sdkRoom.off(RoomEvent.Timeline, onTimeline);
      sdkRoom.off(RoomEvent.Redaction, refresh);
      sdkRoom.off(RoomEvent.LocalEchoUpdated, refresh);
      sdkRoom.off(RoomEvent.TimelineReset, refresh);
      client.off(MatrixEventEvent.Decrypted, onDecrypted);
      client.off(MatrixEventEvent.Replaced, onReplaced);
    });
  }

  get events(): MatrixEvent[] {
    return this.entries.events;
  }

  /** An event in this room that's already loaded (e.g. the message a reply quotes). */
  findEntry(eventId: string): TimelineEntry | undefined {
    const event = this.sdkRoom.findEventById(eventId);
    return event ? TimelineEntry.of(event) : undefined;
  }

  /** Calls back for each new event as it arrives (not for history that's paged in). */
  onLiveEvent(callback: (event: TimelineEvent, sdkEvent: MatrixEvent) => void): () => void {
    const handler = (
      event: MatrixEvent,
      room: SdkRoom | undefined,
      toStartOfTimeline: boolean | undefined,
      _removed: boolean,
      data: { liveEvent?: boolean }
    ) => {
      if (room?.roomId !== this.sdkRoom.roomId || toStartOfTimeline || !data?.liveEvent) return;
      callback(toStateEvent(event), event);
    };
    this.sdkRoom.on(RoomEvent.Timeline, handler);
    return () => this.sdkRoom.off(RoomEvent.Timeline, handler);
  }

  /** Set when paging back stopped bringing anything in, whatever the server's token says. */
  private exhausted = false;

  /** Whether there is older history on the server. */
  get canLoadMore(): boolean {
    return !this.exhausted && !!this.sdkRoom.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS);
  }

  /** Loads older messages; resolves false when there are none left. */
  loadMore(limit = 30): Promise<boolean> {
    if (!this.loadingMore) {
      const before = this.sdkRoom.getLiveTimeline().getEvents().length;
      this.loadingMore = this.client
        .scrollback(this.sdkRoom, limit)
        .then(async () => {
          // A page that adds nothing means there's nothing more to get (a token can outlive the history it
          // pointed at). Without this, callers that keep paging "while there's more" never stop.
          if (this.sdkRoom.getLiveTimeline().getEvents().length <= before) this.exhausted = true;
          // Always give the browser a turn before the next page, so paging can never monopolise the page.
          await new Promise((resolve) => setTimeout(resolve, 0));
          this.entries.refresh();
          return this.canLoadMore;
        })
        .finally(() => {
          this.loadingMore = undefined;
        });
    }
    return this.loadingMore;
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }
}

export class TimelineEntries extends BaseObservableList<MatrixEvent> {
  constructor(private read: () => MatrixEvent[]) {
    super();
    this.items = [...read()];
  }

  get events() {
    return this.items;
  }

  private pending?: ReturnType<typeof setTimeout>;

  /**
   * Re-reads the events and tells observers, once per burst: paging back delivers a page of events one at a time,
   * and redrawing a chat for each of them froze the app.
   */
  refresh() {
    if (this.pending !== undefined) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.items = [...this.read()];
      for (const handler of [...this.handlers]) handler.onReset?.();
    }, 30);
  }
}

/** The room IDs in an m.direct content, worked out once per version of it (the room lists ask for every room). */
const directRoomSets = new WeakMap<object, Set<string>>();
function directRoomIds(direct: Record<string, string[]>): Set<string> {
  let ids = directRoomSets.get(direct);
  if (!ids) {
    ids = new Set(Object.values(direct).flatMap((rooms) => (Array.isArray(rooms) ? rooms : [])));
    directRoomSets.set(direct, ids);
  }
  return ids;
}

export class Room extends EventEmitter<{ change: undefined }> {
  /** The open timeline, if any (kept so views reuse it). */
  _timeline?: Timeline;
  private stateObservers = new Map<string, ObservableMap<string, StateEvent>>();
  private keyObservers = new Map<string, ObservableValue<StateEvent | undefined>>();
  private memberObservers = new Map<string, ObservableValue<RoomMember>>();
  private members = new Map<string, RoomMember>();
  private memberList?: ObservableMap<string, RoomMember>;
  private disposers: (() => void)[] = [];

  constructor(
    readonly client: MatrixClient,
    readonly sdk: SdkRoom,
    readonly mediaRepository: MediaRepository,
    /** Tells the session this room's full state is wanted (see Session.useRoom). */
    private use: (roomId: string) => void = () => undefined
  ) {
    super();
    const onState = (event: MatrixEvent) => this.handleStateEvent(event);
    const onMember = (_event: MatrixEvent, _state: unknown, member: SdkRoomMember) => this.handleMember(member);
    sdk.currentState.on(RoomStateEvent.Events, onState);
    sdk.currentState.on(RoomStateEvent.Members, onMember);
    sdk.currentState.on(RoomStateEvent.NewMember, onMember);
    const onMemberChange = (_event: MatrixEvent | undefined, member: SdkRoomMember) => {
      if (member.roomId === sdk.roomId) this.handleMember(member);
    };
    client.on(RoomMemberEvent.PowerLevel, onMemberChange);
    client.on(RoomMemberEvent.Name, onMemberChange);
    this.disposers.push(() => {
      sdk.currentState.off(RoomStateEvent.Events, onState);
      sdk.currentState.off(RoomStateEvent.Members, onMember);
      sdk.currentState.off(RoomStateEvent.NewMember, onMember);
      client.off(RoomMemberEvent.PowerLevel, onMemberChange);
      client.off(RoomMemberEvent.Name, onMemberChange);
    });
  }

  get id(): string {
    return this.sdk.roomId;
  }

  get name(): string | undefined {
    return this.sdk.name || undefined;
  }

  /** The room's picture, or for a room without one that's just you and one other person, theirs (like a DM). */
  get avatarUrl(): string | undefined {
    return this.sdk.getMxcAvatarUrl() ?? this.sdk.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? undefined;
  }

  get avatarColorId(): string {
    return this.id;
  }

  get canonicalAlias(): string | undefined {
    return this.sdk.getCanonicalAlias() ?? undefined;
  }

  /** The room type from its create event (e.g. `org.matrix.msc3815.world`). */
  get type(): string | undefined {
    return this.sdk.getType();
  }

  get membership(): string {
    return this.sdk.getMyMembership();
  }

  get isEncrypted(): boolean {
    return this.sdk.hasEncryptionStateEvent();
  }

  get isDirectMessage(): boolean {
    const direct = this.client.getAccountData("m.direct" as never)?.getContent() as
      | Record<string, string[]>
      | undefined;
    if (direct && directRoomIds(direct).has(this.id)) return true;
    return !!this.sdk.getDMInviter();
  }

  get joinedMemberCount(): number {
    return this.sdk.getJoinedMemberCount();
  }

  get notificationCount(): number {
    return this.sdk.getUnreadNotificationCount(NotificationCountType.Total) ?? 0;
  }

  get highlightCount(): number {
    return this.sdk.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
  }

  get isUnread(): boolean {
    if (this.notificationCount > 0) return true;
    const readUpTo = this.sdk.getEventReadUpTo(this.client.getSafeUserId());
    const events = this.sdk.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.getId() === readUpTo) return false;
      if (event.getSender() !== this.client.getSafeUserId() && event.getType() === "m.room.message") return true;
    }
    return false;
  }

  get lastMessageTimestamp(): number {
    return this.sdk.getLastActiveTimestamp();
  }

  /** Subscribes the room (sliding sync) only for state the room list doesn't already carry for every room. */
  private useForState(type: string) {
    if (!LIST_STATE_TYPES.has(type)) this.use(this.id);
  }

  /**
   * The newest message in what's loaded, for previews. Reads what sync already delivered: it doesn't open the
   * timeline or subscribe the room (doing that per list tile subscribed every room in the list).
   */
  get recentMessage(): TimelineEntry | undefined {
    const events = this.sdk.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const type = events[i].getType();
      if (type === "m.room.message" || type === "m.sticker" || type === "m.room.encrypted")
        return TimelineEntry.of(events[i]);
    }
    return undefined;
  }

  /** Goes up whenever anything about the room changed, so views can skip redrawing rooms that didn't. */
  version = 0;

  /** @internal The session calls this when anything about the room changed. */
  notifyChange() {
    this.version++;
    this.emit("change");
  }

  async getStateEvent(type: string, key = ""): Promise<{ event: StateEvent; roomId: string } | undefined> {
    this.useForState(type);
    const event = this.sdk.currentState.getStateEvents(type, key);
    return event ? { event: toStateEvent(event), roomId: this.id } : undefined;
  }

  /** Every state event of a type, by state key, kept up to date. */
  async observeStateType(type: string): Promise<ObservableMap<string, StateEvent>> {
    this.useForState(type);
    let observer = this.stateObservers.get(type);
    if (!observer) {
      const events = this.sdk.currentState.getStateEvents(type) ?? [];
      observer = new ObservableMap(events.map((e) => [e.getStateKey() ?? "", toStateEvent(e)]));
      this.stateObservers.set(type, observer);
    }
    return observer;
  }

  /** One state event (type + key), kept up to date. */
  async observeStateTypeAndKey(type: string, key = ""): Promise<ObservableValue<StateEvent | undefined>> {
    this.useForState(type);
    const id = `${type}\n${key}`;
    let observer = this.keyObservers.get(id);
    if (!observer) {
      const event = this.sdk.currentState.getStateEvents(type, key);
      observer = new ObservableValue<StateEvent | undefined>(event ? toStateEvent(event) : undefined);
      this.keyObservers.set(id, observer);
    }
    return observer;
  }

  private handleStateEvent(event: MatrixEvent) {
    const state = toStateEvent(event);
    this.stateObservers.get(state.type)?.set(state.state_key, state);
    this.keyObservers.get(`${state.type}\n${state.state_key}`)?.update(state);
  }

  private memberFor(userId: string, sdkMember?: SdkRoomMember | null): RoomMember {
    let member = this.members.get(userId);
    const found = sdkMember ?? this.sdk.getMember(userId) ?? undefined;
    if (!member) {
      member = new RoomMember(this.id, userId, found);
      this.members.set(userId, member);
    } else if (found) {
      member.setSdk(found);
    }
    return member;
  }

  private handleMember(sdkMember: SdkRoomMember) {
    const member = this.memberFor(sdkMember.userId, sdkMember);
    this.memberList?.set(member.userId, member);
    this.memberObservers.get(member.userId)?.update(member);
  }

  /** A member, or undefined if the room has never heard of them. */
  getMember(userId: string): RoomMember | undefined {
    return this.sdk.getMember(userId) ? this.memberFor(userId) : undefined;
  }

  async observeMember(userId: string): Promise<ObservableValue<RoomMember> | null> {
    let observer = this.memberObservers.get(userId);
    if (!observer) {
      if (!this.sdk.getMember(userId)) await this.sdk.loadMembersIfNeeded().catch(() => undefined);
      if (!this.sdk.getMember(userId)) return null;
      observer = new ObservableValue(this.memberFor(userId));
      this.memberObservers.set(userId, observer);
    }
    return observer;
  }

  async loadMemberList(): Promise<MemberList> {
    this.use(this.id);
    if (!this.memberList) {
      await this.sdk.loadMembersIfNeeded().catch((e) => console.warn("Couldn't load the member list", e));
      this.memberList = new ObservableMap(this.sdk.getMembers().map((m) => [m.userId, this.memberFor(m.userId, m)]));
    }
    return new MemberList(this.memberList);
  }

  async openTimeline(): Promise<Timeline> {
    this.use(this.id);
    if (!this._timeline) this._timeline = new Timeline(this.client, this.sdk);
    return this._timeline;
  }

  async sendEvent(type: string, content: Record<string, unknown>): Promise<string> {
    const res = await this.client.sendEvent(this.id, type as never, content as never);
    return res.event_id;
  }

  /** Marks everything in the room as read. */
  async clearUnread() {
    const events = this.sdk.getLiveTimeline().getEvents();
    const last = events[events.length - 1];
    if (last) await this.client.sendReadReceipt(last).catch(() => undefined);
  }

  /** Called once the user has left this room, so lists drop it without waiting for sync to say so. */
  onLeft?: () => void;

  async leave() {
    await this.client.leave(this.id);
    // Sync normally reports the new membership, but not always promptly (and sliding sync may just stop
    // mentioning the room), so take it out of the lists now.
    this.onLeft?.();
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this._timeline?.dispose();
    this._timeline = undefined;
  }
}

/** An invitation to a room the user hasn't answered yet. */
export class Invite extends EventEmitter<{ change: undefined }> {
  accepting = false;
  accepted = false;
  rejecting = false;
  rejected = false;

  constructor(readonly client: MatrixClient, readonly sdk: SdkRoom, readonly mediaRepository: MediaRepository) {
    super();
  }

  get isInvite(): true {
    return true;
  }

  get id(): string {
    return this.sdk.roomId;
  }

  get name(): string {
    return this.sdk.name || this.inviter?.name || "Invitation";
  }

  get avatarUrl(): string | null {
    return this.sdk.getMxcAvatarUrl() ?? (this.isDirectMessage ? this.inviter?.avatarUrl ?? null : null);
  }

  get avatarColorId(): string {
    return this.id;
  }

  get type(): string | undefined {
    return this.sdk.getType();
  }

  get timestamp(): number {
    return this.memberEvent?.getTs() ?? 0;
  }

  get canonicalAlias(): string | null {
    return this.sdk.getCanonicalAlias();
  }

  private get memberEvent(): MatrixEvent | undefined {
    return this.sdk.currentState.getStateEvents("m.room.member", this.client.getSafeUserId()) ?? undefined;
  }

  get isDirectMessage(): boolean {
    return !!this.memberEvent?.getContent().is_direct;
  }

  get inviter(): RoomMember | undefined {
    const sender = this.memberEvent?.getSender();
    if (!sender) return undefined;
    return new RoomMember(this.id, sender, this.sdk.getMember(sender) ?? undefined);
  }

  async accept() {
    this.accepting = true;
    this.emit("change");
    try {
      await this.client.joinRoom(this.id);
      this.accepted = true;
    } finally {
      this.accepting = false;
      this.emit("change");
    }
  }

  async reject() {
    this.rejecting = true;
    this.emit("change");
    try {
      await this.client.leave(this.id);
      this.rejected = true;
    } finally {
      this.rejecting = false;
      this.emit("change");
    }
  }
}
