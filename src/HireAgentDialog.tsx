import { useEffect, useMemo, useState } from "react";
import type { AgentPublicIdentity } from "./client";
import { AgentPortrait } from "./AgentPortrait";
import "./HireAgentDialog.css";

export interface HireAgentInput {
  id: string;
  description?: string;
  instructions?: string;
  profile: Omit<AgentPublicIdentity, "version" | "source">;
}

interface HireAgentDialogProps {
  locale: "en" | "zh";
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onHire: (input: HireAgentInput) => void;
}

export default function HireAgentDialog({ locale, saving, error, onClose, onHire }: HireAgentDialogProps) {
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [traits, setTraits] = useState("");
  const [emoji, setEmoji] = useState("✦");
  const [accent, setAccent] = useState("#4f9c8f");
  const [character, setCharacter] = useState("specialist");
  const [instructions, setInstructions] = useState("");
  const username = id.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  const traitList = useMemo(() => traits.split(/[,，、]/).map((item) => item.trim()).filter(Boolean).slice(0, 6), [traits]);
  const profile: AgentPublicIdentity = {
    version: 1,
    displayName: displayName.trim() || (username ? username.replace(/[._-]+/g, " ") : "New Agent"),
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(bio.trim() ? { bio: bio.trim() } : {}),
    ...(traitList.length ? { traits: traitList } : {}),
    ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
    ...(accent.trim() ? { accent: accent.trim() } : {}),
    ...(character.trim() ? { character: character.trim().toLowerCase() } : {}),
    source: "hara",
  };

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, saving]);

  return (
    <div className="hire-agent-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="hire-agent-dialog" role="dialog" aria-modal="true" aria-labelledby="hire-agent-title">
        <header>
          <div>
            <small>{locale === "zh" ? "PERSONAL · TALENT DESK" : "PERSONAL · TALENT DESK"}</small>
            <strong id="hire-agent-title">{locale === "zh" ? "雇佣一位新 Agent" : "Hire a new Agent"}</strong>
            <p>{locale === "zh" ? "创建独立身份与私有工作提示词；以后可随时修改名片或解除雇佣。" : "Create an independent identity and private work brief. You can edit the profile or dismiss the Agent later."}</p>
          </div>
          <AgentPortrait agentRef={`global:${username || "new-agent"}`} name={profile.displayName} identity={profile} size="large" />
        </header>
        <div className="hire-agent-form">
          <label>
            <span>{locale === "zh" ? "唯一用户名" : "Unique username"}<b>*</b></span>
            <div className="hire-agent-username"><i>@</i><input autoFocus maxLength={64} value={id} placeholder="product-designer" disabled={saving} onChange={(event) => setId(event.target.value)} /></div>
            <small>{locale === "zh" ? `保存为 @global:${username || "…"}，创建后用户名保持稳定。` : `Saved as @global:${username || "…"}; the username remains stable after hiring.`}</small>
          </label>
          <div className="hire-agent-grid">
            <label><span>{locale === "zh" ? "昵称" : "Display name"}<b>*</b></span><input maxLength={64} value={displayName} disabled={saving} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label><span>{locale === "zh" ? "职位" : "Title"}</span><input maxLength={80} value={title} placeholder={locale === "zh" ? "产品设计师" : "Product Designer"} disabled={saving} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="is-wide"><span>{locale === "zh" ? "对团队的公开简介" : "Public team bio"}</span><textarea rows={2} maxLength={220} value={bio} disabled={saving} onChange={(event) => setBio(event.target.value)} /></label>
            <label><span>{locale === "zh" ? "性格标签" : "Traits"}</span><input value={traits} placeholder={locale === "zh" ? "好奇, 直接, 细致" : "curious, direct, meticulous"} disabled={saving} onChange={(event) => setTraits(event.target.value)} /></label>
            <label><span>{locale === "zh" ? "Emoji" : "Emoji"}</span><input maxLength={24} value={emoji} disabled={saving} onChange={(event) => setEmoji(event.target.value)} /></label>
            <label><span>{locale === "zh" ? "角色原型" : "Character"}</span><input maxLength={32} value={character} disabled={saving} onChange={(event) => setCharacter(event.target.value)} /></label>
            <label><span>{locale === "zh" ? "强调色" : "Accent"}</span><span className="hire-agent-color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#4f9c8f"} disabled={saving} onChange={(event) => setAccent(event.target.value)} /><input maxLength={7} value={accent} disabled={saving} onChange={(event) => setAccent(event.target.value)} /></span></label>
            <label className="is-wide"><span>{locale === "zh" ? "私有工作说明" : "Private work brief"}</span><textarea rows={5} maxLength={16000} value={instructions} disabled={saving} placeholder={locale === "zh" ? "例如：你负责产品体验与交互设计。主动查看项目、使用工具完成设计与验证，不把常规执行推回给用户……（留空会按名片自动生成）" : "For example: Own product experience and interaction design. Inspect projects, use tools, and verify outcomes instead of handing routine work back… (leave blank to generate from the profile)"} onChange={(event) => setInstructions(event.target.value)} /><small>{locale === "zh" ? "只有运行该 Agent 时才会加载，不会出现在 Agent 列表或公司空间。" : "Loaded only when this Agent runs; never exposed in the directory or company Spaces."}</small></label>
          </div>
        </div>
        {error ? <p className="hire-agent-error">{error}</p> : null}
        <footer>
          <button type="button" className="ghost" disabled={saving} onClick={onClose}>{locale === "zh" ? "取消" : "Cancel"}</button>
          <button type="button" disabled={saving || !username || !displayName.trim()} onClick={() => onHire({
            id: username,
            description: bio.trim() || title.trim(),
            instructions: instructions.trim(),
            profile: {
              displayName: displayName.trim(),
              ...(title.trim() ? { title: title.trim() } : {}),
              ...(bio.trim() ? { bio: bio.trim() } : {}),
              ...(traitList.length ? { traits: traitList } : {}),
              ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
              ...(accent.trim() ? { accent: accent.trim() } : {}),
              ...(character.trim() ? { character: character.trim().toLowerCase() } : {}),
            },
          })}>{saving ? (locale === "zh" ? "办理入职…" : "Hiring…") : (locale === "zh" ? "确认雇佣" : "Hire Agent")}</button>
        </footer>
      </section>
    </div>
  );
}
