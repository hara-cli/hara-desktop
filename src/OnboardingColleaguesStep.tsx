import { useEffect, useId, useRef, useState } from "react";
import type { Key } from "./i18n";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { OnboardingSheet, type OnboardingStepProps } from "./WorkspaceOnboarding";
import { engineRows } from "./OnboardingEngineStep";
import {
  EMPTY_ANSWERS, TEAM_FOCUSES, TEAM_HELPS, TEAM_LIMIT, batchRows, draftFromAnswers, loadTeamDraft, nextSuggestion, saveTeamDraft, teamBlueprint, teamDuty, teamRow,
  type TeamDraft, type TeamFocus, type TeamRowResult,
} from "./onboarding-team";

/**
 * Onboarding step 3 «Colleagues» (design §2 ③, hub hd-ob-ask / hd-ob-draft / hd-ob-result; Jeff Q2, Q4).
 * Three questions → a local draft from the talent library → cards with Owns / Not and an engine each → one explicit
 * «Create N colleagues» through Core G2 → per-colleague results, where Retry only sends the ones that failed.
 * The run's G4 `runId` is the G2 run, so a lost reply or a reload never creates anyone twice. Answers and the draft
 * stay in this Mac's storage (G4 does not take them). Duty text is a draft and grants nothing.
 */
const REASON: Record<string, Key> = {
  runtime_unconfirmed: "ws.onboarding.team.reason.runtime_unconfirmed", runtime_unavailable: "ws.onboarding.team.reason.runtime_unavailable",
  permission_tier_unavailable: "ws.onboarding.team.reason.permission_tier_unavailable", catalog_changed: "ws.onboarding.team.reason.catalog_changed",
  batch_limit: "ws.onboarding.team.reason.batch_limit", invalid_request: "ws.onboarding.team.reason.invalid_request",
};
const done = (result: TeamRowResult | undefined) => result?.status === "created" || result?.status === "exists";

