import type { CSSProperties } from "react";
import type { Key } from "../i18n";
import {
  canonicalPetSelector,
  OFFICIAL_HARA_PETS,
  officialPetCopy,
  type OfficialPet,
  type PetCatalogEntry,
} from "../pets";
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

interface PetCardProps {
  pet: PetCatalogEntry;
  selected: boolean;
  source: string;
  role?: string;
  imageUrl?: string;
  accent?: string;
  onSelect: (selector: string) => void;
}

function PetCard({
  pet,
  selected,
  source,
  role,
  imageUrl,
  accent,
  onSelect,
}: PetCardProps) {
  return (
    <button
      type="button"
      className={`pet-card ${selected ? "on" : ""} ${pet.compatible ? "" : "invalid"}`}
      disabled={!pet.compatible}
      title={pet.error || pet.description}
      aria-pressed={selected}
      onClick={() => onSelect(pet.selector)}
      style={accent ? { "--pet-card-accent": accent } as CSSProperties : undefined}
    >
      <span className={`pet-card-mark ${imageUrl ? "has-image" : ""}`}>
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" decoding="async" aria-hidden="true" />
        ) : (
          pet.displayName.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="pet-card-copy">
        <strong>{pet.displayName}</strong>
        <small>{role ? `${source} · ${role}` : `${source}${pet.spriteVersionNumber ? ` · v${pet.spriteVersionNumber}` : ""}`}</small>
      </span>
      {selected ? <span className="pet-selected">✓</span> : null}
    </button>
  );
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
  const locale = (localStorage.getItem("hara.locale") || navigator.language)
    .toLowerCase()
    .startsWith("zh") ? "zh" : "en";
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
        <section className="pet-collection" aria-labelledby="pet-official-title">
          <header className="pet-collection-header">
            <div>
              <strong id="pet-official-title">{t("petOfficialCollection")}</strong>
              <small>{t("petOfficialCollectionHint")}</small>
            </div>
            <span>{OFFICIAL_HARA_PETS.length}</span>
          </header>
          <div className="pet-grid pet-grid-official">
            {OFFICIAL_HARA_PETS.map((pet: OfficialPet) => {
              const copy = officialPetCopy(pet, locale);
              return (
                <PetCard
                  key={pet.selector}
                  pet={{ ...pet, displayName: copy.displayName, description: copy.description }}
                  selected={canonicalPetSelector(selector) === pet.selector}
                  source={t("petBuiltin")}
                  role={copy.role}
                  imageUrl={pet.imageUrl}
                  accent={pet.accent}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        </section>

        <section className="pet-collection" aria-labelledby="pet-local-title">
          <header className="pet-collection-header">
            <div>
              <strong id="pet-local-title">{t("petLocalCollection")}</strong>
              <small>{t("petLocalCollectionHint")}</small>
            </div>
            <span>{catalog.length}</span>
          </header>
          {catalog.length > 0 ? (
            <div className="pet-grid">
              {catalog.map((pet) => (
                <PetCard
                  key={pet.selector}
                  pet={pet}
                  selected={selector === pet.selector}
                  source={sourceLabel(pet, t)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ) : !error ? (
            <div className="settings-empty">{t("petNone")}</div>
          ) : null}
        </section>
        {error && <div className="settings-inline-error">{error}</div>}
      </SettingsCard>
    </SettingsPage>
  );
}
