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
}

export const UnreliableNetworkActions = [NetworkAction.UpdateChanged, NetworkAction.UpdateSnapshot];
