import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRightIcon, CloudArrowUpIcon, LockClosedIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { makeT } from "./i18n";
import { ShellDialog } from "./WorkspaceShell";
import type { LocalChannelsView } from "./workspace-local-channels";
import { ChannelUpgradeModel, type ChannelUpgradeBridge, type ChannelUpgradeView } from "./workspace-channel-upgrade";
type Translate = ReturnType<typeof makeT>;

export function ChannelUpgradeDialog({ local, bridge, t, onClose }: { local: LocalChannelsView; bridge?: ChannelUpgradeBridge; t: Translate; onClose(): void }) {
  // The bridge owns the model lifetime. Reconcile local changes with sync below to invalidate stale work without recreating the intent on every render.
  const model = useMemo(() => new ChannelUpgradeModel(local, bridge), [bridge]);
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { model.sync(local); }, [model, local]);
  useEffect(() => () => { model.cancel(); }, [model]);
  useEffect(() => { setConfirmed(false); }, [view.preview, view.account]);
  const close = () => { model.cancel(); onClose(); };
  return <ChannelUpgradeDialogContent view={view} t={t} confirmed={confirmed} onConfirmed={setConfirmed} onClose={close}
    onContinue={() => void model.continue()} onSignIn={() => void model.signIn()} onUpgrade={() => void model.prepare(confirmed)} />;
}
export function ChannelUpgradeDialogContent({ view, t, confirmed, onConfirmed, onClose, onContinue, onSignIn, onUpgrade }: {
  view: ChannelUpgradeView; t: Translate; confirmed: boolean; onConfirmed(value: boolean): void; onClose(): void;
  onContinue(): void; onSignIn(): void; onUpgrade(): void;
}) {
  const busy = ["checking", "signing-in", "preparing"].includes(view.phase);
  const signingIn = view.phase === "sign-in" || view.phase === "signing-in";
  const confirming = view.phase === "confirm" || view.phase === "preparing";
  const step = confirming || view.phase === "blocked" ? 2 : signingIn ? 1 : 0;
  const notice = view.preview?.blocked ?? view.notice;
  const disabled = busy || !view.preview || Boolean(view.preview.blocked);
  return <ShellDialog label={t("ws.channels.invite")} onClose={onClose} className="hs-channel-dialog hs-channel-upgrade">
    <button type="button" className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={onClose}><XMarkIcon className="hico" /></button>
    <header className="hs-channel-dialog-head"><span className="hs-channel-mark" aria-hidden="true"><CloudArrowUpIcon className="hico" /></span>
      <h2>{t("ws.channels.inviteTitle")}</h2><p>{t("ws.channels.inviteBody")}</p></header>
    <div className="hs-channel-dialog-body">
      <ol className="hs-upgrade-steps" aria-label={t("ws.channels.upgrade.steps")}>{(["preview", "login", "cloud"] as const).map((item, index) =>
        <li key={item} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{t(`ws.channels.upgrade.step.${item}`)}{index < 2 ? <ArrowRightIcon className="hico" aria-hidden="true" /> : null}</li>)}</ol>
      <div className="hs-upgrade-source"><span className="hs-tag">{t("ws.channels.local")}</span><strong>#{view.preview?.name ?? t("ws.channels.upgrade.noSource")}</strong></div>
      <dl className="hs-upgrade-boundaries">
        <div><dt>{t("ws.channels.upgrade.newOnly.title")}</dt><dd>{t("ws.channels.upgrade.newOnly.body")}</dd></div>
        <div><dt>{t("ws.channels.upgrade.staysLocal.title")}</dt><dd>{t("ws.channels.upgrade.staysLocal.body")}</dd></div>
        <div><dt>{t("ws.channels.upgrade.audience.title")}</dt><dd>{t("ws.channels.upgrade.audience.body")}</dd></div>
      </dl>
      {signingIn ? <section className="hs-upgrade-sign-in" aria-labelledby="channel-upgrade-sign-in"><LockClosedIcon className="hico" aria-hidden="true" />
        <div><h3 id="channel-upgrade-sign-in">{t("ws.channels.upgrade.signIn.title")}</h3><p>{t("ws.channels.upgrade.signIn.body")}</p></div></section> : null}
      {confirming ? <section className="hs-upgrade-confirm" aria-labelledby="channel-upgrade-shared-space"><h3 id="channel-upgrade-shared-space">{t("ws.channels.upgrade.sharedSpace")}</h3><p>{t("ws.channels.upgrade.region", { region: view.account?.region ?? "—" })}</p>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => onConfirmed(event.currentTarget.checked)} /><span>{t("ws.channels.upgrade.confirm")}</span></label></section> : null}
      {notice ? <p className="wsd-notice" role="status">{t(`ws.channels.upgrade.notice.${notice}`)}</p> : !view.preview ? <p className="wsd-notice" role="status">{t("ws.channels.upgrade.noSource")}</p> : null}
    </div>
    <footer className="hs-channel-dialog-footer"><div className="wsd-card-actions">
      <button type="button" className="hs-btn sec" onClick={onClose}>{t("ws.channels.upgrade.back")}</button>
      {view.phase !== "blocked" ? <button type="button" className="hs-btn pri" aria-busy={busy} disabled={disabled || confirming && !confirmed}
        onClick={signingIn ? onSignIn : confirming ? onUpgrade : onContinue}>{t(busy ? "common.loading" : signingIn ? "ws.channels.upgrade.signIn.action" : confirming ? "ws.channels.upgrade.action" : "ws.channels.upgrade.continue")}</button> : null}
    </div><p className="hs-channel-local-note">{t("ws.channels.upgrade.unchanged")}</p></footer>
  </ShellDialog>;
}
