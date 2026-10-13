import type { Locale } from "./i18n";
import type { ModelConnectionFailureKind } from "./turn-failure";

/** Keep the pinned connection visible even though it is not an alternative transfer target. */
export default function ModelConnectionRecovery({ label, provider, model, failure, hasNativeImages, locale, onManage }: {
  label: string; provider?: string; model: string; failure?: ModelConnectionFailureKind;
  hasNativeImages: boolean; locale: Locale; onManage: () => void;
}) {
  return <section className="model-connection-recovery" aria-label={locale === "zh" ? "当前对话连接" : "Current conversation connection"}>
    <small>{locale === "zh" ? "当前对话连接" : "Current conversation connection"}</small>
    <strong>{label}</strong>
    <small>{[provider, model].filter(Boolean).join(" · ")}</small>
    <p>{failure === "quota"
      ? (locale === "zh" ? "服务商报告此连接额度或余额不足。请选择其他连接，或在服务商处核验额度与重置时间；不同套餐的模型限额和抵扣规则以服务商为准。"
        : "The provider reports insufficient allowance or balance for this connection. Choose another connection or check the allowance and reset time with the provider; model limits and plan usage rules vary by provider.")
      : failure === "authentication"
        ? (locale === "zh" ? "此连接认证失败。Token Plan 等连接的凭据在“模型与连接”中管理；选择其他连接会先确认，再复制上下文。"
          : "This connection could not authenticate. Manage credentials for Token Plan and other connections in Models & connections, or confirm a transfer to another saved connection.")
        : (locale === "zh" ? "此处选择已保存的连接。当前连接可在“模型与连接”中管理。"
          : "Choose a saved connection here. Manage the current connection in Models & connections.")}</p>
    {hasNativeImages ? <p role="status">{locale === "zh"
      ? "历史含原生图片；个人目标连接须使用已确认支持图片的模型。不会丢弃图片或自动发送。"
      : "History contains native images. A personal target needs a model with confirmed image support. Images are kept and nothing is sent automatically."}</p> : null}
    <button type="button" className="model-repair-connection" onClick={onManage}>{locale === "zh" ? "管理当前连接" : "Manage current connection"}</button>
  </section>;
}
