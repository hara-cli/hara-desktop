// hara serve client — JSON-RPC 2.0 over WebSocket (protocol v1, mirrors hara-cli src/serve/protocol.ts).
// Request/response correlation + typed event callbacks; the UI layer stays purely declarative.

export interface Discovery {
  host: string;
  port: number;
  token: string;
  pid: number;
  version: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  model: string;
  updatedAt: string;
  source?: "interactive" | "gateway" | "cron";
  sourceName?: string;
  archived?: boolean;
}

export interface CronJobInfo {
  id: string;
  name: string;
  mode: string;
  cwd: string;
  enabled: boolean;
  deliver?: string;
  lastRunAt?: number;
  lastStatus?: "ok" | "error";
  lastError?: string;
  schedule?: string; // human description ("every 30m", "cron 0 9 * * *")
}

export interface PanelSpec {
  id: string;
  title: string;
  command: string;
  args?: string[];
  port?: number;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  skills: number;
  agents: number;
  mcpServers: number;
  panels?: PanelSpec[];
}

export interface SkillInfo {
  id: string;
  description: string;
  source: string;
}

export type ServerEvent =
  | { method: "event.text"; sessionId: string; delta: string }
  | { method: "event.reasoning"; sessionId: string; delta: string }
  | { method: "event.tool"; sessionId: string; name: string; preview: string }
  | { method: "event.diff"; sessionId: string; text: string }
  | { method: "event.notice"; sessionId: string; text: string }
  | { method: "event.turn_end"; sessionId: string; reply: string; usage: { input: number; output: number } }
  | { method: "approval.request"; sessionId: string; approvalId: string; question: string };

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class HaraClient {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  onEvent: (e: ServerEvent) => void = () => {};
  onClose: () => void = () => {};

  async connect(host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}:${port}`);
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error(`cannot reach ws://${host}:${port}`));
      ws.onclose = () => {
        this.ws = null;
        for (const p of this.pending.values()) p.reject(new Error("connection closed"));
        this.pending.clear();
        this.onClose();
      };
      ws.onmessage = (ev) => {
        let m: any;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.id !== undefined && m.id !== null && this.pending.has(m.id)) {
          const p = this.pending.get(m.id)!;
          this.pending.delete(m.id);
          if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
          else p.resolve(m.result);
        } else if (m.method) {
          this.onEvent({ method: m.method, ...(m.params ?? {}) } as ServerEvent);
        }
      };
    });
  }

  private call<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  initialize(token: string) {
    return this.call<{ name: string; version: string; protocol: number; cwd: string; provider: string; model: string }>("initialize", { token });
  }
  listSessions(cwd?: string) {
    return this.call<{ sessions: SessionInfo[] }>("session.list", cwd ? { cwd } : {});
  }
  createSession(opts?: { cwd?: string; approval?: string }) {
    return this.call<{ sessionId: string; model: string }>("session.create", opts ?? {});
  }
  listPlugins() {
    return this.call<{ plugins: PluginInfo[] }>("plugins.list", {});
  }
  setPlugin(name: string, enabled: boolean) {
    return this.call<{ name: string; enabled: boolean }>("plugins.set", { name, enabled });
  }
  listSkills(cwd?: string) {
    return this.call<{ skills: SkillInfo[] }>("skills.list", cwd ? { cwd } : {});
  }
  /** Model catalog + effort levels (serve ≥0.116). Null on older serves. */
  async listModels(): Promise<{ models: string[]; current: string; effortLevels: string[] } | null> {
    try {
      return await this.call("models.list", {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  addAutomation(name: string, schedule: string, task: string, cwd?: string) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.add", { name, schedule, task, ...(cwd ? { cwd } : {}) });
  }
  toggleAutomation(idJob: string, enabled: boolean) {
    return this.call("automation.toggle", { id: idJob, enabled });
  }
  deleteAutomation(idJob: string) {
    return this.call("automation.delete", { id: idJob });
  }
  renameSession(sessionId: string, title: string) {
    return this.call<{ sessionId: string; title: string }>("session.rename", { sessionId, title });
  }
  archiveSession(sessionId: string, archived = true) {
    return this.call<{ sessionId: string; archived: boolean }>("session.archive", { sessionId, archived });
  }
  setSessionModel(sessionId: string, model?: string, effort?: string) {
    return this.call<{ sessionId: string; model: string; effort: string | null }>("session.set-model", { sessionId, model, effort });
  }
  /** Automation timeline data (serve ≥0.116). Gracefully returns null on older serves (-32601). */
  async listAutomation(): Promise<{ jobs: CronJobInfo[]; sessions: SessionInfo[] } | null> {
    try {
      return await this.call("automation.list", {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  resumeSession(sessionId: string) {
    return this.call<{ sessionId: string; model: string; history: { role: string; text: string }[] }>("session.resume", { sessionId });
  }
  send(sessionId: string, text: string) {
    return this.call<{ reply: string; usage: { input: number; output: number } }>("session.send", { sessionId, text });
  }
  interrupt(sessionId: string) {
    return this.call("session.interrupt", { sessionId });
  }
  approvalReply(approvalId: string, allow: boolean, always = false) {
    return this.call("approval.reply", { approvalId, allow, always });
  }
  close() {
    this.ws?.close();
  }
  get connected(): boolean {
    return !!this.ws;
  }
}
