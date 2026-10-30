import type { ColleagueScheduleDraft } from "./colleague-schedule.js";
import "./ColleagueScheduleCard.css";

export default function ColleagueScheduleCard({ draft, colleagueName, locale, busy, error, onChange, onConfirm, onCancel }: {
  draft: ColleagueScheduleDraft; colleagueName: string; locale: "zh" | "en";
  busy: boolean; error: string;
  onChange: (draft: ColleagueScheduleDraft) => void;
  onConfirm: () => void; onCancel: () => void;
}) {
  const zh = locale === "zh";
  const change = (field: keyof ColleagueScheduleDraft, value: string) => onChange({ ...draft, [field]: value });
  return <section className="colleague-schedule-card" aria-label={zh ? "确认定时" : "Confirm schedule"}>
    <header><strong>◷ {zh ? "确认定时" : "Confirm schedule"}</strong><span>{zh ? "挂接" : "Owner"} · {colleagueName}</span></header>
    <div className="colleague-schedule-fields">
      <label>{zh ? "名称" : "Name"}<input maxLength={60} value={draft.name} disabled={busy} onChange={(event) => change("name", event.target.value)} /></label>
      <label>{zh ? "节奏" : "Schedule"}<input value={draft.schedule} disabled={busy} onChange={(event) => change("schedule", event.target.value)} /></label>
      <label>{zh ? "时区" : "Timezone"}<input value={draft.tz} disabled={busy} onChange={(event) => change("tz", event.target.value)} /></label>
      <label>{zh ? "指令摘要" : "Instruction"}<textarea rows={3} value={draft.task} disabled={busy} onChange={(event) => change("task", event.target.value)} /></label>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <footer>
      <button type="button" className="confirm" disabled={busy || !draft.name.trim() || !draft.schedule.trim() || !draft.task.trim()} onClick={onConfirm}>{busy ? (zh ? "正在创建…" : "Creating…") : (zh ? "确认创建" : "Create schedule")}</button>
      <button type="button" disabled={busy} onClick={() => document.querySelector<HTMLInputElement>(".colleague-schedule-card input")?.focus()}>{zh ? "修改" : "Edit"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>{zh ? "取消" : "Cancel"}</button>
    </footer>
  </section>;
}
