export enum NetworkAction {
  Create,
  Delete,
  UpdateChanged,
  UpdateSnapshot,
  FullChanged,
  FullSnapshot,
  Prefab,
  InformPlayerNetworkId,
  NewPeerSnapshot,
  RemoveOwnershipMessage,
  UpdateNetworkId,
  BinaryScriptMessage,
  StringScriptMessage,
  InformXRMode,
  /** Buzzar: a peer sat on (seat node index + 1) or stood up (0). See plugins/seats. */
  HavenSeat,
  /** Buzzar: a peer's posture (0 standing, 1 crouching, 2 prone). See plugins/posture. */
  HavenPosture,
  /** Buzzar: "I'm getting updates for your entities but never got them created; please resend your snapshot." */
  HavenResendSnapshot,
  /** Buzzar: "my avatar just changed": peers show the loading placeholder and look it up again right away. */
  HavenAvatarChanged,
  /** Buzzar: "object <old network ID> is mine now, as <new network ID>" (grab hand-off in place). See ownership. */
  HavenTakeOwnership,
}

export const UnreliableNetworkActions = [NetworkAction.UpdateChanged, NetworkAction.UpdateSnapshot];
