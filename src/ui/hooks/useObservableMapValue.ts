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
  const [value, setValue] = useState(lookup);
  useEffect(() => {
    const read = () => setValue(lookup());
    read();
    return map.subscribe({ onReset: read, onAdd: read, onUpdate: read, onRemove: read });
    // `find` is recreated each render; what it looks up is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return value;
}
