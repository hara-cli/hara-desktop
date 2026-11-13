import type { Locale } from "./i18n";
import { HARA_CURATED_BLUEPRINTS, talentBlueprintIdentity, talentBlueprintInstructions, type AgentBlueprint } from "./talent-blueprints";
import { createAgentDutyDraft, type AgentDutyPublicProfile } from "./agent-duty-draft";

/**
 * Onboarding step 3 «Colleagues» (design §2 ③; Jeff Q2: drafts come from local talent-library rules, no network and no
 * model). Three answers pick curated blueprints. Each draft row carries an unconfirmed C0 public duty profile built
 * through the shared C5 module, so the card's «Owns / Not» has one source. Nothing here creates a colleague or grants
 * anything: creation is Core G2 `workspace.agents.createBatch` behind an explicit button, and duty text grants no tool,
 * folder or permission (coordinator decision (a), 2026-11-13).
 */
export type TeamFocus = "software" | "product" | "content" | "sales" | "operations" | "other";
export const TEAM_FOCUSES: readonly TeamFocus[] = ["software", "product", "content", "sales", "operations", "other"];
export type TeamSize = "one" | "team";
/** Q4: one batch creates at most eight colleagues. */
export const TEAM_LIMIT = 8;
export const TEAM_MIN = 3, TEAM_MAX = 5;

/** Help options per focus, in suggestion order. Each help maps to one curated blueprint username. */
export const TEAM_HELPS: Readonly<Record<TeamFocus, readonly { id: string; username: string }[]>> = {
  software: [{ id: "ui", username: "frontend-developer" }, { id: "api", username: "backend-architect" }, { id: "review", username: "code-reviewer" },
    { id: "tests", username: "test-automation" }, { id: "deploy", username: "devops-automator" }, { id: "security", username: "security-architect" }],
  product: [{ id: "brief", username: "product-manager" }, { id: "research", username: "ux-researcher" }, { id: "design", username: "ui-designer" },
    { id: "delivery", username: "project-manager" }, { id: "ui", username: "frontend-developer" }],
  content: [{ id: "writing", username: "content-creator" }, { id: "china", username: "china-growth-strategist" }, { id: "data", username: "analytics-reporter" },
    { id: "support", username: "support-responder" }],
  sales: [{ id: "pipeline", username: "sales-pipeline" }, { id: "proposals", username: "proposal-strategist" }, { id: "success", username: "customer-success" },
    { id: "support", username: "support-responder" }],
  operations: [{ id: "books", username: "financial-controller" }, { id: "forecast", username: "fpa-analyst" }, { id: "payables", username: "accounts-payable" },
    { id: "hiring", username: "recruitment-specialist" }, { id: "onboarding", username: "hr-onboarding" }, { id: "priorities", username: "chief-of-staff" }],
  other: [{ id: "priorities", username: "chief-of-staff" }, { id: "delivery", username: "project-manager" }, { id: "data", username: "analytics-reporter" },
    { id: "writing", username: "content-creator" }, { id: "support", username: "support-responder" }],
};

type Lines = readonly [en: string, hans: string, hant: string];
/**
 * Owns / Not for each blueprint the guide can suggest, in all three UI languages. «Not» names what a person decides or
 * what this colleague must not do on its own; it is guidance text only, never an access rule.
 */
