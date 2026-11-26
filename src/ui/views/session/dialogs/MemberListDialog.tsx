import { useState, ReactNode, useReducer } from "react";

import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { ALWAYS_SHOW_AVATARS_KEY, parseUserIdList } from "../../../../engine/avatar/avatarCulling.common";
import { Member, Room, RoomMember } from "../../../../matrix";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import CrossIC from ".././../../../../res/ic/cross.svg";
import AddUserIC from ".././../../../../res/ic/add-user.svg";
import VolumeUpIC from ".././../../../../res/ic/volume-up.svg";
import { MemberTile } from "../../components/member-tile/MemberTile";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { Text } from "../../../atoms/text/Text";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { useRoomMembers } from "../../../hooks/useRoomMembers";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";
import { useMatrix } from "../../../hooks/useMatrix";
import { DropdownMenu } from "../../../atoms/menu/DropdownMenu";
import MoreHorizontalIC from "../../../../../res/ic/more-horizontal.svg";
import ChevronBottomIC from "../../../../../res/ic/chevron-bottom.svg";
import ChevronRightIC from "../../../../../res/ic/chevron-right.svg";
import { DropdownMenuItem } from "../../../atoms/menu/DropdownMenuItem";
import { Category } from "../../components/category/Category";
import { CategoryHeader } from "../../components/category/CategoryHeader";
import { Icon } from "../../../atoms/icon/Icon";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { Dots } from "../../../atoms/loading/Dots";
import { isPeerMuted, toggleMutePeer } from "../../../../engine/network/network.main";
import { useBlockedUsers, useHeldBack } from "../../../hooks/useBlockedUsers";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { InviteDialog } from "./InviteDialog";
import { useCalls } from "../../../hooks/useCalls";
import { useRoomCall } from "../../../hooks/useRoomCall";
import { BadgeWrapper } from "../../../atoms/badge/BadgeWrapper";
import { NotificationBadge } from "../../../atoms/badge/NotificationBadge";
import { useAnimationFrame } from "../nametags/Nametags";
import { setPowerLevel } from "../../../utils/matrixUtils";

interface MemberListDialogProps {
  room: Room;
  requestClose?: () => void;
  /** Buzzar: shown inside the People screen (no title or close button, fills the space). */
  embedded?: boolean;
}

type SpeakingRoomMember = Member & { volumeDetector: { isSpeaking: boolean } };

function ActiveMemberTile({
  members,
  renderTile,
  isSpeaking,
}: {
  members: RoomMember[];
  renderTile: (member: RoomMember, isSpeaking: boolean) => JSX.Element;
  isSpeaking: (userId: string) => boolean;
}) {
  const [, forceUpdate] = useReducer((state) => state + 1, 0);

  useAnimationFrame(() => {
    forceUpdate();
  });

  return <>{members.map((member) => renderTile(member, isSpeaking(member.userId)))}</>;
}

