/**
 * Buzzar: a world's instances (src/matrix/instances.ts), like VRChat's: separate copies of the world, each with its
 * own players, voices and objects (chat is shared). Join any of them, copy a link to one, or start a new one, named
 * or not.
 */
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Room } from "../../../../matrix";
import {
  cleanInstanceName,
  instanceName,
  MAX_INSTANCE_NAME,
  newInstanceId,
  WorldInstance,
} from "../../../../matrix/instances";
import { callMethodOverride } from "../../../../matrix/callMethod";
import { getCurrentInstance, onCurrentInstanceChanged } from "../../../../engine/network/currentInstance";
import { Button } from "../../../atoms/button/Button";
import { IconButton } from "../../../atoms/button/IconButton";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Input } from "../../../atoms/input/Input";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { Scroll } from "../../../atoms/scroll/Scroll";
import { useMatrix } from "../../../hooks/useMatrix";
import { useMemberDisplayName } from "../../../hooks/useMemberDisplayName";
import { copyToClipboard } from "../../../utils/common";
import { roomIdToAlias } from "../../../utils/matrixUtils";
import { worldLink } from "../../../utils/worldDirectory";
import { EnterWorldButton } from "./WorldPreview";
import CrossIC from "../../../../../res/ic/cross.svg";

/** How often the list refreshes while it's open (ms). */
const REFRESH_MS = 4000;
/** Names shown per instance before "and N more". */
const NAMES_SHOWN = 3;

function useWorldInstances(room: Room, active: boolean) {
  const { session } = useMatrix(true);
  const [instances, setInstances] = useState<WorldInstance[]>();
  const [cap, setCap] = useState<number>();
  const [usesLiveKit, setUsesLiveKit] = useState<boolean>();

  const refresh = useCallback(async () => {
    const handler = session.callHandler;
    const [list, max, recommended] = await Promise.all([
      handler.worldInstances(room.id),
      handler.instanceCap(room.id),
      handler.recommendedMethod(room.id),
    ]);
    setInstances(list);
    setCap(max);
    setUsesLiveKit((callMethodOverride() ?? recommended) === "livekit" || list.length > 0);
  }, [session, room.id]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  return { instances, cap, usesLiveKit };
}

function useCurrentInstance(roomId: string) {
  const [current, setCurrent] = useState(() => getCurrentInstance());
  useEffect(() => onCurrentInstanceChanged(() => setCurrent(getCurrentInstance())), []);
  return current?.roomId === roomId ? current.instance : undefined;
}

export function InstancesDialog({
  room,
  open,
  onOpenChange,
}: {
  room: Room;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { session } = useMatrix(true);
  const { instances, cap, usesLiveKit } = useWorldInstances(room, open);
  const current = useCurrentInstance(room.id);
  const displayName = useMemberDisplayName(room);
  const [name, setName] = useState("");
  const [newId, setNewId] = useState(() => newInstanceId());
  const [copied, setCopied] = useState<string>();

  // A fresh number each time the dialog opens, and whenever the name changes.
  useEffect(() => {
    if (open) setNewId(newInstanceId(name));
  }, [open, name]);

  const linkTo = (id: string) =>
    `${worldLink(roomIdToAlias(session.rooms, room.id) ?? room.id)}?instance=${encodeURIComponent(id)}`;

  const copyLink = (id: string) => {
    copyToClipboard(linkTo(id));
    setCopied(id);
    window.setTimeout(() => setCopied((value) => (value === id ? undefined : value)), 2000);
  };

  const close = () => onOpenChange(false);

  let body;
  if (usesLiveKit === false) {
    body = (
      <Text variant="b2">
        This world uses peer-to-peer calls, which have no instances: everyone who enters is together. A world can switch
        to LiveKit calls in World Settings → Calls.
      </Text>
    );
  } else {
    const people = (instance: WorldInstance) => {
      const names = [...new Set(instance.userIds)].map((userId) => displayName(userId));
      const shown = names.slice(0, NAMES_SHOWN).join(", ");
      return names.length > NAMES_SHOWN ? `${shown} and ${names.length - NAMES_SHOWN} more` : shown;
    };
    body = (
      <div className="flex flex-column gap-md">
        <Text variant="b3" color="surface-low">
          Each instance is its own copy of this world: you only see and hear the people in yours, and Things you put
          down stay in it. Chat is shared by all of them.
        </Text>
        {!instances ? (
          <Text variant="b2">Looking for instances…</Text>
        ) : instances.length === 0 ? (
          <Text variant="b2">Nobody is in this world right now.</Text>
        ) : (
          <div className="flex flex-column gap-sm">
            {instances.map((instance) => {
              const count = instance.userIds.length;
              const here = instance.id === current;
              const full = cap !== undefined && count >= cap;
              return (
                <div key={instance.id} className="flex items-center gap-sm">
                  <div className="grow flex flex-column" style={{ minWidth: 0 }}>
                    <Text variant="b2" weight="semi-bold">
                      {instanceName(instance.id)}
                      {here ? " (you're here)" : ""}
                    </Text>
                    <Text variant="b3" color="surface-low">
                      {count}
                      {cap !== undefined ? ` / ${cap}` : ""} {count === 1 ? "player" : "players"}
                      {full ? " (full)" : ""}: {people(instance)}
                    </Text>
                  </div>
                  <Button size="sm" fill="outline" onClick={() => copyLink(instance.id)}>
                    {copied === instance.id ? "Copied" : "Copy Link"}
                  </Button>
                  {!here && <EnterWorldButton room={room} instance={instance.id} size="sm" label="Join" />}
                </div>
              );
            })}
          </div>
        )}
        <form
          className="flex flex-column gap-xs"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
          }}
        >
          <Label>New Instance</Label>
          <div className="flex items-center gap-sm">
            <div className="grow">
              <Input
                value={name}
                maxLength={MAX_INSTANCE_NAME}
                placeholder="Name (optional)"
                onChange={(event) => setName(event.target.value)}
                aria-label="New instance name"
              />
            </div>
            <EnterWorldButton room={room} instance={newId} size="sm" label="Start" />
          </div>
          <Text variant="b3" color="surface-low">
            {cleanInstanceName(name)
              ? `Starts "${instanceName(newId)}" with you in it.`
              : `Starts instance ${instanceName(newId)} with you in it.`}
          </Text>
        </form>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Header
        left={<HeaderTitle size="lg">Instances</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={close} label="Close" />}
      />
      <div style={{ maxHeight: "70vh", display: "flex" }}>
        <Scroll type="hover">
          <div style={{ padding: "var(--sp-md)", width: 520, maxWidth: "calc(100vw - 32px)" }}>{body}</div>
        </Scroll>
      </div>
    </Dialog>
  );
}

/** Opens a world's Instances list (next to Enter World). */
export function InstancesButton({ room }: { room: Room }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" fill="outline" onClick={() => setOpen(true)}>
        Instances
      </Button>
      <InstancesDialog room={room} open={open} onOpenChange={setOpen} />
    </>
  );
}
