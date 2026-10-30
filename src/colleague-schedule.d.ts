export interface ColleagueScheduleDraft { name: string; schedule: string; task: string; tz: string }
export function parseColleagueScheduleRequest(text: string, timeZone?: string): ColleagueScheduleDraft | null;
