import { useMemo, useRef, useState } from "react";

import type {
  PanelSpec,
  PluginInfo,
  SkillInfo,
} from "./client";
import {
  SettingsBadge,
  SettingsCard,
  SettingsNotice,
  SettingsPage,
} from "./SettingsUI";
import {
  IconArrowRight,
  IconChat,
  IconOffice,
  IconSearch,
  IconSparkles,
  IconTasks,
  IconUsers,
} from "./icons";
import "./CapabilityDirectory.css";

type DirectoryView = "hara" | "organization" | "market" | "installed" | "skills";
const DIRECTORY_VIEWS: DirectoryView[] = [
  "hara",
  "organization",
  "market",
  "installed",
  "skills",
];

interface CoreCapability {
  id: string;
  title: string;
  description: string;
}

interface OrganizationCapabilityContext {
  label: string;
  model: string;
  deskConnected: boolean;
  deskHost?: string;
}

interface CapabilityDirectoryCopy {
  eyebrow: string;
  title: string;
  description: string;
  search: string;
  hara: string;
  organization: string;
  market: string;
  installed: string;
  mySkills: string;
  included: string;
  openCore: string;
  open: string;
  currentOrganization: string;
  noOrganization: string;
  noOrganizationHint: string;
  modelRoute: string;
  organizationDesk: string;
  connected: string;
  notProvided: string;
  organizationCatalogHint: string;
  marketTitle: string;
  marketHint: string;
  marketGateTitle: string;
  marketGateHint: string;
  installedTitle: string;
  installedHint: string;
  loading: string;
  empty: string;
  installHint: string;
  recipes: string;
  specialists: string;
  connections: string;
  enable: string;
  disable: string;
  enabled: string;
  disabled: string;
  showPanelInSidebar: string;
  hidePanelFromSidebar: string;
  noResults: string;
  createSkill: string;
  skillConversationStarting: string;
  skillBuilderTitle: string;
  skillBuilderDescription: string;
  skillBuilderSafetyTitle: string;
  skillBuilderSafetyDescription: string;
  availableSkills: string;
  availableSkillsHint: string;
  noSkills: string;
  skillSourceProject: string;
  skillSourcePersonal: string;
  skillSourceCapability: string;
}

interface CapabilityDirectoryProps {
  copy: CapabilityDirectoryCopy;
  core: CoreCapability[];
  plugins: PluginInfo[] | null;
  skills: SkillInfo[] | null;
  organization?: OrganizationCapabilityContext;
  isSkillCreating: boolean;
  isPanelBusy: (pluginName: string, panelId: string) => boolean;
  onCreateSkill: () => void;
  onOpenCore: (id: string) => void;
  onTogglePlugin: (name: string, enabled: boolean) => void;
  onOpenPanel: (pluginName: string, panel: PanelSpec) => void;
  panelInDock: (pluginName: string, panelId: string) => boolean;
  onTogglePanelInDock: (pluginName: string, panelId: string, visible: boolean) => void;
}

const normalized = (value: string): string => value.trim().toLocaleLowerCase();

const coreCapabilityIcon = (id: string) => {
  if (id === "core.chat") return <IconChat size={19} />;
  if (id === "core.tasks") return <IconTasks size={19} />;
  if (id === "core.groups") return <IconUsers size={19} />;
  if (id === "core.office") return <IconOffice size={19} />;
  return <IconSparkles size={19} />;
};

