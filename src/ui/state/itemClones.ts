import { atom } from "jotai";

import { ItemClone } from "../../plugins/thirdroom/thirdroom.common";

/** Buzzar: your cloned Items (undefined until loaded from account data; see utils/itemClones). */
export const itemClonesAtom = atom<ItemClone[] | undefined>(undefined);
