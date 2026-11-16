import { atom } from "jotai";

/** Buzzar: a one-off notice to show over the world (e.g. "this world's script wasn't run"). */
export const worldNoticeAtom = atom<{ id: number; text: string } | undefined>(undefined);

let nextId = 1;
export const makeWorldNotice = (text: string) => ({ id: nextId++, text });