const DUTY: Readonly<Record<string, { owns: Lines; rejects: Lines }>> = {
  "frontend-developer": { owns: ["Build product screens|Fix responsive layout|Find slow pages", "实现产品界面|修复响应式布局|找出慢页面", "實作產品介面|修復響應式版面|找出慢頁面"],
    rejects: ["Change backend APIs or databases|Release to production on its own", "改后端接口或数据库|自行发布上线", "改後端介面或資料庫|自行發布上線"] },
  "backend-architect": { owns: ["Design service boundaries|Review API contracts|Plan safe migrations", "设计服务边界|审查接口约定|规划安全迁移", "設計服務邊界|審查介面約定|規劃安全遷移"],
    rejects: ["Edit production data directly|Make product trade-offs for you", "直接改生产数据|替你做产品取舍", "直接改正式環境資料|替你做產品取捨"] },
  "code-reviewer": { owns: ["Review changes|Trace regressions|Assess release risk", "审查改动|追踪回归问题|评估发布风险", "審查改動|追蹤回歸問題|評估發布風險"],
    rejects: ["Rewrite the author's code wholesale|Approve merges or releases", "替作者整段重写代码|批准合并或发布", "替作者整段重寫程式碼|批准合併或發布"] },
  "test-automation": { owns: ["Add regression tests|Fix flaky tests|Keep failure evidence", "添加回归测试|修复不稳定的测试|保留失败证据", "新增回歸測試|修復不穩定的測試|保留失敗證據"],
    rejects: ["Change product code just to pass tests|Delete failing tests", "为了让测试通过而改产品代码|删除失败的测试", "為了讓測試通過而改產品程式碼|刪除失敗的測試"] },
  "devops-automator": { owns: ["Repair build pipelines|Automate deployment steps|Set up release checks", "修复构建流水线|自动化部署步骤|建立发布检查", "修復建置流程|自動化部署步驟|建立發布檢查"],
    rejects: ["Deploy to production without your OK|Change secrets or account access", "未经确认部署到生产环境|改动密钥或账号权限", "未經確認部署到正式環境|改動密鑰或帳號權限"] },
  "security-architect": { owns: ["Threat-model features|Review authorization|Plan layered defenses", "为功能做威胁建模|审查授权|规划多层防护", "為功能做威脅建模|審查授權|規劃多層防護"],
    rejects: ["Test systems you have not authorized|Read or send out credentials", "测试未经授权的系统|读取或外发凭据", "測試未經授權的系統|讀取或外傳憑證"] },
  "product-manager": { owns: ["Write product briefs|Sort the backlog|Plan launches", "写产品方案|梳理待办优先级|规划发布", "寫產品方案|梳理待辦優先順序|規劃發布"],
    rejects: ["Make the final priority call for you|Write production code", "替你拍板最终优先级|直接写生产代码", "替你拍板最終優先順序|直接寫正式程式碼"] },
  "ux-researcher": { owns: ["Plan user research|Analyze feedback|Run usability reviews", "制定用户研究计划|分析用户反馈|做可用性评审", "制定使用者研究計畫|分析使用者回饋|做可用性評審"],
    rejects: ["Collect more personal data than needed|Present guesses as user findings", "收集超出需要的个人信息|把推测当成用户结论", "收集超出需要的個人資料|把推測當成使用者結論"] },
  "ui-designer": { owns: ["Design product screens|Build the design system|Polish existing UI", "设计产品界面|建立设计系统|打磨现有界面", "設計產品介面|建立設計系統|打磨現有介面"],
    rejects: ["Change product scope|Ship UI changes on its own", "改动产品需求范围|自行上线界面改动", "改動產品需求範圍|自行上線介面改動"] },
  "project-manager": { owns: ["Make execution plans|Unblock projects|Run delivery reviews", "制定执行计划|解除项目阻塞|组织交付复盘", "制定執行計畫|解除專案阻塞|組織交付回顧"],
    rejects: ["Promise delivery dates for the team|Change other people's work", "替团队承诺交付日期|改动别人的工作内容", "替團隊承諾交付日期|改動別人的工作內容"] },
  "content-creator": { owns: ["Plan campaigns|Write channel copy|Keep an editorial calendar", "策划传播活动|撰写渠道文案|维护内容日历", "策劃傳播活動|撰寫渠道文案|維護內容日曆"],
    rejects: ["Publish without your OK|Make up data or quotes", "未经确认对外发布|编造数据或引用", "未經確認對外發布|編造資料或引用"] },
  "china-growth-strategist": { owns: ["Plan China go-to-market|Compare local channels|Localize campaigns", "规划中国市场进入|比较本地渠道|本地化营销活动", "規劃中國市場進入|比較在地渠道|在地化行銷活動"],
    rejects: ["Spend ad budget for you|Publish without your OK", "替你花投放预算|未经确认对外发布", "替你花投放預算|未經確認對外發布"] },
  "analytics-reporter": { owns: ["Analyze datasets|Build KPI reports|Explain trends", "分析数据|制作指标报告|解释趋势", "分析資料|製作指標報告|解釋趨勢"],
    rejects: ["Edit source data|Treat correlation as cause", "改动原始数据|把相关当成因果", "改動原始資料|把相關當成因果"] },
  "support-responder": { owns: ["Sort incoming feedback|Draft replies|Close resolved issues", "分拣用户反馈|起草回复|关闭已解决的问题", "分揀使用者回饋|起草回覆|關閉已解決的問題"],
    rejects: ["Promise refunds or compensation|Send replies without your OK", "承诺退款或赔偿|未经确认发出回复", "承諾退款或賠償|未經確認送出回覆"] },
  "sales-pipeline": { owns: ["Audit the pipeline|Explain forecast risk|Rank stalled deals", "审查销售管道|解释预测风险|排序停滞商机", "審查銷售管道|解釋預測風險|排序停滯商機"],
    rejects: ["Edit CRM records|Promise prices", "改动客户管理系统记录|承诺价格", "改動客戶管理系統紀錄|承諾價格"] },
  "proposal-strategist": { owns: ["Analyze RFPs|Shape the win story|Draft executive summaries", "分析招标文件|梳理赢单思路|撰写执行摘要", "分析招標文件|梳理贏單思路|撰寫執行摘要"],
    rejects: ["Commit to prices or contract terms|Send to customers without your OK", "承诺价格或合同条款|未经确认发给客户", "承諾價格或合約條款|未經確認寄給客戶"] },
  "customer-success": { owns: ["Prepare business reviews|Assess churn risk|Plan customer onboarding", "准备业务回顾|评估流失风险|规划客户入驻", "準備業務回顧|評估流失風險|規劃客戶導入"],
    rejects: ["Promise roadmap or commercial terms|Contact customers without your OK", "承诺产品路线或商务条款|未经确认联系客户", "承諾產品路線或商務條款|未經確認聯絡客戶"] },
  "financial-controller": { owns: ["Reconcile ledgers|Prepare month-end evidence|Review control exceptions", "核对账簿|准备结账证据|复核内控异常", "核對帳簿|準備結帳證據|複核內控異常"],
    rejects: ["Pay or transfer money|Change closed books", "付款或转账|改动已结账的账目", "付款或轉帳|改動已結帳的帳目"] },
  "fpa-analyst": { owns: ["Build rolling forecasts|Explain budget variance|Model business scenarios", "建立滚动预测|解释预算差异|模拟经营情景", "建立滾動預測|解釋預算差異|模擬經營情境"],
    rejects: ["Edit the books|Make budget decisions for you", "改动账簿|替你做预算决定", "改動帳簿|替你做預算決定"] },
  "accounts-payable": { owns: ["Check invoice packets|Spot duplicate payments|Prepare approval summaries", "核验付款材料|发现重复付款|准备审批摘要", "核驗付款資料|發現重複付款|準備審批摘要"],
    rejects: ["Start payments|Approve payments it checked itself", "发起付款|批准自己核过的付款", "發起付款|批准自己核過的付款"] },
  "recruitment-specialist": { owns: ["Write role scorecards|Design interview loops|Review candidate messages", "编写岗位评分卡|设计面试流程|审查候选人沟通", "編寫職缺評分卡|設計面試流程|審查候選人溝通"],
    rejects: ["Decide hires or rejections|Infer protected personal traits", "决定录用或拒绝|推断受保护的个人特征", "決定錄用或拒絕|推斷受保護的個人特徵"] },
  "hr-onboarding": { owns: ["Build 30/60/90 plans|Prepare onboarding checklists|Answer policy questions", "制定入职30/60/90天计划|准备入职清单|解答制度问题", "制定到職30/60/90天計畫|準備到職清單|解答制度問題"],
    rejects: ["Change payroll or account systems|Share more employee data than needed", "改动薪资或账号系统|分享多余的员工个人信息", "改動薪資或帳號系統|分享多餘的員工個人資料"] },
  "chief-of-staff": { owns: ["Prepare decision briefs|Organize priorities|Track follow-through", "准备决策简报|整理优先事项|跟进落实情况", "準備決策簡報|整理優先事項|追蹤落實情況"],
    rejects: ["Make final decisions for you|Speak for you externally", "替你做最终决定|以你的名义对外沟通", "替你做最終決定|以你的名義對外溝通"] },
};
const LANG: Record<Locale, 0 | 1 | 2> = { en: 0, "zh-Hans": 1, "zh-Hant": 2 };
const split = (lines: Lines, locale: Locale) => lines[LANG[locale]].split("|");
const talentLocale = (locale: Locale) => locale === "en" ? "en" as const : "zh" as const;

