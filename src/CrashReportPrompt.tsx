import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import bundledEngineVersionText from "../src-tauri/binaries/SIDECAR_VERSION?raw";
import { detectLocale } from "./i18n";
import "./crash-report-prompt.css";

type CrashDraft = {
  reportVersion: number;
  consentVersion: number;
  appVersion: string;
  platform: "windows" | "macos" | "linux";
  arch: string;
  kind: "unclean_exit" | "renderer_exception" | "renderer_unresponsive";
  occurredAtMs: number;
  fingerprint: string;
  summary: string;
  context: string[];
};

type CrashReceipt = {
  reportId: string;
  status: "received";
  occurrenceCount: number;
};

const engineVersion = bundledEngineVersionText.trim();

const COPY = {
  zh: {
    kicker: "HARA · 故障信标",
    title: "帮助我们定位上一次异常退出",
    body: "Hara 在本机留下了一份小型诊断草稿。只有你确认后才会上传；忽略后会立即删除。",
    included: "将上传的内容",
    excluded: "不会上传对话、文件内容、API Key、Cookie、完整本机路径或供应商请求。",
    app: "Desktop 版本",
    engine: "内置引擎版本",
    system: "系统",
    event: "故障类型",
    time: "发生时间",
    fingerprint: "去重指纹",
    context: "安全上下文",
    noContext: "没有额外上下文",
    description: "当时正在做什么？（可选）",
    placeholder: "例如：在项目中点击“新会话”后窗口退出。请勿粘贴密钥、聊天内容或客户数据。",
    warning: "提交即表示你同意将上方字段和这段补充说明发送至南荒科技，用于故障排查。",
    discard: "不上传并删除",
    submit: "同意并上传",
    submitting: "正在安全上传…",
    success: "报告已收到",
    successBody: "感谢。相同故障会自动合并，不会重复制造工单。",
    close: "完成",
    retry: "上传失败，请检查网络后重试。草稿仍只保存在本机。",
    discardFailed: "暂时无法删除本机草稿，请重新启动 Hara 后重试。",
  },
  en: {
    kicker: "HARA · CRASH BEACON",
    title: "Help us diagnose the last unexpected exit",
    body: "Hara kept a small diagnostic draft on this device. It is uploaded only after you approve it, and deleted if you decline.",
    included: "What will be uploaded",
    excluded: "No chats, file contents, API keys, cookies, full local paths, or provider payloads are included.",
    app: "Desktop version",
    engine: "Bundled engine",
    system: "System",
    event: "Failure type",
    time: "Occurred",
    fingerprint: "Deduplication fingerprint",
    context: "Safe context",
    noContext: "No additional context",
    description: "What were you doing? (optional)",
    placeholder: "For example: the window exited after I clicked New session. Do not paste keys, chat content, or customer data.",
    warning: "By submitting, you consent to send the fields above and this note to Nanhara Technology for troubleshooting.",
    discard: "Delete without uploading",
    submit: "Approve & upload",
    submitting: "Uploading safely…",
    success: "Report received",
    successBody: "Thank you. Matching failures are merged automatically instead of creating duplicate issues.",
    close: "Done",
    retry: "Upload failed. Check your connection and retry; the draft remains only on this device.",
    discardFailed: "The local draft could not be deleted. Restart Hara and try again.",
  },
} as const;

function kindLabel(kind: CrashDraft["kind"], locale: "zh" | "en") {
  const labels = {
    zh: {
      unclean_exit: "上一次运行未正常关闭",
      renderer_exception: "界面异常",
      renderer_unresponsive: "界面无响应",
    },
    en: {
      unclean_exit: "Previous run did not close normally",
      renderer_exception: "Renderer exception",
      renderer_unresponsive: "Renderer unresponsive",
    },
  } as const;
  return labels[locale][kind];
}

