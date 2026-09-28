import { memo } from "react";
import type { Key } from "./i18n";
import { Md } from "./markdown";
import { MessageCopyButton } from "./MessageCopyButton";

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
  return (
    <div className="assistant-message">
      <div className="assistant-message-author">
        <span aria-hidden="true">{initials}</span>
        <strong>{author}</strong>
      </div>
      <div className="msg assistant">
        <Md
          text={text}
          copyCodeLabel={t("copyCode")}
          copiedLabel={t("taskCopied")}
          copyFailedLabel={t("copyFailed")}
        />
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
