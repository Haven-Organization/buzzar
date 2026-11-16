import { ReactNode } from "react";
import classNames from "classnames";

import { Text } from "../../../atoms/text/Text";
import { Icon } from "../../../atoms/icon/Icon";
import { IconButton } from "../../../atoms/button/IconButton";
import { DropdownMenu } from "../../../atoms/menu/DropdownMenu";
import MoreHorizontalIC from "../../../../../res/ic/more-horizontal.svg";
import PeoplesIC from "../../../../../res/ic/peoples.svg";
import "./WorldTile.css";

interface WorldTileProps {
  className?: string;
  /** Picture URL (already an http URL). */
  imageSrc?: string;
  /** Shown instead of a picture: usually the world's initial on its colour. */
  fallback?: ReactNode;
  /** "wide" for worlds (16:9), "tall" for avatars (3:4). */
  shape?: "wide" | "tall";
  title: string;
  /** Lines under the title (alias, topic, creator…). */
  subtitle?: ReactNode;
  memberCount?: number;
  memberLabel?: string;
  /** Live info shown on the picture (e.g. who's in the world right now). */
  overlay?: ReactNode;
  /** A small label on the picture, e.g. "You're here" or "Wearing". */
  badge?: ReactNode;
  /** Main action (Enter, Join, Wear…). */
  action?: ReactNode;
  /** Items of the "…" menu. */
  menu?: ReactNode;
  isActive?: boolean;
}

/** Buzzar: a big picture tile for worlds and avatars (like VRChat's), with details and a "…" menu underneath. */
export function WorldTile({
  className,
  imageSrc,
  fallback,
  shape = "wide",
  title,
  subtitle,
  memberCount,
  memberLabel,
  overlay,
  badge,
  action,
  menu,
  isActive,
}: WorldTileProps) {
  return (
    <div className={classNames("WorldTile flex flex-column", `WorldTile--${shape}`, { "WorldTile--active": isActive }, className)}>
      <div className="WorldTile__image">
        {imageSrc ? <img src={imageSrc} alt="" loading="lazy" draggable={false} /> : fallback}
        {badge && <div className="WorldTile__badge">{badge}</div>}
        {overlay && <div className="WorldTile__overlay">{overlay}</div>}
      </div>
      <div className="WorldTile__details flex flex-column gap-xxs">
        <div className="flex items-start gap-xs">
          <Text className="WorldTile__title grow" weight="semi-bold">
            {title}
          </Text>
          {menu && (
            <DropdownMenu content={menu} side="bottom" align="end">
              <IconButton className="shrink-0" size="sm" label="More options" iconSrc={MoreHorizontalIC} />
            </DropdownMenu>
          )}
        </div>
        {subtitle && <div className="WorldTile__subtitle flex flex-column">{subtitle}</div>}
        <div className="WorldTile__footer flex items-center gap-xs">
          {memberCount !== undefined && (
            <span className="WorldTile__members grow flex items-center gap-xxs">
              <Icon src={PeoplesIC} size="sm" color="surface-low" />
              <Text variant="b3" color="surface-low">
                {memberCount} {memberLabel ?? (memberCount === 1 ? "member" : "members")}
              </Text>
            </span>
          )}
          {memberCount === undefined && <span className="grow" />}
          {action}
        </div>
      </div>
    </div>
  );
}

/** Grid of tiles that fills the window width. */
export function WorldTileGrid({ children, tall }: { children: ReactNode; tall?: boolean }) {
  return <div className={classNames("WorldTileGrid", { "WorldTileGrid--tall": tall })}>{children}</div>;
}

/** Initial-on-colour stand-in for a missing picture. */
export function TileFallback({ name, color }: { name: string; color: string }) {
  return (
    <div className="WorldTile__fallback flex items-center justify-center" style={{ backgroundColor: color }}>
      <Text weight="bold" className="WorldTile__initial">
        {(name.replace(/^[#!@]/, "").charAt(0) || "?").toUpperCase()}
      </Text>
    </div>
  );
}
