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
import { useLocalStorage } from "./useLocalStorage";
import {
  DEFAULT_MOVEMENT_PREFS,
  LIMIT_OVERRIDES_KEY,
  LimitOverrides,
  MOVEMENT_PREFS_KEY,
  MovementMessageType,
  parseMovementPrefs,
  parseMovementRules,
  SetLimitOverridesMessage,
  SetMovementPrefsMessage,
  SetMovementRulesMessage,
} from "../../engine/player/movement.common";
import { confirmDialog } from "../views/components/confirm-dialog/ConfirmDialog";
import { setLimitOverrides } from "../utils/limitOverrides";
import { setWorldShadows } from "../../engine/renderer/renderer.main";
import { parseWorldShadows } from "../../engine/renderer/renderer.common";

const NO_OVERRIDES: Partial<LimitOverrides> = {};

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
    // Buzzar (Third Room #295): and its movement rules (speeds, jumping, flying).
    mainThread.sendMessage<SetMovementRulesMessage>(Thread.Game, {
      type: MovementMessageType.SetMovementRules,
      rules: parseMovementRules(latest.current.rules),
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

  // Buzzar (Third Room #295): this player's own speeds (Settings → Controls) and the Developer limit overrides.
  const [prefs] = useLocalStorage<unknown>(MOVEMENT_PREFS_KEY, DEFAULT_MOVEMENT_PREFS);
  const [overrides] = useLocalStorage<Partial<LimitOverrides>>(LIMIT_OVERRIDES_KEY, NO_OVERRIDES);
  const [developerMode] = useLocalStorage("buzzar.developerMode", false);
  const ignoreOwn = developerMode && !!overrides.ignoreOwn;
  const ignoreOthers = developerMode && !!overrides.ignoreOthers;
  useEffect(() => {
    mainThread.sendMessage<SetMovementPrefsMessage>(Thread.Game, {
      type: MovementMessageType.SetMovementPrefs,
      prefs: parseMovementPrefs(prefs),
    });
  }, [mainThread, prefs]);
  useEffect(() => {
    mainThread.sendMessage<SetLimitOverridesMessage>(Thread.Game, {
      type: MovementMessageType.SetLimitOverrides,
      overrides: { ignoreOwn, ignoreOthers },
    });
  }, [mainThread, ignoreOwn, ignoreOthers]);

  // On entering a world with either override on: a reminder, so they're not left on by accident (and nobody is
  // confused by things only they can see).
  const overridesRef = useRef({ ignoreOwn, ignoreOthers });
  overridesRef.current = { ignoreOwn, ignoreOthers };
  useEffect(() => {
    const { ignoreOwn, ignoreOthers } = overridesRef.current;
    if (!ignoreOwn && !ignoreOthers) return;
    const lines = [
      ignoreOwn &&
        "• Ignore world limits for my actions: other players' Buzzar still blocks what breaks this world's rules. They won't see those objects, and they'll see you held back if you move too fast. Moderators are told each time and may kick or ban you.",
      ignoreOthers &&
        "• Don't enforce world limits on others for me: you see everything other players send, even what this world's rules block, so you may see things nobody else does.",
    ].filter(Boolean);
    confirmDialog({
      title: "World Limits Are Off",
      message: `Developer settings that ignore world limits are on:\n\n${lines.join(
        "\n\n"
      )}\n\nTurn them off when you're done testing.`,
      confirmLabel: "Turn Them Off",
      cancelLabel: "Keep Them On",
    }).then((off) => {
      if (off) setLimitOverrides({ ignoreOwn: false, ignoreOthers: false });
    });
  }, [room.id]);

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
