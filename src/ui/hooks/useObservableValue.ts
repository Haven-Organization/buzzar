import { BaseObservableValue } from "../../matrix";
import { useObservable } from "./useObservable";

export function useObservableValue<T>(observableFactory: () => BaseObservableValue<T>, deps: unknown[]): T {
  return useObservable(
    observableFactory,
    (update) => update,
    (observable) => observable.get(),
    deps
  );
}
