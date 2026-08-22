import { lazy, Suspense, useMemo, useState, type CSSProperties } from "react";
import type {
  WorkforceCapability,
  AgentOfficeInfo,
} from "./client";
import type { OfficeActor, OfficeActorState } from "./agent-office";
import { useReducedMotion } from "./PetAtlasSprite";
import { AgentCharacter, AgentPortrait } from "./AgentPortrait";
import {
  AGENT_OFFICE_CAPABILITY,
  type WorkforceRendererId,
} from "./preinstalled-capabilities";
import "./WorkforceSurface.css";

const WorkforceThreeScene = lazy(() => import("./WorkforceThreeScene"));

export interface WorkforceCopy {
  title: string;
  subtitle: string;
  live: string;
  compatibility: string;
  three: string;
  threeHint: string;
  threeUnavailable: string;
  scene: string;
  list: string;
  overview: string;
  focus: string;
  noTask: string;
  noTaskHint: string;
  returnToChat: string;
  chatWithAgent: string;
  office: string;
  switchOffice: string;
  root: string;
  specialist: string;
  status: string;
  capability: string;
  updated: string;
  privacy: string;
  loading: string;
  states: Record<OfficeActorState, string>;
  capabilities: Record<WorkforceCapability, string>;
}

interface WorkforceSurfaceProps {
  actors: OfficeActor[];
  offices: AgentOfficeInfo[];
  activeOfficeId: string;
  locale: "en" | "zh";
  live: boolean;
  copy: WorkforceCopy;
  onReturnToChat: () => void;
  onOfficeChange: (officeId: string) => void;
  onChatWithAgent: (agentRef: string) => void;
}

const SEATS = [
  { x: 49, y: 58, zone: "lead" },
  { x: 22, y: 38, zone: "build" },
  { x: 39, y: 33, zone: "build" },
  { x: 67, y: 34, zone: "create" },
  { x: 82, y: 43, zone: "create" },
  { x: 18, y: 66, zone: "evidence" },
  { x: 35, y: 73, zone: "evidence" },
  { x: 68, y: 70, zone: "delivery" },
  { x: 84, y: 65, zone: "delivery" },
  { x: 11, y: 49, zone: "build" },
  { x: 91, y: 55, zone: "delivery" },
  { x: 52, y: 26, zone: "create" },
  { x: 28, y: 54, zone: "build" },
  { x: 74, y: 56, zone: "create" },
  { x: 25, y: 82, zone: "evidence" },
  { x: 44, y: 84, zone: "evidence" },
  { x: 61, y: 84, zone: "delivery" },
  { x: 79, y: 81, zone: "delivery" },
  { x: 9, y: 30, zone: "build" },
  { x: 29, y: 24, zone: "build" },
  { x: 72, y: 24, zone: "create" },
  { x: 92, y: 31, zone: "create" },
  { x: 8, y: 83, zone: "evidence" },
  { x: 93, y: 83, zone: "delivery" },
] as const;

type SeatZone = (typeof SEATS)[number]["zone"];

const CAPABILITY_VISUALS: Record<WorkforceCapability, { accent: string; zone: SeatZone }> = {
  orchestration: { accent: "#ff655c", zone: "lead" },
  files: { accent: "#d9c29b", zone: "evidence" },
  code: { accent: "#f3a83b", zone: "build" },
  browser: { accent: "#4d91e8", zone: "build" },
  research: { accent: "#63b9ee", zone: "evidence" },
  design: { accent: "#aa7be8", zone: "create" },
  office: { accent: "#7885e5", zone: "create" },
  communication: { accent: "#52b8b1", zone: "delivery" },
  other: { accent: "#a3aaa8", zone: "delivery" },
};

function actorLabel(actor: OfficeActor, copy: WorkforceCopy): string {
  if (actor.identity?.displayName) return actor.identity.displayName;
  if (actor.kind === "root") return actor.role || copy.root;
  const role = actor.role && actor.role !== "explore" ? actor.role : undefined;
  return role ?? copy.capabilities[actor.capability] ?? copy.specialist;
}

function activityGlyph(actor: OfficeActor): string {
  if (actor.state === "idle") return "○";
  if (actor.state === "waiting") return "!";
  if (actor.state === "blocked" || actor.state === "failed") return "×";
  if (actor.state === "completed") return "✓";
  if (actor.state === "paused") return "Ⅱ";
  if (actor.state === "queued") return "…";
  if (actor.activity === "planning") return "◇";
  if (actor.activity === "reviewing") return "⌕";
  if (actor.activity === "delivering") return "↗";
  return "·";
}

function timeLabel(value: string, locale: "en" | "zh"): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

