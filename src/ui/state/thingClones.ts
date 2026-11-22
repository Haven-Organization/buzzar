import { atom } from "jotai";

import { ThingClone } from "../../plugins/thirdroom/thirdroom.common";

/** Buzzar: your cloned Things (undefined until loaded from account data; see utils/thingClones). */
export const thingClonesAtom = atom<ThingClone[] | undefined>(undefined);
