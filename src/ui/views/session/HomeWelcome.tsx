/**
 * Buzzar: the welcome screen for someone without a Home World (first sign-in, or they skipped it before). "Create
 * and Enter Home World" makes their Home World and takes them straight in, in front of its mirror; "Skip for Now"
 * lets them use Buzzar without one (they can create it later in Settings → Worlds).
 */
import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";

import { Text } from "../../atoms/text/Text";
import { Button } from "../../atoms/button/Button";
import { Dots } from "../../atoms/loading/Dots";
import { useMatrix } from "../../hooks/useMatrix";
import { useWorldNavigator } from "../../hooks/useWorldNavigator";
import { createAndSetHomeWorld, waitForRoom } from "../../hooks/useHomeWorld";
import { homeWelcomeSkippedAtom, homeWorldAtom } from "../../state/homeWorld";
import { overlayVisibilityAtom } from "../../state/overlayVisibility";
import LogoFullSVG from "../../../../res/svg/logo-full.svg";
import "./HomeWelcome.css";

export function HomeWelcome() {
  const { session, platform, client } = useMatrix(true);
  const [home, setHome] = useAtom(homeWorldAtom);
  const [skipped, setSkipped] = useAtom(homeWelcomeSkippedAtom);
  const setOverlayVisible = useSetAtom(overlayVisibilityAtom);
  const { navigateEnterWorld } = useWorldNavigator(session);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  if (home.status !== "none" || skipped) return null;

  const create = async () => {
    setCreating(true);
    setError(undefined);
    try {
      const roomId = await createAndSetHomeWorld(session, platform, client.sessionId);
      const room = await waitForRoom(session, roomId);
      setHome({ status: "ready", roomId });
      setOverlayVisible(false);
      navigateEnterWorld(room);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return (
    <div className="HomeWelcome flex items-center justify-center">
      <div className="HomeWelcome__card flex flex-column items-center gap-md">
        <img className="HomeWelcome__logo" src={LogoFullSVG} alt="Buzzar" />
        <Text variant="h2" weight="semi-bold">
          Welcome to Buzzar!
        </Text>
        <Text variant="b2" className="HomeWelcome__text">
          Let's create your Home World: a place of your own, with a campfire, seats and a mirror to see your avatar in.
          It's the world Buzzar takes you to whenever you start it, and you can invite friends there.
        </Text>
        <Text variant="b3" color="surface-low" className="HomeWelcome__text">
          You can choose a different world as your home later, from any world's menu.
        </Text>
        <Button size="lg" onClick={create} disabled={creating}>
          {creating ? <Dots size="sm" color="on-primary" /> : "Create and Enter Home World"}
        </Button>
        {creating && (
          <Text variant="b3" color="surface-low">
            Setting up your Home World…
          </Text>
        )}
        {error && (
          <Text variant="b3" color="danger">
            {error}
          </Text>
        )}
        <Button size="sm" fill="none" onClick={() => setSkipped(true)} disabled={creating}>
          Skip for Now
        </Button>
      </div>
    </div>
  );
}
