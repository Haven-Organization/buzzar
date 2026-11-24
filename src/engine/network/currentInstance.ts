/**
 * Buzzar: which world instance (src/matrix/instances.ts) this device is in, for the interface (the Instances list,
 * links to your instance). Set when a LiveKit world call is joined; undefined otherwise.
 */
export interface CurrentInstance {
  roomId: string;
  instance: string;
}

let current: CurrentInstance | undefined;
const listeners = new Set<() => void>();

export function getCurrentInstance(): CurrentInstance | undefined {
  return current;
}

export function setCurrentInstance(value: CurrentInstance | undefined) {
  current = value;
  for (const listener of listeners) listener();
}

export function onCurrentInstanceChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
