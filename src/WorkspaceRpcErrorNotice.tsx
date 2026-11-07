import type { Locale, makeT } from "./i18n.ts";
import { workspaceCoreMessage } from "./core-i18n.ts";
import { workspaceMessageText } from "./workspace-settings-copy.ts";
export function WorkspaceRpcErrorNotice({ value, technicalDetail, locale, t, className }: {
  value: string; technicalDetail?: string; locale: Locale; t: ReturnType<typeof makeT>; className: string;
}) {
  if (!value) return null;
  return <div className={className} role="alert">{workspaceCoreMessage(value, locale) ?? workspaceMessageText(t, value)}
    {technicalDetail ? <details><summary>{t("technicalDetails")}</summary><pre>{technicalDetail}</pre></details> : null}</div>;
}
