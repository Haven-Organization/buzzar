import { BaseObservableValue, ObservableValue } from "../../matrix";
import { useObservableValue } from "./useObservableValue";
import { useAsync } from "./useAsync";

interface UseAsyncObservableReturn<T> {
  loading: boolean;
  error?: any;
  value?: T | undefined;
}

export function useAsyncObservableValue<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promiseFactory: () => Promise<BaseObservableValue<any>>,
  deps: unknown[]
): UseAsyncObservableReturn<T> {
  const { loading, error, value: observable } = useAsync(promiseFactory, deps);

  const value = useObservableValue<T | undefined>(
    () => observable || new ObservableValue<T | undefined>(undefined),
    [observable]
  );

  return { loading, error, value };
}
