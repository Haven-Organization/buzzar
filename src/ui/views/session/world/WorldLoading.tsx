import { useCallback, useEffect, useState } from "react";
import { Room } from "@thirdroom/hydrogen-view-sdk";
import { useAtom } from "jotai";

import { MainContext } from "../../../../engine/MainThread";
import { registerMessageHandler } from "../../../../engine/module/module.common";
import { FetchProgressMessage, FetchProgressMessageType } from "../../../../engine/utils/fetchWithProgress.game";
import { Progress } from "../../../atoms/progress/Progress";
import { Text } from "../../../atoms/text/Text";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { bytesToSize, getPercentage } from "../../../utils/common";
import "./WorldLoading.css";
import { Button } from "../../../atoms/button/Button";
import { WorldPreviewCard } from "../../components/world-preview-card/WorldPreviewCard";
import { overlayVisibilityAtom } from "../../../state/overlayVisibility";
import { useWorldNavigator } from "../../../hooks/useWorldNavigator";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { usePowerLevels } from "../../../hooks/usePowerLevels";
import { useOpenOverlayWindow } from "../../../hooks/useOpenOverlayWindow";
import { OverlayWindow } from "../../../state/overlayWindow";

interface WorldLoadProgress {
  loaded: number;
  total: number;
}

function useWorldLoadingProgress(): [() => void, WorldLoadProgress] {
  const engine = useMainThreadContext();
  const [loadProgress, setLoadProgress] = useState<WorldLoadProgress>({ loaded: 0, total: 0 });

  useEffect(() => {
    const onFetchProgress = (ctx: MainContext, message: FetchProgressMessage) => {
      setLoadProgress(message.status);
    };
    return registerMessageHandler(engine, FetchProgressMessageType, onFetchProgress);
  }, [engine]);

  const reset = useCallback(() => {
    setLoadProgress({ loaded: 0, total: 0 });
  }, []);

  return [reset, loadProgress];
}

export function WorldLoading({ world, loading, error }: { world: Room; loading: boolean; error?: Error }) {
  const [overlayVisible] = useAtom(overlayVisibilityAtom);
  const [resetLoadProgress, loadProgress] = useWorldLoadingProgress();
  const [creator, setCreator] = useState<string>();
  const { session } = useHydrogen(true);
  const { navigateEnterWorld, navigateExitWorld } = useWorldNavigator(session);
  // Buzzar: a world without a scene (e.g. a copied room that lost its world event) can be fixed right here.
  const { getPowerLevel, canSendStateEvent } = usePowerLevels(world);
  const canSetScene = canSendStateEvent("org.matrix.msc3815.world", getPowerLevel(session.userId));
  const openOverlayWindow = useOpenOverlayWindow();
  const missingScene = !!error && /scene does not exist/i.test(error.message);

  useEffect(() => {
    resetLoadProgress();
  }, [resetLoadProgress, loading]);

  useEffect(() => {
    let disposed = false;
    world?.getStateEvent("m.room.create", "").then((stateEvent) => {
      if (disposed) return;
      const creatorId = stateEvent?.event.sender;
      if (!creatorId) return;
      setCreator(creatorId);
    });
    return () => {
      disposed = true;
    };
  }, [world]);

  if (overlayVisible) return null;

  return (
    <>
      {error && (
        <div className="WorldLoading flex justify-center">
          <WorldPreviewCard
            title={world.name ?? world.canonicalAlias ?? "Unknown World"}
            desc={
              missingScene
                ? canSetScene
                  ? "This world has no 3D scene yet. Choose one in its settings."
                  : "This world has no 3D scene yet. Ask its owner to set one."
                : error.message
            }
            options={
              <div className="flex gap-xxs">
                <Button onClick={navigateExitWorld} fill="outline">
                  Exit
                </Button>
                {missingScene && canSetScene ? (
                  <Button onClick={() => openOverlayWindow({ type: OverlayWindow.WorldSettings, roomId: world.id })}>
                    Set Scene
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      navigateEnterWorld(world, { reload: true });
                    }}
                  >
                    Reload
                  </Button>
                )}
              </div>
            }
          />
        </div>
      )}
      {!error && loading && (
        <div className="WorldLoading flex justify-center">
          <WorldPreviewCard
            title={world.name ?? world.canonicalAlias ?? "Unknown World"}
            desc={creator ? `Created by ${creator}` : undefined}
            content={
              <div className="flex flex-column gap-xs">
                <Progress
                  variant="secondary"
                  max={100}
                  value={getPercentage(loadProgress.total, loadProgress.loaded)}
                />
                <div className="flex justify-between gap-md">
                  <Text variant="b3">{`Loading Scene: ${getPercentage(
                    loadProgress.total,
                    loadProgress.loaded
                  )}%`}</Text>
                  <Text variant="b3">{`${bytesToSize(loadProgress.loaded)} / ${bytesToSize(loadProgress.total)}`}</Text>
                </div>
              </div>
            }
            options={
              <div className="flex gap-xxs">
                <Button onClick={navigateExitWorld} fill="outline">
                  Cancel
                </Button>
              </div>
            }
          />
        </div>
      )}
    </>
  );
}
