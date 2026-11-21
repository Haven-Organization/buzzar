import { useEffect, useState } from "react";

import { ObservableMap, Room, RoomMember } from "../../matrix";
import { useIsMounted } from "./useIsMounted";
import { useMatrix } from "./useMatrix";
import { getRoomCall } from "../utils/matrixUtils";

interface MembersType {
  invited: RoomMember[];
  joined: RoomMember[];
  leaved: RoomMember[];
  banned: RoomMember[];
}

export function useRoomMembers(room: Room) {
  const { session } = useMatrix(true);
  const [members, setMembers] = useState<MembersType>();
  const [activeMembers, setActiveMembers] = useState<RoomMember[]>([]);
  const isMounted = useIsMounted();

  useEffect(() => {
    const getMembers = (m: ObservableMap<string, RoomMember>) => {
      const members: MembersType = {
        invited: [],
        joined: [],
        leaved: [],
        banned: [],
      };

      for (const [, member] of m) {
        if (member.membership === "invite") members.invited.push(member);
        else if (member.membership === "join") members.joined.push(member);
        else if (member.membership === "leave") members.leaved.push(member);
        else if (member.membership === "ban") members.banned.push(member);
      }

      return members;
    };

    let unsubscribeMemberListObservable: () => void | undefined;

    room.loadMemberList().then((mList) => {
      if (!isMounted()) return;
      const { members } = mList;
      setMembers(getMembers(members));

      unsubscribeMemberListObservable = members.subscribe({
        onReset: () => setMembers(getMembers(members)),
        onAdd: () => setMembers(getMembers(members)),
        onUpdate: () => setMembers(getMembers(members)),
        onRemove: () => setMembers(getMembers(members)),
      });
    });

    const groupCall = getRoomCall(session.callHandler.calls, room.id);
    let unsubscribeCallMemberListObservable: () => void | undefined;

    if (groupCall) {
      const getActiveMembers = () => {
        const activeMembers = new Map<string, RoomMember>();

        for (const [, callMember] of groupCall.members) {
          const member = callMember.member;
          // Buzzar: a call membership outlives closed tabs and crashed browsers (until it expires), so while
          // we're in the call only count people we're actually connected to. Our own other devices don't count;
          // the member list adds us itself. Outside the call there are no connections, so list the memberships.
          if (member.userId === session.userId) continue;
          if (groupCall.hasJoined && !callMember.isConnected) continue;
          if (!activeMembers.has(member.userId)) {
            activeMembers.set(member.userId, member);
          }
        }

        return Array.from(activeMembers.values());
      };

      unsubscribeCallMemberListObservable = groupCall.members.subscribe({
        onReset: () => setActiveMembers(getActiveMembers()),
        onAdd: () => setActiveMembers(getActiveMembers()),
        onUpdate: () => setActiveMembers(getActiveMembers()),
        onRemove: () => setActiveMembers(getActiveMembers()),
      });

      setActiveMembers(getActiveMembers());
    }

    return () => {
      unsubscribeMemberListObservable?.();
      unsubscribeCallMemberListObservable?.();
    };
  }, [room, isMounted, session]);

  return { ...members, active: activeMembers };
}