export const TEAM_POOL: readonly string[] = [...new Set(TEAM_FOCUSES.flatMap(focus => TEAM_HELPS[focus].map(help => help.username)))];
export function teamBlueprint(username: string): AgentBlueprint | null {
  return DUTY[username] ? HARA_CURATED_BLUEPRINTS.find(blueprint => blueprint.username === username) ?? null : null;
}

/** C0 public profile (title / description / owns / rejects) via the shared C5 module, so an invalid table entry throws in tests. */
export function teamDuty(username: string, locale: Locale): AgentDutyPublicProfile {
  const blueprint = teamBlueprint(username), duty = DUTY[username];
  if (!blueprint || !duty) throw new Error(`Unknown onboarding blueprint ${username}`);
  return createAgentDutyDraft({ title: blueprint.title[talentLocale(locale)], description: blueprint.bio[talentLocale(locale)],
    owns: split(duty.owns, locale), rejects: split(duty.rejects, locale) }).publicProfile;
}

export interface TeamAnswers { focus: TeamFocus | null; custom: string; helps: string[]; size: TeamSize }
export const EMPTY_ANSWERS: TeamAnswers = { focus: null, custom: "", helps: [], size: "team" };

/** Local rule: chosen helps first, padded with the focus's suggestions; one colleague, or a team of three to five. */
export function suggestTeam(answers: TeamAnswers): string[] {
  if (!answers.focus) return [];
  const helps = TEAM_HELPS[answers.focus], chosen = helps.filter(help => answers.helps.includes(help.id)).map(help => help.username);
  const ordered = [...new Set([...chosen, ...helps.map(help => help.username)])];
  if (answers.size === "one") return ordered.slice(0, 1);
  return ordered.slice(0, Math.min(TEAM_MAX, Math.max(TEAM_MIN, chosen.length)));
}
/** «Add one more»: the next suggestion for this focus, then the rest of the pool, never past the batch limit. */
export function nextSuggestion(focus: TeamFocus | null, taken: readonly string[]): string | null {
  if (taken.length >= TEAM_LIMIT) return null;
  const order = [...(focus ? TEAM_HELPS[focus].map(help => help.username) : []), ...TEAM_POOL];
  return order.find(username => !taken.includes(username)) ?? null;
}

