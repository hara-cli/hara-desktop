/** Conservative chat shortcut: recognize only explicit recurring time requests. Other prose stays in chat. */
export function parseColleagueScheduleRequest(text, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (typeof text !== "string" || text.length > 2000) return null;
  const source = text.trim();
  const time = source.match(/(?:^|\s|在|的|早上|上午|下午|晚上)(\d{1,2})(?::(\d{2})|点(?:([0-5]?\d)分?)?)/u);
  if (!time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? time[3] ?? 0);
  if (/下午|晚上/u.test(source.slice(Math.max(0, time.index - 3), time.index + time[0].length)) && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return null;
  let days = "*";
  if (/工作日|weekdays?/iu.test(source)) days = "1-5";
  else {
    const week = source.match(/每(?:个)?(?:周|星期)([一二三四五六日天1-7])/u);
    if (week) days = String({ "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 }[week[1]] ?? Number(week[1]) % 7);
    else if (!/每天|每日|daily/iu.test(source)) return null;
  }
  const zone = source.match(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/u)?.[0] || timeZone;
  const schedule = `${minute} ${hour} * * ${days}`;
  return { name: source.slice(0, 60), schedule, task: source, tz: zone };
}
