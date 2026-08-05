import { NavigationGlyph } from "./AppRail";
import {
  navigationIsVisible,
  orderedNavigation,
  type NavigationContribution,
  type NavigationPreferences,
} from "./navigation";
import {
  SettingsBadge,
  SettingsCard,
  SettingsNotice,
  SettingsPage,
} from "./SettingsUI";

interface ModuleDockCopy {
  eyebrow: string;
  title: string;
  description: string;
  cardTitle: string;
  cardDescription: string;
  core: string;
  plugin: string;
  visible: string;
  hidden: string;
  show: string;
  hide: string;
  moveUp: string;
  moveDown: string;
  fixedTitle: string;
  fixedDescription: string;
}

export interface ModuleDockLabel {
  title: string;
  description: string;
}

interface ModuleDockSettingsProps {
  contributions: readonly NavigationContribution[];
  preferences: NavigationPreferences;
  labels: Record<string, ModuleDockLabel>;
  copy: ModuleDockCopy;
  onVisibilityChange: (id: string, visible: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

export function ModuleDockSettings({
  contributions,
  preferences,
  labels,
  copy,
  onVisibilityChange,
  onMove,
}: ModuleDockSettingsProps) {
  const ordered = orderedNavigation(contributions, preferences);
  return (
    <SettingsPage
      id="settings-module-dock-title"
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <SettingsCard title={copy.cardTitle} description={copy.cardDescription}>
        <div className="module-dock-list">
          {ordered.map((item, index) => {
            const visible = navigationIsVisible(item, preferences);
            const label = labels[item.id] ?? {
              title: item.id,
              description: "",
            };
            return (
              <div className={`module-dock-item ${visible ? "" : "is-hidden"}`} key={item.id}>
                <span className="module-dock-icon" aria-hidden>
                  <NavigationGlyph name={item.icon} size={18} />
                </span>
                <span className="module-dock-copy">
                  <span className="module-dock-title">
                    <strong>{label.title}</strong>
                    <SettingsBadge>{item.source === "core" ? copy.core : copy.plugin}</SettingsBadge>
                  </span>
                  <small>{label.description}</small>
                </span>
                <span className="module-dock-actions">
                  <span className={`module-dock-state ${visible ? "is-visible" : ""}`}>
                    {visible ? copy.visible : copy.hidden}
                  </span>
                  <button
                    type="button"
                    className="module-dock-move ghost"
                    aria-label={`${copy.moveUp}: ${label.title}`}
                    title={copy.moveUp}
                    disabled={index === 0}
                    onClick={() => onMove(item.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="module-dock-move ghost"
                    aria-label={`${copy.moveDown}: ${label.title}`}
                    title={copy.moveDown}
                    disabled={index === ordered.length - 1}
                    onClick={() => onMove(item.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    role="switch"
                    className={visible ? "ghost module-dock-toggle" : "module-dock-toggle"}
                    aria-checked={visible}
                    onClick={() => onVisibilityChange(item.id, !visible)}
                  >
                    {visible ? copy.hide : copy.show}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <SettingsNotice tone="neutral" title={copy.fixedTitle}>
          {copy.fixedDescription}
        </SettingsNotice>
      </SettingsCard>
    </SettingsPage>
  );
}
