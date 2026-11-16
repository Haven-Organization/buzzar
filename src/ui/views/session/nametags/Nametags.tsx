import { GroupCall, Member, Room } from "@thirdroom/hydrogen-view-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { useAtomValue } from "jotai";

import "./Nametags.css";
import { getModule } from "../../../../engine/module/module.common";
import { range } from "../../../../engine/utils/interpolation";
import { useMainThreadContext } from "../../../hooks/useMainThread";
import { useRoomMembers } from "../../../hooks/useRoomMembers";
import { useHydrogen } from "../../../hooks/useHydrogen";
import { Avatar } from "../../../atoms/avatar/Avatar";
import { getAvatarHttpUrl, getIdentifierColorNumber } from "../../../utils/avatar";
import { AudioModule } from "../../../../engine/audio/audio.main";
import { getRoomCall } from "../../../utils/matrixUtils";
import { MainNametag } from "../../../../engine/resource/resource.main";
import { worldAtom } from "../../../state/world";
import { ChatBubble, useChatBubbles } from "../../../hooks/useChatBubbles";
import { useTypingUsers } from "../../../hooks/useTyping";
import { getSessionAuth } from "../../../utils/avatarMatrix";
import { fetchProfileExtras, ProfileExtras } from "../../../utils/profileExtras";
import { FormattedBody } from "../../components/formatted-body/FormattedBody";

// src: https://css-tricks.com/using-requestanimationframe-with-react-hooks/
export const useAnimationFrame = (callback: Function, enabled = true) => {
  const requestRef = useRef<number>();
  const previousTimeRef = useRef<number>();

  const animate = useCallback(
    (time: number) => {
      if (previousTimeRef.current != undefined) {
        const deltaTime = time - previousTimeRef.current;
        callback(deltaTime);
      }
      previousTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    },
    [callback]
  );

  useEffect(() => {
    if (enabled) {
      requestRef.current = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(requestRef.current || 0);
    }
  }, [enabled, animate]);
};

const opacityRange = (a: number) => range(30, 10, 0, 1, a);
const scaleRange = (a: number) => range(40, 0, 0.01, 1, a);

type SpeakingRoomMember = Member & { volumeDetector: { isSpeaking: boolean } };

interface NametagProps {
  room: Room;
  nametag: MainNametag;
  groupCall: GroupCall;
  bubbles?: ChatBubble[];
  typing: boolean;
  showBanners: boolean;
}

const ANIMATED = new Set(["image/gif", "image/webp", "image/apng"]);

/** Buzzar: a message above someone's head: text (formatted), or the image/GIF/sticker they sent. */
function Bubble({ bubble }: { bubble: ChatBubble }) {
  const { session } = useHydrogen(true);
  const resolveMxc = useCallback((mxc: string) => session.mediaRepository.mxcUrl(mxc), [session]);
  const content = bubble.content as { msgtype?: string; url?: string; body?: string; info?: { mimetype?: string } };
  const isImage = bubble.type === "m.sticker" || content.msgtype === "m.image";
  if (isImage && typeof content.url === "string") {
    const src = ANIMATED.has(content.info?.mimetype ?? "")
      ? session.mediaRepository.mxcUrl(content.url)
      : session.mediaRepository.mxcUrlThumbnail(content.url, 320, 240, "scale");
    return (
      <div className="Nametag__bubble Nametag__bubble--image">
        <img src={src ?? undefined} alt={content.body ?? "image"} />
      </div>
    );
  }
  return (
    <div className={classNames("Nametag__bubble Text-b2", { "Nametag__bubble--emote": content.msgtype === "m.emote" })}>
      <FormattedBody content={bubble.content} resolveMxc={resolveMxc} />
    </div>
  );
}

/** Buzzar: pronouns and banner from the player's profile, refreshed every few minutes. */
function useProfileExtras(userId: string): ProfileExtras {
  const { platform, client } = useHydrogen(true);
  const [extras, setExtras] = useState<ProfileExtras>({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const auth = await getSessionAuth(platform, client.sessionId);
      if (!auth) return;
      const value = await fetchProfileExtras(auth, userId);
      if (!cancelled) setExtras(value);
    };
    load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [userId, platform, client]);
  return extras;
}

