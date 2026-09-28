import { useId, useState, type KeyboardEvent } from "react";
import type { Key } from "./i18n";

interface DecisionCardProps {
  question: string;
  options: string[];
  busy: boolean;
  t: (key: Key) => string;
  onSelect: (option: string) => Promise<void>;
}

function optionKey(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

/** A durable ask_user choice is conversation, not a settings form. The Engine remains authoritative:
 * this component only submits one stable option and waits for the task-state event to dismiss it. */
export function DecisionCard({ question, options, busy, t, onSelect }: DecisionCardProps) {
  const labelId = useId();
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const disabled = busy || pending !== null;

  const select = async (option: string): Promise<void> => {
    if (disabled) return;
    setFailed(false);
    setPending(option);
    try {
      await onSelect(option);
    } catch {
      setFailed(true);
      setPending(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>): void => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-decision-option]"));
    if (!buttons.length || disabled) return;
    const activeIndex = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      buttons[(activeIndex + 1) % buttons.length]?.focus();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      buttons[(activeIndex - 1 + buttons.length) % buttons.length]?.focus();
      return;
    }
    const numericIndex = /^[1-8]$/.test(event.key) ? Number(event.key) - 1 : -1;
    const letterIndex = /^[a-h]$/i.test(event.key) ? event.key.toUpperCase().charCodeAt(0) - 65 : -1;
    const shortcutIndex = numericIndex >= 0 ? numericIndex : letterIndex;
    if (shortcutIndex >= 0 && shortcutIndex < options.length) {
      event.preventDefault();
      void select(options[shortcutIndex]!);
    }
  };

  return (
    <fieldset
      className="decision-card"
      disabled={disabled}
      aria-labelledby={labelId}
      aria-busy={pending !== null}
      onKeyDown={handleKeyDown}
    >
      <legend>{t("decisionNeeded")}</legend>
      <div className="decision-card-question" id={labelId}>{question}</div>
      <div className="decision-card-options">
        {options.map((option, index) => (
          <button
            type="button"
            data-decision-option
            aria-keyshortcuts={`${optionKey(index)} ${index + 1}`}
            key={`${index}:${option}`}
            onClick={() => void select(option)}
          >
            <span className="decision-option-key" aria-hidden="true">{optionKey(index)}</span>
            <span className="decision-option-copy">{option}</span>
            <span className="decision-option-state" aria-hidden="true">
              {pending === option ? "•••" : "›"}
            </span>
          </button>
        ))}
      </div>
      <small>{failed ? t("decisionFailed") : t("decisionHint")}</small>
    </fieldset>
  );
}
