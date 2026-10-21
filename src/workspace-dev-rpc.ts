import type { WorkspaceDevRpc } from "./workspace-dev-state";
import { WorkspaceRpcWaitError } from "./workspace-dev-errors.ts";
export interface WorkspaceDevConnection { port: number; token: string; instanceId: string; root: string; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" | "workspace" }
/** One listener per socket, bounded pending requests, no token persistence/logging or legacy fallback. */
export class WorkspaceDevConnectionClient implements WorkspaceDevRpc {
  private serial = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly socket: WebSocket;
  private readonly onDisconnect: () => void;
  private readonly realKey: boolean;
  private readonly production: boolean;
  private onChanged: (workspaceId: string) => void = () => {};
  private capabilities = new Set<string>();
  constructor(info: WorkspaceDevConnection, onDisconnect: () => void) {
    this.onDisconnect = onDisconnect;
    this.realKey = info.syntheticOnly === false && info.executionMode === "ark-real-key";
    this.production = info.syntheticOnly === false && info.executionMode === "workspace";
    if (!Number.isSafeInteger(info.port) || info.port < 1 || info.port > 65535 || !/^[a-f0-9]{64}$/.test(info.token)
      || (!this.realKey && !this.production && info.syntheticOnly !== true) || (info.syntheticOnly === true && info.executionMode && info.executionMode !== "synthetic")) throw new Error("不是受支援的本機 Workspace。");
    this.socket = new WebSocket(`ws://127.0.0.1:${info.port}`);
    this.socket.addEventListener("message", event => {
      let value: { id?: number; method?: string; params?: { workspaceId?: string }; result?: unknown; error?: { message?: string; code?: number } };
      try { value = JSON.parse(String(event.data)); } catch { return; }
      if (value.method === "workspace.changed" && typeof value.params?.workspaceId === "string") { this.onChanged(value.params.workspaceId); return; }
      const pending = value.id === undefined ? undefined : this.pending.get(value.id); if (!pending || value.id === undefined) return;
      this.pending.delete(value.id); clearTimeout(pending.timer);
      if (value.error) pending.reject(Object.assign(new Error(value.error.message ?? "Workspace 請求失敗"), { code: value.error.code })); else pending.resolve(value.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Workspace 連接已中斷")); }
      this.pending.clear(); this.onDisconnect();
    });
  }
  async initialize(token: string): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise<void>((resolve, reject) => {
      const opened = () => { clearTimeout(timer); this.socket.removeEventListener("error", failed); resolve(); };
      const failed = () => { clearTimeout(timer); this.socket.removeEventListener("open", opened); this.socket.removeEventListener("error", failed); reject(new Error("本機 Workspace Dev 無法連接")); };
      const timer = setTimeout(failed, 10000); this.socket.addEventListener("open", opened, { once: true }); this.socket.addEventListener("error", failed, { once: true });
    });
    const result = await this.request<{ capabilities: string[]; syntheticOnly: boolean; executionMode?: string }>("initialize", { token });
    this.capabilities = new Set(Array.isArray(result.capabilities) ? result.capabilities : []);
    if (this.production ? !result.capabilities?.includes("workspace.v1") || result.syntheticOnly !== false || result.executionMode !== "workspace"
      : !result.capabilities?.includes("workspace.local-dev.v2") || (this.realKey
      ? result.syntheticOnly !== false || result.executionMode !== "ark-real-key" || !result.capabilities.includes("workspace.real-key-slice.v1")
      : result.syntheticOnly !== true || (result.executionMode && result.executionMode !== "synthetic"))) {
      this.close(); throw new Error("引擎不支援這個獨立 Workspace Dev；沒有切換到舊連接。"); }
  }
  setChangedListener(listener: (workspaceId: string) => void): void { this.onChanged = listener; }
  supportsCapability(capability: string): boolean { return this.capabilities.has(capability); }
  request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Workspace 尚未連接"));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new WorkspaceRpcWaitError(method)); }, 15000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error("Workspace 傳輸中斷；請只讀核對原請求，勿重送")); }
    });
  }
  close(): void { this.socket.close(); }
}
