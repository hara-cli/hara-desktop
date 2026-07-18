import { IconBot, IconChat, IconCog, IconFolder } from "./icons";

export type AppPlace = "chat" | "projects" | "auto" | "settings";

interface AppRailLabels {
  mainNavigation: string;
  chat: string;
  projects: string;
  automations: string;
  settings: string;
  updateAvailable: string;
}

interface AppRailProps {
  activePlace: AppPlace;
  labels: AppRailLabels;
  assistantUnread: boolean;
  projectsUnread: boolean;
  automationUnread: number;
  updateAvailable: string;
  onSelect: (place: AppPlace) => void;
}

/**
 * Stable navigation for Hara's four physical places. It renders only place state;
 * session activation and ownership checks remain in App's controller.
 */
export function AppRail({
  activePlace,
  labels,
  assistantUnread,
  projectsUnread,
  automationUnread,
  updateAvailable,
  onSelect,
}: AppRailProps) {
  return (
    <nav className="rail" aria-label={labels.mainNavigation}>
      <button
        className={activePlace === "chat" ? "on" : ""}
        aria-label={labels.chat}
        aria-current={activePlace === "chat" ? "page" : undefined}
        title={`${labels.chat} ⌘1`}
        onClick={() => onSelect("chat")}
      >
        <IconChat size={19} />
        {assistantUnread && <span className="rdot" />}
      </button>
      <button
        className={activePlace === "projects" ? "on" : ""}
        aria-label={labels.projects}
        aria-current={activePlace === "projects" ? "page" : undefined}
        title={`${labels.projects} ⌘2`}
        onClick={() => onSelect("projects")}
      >
        <IconFolder size={19} />
        {projectsUnread && <span className="rdot" />}
      </button>
      <button
        className={activePlace === "auto" ? "on" : ""}
        aria-label={labels.automations}
        aria-current={activePlace === "auto" ? "page" : undefined}
        title={`${labels.automations} ⌘3`}
        onClick={() => onSelect("auto")}
      >
        <IconBot size={19} />
        {automationUnread > 0 && (
          <span className="chip">{automationUnread > 9 ? "9+" : automationUnread}</span>
        )}
      </button>
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
        onClick={() => onSelect("settings")}
      >
        <IconCog size={18} />
        {updateAvailable && <span className="rdot" />}
      </button>
    </nav>
  );
}
