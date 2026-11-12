import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { HaraMascot } from "./HaraMascot";
import type { MascotState } from "./hara-mascot";
import type { Key } from "./i18n";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import type { WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";
import { markOnboardingSeen, onboardingFields, onboardingSeen, onboardingSurface, ONBOARDING_STEPS, stepsLeft,
  type OnboardingFields, type OnboardingProgress, type OnboardingStep } from "./workspace-onboarding-state";
import "./workspace-onboarding.css";

/**
 * Getting-started guide shell (design `inbox/2026-11-11-uiux-onboarding-design.md`, hub `hd-ob-*`): a full-window sheet
 * over the empty workspace with the mascot, three-step progress, «Later», Back and the step's own actions; plus the
 * resume card at the top of the Hara chat. Step bodies are separate components (O2 engine, O3 third-party, step 3 after C5).
 */
export const STEP_NAME: Record<OnboardingStep, Key> = { 1: "ws.onboarding.step.engine", 2: "ws.onboarding.step.thirdParty", 3: "ws.onboarding.step.colleagues" };

export interface OnboardingSheetCommon { step: OnboardingStep; readOnly: boolean; busy: boolean; notice: "" | Key; onLater: () => void; onBack?: () => void }
export function OnboardingSheet({ step, readOnly, busy, notice, onLater, onBack, title, sub, mascot = "idle", note, actions, children }: OnboardingSheetCommon & {
  title: string; sub: string; mascot?: MascotState; note?: ReactNode; actions: ReactNode; children: ReactNode;
}) {
  const { t } = useWorkspaceLocale();
  const titleId = useId(), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  return <div className="wob-scrim" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && ["i", ","].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onLater(); return; }
    if (event.key !== "Tab") return;
    // Same Tab cycle as ShellDialog: focus stays inside the sheet while it is open (review of #82, G-1).
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')).filter(node => node.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1], active = document.activeElement;
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
  }}>
    <section className="wob-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-onboarding-step={step}>
      <header className="wob-top">
        <HaraMascot state={mascot} size={128} decorative className="wob-mascot" />
        <div className="wob-title"><h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2><p>{sub}</p></div>
        <button type="button" className="wob-later" onClick={onLater}>{t("ws.onboarding.later")}</button>
      </header>
      <ol className="wob-steps" aria-label={t("ws.onboarding.progress", { n: step })}>
        {ONBOARDING_STEPS.map(n => <li key={n} className={n === step ? "is-current" : n < step ? "is-done" : ""} aria-current={n === step ? "step" : undefined}>
          <i aria-hidden>{n < step ? "✓" : n}</i>{t(STEP_NAME[n])}{n === 2 ? <small> · {t("ws.onboarding.optional")}</small> : null}
          {n < step ? <span className="wob-sr">{t("ws.onboarding.stepDone")}</span> : null}</li>)}
      </ol>
      <div className="wob-body">
        {readOnly ? <p className="wob-notice" role="status">{t("ws.onboarding.readOnly")}</p> : null}
        {notice ? <p className="wob-notice is-error" role="alert">{t(notice)}</p> : null}
        {children}
      </div>
      <footer className="wob-foot">
        <span className="wob-foot-note">{note}</span>
        {onBack ? <button type="button" disabled={busy} onClick={onBack}>{t("ws.onboarding.back")}</button> : null}
        {actions}
      </footer>
    </section>
  </div>;
}

export interface OnboardingStepProps { progress: OnboardingProgress; sheet: OnboardingSheetCommon; next: (patch?: Partial<OnboardingFields>) => void }
export type OnboardingStepViews = Partial<Record<OnboardingStep, ComponentType<OnboardingStepProps>>>;
/** Shipped step bodies. Empty until O2/O3/step 3 land; the guide is gated off until then (ONBOARDING_STEPS_READY). */
export const ONBOARDING_STEP_VIEWS: OnboardingStepViews = {};

export function OnboardingResumeCard({ progress, notice = "", onContinue, onStop }: { progress: OnboardingProgress; notice?: "" | Key; onContinue: () => void; onStop: () => void }) {
  const { t } = useWorkspaceLocale();
  const left = stepsLeft(progress.step), name = t(STEP_NAME[progress.step]);
  return <section className="wob-resume" aria-label={t("ws.onboarding.label")}>
    <HaraMascot state="wait" variant="face" size={32} decorative />
    <p><strong>{left === 1 ? t("ws.onboarding.resumeOne", { step: name }) : t("ws.onboarding.resumeMany", { n: left, step: name })}</strong></p>
    <div className="wob-resume-actions">
      <button type="button" className="hs-btn pri" onClick={onContinue}>{t("ws.onboarding.continue")}</button>
      <button type="button" className="hs-btn" onClick={onStop}>{t(progress.readOnly ? "ws.onboarding.hide" : "ws.onboarding.stop")}</button>
    </div>
    {notice ? <p className="wob-notice is-error" role="alert">{t(notice)}</p> : null}
  </section>;
}

