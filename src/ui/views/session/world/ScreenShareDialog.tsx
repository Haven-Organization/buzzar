/**
 * Buzzar (Third Room #398): share your screen in the world (engine/screenshare): as a floating screen in front of
 * you, or on one of the world's screens. Only people in the world's LiveKit call see it.
 */
import { useEffect, useState } from "react";

import { Room } from "../../../../matrix";
import { Button } from "../../../atoms/button/Button";
import { IconButton } from "../../../atoms/button/IconButton";
import { Dialog } from "../../../atoms/dialog/Dialog";
import { Header } from "../../../atoms/header/Header";
import { HeaderTitle } from "../../../atoms/header/HeaderTitle";
import { Label } from "../../../atoms/text/Label";
import { Text } from "../../../atoms/text/Text";
import { SettingTile } from "../../components/setting-tile/SettingTile";
import { SelectInput } from "../../components/property-panel/SelectInput";
import { useMemberDisplayName } from "../../../hooks/useMemberDisplayName";
import {
  getScreenShare,
  onScreenShareChanged,
  ScreenShare,
  ScreenShareState,
} from "../../../../engine/screenshare/screenShare.main";
import { ScreenPlacement, ScreenSize } from "../../../../engine/screenshare/screenShare.common";
import CrossIC from "../../../../../res/ic/cross.svg";

const FLOATING = "\u0000floating";
const SIZE_LABEL: Record<ScreenSize, string> = { small: "Small", medium: "Medium", large: "Large" };

/** Whether this browser can share a screen at all (phones mostly can't). */
export const canShareScreens = () =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

/** The world's screen sharing (undefined outside LiveKit calls) and its state, kept up to date. */
export function useScreenShare(): [ScreenShare | undefined, ScreenShareState | undefined] {
  const [screenShare, setScreenShare] = useState(getScreenShare);
  useEffect(() => {
    setScreenShare(getScreenShare());
    return onScreenShareChanged(() => setScreenShare(getScreenShare()));
  }, []);
  const [state, setState] = useState(() => screenShare?.state);
  useEffect(() => {
    setState(screenShare?.state);
    return screenShare?.subscribe(() => setState(screenShare.state));
  }, [screenShare]);
  return [screenShare, state];
}

export function ScreenShareDialog({
  open,
  onOpenChange,
  world,
  showToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  world: Room;
  showToast: (text: string) => void;
}) {
  const [screenShare, state] = useScreenShare();
  const displayName = useMemberDisplayName(world);
  const [target, setTarget] = useState<string>(FLOATING);
  const [size, setSize] = useState<ScreenSize>("medium");
  const [busy, setBusy] = useState(false);

  // The world's screens are known once it has loaded: ask again each time this opens.
  useEffect(() => {
    if (open) void screenShare?.refreshScreens();
  }, [open, screenShare]);
  // Start from where the screen is now.
  useEffect(() => {
    if (!open || !state?.placement) return;
    if (state.placement.kind === "world") setTarget(state.placement.screen);
    else {
      setTarget(FLOATING);
      setSize(state.placement.size);
    }
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => onOpenChange(false);

  const apply = async () => {
    if (!screenShare) return;
    setBusy(true);
    try {
      let placement: ScreenPlacement | undefined;
      if (target === FLOATING) placement = await screenShare.floatingHere(size);
      else placement = { kind: "world", screen: target };
      if (!placement) {
        showToast("Couldn't place the screen: you're not in the world yet.");
        return;
      }
      const wasSharing = screenShare.state.sharing;
      await screenShare.share(placement);
      if (screenShare.state.sharing) {
        showToast(wasSharing ? "Screen moved" : "Sharing your screen");
        close();
      }
    } catch (error) {
      // Cancelling the browser's picker isn't worth a message.
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
        showToast(`Couldn't share your screen: ${error instanceof Error ? error.message : error}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await screenShare?.stop();
    showToast("Stopped sharing your screen");
    close();
  };

  const options = [
    { value: FLOATING, label: "Floating screen in front of you" },
    ...(state?.screens ?? []).map((screen) => ({
      value: screen.name,
      label:
        screen.usedBy && screen.usedBy !== world.client.getUserId()
          ? `${screen.name} (showing ${displayName(screen.usedBy)}'s screen)`
          : screen.name,
    })),
  ];

  let body;
  if (!screenShare || !state) {
    body = (
      <Text variant="b2">
        Screen sharing needs this world&apos;s call to be a LiveKit call. In a peer-to-peer call, nobody would see it.
      </Text>
    );
  } else if (!canShareScreens()) {
    body = <Text variant="b2">This browser can&apos;t share its screen. Try Buzzar on a computer.</Text>;
  } else if (!state.allowed && !state.sharing) {
    body = <Text variant="b2">This world doesn&apos;t let you share your screen.</Text>;
  } else {
    const takenBy = state.screens.find((screen) => screen.name === target)?.usedBy;
    body = (
      <div className="flex flex-column gap-md">
        <SettingTile label={<Label>Where</Label>}>
          <SelectInput options={options} value={target} onChange={setTarget} disabled={busy} />
          {target === FLOATING ? (
            <Text variant="b3" color="surface-low">
              Placed in front of you, where you&apos;re looking now. It stays there; choose this again to move it.
            </Text>
          ) : takenBy && takenBy !== world.client.getUserId() ? (
            <Text variant="b3" color="surface-low">
              Your screen will take over from {displayName(takenBy)}&apos;s until you stop.
            </Text>
          ) : null}
        </SettingTile>
        {target === FLOATING && (
          <SettingTile label={<Label>Size</Label>}>
            <SelectInput
              options={(Object.keys(SIZE_LABEL) as ScreenSize[]).map((value) => ({ value, label: SIZE_LABEL[value] }))}
              value={size}
              onChange={setSize}
              disabled={busy}
            />
          </SettingTile>
        )}
        <Text variant="b3" color="surface-low">
          Everyone in this world&apos;s LiveKit call sees it (people in a peer-to-peer call don&apos;t). Your
          screen&apos;s sound isn&apos;t shared.
        </Text>
        <div className="flex gap-sm justify-end">
          {state.sharing && (
            <Button variant="danger" fill="outline" onClick={stop} disabled={busy}>
              Stop Sharing
            </Button>
          )}
          <Button onClick={apply} disabled={busy}>
            {state.sharing ? (target === FLOATING ? "Move Here" : "Show There") : "Choose What to Share"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Header
        left={<HeaderTitle size="lg">Share Your Screen</HeaderTitle>}
        right={<IconButton iconSrc={CrossIC} onClick={close} label="Close" />}
      />
      <div style={{ padding: "var(--sp-md)", maxWidth: 520 }}>{body}</div>
    </Dialog>
  );
}