function Nametag({ room, nametag, groupCall, bubbles, typing, showBanners }: NametagProps) {
  const { joined } = useRoomMembers(room) ?? {};

  const containerRef = useRef<HTMLDivElement>(null);
  const [speaking, setSpeaking] = useState<boolean>(false);

  const member = joined?.find((m) => m.userId === nametag.name);

  const memberCall = member
    ? Array.from(new Map(groupCall.members).values()).find((m) => m.userId === member?.userId && m.isConnected)
    : undefined;

  const avatarUrl = member?.avatarUrl;
  const userId = member?.userId || nametag.name;

  const { platform, session } = useHydrogen(true);
  const volumeDetector =
    (memberCall && (memberCall as SpeakingRoomMember).volumeDetector) ||
    (memberCall?.remoteMedia?.userMedia &&
      ((memberCall as SpeakingRoomMember).volumeDetector = (platform.mediaDevices as any).createVolumeMeasurer(
        memberCall?.remoteMedia?.userMedia,
        () => {}
      )));

  useAnimationFrame(() => {
    if (containerRef.current) {
      const screenX = nametag.screenX;
      const screenY = nametag.screenY;
      const distanceFromCamera = nametag.distanceFromCamera;
      const inFrustum = nametag.inFrustum;

      const el = containerRef.current;

      if (inFrustum) {
        const opacity = opacityRange(distanceFromCamera);
        const scale = scaleRange(distanceFromCamera);
        el.style.transform = `translate(${screenX}px, ${screenY}px) scale(${scale})`;
        el.style.opacity = `${opacity}`;
      } else {
        el.style.opacity = "0";
      }

      setSpeaking(volumeDetector?.isSpeaking);
    }
  });

  const { pronouns, bannerUrl } = useProfileExtras(userId);
  // "scale", not "crop": Synapse's default crop thumbnails stop at 96x96 (blurry); scaled ones go to 800x600.
  // The card crops the image itself (background-size: cover).
  // Buzzar: "Names Only" (N) hides banners but keeps the name card.
  const bannerHttp =
    bannerUrl && showBanners ? session.mediaRepository.mxcUrlThumbnail(bannerUrl, 800, 600, "scale") : undefined;
  const name = member?.displayName || nametag.name;

  return (
    <div className="Nametag" ref={containerRef}>
      <div className="Nametag__stack">
        {bubbles?.map((bubble) => (
          <Bubble key={bubble.id} bubble={bubble} />
        ))}
        {typing && (
          <div className="Nametag__bubble Nametag__bubble--typing" aria-label={`${name} is typing`}>
            <span />
            <span />
            <span />
          </div>
        )}
        <div
          className={classNames("Nametag__card", { "Nametag__card--banner": bannerHttp })}
          style={bannerHttp ? { backgroundImage: `url("${bannerHttp}")` } : undefined}
        >
          <Avatar
            size="xs"
            shape="circle"
            name={member?.displayName?.toUpperCase() || nametag.name.replace("@", "").toUpperCase()}
            imageSrc={avatarUrl ? getAvatarHttpUrl(avatarUrl, 40, platform, session.mediaRepository) : undefined}
            bgColor={`var(--usercolor${getIdentifierColorNumber(userId)})`}
            className={classNames("Nametag__avatar", { ["Speaking"]: speaking })}
          />
          <div className="Nametag__names">
            <div className="Nametag__name Text-b1">{name}</div>
            {pronouns && <div className="Nametag__pronouns Text-b3">{pronouns}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Nametags({ room, show, showBanners = true }: { room: Room; show: boolean; showBanners?: boolean }) {
  const engine = useMainThreadContext();
  const worldId = useAtomValue(worldAtom).worldId;

  const [nametags, setNametags] = useState<MainNametag[]>([]);

  const onNametagsChanged = useCallback((nametags: MainNametag[]) => {
    setNametags([...nametags]);
  }, []);

  useEffect(() => {
    const audioModule = getModule(engine, AudioModule);

    audioModule.eventEmitter.addListener("nametags-changed", onNametagsChanged);

    return () => {
      audioModule.eventEmitter.removeListener("nametags-changed", onNametagsChanged);
    };
  }, [engine, onNametagsChanged]);

  const { session } = useHydrogen(true);

  const groupCall = getRoomCall(session.callHandler.calls, worldId);
  // Buzzar: messages and typing shown above heads.
  const bubbles = useChatBubbles(room);
  const typingUsers = useTypingUsers(room.id);

  return (
    <div>
      {show &&
        groupCall &&
        nametags.map((nametag) => (
          <Nametag
            key={nametag.eid}
            room={room}
            nametag={nametag}
            groupCall={groupCall as GroupCall}
            bubbles={bubbles.get(nametag.name)}
            typing={typingUsers.has(nametag.name)}
            showBanners={showBanners}
          />
        ))}
    </div>
  );
}
