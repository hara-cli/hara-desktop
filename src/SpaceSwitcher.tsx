import { useEffect, useRef, useState } from "react";
import type { SpaceDirectory } from "./client";
import "./SpaceSwitcher.css";

interface SpaceSwitcherProps {
  directory: SpaceDirectory | null;
  locale: "en" | "zh";
  switching?: boolean;
  onSelect: (spaceId: string) => void;
}

export default function SpaceSwitcher({ directory, locale, switching, onSelect }: SpaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = directory?.spaces.find((space) => space.id === directory.activeId)
    ?? directory?.spaces[0];
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!directory || !active) return null;
  const locked = directory.switchLocked;
  return (
    <div className="space-switcher" ref={rootRef}>
      <button
        type="button"
        className="space-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={locked
          ? (locale === "zh" ? "当前项目已固定空间" : "This project pins its Space")
          : (locale === "zh" ? "切换个人 / 公司空间" : "Switch Personal / Company Space")}
        disabled={switching}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`space-mark is-${active.kind}`} aria-hidden>
          {active.kind === "personal" ? "P" : active.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="space-switcher-copy">
          <small>{active.kind === "personal" ? (locale === "zh" ? "个人空间" : "Personal Space") : (locale === "zh" ? "公司空间" : "Company Space")}</small>
          <strong>{active.name}</strong>
        </span>
        <span className="space-switcher-chevron" aria-hidden>{locked ? "⌕" : switching ? "…" : "⌄"}</span>
      </button>
      {open ? (
        <div className="space-switcher-menu" role="listbox" aria-label={locale === "zh" ? "选择空间" : "Choose a Space"}>
          <header>
            <strong>{locale === "zh" ? "你的空间" : "Your Spaces"}</strong>
            <small>{locale === "zh" ? "会话、Agent 与公司策略彼此隔离" : "Conversations, Agents, and company policy stay isolated"}</small>
          </header>
          {directory.spaces.map((space) => (
            <button
              type="button"
              role="option"
              aria-selected={space.id === directory.activeId}
              className={space.id === directory.activeId ? "is-active" : ""}
              key={space.id}
              disabled={locked && space.id !== directory.activeId}
              onClick={() => {
                if (space.id === directory.activeId) return setOpen(false);
                setOpen(false);
                onSelect(space.id);
              }}
            >
              <span className={`space-mark is-${space.kind}`} aria-hidden>
                {space.kind === "personal" ? "P" : space.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{space.name}</strong>
                <small>{space.kind === "personal"
                  ? (locale === "zh" ? "仅你可见 · 可编辑 Agent" : "Private to you · Agent profiles editable")
                  : space.authoritative
                    ? (locale === "zh" ? "公司管理 · 策略受控" : "Company managed · Policy governed")
                    : (locale === "zh" ? "旧版连接 · 建议重新接入" : "Legacy connection · Re-enroll recommended")}</small>
              </span>
              {space.id === directory.activeId ? <b aria-hidden>✓</b> : null}
            </button>
          ))}
          {locked ? <p>{locale === "zh" ? "当前目录通过 .hara-profile 或启动参数固定了空间。" : "The current directory pins its Space through .hara-profile or a launch override."}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
