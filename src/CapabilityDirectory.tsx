import { useMemo, useRef, useState } from "react";

import type {
  PanelSpec,
  PluginInfo,
} from "./client";
import {
  SettingsBadge,
  SettingsCard,
  SettingsNotice,
  SettingsPage,
} from "./SettingsUI";

type DirectorySource = "hara" | "organization" | "market" | "installed";
const DIRECTORY_SOURCES: DirectorySource[] = [
  "hara",
  "organization",
  "market",
  "installed",
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
  included: string;
  openCore: string;
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
  noResults: string;
}

interface CapabilityDirectoryProps {
  copy: CapabilityDirectoryCopy;
  core: CoreCapability[];
  plugins: PluginInfo[] | null;
  organization?: OrganizationCapabilityContext;
  panelBusy: string;
  onTogglePlugin: (name: string, enabled: boolean) => void;
  onOpenPanel: (pluginName: string, panel: PanelSpec) => void;
}

const normalized = (value: string): string => value.trim().toLocaleLowerCase();

export function CapabilityDirectory({
  copy,
  core,
  plugins,
  organization,
  panelBusy,
  onTogglePlugin,
  onOpenPanel,
}: CapabilityDirectoryProps) {
  const [source, setSource] = useState<DirectorySource>("hara");
  const [query, setQuery] = useState("");
  const tabRefs = useRef<Record<DirectorySource, HTMLButtonElement | null>>({
    hara: null,
    organization: null,
    market: null,
    installed: null,
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
  const selectSource = (next: DirectorySource, focus = false) => {
    setSource(next);
    setQuery("");
    if (focus) queueMicrotask(() => tabRefs.current[next]?.focus());
  };
  const moveTabFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: DirectorySource,
  ) => {
    let nextIndex: number | undefined;
    const currentIndex = DIRECTORY_SOURCES.indexOf(current);
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % DIRECTORY_SOURCES.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + DIRECTORY_SOURCES.length) % DIRECTORY_SOURCES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = DIRECTORY_SOURCES.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectSource(DIRECTORY_SOURCES[nextIndex], true);
  };

  return (
    <SettingsPage
      id="settings-capabilities-title"
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <div className={`capability-directory-toolbar is-${source}`}>
        <div className="capability-directory-tabs" role="tablist" aria-label={copy.title}>
          {([
            ["hara", copy.hara],
            ["organization", copy.organization],
            ["market", copy.market],
            ["installed", copy.installed],
          ] as const).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              id={`capability-tab-${id}`}
              aria-controls={`capability-panel-${id}`}
              aria-selected={source === id}
              tabIndex={source === id ? 0 : -1}
              className={source === id ? "is-active" : ""}
              key={id}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              onClick={() => selectSource(id)}
              onKeyDown={(event) => moveTabFocus(event, id)}
            >
              {label}
              {id === "installed" && plugins ? <span>{plugins.length}</span> : null}
            </button>
          ))}
        </div>
        {source === "hara" || source === "installed" ? (
          <input
            type="search"
            value={query}
            placeholder={copy.search}
            aria-label={copy.search}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
      </div>

      {source === "hara" ? (
        <section
          role="tabpanel"
          id="capability-panel-hara"
          aria-labelledby="capability-tab-hara"
        >
          <SettingsCard title={copy.hara} description={copy.included}>
            <div className="capability-directory-grid">
              {visibleCore.map((item, index) => (
                <article className="capability-directory-card is-core" key={item.id}>
                  <span className="capability-directory-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="capability-directory-card-head">
                    <strong>{item.title}</strong>
                    <SettingsBadge>{copy.openCore}</SettingsBadge>
                  </div>
                  <p>{item.description}</p>
                  <span className="capability-directory-state">{copy.included}</span>
                </article>
              ))}
            </div>
            {visibleCore.length === 0 ? (
              <div className="settings-empty">{copy.noResults}</div>
            ) : null}
          </SettingsCard>
        </section>
      ) : null}

      {source === "organization" ? (
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

      {source === "market" ? (
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

      {source === "installed" ? (
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
                      {plugin.enabled && (plugin.panels ?? []).map((panel) => (
                        <button
                          type="button"
                          key={panel.id}
                          disabled={panelBusy === panel.id}
                          onClick={() => onOpenPanel(plugin.name, panel)}
                        >
                          {panelBusy === panel.id ? "…" : panel.title}
                        </button>
                      ))}
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
    </SettingsPage>
  );
}
