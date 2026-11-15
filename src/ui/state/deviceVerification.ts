import { atom } from "jotai";

import type { DeviceVerificationStatus } from "../utils/deviceVerification";

/** Buzzar: whether this device is verified for end-to-end encryption, and whether the verify dialog is open. */
export const deviceVerificationAtom = atom<{ status: DeviceVerificationStatus | "checking"; open: boolean }>({
  status: "checking",
  open: false,
});
