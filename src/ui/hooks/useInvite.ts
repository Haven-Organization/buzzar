import { Invite, Session } from "../../matrix";
import { useObservableMapValue } from "./useObservableMapValue";

export function useInvite(session: Session, roomId: string | undefined): Invite | undefined {
  return useObservableMapValue(session.invites, roomId);
}
