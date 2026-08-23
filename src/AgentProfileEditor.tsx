import { useEffect, useRef, useState } from "react";
import type { AgentInfo, AgentPublicIdentity } from "./client";
import { AgentPortrait } from "./AgentPortrait";
import { MAX_AGENT_AVATAR_BYTES } from "./agent-visual";
import "./AgentProfileEditor.css";

type EditableIdentity = Omit<AgentPublicIdentity, "version" | "source">;

interface AgentProfileEditorProps {
  agent: AgentInfo;
  locale: "en" | "zh";
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (profile: EditableIdentity) => void;
  onArchive?: () => void;
}

export default function AgentProfileEditor({
  agent,
  locale,
  saving,
  error,
  onClose,
  onSave,
  onArchive,
}: AgentProfileEditorProps) {
  const identity = agent.identity;
  const [displayName, setDisplayName] = useState(identity?.displayName || agent.name);
  const [title, setTitle] = useState(identity?.title || "");
  const [bio, setBio] = useState(identity?.bio || agent.description || "");
  const [traits, setTraits] = useState((identity?.traits ?? []).join(", "));
  const [emoji, setEmoji] = useState(identity?.emoji || "");
  const [avatar, setAvatar] = useState(identity?.avatar || "");
  const [theme, setTheme] = useState(identity?.theme || "");
  const [accent, setAccent] = useState(identity?.accent || "#ff695f");
  const [character, setCharacter] = useState(identity?.character || "");
  const [localError, setLocalError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = agent.allowedActions?.includes("edit_profile") === true && Boolean(agent.revision);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, saving]);

  const preview: AgentPublicIdentity = {
    version: 1,
    displayName: displayName.trim() || agent.name,
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(bio.trim() ? { bio: bio.trim() } : {}),
    ...(traits.trim() ? { traits: traits.split(/[,，、]/).map((item) => item.trim()).filter(Boolean).slice(0, 6) } : {}),
    ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
    ...(avatar ? { avatar } : {}),
    ...(theme.trim() ? { theme: theme.trim() } : {}),
    ...(accent.trim() ? { accent: accent.trim() } : {}),
    ...(character.trim() ? { character: character.trim().toLowerCase() } : {}),
    source: identity?.source ?? "hara",
  };

  const chooseAvatar = (file?: File) => {
    setLocalError("");
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp|gif)$/.test(file.type)) {
      setLocalError(locale === "zh" ? "头像仅支持 PNG、JPEG、WebP 或 GIF。" : "Use a PNG, JPEG, WebP, or GIF avatar.");
      return;
    }
    if (file.size > MAX_AGENT_AVATAR_BYTES) {
      setLocalError(locale === "zh" ? "头像需小于 128 KB。" : "Avatar images must be 128 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setLocalError(locale === "zh" ? "无法读取头像文件。" : "Could not read the avatar file.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="agent-profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="agent-profile-editor" role="dialog" aria-modal="true" aria-labelledby="agent-profile-title">
        <header>
          <div className="agent-profile-preview">
            <AgentPortrait agentRef={agent.ref} name={agent.name} identity={preview} size="large" />
            <span>
              <small>{agent.owner === "organization" ? (locale === "zh" ? "公司 Agent" : "Company Agent") : (locale === "zh" ? "个人 Agent" : "Personal Agent")}</small>
              <strong id="agent-profile-title">{locale === "zh" ? "Agent 名片" : "Agent Profile"}</strong>
              <em>@{agent.ref}</em>
            </span>
          </div>
          <button type="button" className="agent-profile-close" aria-label={locale === "zh" ? "关闭" : "Close"} disabled={saving} onClick={onClose}>×</button>
        </header>

        {!editable ? (
          <div className="agent-profile-governed">
            <b aria-hidden>⌾</b>
            <span>
              <strong>{locale === "zh" ? "此资料由公司管理员管理" : "Managed by a company administrator"}</strong>
              <small>{locale === "zh" ? "你仍可与该 Agent 对话；名称、头像与简介需要拥有相应权限的公司管理员维护。" : "You can still chat with this Agent. Its name, avatar, and bio require a company administrator with the corresponding permission."}</small>
            </span>
          </div>
        ) : null}

        <div className="agent-profile-form" aria-disabled={!editable}>
          <div className="agent-profile-avatar-field">
            <AgentPortrait agentRef={agent.ref} name={agent.name} identity={preview} size="large" />
            <span>
              <button type="button" disabled={!editable || saving} onClick={() => fileRef.current?.click()}>{locale === "zh" ? "更换头像" : "Change avatar"}</button>
              {avatar ? <button type="button" className="ghost" disabled={!editable || saving} onClick={() => setAvatar("")}>{locale === "zh" ? "移除" : "Remove"}</button> : null}
              <small>PNG / JPEG / WebP / GIF · 128 KB</small>
            </span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => chooseAvatar(event.target.files?.[0])} />
          </div>
          <div className="agent-profile-grid">
            <label>
              <span>{locale === "zh" ? "昵称" : "Display name"}</span>
              <input maxLength={64} disabled={!editable || saving} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              <span>{locale === "zh" ? "职位" : "Title"}</span>
              <input maxLength={80} disabled={!editable || saving} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="is-wide">
              <span>{locale === "zh" ? "简介" : "Bio"}</span>
              <textarea maxLength={220} rows={3} disabled={!editable || saving} value={bio} onChange={(event) => setBio(event.target.value)} />
            </label>
            <label>
              <span>{locale === "zh" ? "性格标签" : "Traits"}</span>
              <input disabled={!editable || saving} value={traits} placeholder={locale === "zh" ? "直接, 好奇, 严谨" : "direct, curious, rigorous"} onChange={(event) => setTraits(event.target.value)} />
            </label>
            <label>
              <span>{locale === "zh" ? "标志 Emoji" : "Emoji"}</span>
              <input maxLength={24} disabled={!editable || saving} value={emoji} onChange={(event) => setEmoji(event.target.value)} />
            </label>
            <label>
              <span>{locale === "zh" ? "视觉主题" : "Visual theme"}</span>
              <input maxLength={72} disabled={!editable || saving} value={theme} onChange={(event) => setTheme(event.target.value)} />
            </label>
            <label>
              <span>{locale === "zh" ? "角色原型" : "Character"}</span>
              <input maxLength={32} disabled={!editable || saving} value={character} placeholder="architect" onChange={(event) => setCharacter(event.target.value)} />
            </label>
            <label>
              <span>{locale === "zh" ? "强调色" : "Accent"}</span>
              <span className="agent-profile-color"><input type="color" disabled={!editable || saving} value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#ff695f"} onChange={(event) => setAccent(event.target.value)} /><input maxLength={7} disabled={!editable || saving} value={accent} onChange={(event) => setAccent(event.target.value)} /></span>
            </label>
          </div>
        </div>

        {(localError || error) ? <p className="agent-profile-error">{localError || error}</p> : null}
        <footer>
          {editable && agent.allowedActions?.includes("archive") && onArchive ? (
            <button type="button" className="agent-profile-dismiss" disabled={saving} onClick={onArchive}>{locale === "zh" ? "解除雇佣" : "Dismiss Agent"}</button>
          ) : null}
          <span className="agent-profile-footer-spacer" />
          <button type="button" className="ghost" disabled={saving} onClick={onClose}>{editable ? (locale === "zh" ? "取消" : "Cancel") : (locale === "zh" ? "关闭" : "Close")}</button>
          {editable ? <button type="button" disabled={saving || !displayName.trim()} onClick={() => onSave({
            displayName: displayName.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(bio.trim() ? { bio: bio.trim() } : {}),
            ...(traits.trim() ? { traits: traits.split(/[,，、]/).map((item) => item.trim()).filter(Boolean).slice(0, 6) } : {}),
            ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
            ...(avatar ? { avatar } : {}),
            ...(theme.trim() ? { theme: theme.trim() } : {}),
            ...(accent.trim() ? { accent: accent.trim() } : {}),
            ...(character.trim() ? { character: character.trim().toLowerCase() } : {}),
          })}>{saving ? (locale === "zh" ? "保存中…" : "Saving…") : (locale === "zh" ? "保存名片" : "Save profile")}</button> : null}
        </footer>
      </section>
    </div>
  );
}
