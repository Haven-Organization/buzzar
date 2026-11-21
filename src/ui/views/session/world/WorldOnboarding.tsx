import { useAtomValue } from "jotai";
import { useCallback, useEffect } from "react";

import { Room } from "../../../../matrix";
import { useOnboarding } from "../../../hooks/useOnboarding";
import { worldAtom } from "../../../state/world";
import { OnboardingModal } from "./OnboardingModal";

export function WorldOnboarding({ world }: { world: Room }) {
  const isWorldEntered = useAtomValue(worldAtom).entered;

  const { onboarding, finishOnboarding } = useOnboarding(isWorldEntered ? world.id : undefined);

  useEffect(() => {
    if (onboarding) document.exitPointerLock();
  }, [onboarding]);

  const onFinishOnboarding = useCallback(() => {
    finishOnboarding();
    // Buzzar: no programmatic pointer lock after a button click (see useDisableInput); click the world to play.
  }, [finishOnboarding]);

  return <OnboardingModal open={onboarding} world={world} requestClose={onFinishOnboarding} />;
}
