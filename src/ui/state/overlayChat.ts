import produce from "immer";
import { atom } from "jotai";

const baseOpenedChatAtom = atom<string | undefined>(undefined);

export const openedChatAtom = atom((get) => get(baseOpenedChatAtom));

type ActiveChatAction = {
  type: "OPEN" | "MINIMIZE" | "CLOSE";
  roomId: string;
  /** OPEN: scroll the chat to this message (e.g. from a notification). */
  eventId?: string;
};

/** Buzzar: a message the opened chat should scroll to and highlight, once it's loaded. */
export const chatJumpAtom = atom<{ roomId: string; eventId: string } | undefined>(undefined);

const baseActiveChats = atom(new Set<string>());

export const activeChatsAtom = atom<Set<string>, [ActiveChatAction], void>(
  (get) => get(baseActiveChats),
  (get, set, action) => {
    if (action.type === "OPEN") {
      set(
        baseActiveChats,
        produce(get(baseActiveChats), (draftChats) => {
          draftChats.add(action.roomId);
        })
      );
      set(baseOpenedChatAtom, action.roomId);
      if (action.eventId) set(chatJumpAtom, { roomId: action.roomId, eventId: action.eventId });
      return;
    }
    if (action.type === "MINIMIZE" && get(baseOpenedChatAtom) === action.roomId) {
      set(baseOpenedChatAtom, undefined);
      return;
    }
    if (action.type === "CLOSE") {
      set(
        baseActiveChats,
        produce(get(baseActiveChats), (draftChats) => {
          draftChats.delete(action.roomId);
        })
      );
      if (get(baseOpenedChatAtom) === action.roomId) set(baseOpenedChatAtom, undefined);
      return;
    }
  }
);