export function MemberListDialog({ room, requestClose, embedded }: MemberListDialogProps) {
  const { session, platform } = useMatrix(true);

  const { active: callMembersActive, invited, joined, leaved, banned } = useRoomMembers(room) ?? {};
  const [inviteOpen, setInviteOpen] = useState(false);

  const calls = useCalls(session);
  const groupCall = useRoomCall(calls, room.id);

  // Buzzar: groupCall.members only contains *other* participants, so you always appeared as
  // "Disconnected" in your own member list. Count yourself as connected while you're in the world's call.
  const self = joined?.find((member) => member.userId === session.userId);
  // Buzzar: call members carry a bare RoomMember (often no display name or avatar); show the room's own.
  const callActive = callMembersActive?.map((m) => joined?.find((j) => j.userId === m.userId) ?? m);
  const active = groupCall?.hasJoined && self ? [self, ...(callActive ?? [])] : callActive;

  const isWorld = room.type === "org.matrix.msc3815.world";
  const filteredJoined = joined?.filter((member) => !active?.find((m) => m.userId === member.userId));

  const { canDoAction, getPowerLevel, isCreator } = usePowerLevels(room);
  const myPL = getPowerLevel(session.userId);
  const canInvite = canDoAction("invite", myPL);
  const canKick = canDoAction("kick", myPL);
  const canBan = canDoAction("ban", myPL);

  const [activeCat, setActiveCat] = useState(true);
  const [joinedCat, setJoinedCat] = useState(true);
  const [invitedCat, setInvitedCat] = useState(true);
  const [leaveCat, setLeaveCat] = useState(true);
  const [banCat, setBanCat] = useState(true);

  const invite = (roomId: string, userId: string) => session.hsApi.invite(roomId, userId);
  const disInvite = (roomId: string, userId: string) => session.hsApi.kick(roomId, userId);
  const kick = (roomId: string, userId: string) => session.hsApi.kick(roomId, userId);
  const ban = (roomId: string, userId: string) => session.hsApi.ban(roomId, userId);
  const unban = (roomId: string, userId: string) => session.hsApi.unban(roomId, userId);
  const makeMember = (roomId: string, userId: string) => setPowerLevel(session, roomId, userId, 0);
  const makeMod = (roomId: string, userId: string) => setPowerLevel(session, roomId, userId, 50);
  const makeAdmin = (roomId: string, userId: string) => setPowerLevel(session, roomId, userId, 100);

  const engine = useMainThreadContext();
  const toggleMute = (userId: string) => toggleMutePeer(engine, userId);

  const callMembers = Array.from(new Map(groupCall?.members).values());

  const isSpeaking = (userId: string) => {
    const memberCall = callMembers.find((m) => m.userId === userId && m.isConnected);
    const volumeDetector =
      (memberCall && (memberCall as SpeakingRoomMember).volumeDetector) ||
      (memberCall?.remoteMedia?.userMedia &&
        ((memberCall as SpeakingRoomMember).volumeDetector = (platform.mediaDevices as any).createVolumeMeasurer(
          memberCall?.remoteMedia?.userMedia,
          () => {}
        )));

    return volumeDetector?.isSpeaking;
  };

  // Buzzar: blocking (Matrix's ignore list) replaces the old Ignore, which only lasted until you left the world.
  const { blocked, block, unblock } = useBlockedUsers();
  const heldBack = useHeldBack(room.id);
  const heldBackNote = (userId: string) => {
    if (blocked.includes(userId)) return "Blocked";
    const reason = heldBack?.reasonOf(userId);
    if (reason && "banned" in reason)
      return `Banned by this world's ban list${reason.banned.reason ? `: ${reason.banned.reason}` : ""}`;
    return undefined;
  };

  const [alwaysShowStored, setAlwaysShow] = useLocalStorage<unknown>(ALWAYS_SHOW_AVATARS_KEY, []);
  const alwaysShow = parseUserIdList(alwaysShowStored);
  const toggleAlwaysShow = (userId: string) =>
    setAlwaysShow(alwaysShow.includes(userId) ? alwaysShow.filter((id) => id !== userId) : [...alwaysShow, userId]);

  const renderMemberTile = (member: RoomMember, isSpeaking?: boolean) => {
    const { userId, name, avatarUrl, membership } = member;
    const userPL = getPowerLevel(userId);

    const menuItems: ReactNode[] = [
      // todo: how to get this to rerender right away?
      <DropdownMenuItem key="mute" onSelect={() => toggleMute(userId)}>
        {isPeerMuted(engine, userId) ? "Unmute" : "Mute"}
      </DropdownMenuItem>,
      <DropdownMenuItem
        key="block"
        onSelect={() => (blocked.includes(userId) ? unblock(userId) : block(userId, name)).catch(() => undefined)}
      >
        {blocked.includes(userId) ? "Unblock" : "Block"}
      </DropdownMenuItem>,
      // Buzzar: never hidden by avatar culling (Settings → Graphics → Avatar Culling).
      <DropdownMenuItem key="show-avatar" onSelect={() => toggleAlwaysShow(userId)}>
        {alwaysShow.includes(userId) ? "Stop Always Showing Avatar" : "Show Avatar"}
      </DropdownMenuItem>,
    ];
    switch (membership) {
      case "join":
        if (canKick && myPL > userPL)
          menuItems.push(
            <DropdownMenuItem key="kick" onSelect={() => kick(room.id, userId)}>
              Kick
            </DropdownMenuItem>
          );
        if (canBan && myPL > userPL)
          menuItems.push(
            <DropdownMenuItem key="ban" onSelect={() => ban(room.id, userId)}>
              Ban
            </DropdownMenuItem>
          );
        // Creators (room version 12+) aren't in the power levels and can't be demoted.
        if (myPL >= 100 && !isCreator(userId)) {
          menuItems.push(
            <DropdownMenuItem key="make-member" disabled={userPL === 0} onSelect={() => makeMember(room.id, userId)}>
              Make Member
            </DropdownMenuItem>
          );
          menuItems.push(
            <DropdownMenuItem key="make-mod" disabled={userPL === 50} onSelect={() => makeMod(room.id, userId)}>
              Make Moderator
            </DropdownMenuItem>
          );
          menuItems.push(
            <DropdownMenuItem key="make-admin" disabled={userPL === 100} onSelect={() => makeAdmin(room.id, userId)}>
              Make Admin
            </DropdownMenuItem>
          );
        }
        break;
      case "ban":
        if (canKick && myPL > userPL)
          menuItems.push(
            <DropdownMenuItem key="unban" onSelect={() => unban(room.id, userId)}>
              Unban
            </DropdownMenuItem>
          );
        break;
      case "invite":
        if (canKick && myPL > userPL)
          menuItems.push(
            <DropdownMenuItem key="disinvite" onSelect={() => disInvite(room.id, userId)}>
              Disinvite
            </DropdownMenuItem>
          );
        break;
      case "leave":
        if (canInvite)
          menuItems.push(
            <DropdownMenuItem key="invite" onSelect={() => invite(room.id, userId)}>
              Invite
            </DropdownMenuItem>
          );
        break;
    }

    return (
      <MemberTile
        key={userId}
        avatar={
          <BadgeWrapper
            badge={
              isSpeaking ? (
                <NotificationBadge
                  variant="secondary"
                  content={<Icon color="on-secondary" size="xs" src={VolumeUpIC} />}
                />
              ) : null
            }
          >
            <Avatar
              shape="circle"
              name={name}
              imageSrc={avatarUrl ? getAvatarHttpUrl(avatarUrl, 40, platform, session.mediaRepository) : undefined}
              bgColor={`var(--usercolor${getIdentifierColorNumber(userId)})`}
            />
          </BadgeWrapper>
        }
        content={
          <>
            <Text className="truncate" weight="medium">
              {name}
            </Text>
            <Text className="truncate" color="surface-low" variant="b3">
              {userId}
            </Text>
            {heldBackNote(userId) && (
              <Text className="truncate" color="danger" variant="b3">
                {heldBackNote(userId)}
              </Text>
            )}
          </>
        }
        options={
          menuItems.length > 0 &&
          userId !== session.userId && (
            <DropdownMenu content={menuItems}>
              <IconButton variant="surface-low" label="Options" iconSrc={MoreHorizontalIC} />
            </DropdownMenu>
          )
        }
      />
    );
  };

  return (
    <>
      {(!embedded || canDoAction("invite", myPL)) && (
        <Header
          left={embedded ? <span /> : <HeaderTitle size="lg">Members</HeaderTitle>}
          right={
            <div className="flex gap-sm">
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <InviteDialog roomId={room.id} requestClose={() => setInviteOpen(false)} />
              </Dialog>
              {canDoAction("invite", myPL) &&
                (embedded ? (
                  <Button size="sm" fill="outline" onClick={() => setInviteOpen(true)}>
                    Invite to World
                  </Button>
                ) : (
                  <IconButton iconSrc={AddUserIC} onClick={() => setInviteOpen(true)} label="Invite" />
                ))}
              {!embedded && requestClose && <IconButton iconSrc={CrossIC} onClick={requestClose} label="Close" />}
            </div>
          }
        />
      )}
      <div className="flex" style={embedded ? { flexGrow: 1, minHeight: 0 } : { height: "600px" }}>
        {joined === undefined ? (
          <div className="grow flex items-center justify-center">
            <Dots size="lg" />
          </div>
        ) : (
          <Scroll type="hover" style={{ paddingBottom: "var(--sp-lg)" }}>
            <div className="flex flex-column gap-sm">
              {!!invited?.length && (
                <Category
                  header={
                    <CategoryHeader
                      title="Invited"
                      onClick={() => setInvitedCat(!invitedCat)}
                      after={<Icon src={invitedCat ? ChevronBottomIC : ChevronRightIC} />}
                    />
                  }
                >
                  {invitedCat && invited.map((member) => renderMemberTile(member))}
                </Category>
              )}

              {!!active?.length && (
                <Category
                  header={
                    <CategoryHeader
                      title="Connected"
                      onClick={() => setActiveCat(!activeCat)}
                      after={<Icon src={activeCat ? ChevronBottomIC : ChevronRightIC} />}
                    />
                  }
                >
                  {activeCat && (
                    <ActiveMemberTile members={active} renderTile={renderMemberTile} isSpeaking={isSpeaking} />
                  )}
                </Category>
              )}

              {!!filteredJoined?.length && (
                <Category
                  header={
                    <CategoryHeader
                      title={isWorld ? "Disconnected" : "Joined"}
                      onClick={() => setJoinedCat(!joinedCat)}
                      after={<Icon src={joinedCat ? ChevronBottomIC : ChevronRightIC} />}
                    />
                  }
                >
                  {joinedCat && filteredJoined.map((member) => renderMemberTile(member))}
                </Category>
              )}

              {!!banned?.length && (
                <Category
                  header={
                    <CategoryHeader
                      title="Banned"
                      onClick={() => setBanCat(!banCat)}
                      after={<Icon src={banCat ? ChevronBottomIC : ChevronRightIC} />}
                    />
                  }
                >
                  {banCat && banned.map((member) => renderMemberTile(member))}
                </Category>
              )}
              {!!leaved?.length && (
                <Category
                  header={
                    <CategoryHeader
                      title="Archived"
                      onClick={() => setLeaveCat(!leaveCat)}
                      after={<Icon src={leaveCat ? ChevronBottomIC : ChevronRightIC} />}
                    />
                  }
                >
                  {leaveCat && leaved.map((member) => renderMemberTile(member))}
                </Category>
              )}
            </div>
          </Scroll>
        )}
      </div>
    </>
  );
}
