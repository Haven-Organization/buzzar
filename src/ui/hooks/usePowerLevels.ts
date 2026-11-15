import { Room, StateEvent } from "@thirdroom/hydrogen-view-sdk";
import { useCallback, useState } from "react";

import { useStateEventKeyCallback } from "./useStateEventKeyCallback";

enum DefaultPowerLevels {
  usersDefault = 0,
  stateDefault = 50,
  eventsDefault = 0,
  invite = 0,
  redact = 50,
  kick = 50,
  ban = 50,
  historical = 0,
}

interface IPowerLevels {
  users_default?: number;
  state_default?: number;
  events_default?: number;
  historical?: number;
  invite?: number;
  redact?: number;
  kick?: number;
  ban?: number;

  events?: Record<string, number>;
  users?: Record<string, number>;
  notifications?: Record<string, number>;
}

/**
 * Room versions with MSC4289 ("privilege creators"): the room's creators (the create event's sender plus its
 * `additional_creators`) outrank everyone, and aren't listed in the power levels. Room version 12 and later.
 */
export function roomVersionPrivilegesCreators(version: unknown): boolean {
  if (version === "org.matrix.hydra.11") return true;
  if (typeof version !== "string" || !/^\d+$/.test(version)) return false;
  return Number(version) >= 12;
}

/** The room's creators, if its version gives them unlimited power; otherwise an empty set. */
export function getPrivilegedCreators(createEvent: { sender?: string; content?: Record<string, unknown> } | undefined) {
  const creators = new Set<string>();
  if (!createEvent || !roomVersionPrivilegesCreators(createEvent.content?.room_version)) return creators;
  if (createEvent.sender) creators.add(createEvent.sender);
  const additional = createEvent.content?.additional_creators;
  if (Array.isArray(additional)) for (const id of additional) if (typeof id === "string") creators.add(id);
  return creators;
}

export function usePowerLevels(room: Room) {
  const [powerLevels, setPowerLevels] = useState<IPowerLevels>();
  const [creators, setCreators] = useState<Set<string>>(new Set());

  const callback = useCallback((stateEvent: StateEvent | undefined) => {
    const { content } = stateEvent ?? {};
    setPowerLevels(content);
  }, []);
  const createCallback = useCallback((stateEvent: StateEvent | undefined) => {
    setCreators(getPrivilegedCreators(stateEvent as { sender?: string; content?: Record<string, unknown> }));
  }, []);

  useStateEventKeyCallback(room, "m.room.power_levels", "", callback);
  useStateEventKeyCallback(room, "m.room.create", "", createCallback);

  /** Room creators in room version 12+ outrank everyone. */
  const isCreator = useCallback((userId: string) => creators.has(userId), [creators]);

  const getPowerLevel = useCallback(
    (userId: string) => {
      if (creators.has(userId)) return Infinity;
      if (!powerLevels) return 0;
      const { users_default: usersDefault, users } = powerLevels;
      if (users && users[userId] !== undefined) {
        return users[userId];
      }
      return usersDefault ?? DefaultPowerLevels.usersDefault;
    },
    [powerLevels, creators]
  );

  const canSendEvent = useCallback(
    (eventType: string | undefined, powerLevel: number) => {
      if (!powerLevels) return powerLevel >= 0;
      const { events, events_default: eventsDefault } = powerLevels;
      if (events && eventType && events[eventType] !== undefined) {
        return powerLevel >= events[eventType];
      }
      return powerLevel >= (eventsDefault ?? DefaultPowerLevels.eventsDefault);
    },
    [powerLevels]
  );

  const canSendStateEvent = useCallback(
    (eventType: string | undefined, powerLevel: number) => {
      if (!powerLevels) return powerLevel >= 0;
      const { events, state_default: stateDefault } = powerLevels;
      if (events && eventType && events[eventType] !== undefined) {
        return powerLevel >= events[eventType];
      }
      return powerLevel >= (stateDefault ?? DefaultPowerLevels.stateDefault);
    },
    [powerLevels]
  );

  const canDoAction = useCallback(
    (action: "invite" | "redact" | "kick" | "ban" | "historical", powerLevel: number) => {
      const requiredPL = powerLevels?.[action];
      if (requiredPL !== undefined) {
        return powerLevel >= requiredPL;
      }
      return powerLevel >= DefaultPowerLevels[action];
    },
    [powerLevels]
  );

  return {
    isCreator,
    getPowerLevel,
    canSendEvent,
    canSendStateEvent,
    canDoAction,
  };
}
