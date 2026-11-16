/**
 * Buzzar: which call device backs each network peer.
 *
 * The network layer keys peers by Matrix user ID, but a user can have several devices in a world call, often
 * including stale ones (a closed tab or crashed browser stays in the call until its membership expires). Third
 * Room added/removed the peer for whichever device changed, so a stale device leaving removed the user's live
 * peer: their avatar vanished for everyone else, and coming back created a duplicate (two name tags).
 *
 * `reconcilePeerDevices` picks one connected device per user, keeps it as long as it stays connected, and
 * reports which peers to remove and add. The local user's other devices are never peers: their peer ID would
 * be our own user ID.
 */

export interface PeerDeviceCandidate {
  userId: string;
  deviceId: string;
  /** Connected with an open data channel. */
  usable: boolean;
}

export interface PeerDeviceChanges<M> {
  /** User IDs whose peer must be removed (before `add`). */
  remove: string[];
  /** Devices to add as the peer for their user. */
  add: M[];
}

/** Updates `current` (user ID → device ID) in place to match `members`, returning what changed. */
export function reconcilePeerDevices<M extends PeerDeviceCandidate>(
  current: Map<string, string>,
  members: Iterable<M>,
  ownUserId: string
): PeerDeviceChanges<M> {
  const usableByUser = new Map<string, M[]>();
  for (const member of members) {
    if (!member.usable || member.userId === ownUserId) continue;
    const list = usableByUser.get(member.userId);
    if (list) list.push(member);
    else usableByUser.set(member.userId, [member]);
  }

  const remove: string[] = [];
  const add: M[] = [];

  for (const [userId, deviceId] of current) {
    const devices = usableByUser.get(userId);
    if (devices?.some((m) => m.deviceId === deviceId)) continue;
    remove.push(userId);
    current.delete(userId);
  }

  for (const [userId, devices] of usableByUser) {
    if (current.has(userId)) continue;
    const chosen = devices[devices.length - 1];
    current.set(userId, chosen.deviceId);
    add.push(chosen);
  }

  return { remove, add };
}
