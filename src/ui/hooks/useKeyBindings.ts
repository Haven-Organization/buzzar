import { useEffect, useState } from "react";

import { getKeyBindings, keyLabel, onKeyBindings } from "../../engine/input/keyBindings";

/** Buzzar (Third Room #382): the current key for every action (key codes), updated when they're rebound. */
export function useKeyBindings(): Record<string, string> {
  const [bindings, setBindings] = useState(getKeyBindings);
  useEffect(() => onKeyBindings(() => setBindings(getKeyBindings())), []);
  return bindings;
}

/** The label of an action's key (e.g. "M"), updated when it's rebound. */
export function useActionKeyLabel(id: string): string {
  return keyLabel(useKeyBindings()[id] ?? "");
}
