import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HaraClient,
  LearningCandidate,
  LearningKind,
  LearningListResult,
  LearningScope,
  LearningStatus,
} from "./client";
import { SettingsBadge, SettingsNotice, SettingsPage } from "./SettingsUI";
import type { Locale } from "./i18n";
import "./LearningCenter.css";

interface LearningCenterProps {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
}

type LedgerView = "review" | "active" | "organization" | "history";
type Notice = { tone: "neutral" | "success" | "warning" | "error"; title: string; detail?: string };

const COPY = {
  en: {
    eyebrow: "EXECUTION INTELLIGENCE / REVIEWED",
    title: "Business learning ledger",
    description: "Hara captures bounded, redacted evidence while work runs. Nothing changes future behavior until you—or your organization administrator—reviews it.",
    refresh: "Refresh ledger",
    refreshing: "Refreshing…",
    sync: "Sync organization",
    syncing: "Syncing…",
    review: "Review queue",
    active: "In force",
    organization: "Organization",
    history: "History",
    candidates: "candidates",
    approved: "active rules",
    stable: "stable patterns",
    pending: "need review",
    empty: "No learning records in this view.",
    oldEngine: "Update the bundled Hara engine to use reviewed execution learning.",
    unavailable: "The local Hara engine is not connected.",
    privacyTitle: "Evidence, not surveillance",
    privacy: "Only short redacted receipts, opaque task hashes, and review metadata are stored. Raw conversations, prompts, files, names, and credentials are excluded. Learning is context only—it never grants permission.",
    occurrences: "observations",
    tasks: "tasks",
    revision: "revision",
    evidence: "Evidence receipts",
    rationale: "Why this may matter",
    approve: "Approve",
    reject: "Reject",
    revoke: "Revoke",
    submit: "Submit to Control",
    submitted: "Submitted to Control",
    tentative: "More evidence useful",
    ready: "Promotion ready",
    personal: "Personal",
    project: "Project",
    organizationScope: "Organization",
    statusPending: "Pending",
    statusApproved: "Active",
    statusRejected: "Rejected",
    statusRevoked: "Revoked",
    statusSubmitted: "In Control review",
    reviewSaved: "Review decision saved",
    submitSaved: "Proposal submitted to Hara Control",
    syncSaved: "Organization learning is current",
    noOrganization: "Activate an organization connection to submit proposals or pull its approved learning.",
  },
  zh: {
    eyebrow: "执行智能 / 经审核",
    title: "业务学习台账",
    description: "Hara 在任务执行过程中只采集有边界、已脱敏的证据。未经你或企业管理员审核，不会改变后续行为。",
    refresh: "刷新台账",
    refreshing: "刷新中…",
    sync: "同步企业规则",
    syncing: "同步中…",
    review: "待审核",
    active: "已生效",
    organization: "企业学习",
    history: "历史",
    candidates: "条候选",
    approved: "条生效规则",
    stable: "个稳定模式",
    pending: "条待审核",
    empty: "这个视图中还没有学习记录。",
    oldEngine: "请升级内置 Hara 引擎，以使用执行期业务学习。",
    unavailable: "本机 Hara 引擎尚未连接。",
    privacyTitle: "基于证据，不监控用户",
    privacy: "仅保存简短脱敏凭据、不透明任务哈希与审核元数据；不保存原始对话、提示词、文件、姓名或密钥。学习只提供上下文，绝不扩大权限。",
    occurrences: "次观察",
    tasks: "个任务",
    revision: "版本",
    evidence: "证据凭据",
    rationale: "可能影响",
    approve: "批准生效",
    reject: "拒绝",
    revoke: "撤销",
    submit: "提交到 Control",
    submitted: "已提交 Control",
    tentative: "建议继续积累证据",
    ready: "已达到晋级条件",
    personal: "个人",
    project: "项目",
    organizationScope: "企业",
    statusPending: "待审核",
    statusApproved: "已生效",
    statusRejected: "已拒绝",
    statusRevoked: "已撤销",
    statusSubmitted: "Control 审核中",
    reviewSaved: "审核决定已保存",
    submitSaved: "候选已提交 Hara Control",
    syncSaved: "企业学习已同步到最新版本",
    noOrganization: "启用企业连接后，才能提交候选或拉取企业已批准规则。",
  },
} as const;

const KIND_LABELS: Record<Locale, Record<LearningKind, string>> = {
  en: {
    business_rule: "Business rule",
    user_preference: "Preference",
    workflow: "Workflow",
    correction: "Correction",
    failure_pattern: "Failure pattern",
    action_ownership: "Action ownership",
  },
  zh: {
    business_rule: "业务规则",
    user_preference: "用户偏好",
    workflow: "工作流程",
    correction: "纠错",
    failure_pattern: "失败模式",
    action_ownership: "执行责任",
  },
};

