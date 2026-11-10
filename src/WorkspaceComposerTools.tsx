import { useEffect, useRef, useState } from "react";
import { AtSymbolIcon, PaperClipIcon, PlusIcon } from "@heroicons/react/24/outline";

export function WorkspaceComposerTools({ label, attachLabel, mentionLabel, attachDisabled, mentionDisabled, onAttach, onMention }: {
  label: string; attachLabel: string; mentionLabel: string; attachDisabled: boolean; mentionDisabled: boolean; onAttach: () => void; onMention: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="hd-composer-tools" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button type="button" ref={trigger} className="hd-composer-plus" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      disabled={attachDisabled && mentionDisabled} onClick={() => setOpen(value => !value)}><PlusIcon className="hico" /></button>
    {open ? <div className="hd-composer-menu" role="menu" aria-label={label} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
      <button type="button" role="menuitem" disabled={attachDisabled} onClick={() => { setOpen(false); onAttach(); }}><PaperClipIcon className="hico" />{attachLabel}</button>
      <button type="button" role="menuitem" disabled={mentionDisabled} onClick={() => { setOpen(false); onMention(); }}><AtSymbolIcon className="hico" />{mentionLabel}</button>
    </div> : null}
  </div>;
}
