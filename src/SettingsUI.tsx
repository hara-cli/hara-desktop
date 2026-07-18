import type { ReactNode } from "react";

interface SettingsPageProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}

interface SettingsCardProps {
  title: string;
  description?: string;
  aside?: ReactNode;
  children?: ReactNode;
}

interface SettingsItemProps {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}

interface SettingsNoticeProps {
  tone?: "neutral" | "success" | "warning" | "error";
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

/** Shared settings-page frame. Ordinary users should see a purpose and outcome before controls. */
export function SettingsPage({
  id,
  eyebrow,
  title,
  description,
  actions,
  children,
}: SettingsPageProps) {
  return (
    <section className="settings-page" aria-labelledby={id}>
      <header className="settings-page-head">
        <div>
          <div className="settings-eyebrow">{eyebrow}</div>
          <h1 id={id}>{title}</h1>
          <p>{description}</p>
        </div>
        {actions && <div className="settings-page-actions">{actions}</div>}
      </header>
      <div className="settings-page-body">{children}</div>
    </section>
  );
}

/** A bounded preference group; avoids scattering one-off rows through an otherwise empty stage. */
export function SettingsCard({ title, description, aside, children }: SettingsCardProps) {
  return (
    <section className="settings-card">
      <header className="settings-card-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {aside && <div className="settings-card-aside">{aside}</div>}
      </header>
      {children && <div className="settings-card-body">{children}</div>}
    </section>
  );
}

/** Label/explanation/control alignment shared by language, safety, updater, and future Office settings. */
export function SettingsItem({ title, description, htmlFor, children }: SettingsItemProps) {
  return (
    <div className="settings-item">
      <div className="settings-item-copy">
        {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <strong>{title}</strong>}
        {description && <small>{description}</small>}
      </div>
      <div className="settings-item-control">{children}</div>
    </div>
  );
}

export function SettingsNotice({
  tone = "neutral",
  title,
  children,
  actions,
}: SettingsNoticeProps) {
  return (
    <div
      className={`settings-notice ${tone}`}
      role={tone === "warning" || tone === "error" ? "alert" : "status"}
    >
      <span className="settings-notice-mark" aria-hidden />
      <div className="settings-notice-copy">
        <strong>{title}</strong>
        {children && <small>{children}</small>}
      </div>
      {actions && <div className="settings-notice-actions">{actions}</div>}
    </div>
  );
}

export function SettingsBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return <span className={`settings-badge ${tone}`}>{children}</span>;
}
