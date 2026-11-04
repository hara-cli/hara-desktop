import type { Key } from "./i18n";
import type { SchedulePickerValue } from "./workspace-schedule-picker";

export function WorkspaceSchedulePicker({ value, onChange, t }: { value: SchedulePickerValue; onChange(value: SchedulePickerValue): void; t(key: Key): string }) {
  const update = (patch: Partial<SchedulePickerValue>) => onChange({ ...value, ...patch });
  return <div className="wsd-schedule-picker">
    {value.mode === "unsupported" ? <p role="status">{t("ws.schedules.unsupportedValue")}: <code>{value.original?.expr ?? value.original?.display ?? String(value.original?.everyMs ?? value.original?.runAt ?? "—")}</code>
      <button type="button" onClick={() => update({ mode: "once", original: undefined })}>{t("ws.schedules.usePicker")}</button></p> : null}
    {value.mode !== "unsupported" ? <>
      <label>{t("ws.schedules.frequency")}<select value={value.mode} onChange={event => update({ mode: event.target.value as SchedulePickerValue["mode"] })}>
        <option value="once">{t("ws.schedules.once")}</option><option value="daily">{t("ws.schedules.daily")}</option>
        <option value="weekly">{t("ws.schedules.weekly")}</option><option value="interval">{t("ws.schedules.interval")}</option>
      </select></label>
      {value.mode === "once" ? <label>{t("ws.schedules.date")}<input type="date" value={value.date} onChange={event => update({ date: event.target.value })} /></label> : null}
      {value.mode === "once" || value.mode === "daily" || value.mode === "weekly" ? <label>{t("ws.schedules.localTime")}<input type="time" value={value.time} onChange={event => update({ time: event.target.value })} /></label> : null}
      {value.mode === "weekly" ? <fieldset><legend>{t("ws.schedules.weekdays")}</legend>{[0, 1, 2, 3, 4, 5, 6].map(day => <label key={day}><input type="checkbox" checked={value.weekdays.includes(day)} onChange={event => update({ weekdays: event.target.checked ? [...value.weekdays, day] : value.weekdays.filter(item => item !== day) })} />{t((`ws.schedules.weekday.${day}`) as Key)}</label>)}</fieldset> : null}
      {value.mode === "interval" ? <label>{t("ws.schedules.every")}<input type="number" min={value.intervalUnit === "minutes" ? 15 : 1} step="1" value={value.interval} onChange={event => update({ interval: event.target.value })} />
        <select value={value.intervalUnit} onChange={event => update({ intervalUnit: event.target.value as SchedulePickerValue["intervalUnit"] })}><option value="minutes">{t("ws.schedules.minutes")}</option><option value="hours">{t("ws.schedules.hours")}</option></select></label> : null}
      <label>{t("ws.schedules.tz")}<input value={value.tz} onChange={event => update({ tz: event.target.value })} /></label>
      <p>{t("ws.schedules.localTimeNote")}</p>
    </> : null}
  </div>;
}
