import { InteractableType } from "../../engine/resource/schema";

export const InteractionMessageType = "interaction";

export enum InteractableAction {
  Focus = "focus",
  Unfocus = "unfocus",
  Interact = "interact",
  Grab = "grab",
  Release = "release",
}

export interface InteractionMessage {
  type: typeof InteractionMessageType;
  action: InteractableAction;
  interactableType?: InteractableType;
  name?: string;
  held?: boolean;
  /** Buzzar: it can't be thrown (a shared screen's handle). */
  noThrow?: boolean;
  /** Buzzar: Delete works on it and does this (e.g. "Stop Sharing"). */
  deleteLabel?: string;
  peerId?: string;
  ownerId?: string;
  uri?: string;
}
