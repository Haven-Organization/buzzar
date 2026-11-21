/**
 * Buzzar's Matrix layer (plan 02): small observable containers with the shapes the UI already uses
 * (get/subscribe values, and maps and lists with onAdd/onUpdate/onRemove/onReset handlers).
 */
export type SubscriptionHandle = () => void;

export class BaseObservable<H> {
  protected handlers = new Set<H>();

  subscribe(handler: H): SubscriptionHandle {
    this.handlers.add(handler);
    if (this.handlers.size === 1) this.onSubscribeFirst();
    return () => this.unsubscribe(handler);
  }

  unsubscribe(handler: H) {
    if (this.handlers.delete(handler) && this.handlers.size === 0) this.onUnsubscribeLast();
  }

  get hasSubscriptions() {
    return this.handlers.size !== 0;
  }

  protected onSubscribeFirst() {}
  protected onUnsubscribeLast() {}
}

export class BaseObservableValue<T> extends BaseObservable<(value: T) => void> {
  protected value: T;

  constructor(value: T) {
    super();
    this.value = value;
  }

  get(): T {
    return this.value;
  }

  protected emit(value: T) {
    for (const handler of [...this.handlers]) handler(value);
  }

  /** Resolves with the first value (now or later) that `predicate` accepts. */
  waitFor(predicate: (value: T) => boolean): Promise<T> & { promise: Promise<T>; dispose: () => void } {
    let unsubscribe: SubscriptionHandle | undefined;
    const promise = new Promise<T>((resolve) => {
      if (predicate(this.value)) return resolve(this.value);
      unsubscribe = this.subscribe((value) => {
        if (!predicate(value)) return;
        unsubscribe?.();
        resolve(value);
      });
    });
    return Object.assign(promise, { promise, dispose: () => unsubscribe?.() });
  }
}

export class ObservableValue<T> extends BaseObservableValue<T> {
  set(value: T) {
    if (value === this.value) return;
    this.value = value;
    this.emit(value);
  }

  /** Emits even when the value is the same object (it changed inside). */
  update(value: T = this.value) {
    this.value = value;
    this.emit(value);
  }
}

export interface IMapObserver<K, V> {
  onReset?(): void;
  onAdd?(key: K, value: V): void;
  onUpdate?(key: K, value: V, params?: unknown): void;
  onRemove?(key: K, value: V): void;
}

export class BaseObservableMap<K, V> extends BaseObservable<IMapObserver<K, V>> {
  protected map = new Map<K, V>();

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K) {
    return this.map.has(key);
  }

  get size() {
    return this.map.size;
  }

  keys() {
    return this.map.keys();
  }

  values() {
    return this.map.values();
  }

  entries() {
    return this.map.entries();
  }

  [Symbol.iterator]() {
    return this.map.entries();
  }

  protected each(call: (handler: IMapObserver<K, V>) => void) {
    for (const handler of [...this.handlers]) call(handler);
  }

  /** A live view of the entries whose value passes `filter`. */
  filterValues(filter: (value: V, key: K) => boolean): BaseObservableMap<K, V> {
    return new FilteredMap(this, filter);
  }

  /** A live list of the values, sorted. */
  sortValues(comparator: (a: V, b: V) => number): BaseObservableList<V> {
    return new SortedMapList(this, comparator);
  }
}

/** Derived from another map; recomputed whenever the source changes (the maps here are small). */
class FilteredMap<K, V> extends BaseObservableMap<K, V> {
  private stop?: SubscriptionHandle;

  constructor(private source: BaseObservableMap<K, V>, private filter: (value: V, key: K) => boolean) {
    super();
    this.recompute();
  }

  private recompute() {
    this.map = new Map([...this.source].filter(([key, value]) => this.filter(value, key)));
  }

  private refresh() {
    this.recompute();
    this.each((h) => h.onReset?.());
  }

  protected onSubscribeFirst() {
    const refresh = () => this.refresh();
    this.stop = this.source.subscribe({ onReset: refresh, onAdd: refresh, onUpdate: refresh, onRemove: refresh });
    this.recompute();
  }

  protected onUnsubscribeLast() {
    this.stop?.();
    this.stop = undefined;
  }

  get(key: K) {
    if (!this.stop) this.recompute();
    return this.map.get(key);
  }

  get size() {
    if (!this.stop) this.recompute();
    return this.map.size;
  }

  values() {
    if (!this.stop) this.recompute();
    return this.map.values();
  }

  [Symbol.iterator]() {
    if (!this.stop) this.recompute();
    return this.map.entries();
  }
}

export class ObservableMap<K, V> extends BaseObservableMap<K, V> {
  constructor(initial?: Iterable<[K, V]>) {
    super();
    if (initial) for (const [key, value] of initial) this.map.set(key, value);
  }

