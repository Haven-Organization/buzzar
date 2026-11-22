/**
 * Buzzar: feeds the world's object rules (software.haven.world.rules, falling back to the world event's
 * max_member_object_cap) to the engine, and tells moderators when someone's blocked by them.
 */
import { useCallback, useEffect, useRef } from "react";

import { Room, StateEvent } from "../../matrix";
import { useMainThreadContext } from "./useMainThread";
import { useStateEventKeyCallback } from "./useStateEventKeyCallback";
import { usePowerLevels } from "./usePowerLevels";
import { useMatrix } from "./useMatrix";
import { registerMessageHandler, Thread } from "../../engine/module/module.common";
import {
  parseSpawnRules,
  SetSpawnRulesMessage,
  SpawnRulesMessageType,
  SpawnRuleViolationMessage,
  WORLD_RULES_EVENT,
} from "../../engine/network/spawnRules.common";
import { useMemberDisplayName } from "./useMemberDisplayName";
import { setWorldShadows } from "../../engine/renderer/renderer.main";
import { parseWorldShadows } from "../../engine/renderer/renderer.common";

export function useWorldRules(room: Room, notify: (text: string) => void) {
  const displayNameOf = useMemberDisplayName(room);
  const { session } = useMatrix(true);
  const mainThread = useMainThreadContext();
  const latest = useRef<{ rules?: unknown; legacyCap?: unknown }>({});

  const send = useCallback(() => {
    mainThread.sendMessage<SetSpawnRulesMessage>(Thread.Game, {
      type: SpawnRulesMessageType.SetSpawnRules,
      rules: parseSpawnRules(latest.current.rules, latest.current.legacyCap),
    });
    // Buzzar (Third Room #204): the world's shadows live in the same rules event.
    setWorldShadows(
      mainThread,
      parseWorldShadows((latest.current.rules as { shadows?: unknown } | undefined)?.shadows)
    );
  }, [mainThread]);

  const onRules = useCallback(
    (event: StateEvent | undefined) => {
      latest.current.rules = event?.content;
      send();
    },
    [send]
  );
  const onWorld = useCallback(
    (event: StateEvent | undefined) => {
      latest.current.legacyCap = (
        event?.content as { max_member_object_cap?: unknown } | undefined
      )?.max_member_object_cap;
      send();
    },
    [send]
  );
  useStateEventKeyCallback(room, WORLD_RULES_EVENT, "", onRules);
  useStateEventKeyCallback(room, "org.matrix.msc3815.world", "", onWorld);

  // Moderators (anyone who can kick) hear about blocked attempts; everyone else just doesn't see them.
  const { getPowerLevel, canDoAction } = usePowerLevels(room);
  const isModerator = canDoAction("kick", getPowerLevel(session.userId));
  const isModeratorRef = useRef(isModerator);
  isModeratorRef.current = isModerator;

  useEffect(
    () =>
      registerMessageHandler(
        mainThread,
        SpawnRulesMessageType.SpawnRuleViolation,
        (_ctx, message: SpawnRuleViolationMessage) => {
          if (!isModeratorRef.current) return;
          const name = displayNameOf(message.peerId);
          notify(`Blocked ${name} (${message.peerId}): ${message.reason}.`);
        }
      ),
    [mainThread, displayNameOf, notify]
  );
}
