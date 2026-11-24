import { useEffect, useReducer } from "react";

import { GroupCall, Member, ObservableValue, Platform, Room, RoomMember, Session } from "../../../../matrix";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { AvatarPile } from "../../../atoms/avatar/AvatarPile";
import { Text } from "../../../atoms/text/Text";
import { Tooltip } from "../../../atoms/tooltip/Tooltip";
import { useAsyncObservableValue } from "../../../hooks/useAsyncObservableValue";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { getAvatarHttpUrl } from "../../../utils/avatar";
import { getMxIdUsername } from "../../../utils/matrixUtils";

interface WorldTileMembersProps {
  session: Session;
  platform: Platform;
  /** The world's calls: every instance's (src/matrix/instances.ts), and a peer-to-peer call if there is one. */
  groupCalls: GroupCall[];
  room: Room;
}

/** Everyone in any of these calls, kept up to date. */
function useMembersOf(groupCalls: GroupCall[]): Member[] {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const refresh = () => forceUpdate();
    const stops = groupCalls.map((call) =>
      call.members.subscribe({ onReset: refresh, onAdd: refresh, onUpdate: refresh, onRemove: refresh })
    );
    return () => stops.forEach((stop) => stop());
  }, [groupCalls]);
  return groupCalls.flatMap((call) => [...call.members.values()]);
}

const maxAvatars = 5;

export function WorldTileMembers({ session, platform, groupCalls, room }: WorldTileMembersProps) {
  const allMembers = useMembersOf(groupCalls);
  const members = allMembers.reduce((filtered, member) => {
    if (!filtered.has(member.userId)) filtered.set(member.userId, member);
    return filtered;
  }, new Map<string, Member>());

  if (members.size === 0) return null;

  return (
    <AvatarPile>
      {Array.from(members.values())
        .slice(0, maxAvatars)
        .map(({ member }, index) => (
          <TileMemberAvatar
            key={member.userId}
            session={session}
            platform={platform}
            room={room}
            userId={member.userId}
            first={index === 0}
          />
        ))}
      {members.size > maxAvatars ? <Text variant="b3" type="span">{`+${members.size - maxAvatars}`}</Text> : undefined}
    </AvatarPile>
  );
}

/**
 * Buzzar: the world call's members come without a display name or avatar (Third Room #404), so read
 * them from the world room's member.
 */
function TileMemberAvatar({
  session,
  platform,
  room,
  userId,
  first,
}: {
  session: Session;
  platform: Platform;
  room: Room;
  userId: string;
  first: boolean;
}) {
  const { value: member } = useAsyncObservableValue<RoomMember | undefined>(
    async () => (await room.observeMember(userId)) ?? new ObservableValue<RoomMember | undefined>(undefined),
    [room, userId]
  );
  const name = member?.displayName || getMxIdUsername(userId);
  return (
    <Tooltip content={name} side="top">
      <Avatar
        style={first ? {} : { marginLeft: "calc(-1 * var(--av-xxs) / 4)" }}
        name={name}
        bgColor={`var(--usercolor${getIdentifierColorNumber(userId)})`}
        imageSrc={
          member?.avatarUrl ? getAvatarHttpUrl(member.avatarUrl, 20, platform, session.mediaRepository) : undefined
        }
        shape="circle"
        size="xxs"
      />
    </Tooltip>
  );
}
