import { useMemo, useState, type CSSProperties } from "react";
import type {
  WorkforceActor,
  WorkforceActorState,
  WorkforceCapability,
  WorkforceStateEvent,
} from "./client";
import { BUILTIN_HARA_PET } from "./pets";
import "./WorkforceSurface.css";

export interface WorkforceCopy {
  title: string;
  subtitle: string;
  live: string;
  compatibility: string;
  scene: string;
  list: string;
  noTask: string;
  noTaskHint: string;
  returnToChat: string;
  root: string;
  specialist: string;
  status: string;
  capability: string;
  updated: string;
  privacy: string;
  states: Record<WorkforceActorState, string>;
  capabilities: Record<WorkforceCapability, string>;
}

interface WorkforceSurfaceProps {
  snapshot?: WorkforceStateEvent;
  locale: "en" | "zh";
  live: boolean;
  copy: WorkforceCopy;
  onReturnToChat: () => void;
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

function actorLabel(actor: WorkforceActor, copy: WorkforceCopy): string {
  if (actor.kind === "root") return copy.root;
  const role = actor.role && actor.role !== "explore" ? actor.role : undefined;
  return role ?? copy.capabilities[actor.capability] ?? copy.specialist;
}

function activityGlyph(actor: WorkforceActor): string {
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

export default function WorkforceSurface({ snapshot, locale, live, copy, onReturnToChat }: WorkforceSurfaceProps) {
  const actors = snapshot?.actors ?? [];
  const [view, setView] = useState<"scene" | "list">("scene");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = actors.find((actor) => actor.actorId === selectedId) ?? actors[0];
  const counts = useMemo(() => ({
    working: actors.filter((actor) => actor.state === "working" || actor.state === "queued").length,
    waiting: actors.filter((actor) => actor.state === "waiting" || actor.state === "paused").length,
    blocked: actors.filter((actor) => actor.state === "blocked" || actor.state === "failed").length,
    completed: actors.filter((actor) => actor.state === "completed").length,
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

  return (
    <section className="workforce-surface" aria-label={copy.title}>
      <header className="workforce-overview">
        <div>
          <span className="workforce-eyebrow">HARA / AGENT OFFICE</span>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <div className="workforce-overview-actions">
          <span className={`workforce-live${live ? " is-live" : ""}`}>
            <i aria-hidden />{live ? copy.live : copy.compatibility}
          </span>
          <div className="workforce-view-switch" role="group" aria-label={copy.title}>
            <button type="button" className={view === "scene" ? "is-active" : ""} onClick={() => setView("scene")}>{copy.scene}</button>
            <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>{copy.list}</button>
          </div>
        </div>
      </header>

      <div className="workforce-metrics" aria-label={copy.status}>
        <span className="is-working"><b>{counts.working}</b>{copy.states.working}</span>
        <span className="is-waiting"><b>{counts.waiting}</b>{copy.states.waiting}</span>
        <span className="is-blocked"><b>{counts.blocked}</b>{copy.states.blocked}</span>
        <span className="is-complete"><b>{counts.completed}</b>{copy.states.completed}</span>
      </div>

      {actors.length === 0 ? (
        <div className="workforce-empty">
          <span aria-hidden>H</span>
          <h3>{copy.noTask}</h3>
          <p>{copy.noTaskHint}</p>
          <button type="button" onClick={onReturnToChat}>{copy.returnToChat}</button>
        </div>
      ) : view === "scene" ? (
        <div className="workforce-stage" role="region" aria-label={copy.scene}>
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
              "--actor-accent": visual.accent,
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
                onClick={() => setSelectedId(actor.actorId)}
              >
                <span className="workforce-desk"><i /><b /></span>
                <span className="workforce-character">
                  <img src={BUILTIN_HARA_PET.imageUrl} alt="" draggable={false} />
                  <i className="workforce-character-shadow" />
                </span>
                <span className="workforce-role-tool" aria-hidden><i /><b /></span>
                <span className="workforce-actor-bubble" aria-hidden>{activityGlyph(actor)}</span>
                <span className="workforce-actor-label"><strong>{label}</strong><small>{copy.states[actor.state]}</small></span>
              </button>
            );
          })}
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
                style={{ "--actor-accent": visual.accent } as CSSProperties}
                onClick={() => setSelectedId(actor.actorId)}
              >
                <img src={BUILTIN_HARA_PET.imageUrl} alt="" draggable={false} />
                <span><strong>{label}</strong><small>{copy.capabilities[actor.capability]}</small></span>
                <i className={`is-${actor.state}`} aria-hidden />
                <b>{copy.states[actor.state]}</b>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <footer className="workforce-inspector">
          <div className={`workforce-state-mark is-${selected.state}`} aria-hidden>{activityGlyph(selected)}</div>
          <div>
            <strong>{actorLabel(selected, copy)}</strong>
            <span>{selected.kind === "root" ? copy.root : copy.specialist}</span>
          </div>
          <dl>
            <div><dt>{copy.status}</dt><dd>{copy.states[selected.state]}</dd></div>
            <div><dt>{copy.capability}</dt><dd>{copy.capabilities[selected.capability]}</dd></div>
            <div><dt>{copy.updated}</dt><dd>{timeLabel(selected.updatedAt, locale)}</dd></div>
          </dl>
          <button type="button" onClick={onReturnToChat}>{copy.returnToChat}</button>
        </footer>
      )}
      <p className="workforce-privacy"><span aria-hidden>◇</span>{copy.privacy}</p>
    </section>
  );
}