/** Loads G4 progress for the open workspace and decides between nothing, the sheet and the resume card. */
export function useWorkspaceOnboarding(model: WorkspaceDevModel, workspace: WorkspaceDevSnapshot | null | undefined, steps: OnboardingStepViews = ONBOARDING_STEP_VIEWS) {
  // Stub models in older tests and lab entries may not have the method; no method means no guide.
  const supported = typeof model.supportsOnboarding === "function" && model.supportsOnboarding();
  const workspaceId = workspace?.workspaceId, generation = workspace?.resourceGeneration;
  const colleagues = useRef(0);
  colleagues.current = workspace?.agents.filter(agent => agent.kind === "colleague" && agent.state === "active").length ?? 0;
  const [progress, setProgress] = useState<OnboardingProgress | null>(null), [open, setOpen] = useState(false), [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<"" | Key>("");
  useEffect(() => {
    setProgress(null); setOpen(false); setHidden(false); setNotice("");
    if (!supported || !workspaceId || !generation) return;
    let active = true;
    void model.onboarding(workspaceId, generation).then(value => {
      if (!active) return; setProgress(value);
      if (onboardingSurface(value, { seen: onboardingSeen(workspaceId, value.runId), colleagues: colleagues.current }) === "sheet") { markOnboardingSeen(workspaceId, value.runId); setOpen(true); }
    }).catch(() => { /* No record, an old Core or a changed scope: show nothing. */ });
    return () => { active = false; };
  }, [model, supported, workspaceId, generation]);
  const save = useCallback(async (patch: Partial<OnboardingFields>) => {
    if (!progress || !workspaceId || !generation || busy) return false;
    if (progress.readOnly) { setProgress({ ...progress, ...patch }); return true; }
    setBusy(true); setNotice("");
    try { setProgress(await model.saveOnboarding({ ...onboardingFields(progress), ...patch }, progress.revision, workspaceId, generation)); return true; }
    catch { setNotice("ws.onboarding.saveFailed"); void model.onboarding(workspaceId, generation).then(setProgress).catch(() => {}); return false; }
    finally { setBusy(false); }
  }, [model, progress, workspaceId, generation, busy]);
  // A step without a shipped view never becomes a modal: otherwise the workspace would be inert with nothing on top (review of #82, G-2).
  const hasView = !!progress && !!steps[progress.step];
  const surface = open && hasView ? "sheet" : hidden || !progress ? "none" : onboardingSurface(progress, { seen: true, colleagues: colleagues.current });
  return {
    progress, surface, busy, notice,
    open: () => { if (progress && workspaceId && hasView) { markOnboardingSeen(workspaceId, progress.runId); setNotice(""); setOpen(true); } },
    later: () => { setOpen(false); setNotice(""); },
    // If the write fails the card comes back with the error, so the user isn't told it is gone when it isn't (review of #82, L1).
    stop: () => { setHidden(true); void save({ dismissed: true }).then(ok => { if (!ok) setHidden(false); }); },
    next: (patch: Partial<OnboardingFields> = {}) => { if (progress) void save({ ...patch, step: Math.min(3, progress.step + 1) as OnboardingStep }); },
    back: () => { if (progress && progress.step > 1) void save({ step: (progress.step - 1) as OnboardingStep }); },
  };
}

export function WorkspaceOnboarding({ state, steps = ONBOARDING_STEP_VIEWS }: { state: ReturnType<typeof useWorkspaceOnboarding>; steps?: OnboardingStepViews }) {
  const { progress } = state;
  const Step = progress ? steps[progress.step] : undefined, visible = state.surface === "sheet" && !!Step;
  // Focus returns to where it was before the sheet opened (review of #82, G-1). When it was opened from the resume card,
  // that button is gone by then, so focus goes to the card's Continue again.
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => { (previous?.isConnected && previous !== document.body ? previous : document.querySelector<HTMLElement>(".wob-resume .hs-btn.pri"))?.focus(); };
  }, [visible]);
  if (!visible || !progress || !Step) return null;
  const sheet: OnboardingSheetCommon = { step: progress.step, readOnly: progress.readOnly, busy: state.busy, notice: state.notice, onLater: state.later, onBack: progress.step > 1 ? state.back : undefined };
  return <Step progress={progress} sheet={sheet} next={state.next} />;
}