export function OnboardingColleaguesStep({ progress, sheet, next, model, workspace }: OnboardingStepProps) {
  const { t, locale } = useWorkspaceLocale();
  const focusName = useId(), sizeName = useId();
  const wsId = workspace.workspaceId, scope = `${wsId}:${workspace.resourceGeneration}:${progress.runId}`, live = useRef(scope);
  live.current = scope;
  const fresh = (): TeamDraft => loadTeamDraft(wsId, progress.runId) ?? { runId: progress.runId, phase: "ask", answers: EMPTY_ANSWERS, rows: [], results: {} };
  const [draft, setDraftState] = useState<TeamDraft>(fresh);
  const [creating, setCreating] = useState(false), [failedAll, setFailedAll] = useState(false), [revision, setRevision] = useState<number | null>(null);
  useEffect(() => { setDraftState(fresh()); setRevision(null); setFailedAll(false); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const setDraft = (update: (current: TeamDraft) => TeamDraft) => setDraftState(current => { const value = update(current); saveTeamDraft(wsId, value); return value; });

  // A username already in this workspace (e.g. after «Run again») is shown as «Already here» and cannot be picked.
  const existing = new Set(workspace.agents.map(agent => agent.username).filter((name): name is string => !!name));
  const engines = engineRows(workspace, {}, false, t).filter(row => row.selectable);
  const defaultName = progress.engineChoice ? engines.find(row => row.id === progress.engineChoice)?.name ?? null : null;
  const supported = model.supportsCreateBatch?.() === true;
  // Step 1 «Skip for now» leaves no engine choice: the draft can be kept but not created (design §2 branches).
  const blocked: "" | Key = !supported ? "ws.onboarding.team.unsupported" : progress.engineChoice === null ? "ws.onboarding.team.noEngine" : "";
  const pending = draft.rows.filter(row => row.checked && !existing.has(row.username) && !done(draft.results[row.draftKey]));
  const finish = () => next({ completedAt: new Date().toISOString() });

  const create = async () => {
    const rows = batchRows(draft, locale, existing), expected = revision ?? workspace.agentRevision;
    if (!rows.length || expected === undefined || blocked || sheet.readOnly) return;
    setCreating(true); setFailedAll(false);
    try {
      const view = await model.createColleagues(progress.runId, rows, expected, wsId, workspace.resourceGeneration);
      if (live.current !== scope) return;
      setRevision(view.revision);
      setDraft(current => {
        const results = { ...current.results };
        // A name taken by someone already here reads «Already here», not a failure the user has to fix.
        for (const row of view.results) results[row.draftKey] = row.status === "failed" ? row.reason === "username_taken" ? { status: "exists" } : { status: "failed", reason: row.reason } : { status: row.status, agentId: row.agentId };
        return { ...current, phase: "result", results };
      });
    } catch { if (live.current === scope) setFailedAll(true); }
    finally { if (live.current === scope) setCreating(false); }
  };

  const followLabel = defaultName ? t("ws.onboarding.team.follow", { name: defaultName }) : t("ws.onboarding.team.followNone");
  const card = (row: TeamDraft["rows"][number], view: "draft" | "result") => {
    const blueprint = teamBlueprint(row.username)!, duty = teamDuty(row.username, locale), result = draft.results[row.draftKey];
    const here = existing.has(row.username) && !done(result), locked = here || done(result) || creating || sheet.busy;
    const name = blueprint.name[locale === "en" ? "en" : "zh"], chip = done(result) ? (result!.status === "created" ? "created" : "exists") : here ? "exists" : result?.status === "failed" ? "failed" : "";
    return <li key={row.draftKey} className={`wob-row wob-team-card${row.checked && !here ? " is-selected" : ""}`} data-draft={row.draftKey}>
      {view === "draft" ? <input type="checkbox" aria-label={t("ws.onboarding.team.pick", { name })} checked={row.checked && !here} disabled={locked || sheet.readOnly}
        onChange={event => setDraft(current => ({ ...current, rows: current.rows.map(item => item.draftKey === row.draftKey ? { ...item, checked: event.target.checked } : item) }))} /> : null}
      <span className="wob-team-face" aria-hidden>{blueprint.emoji}</span>
      <span className="wob-row-text">
        <b>{name}</b> <span className="wob-team-title">{duty.title}</span>
        {chip ? <> <span className={`wob-chip${chip === "created" ? " is-ok" : chip === "failed" ? " is-fail" : ""}`} data-result={chip}>{t(`ws.onboarding.team.${chip}` as Key)}</span></> : null}
        <span className="wob-duty"><span><em>{t("ws.onboarding.team.owns")}</em>{duty.owns.join(" · ")}</span><span><em>{t("ws.onboarding.team.rejects")}</em>{duty.rejects.join(" · ")}</span></span>
        {result?.status === "failed" ? <small className="is-warn" role="status">{t(REASON[result.reason] ?? "ws.onboarding.team.reason.invalid_request")}</small> : null}
      </span>
      {!here && !done(result) ? <label className="wob-team-engine"><span>{t("ws.onboarding.team.engine")}</span>
        <select value={row.engine} disabled={locked || sheet.readOnly} onChange={event => setDraft(current => ({ ...current, rows: current.rows.map(item => item.draftKey === row.draftKey ? { ...item, engine: event.target.value } : item) }))}>
          <option value="follow">{followLabel}</option>
          {engines.map(engine => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
        </select></label> : null}
      {view === "draft" && !result && !creating ? <button type="button" className="wob-team-remove" disabled={sheet.busy || sheet.readOnly} aria-label={`${t("ws.onboarding.team.remove")} ${name}`}
        onClick={() => setDraft(current => ({ ...current, rows: current.rows.filter(item => item.draftKey !== row.draftKey) }))}>{t("ws.onboarding.team.remove")}</button> : null}
    </li>;
  };

  if (draft.phase === "ask") {
    const { answers } = draft, helps = answers.focus ? TEAM_HELPS[answers.focus] : [];
    const answer = (patch: Partial<TeamDraft["answers"]>) => setDraft(current => ({ ...current, answers: { ...current.answers, ...patch } }));
    return <OnboardingSheet {...sheet} mascot="idle" title={t("ws.onboarding.team.title")} sub={t("ws.onboarding.team.sub")} note={t("ws.onboarding.team.local")}
      actions={<>
        <button type="button" disabled={sheet.busy} onClick={finish}>{t("ws.onboarding.team.enter")}</button>
        <button type="button" className="hs-btn pri" disabled={!answers.focus || sheet.busy} onClick={() => setDraft(current => ({ ...draftFromAnswers(current.runId, current.answers), results: current.results }))}>{t("ws.onboarding.team.makeDraft")}</button>
      </>}>
      <fieldset className="wob-ask"><legend className="wob-h">{t("ws.onboarding.team.q1")}</legend>
        <div className="wob-options">{TEAM_FOCUSES.map(focus => <label key={focus} className={`wob-option${answers.focus === focus ? " is-selected" : ""}`}>
          <input type="radio" name={focusName} value={focus} checked={answers.focus === focus} onChange={() => answer({ focus: focus as TeamFocus, helps: [] })} />{t(`ws.onboarding.team.focus.${focus}` as Key)}</label>)}</div>
        {answers.focus === "other" ? <label className="wob-custom"><span>{t("ws.onboarding.team.custom")}</span><input type="text" maxLength={120} value={answers.custom} onChange={event => answer({ custom: event.target.value })} /></label> : null}
      </fieldset>
      {answers.focus ? <fieldset className="wob-ask"><legend className="wob-h">{t("ws.onboarding.team.q2")}<small>{t("ws.onboarding.team.q2Note")}</small></legend>
        <div className="wob-options">{helps.map(help => <label key={help.id} className={`wob-option${answers.helps.includes(help.id) ? " is-selected" : ""}`}>
          <input type="checkbox" checked={answers.helps.includes(help.id)} onChange={event => answer({ helps: event.target.checked ? [...answers.helps, help.id] : answers.helps.filter(id => id !== help.id) })} />{t(`ws.onboarding.team.help.${help.id}` as Key)}</label>)}</div>
      </fieldset> : null}
      <fieldset className="wob-ask"><legend className="wob-h">{t("ws.onboarding.team.q3")}</legend>
        <div className="wob-options">{(["one", "team"] as const).map(size => <label key={size} className={`wob-option${answers.size === size ? " is-selected" : ""}`}>
          <input type="radio" name={sizeName} value={size} checked={answers.size === size} onChange={() => answer({ size })} />{t(`ws.onboarding.team.size.${size}` as Key)}</label>)}</div>
      </fieldset>
    </OnboardingSheet>;
  }

  if (draft.phase === "result") {
    const shown = draft.rows.filter(row => draft.results[row.draftKey]);
    const created = shown.filter(row => done(draft.results[row.draftKey])).length, failed = shown.filter(row => draft.results[row.draftKey]?.status === "failed").length;
    return <OnboardingSheet {...sheet} mascot={failed ? "error" : "done"} title={t("ws.onboarding.team.title")} sub={t("ws.onboarding.team.sub")} note={t("ws.onboarding.team.dutyNote")}
      actions={<>
        {failed ? <button type="button" disabled={creating || sheet.busy || !!blocked || sheet.readOnly} onClick={() => void create()}>{t(creating ? "ws.onboarding.team.creating" : "ws.onboarding.team.retry")}</button> : null}
        <button type="button" className="hs-btn pri" disabled={creating || sheet.busy} onClick={finish}>{t("ws.onboarding.team.enter")}</button>
      </>}>
      {failedAll ? <p className="wob-notice is-error" role="alert">{t("ws.onboarding.team.failedAll")}</p> : null}
      <p className="wob-notice" role="status">{failed ? t("ws.onboarding.team.result", { created, failed }) : created === 1 ? t("ws.onboarding.team.resultAllOne") : t("ws.onboarding.team.resultAll", { n: created })}</p>
      <ul className="wob-list wob-team">{shown.map(row => card(row, "result"))}</ul>
    </OnboardingSheet>;
  }

  const more = nextSuggestion(draft.answers.focus, draft.rows.map(row => row.username));
  return <OnboardingSheet {...sheet} mascot="idle" title={t("ws.onboarding.team.title")} sub={t("ws.onboarding.team.sub")} note={t("ws.onboarding.team.dutyNote")}
    actions={<>
      <button type="button" disabled={creating || sheet.busy} onClick={() => setDraft(current => ({ ...current, phase: "ask" }))}>{t("ws.onboarding.team.backToQuestions")}</button>
      <button type="button" disabled={creating || sheet.busy} onClick={finish}>{t("ws.onboarding.team.enter")}</button>
      <button type="button" className="hs-btn pri" disabled={!pending.length || !!blocked || creating || sheet.busy || sheet.readOnly || workspace.agentRevision === undefined} onClick={() => void create()}>
        {creating ? t("ws.onboarding.team.creating") : pending.length === 1 ? t("ws.onboarding.team.createOne") : t("ws.onboarding.team.create", { n: pending.length })}</button>
    </>}>
    {blocked ? <p className="wob-warn" role="status">{t(blocked)}</p> : null}
    {failedAll ? <p className="wob-notice is-error" role="alert">{t("ws.onboarding.team.failedAll")}</p> : null}
    <h3 className="wob-h">{pending.length ? t("ws.onboarding.team.willCreate", { n: pending.length, engine: followLabel }) : t("ws.onboarding.team.willCreateNone")}</h3>
    <ul className="wob-list wob-team">{draft.rows.map(row => card(row, "draft"))}</ul>
    {more && draft.rows.length < TEAM_LIMIT ? <div><button type="button" disabled={creating || sheet.busy || sheet.readOnly}
      onClick={() => setDraft(current => ({ ...current, rows: [...current.rows, teamRow(more)] }))}>{t("ws.onboarding.team.addOne")}</button></div> : null}
  </OnboardingSheet>;
}