export default function WorkforceSurface({
  actors,
  offices,
  activeOfficeId,
  locale,
  live,
  copy,
  onReturnToChat,
  onOfficeChange,
  onChatWithAgent,
}: WorkforceSurfaceProps) {
  const [view, setView] = useState<WorkforceRendererId>(AGENT_OFFICE_CAPABILITY.defaultRenderer);
  const [camera, setCamera] = useState<"overview" | "focus">("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threeUnavailable, setThreeUnavailable] = useState(false);
  const reduced = useReducedMotion();
  const selected = actors.find((actor) => actor.actorId === selectedId) ?? actors[0];
  const activeOffice = offices.find((office) => office.id === activeOfficeId) ?? offices[0];
  const activeOfficeIndex = Math.max(0, offices.findIndex((office) => office.id === activeOffice?.id));
  const changeOffice = (officeId: string) => {
    setSelectedId(null);
    setCamera("overview");
    onOfficeChange(officeId);
  };
  const moveOffice = (direction: -1 | 1) => {
    if (offices.length < 2) return;
    const nextIndex = (activeOfficeIndex + direction + offices.length) % offices.length;
    changeOffice(offices[nextIndex].id);
  };
  const selectActor = (actorId: string) => {
    setSelectedId(actorId);
    setCamera("focus");
    const actor = actors.find((candidate) => candidate.actorId === actorId);
    if (actor?.agentRef) onChatWithAgent(actor.agentRef);
  };
  const counts = useMemo(() => ({
    working: actors.filter((actor) => actor.state === "working" || actor.state === "queued").length,
    waiting: actors.filter((actor) => actor.state === "waiting" || actor.state === "paused").length,
    blocked: actors.filter((actor) => actor.state === "blocked" || actor.state === "failed").length,
    available: actors.filter((actor) => actor.state === "idle").length,
  }), [actors]);
  const positionedActors = useMemo(() => {
    const available = [...SEATS];
    return actors.slice(0, SEATS.length).map((actor) => {
      const desiredZone = actor.kind === "root" ? "lead" : CAPABILITY_VISUALS[actor.capability].zone;
      let seatIndex = available.findIndex((seat) => seat.zone === desiredZone);
      if (seatIndex < 0) seatIndex = 0;
      const [seat] = available.splice(seatIndex, 1);
      return { actor, seat };
    });
  }, [actors]);
  const selectedPosition = positionedActors.find(({ actor }) => actor.actorId === selected?.actorId)?.seat;

  return (
    <section className="workforce-surface" aria-label={copy.title}>
      <header className="workforce-overview">
        <div>
          <span className="workforce-eyebrow">HARA / AGENT OFFICE</span>
          <h2>
            {activeOffice?.name ?? copy.title}
            <small>{actors.length} {copy.list.toUpperCase()}</small>
          </h2>
          <p>{copy.subtitle}</p>
        </div>
        <div className="workforce-overview-actions">
          <span className={`workforce-live${live ? " is-live" : ""}`}>
            <i aria-hidden />{live ? copy.live : copy.compatibility}
          </span>
          <div className="workforce-office-switch">
            <button type="button" disabled={offices.length < 2} aria-label={copy.switchOffice} onClick={() => moveOffice(-1)}>‹</button>
            <label>
              <span>{copy.office} · {activeOfficeIndex + 1}/{Math.max(offices.length, 1)}</span>
              <select
                value={activeOffice?.id ?? ""}
                aria-label={copy.switchOffice}
                onChange={(event) => changeOffice(event.target.value)}
              >
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>{office.name}</option>
                ))}
              </select>
            </label>
            <button type="button" disabled={offices.length < 2} aria-label={copy.switchOffice} onClick={() => moveOffice(1)}>›</button>
          </div>
          <div className="workforce-view-switch" role="group" aria-label={copy.title}>
            <button type="button" className={view === "spatial" ? "is-active" : ""} onClick={() => setView("spatial")}>{copy.scene}</button>
            <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>{copy.list}</button>
            <button
              type="button"
              className={view === "webgl" ? "is-active" : ""}
              disabled={threeUnavailable}
              title={threeUnavailable ? copy.threeUnavailable : undefined}
              onClick={() => setView("webgl")}
            >{copy.three}<sup>LAB</sup></button>
          </div>
        </div>
      </header>

      <div className="workforce-metrics" aria-label={copy.status}>
        <span className="is-team"><b>{actors.length}</b>{copy.list}</span>
        <span className="is-working"><b>{counts.working}</b>{copy.states.working}</span>
        <span className="is-waiting"><b>{counts.waiting}</b>{copy.states.waiting}</span>
        <span className="is-blocked"><b>{counts.blocked}</b>{copy.states.blocked}</span>
        <span className="is-complete"><b>{counts.available}</b>{copy.states.idle}</span>
      </div>

      {actors.length > 0 ? (
        <div className="workforce-team-deck" role="list" aria-label={copy.list}>
          <div className="workforce-team-deck-label">
            <span>{copy.list}</span>
            <b>{actors.length}</b>
          </div>
          <div className="workforce-team-deck-track">
            {actors.map((actor) => {
              const label = actorLabel(actor, copy);
              const visual = CAPABILITY_VISUALS[actor.capability];
              return (
                <button
                  type="button"
                  role="listitem"
                  key={actor.actorId}
                  className={`is-${actor.state}${selected?.actorId === actor.actorId ? " is-selected" : ""}`}
                  style={{ "--actor-accent": actor.identity?.accent ?? visual.accent } as CSSProperties}
                  title={actor.agentRef ? `${copy.chatWithAgent}: ${label}` : label}
                  aria-label={`${label}: ${copy.states[actor.state]}`}
                  onClick={() => selectActor(actor.actorId)}
                >
                  <AgentPortrait
                    agentRef={actor.agentRef ?? actor.actorId}
                    name={label}
                    identity={actor.identity}
                    state={actor.state}
                    size="small"
                  />
                  <i aria-hidden />
                  <strong>{label}</strong>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {threeUnavailable ? <p className="workforce-three-unavailable" role="status">{copy.threeUnavailable}</p> : null}

      {view === "webgl" ? (
        <div className="workforce-stage is-webgl" role="region" aria-label={copy.three}>
          <div className="workforce-stage-mode" aria-hidden><span>EXPERIMENTAL 3D</span><b>GOD VIEW / LAB</b></div>
          <div className="workforce-camera-controls" role="group" aria-label={copy.three}>
            <button type="button" className={camera === "overview" ? "is-active" : ""} onClick={() => setCamera("overview")}>{copy.overview}</button>
            <button type="button" disabled={!selected} className={camera === "focus" && selected ? "is-active" : ""} onClick={() => setCamera("focus")}>{copy.focus}</button>
          </div>
          <Suspense fallback={<div className="workforce-three-loading" role="status">{copy.loading}</div>}>
            <WorkforceThreeScene
              actors={actors}
              selectedId={selected?.actorId ?? null}
              cameraMode={camera}
              reduced={reduced}
              label={copy.title}
              hint={copy.threeHint}
              unavailable={copy.threeUnavailable}
              onSelectActor={selectActor}
              onUnavailable={() => {
                setThreeUnavailable(true);
                setView("spatial");
              }}
            />
          </Suspense>
          {actors.length === 0 ? (
            <div className="workforce-three-empty">
              <span aria-hidden>H</span>
              <div>
                <h3>{copy.noTask}</h3>
                <p>{copy.noTaskHint}</p>
              </div>
              <button type="button" onClick={onReturnToChat}>{copy.returnToChat}</button>
            </div>
          ) : null}
        </div>
      ) : actors.length === 0 ? (
        <div className="workforce-empty">
          <span aria-hidden>H</span>
          <h3>{copy.noTask}</h3>
          <p>{copy.noTaskHint}</p>
          <button type="button" onClick={onReturnToChat}>{copy.returnToChat}</button>
        </div>
      ) : view === "spatial" ? (
        <div className={`workforce-stage${actors.length > 18 ? " is-dense" : ""}`} role="region" aria-label={copy.scene}>
          <div className="workforce-stage-mode" aria-hidden><span>COMIC OFFICE</span><b>LIVE SOCIAL FLOOR</b></div>
          <div className="workforce-camera-controls" role="group" aria-label={copy.scene}>
            <button type="button" className={camera === "overview" ? "is-active" : ""} onClick={() => setCamera("overview")}>{copy.overview}</button>
            <button type="button" className={camera === "focus" ? "is-active" : ""} onClick={() => setCamera("focus")}>{copy.focus}</button>
          </div>
          <div
            className={`workforce-stage-camera is-${camera}`}
            style={{
              "--camera-x": `${selectedPosition?.x ?? 50}%`,
              "--camera-y": `${selectedPosition?.y ?? 50}%`,
            } as CSSProperties}
          >
            <div className="workforce-room" aria-hidden>
              <div className="workforce-wall is-left"><i /><i /><i /></div>
              <div className="workforce-wall is-right"><span>HARA</span><i /><i /></div>
              <div className="workforce-floor" />
              <div className="workforce-table is-standup"><span /></div>
              <div className="workforce-lounge"><i /><i /><span /></div>
              <div className="workforce-plant is-one"><i /></div>
              <div className="workforce-plant is-two"><i /></div>
            </div>
            <div className="workforce-zone-label is-build">BUILD</div>
            <div className="workforce-zone-label is-create">CREATE</div>
            <div className="workforce-zone-label is-evidence">EVIDENCE</div>
            <div className="workforce-zone-label is-delivery">DELIVERY</div>
            {positionedActors.map(({ actor, seat }, index) => {
              const visual = CAPABILITY_VISUALS[actor.capability];
              const label = actorLabel(actor, copy);
              const style = {
                "--actor-x": `${seat.x}%`,
                "--actor-y": `${seat.y}%`,
                "--actor-accent": actor.identity?.accent ?? visual.accent,
                "--actor-delay": `${(index % 5) * -0.34}s`,
                "--actor-depth": String(Math.round(seat.y)),
              } as CSSProperties;
              return (
                <button
                  type="button"
                  key={actor.actorId}
                  className={`workforce-actor is-${actor.state} is-capability-${actor.capability}${selected?.actorId === actor.actorId ? " is-selected" : ""}`}
                  style={style}
                  aria-label={`${label}: ${copy.states[actor.state]}`}
                  title={actor.agentRef ? `${copy.chatWithAgent}: ${label}` : undefined}
                  onClick={() => selectActor(actor.actorId)}
                >
                  <span className="workforce-desk"><i /><b /></span>
                  <span className="workforce-character">
                    <AgentCharacter
                      agentRef={actor.agentRef ?? actor.actorId}
                      name={label}
                      identity={actor.identity}
                      state={actor.state}
                      reduced={reduced}
                    />
                    <i className="workforce-character-shadow" />
                  </span>
                  <span className="workforce-role-tool" aria-hidden><i /><b /></span>
                  <span className="workforce-actor-bubble" aria-hidden>{activityGlyph(actor)}</span>
                  <span className="workforce-actor-label"><strong>{label}</strong><small>{copy.states[actor.state]}</small></span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="workforce-list" role="list">
          {actors.map((actor) => {
            const visual = CAPABILITY_VISUALS[actor.capability];
            const label = actorLabel(actor, copy);
            return (
              <button
                type="button"
                role="listitem"
                key={actor.actorId}
                className={`is-capability-${actor.capability}${selected?.actorId === actor.actorId ? " is-selected" : ""}`}
                style={{ "--actor-accent": actor.identity?.accent ?? visual.accent } as CSSProperties}
                title={actor.agentRef ? `${copy.chatWithAgent}: ${label}` : undefined}
                onClick={() => selectActor(actor.actorId)}
              >
                <AgentPortrait
                  agentRef={actor.agentRef ?? actor.actorId}
                  name={label}
                  identity={actor.identity}
                  state={actor.state}
                  size="medium"
                />
                <span className="workforce-list-identity"><strong>{label}{actor.identity?.emoji ? <em>{actor.identity.emoji}</em> : null}</strong><small>{actor.identity?.title || copy.capabilities[actor.capability]}</small></span>
                <i className={`is-${actor.state}`} aria-hidden />
                <b>{copy.states[actor.state]}</b>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <footer className="workforce-inspector">
          <AgentPortrait
            agentRef={selected.agentRef ?? selected.actorId}
            name={actorLabel(selected, copy)}
            identity={selected.identity}
            state={selected.state}
            size="large"
          />
          <div className="workforce-inspector-identity">
            <strong>{actorLabel(selected, copy)}</strong>
            <span>{selected.identity?.title || (selected.kind === "resident" ? selected.description || copy.specialist : selected.kind === "root" ? copy.root : copy.specialist)}</span>
            {selected.identity?.bio ? <p>{selected.identity.bio}</p> : null}
            {selected.identity?.traits?.length ? (
              <div className="workforce-inspector-traits">
                {selected.identity.traits.map((trait) => <i key={trait}>{trait}</i>)}
              </div>
            ) : null}
          </div>
          <dl>
            <div><dt>{copy.status}</dt><dd>{copy.states[selected.state]}</dd></div>
            <div><dt>{copy.capability}</dt><dd>{copy.capabilities[selected.capability]}</dd></div>
            <div><dt>{copy.updated}</dt><dd>{timeLabel(selected.updatedAt, locale)}</dd></div>
          </dl>
          <button type="button" onClick={() => selected.agentRef ? onChatWithAgent(selected.agentRef) : onReturnToChat()}>
            {selected.agentRef ? copy.chatWithAgent : copy.returnToChat}
          </button>
        </footer>
      )}
      <p className="workforce-privacy"><span aria-hidden>◇</span>{copy.privacy}</p>
    </section>
  );
}