function statusLabel(locale: Locale, status: LearningStatus): string {
  const copy = COPY[locale];
  return {
    pending: copy.statusPending,
    approved: copy.statusApproved,
    rejected: copy.statusRejected,
    revoked: copy.statusRevoked,
    submitted: copy.statusSubmitted,
  }[status];
}

function scopeLabel(locale: Locale, scope: LearningScope): string {
  const copy = COPY[locale];
  return scope === "personal"
    ? copy.personal
    : scope === "project"
      ? copy.project
      : copy.organizationScope;
}

function candidateInView(candidate: LearningCandidate, view: LedgerView): boolean {
  if (view === "organization") return candidate.scope === "organization";
  if (view === "active") return candidate.status === "approved";
  if (view === "history") return candidate.status === "rejected" || candidate.status === "revoked";
  return candidate.status === "pending" || candidate.status === "submitted";
}

function formatMoment(value: string, locale: Locale): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function LearningRow({
  item,
  locale,
  busy,
  organizationSubmitAvailable,
  onReview,
  onSubmit,
}: {
  item: LearningCandidate;
  locale: Locale;
  busy: boolean;
  organizationSubmitAvailable: boolean;
  onReview: (item: LearningCandidate, decision: "approve" | "reject" | "revoke") => void;
  onSubmit: (item: LearningCandidate) => void;
}) {
  const copy = COPY[locale];
  const evidence = item.evidence.slice(-3).reverse();
  const local = item.scope !== "organization";
  return (
    <article className={`learning-row is-${item.status}`}>
      <div className="learning-row-index" aria-hidden>
        <span>R{String(item.revision).padStart(2, "0")}</span>
        <i />
      </div>
      <div className="learning-row-main">
        <header className="learning-row-head">
          <div className="learning-row-tags">
            <span className={`learning-status is-${item.status}`}>{statusLabel(locale, item.status)}</span>
            <span>{scopeLabel(locale, item.scope)}</span>
            <span>{KIND_LABELS[locale][item.kind]}</span>
          </div>
          <time dateTime={item.updatedAt}>{formatMoment(item.updatedAt, locale)}</time>
        </header>
        <code>{item.patternKey}</code>
        <h3>{item.summary}</h3>
        {item.rationale ? (
          <p className="learning-rationale"><b>{copy.rationale}</b>{item.rationale}</p>
        ) : null}
        <div className="learning-signal">
          <span className={item.stability === "stable" ? "is-stable" : ""}>
            {item.stability === "stable" ? copy.ready : copy.tentative}
          </span>
          <span>{item.occurrenceCount} {copy.occurrences}</span>
          <span>{item.distinctTaskCount} {copy.tasks}</span>
          <span>{copy.revision} {item.revision}</span>
        </div>
        <details className="learning-evidence">
          <summary>{copy.evidence} · {item.evidence.length}</summary>
          <div>
            {evidence.map((entry) => (
              <blockquote key={entry.id}>
                <p>{entry.summary}</p>
                <footer>{entry.source} · {formatMoment(entry.observedAt, locale)}</footer>
              </blockquote>
            ))}
          </div>
        </details>
        <footer className="learning-row-actions">
          {local && item.status === "pending" ? (
            <>
              <button type="button" disabled={busy} onClick={() => onReview(item, "approve")}>{copy.approve}</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => onReview(item, "reject")}>{copy.reject}</button>
            </>
          ) : null}
          {local && item.status === "approved" ? (
            <button type="button" className="deny" disabled={busy} onClick={() => onReview(item, "revoke")}>{copy.revoke}</button>
          ) : null}
          {!local && item.status === "pending" ? (
            <button
              type="button"
              disabled={busy || item.stability !== "stable" || !organizationSubmitAvailable}
              onClick={() => onSubmit(item)}
            >
              {copy.submit}
            </button>
          ) : null}
          {!local && item.status === "submitted" ? <SettingsBadge tone="warning">{copy.submitted}</SettingsBadge> : null}
        </footer>
      </div>
    </article>
  );
}