export function CrashReportHost() {
  const locale = detectLocale();
  const copy = COPY[locale];
  const [draft, setDraft] = useState<CrashDraft | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<"upload" | "discard" | null>(null);
  const [receipt, setReceipt] = useState<CrashReceipt | null>(null);

  const loadDraft = useCallback(async () => {
    try {
      setDraft(await invoke<CrashDraft | null>("pending_crash_report"));
    } catch {
      // Failure reporting must never block the product's recovery path.
    }
  }, []);

  useEffect(() => {
    void loadDraft();
    window.addEventListener("hara-crash-draft-updated", loadDraft);
    return () => window.removeEventListener("hara-crash-draft-updated", loadDraft);
  }, [loadDraft]);

  const occurredAt = useMemo(() => {
    if (!draft) return "";
    const date = new Date(draft.occurredAtMs);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(locale === "zh" ? "zh-CN" : "en") : "—";
  }, [draft, locale]);

  const discard = async () => {
    setNotice(null);
    try {
      await invoke("discard_pending_crash_report");
      setDraft(null);
      setDescription("");
    } catch {
      setNotice("discard");
    }
  };

  const submit = async () => {
    if (!draft || submitting) return;
    setNotice(null);
    setSubmitting(true);
    try {
      const result = await invoke<CrashReceipt>("submit_crash_report", {
        report: {
          reportVersion: draft.reportVersion,
          consentVersion: draft.consentVersion,
          appVersion: draft.appVersion,
          engineVersion,
          platform: draft.platform,
          arch: draft.arch,
          kind: draft.kind,
          occurredAt: new Date(draft.occurredAtMs).toISOString(),
          fingerprint: draft.fingerprint,
          summary: draft.summary,
          userDescription: description.trim(),
          context: draft.context,
        },
      });
      setReceipt(result);
      setDraft(null);
      setDescription("");
    } catch {
      setNotice("upload");
    } finally {
      setSubmitting(false);
    }
  };

  if (!draft && !receipt) return null;

  return (
    <div className="crash-consent-backdrop" role="presentation">
      <section className="crash-consent-card" role="dialog" aria-modal="true" aria-labelledby="crash-consent-title">
        <div className="crash-consent-beacon" aria-hidden="true"><span /></div>
        <p className="crash-consent-kicker">{copy.kicker}</p>
        {receipt ? (
          <>
            <h2 id="crash-consent-title">{copy.success}</h2>
            <p className="crash-consent-lead">{copy.successBody}</p>
            <p className="crash-consent-receipt"><span>ID</span><code>{receipt.reportId}</code></p>
            <div className="crash-consent-actions single">
              <button type="button" onClick={() => setReceipt(null)}>{copy.close}</button>
            </div>
          </>
        ) : draft ? (
          <>
            <h2 id="crash-consent-title">{copy.title}</h2>
            <p className="crash-consent-lead">{copy.body}</p>
            <div className="crash-consent-manifest">
              <strong>{copy.included}</strong>
              <dl>
                <div><dt>{copy.app}</dt><dd>{draft.appVersion}</dd></div>
                <div><dt>{copy.engine}</dt><dd>{engineVersion || "—"}</dd></div>
                <div><dt>{copy.system}</dt><dd>{draft.platform} · {draft.arch}</dd></div>
                <div><dt>{copy.event}</dt><dd>{kindLabel(draft.kind, locale)}</dd></div>
                <div><dt>{copy.time}</dt><dd>{occurredAt}</dd></div>
                <div><dt>{copy.fingerprint}</dt><dd><code>{draft.fingerprint}</code></dd></div>
                <div><dt>{copy.context}</dt><dd>{draft.context.length ? draft.context.join(" · ") : copy.noContext}</dd></div>
              </dl>
              <p>{copy.excluded}</p>
            </div>
            <label className="crash-consent-description">
              <span>{copy.description}</span>
              <textarea
                value={description}
                maxLength={1200}
                rows={3}
                placeholder={copy.placeholder}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <p className="crash-consent-warning">{copy.warning}</p>
            {notice && <p className="crash-consent-error" role="alert">{notice === "upload" ? copy.retry : copy.discardFailed}</p>}
            <div className="crash-consent-actions">
              <button type="button" className="ghost" disabled={submitting} onClick={() => void discard()}>{copy.discard}</button>
              <button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? copy.submitting : copy.submit}</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