  add(key: K, value: V) {
    if (this.map.has(key)) return this.set(key, value);
    this.map.set(key, value);
    this.each((h) => h.onAdd?.(key, value));
  }

  set(key: K, value: V) {
    const existed = this.map.has(key);
    this.map.set(key, value);
    this.each((h) => (existed ? h.onUpdate?.(key, value) : h.onAdd?.(key, value)));
  }

  /** Tells observers a value changed in place. */
  update(key: K, params?: unknown) {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.each((h) => h.onUpdate?.(key, value, params));
    return true;
  }

  remove(key: K) {
    const value = this.map.get(key);
    if (value === undefined || !this.map.delete(key)) return false;
    this.each((h) => h.onRemove?.(key, value));
    return true;
  }

  reset(entries: Iterable<[K, V]> = []) {
    this.map = new Map(entries);
    this.each((h) => h.onReset?.());
  }

  /** Changes the map without telling observers; follow with `notifyChanged()` once a batch is done. */
  setSilently(key: K, value: V) {
    this.map.set(key, value);
  }

  removeSilently(key: K) {
    return this.map.delete(key);
  }

  /** Tells observers the map changed in ways they should re-read (one notification for any number of changes). */
  notifyChanged() {
    this.each((h) => h.onReset?.());
  }
}

export interface IListObserver<T> {
  onReset?(): void;
  onAdd?(index: number, value: T): void;
  onUpdate?(index: number, value: T, params?: unknown): void;
  onRemove?(index: number, value: T): void;
  onMove?(from: number, to: number, value: T): void;
}

export class BaseObservableList<T> extends BaseObservable<IListObserver<T>> {
  protected items: T[] = [];

  get length() {
    return this.items.length;
  }

  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

export class ObservableArray<T> extends BaseObservableList<T> {
  constructor(initial: T[] = []) {
    super();
    this.items = [...initial];
  }

  get array(): readonly T[] {
    return this.items;
  }

  append(value: T) {
    this.items.push(value);
    for (const handler of [...this.handlers]) handler.onAdd?.(this.items.length - 1, value);
  }

  update(index: number, value: T, params?: unknown) {
    if (index < 0 || index >= this.items.length) return;
    this.items[index] = value;
    for (const handler of [...this.handlers]) handler.onUpdate?.(index, value, params);
  }

  remove(index: number) {
    if (index < 0 || index >= this.items.length) return;
    const [value] = this.items.splice(index, 1);
    for (const handler of [...this.handlers]) handler.onRemove?.(index, value);
  }

  move(from: number, to: number) {
    if (from < 0 || from >= this.items.length || to < 0 || to >= this.items.length) return;
    const [value] = this.items.splice(from, 1);
    this.items.splice(to, 0, value);
    for (const handler of [...this.handlers]) handler.onMove?.(from, to, value);
  }

  reset(items: T[]) {
    this.items = [...items];
    for (const handler of [...this.handlers]) handler.onReset?.();
  }
}

/** A map's values as a sorted list; re-sorted whenever the map changes. */
class SortedMapList<K, V> extends BaseObservableList<V> {
  private stop?: SubscriptionHandle;

  constructor(private source: BaseObservableMap<K, V>, private comparator: (a: V, b: V) => number) {
    super();
    this.recompute();
  }

  private recompute() {
    this.items = [...this.source.values()].sort(this.comparator);
  }

  protected onSubscribeFirst() {
    const refresh = () => {
      this.recompute();
      for (const handler of [...this.handlers]) handler.onReset?.();
    };
    this.stop = this.source.subscribe({ onReset: refresh, onAdd: refresh, onUpdate: refresh, onRemove: refresh });
    this.recompute();
  }

  protected onUnsubscribeLast() {
    this.stop?.();
    this.stop = undefined;
  }

  get length() {
    if (!this.stop) this.recompute();
    return this.items.length;
  }

  [Symbol.iterator]() {
    if (!this.stop) this.recompute();
    return this.items[Symbol.iterator]();
  }
}

/** Minimal typed event emitter; `disposableOn` returns a function that stops listening. */
export class EventEmitter<E extends Record<string, unknown> = Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<(value: never) => void>>();

  on<K extends keyof E>(name: K, callback: (value: E[K]) => void) {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(callback as (value: never) => void);
  }

  off<K extends keyof E>(name: K, callback: (value: E[K]) => void) {
    this.listeners.get(name)?.delete(callback as (value: never) => void);
  }

  disposableOn<K extends keyof E>(name: K, callback: (value: E[K]) => void): SubscriptionHandle {
    this.on(name, callback);
    return () => this.off(name, callback);
  }

  emit<K extends keyof E>(name: K, value?: E[K]) {
    for (const callback of [...(this.listeners.get(name) ?? [])]) (callback as (value: unknown) => void)(value);
  }
}
