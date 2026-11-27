import { atom } from "jotai";

import { ItemKeys } from "../../plugins/thirdroom/thirdroom.common";

/** Buzzar: the Items on your number keys (undefined until loaded from account data; see utils/itemKeys). */
export const itemKeysAtom = atom<ItemKeys | undefined>(undefined);