/**
 * Draft-time duty label in the colleague's instructions (coordinator decision (a)). After C5 ships, a one-off migration
 * offers this text in the duty card and it becomes the colleague's duty only after the user confirms it there.
 */
export const DUTY_SECTION: Record<Locale, { head: string; owns: string; rejects: string; note: string }> = {
  en: { head: "Duties (draft; to be confirmed when duty cards arrive)", owns: "Owns", rejects: "Does not", note: "This text describes the role only. It grants no tools, folders or permissions." },
  "zh-Hans": { head: "职责（草案，C5 上线后迁移确认）", owns: "负责", rejects: "不负责", note: "这段文字只描述分工，不授予任何工具、目录或权限。" },
  "zh-Hant": { head: "職責（草案，C5 上線後遷移確認）", owns: "負責", rejects: "不負責", note: "這段文字只描述分工，不授予任何工具、目錄或權限。" },
};
export function teamInstructions(username: string, duty: AgentDutyPublicProfile, locale: Locale): string {
  const blueprint = teamBlueprint(username), label = DUTY_SECTION[locale], sep = locale === "en" ? ": " : "：", join = locale === "en" ? "; " : "；";
  if (!blueprint) throw new Error(`Unknown onboarding blueprint ${username}`);
  return [talentBlueprintInstructions(blueprint), "", label.head, `- ${label.owns}${sep}${duty.owns.join(join)}`, `- ${label.rejects}${sep}${duty.rejects.join(join)}`, `- ${label.note}`].join("\n");
}

