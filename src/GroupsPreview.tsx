import type { ReactNode } from "react";

import { IconUsers } from "./icons";

export interface GroupsPreviewCopy {
  sidebarTitle: string;
  disabled: string;
  sidebarHint: string;
  eyebrow: string;
  title: string;
  description: string;
  entryVisible: string;
  entryVisibleHint: string;
  remoteOff: string;
  remoteOffHint: string;
  publicTitle: string;
  publicHint: string;
  organizationTitle: string;
  organizationHint: string;
  boundaryTitle: string;
  boundaryHint: string;
  manage: string;
  hide: string;
}

export function GroupsSidebar({
  brand,
  footer,
  copy,
}: {
  brand: ReactNode;
  footer: ReactNode;
  copy: GroupsPreviewCopy;
}) {
  return (
    <aside className="sidebar groups-sidebar">
      {brand}
      <div className="groups-sidebar-heading">
        <span className="groups-sidebar-mark" aria-hidden>
          <IconUsers size={18} />
        </span>
        <span>
          <strong>{copy.sidebarTitle}</strong>
          <small>{copy.disabled}</small>
        </span>
      </div>
      <div className="groups-sidebar-status">
        <span className="groups-status-light" aria-hidden />
        <span>{copy.remoteOff}</span>
      </div>
      <p>{copy.sidebarHint}</p>
      <div className="groups-sidebar-space" />
      {footer}
    </aside>
  );
}

export default function GroupsPreview({
  copy,
  onManage,
  onHide,
}: {
  copy: GroupsPreviewCopy;
  onManage: () => void;
  onHide: () => void;
}) {
  return (
    <main className="groups-stage" aria-labelledby="groups-preview-title">
      <div className="groups-stage-grid" aria-hidden />
      <div className="groups-stage-shell">
        <header className="groups-stage-head">
          <div>
            <span className="groups-eyebrow">{copy.eyebrow}</span>
            <h1 id="groups-preview-title">{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <span className="groups-local-seal">{copy.disabled}</span>
        </header>

        <section className="groups-boundary-panel">
          <div className="groups-boundary-state">
            <span className="groups-state-index">01</span>
            <span>
              <strong>{copy.entryVisible}</strong>
              <small>{copy.entryVisibleHint}</small>
            </span>
          </div>
          <div className="groups-boundary-rule" aria-hidden />
          <div className="groups-boundary-state is-off">
            <span className="groups-state-index">02</span>
            <span>
              <strong>{copy.remoteOff}</strong>
              <small>{copy.remoteOffHint}</small>
            </span>
          </div>
        </section>

        <div className="groups-lanes">
          <section className="groups-lane">
            <span className="groups-lane-index">A / PUBLIC</span>
            <h2>{copy.publicTitle}</h2>
            <p>{copy.publicHint}</p>
            <span className="groups-lane-route" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </section>
          <section className="groups-lane">
            <span className="groups-lane-index">B / ORGANIZATION</span>
            <h2>{copy.organizationTitle}</h2>
            <p>{copy.organizationHint}</p>
            <span className="groups-lane-route" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </section>
        </div>

        <section className="groups-safety-note">
          <span className="groups-safety-code">LOCAL / 00</span>
          <span>
            <strong>{copy.boundaryTitle}</strong>
            <small>{copy.boundaryHint}</small>
          </span>
          <div className="groups-stage-actions">
            <button type="button" onClick={onManage}>
              {copy.manage}
            </button>
            <button type="button" className="ghost" onClick={onHide}>
              {copy.hide}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
