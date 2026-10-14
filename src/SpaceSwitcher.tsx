import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { SpaceDirectory } from "./client";
import { IconChevronDown, IconLock } from "./icons";
import "./SpaceSwitcher.css";

interface SpaceSwitcherProps {
  directory: SpaceDirectory | null;
  locale: "en" | "zh";
  switching?: boolean;
  onSelect: (spaceId: string) => void;
}

export default function SpaceSwitcher({ directory, locale, switching, onSelect }: SpaceSwitcherProps) {
  const [openScope, setOpenScope] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"selected" | "first" | "last">("selected");
  const menuId = useId();
  // Missing authority must not be presented as the first available Workspace. A menu opened against
  // one directory also becomes unusable immediately when its route, lock or membership changes.
  const active = directory?.spaces.find((space) => space.id === directory.activeId);
  const scope = JSON.stringify([directory?.activeId, directory?.activeProfileId, directory?.switchLocked,
    Boolean(switching), directory?.spaces.map((space) => [space.id, space.profileId, space.kind,
      space.accessState, space.authoritative, space.agentProfilePermission])]);
  const open = openScope === scope && !switching;
  useEffect(() => { setOpenScope(null); }, [scope]);
  useEffect(() => {
    if (!open) return;
    const options = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const selected = options.find((option) => option.getAttribute("aria-checked") === "true");
    (initialFocus.current === "last" ? options[options.length - 1]
      : initialFocus.current === "first" ? options[0] : selected ?? options[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenScope(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenScope(null);
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
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
  const name = (space: SpaceDirectory["spaces"][number]): string => (
    space.kind === "personal" && space.name === "Personal"
      ? (locale === "zh" ? "我的工作空间" : "My Workspace") : space.name
  );
  const activeName = name(active);
  const unavailable = (space: SpaceDirectory["spaces"][number]): boolean =>
    space.kind === "organization" && (space.accessState === "expired" || space.accessState === "invalid");
  const showMenu = (focus: "selected" | "first" | "last" = "selected") => {
    initialFocus.current = focus;
    setOpenScope(scope);
  };
  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : index < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1)
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  };
  return (
    <div className="space-switcher" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpenScope(null);
    }}>
      <button
        ref={triggerRef}
        type="button"
        className="space-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={locked
          ? (locale === "zh" ? "当前目录已固定工作空间" : "The current directory pins this Workspace")
          : (locale === "zh" ? "切换工作空间" : "Switch Workspace")}
        disabled={switching}
        onClick={() => open ? setOpenScope(null) : showMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            showMenu(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      >
        <span className="space-mark" aria-hidden>
          {Array.from(activeName)[0]?.toUpperCase()}
        </span>
        <span className="space-switcher-copy">
          <strong>{activeName}</strong>
          <small>{switching ? (locale === "zh" ? "正在切换…" : "Switching…") : "Workspace"}</small>
        </span>
        <span className="space-switcher-chevron" aria-hidden>{locked ? <IconLock size={13} /> : switching ? "…" : <IconChevronDown size={13} />}</span>
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} className="space-switcher-menu" role="menu"
          aria-label={locale === "zh" ? "选择工作空间" : "Choose a Workspace"} onKeyDown={navigateMenu}>
          <header>
            <strong>{locale === "zh" ? "工作空间" : "Workspaces"}</strong>
            <small>{locale === "zh" ? "切换后回到该空间的对话与连接" : "Return to this Workspace’s conversations and connection"}</small>
          </header>
          {directory.spaces.map((space) => {
            const spaceUnavailable = unavailable(space);
            return (
            <button
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={space.id === directory.activeId}
              className={`${space.id === directory.activeId ? "is-active" : ""}${spaceUnavailable ? " is-unavailable" : ""}`}
              key={space.id}
              disabled={(locked && space.id !== directory.activeId) || (spaceUnavailable && space.id !== directory.activeId)}
              title={spaceUnavailable
                ? (locale === "zh" ? "托管连接授权已失效，请在“模型与连接”中重新注册" : "Managed access is unavailable; re-enroll in Models & Connections")
                : undefined}
              onClick={() => {
                setOpenScope(null);
                triggerRef.current?.focus();
                if (space.id === directory.activeId) return;
                onSelect(space.id);
              }}
            >
              <span className="space-mark" aria-hidden>
                {Array.from(name(space))[0]?.toUpperCase()}
              </span>
              <span>
                <strong>{name(space)}</strong>
                <small>{spaceUnavailable
                  ? (locale === "zh" ? "授权已失效 · 重新注册后可切换" : "Access unavailable · Re-enroll to switch")
                  : space.kind === "personal"
                  ? (locale === "zh" ? "私人对话 · 自有连接" : "Private conversations · Your connections")
                  : space.authoritative
                    ? (locale === "zh" ? "托管连接 · 策略受控" : "Managed connection · Policy governed")
                    : (locale === "zh" ? "旧版连接 · 建议重新接入" : "Legacy connection · Re-enroll recommended")}</small>
              </span>
              {space.id === directory.activeId ? <b aria-hidden>✓</b> : null}
            </button>
            );
          })}
          {locked ? <p>{locale === "zh" ? "当前目录通过 .hara-profile、环境或启动参数固定了工作空间。" : "The current directory pins this Workspace through .hara-profile, environment or launch overrides."}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
