import { atom } from "jotai";

import { ThingKeys } from "../../plugins/thirdroom/thirdroom.common";

/** Buzzar: the Things on your number keys (undefined until loaded from account data; see utils/thingKeys). */
export const thingKeysAtom = atom<ThingKeys | undefined>(undefined);
