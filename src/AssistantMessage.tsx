import { memo, useMemo } from "react";
import type { Key } from "./i18n";
import { Md } from "./markdown";
import { MessageCopyButton } from "./MessageCopyButton";
import { splitAssistantTechnicalReceipt } from "./execution-presentation";

export const AssistantMessage = memo(function AssistantMessage({
  text,
  t,
  author = "Hara",
}: {
  text: string;
  t: (key: Key) => string;
  author?: string;
}) {
  const initials = Array.from(author.trim() || "Hara").slice(0, 2).join("").toLocaleUpperCase();
  const presentation = useMemo(() => splitAssistantTechnicalReceipt(text), [text]);
  return (
    <div className="assistant-message">
      <div className="assistant-message-author">
        <span aria-hidden="true">{initials}</span>
        <strong>{author}</strong>
      </div>
      <div className="msg assistant">
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
      <div className="assistant-message-actions">
        <MessageCopyButton
          text={text}
          copyLabel={t("copyResponse")}
          copiedLabel={t("taskCopied")}
          failedLabel={t("copyFailed")}
        />
      </div>
    </div>
  );
});
