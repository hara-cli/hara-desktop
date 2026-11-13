import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { makeT, type Key, type Locale } from "./i18n";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import type { WorkScopeTarget } from "./workspace-work-scope";
import { createAgentDutyDraft } from "./agent-duty-draft";
import { useColleagueWorkScopeWriter } from "./use-colleague-work-scope-writer";
import type { WorkspaceWorkScopeWriter, WorkScopeWriteCapture, WorkScopeEditSession, WorkScopePreview, WorkScopeOutcome } from "./work-scope-writer";
import { workScopeEqual, type BoundaryChanges, type WorkScopeChange, type WorkScopeDiffValue } from "./work-scope-proposal";
import type { WorkScopeEditCatalog } from "./work-scope-catalog";
const approvalKeys = { write: "write", execute: "execute", external_send: "external", paid: "paid", publish: "publish", credentials: "credentials", policy_expand: "expand" } as const;
const requirements = ["resource_isolation", "effect_journal", "current_grant_check"] as const;
const toolKey = (value: { toolId: string; connectorId: string | null; catalogRevision: number }) => JSON.stringify([value.toolId, value.connectorId, value.catalogRevision]);
function statusKey(value: WorkScopeOutcome): Key {
  if (value.state === "applied") return "ws.workScope.write.applied";
  if (value.state === "superseded") return "ws.workScope.write.superseded";
  if (value.state === "rejected") return "ws.workScope.write.rejected";
  if (value.state === "not_applied") return "ws.workScope.write.notApplied";
  if (value.state === "unknown") return "ws.workScope.write.unknown";
  return `ws.workScope.write.${value.receipt?.status === "queued" ? "queued" : value.receipt?.status === "applying" ? "applying" : value.receipt?.status === "drained" ? "drained" : value.receipt?.status === "draining" ? "draining" : "accepted"}` as Key;
}
function Outcome({ value, locale }: { value: WorkScopeOutcome; locale: Locale }) {
  const t = makeT(locale);
  return <div className={`hd-work-scope-result${value.state === "unknown" || value.state === "rejected" ? " is-warning" : ""}`}>
    <p>{t(statusKey(value))}</p>{value.state === "unknown" || value.state === "pending" ? <p>{t("ws.workScope.write.originalOnly")}</p> : null}
    <details><summary>{t("ws.workScope.advanced")}</summary><p>{t("ws.workScope.write.operationRef")} <code>{value.reference.commandId}</code></p></details>
  </div>;
}
export function ColleagueWorkScopeEditor({ model, target, locale, onApplied }: { model?: WorkspaceDevModel; target: WorkScopeTarget; locale: Locale; onApplied(): void }) {
  const result = useColleagueWorkScopeWriter(model, target), t = makeT(locale);
  if (!result || result.value.phase === "loading") return null;
  if (result.value.phase === "error") return <div className="hd-work-scope-warning" role="alert"><p>{t("ws.workScope.write.unavailable")}</p><button type="button" onClick={result.retry}>{t("ws.workScope.retry")}</button></div>;
  if (result.value.phase !== "ready") return null;
  const session = result.value.session;
  return session ? <WriterView key={result.key} writer={result.writer} capture={result.capture} session={session} locale={locale} refresh={result.retry} onApplied={onApplied} /> : null;
}
function WriterView({ writer, capture, session, locale, refresh, onApplied }: { writer: WorkspaceWorkScopeWriter; capture: WorkScopeWriteCapture; session: WorkScopeEditSession; locale: Locale; refresh(): void; onApplied(): void }) {
  const t = makeT(locale), [mode, setMode] = useState<"duty.update" | "boundary.update" | null>(null), [pending, setPending] = useState(session.pending);
  const [checking, setChecking] = useState(false), [failed, setFailed] = useState(false), live = useRef(true), checkingRef = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const unresolved = pending.some(value => value.state === "pending" || value.state === "unknown");
  async function checkOriginal() {
    if (checkingRef.current) return; checkingRef.current = true; setChecking(true); setFailed(false);
    try {
      const values: WorkScopeOutcome[] = [];
      for (const value of pending) values.push(value.state === "pending" || value.state === "unknown" ? await writer.refresh(capture, value.reference) : value);
      if (live.current) { setPending(values); if (values.every(value => value.state !== "pending" && value.state !== "unknown")) { onApplied(); refresh(); } }
    } catch { if (live.current) setFailed(true); } finally { checkingRef.current = false; if (live.current) setChecking(false); }
  }
  return <div className="hd-work-scope-writer">
    <div className="hd-work-scope-sr" role="status" aria-live="polite" aria-atomic="true">{checking ? t("ws.workScope.write.checking") : ""}</div>
    {pending.length ? <div className="hd-work-scope-pending">{pending.map(value => <Outcome key={value.reference.commandId} value={value} locale={locale} />)}
      {unresolved ? <button type="button" className="hs-btn sec" disabled={checking} onClick={() => void checkOriginal()}>{t(checking ? "ws.workScope.write.checking" : "ws.workScope.write.checkOriginal")}</button> : null}</div> : null}
    {failed ? <p role="alert" className="hd-work-scope-warning">{t("ws.workScope.write.unknown")}</p> : null}
    {session.policy.rights.manage && !unresolved ? <div className="hd-work-scope-actions"><button type="button" className="hs-btn sec" onClick={() => setMode("duty.update")}>{t("ws.workScope.write.editDuty")}</button>
      {session.catalog ? <button type="button" className="hs-btn sec" onClick={() => setMode("boundary.update")}>{t("ws.workScope.write.editBoundary")}</button> : null}</div> : null}
    {mode ? <EditDialog writer={writer} capture={capture} session={session} action={mode} locale={locale} onClose={applied => { setMode(null); if (applied) onApplied(); refresh(); }} /> : null}
  </div>;
}
function Difference({ change, catalog, locale }: { change: WorkScopeChange; catalog: WorkScopeEditCatalog | null; locale: Locale }) {
  const t = makeT(locale);
  const access = (value: string) => ["read", "write", "execute"].includes(value) ? t(`ws.workScope.access.${value}` as Key) : value;
  const format = (value: WorkScopeDiffValue) => value === null ? t("ws.workScope.write.notSelected") : Array.isArray(value) ? value.map(item => change.field === "resource" ? access(item) : item).join("\n") || t("ws.workScope.write.empty")
    : typeof value === "boolean" ? t(value ? "ws.workScope.write.yes" : "ws.workScope.write.no") : value === "selected" ? t("ws.workScope.write.selected") : String(value);
  let label = t(`ws.workScope.write.field.${change.field}` as Key);
  if (change.resourceId) { const resource = catalog?.resources.find(row => row.resourceId === change.resourceId); label += ` · ${resource?.label ?? t("ws.workScope.unnamedDirectory")}${resource?.path ? ` (${resource.path})` : ""}`; }
  if (change.tool) { const tool = catalog?.tools.find(row => toolKey(row.ref) === toolKey(change.tool!)); label += ` · ${tool?.label ?? t("ws.workScope.tool.other")} · ${t("ws.workScope.write.catalogVersion", { n: change.tool.catalogRevision })}`; }
  if (change.operation) label += ` · ${t((change.field === "approval" ? `ws.workScope.approval.${approvalKeys[change.operation as keyof typeof approvalKeys]}` : `ws.workScope.write.check.${change.operation}`) as Key)}`;
  return <li className="hd-work-scope-difference"><h5>{label} <span className={`hd-work-scope-change ${change.direction}`}>{t(`ws.workScope.write.change.${change.direction}` as Key)}</span></h5>
    <dl><dt>{t("ws.workScope.write.before")}</dt><dd>{format(change.before)}</dd><dt>{t("ws.workScope.write.after")}</dt><dd>{format(change.after)}</dd></dl></li>;
}
function keepDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const element = event.currentTarget, active = element.ownerDocument.activeElement;
  const controls = Array.from(element.querySelectorAll<HTMLElement>('button, input, textarea, select, summary, a[href], [tabindex]'))
    .filter(control => control.tabIndex >= 0 && !control.matches(":disabled") && !control.closest("[inert]") && control.getClientRects().length > 0);
  if (!controls.length) { event.preventDefault(); element.querySelector<HTMLElement>("h3")?.focus(); return; }
  const first = controls[0]!, last = controls[controls.length - 1]!;
  if (!controls.includes(active as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !element.contains(active))) { event.preventDefault(); first.focus(); }
}
function EditDialog({ writer, capture, session, action, locale, onClose }: { writer: WorkspaceWorkScopeWriter; capture: WorkScopeWriteCapture; session: WorkScopeEditSession; action: "duty.update" | "boundary.update"; locale: Locale; onClose(applied: boolean): void }) {
  const t = makeT(locale), id = useId(), dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), alive = useRef(true), busyRef = useRef(false);
  const controller = useRef(new AbortController()), previewRef = useRef<WorkScopePreview | null>(null);
  const [working, setWorking] = useState(session), [profile, setProfile] = useState(() => ({ ...session.policy.duty.publicProfile, owns: session.policy.duty.publicProfile.owns.join("\n"), rejects: session.policy.duty.publicProfile.rejects.join("\n") }));
  const [boundary, setBoundary] = useState<BoundaryChanges>(() => { const { resources, tools, budget, approvalRequired, runtimeRequirements } = session.policy.boundary; return { resources, tools, budget, approvalRequired, runtimeRequirements }; });
  const [preview, setPreview] = useState<WorkScopePreview | null>(null), [result, setResult] = useState<WorkScopeOutcome | null>(null), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const [error, setError] = useState<Key | null>(null), [notice, setNotice] = useState(false), [expired, setExpired] = useState(false);
  const dirty = action === "duty.update" ? !workScopeEqual(profile, { ...session.policy.duty.publicProfile, owns: session.policy.duty.publicProfile.owns.join("\n"), rejects: session.policy.duty.publicProfile.rejects.join("\n") })
    : !workScopeEqual(boundary, (({ resources, tools, budget, approvalRequired, runtimeRequirements }) => ({ resources, tools, budget, approvalRequired, runtimeRequirements }))(session.policy.boundary));
  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    const element = dialog.current!; element.showModal(); heading.current?.focus();
    return () => { alive.current = false; controller.current.abort(); if (previewRef.current) writer.cancel(previewRef.current); element.close(); };
  }, [writer]);
  useEffect(() => {
    if (!preview || result) { setExpired(false); return; }
    const remaining = Date.parse(preview.expiresAt) - Date.now(); setExpired(remaining <= 0);
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, remaining)); return () => window.clearTimeout(timer);
  }, [preview, result]);
  useEffect(() => { heading.current?.focus(); }, [preview, result, error, discard]);
  useEffect(() => {
    if (!dirty && !busy && !result) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty, busy, result]);
  function close() { if (busyRef.current) return; if (result) { onClose(result.state === "applied" || result.state === "superseded"); return; } if (dirty || preview) setDiscard(true); else onClose(false); }
  async function perform(task: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { await task(); } catch (error) { if (alive.current) setError((error as { code?: string }).code === "STALE_REVISION" ? "ws.workScope.write.stale" : "ws.workScope.write.failed"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  const review = (event: FormEvent) => {
    event.preventDefault(); void perform(async () => {
      const input = action === "duty.update" ? { action, draft: createAgentDutyDraft({ ...profile, owns: profile.owns.split("\n").map(row => row.trim()).filter(Boolean), rejects: profile.rejects.split("\n").map(row => row.trim()).filter(Boolean) }) }
        : { action, boundary };
      const value = await writer.preview(working, input, controller.current.signal);
      if (alive.current) { previewRef.current = value; setPreview(value); } else writer.cancel(value);
    });
  };
  const back = () => void perform(async () => {
    if (preview) writer.cancel(preview); previewRef.current = null;
    const current = await writer.load(capture, controller.current.signal);
    if (!current?.policy.rights.manage || current.pending.some(value => value.state === "pending" || value.state === "unknown")) throw new Error("Unavailable");
    if (alive.current) { setWorking(current); setPreview(null); setNotice(true); }
  });
  const confirm = () => { if (!preview) return; void perform(async () => {
    const value = await writer.submit(preview); if (alive.current) setResult(value);
  }); };
  const query = () => { if (!result) return; void perform(async () => { const value = await writer.refresh(capture, result.reference, controller.current.signal); if (alive.current) setResult(value); }); };
  const catalog = working.catalog;
  return <dialog ref={dialog} className="hd-work-scope-dialog" onKeyDown={keepDialogFocus} aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h3 id={`${id}-title`} ref={heading} tabIndex={-1}>{t(result ? "ws.workScope.write.resultTitle" : preview ? "ws.workScope.write.reviewTitle" : action === "duty.update" ? "ws.workScope.write.editDuty" : "ws.workScope.write.editBoundary")}</h3>
      <p id={`${id}-note`}>{t(action === "duty.update" ? "ws.workScope.write.dutyNote" : "ws.workScope.write.boundaryNote")}</p></header>
    <div className="hd-work-scope-sr" role="status" aria-live="polite" aria-atomic="true">{busy ? t(result ? "ws.workScope.write.checking" : preview ? "ws.workScope.write.submitting" : "ws.workScope.write.preparing") : result ? t(statusKey(result)) : ""}</div>
    {error ? <p className="hd-work-scope-warning" role="alert">{t(error)}</p> : null}
    {discard ? <div className="hd-work-scope-warning" role="alert"><p>{t("ws.workScope.write.discardNote")}</p><div className="hd-work-scope-actions"><button type="button" className="hs-btn sec" onClick={() => setDiscard(false)}>{t("ws.workScope.write.keepEditing")}</button><button type="button" className="hs-btn sec" onClick={() => onClose(false)}>{t("ws.workScope.write.discard")}</button></div></div>
      : result ? <><Outcome value={result} locale={locale} /><div className="hd-work-scope-actions">{result.state === "pending" || result.state === "unknown" ? <button type="button" className="hs-btn pri" disabled={busy} onClick={query}>{t(busy ? "ws.workScope.write.checking" : "ws.workScope.write.checkOriginal")}</button> : null}
        <button type="button" className="hs-btn sec" disabled={busy} onClick={close}>{t("ws.workScope.write.close")}</button></div></>
      : preview ? <><p className="hd-work-scope-notice">{t("ws.workScope.write.notSubmitted")}</p>
        {expired ? <p className="hd-work-scope-warning" role="alert">{t("ws.workScope.write.expired")}</p> : null}
        {preview.changes.some(row => row.direction === "expand") ? <p className="hd-work-scope-warning">{t("ws.workScope.write.expansion")}</p> : null}
        <ol className="hd-work-scope-differences">{preview.changes.map((change, i) => <Difference key={i} change={change} catalog={catalog} locale={locale} />)}</ol>
        <div className="hd-work-scope-actions"><button type="button" className="hs-btn sec" disabled={busy} onClick={back}>{t("ws.workScope.write.back")}</button><button type="button" className="hs-btn sec" disabled={busy} onClick={close}>{t("ws.cancel")}</button>
          <button type="button" className="hs-btn pri" disabled={busy || expired || !!error} onClick={confirm}>{t(busy ? "ws.workScope.write.submitting" : "ws.workScope.write.confirm")}</button></div></>
      : <form onSubmit={review}>
        {notice ? <p className="hd-work-scope-notice" role="status">{t("ws.workScope.write.reread")}</p> : null}
        {action === "duty.update" ? <fieldset disabled={busy} className="hd-work-scope-fields"><legend>{t("ws.workScope.write.dutyFields")}</legend>
          <label>{t("ws.workScope.write.field.title")}<input name="duty-title" required maxLength={160} value={profile.title} onChange={event => setProfile(value => ({ ...value, title: event.target.value }))} /></label>
          <label>{t("ws.workScope.write.field.description")}<textarea name="duty-description" rows={3} required maxLength={4096} value={profile.description} onChange={event => setProfile(value => ({ ...value, description: event.target.value }))} /></label>
          {(["owns", "rejects"] as const).map(field => <label key={field}>{t(`ws.workScope.write.field.${field}` as Key)}<textarea name={`duty-${field}`} rows={3} value={profile[field]} onChange={event => setProfile(value => ({ ...value, [field]: event.target.value }))} /><small>{t("ws.workScope.write.onePerLine")}</small></label>)}
        </fieldset> : catalog ? <>
          <fieldset disabled={busy} className="hd-work-scope-fields"><legend>{t("ws.workScope.toolsDirectories")}</legend>
            {catalog.resources.map(resource => <div key={resource.resourceId} className="hd-work-scope-choice"><strong>{resource.label}</strong>{resource.path ? <p className="hd-work-scope-path">{resource.path}</p> : null}<div className="hd-work-scope-checks">{resource.access.map(access => <label key={access}><input type="checkbox" name={`resource-${resource.resourceId}-${access}`} checked={boundary.resources.some(row => row.resourceId === resource.resourceId && row.access.includes(access))} onChange={event => setBoundary(value => {
              const old = value.resources.find(row => row.resourceId === resource.resourceId)?.access ?? [], next = event.target.checked ? [...old, access] : old.filter(item => item !== access);
              return { ...value, resources: [...value.resources.filter(row => row.resourceId !== resource.resourceId), ...(next.length ? [{ resourceId: resource.resourceId, access: next }] : [])] };
            })} />{t(`ws.workScope.access.${access}` as Key)}</label>)}</div></div>)}
            {catalog.tools.map(tool => <label key={toolKey(tool.ref)}>{tool.label}<select aria-label={tool.label} value={boundary.tools.allow.some(ref => toolKey(ref) === toolKey(tool.ref)) ? "allow" : boundary.tools.deny.some(ref => toolKey(ref) === toolKey(tool.ref)) ? "deny" : "off"} onChange={event => { const mode = event.target.value; setBoundary(value => ({ ...value, tools: { ...value.tools,
              allow: [...value.tools.allow.filter(ref => toolKey(ref) !== toolKey(tool.ref)), ...(mode === "allow" ? [tool.ref] : [])], deny: [...value.tools.deny.filter(ref => toolKey(ref) !== toolKey(tool.ref)), ...(mode === "deny" ? [tool.ref] : [])] } })); }}>
              <option value="off">{t("ws.workScope.write.toolOff")}</option><option value="allow">{t("ws.workScope.write.toolAllow")}</option><option value="deny">{t("ws.workScope.write.toolDeny")}</option></select></label>)}
            <label className="hd-work-scope-check"><input type="checkbox" name="tools-read-only" checked={boundary.tools.readOnly} onChange={event => setBoundary(value => ({ ...value, tools: { ...value.tools, readOnly: event.target.checked } }))} />{t("ws.workScope.onlyRead")}</label>
          </fieldset>
          <fieldset disabled={busy} className="hd-work-scope-fields"><legend>{t("ws.workScope.approvals")}</legend>{(Object.keys(approvalKeys) as (keyof typeof approvalKeys)[]).map(operation => <label className="hd-work-scope-check" key={operation}><input type="checkbox" checked={boundary.approvalRequired.includes(operation)} disabled={catalog.limits.requiredApprovals.includes(operation)} onChange={event => setBoundary(value => ({ ...value, approvalRequired: event.target.checked ? [...value.approvalRequired, operation] : value.approvalRequired.filter(item => item !== operation) }))} />{t(`ws.workScope.approval.${approvalKeys[operation]}` as Key)}{catalog.limits.requiredApprovals.includes(operation) ? <small>{t("ws.workScope.write.required")}</small> : null}</label>)}</fieldset>
          <details className="hd-work-scope-advanced"><summary>{t("ws.workScope.advanced")}</summary><fieldset disabled={busy} className="hd-work-scope-fields"><legend>{t("ws.workScope.write.limits")}</legend>
            {(["maxModelCalls", "maxToolEffects"] as const).map(field => <label key={field}>{t(field === "maxModelCalls" ? "ws.workScope.modelLimit" : "ws.workScope.effectLimit")}<input type="number" name={field} min={0} max={catalog.limits[field]} step={1} required value={boundary.budget[field]} onChange={event => setBoundary(value => ({ ...value, budget: { ...value.budget, [field]: Number(event.target.value) } }))} /><small>{t("ws.workScope.write.ceiling", { n: catalog.limits[field] })}</small></label>)}
            {requirements.map(requirement => <label className="hd-work-scope-check" key={requirement}><input type="checkbox" checked={boundary.runtimeRequirements.includes(requirement)} disabled={catalog.limits.requiredChecks.includes(requirement)} onChange={event => setBoundary(value => ({ ...value, runtimeRequirements: event.target.checked ? [...value.runtimeRequirements, requirement] : value.runtimeRequirements.filter(item => item !== requirement) }))} />{t(`ws.workScope.write.check.${requirement}` as Key)}{catalog.limits.requiredChecks.includes(requirement) ? <small>{t("ws.workScope.write.required")}</small> : null}</label>)}
          </fieldset></details>
        </> : null}
        <div className="hd-work-scope-actions"><button type="button" className="hs-btn sec" disabled={busy} onClick={close}>{t("ws.cancel")}</button><button type="submit" className="hs-btn pri" disabled={busy}>{t(busy ? "ws.workScope.write.preparing" : "ws.workScope.write.review")}</button></div>
      </form>}
  </dialog>;
}
