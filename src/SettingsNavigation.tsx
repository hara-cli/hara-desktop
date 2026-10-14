export type SettingsSection =
  | "providers"
  | "connections"
  | "automations"
  | "learning"
  | "engine"
  | "security"
  | "mobile"
  | "lang"
  | "capabilities";

export const SETTINGS_NAVIGATION_GROUPS = [
  { id: "work", items: ["providers", "connections", "automations", "learning", "capabilities"] },
  { id: "app", items: ["engine", "security", "mobile", "lang"] },
] as const satisfies readonly { id: "work" | "app"; items: readonly SettingsSection[] }[];

interface SettingsNavigationProps {
  section: SettingsSection;
  label: string;
  groupLabels: Record<"work" | "app", string>;
  labels: Record<SettingsSection, string>;
  automationCount?: number;
  onIntent: (section: SettingsSection) => void;
  onSelect: (section: SettingsSection) => void;
}

/** Navigation only. Workspace ownership and permission checks stay with the actual settings APIs. */
export function SettingsNavigation({ section, label, groupLabels, labels, automationCount = 0, onIntent, onSelect }: SettingsNavigationProps) {
  return (
    <nav className="sessions setlist" aria-label={label}>
      {SETTINGS_NAVIGATION_GROUPS.map((group) => (
        <div className="setnav-group" role="group" aria-labelledby={`settings-nav-${group.id}`} key={group.id}>
          <div className="setnav-label" id={`settings-nav-${group.id}`}>{groupLabels[group.id]}</div>
          {group.items.map((item) => (
            <button type="button" key={item} className={`setnav ${section === item ? "on" : ""}`}
              aria-current={section === item ? "page" : undefined}
              onMouseEnter={() => onIntent(item)} onFocus={() => onIntent(item)}
              onClick={() => onSelect(item)}>
              {labels[item]}
              {item === "automations" && automationCount > 0 ? (
                <span className="settings-automation-count">{automationCount}</span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
