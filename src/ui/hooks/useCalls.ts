import { Session } from "../../matrix";
import { useObservableMap } from "./useObservableMap";

export function useCalls(session: Session) {
  return useObservableMap(() => session.callHandler.calls, [session]);
}
