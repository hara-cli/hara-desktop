import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AgentPortrait } from "./AgentPortrait";
import type { AgentPublicIdentity } from "./client";
import { IconArrowRight, IconClose, IconPlus, IconSearch } from "./icons";
import {
  AGENT_BLUEPRINTS,
  AGENCY_AGENT_CATALOG_STATS,
  AGENCY_AGENTS_LICENSE,
  HARA_CURATED_BLUEPRINTS,
  TALENT_DEPARTMENTS,
  filterTalentBlueprints,
  talentBlueprintIdentity,
  talentBlueprintIsCurated,
  talentBlueprintIsDomestic,
  talentBlueprintLicenseNotice,
  talentBlueprintLocalizationSource,
  talentBlueprintSourceLabel,
  talentBlueprintSourceRevision,
  talentText,
  type AgentBlueprint,
  type TalentDepartmentId,
  type TalentLocale,
} from "./talent-blueprints";
import "./TalentMarket.css";

interface TalentMarketProps {
  locale: TalentLocale;
  hiredBlueprintIds: readonly string[];
  suspended?: boolean;
  onClose: () => void;
  onCustomHire: () => void;
  onHire: (blueprint: AgentBlueprint) => void;
}

const INITIAL_VISIBLE_TALENT = 48;

function blueprintIdentity(blueprint: AgentBlueprint, locale: TalentLocale): AgentPublicIdentity {
  return { version: 1, ...talentBlueprintIdentity(blueprint, locale), source: "hara" };
}

function riskCopy(risk: AgentBlueprint["risk"], locale: TalentLocale): string {
  const labels = {
    read: { en: "Read-oriented", zh: "以读取为主" },
    write: { en: "May request edits", zh: "可能申请编辑" },
    elevated: { en: "May request elevated actions", zh: "可能申请高权限操作" },
  } as const;
  return labels[risk][locale];
}

function budgetCopy(budget: AgentBlueprint["budget"], locale: TalentLocale): string {
  const labels = {
    lean: { en: "Lean", zh: "轻量" },
    standard: { en: "Standard", zh: "标准" },
    deep: { en: "Deep work", zh: "深度" },
  } as const;
  return labels[budget][locale];
}

