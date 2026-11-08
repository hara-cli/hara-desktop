import { useEffect, useRef, useState } from "react";
import type { AgentInfo, AgentPublicIdentity, AgentRuntimeId, AgentRuntimeOption, ModelCatalogEntry } from "./client";
import AgentRuntimePicker from "./AgentRuntimePicker";
import { AgentPortrait } from "./AgentPortrait";
import { MAX_AGENT_AVATAR_BYTES } from "./agent-visual";
import { IconClose } from "./icons";
import "./AgentProfileEditor.css";
import type { WorkspaceDevAgent } from "./workspace-dev-state";
import { formatMessage, type Locale as ShellLocale } from "./i18n-runtime.ts";

export function WorkspaceAgentProfileSheet({ agent, locale, onClose, onSave }: {
  agent: WorkspaceDevAgent; locale: ShellLocale; onClose(): void;
  onSave(profile: { displayName: string; title: string; emoji: string; avatar: string }): Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(agent.identity.displayName);
  const [title, setTitle] = useState(agent.identity.title ?? "");
  const [emoji, setEmoji] = useState(agent.identity.emoji ?? "");
  const [avatar, setAvatar] = useState(agent.identity.avatar ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = (key: string, values?: Record<string, string | number>) => formatMessage(locale, key, values);
  const save = async () => {
    setBusy(true); setError("");
    try { await onSave({ displayName: displayName.trim(), title: title.trim(), emoji: emoji.trim(), avatar }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="agent-profile-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="agent-profile-editor" role="dialog" aria-modal="true" aria-label={t("ws.profileSheet.title")}>
      <header><h2>{t("ws.profileSheet.title")}</h2><button type="button" disabled={busy} onClick={onClose}>{t("ws.close")}</button></header>
      <div className="agent-profile-form">
        <label>{t("ws.profileSheet.displayName")}<input value={displayName} maxLength={64} onChange={event => setDisplayName(event.target.value)} /></label>
        <label>{t("ws.profileSheet.role")}<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
        <label>{t("ws.profileSheet.emoji")}<input value={emoji} maxLength={24} onChange={event => setEmoji(event.target.value)} /></label>
        <label>{t("ws.profileSheet.imageAvatar")}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > MAX_AGENT_AVATAR_BYTES) { setError(t("ws.profileSheet.avatarTooLarge")); return; }
          const reader = new FileReader(); reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => setError(t("ws.profileSheet.avatarReadFailed")); reader.readAsDataURL(file);
        }} /></label>
        {avatar ? <button type="button" disabled={busy} onClick={() => setAvatar("")}>{t("ws.profileSheet.avatarRemove")}</button> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" disabled={busy || !displayName.trim()} onClick={() => void save()}>{busy ? t("ws.profileSheet.saving") : t("ws.profileSheet.save")}</button>
      </div>
    </section>
  </div>;
}

type EditableIdentity = Omit<AgentPublicIdentity, "version" | "source">;

const DEFAULT_ROOT_IDENTITY: EditableIdentity = {
  displayName: "Hara",
  title: "Root Orchestrator",
  bio: "Owns the conversation, coordinates the team, and continues verified Codex and Claude Code sessions.",
  traits: ["direct", "resourceful", "evidence-led"],
  emoji: "✦",
  theme: "warm editorial studio",
  accent: "#ff695f",
  character: "orchestrator",
};

interface AgentProfileEditorProps {
  agent: AgentInfo;
  locale: "en" | "zh";
  modelEntries?: ModelCatalogEntry[];
  defaultModel?: string;
  defaultReasoningEffort?: string | null;
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (
    profile: EditableIdentity,
    execution?: { model?: string | null; reasoningEffort?: string | null },
  ) => void;
  onArchive?: () => void;
  runtimeOptions?: AgentRuntimeOption[];
  onSaveRuntime?: (id: AgentRuntimeId) => void;
}

export default function AgentProfileEditor({
  agent,
  locale,
  modelEntries = [],
  defaultModel,
  defaultReasoningEffort,
  saving,
  error,
  onClose,
  onSave,
  onArchive,
  runtimeOptions,
  onSaveRuntime,
}: AgentProfileEditorProps) {
  const t = (key: string, values?: Record<string, string | number>) => formatMessage(locale, key, values);
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
  const [agentModel, setAgentModel] = useState(agent.model ?? "");
  const [agentEffort, setAgentEffort] = useState(agent.reasoningEffort ?? "");
  const [localError, setLocalError] = useState("");
  const [localNotice, setLocalNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isRootOrchestrator = agent.systemRole === "root_orchestrator" || agent.ref === "main";
  const editable = agent.allowedActions?.includes("edit_profile") === true && Boolean(agent.revision);
  const executionEditable = editable && agent.owner === "personal" && agent.ref !== "main";
  const availableModelEntries = modelEntries.filter((entry) => entry.available !== false);
  const knownModels = [...new Set([
    ...availableModelEntries.map((entry) => entry.id),
    ...(agent.model ? [agent.model] : []),
  ])];
  const effectiveModel = agentModel || defaultModel || availableModelEntries[0]?.id || agent.model || "";
  const effortLevels = modelEntries.find((entry) => entry.id === effectiveModel)?.effortLevels ?? [];

  // Effort names come from ws.profile.effort.*, aligned with ws.rf.effort.* (decision 5).
  const effortLabel = (effort: string): string => {
    const key = `ws.profile.effort.${effort}`;
    const known = ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort);
    return known ? formatMessage(locale, key) : effort;
  };

  const changeAgentModel = (model: string) => {
    setAgentModel(model);
    const nextEffectiveModel = model || defaultModel || "";
    const nextLevels = modelEntries.find((entry) => entry.id === nextEffectiveModel)?.effortLevels ?? [];
    if (agentEffort && !nextLevels.includes(agentEffort)) setAgentEffort("");
  };

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
    setLocalNotice("");
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp|gif)$/.test(file.type)) {
      setLocalError(t("ws.profile.avatarTypeUnsupported"));
      return;
    }
    if (file.size > MAX_AGENT_AVATAR_BYTES) {
      setLocalError(t("ws.profile.avatarTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setLocalError(t("ws.profile.avatarReadFailed"));
    reader.readAsDataURL(file);
  };

  const loadDefaultRootIdentity = () => {
    setDisplayName(DEFAULT_ROOT_IDENTITY.displayName);
    setTitle(DEFAULT_ROOT_IDENTITY.title ?? "");
    setBio(DEFAULT_ROOT_IDENTITY.bio ?? "");
    setTraits((DEFAULT_ROOT_IDENTITY.traits ?? []).join(", "));
    setEmoji(DEFAULT_ROOT_IDENTITY.emoji ?? "");
    setAvatar("");
    setTheme(DEFAULT_ROOT_IDENTITY.theme ?? "");
    setAccent(DEFAULT_ROOT_IDENTITY.accent ?? "#ff695f");
    setCharacter(DEFAULT_ROOT_IDENTITY.character ?? "");
    setLocalError("");
    setLocalNotice(t("ws.profile.defaultLoadedNotice"));
  };

  return (
    <div className="agent-profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="agent-profile-editor" role="dialog" aria-modal="true" aria-labelledby="agent-profile-title">
        <header>
          <div className="agent-profile-preview">
            <AgentPortrait agentRef={agent.ref} name={agent.name} identity={preview} systemRole={agent.systemRole} size="large" />
            <span>
              <small>{isRootOrchestrator ? t("ws.profile.kindRoot") : agent.owner === "organization" ? t("ws.profile.kindCompany") : t("ws.profile.kindPersonal")}</small>
              <strong id="agent-profile-title">{t("ws.profile.title")}</strong>
              <em>@{agent.ref}</em>
            </span>
          </div>
          <button type="button" className="agent-profile-close" aria-label={t("ws.close")} disabled={saving} onClick={onClose}><IconClose size={18} /></button>
        </header>

        {isRootOrchestrator ? (
          <div className="agent-profile-root">
            <b aria-hidden>✦</b>
            <span>
              <strong>{t("ws.profile.rootNote")}</strong>
              <small>{editable ? t("ws.profile.rootEditableNote") : t("ws.profile.rootGovernedNote")}</small>
            </span>
          </div>
        ) : !editable ? (
          <div className="agent-profile-governed">
            <b aria-hidden>⌾</b>
            <span>
              <strong>{t("ws.profile.adminManaged")}</strong>
              <small>{t("ws.profile.adminManagedNote")}</small>
            </span>
          </div>
        ) : null}

        <div className="agent-profile-form" aria-disabled={!editable}>
          <div className="agent-profile-avatar-field">
            <AgentPortrait agentRef={agent.ref} name={agent.name} identity={preview} systemRole={agent.systemRole} size="large" />
            <span>
              <button type="button" disabled={!editable || saving} onClick={() => fileRef.current?.click()}>{t("ws.profile.changeAvatar")}</button>
              {avatar ? <button type="button" className="ghost" disabled={!editable || saving} onClick={() => setAvatar("")}>{t("ws.profile.remove")}</button> : null}
              <small>PNG / JPEG / WebP / GIF · 128 KB</small>
            </span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => chooseAvatar(event.target.files?.[0])} />
          </div>
          <div className="agent-profile-grid">
            <label>
              <span>{t("ws.profile.fieldName")}</span>
              <input maxLength={64} disabled={!editable || saving} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              <span>{t("ws.profile.fieldTitle")}</span>
              <input maxLength={80} disabled={!editable || saving} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="is-wide">
              <span>{t("ws.profile.fieldBio")}</span>
              <textarea maxLength={220} rows={3} disabled={!editable || saving} value={bio} onChange={(event) => setBio(event.target.value)} />
            </label>
            <label>
              <span>{t("ws.profile.fieldTraits")}</span>
              <input disabled={!editable || saving} value={traits} placeholder={t("ws.profile.fieldTraitsPlaceholder")} onChange={(event) => setTraits(event.target.value)} />
            </label>
            <label>
              <span>{t("ws.profile.fieldEmoji")}</span>
              <input maxLength={24} disabled={!editable || saving} value={emoji} onChange={(event) => setEmoji(event.target.value)} />
            </label>
            <label>
              <span>{t("ws.profile.fieldTheme")}</span>
              <input maxLength={72} disabled={!editable || saving} value={theme} onChange={(event) => setTheme(event.target.value)} />
            </label>
            <label>
              <span>{t("ws.profile.fieldCharacter")}</span>
              <input maxLength={32} disabled={!editable || saving} value={character} placeholder="architect" onChange={(event) => setCharacter(event.target.value)} />
            </label>
            <label>
              <span>{t("ws.profile.fieldAccent")}</span>
              <span className="agent-profile-color"><input type="color" disabled={!editable || saving} value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#ff695f"} onChange={(event) => setAccent(event.target.value)} /><input maxLength={7} disabled={!editable || saving} value={accent} onChange={(event) => setAccent(event.target.value)} /></span>
            </label>
          </div>
        </div>

        <AgentRuntimePicker agent={agent} options={runtimeOptions} locale={locale} saving={saving} onApply={onSaveRuntime} />
        <section className="agent-profile-execution" aria-label={t("ws.profile.modelSection")}>
          <header>
            <span>
              <strong>{t("ws.profile.modelSection")}</strong>
              <small>{t("ws.profile.modelSectionNote")}</small>
            </span>
          </header>
          {agent.ref === "main" ? (
            <p className="agent-profile-execution-note">{t("ws.profile.mainExecutionNote")}</p>
          ) : agent.owner === "organization" ? (
            <p className="agent-profile-execution-note">{t("ws.profile.companyExecutionNote")}</p>
          ) : null}
          <div className="agent-profile-execution-grid">
            <label>
              <span>{t("ws.rf.model")}</span>
              <select
                value={agentModel}
                disabled={!executionEditable || saving}
                onChange={(event) => changeAgentModel(event.target.value)}
              >
                <option value="">{defaultModel ? t("ws.profile.followSpaceDefaultWithModel", { model: defaultModel }) : t("ws.profile.followSpaceDefaultPlain")}</option>
                {knownModels.map((model) => <option value={model} key={model}>{model}</option>)}
              </select>
            </label>
            <label>
              <span>{t("ws.rf.effort")}</span>
              <select
                value={agentEffort}
                disabled={!executionEditable || saving || effortLevels.length === 0}
                onChange={(event) => setAgentEffort(event.target.value)}
              >
                <option value="">{effortLevels.length === 0
                  ? t("ws.profile.fixedPolicy")
                  : t("ws.profile.followSpaceDefaultReasoning", { effort: defaultReasoningEffort ? effortLabel(defaultReasoningEffort) : t("ws.profile.modelAutomatic") })}</option>
                {agentEffort && !effortLevels.includes(agentEffort)
                  ? <option value={agentEffort}>{agentEffort}</option>
                  : null}
                {effortLevels.map((effort) => <option value={effort} key={effort}>{effortLabel(effort)}</option>)}
              </select>
            </label>
          </div>
        </section>

        {localNotice && !localError && !error ? <p className="agent-profile-notice" role="status">{localNotice}</p> : null}
        {(localError || error) ? <p className="agent-profile-error">{localError || error}</p> : null}
        <footer>
          {!isRootOrchestrator && agent.allowedActions?.includes("archive") && onArchive ? (
            <button type="button" className="agent-profile-dismiss" disabled={saving} onClick={onArchive}>{t("ws.profile.dismiss")}</button>
          ) : null}
          {isRootOrchestrator && editable ? (
            <button type="button" className="agent-profile-reset" disabled={saving} onClick={loadDefaultRootIdentity}>{t("ws.profile.loadDefaultIdentity")}</button>
          ) : null}
          <span className="agent-profile-footer-spacer" />
          <button type="button" className="ghost" disabled={saving} onClick={onClose}>{editable ? t("ws.profile.cancel") : t("ws.profile.close")}</button>
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
            }, executionEditable ? {
              model: agentModel || null,
              reasoningEffort: agentEffort || null,
            } : undefined)}>{saving ? t("ws.profile.saving") : t("ws.profile.save")}</button> : null}
        </footer>
      </section>
    </div>
  );
}
