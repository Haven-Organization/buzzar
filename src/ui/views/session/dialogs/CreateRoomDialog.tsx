import { useState, FormEvent } from "react";
import { useSetAtom } from "jotai";

import { RoomVisibility } from "../../../../matrix";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { IconButton } from "../../../atoms/button/IconButton";
import { Button } from "../../../atoms/button/Button";
import { Switch } from "../../../atoms/button/Switch";
import { Text } from "../../../atoms/text/Text";
import { Dots } from "../../../atoms/loading/Dots";
import { useMatrix } from "../../../hooks/useMatrix";
import { waitToCreateRoom } from "../../../utils/matrixUtils";
import { activeChatsAtom } from "../../../state/overlayChat";
import CrossIC from "../../../../../res/ic/cross.svg";

interface CreateRoomDialogProps {
  requestClose: () => void;
}

/**
 * Buzzar: create a plain text chat room from the Chat list's + menu (Third Room #96), then open it. Private rooms are
 * invite-only; public ones anyone can join. Encryption is on by default.
 */
export function CreateRoomDialog({ requestClose }: CreateRoomDialogProps) {
  const { session } = useMatrix(true);
  const setActiveChat = useSetAtom(activeChatsAtom);

  const [isPublic, setIsPublic] = useState(false);
  const [encrypted, setEncrypted] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (creating) return;
    const form = evt.currentTarget;
    const name = (form.roomName.value as string).trim();
    const topic = (form.topic.value as string).trim();
    if (!name) return;

    setError(undefined);
    setCreating(true);
    try {
      const roomBeingCreated = session.createRoom({
        visibility: isPublic ? RoomVisibility.Public : RoomVisibility.Private,
        name,
        topic: topic || undefined,
        isEncrypted: encrypted,
        isFederationDisabled: false,
      });
      const room = await waitToCreateRoom(session, roomBeingCreated);
      if (!room) {
        setError(roomBeingCreated.error?.message ?? "Couldn't create the room.");
        setCreating(false);
        return;
      }
      setActiveChat({ type: "OPEN", roomId: room.id });
      requestClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-column">
      <Header
        className="shrink-0"
        left={<HeaderTitle size="lg">Create Room</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={requestClose} label="Close" />}
      />
      <form onSubmit={handleSubmit} className="grow flex flex-column gap-lg" style={{ padding: "var(--sp-md)" }}>
        <div className="flex flex-column gap-sm">
          <SettingTile label={<Label>Name</Label>}>
            <Input name="roomName" maxLength={255} autoFocus required placeholder="Room name" />
          </SettingTile>
          <SettingTile label={<Label>Topic</Label>}>
            <Input name="topic" maxLength={1000} placeholder="What's it about? (optional)" />
          </SettingTile>
          <SettingTile label={<Label>Public</Label>}>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            <Text variant="b3" color="surface-low">
              {isPublic ? "Anyone can find and join it." : "Invite only."}
            </Text>
          </SettingTile>
          <SettingTile label={<Label>Encrypted</Label>}>
            <Switch checked={encrypted} onCheckedChange={setEncrypted} />
            <Text variant="b3" color="surface-low">
              {encrypted
                ? "Only members can read messages. Can't be turned off later."
                : "Messages are readable by the servers in the room."}
            </Text>
          </SettingTile>
          {error && (
            <Text variant="b3" color="danger" weight="medium">
              {error}
            </Text>
          )}
        </div>
        <Button size="lg" type="submit" disabled={creating}>
          {creating && <Dots color="on-primary" />}
          {creating ? "Creating" : "Create Room"}
        </Button>
      </form>
    </div>
  );
}
