import { atomWithStorage } from "jotai/utils";

/** Buzzar: the Chat list's filter (third room #456): every chat, or only those with unread messages. Per device. */
export type ChatFilter = "all" | "unread";

export const chatFilterAtom = atomWithStorage<ChatFilter>("buzzar.chatFilter", "all");
