import { IconBot, IconChat, IconCog, IconFolder } from "./icons";
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
  onSelectSettings: () => void;
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
  onSelectSettings,
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
          onClick={() => onSelect(item.id)}
        >
          <NavigationGlyph name={item.icon} />
          {item.badge?.kind === "dot" && <span className="rdot" />}
          {item.badge?.kind === "count" && item.badge.count > 0 && (
            <span className="chip">
              {item.badge.count > 9 ? "9+" : item.badge.count}
            </span>
          )}
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
        onClick={onSelectSettings}
      >
        <IconCog size={18} />
        {updateAvailable && <span className="rdot" />}
      </button>
    </nav>
  );
}