export function CapabilityDirectory({
  copy,
  core,
  plugins,
  skills,
  organization,
  isSkillCreating,
  isPanelBusy,
  onCreateSkill,
  onOpenCore,
  onTogglePlugin,
  onOpenPanel,
  panelInDock,
  onTogglePanelInDock,
}: CapabilityDirectoryProps) {
  const [view, setView] = useState<DirectoryView>("hara");
  const [query, setQuery] = useState("");
  const tabRefs = useRef<Record<DirectoryView, HTMLButtonElement | null>>({
    hara: null,
    organization: null,
    market: null,
    installed: null,
    skills: null,
  });
  const needle = normalized(query);
  const visibleCore = useMemo(
    () => core.filter((item) =>
      !needle || normalized(`${item.title} ${item.description}`).includes(needle)),
    [core, needle],
  );
  const visiblePlugins = useMemo(
    () => (plugins ?? []).filter((item) =>
      !needle || normalized(`${item.name} ${item.description}`).includes(needle)),
    [plugins, needle],
  );
  const visibleSkills = useMemo(
    () => (skills ?? []).filter((item) =>
      !needle || normalized(`${item.id} ${item.description}`).includes(needle)),
    [skills, needle],
  );
  const selectView = (next: DirectoryView, focus = false) => {
    setView(next);
    setQuery("");
    if (focus) queueMicrotask(() => tabRefs.current[next]?.focus());
  };
  const moveTabFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: DirectoryView,
  ) => {
    let nextIndex: number | undefined;
    const currentIndex = DIRECTORY_VIEWS.indexOf(current);
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % DIRECTORY_VIEWS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + DIRECTORY_VIEWS.length) % DIRECTORY_VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = DIRECTORY_VIEWS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectView(DIRECTORY_VIEWS[nextIndex], true);
  };

  return (
    <SettingsPage
      id="settings-capabilities-title"
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <div className={`capability-directory-toolbar is-${view}`}>
        <div className="capability-directory-tabs" role="tablist" aria-label={copy.title}>
          {([
            ["hara", copy.hara],
            ["organization", copy.organization],
            ["market", copy.market],
            ["installed", copy.installed],
            ["skills", copy.mySkills],
          ] as const).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              id={`capability-tab-${id}`}
              aria-controls={`capability-panel-${id}`}
              aria-selected={view === id}
              tabIndex={view === id ? 0 : -1}
              className={view === id ? "is-active" : ""}
              key={id}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              onClick={() => selectView(id)}
              onKeyDown={(event) => moveTabFocus(event, id)}
            >
              {label}
              {id === "installed" && plugins ? <span>{plugins.length}</span> : null}
              {id === "skills" && skills ? <span>{skills.length}</span> : null}
            </button>
          ))}
        </div>
        {view === "hara" || view === "installed" || view === "skills" ? (
          <label className="capability-directory-search">
            <IconSearch size={15} />
            <input
              type="search"
              value={query}
              placeholder={copy.search}
              aria-label={copy.search}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      {view === "hara" ? (
        <section
          role="tabpanel"
          id="capability-panel-hara"
          aria-labelledby="capability-tab-hara"
        >
          <SettingsCard title={copy.hara} description={copy.included}>
            <div className="capability-directory-grid">
              {visibleCore.map((item, index) => (
                <button
                  type="button"
                  className="capability-directory-card is-core"
                  key={item.id}
                  data-capability={item.id}
                  aria-label={`${copy.open}: ${item.title}`}
                  onClick={() => onOpenCore(item.id)}
                >
                  <span className="capability-directory-card-top">
                    <span className="capability-directory-icon" aria-hidden>
                      {coreCapabilityIcon(item.id)}
                    </span>
                    <span className="capability-directory-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <div className="capability-directory-card-head">
                    <strong>{item.title}</strong>
                    <SettingsBadge>{copy.openCore}</SettingsBadge>
                  </div>
                  <p>{item.description}</p>
                  <span className="capability-directory-card-footer">
                    <span className="capability-directory-state">{copy.included}</span>
                    <span className="capability-directory-open">
                      {copy.open}
                      <IconArrowRight size={13} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {visibleCore.length === 0 ? (
              <div className="settings-empty">{copy.noResults}</div>
            ) : null}
          </SettingsCard>
        </section>
      ) : null}

      {view === "organization" ? (
        <section
          role="tabpanel"
          id="capability-panel-organization"
          aria-labelledby="capability-tab-organization"
        >
          <SettingsCard
            title={organization?.label ?? copy.currentOrganization}
            description={copy.organizationCatalogHint}
          >
            {!organization ? (
              <div className="settings-empty capability-organization-empty">
                <strong>{copy.noOrganization}</strong>
                <span>{copy.noOrganizationHint}</span>
              </div>
            ) : (
              <div className="capability-organization-bundle">
                <div>
                  <span>{copy.modelRoute}</span>
                  <strong>{organization.model || "—"}</strong>
                  <SettingsBadge>{copy.connected}</SettingsBadge>
                </div>
                <div>
                  <span>{copy.organizationDesk}</span>
                  <strong>{organization.deskHost || copy.notProvided}</strong>
                  <SettingsBadge>
                    {organization.deskConnected ? copy.connected : copy.notProvided}
                  </SettingsBadge>
                </div>
              </div>
            )}
          </SettingsCard>
        </section>
      ) : null}

      {view === "market" ? (
        <section
          role="tabpanel"
          id="capability-panel-market"
          aria-labelledby="capability-tab-market"
        >
          <SettingsCard title={copy.marketTitle} description={copy.marketHint}>
            <SettingsNotice tone="neutral" title={copy.marketGateTitle}>
              {copy.marketGateHint}
            </SettingsNotice>
          </SettingsCard>
        </section>
      ) : null}

      {view === "installed" ? (
        <section
          role="tabpanel"
          id="capability-panel-installed"
          aria-labelledby="capability-tab-installed"
        >
          <SettingsCard title={copy.installedTitle} description={copy.installedHint}>
            {!plugins ? (
              <div className="settings-empty">{copy.loading}</div>
            ) : visiblePlugins.length === 0 ? (
              <div className="settings-empty">
                <strong>{needle ? copy.noResults : copy.empty}</strong>
                {!needle ? <span>{copy.installHint}</span> : null}
              </div>
            ) : (
              <div className="settings-capability-list capability-installed-list">
                {visiblePlugins.map((plugin) => (
                  <div key={plugin.name} className="plug">
                    <div className="plug-main">
                      <div className="plug-name">
                        {plugin.name} <span className="dim">v{plugin.version}</span>
                      </div>
                      <div className="plug-description">{plugin.description}</div>
                      <div className="plug-meta dim">
                        {plugin.skills} {copy.recipes} · {plugin.agents} {copy.specialists} ·{" "}
                        {plugin.mcpServers} {copy.connections}
                      </div>
                    </div>
                    <span className="settings-capability-actions">
                      {plugin.enabled && (plugin.panels ?? []).map((panel) => {
                        const inDock = panelInDock(plugin.name, panel.id);
                        const busy = isPanelBusy(plugin.name, panel.id);
                        return (
                          <span className="capability-panel-actions" key={panel.id}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onOpenPanel(plugin.name, panel)}
                            >
                              {busy ? "…" : panel.title}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              aria-pressed={inDock}
                              aria-label={`${inDock ? copy.hidePanelFromSidebar : copy.showPanelInSidebar}: ${panel.title}`}
                              onClick={() => onTogglePanelInDock(plugin.name, panel.id, !inDock)}
                            >
                              {inDock ? copy.hidePanelFromSidebar : copy.showPanelInSidebar}
                            </button>
                          </span>
                        );
                      })}
                      <button
                        type="button"
                        className={plugin.enabled ? "" : "ghost"}
                        aria-pressed={plugin.enabled}
                        aria-label={`${plugin.name}: ${plugin.enabled ? copy.disable : copy.enable}`}
                        onClick={() => onTogglePlugin(plugin.name, !plugin.enabled)}
                      >
                        {plugin.enabled ? copy.enabled : copy.disabled}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SettingsCard>
        </section>
      ) : null}

      {view === "skills" ? (
        <section
          className="capability-skills-panel"
          role="tabpanel"
          id="capability-panel-skills"
          aria-labelledby="capability-tab-skills"
        >
          <SettingsCard
            title={copy.skillBuilderTitle}
            description={copy.skillBuilderDescription}
            aside={(
              <button type="button" disabled={isSkillCreating} onClick={onCreateSkill}>
                {isSkillCreating ? copy.skillConversationStarting : copy.createSkill}
              </button>
            )}
          >
            <SettingsNotice title={copy.skillBuilderSafetyTitle}>
              {copy.skillBuilderSafetyDescription}
            </SettingsNotice>
          </SettingsCard>
          <SettingsCard title={copy.availableSkills} description={copy.availableSkillsHint}>
            {skills === null ? (
              <div className="settings-empty">{copy.loading}</div>
            ) : visibleSkills.length === 0 ? (
              <div className="settings-empty">
                <strong>{needle ? copy.noResults : copy.noSkills}</strong>
              </div>
            ) : (
              <div className="settings-skill-list">
                {visibleSkills.map((skill) => (
                  <div key={skill.id} className="skill">
                    <span>
                      <strong className="skill-id">{skill.id}</strong>
                      <small title={skill.description}>{skill.description}</small>
                    </span>
                    <SettingsBadge>
                      {skill.source === "project"
                        ? copy.skillSourceProject
                        : skill.source === "global"
                          ? copy.skillSourcePersonal
                          : skill.source === "plugin"
                            ? copy.skillSourceCapability
                            : skill.source}
                    </SettingsBadge>
                  </div>
                ))}
              </div>
            )}
          </SettingsCard>
        </section>
      ) : null}
    </SettingsPage>
  );
}