export function LearningCenter({ client, cwd, locale }: LearningCenterProps) {
  const copy = COPY[locale];
  const [ledger, setLedger] = useState<LearningListResult | "old-engine" | null>(null);
  const [view, setView] = useState<LedgerView>("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async () => {
    if (!client) {
      setLedger(null);
      return;
    }
    const result = await client.listLearnings(cwd);
    setLedger(result ?? "old-engine");
  }, [client, cwd]);

  useEffect(() => {
    let active = true;
    void refresh().catch((error) => {
      if (active) setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [refresh]);

  const visible = useMemo(() => {
    if (!ledger || ledger === "old-engine") return [];
    return ledger.learnings.filter((item) => candidateInView(item, view));
  }, [ledger, view]);

  const review = useCallback(async (
    item: LearningCandidate,
    decision: "approve" | "reject" | "revoke",
  ) => {
    if (!client) return;
    setBusy(item.id);
    setNotice(null);
    try {
      await client.reviewLearning(item.id, decision, item.revision, cwd);
      await refresh();
      setNotice({ tone: "success", title: copy.reviewSaved });
    } catch (error) {
      setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }, [client, copy.reviewSaved, cwd, refresh]);

  const submit = useCallback(async (item: LearningCandidate) => {
    if (!client) return;
    setBusy(item.id);
    setNotice(null);
    try {
      await client.submitOrganizationLearning(item.id, cwd);
      await refresh();
      setNotice({ tone: "success", title: copy.submitSaved });
    } catch (error) {
      setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }, [client, copy.submitSaved, cwd, refresh]);

  const sync = useCallback(async () => {
    if (!client) return;
    setBusy("sync");
    setNotice(null);
    try {
      const result = await client.syncOrganizationLearnings(cwd);
      await refresh();
      setNotice({ tone: "success", title: copy.syncSaved, detail: `v${result.version} · ${result.learnings.length}` });
    } catch (error) {
      setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }, [client, copy.syncSaved, cwd, refresh]);

  const manualRefresh = useCallback(async () => {
    if (!client) return;
    setBusy("refresh");
    setNotice(null);
    try {
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const data = ledger && ledger !== "old-engine" ? ledger : undefined;
  const tabs: Array<{ id: LedgerView; label: string; count: number }> = [
    { id: "review", label: copy.review, count: data?.learnings.filter((item) => candidateInView(item, "review")).length ?? 0 },
    { id: "active", label: copy.active, count: data?.summary.approved ?? 0 },
    { id: "organization", label: copy.organization, count: data?.learnings.filter((item) => item.scope === "organization").length ?? 0 },
    { id: "history", label: copy.history, count: data?.learnings.filter((item) => candidateInView(item, "history")).length ?? 0 },
  ];

  return (
    <SettingsPage
      id="settings-learning-title"
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      actions={(
        <div className="learning-page-actions">
          {data?.organization.syncAvailable ? (
            <button type="button" className="ghost" disabled={busy !== null} onClick={() => void sync()}>
              {busy === "sync" ? copy.syncing : copy.sync}
            </button>
          ) : null}
          <button type="button" className="ghost" disabled={busy !== null} onClick={() => void manualRefresh()}>
            {busy === "refresh" ? copy.refreshing : copy.refresh}
          </button>
        </div>
      )}
    >
      {data ? (
        <>
          <section className="learning-scoreboard" aria-label={copy.title}>
            <div><strong>{data.summary.total}</strong><span>{copy.candidates}</span></div>
            <div><strong>{data.summary.approved}</strong><span>{copy.approved}</span></div>
            <div><strong>{data.summary.stable}</strong><span>{copy.stable}</span></div>
            <div><strong>{data.summary.pending}</strong><span>{copy.pending}</span></div>
          </section>
          <SettingsNotice tone="neutral" title={copy.privacyTitle}>{copy.privacy}</SettingsNotice>
          {!data.organization.active ? <SettingsNotice tone="neutral" title={copy.noOrganization} /> : null}
          {notice ? <SettingsNotice tone={notice.tone} title={notice.title}>{notice.detail}</SettingsNotice> : null}
          <nav className="learning-tabs" aria-label={copy.title}>
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={view === tab.id ? "is-active" : ""}
                aria-current={view === tab.id ? "page" : undefined}
                onClick={() => setView(tab.id)}
              >
                <span>{tab.label}</span><b>{tab.count}</b>
              </button>
            ))}
          </nav>
          <section className="learning-ledger" aria-live="polite">
            {visible.length ? visible.map((item) => (
              <LearningRow
                key={item.id}
                item={item}
                locale={locale}
                busy={busy !== null}
                organizationSubmitAvailable={data.organization.submitAvailable}
                onReview={(candidate, decision) => void review(candidate, decision)}
                onSubmit={(candidate) => void submit(candidate)}
              />
            )) : <div className="learning-empty">{copy.empty}</div>}
          </section>
        </>
      ) : (
        <SettingsNotice tone={ledger === "old-engine" ? "warning" : "neutral"} title={ledger === "old-engine" ? copy.oldEngine : copy.unavailable} />
      )}
    </SettingsPage>
  );
}
