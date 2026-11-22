import MouseIC from "../../../../../res/ic/mouse-left.svg";
import { InteractableType } from "../../../../engine/resource/schema";
import { Icon } from "../../../atoms/icon/Icon";
import { Dots } from "../../../atoms/loading/Dots";
import { Text } from "../../../atoms/text/Text";
import { InteractionState } from "../../../hooks/useWorldInteraction";
import { usePortalDestination } from "../../../hooks/usePortalDestination";
import { useMatrix } from "../../../hooks/useMatrix";
import { useActionKeyLabel } from "../../../hooks/useKeyBindings";
import "./EntityTooltip.css";

export interface IPortalProcess {
  joining?: boolean;
  error?: Error;
}

interface EntityTooltipProps {
  activeEntity: InteractionState;
  portalProcess: IPortalProcess;
}

export function EntityTooltip({ activeEntity, portalProcess }: EntityTooltipProps) {
  const grabKey = useActionKeyLabel("grab");
  const deleteKey = useActionKeyLabel("delete");
  return (
    <div className="EntityTooltip">
      {activeEntity.interactableType === InteractableType.Player && (
        <>
          <Text weight="bold" color="world">
            {activeEntity.name}
          </Text>
          <div className="flex flex-column gap-xxs">
            <Text variant="b3" color="world">
              {activeEntity.peerId}
            </Text>
            <Text variant="b3" color="world">
              <span className="EntityTooltip__boxedKey">{grabKey}</span>
              <span> More Info</span>
            </Text>
          </div>
        </>
      )}
      {activeEntity.interactableType === InteractableType.Interactable && (
        <>
          <Text weight="bold" color="world">
            {activeEntity.name}
          </Text>
          <div className="flex flex-column gap-xxs">
            <Text variant="b3" color="world">
              <span className="EntityTooltip__boxedKey">{grabKey}</span> /
              <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
              <span> Interact</span>
            </Text>
          </div>
        </>
      )}
      {activeEntity.interactableType === InteractableType.UI && (
        <>
          <Text weight="bold" color="world">
            {activeEntity.name}
          </Text>
          <div className="flex flex-column gap-xxs">
            <Text variant="b3" color="world">
              <span className="EntityTooltip__boxedKey">{grabKey}</span> /
              <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
              <span> Interact</span>
            </Text>
          </div>
        </>
      )}
      {activeEntity.interactableType === InteractableType.Grabbable && (
        <>
          <Text weight="bold" color="world">
            {activeEntity.name}
          </Text>
          <div className="flex flex-column gap-xxs">
            <Text variant="b3" color="world">
              {activeEntity.ownerId}
            </Text>
            {activeEntity.held ? (
              <>
                <Text variant="b3" color="world">
                  <span className="EntityTooltip__boxedKey">{grabKey}</span> /
                  <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
                  <span> Left Click: Drop</span>
                </Text>
                <Text variant="b3" color="world">
                  <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
                  <span> Right Click: Throw</span>
                </Text>
              </>
            ) : (
              <Text variant="b3" color="world">
                <span className="EntityTooltip__boxedKey">{grabKey}</span> /
                <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
                <span> Grab</span>
              </Text>
            )}
            {activeEntity.ownerId === activeEntity.peerId && (
              <Text variant="b3" color="world">
                <span className="EntityTooltip__boxedKey">{deleteKey}</span>
                <span> Delete</span>
              </Text>
            )}
          </div>
        </>
      )}
      {activeEntity.interactableType === InteractableType.Portal && (
        <>
          {portalProcess.joining && <Dots color="world" size="sm" />}
          <Text weight="bold" color="world">
            {portalProcess.joining ? "Joining portal" : "Portal"}
          </Text>
          <div className="flex flex-column gap-xxs">
            <PortalDestinationCard uri={activeEntity.uri} fallbackName={activeEntity.name} />
            {portalProcess.error && (
              <Text variant="b3" color="world">
                {portalProcess.error.message ?? "Unknown error joining portal."}
              </Text>
            )}
            {!portalProcess.joining && (
              <Text variant="b3" color="world">
                <span className="EntityTooltip__boxedKey">{grabKey}</span> /
                <Icon src={MouseIC} size="sm" className="EntityTooltip__mouseIcon" color="world" />
                <span> Enter World</span>
              </Text>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Buzzar: where a portal leads: the world's picture, name, topic and how many people are in it. */
function PortalDestinationCard({ uri, fallbackName }: { uri?: string; fallbackName: string }) {
  const { session } = useMatrix(true);
  const destination = usePortalDestination(uri);
  const image = destination?.image?.startsWith("mxc:")
    ? session.mediaRepository.mxcUrlThumbnail(destination.image, 320, 180, "scale") ?? undefined
    : destination?.image;
  return (
    <>
      {image && <img className="EntityTooltip__preview" src={image} alt="" />}
      <Text variant="b3" color="world" weight={destination?.name ? "semi-bold" : undefined}>
        {destination?.web ? `Web page: ${destination.name}` : destination?.name ?? fallbackName}
      </Text>
      {destination?.name && !destination.web && destination.name !== fallbackName && (
        <Text variant="b3" color="world" className="EntityTooltip__address">
          {fallbackName}
        </Text>
      )}
      {destination?.topic && (
        <Text variant="b3" color="world" className="EntityTooltip__topic">
          {destination.topic}
        </Text>
      )}
      {destination?.members !== undefined && (
        <Text variant="b3" color="world">
          {destination.members === 1 ? "1 member" : `${destination.members} members`}
        </Text>
      )}
    </>
  );
}
