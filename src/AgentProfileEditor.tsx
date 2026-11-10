import { makeT } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import { AvatarImageError, prepareAgentAvatar } from "./agent-avatar-image";
import { WorkspaceAgentAvatar } from "./WorkspaceAgentAvatar";
import { ShellDialog } from "./WorkspaceShell";
import { redesignText } from "./desktop-redesign-copy";
import { useEffect, useRef, useState } from "react";
import type { AgentInfo, AgentPublicIdentity, AgentRuntimeId, AgentRuntimeOption, ModelCatalogEntry } from "./client";
import AgentRuntimePicker from "./AgentRuntimePicker";
import { AgentPortrait } from "./AgentPortrait";
import { MAX_AGENT_AVATAR_BYTES } from "./agent-visual";
import { IconClose } from "./icons";
import "./AgentProfileEditor.css";
import type { WorkspaceDevAgent, WorkspaceAgentProfilePatch } from "./workspace-dev-state";
import { formatMessage, type Locale as ShellLocale } from "./i18n-runtime.ts";

export function WorkspaceAgentProfileSheet({ agent, locale, onClose, onSave }: {
  agent: WorkspaceDevAgent; locale: ShellLocale; onClose(): void;
  onSave(profile: WorkspaceAgentProfilePatch): Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(agent.identity.displayName);
  const [title, setTitle] = useState(agent.identity.title ?? "");
  const [emoji, setEmoji] = useState(agent.identity.emoji ?? "");
  const [avatar, setAvatar] = useState(agent.identity.avatar ?? "");
  const [busy, setBusy] = useState(false), [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const imageVersion = useRef(0), imageRequest = useRef<AbortController | null>(null), form = useRef<HTMLDivElement>(null);
  const authority = useRef({ id: agent.agentId, revision: agent.configRevision, epoch: agent.agentEpoch });
  const original = useRef({ displayName: agent.identity.displayName, title: agent.identity.title ?? "", emoji: agent.identity.emoji ?? "", avatar: agent.identity.avatar ?? "" });
  const changed = displayName.trim() !== original.current.displayName || title.trim() !== original.current.title || emoji.trim() !== original.current.emoji || avatar !== original.current.avatar;
  const stale = authority.current.id !== agent.agentId || authority.current.revision !== agent.configRevision || authority.current.epoch !== agent.agentEpoch;
  useEffect(() => () => { imageVersion.current++; imageRequest.current?.abort(); }, []);
  const t = makeT(locale);
  const r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const close = () => { if (!busy) onClose(); };
  const save = async () => {
    if (busy || imageBusy || stale || !changed || !displayName.trim()) return;
    form.current?.closest<HTMLElement>("[role=dialog]")?.focus();
    setBusy(true); setError("");
    try {
      const patch: WorkspaceAgentProfilePatch = {};
      if (displayName.trim() !== original.current.displayName) patch.displayName = displayName.trim();
      if (title.trim() !== original.current.title) patch.title = title.trim();
      if (emoji.trim() !== original.current.emoji) patch.emoji = emoji.trim();
      if (avatar !== original.current.avatar) patch.avatar = avatar;
      await onSave(patch); onClose();
    }
    catch (cause) { setError(workspaceMessageText(t, cause instanceof Error ? cause.message : String(cause))); }
    finally { setBusy(false); }
  };
  const pickImage = async (file: File) => {
    const version = ++imageVersion.current; imageRequest.current?.abort(); const request = new AbortController(); imageRequest.current = request; setImageBusy(true); setError("");
    try { const prepared = await prepareAgentAvatar(file, request.signal); if (imageVersion.current === version) setAvatar(prepared); }
    catch (cause) { if (imageVersion.current === version) setError(cause instanceof AvatarImageError && cause.code === "tooLarge" ? t("ws.profileSheet.avatarTooLarge")
      : cause instanceof AvatarImageError && cause.code === "format" ? r("avatarImageFormat") : cause instanceof AvatarImageError && cause.code === "dimensions" ? r("avatarImageDimensions") : t("ws.profileSheet.avatarReadFailed")); }
    finally { if (imageVersion.current === version) setImageBusy(false); }
  };
  const previewAgent = { ...agent, identity: { ...agent.identity, displayName: displayName.trim() || agent.identity.displayName, avatar } };
  return <ShellDialog label={t("ws.profileSheet.title")} className="agent-profile-editor workspace-profile-sheet" onClose={close} dismissOnBackdrop workspaceOverlay>
    <header><h2>{t("ws.profileSheet.title")}</h2><button type="button" className="hs-icon" aria-label={t("ws.close")} disabled={busy} onClick={close}><IconClose /></button></header>
    <div className="agent-profile-form" ref={form}>
      <div className="workspace-profile-avatar-preview"><WorkspaceAgentAvatar agent={previewAgent} large /><p>{r("avatarSquareHint")}</p></div>
      <label>{t("ws.profileSheet.displayName")}<input value={displayName} readOnly={busy} maxLength={64} onChange={event => setDisplayName(event.target.value)} /></label>
      <label>{t("ws.profileSheet.role")}<input value={title} readOnly={busy} maxLength={80} onChange={event => setTitle(event.target.value)} /></label>
      <label>{t("ws.profileSheet.emoji")}<input value={emoji} readOnly={busy} maxLength={24} onChange={event => setEmoji(event.target.value)} /></label>
      <label>{t("ws.profileSheet.imageAvatar")}<input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void pickImage(file);
      }} /></label>
      {avatar ? <button type="button" className="hs-btn sec" disabled={busy} onClick={() => { imageVersion.current++; imageRequest.current?.abort(); setImageBusy(false); setAvatar(""); setError(""); }}>{t("ws.profileSheet.avatarRemove")}</button> : null}
      {imageBusy ? <p role="status">{r("avatarImagePreparing")}</p> : null}
      {stale ? <p role="status">{r("profileChanged")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className="hs-btn pri" disabled={busy || imageBusy || stale || !changed || !displayName.trim()} onClick={() => void save()}>{busy ? t("ws.profileSheet.saving") : t("ws.profileSheet.save")}</button>
    </div>
  </ShellDialog>;
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
