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
}

export const UnreliableNetworkActions = [NetworkAction.UpdateChanged, NetworkAction.UpdateSnapshot];
