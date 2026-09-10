import type { Key } from "./i18n";
import { Md } from "./markdown";
import { MessageCopyButton } from "./MessageCopyButton";

export function AssistantMessage({
  text,
  t,
}: {
  text: string;
  t: (key: Key) => string;
}) {
  return (
    <div className="assistant-message">
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
}
