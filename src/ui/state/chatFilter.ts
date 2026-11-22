import { atomWithStorage } from "jotai/utils";

/** Buzzar: the Chat and Notifications lists' filters: everything, or only what's unread. Per device. */
export type ListFilter = "all" | "unread";
export type ChatFilter = ListFilter;

/** Third Room #456: Chat can show only chats with unread messages. */
export const chatFilterAtom = atomWithStorage<ListFilter>("buzzar.chatFilter", "all");

export const notificationsFilterAtom = atomWithStorage<ListFilter>("buzzar.notificationsFilter", "all");
