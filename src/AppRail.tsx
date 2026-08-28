import {
  IconBot,
  IconChat,
  IconCog,
  IconFolder,
  IconOffice,
  IconTasks,
  IconUsers,
} from "./icons";
import type {
  AppPlace,
  NavigationIconName,
} from "./navigation";

export type { AppPlace } from "./navigation";

interface AppRailLabels {
  mainNavigation: string;
  settings: string;
  updateAvailable: string;
}

export type AppRailBadge =
  | { kind: "dot" }
  | { kind: "count"; count: number };

export interface AppRailItem {
  id: string;
  label: string;
  icon: NavigationIconName;
  shortcut?: string;
  active: boolean;
  badge?: AppRailBadge;
}

interface AppRailProps {
  activePlace: AppPlace;
  items: AppRailItem[];
  labels: AppRailLabels;
  updateAvailable: string;
  onSelect: (id: string) => void;
  onIntent: (id: string) => void;
  onSelectSettings: () => void;
  onIntentSettings: () => void;
}

export function NavigationGlyph({
  name,
  size = 19,
}: {
  name: NavigationIconName;
  size?: number;
}) {
  if (name === "chat") return <IconChat size={size} />;
  if (name === "projects") return <IconFolder size={size} />;
  if (name === "groups") return <IconUsers size={size} />;
  if (name === "office") return <IconOffice size={size} />;
  if (name === "tasks") return <IconTasks size={size} />;
  return <IconBot size={size} />;
}

/**
 * Hara's module dock. Contributions and preferences live outside this presentational
 * component; Settings is deliberately fixed so hidden modules always remain recoverable.
 */
export function AppRail({
  activePlace,
  items,
  labels,
  updateAvailable,
  onSelect,
  onIntent,
  onSelectSettings,
  onIntentSettings,
}: AppRailProps) {
  return (
    <nav className="rail" aria-label={labels.mainNavigation}>
      {items.map((item) => (
        <button
          key={item.id}
          className={item.active ? "on" : ""}
          aria-label={item.label}
          aria-current={item.active ? "page" : undefined}
          title={item.shortcut ? `${item.label} ${item.shortcut}` : item.label}
          onMouseEnter={() => onIntent(item.id)}
          onFocus={() => onIntent(item.id)}
          onClick={() => onSelect(item.id)}
        >
          <NavigationGlyph name={item.icon} />
          {item.badge?.kind === "dot" ? <span className="rdot" /> : null}
          {item.badge?.kind === "count" && item.badge.count > 0 ? (
            <span className="chip">
              {item.badge.count > 9 ? "9+" : item.badge.count}
            </span>
          ) : null}
        </button>
      ))}
      <div className="railgap" />
      <button
        className={activePlace === "settings" ? "on" : ""}
        aria-label={
          updateAvailable
            ? `${labels.settings}, ${labels.updateAvailable} ${updateAvailable}`
            : labels.settings
        }
        aria-current={activePlace === "settings" ? "page" : undefined}
        title={
          updateAvailable
            ? `${labels.updateAvailable}: ${updateAvailable}`
            : `${labels.settings} ⌘,`
        }
        onMouseEnter={onIntentSettings}
        onFocus={onIntentSettings}
        onClick={onSelectSettings}
      >
        <IconCog size={18} />
        {updateAvailable ? <span className="rdot" /> : null}
      </button>
    </nav>
  );
}