export default function TalentMarket({
  locale,
  hiredBlueprintIds,
  suspended = false,
  onClose,
  onCustomHire,
  onHire,
}: TalentMarketProps) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<"all" | TalentDepartmentId>("all");
  const [selectedId, setSelectedId] = useState(() => AGENT_BLUEPRINTS.find((item) => item.featured)?.id ?? AGENT_BLUEPRINTS[0]?.id ?? "");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_TALENT);
  const deferredQuery = useDeferredValue(query);
  const hired = useMemo(() => new Set(hiredBlueprintIds), [hiredBlueprintIds]);
  const filtered = useMemo(
    () => filterTalentBlueprints(AGENT_BLUEPRINTS, deferredQuery, department),
    [deferredQuery, department],
  );
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  const visibleBlueprints = filtered.slice(0, visibleLimit);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !suspended) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, suspended]);

  return (
    <div
      className={`talent-market-overlay${suspended ? " is-suspended" : ""}`}
      aria-hidden={suspended || undefined}
      inert={suspended}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !suspended) onClose();
      }}
    >
      <section className="talent-market-shell" role="dialog" aria-modal={!suspended} aria-labelledby="talent-market-title">
        <header className="talent-market-header">
          <div className="talent-market-brand" aria-label="Hara Talent Bureau">
            <span className="talent-market-brand-mark" aria-hidden>H</span>
            <div>
              <small>HARA CAMPUS · TALENT BUREAU</small>
              <strong id="talent-market-title">{locale === "zh" ? "人才中心" : "Talent Bureau"}</strong>
            </div>
          </div>
          <div className="talent-market-header-actions">
            <span className="talent-market-live"><i />{locale === "zh" ? "本地策展目录" : "Local curated catalog"}</span>
            <button type="button" className="talent-market-custom" onClick={onCustomHire}>
              <IconPlus size={15} />{locale === "zh" ? "自定义招聘" : "Custom hire"}
            </button>
            <button type="button" className="talent-market-close" aria-label={locale === "zh" ? "关闭人才中心" : "Close Talent Bureau"} onClick={onClose}><IconClose size={18} /></button>
          </div>
        </header>

        <div className="talent-market-hero">
          <div>
            <small>{locale === "zh" ? "先选能力，再谈入职" : "CAPABILITY FIRST · HIRE SECOND"}</small>
            <h2>{locale === "zh" ? "今天，你想推进什么？" : "What should move forward today?"}</h2>
            <p>{locale === "zh"
              ? "搜索结果而不是职位名称。候选人未入职前不读取项目、不占用工位，也不会获得任何工具权限。"
              : "Search for an outcome, not a job title. Candidates cannot read projects, occupy a desk, or gain tools before hiring."}</p>
          </div>
          <div className="talent-market-stats" aria-label={locale === "zh" ? "人才市场统计" : "Talent market statistics"}>
            <span><b>{AGENT_BLUEPRINTS.length}</b><small>{locale === "zh" ? "完整人才库" : "full catalog"}</small></span>
            <span><b>{AGENCY_AGENT_CATALOG_STATS.domesticAdditions}</b><small>{locale === "zh" ? "国内新增岗位" : "China-specific roles"}</small></span>
            <span><b>{HARA_CURATED_BLUEPRINTS.length}</b><small>{locale === "zh" ? "Hara 精选" : "Hara curated"}</small></span>
            <span><b>0</b><small>{locale === "zh" ? "自动授权" : "automatic grants"}</small></span>
          </div>
        </div>

        <div className="talent-market-search-row">
          <label className="talent-market-search">
            <span aria-hidden><IconSearch size={17} /></span>
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleLimit(INITIAL_VISIBLE_TALENT);
              }}
              placeholder={locale === "zh" ? "例如：做小程序、代码审查、飞书集成、产品发布…" : "Try: ship a frontend, review code, integrate Feishu…"}
              spellCheck={false}
            />
            {query ? <button type="button" aria-label={locale === "zh" ? "清空搜索" : "Clear search"} onClick={() => {
              setQuery("");
              setVisibleLimit(INITIAL_VISIBLE_TALENT);
            }}><IconClose size={14} /></button> : null}
          </label>
          <div className="talent-market-journey" aria-label={locale === "zh" ? "招聘流程" : "Hiring journey"}>
            <span className="is-now"><i>1</i>{locale === "zh" ? "发现" : "Discover"}</span>
            <span><i>2</i>{locale === "zh" ? "审阅" : "Inspect"}</span>
            <span><i>3</i>{locale === "zh" ? "授权入职" : "Authorize"}</span>
            <span><i>4</i>{locale === "zh" ? "进入办公室" : "Enter office"}</span>
          </div>
        </div>

        <nav className="talent-market-departments" aria-label={locale === "zh" ? "职能部门" : "Departments"}>
          {TALENT_DEPARTMENTS.map((item) => {
            const count = item.id === "all"
              ? AGENT_BLUEPRINTS.length
              : AGENT_BLUEPRINTS.filter((blueprint) => blueprint.department === item.id).length;
            return (
              <button
                type="button"
                key={item.id}
                className={department === item.id ? "is-active" : ""}
                aria-pressed={department === item.id}
                onClick={() => {
                  setDepartment(item.id);
                  setVisibleLimit(INITIAL_VISIBLE_TALENT);
                }}
              >
                <i aria-hidden>{item.mark}</i><span>{talentText(item.label, locale)}</span><b>{count}</b>
              </button>
            );
          })}
        </nav>

        <div className="talent-market-body">
          <div className="talent-market-roster" aria-label={locale === "zh" ? "候选人列表" : "Candidate roster"}>
            <div className="talent-market-roster-heading">
              <span>{locale === "zh" ? `找到 ${filtered.length} 位候选人` : `${filtered.length} candidates`}</span>
              <small>{locale === "zh" ? "点击名片查看入职档案" : "Select a card for the hiring dossier"}</small>
            </div>
            {filtered.length ? (
              <div className="talent-market-card-grid">
                {visibleBlueprints.map((blueprint, index) => {
                  const isSelected = selected?.id === blueprint.id;
                  const isHired = hired.has(blueprint.id);
                  const isCurated = talentBlueprintIsCurated(blueprint);
                  const isDomestic = talentBlueprintIsDomestic(blueprint);
                  const identity = blueprintIdentity(blueprint, locale);
                  return (
                    <button
                      type="button"
                      key={blueprint.id}
                      className={`talent-card${isSelected ? " is-selected" : ""}${isHired ? " is-hired" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(blueprint.id)}
                      style={{ "--talent-accent": blueprint.accent } as CSSProperties}
                    >
                      <span className="talent-card-number">NO.{String(index + 1).padStart(2, "0")}</span>
                      <span className={`talent-card-tier is-${isCurated ? "curated" : isDomestic ? "domestic" : "community"}`}>
                        {isCurated ? "HARA" : isDomestic ? (locale === "zh" ? "本土" : "LOCAL") : (locale === "zh" ? "社区" : "COMMUNITY")}
                      </span>
                      <AgentPortrait agentRef={`talent:${blueprint.id}`} name={identity.displayName} identity={identity} size="medium" />
                      <span className="talent-card-copy">
                        <small>{talentText(TALENT_DEPARTMENTS.find((item) => item.id === blueprint.department)!.label, locale)}</small>
                        <strong>{talentText(blueprint.name, locale)}</strong>
                        <em>{talentText(blueprint.title, locale)}</em>
                        <span>{talentText(blueprint.bio, locale)}</span>
                      </span>
                      <span className="talent-card-footer">
                        <span>{blueprint.capabilities[locale].slice(0, 2).map((capability) => <i key={capability}>{capability}</i>)}</span>
                        <b>{isHired ? (locale === "zh" ? "已入职" : "HIRED") : <IconPlus size={15} />}</b>
                      </span>
                    </button>
                  );
                })}
                {visibleBlueprints.length < filtered.length ? (
                  <button type="button" className="talent-market-more" onClick={() => setVisibleLimit((current) => current + INITIAL_VISIBLE_TALENT)}>
                    <span>{locale === "zh" ? "继续浏览" : "Load more"}</span>
                    <b>{locale === "zh" ? `还有 ${filtered.length - visibleBlueprints.length} 位` : `${filtered.length - visibleBlueprints.length} remaining`}</b>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="talent-market-empty">
                <span aria-hidden><IconSearch size={24} /></span>
                <strong>{locale === "zh" ? "暂时没有匹配的人才" : "No matching talent yet"}</strong>
                <p>{locale === "zh" ? "换一个结果关键词，或直接创建专属岗位。" : "Try a different outcome, or create a custom role."}</p>
                <button type="button" onClick={onCustomHire}>{locale === "zh" ? "自定义招聘" : "Custom hire"}</button>
              </div>
            )}
          </div>

          <aside className="talent-dossier" aria-live="polite">
            {selected ? (() => {
              const identity = blueprintIdentity(selected, locale);
              const isHired = hired.has(selected.id);
              const isCurated = talentBlueprintIsCurated(selected);
              const isDomestic = talentBlueprintIsDomestic(selected);
              const localizationSource = talentBlueprintLocalizationSource(selected);
              return (
                <>
                  <div className="talent-dossier-top" style={{ "--talent-accent": selected.accent } as CSSProperties}>
                    <span className="talent-dossier-stamp">{isHired ? (locale === "zh" ? "已入职" : "HIRED") : (locale === "zh" ? "可雇佣" : "AVAILABLE")}</span>
                    <AgentPortrait agentRef={`talent:${selected.id}`} name={identity.displayName} identity={identity} size="large" />
                    <div>
                      <small>@{selected.username}</small>
                      <h3>{talentText(selected.name, locale)}</h3>
                      <p>{talentText(selected.title, locale)}</p>
                    </div>
                  </div>

                  <div className="talent-dossier-scroll">
                    <p className="talent-dossier-bio">{talentText(selected.bio, locale)}</p>
                    <p className={`talent-dossier-curation is-${isCurated ? "curated" : isDomestic ? "domestic" : "community"}`}>
                      <b>{isCurated
                        ? (locale === "zh" ? "Hara 精选" : "Hara curated")
                        : isDomestic
                          ? (locale === "zh" ? "国内原创岗位" : "China-specific role")
                          : (locale === "zh" ? "社区导入" : "Community import")}</b>
                      <span>{isCurated
                        ? (locale === "zh" ? "已适配 Hara 的执行责任、权限边界与验证规则。" : "Adapted for Hara ownership, permission boundaries, and verification.")
                        : isDomestic
                          ? (locale === "zh" ? "来自中文社区目录；已完成语义去重与基础安全适配，专项效果评测仍在进行。" : "From the Chinese community catalog; semantically deduplicated and baseline safety adapted, with specialist evaluation pending.")
                          : (locale === "zh" ? "已完成基础安全适配，尚未经过该岗位的专项效果评测。" : "Baseline safety adapted; specialist outcome evaluation is still pending.")}</span>
                    </p>
                    <div className="talent-dossier-traits">
                      {selected.traits[locale].map((trait) => <span key={trait}>#{trait}</span>)}
                    </div>

                    <section>
                      <header><b>{locale === "zh" ? "能力档案" : "Capability file"}</b><small>01</small></header>
                      <div className="talent-dossier-capabilities">
                        {selected.capabilities[locale].map((capability) => <span key={capability}>{capability}</span>)}
                      </div>
                    </section>

                    <section>
                      <header><b>{locale === "zh" ? "适合交付" : "Ready for"}</b><small>02</small></header>
                      <ul>{selected.tasks[locale].map((task) => <li key={task}><i aria-hidden>↳</i>{task}</li>)}</ul>
                    </section>

                    <section>
                      <header><b>{locale === "zh" ? "入职边界" : "Hiring boundary"}</b><small>03</small></header>
                      <div className="talent-dossier-boundaries">
                        <span><small>{locale === "zh" ? "工具风险" : "Tool risk"}</small><b>{riskCopy(selected.risk, locale)}</b></span>
                        <span><small>{locale === "zh" ? "建议工作量" : "Budget profile"}</small><b>{budgetCopy(selected.budget, locale)}</b></span>
                      </div>
                      <p className="talent-dossier-note">{locale === "zh"
                        ? `可能使用：${selected.suggestedTools.join(" · ")}。这些只是建议，雇佣不会自动授权。`
                        : `May use: ${selected.suggestedTools.join(" · ")}. These are suggestions; hiring grants nothing automatically.`}</p>
                    </section>

                    <section className="talent-dossier-source">
                      <header><b>{locale === "zh" ? "来源与版本" : "Source & version"}</b><small>04</small></header>
                      <dl>
                        <div><dt>{locale === "zh" ? "策展" : "Curation"}</dt><dd>{isCurated ? "Hara curated" : "Community"}</dd></div>
                        <div><dt>{locale === "zh" ? "蓝图" : "Blueprint"}</dt><dd>v{selected.version}</dd></div>
                        <div><dt>{locale === "zh" ? "上游" : "Upstream"}</dt><dd>{talentBlueprintSourceLabel(selected)} · {talentBlueprintSourceRevision(selected).slice(0, 7)}</dd></div>
                        <div><dt>{locale === "zh" ? "许可" : "License"}</dt><dd>{AGENCY_AGENTS_LICENSE}</dd></div>
                        {localizationSource ? <div><dt>{locale === "zh" ? "中文本地化" : "Chinese localization"}</dt><dd>Agency Agents 中文版</dd></div> : null}
                      </dl>
                      <code title={selected.sourcePath}>{selected.sourcePath}</code>
                      <details>
                        <summary>{locale === "zh" ? "查看上游许可声明" : "View upstream license notice"}</summary>
                        <pre>{talentBlueprintLicenseNotice(selected)}</pre>
                      </details>
                    </section>
                  </div>

                  <footer className="talent-dossier-footer">
                    <p><i aria-hidden>●</i>{locale === "zh" ? "入职后生成独立身份、私有提示词与工作历史" : "Hiring creates an independent identity, private prompt, and work history"}</p>
                    <button type="button" disabled={isHired} onClick={() => onHire(selected)}>
                      {isHired ? (locale === "zh" ? "已在你的团队" : "Already on your team") : (locale === "zh" ? "雇佣并配置" : "Hire & configure")}
                      {!isHired ? <span aria-hidden><IconArrowRight size={15} /></span> : null}
                    </button>
                  </footer>
                </>
              );
            })() : (
              <div className="talent-dossier-empty">{locale === "zh" ? "选择一位候选人" : "Select a candidate"}</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
