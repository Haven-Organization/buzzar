import { useState, useRef, useCallback, ReactNode } from "react";

import { useIsMounted } from "./useIsMounted";

export function useToast() {
  const [{ toastShown, toastContent }, setToastState] = useState<{ toastShown: boolean; toastContent: ReactNode }>({
    toastShown: false,
    toastContent: "",
  });
  const isMounted = useIsMounted();
  const toastTimeoutRef = useRef<number>();

  const showToast = useCallback(
    // Buzzar: optional duration, for longer notices.
    (toastContent: ReactNode, durationMs = 2000) => {
      setToastState({
        toastShown: true,
        toastContent,
      });

      clearTimeout(toastTimeoutRef.current);

      toastTimeoutRef.current = window.setTimeout(() => {
        if (isMounted()) {
          setToastState((state) => ({ ...state, toastShown: false }));
        }
      }, durationMs);
    },
    [isMounted]
  );

  return { toastShown, toastContent, showToast };
}
