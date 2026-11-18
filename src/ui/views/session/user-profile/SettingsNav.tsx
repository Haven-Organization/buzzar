/**
 * Buzzar: the category list down the left of User Settings (like Element's settings).
 */
import classNames from "classnames";

import { Icon } from "../../../atoms/icon/Icon";
import { Text } from "../../../atoms/text/Text";
import "./SettingsNav.css";

export interface SettingsNavItem<T extends string> {
  id: T;
  label: string;
  icon: string;
}

interface SettingsNavProps<T extends string> {
  items: SettingsNavItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
}

export function SettingsNav<T extends string>({ items, selected, onSelect }: SettingsNavProps<T>) {
  return (
    <nav className="SettingsNav flex flex-column gap-xxs" aria-label="Settings categories">
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <button
            key={item.id}
            type="button"
            className={classNames("SettingsNav__item flex items-center gap-sm", {
              "SettingsNav__item--active": active,
            })}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <Icon src={item.icon} size="sm" color={active ? "primary" : "surface-low"} />
            <Text variant="b2" weight={active ? "semi-bold" : "medium"} color={active ? "primary" : "surface"}>
              {item.label}
            </Text>
          </button>
        );
      })}
    </nav>
  );
}
