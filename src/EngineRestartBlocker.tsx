import type { EngineBlockingTask } from "./engine-restart-blocker";
import "./EngineRestartBlocker.css";

interface EngineRestartBlockerCopy {
  eyebrow: string;
  blockedOne: string;
  blockedMany: string;
  blockedHint: string;
  readyTitle: string;
  readyHint: string;
  viewTask: string;
  stopTask: string;
  stoppingTask: string;
  restart: string;
  dismiss: string;
}

interface EngineRestartBlockerProps {
  tasks: readonly EngineBlockingTask[];
  stoppingSessionId: string | null;
  copy: EngineRestartBlockerCopy;
  onViewTask: (sessionId: string) => void;
  onStopTask: (sessionId: string) => void;
  onRestart: () => void;
  onDismiss: () => void;
}

export function EngineRestartBlocker({
  tasks,
  stoppingSessionId,
  copy,
  onViewTask,
  onStopTask,
  onRestart,
  onDismiss,
}: EngineRestartBlockerProps) {
  const blocked = tasks.length > 0;
  const title = blocked
    ? (tasks.length === 1 ? copy.blockedOne : copy.blockedMany.replace("{count}", String(tasks.length)))
    : copy.readyTitle;

  return (
    <section
      className={`engine-task-blocker ${blocked ? "is-blocked" : "is-ready"}`}
      role="dialog"
      aria-live="assertive"
      aria-labelledby="engine-task-blocker-title"
    >
      <header className="engine-task-blocker-header">
        <span className="engine-task-blocker-signal" aria-hidden="true">
          <i />
        </span>
        <div>
          <span className="engine-task-blocker-eyebrow">{copy.eyebrow}</span>
          <strong id="engine-task-blocker-title">{title}</strong>
          <p>{blocked ? copy.blockedHint : copy.readyHint}</p>
        </div>
        <button
          type="button"
          className="engine-task-blocker-dismiss"
          aria-label={copy.dismiss}
          title={copy.dismiss}
          onClick={onDismiss}
        >
          ×
        </button>
      </header>

      {blocked ? (
        <div className="engine-task-blocker-list">
          {tasks.map((task) => {
            const stopping = stoppingSessionId === task.sessionId || task.state === "stopping";
            return (
              <article className="engine-task-blocker-row" key={task.sessionId}>
                <span className={`engine-task-state ${stopping ? "stopping" : task.state}`} aria-hidden="true" />
                <div className="engine-task-blocker-identity">
                  <strong title={task.title}>{task.title}</strong>
                  <small>
                    {task.context ? `${task.context} · ` : ""}{stopping ? copy.stoppingTask : task.statusLabel}
                  </small>
                </div>
                <div className="engine-task-blocker-actions">
                  <button type="button" className="secondary" onClick={() => onViewTask(task.sessionId)}>
                    {copy.viewTask}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={stopping}
                    onClick={() => onStopTask(task.sessionId)}
                  >
                    {stopping ? copy.stoppingTask : copy.stopTask}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="engine-task-blocker-ready-action">
          <button type="button" onClick={onRestart}>{copy.restart}</button>
        </div>
      )}
    </section>
  );
}