export type TeamRowResult = { status: "created" | "exists"; agentId?: string } | { status: "failed"; reason: string };
export interface TeamDraftRow { draftKey: string; username: string; checked: boolean; engine: "follow" | string }
export interface TeamDraft { runId: string; phase: "ask" | "draft" | "result"; answers: TeamAnswers; rows: TeamDraftRow[]; results: Record<string, TeamRowResult> }

export const teamRow = (username: string): TeamDraftRow => ({ draftKey: username, username, checked: true, engine: "follow" });
export function draftFromAnswers(runId: string, answers: TeamAnswers): TeamDraft {
  return { runId, phase: "draft", answers, rows: suggestTeam(answers).map(teamRow), results: {} };
}

/** G2 rows for the checked drafts that are not done yet. «follow» omits runtimeId, so Core uses the workspace default (G1). */
export function batchRows(draft: TeamDraft, locale: Locale, existing: ReadonlySet<string>) {
  return draft.rows.filter(row => row.checked && !existing.has(row.username) && !["created", "exists"].includes(draft.results[row.draftKey]?.status ?? "")).map(row => {
    const blueprint = teamBlueprint(row.username)!, duty = teamDuty(row.username, locale);
    return { draftKey: row.draftKey, username: row.username, profile: { version: 1 as const, ...talentBlueprintIdentity(blueprint, talentLocale(locale)), source: "hara" as const },
      description: duty.title, instructions: teamInstructions(row.username, duty, locale), ...(row.engine === "follow" ? {} : { runtimeId: row.engine }) };
  });
}

/** Per-viewer convenience (G4 rejects answers/draft): one draft per workspace, kept only for the current run. */
export const TEAM_DRAFT_KEY = "hara.onboarding.team.v1";
const readAll = (): Record<string, TeamDraft> => {
  try { const value = JSON.parse(localStorage.getItem(TEAM_DRAFT_KEY) ?? "null"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
};
function validDraft(value: unknown, runId: string): value is TeamDraft {
  const draft = value as TeamDraft | null;
  return !!draft && draft.runId === runId && ["ask", "draft", "result"].includes(draft.phase) && Array.isArray(draft.rows) && draft.rows.length <= TEAM_LIMIT
    && draft.rows.every(row => row && typeof row.draftKey === "string" && teamBlueprint(row.username) !== null && typeof row.checked === "boolean" && typeof row.engine === "string")
    && !!draft.answers && Array.isArray(draft.answers.helps) && !!draft.results && typeof draft.results === "object";
}
export function loadTeamDraft(workspaceId: string, runId: string): TeamDraft | null {
  const value = readAll()[workspaceId]; return validDraft(value, runId) ? value : null;
}
export function saveTeamDraft(workspaceId: string, draft: TeamDraft): void {
  try { localStorage.setItem(TEAM_DRAFT_KEY, JSON.stringify({ ...readAll(), [workspaceId]: draft })); } catch { /* Without storage the draft simply is not restored. */ }
}
