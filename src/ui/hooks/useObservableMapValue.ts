import { useEffect, useState } from "react";

import { BaseObservableMap } from "../../matrix";

/**
 * One value of an observable map, redrawing only when that value changes (is added, removed or replaced). Copying
 * the whole map on every change redrew its component (the world view, the overlay) for every event in any room.
 * `find` (instead of a key) is re-run on every change, for lookups like a room by alias.
 */
export function useObservableMapValue<K, V>(
  map: BaseObservableMap<K, V>,
  key: K | undefined,
  find?: (map: BaseObservableMap<K, V>) => V | undefined
): V | undefined {
  const lookup = () => (find ? find(map) : key === undefined ? undefined : map.get(key));
  const [state, setState] = useState(() => ({ key, value: lookup() }));
  useEffect(() => {
    const read = () => setState({ key, value: lookup() });
    read();
    return map.subscribe({ onReset: read, onAdd: read, onUpdate: read, onRemove: read });
    // `find` is recreated each render; what it looks up is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  // Buzzar: when the key has just changed, the stored value is still the old key's until the effect above runs: look
  // the new one up now. Returning the old one for a render made the world view load the previous world with the next
  // world's instance (and then load again).
  return state.key === key ? state.value : lookup();
}
