import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { HaraClient, TaskLifecycleEvent } from "./client";
import type { ConversationItem } from "./ConversationTimeline";
import type {
  ReviewExtension,
  WorkbenchToolExtension,
} from "./extension-dock-state";
import "./WorkbenchToolSurface.css";

interface WorkbenchToolCopy {
  terminal: string;
  terminalHint: string;
  terminalEmpty: string;
  terminalCommand: string;
  terminalSend: string;
  browser: string;
  browserHint: string;
  browserAddress: string;
  browserOpen: string;
  browserInvalid: string;
  files: string;
  filesHint: string;
  filesSearch: string;
  filesEmpty: string;
  filesUse: string;
  review: string;
  reviewHint: string;
  reviewEmpty: string;
  running: string;
  ready: string;
}

interface WorkbenchToolSurfaceProps {
  item: WorkbenchToolExtension | ReviewExtension;
  client: HaraClient | null;
  items: ConversationItem[];
  taskState?: TaskLifecycleEvent;
  copy: WorkbenchToolCopy;
  onOpenBrowser: (item: WorkbenchToolExtension, address: string) => string | null;
  onCompose: (text: string) => void;
  onRunCommand: (command: string) => void;
}

function SurfaceIntro({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="workbench-tool-intro">
      <span aria-hidden>H</span>
      <div>
        <strong>{title}</strong>
        <p>{hint}</p>
      </div>
    </header>
  );
}

function TerminalSurface({
  items,
  taskState,
  copy,
  onRunCommand,
}: Pick<WorkbenchToolSurfaceProps, "items" | "taskState" | "copy" | "onRunCommand">) {
  const [command, setCommand] = useState("");
  const evidence = useMemo(() => items.flatMap((item, index) => {
    if (item.kind === "tool") {
      return [{ id: `tool-${index}`, label: `$ ${item.name}`, body: item.preview }];
    }
    if (item.kind === "notice") {
      return [{ id: `notice-${index}`, label: "hara", body: item.text }];
    }
    return [];
  }).slice(-80), [items]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    onRunCommand(value);
    setCommand("");
  };

  return (
    <section className="workbench-tool-surface is-terminal">
      <SurfaceIntro title={copy.terminal} hint={copy.terminalHint} />
      <div className="workbench-tool-status">
        <i className={taskState?.state === "running" || taskState?.state === "waiting" ? "is-running" : ""} />
        <span>{taskState?.state === "running" || taskState?.state === "waiting" ? copy.running : copy.ready}</span>
        {taskState?.checkpoint.current && <b>{taskState.checkpoint.current}</b>}
      </div>
      <div className="workbench-terminal-output" aria-live="polite">
        {evidence.length ? evidence.map((entry) => (
          <article key={entry.id}>
            <strong>{entry.label}</strong>
            <pre>{entry.body || "…"}</pre>
          </article>
        )) : <p className="workbench-tool-empty">{copy.terminalEmpty}</p>}
      </div>
      <form className="workbench-tool-command" onSubmit={submit}>
        <span aria-hidden>›</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.currentTarget.value)}
          placeholder={copy.terminalCommand}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={!command.trim()}>{copy.terminalSend}</button>
      </form>
    </section>
  );
}

function BrowserSurface({
  item,
  copy,
  onOpenBrowser,
}: Pick<WorkbenchToolSurfaceProps, "item" | "copy" | "onOpenBrowser"> & { item: WorkbenchToolExtension }) {
  const [address, setAddress] = useState("localhost:3000");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = address.trim();
    const failure = onOpenBrowser(item, /^https?:\/\//i.test(value) ? value : `http://${value}`);
    setError(failure ?? "");
  };
  return (
    <section className="workbench-tool-surface is-browser">
      <SurfaceIntro title={copy.browser} hint={copy.browserHint} />
      <div className="workbench-browser-blank">
        <div className="workbench-browser-mark" aria-hidden>◎</div>
        <form onSubmit={submit}>
          <label htmlFor={`browser-address-${item.id}`}>{copy.browserAddress}</label>
          <div>
            <span aria-hidden>http://</span>
            <input
              id={`browser-address-${item.id}`}
              value={address}
              onChange={(event) => {
                setAddress(event.currentTarget.value);
                if (error) setError("");
              }}
              spellCheck={false}
              autoComplete="url"
              aria-invalid={Boolean(error)}
            />
            <button type="submit">{copy.browserOpen}</button>
          </div>
          {error && <p role="alert">{error || copy.browserInvalid}</p>}
        </form>
      </div>
    </section>
  );
}

function FilesSurface({
  item,
  client,
  copy,
  onCompose,
}: Pick<WorkbenchToolSurfaceProps, "item" | "client" | "copy" | "onCompose"> & { item: WorkbenchToolExtension }) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void client?.filesSearch(query, { sessionId: item.owner.sessionId, limit: 50 })
        .then((result) => {
          if (!current) return;
          setFiles(result?.files ?? []);
        })
        .catch((reason) => {
          if (!current) return;
          setFiles([]);
          setError(String(reason?.message ?? reason));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, query ? 140 : 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [client, item.owner.sessionId, query]);

  return (
    <section className="workbench-tool-surface is-files">
      <SurfaceIntro title={copy.files} hint={copy.filesHint} />
      <div className="workbench-files-search">
        <span aria-hidden>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={copy.filesSearch}
          spellCheck={false}
          autoComplete="off"
        />
        {loading && <i aria-label={copy.running} />}
      </div>
      <div className="workbench-files-root" title={item.owner.cwd}>{item.owner.cwd}</div>
      <div className="workbench-files-list">
        {error ? <p className="workbench-tool-error" role="alert">{error}</p> : null}
        {!error && !loading && files.length === 0 ? <p className="workbench-tool-empty">{copy.filesEmpty}</p> : null}
        {files.map((file) => (
          <button key={file} type="button" title={`${copy.filesUse}: ${file}`} onClick={() => onCompose(`@${file} `)}>
            <span aria-hidden>{file.includes("/") ? "⌞" : "◇"}</span>
            <strong>{file}</strong>
            <small>{copy.filesUse}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReviewSurface({ item, copy }: { item: ReviewExtension; copy: WorkbenchToolCopy }) {
  const lines = useMemo(() => item.diff.split(/\r?\n/).slice(0, 12_000), [item.diff]);
  return (
    <section className="workbench-tool-surface is-review">
      <SurfaceIntro title={copy.review} hint={copy.reviewHint} />
      {lines.length ? (
        <div className="workbench-review-diff" role="region" aria-label={copy.review}>
          {lines.map((line, index) => {
            const tone = line.startsWith("+++") || line.startsWith("---")
              ? "is-file"
              : line.startsWith("+")
                ? "is-add"
                : line.startsWith("-")
                  ? "is-remove"
                  : line.startsWith("@@")
                    ? "is-hunk"
                    : "";
            return <code className={tone} key={`${index}-${line.slice(0, 24)}`}>{line || " "}</code>;
          })}
        </div>
      ) : <p className="workbench-tool-empty">{copy.reviewEmpty}</p>}
    </section>
  );
}

export default function WorkbenchToolSurface(props: WorkbenchToolSurfaceProps) {
  if (props.item.type === "review") return <ReviewSurface item={props.item} copy={props.copy} />;
  if (props.item.tool === "terminal") return <TerminalSurface {...props} />;
  if (props.item.tool === "browser") return <BrowserSurface {...props} item={props.item} />;
  return <FilesSurface {...props} item={props.item} />;
}
