import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import bundledEngineVersionText from "../src-tauri/binaries/SIDECAR_VERSION?raw";
import { detectLocale, makeT } from "./i18n";
import type { Locale } from "./i18n-runtime.ts";
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

/**
 * Crash-consent copy lives in the locale JSON (ws.crash.*) so the three languages stay
 * in step and the shell's fallback chain applies. The previous inline COPY table was
 * Simplified + English only, and it formatted the timestamp with a fixed zh-CN locale
 * for every Chinese reader (audit §1.1, §5).
 */
const COPY_KEYS = {
  kicker: "ws.crash.kicker", title: "ws.crash.title", body: "ws.crash.body",
  included: "ws.crash.included", excluded: "ws.crash.excluded", app: "ws.crash.app",
  engine: "ws.crash.engine", system: "ws.crash.system", event: "ws.crash.event",
  time: "ws.crash.time", fingerprint: "ws.crash.fingerprint", context: "ws.crash.context",
  noContext: "ws.crash.noContext", description: "ws.crash.description", placeholder: "ws.crash.placeholder",
  warning: "ws.crash.warning", discard: "ws.crash.discard", submit: "ws.crash.submit",
  submitting: "ws.crash.submitting", success: "ws.crash.success", successBody: "ws.crash.successBody",
  close: "ws.crash.close", retry: "ws.crash.retry", discardFailed: "ws.crash.discardFailed",
} as const;
type CopyField = keyof typeof COPY_KEYS;

const KIND_KEYS: Record<CrashDraft["kind"], string> = {
  unclean_exit: "ws.crash.kind.uncleanExit",
  renderer_exception: "ws.crash.kind.rendererException",
  renderer_unresponsive: "ws.crash.kind.rendererUnresponsive",
};

function kindLabel(kind: CrashDraft["kind"], t: ReturnType<typeof makeT>) {
  return t(KIND_KEYS[kind] as Parameters<ReturnType<typeof makeT>>[0]);
}

export function CrashReportHost() {
  const locale: Locale = detectLocale();
  const t = makeT(locale);
  const copy = (field: CopyField) => t(COPY_KEYS[field] as Parameters<typeof t>[0]);
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
    return Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "—";
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
        <p className="crash-consent-kicker">{copy("kicker")}</p>
        {receipt ? (
          <>
            <h2 id="crash-consent-title">{copy("success")}</h2>
            <p className="crash-consent-lead">{copy("successBody")}</p>
            <p className="crash-consent-receipt"><span>ID</span><code>{receipt.reportId}</code></p>
            <div className="crash-consent-actions single">
              <button type="button" onClick={() => setReceipt(null)}>{copy("close")}</button>
            </div>
          </>
        ) : draft ? (
          <>
            <h2 id="crash-consent-title">{copy("title")}</h2>
            <p className="crash-consent-lead">{copy("body")}</p>
            <div className="crash-consent-manifest">
              <strong>{copy("included")}</strong>
              <dl>
                <div><dt>{copy("app")}</dt><dd>{draft.appVersion}</dd></div>
                <div><dt>{copy("engine")}</dt><dd>{engineVersion || "—"}</dd></div>
                <div><dt>{copy("system")}</dt><dd>{draft.platform} · {draft.arch}</dd></div>
                <div><dt>{copy("event")}</dt><dd>{kindLabel(draft.kind, t)}</dd></div>
                <div><dt>{copy("time")}</dt><dd>{occurredAt}</dd></div>
                <div><dt>{copy("fingerprint")}</dt><dd><code>{draft.fingerprint}</code></dd></div>
                <div><dt>{copy("context")}</dt><dd>{draft.context.length ? draft.context.join(" · ") : copy("noContext")}</dd></div>
              </dl>
              <p>{copy("excluded")}</p>
            </div>
            <label className="crash-consent-description">
              <span>{copy("description")}</span>
              <textarea
                value={description}
                maxLength={1200}
                rows={3}
                placeholder={copy("placeholder")}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <p className="crash-consent-warning">{copy("warning")}</p>
            {notice && <p className="crash-consent-error" role="alert">{notice === "upload" ? copy("retry") : copy("discardFailed")}</p>}
            <div className="crash-consent-actions">
              <button type="button" className="ghost" disabled={submitting} onClick={() => void discard()}>{copy("discard")}</button>
              <button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? copy("submitting") : copy("submit")}</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
