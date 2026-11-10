import { memo, useMemo, useRef } from "react";
import type { Key } from "./i18n";
import { Md } from "./markdown";
import { MessageActions } from "./MessageActions";
import { currentClientLocale } from "./core-i18n";
import { splitAssistantTechnicalReceipt } from "./execution-presentation";

export const AssistantMessage = memo(function AssistantMessage({
  text,
  t,
  author = "Hara",
  showAuthor = false,
}: {
  text: string;
  t: (key: Key) => string;
  author?: string;
  showAuthor?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const initials = Array.from(author.trim() || "Hara").slice(0, 2).join("").toLocaleUpperCase();
  const presentation = useMemo(() => splitAssistantTechnicalReceipt(text), [text]);
  return (
    <div className="assistant-message">
      {showAuthor ? <div className="assistant-message-author">
        <span aria-hidden="true">{initials}</span>
        <strong>{author}</strong>
      </div> : null}
      <div ref={body} className="msg assistant">
        <Md
          text={presentation.visibleText}
          copyCodeLabel={t("copyCode")}
          copiedLabel={t("taskCopied")}
          copyFailedLabel={t("copyFailed")}
        />
        {presentation.technicalText ? (
          <details className="assistant-technical-details">
            <summary>{t("technicalDetails")}</summary>
            <div>
              <Md
                text={presentation.technicalText}
                copyCodeLabel={t("copyCode")}
                copiedLabel={t("taskCopied")}
                copyFailedLabel={t("copyFailed")}
              />
            </div>
          </details>
        ) : null}
      </div>
      <MessageActions text={text} body={body} locale={currentClientLocale().tag} copyLabel={t("copyResponse")} copiedLabel={t("taskCopied")} failedLabel={t("copyFailed")} />
    </div>
  );
});
