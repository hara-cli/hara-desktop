import type { Key } from "../i18n";
import { BUILTIN_HARA_PET, type PetCatalogEntry } from "../pets";
import {
  SettingsBadge,
  SettingsCard,
  SettingsItem,
  SettingsPage,
} from "../SettingsUI";

interface DesktopCompanionSettingsProps {
  t: (key: Key) => string;
  awake: boolean;
  selector: string;
  catalog: PetCatalogEntry[];
  error: string;
  onToggleAwake: () => void;
  onRefresh: () => void;
  onSelect: (selector: string) => void;
}

function sourceLabel(pet: PetCatalogEntry, t: DesktopCompanionSettingsProps["t"]): string {
  switch (pet.source) {
    case "builtin":
      return t("petBuiltin");
    case "codex-local":
      return t("petCodex");
    case "hara-market":
      return t("petMarket");
    case "hara-local":
      return t("petHaraLocal");
  }
}

/** Main-window equivalent controls for the deliberately non-focusable companion overlay. */
export function DesktopCompanionSettings({
  t,
  awake,
  selector,
  catalog,
  error,
  onToggleAwake,
  onRefresh,
  onSelect,
}: DesktopCompanionSettingsProps) {
  const entries = [BUILTIN_HARA_PET, ...catalog];
  return (
    <SettingsPage
      id="settings-pet-title"
      eyebrow={t("settingsPersonalize")}
      title={t("setPets")}
      description={t("petHint")}
    >
      <SettingsCard
        title={t("petCompanionTitle")}
        description={t("petCompanionHint")}
        aside={
          <SettingsBadge tone={awake ? "success" : "neutral"}>
            {awake ? t("petAwake") : t("petAsleep")}
          </SettingsBadge>
        }
      >
        <SettingsItem title={t("petVisibility")} description={t("petVisibilityHint")}>
          <div className="settings-choice">
            <button type="button" onClick={onToggleAwake}>
              {awake ? t("petTuck") : t("petWake")}
            </button>
            <button type="button" className="ghost" onClick={onRefresh}>
              {t("petRefresh")}
            </button>
          </div>
        </SettingsItem>
      </SettingsCard>

      <SettingsCard title={t("petChoose")} description={t("petChooseHint")}>
        <div className="pet-grid">
          {entries.map((pet) => (
            <button
              type="button"
              key={pet.selector}
              className={`pet-card ${selector === pet.selector ? "on" : ""} ${
                pet.compatible ? "" : "invalid"
              }`}
              disabled={!pet.compatible}
              title={pet.error || pet.description}
              aria-pressed={selector === pet.selector}
              onClick={() => onSelect(pet.selector)}
            >
              <span className="pet-card-mark">
                {pet.selector === BUILTIN_HARA_PET.selector
                  ? "ハ"
                  : pet.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="pet-card-copy">
                <strong>{pet.displayName}</strong>
                <small>
                  {sourceLabel(pet, t)}
                  {pet.spriteVersionNumber ? ` · v${pet.spriteVersionNumber}` : ""}
                </small>
              </span>
              {selector === pet.selector && <span className="pet-selected">✓</span>}
            </button>
          ))}
        </div>
        {catalog.length === 0 && !error && <div className="settings-empty">{t("petNone")}</div>}
        {error && <div className="settings-inline-error">{error}</div>}
      </SettingsCard>
    </SettingsPage>
  );
}
