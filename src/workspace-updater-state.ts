export interface UpdatePreferences { autoCheck: boolean; lastChecked: number | null; skippedVersion: string | null; snooze: { version: string; until: number } | null }
export type UpdateProgress = { event: "Started"; data: { contentLength?: number } } | { event: "Progress"; data: { chunkLength: number } } | { event: "Finished" };
export interface UpdateHandle { version: string; body?: string; download(progress: (event: UpdateProgress) => void): Promise<void>; install(): Promise<void>; close(): Promise<void> }
export interface UpdateView { phase: "latest" | "checking" | "available" | "downloading" | "ready" | "error"; version: string; notes: string; downloaded: number; total: number | null;
  notice: boolean; message: string; preferences: UpdatePreferences; installing: boolean }
export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
export const UPDATE_SNOOZE_KEY = "hara.desktopUpdateSnooze";
export const updateDefaults = (): UpdatePreferences => ({ autoCheck: true, lastChecked: null, skippedVersion: null, snooze: null });
const validVersion = (value: string) => /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value);
export function newerVersion(next: string, previous: string) {
  if (!validVersion(next) || !validVersion(previous)) return false;
  const [a, preA] = next.split("-"), [b, preB] = previous.split("-");
  const na = a.split(".").map(Number), nb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] > nb[i];
  if (!preA || !preB) return Boolean(!preA && preB);
  const pa = preA.split("."), pb = preB.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue; if (pa[i] === undefined || pb[i] === undefined) return pb[i] === undefined;
    return /^\d+$/.test(pa[i]) && /^\d+$/.test(pb[i]) ? Number(pa[i]) > Number(pb[i]) : pa[i] > pb[i];
  }
  return false;
}
export function shouldNotify(version: string, prefs: UpdatePreferences, now: number) {
  return !(prefs.skippedVersion && !newerVersion(version, prefs.skippedVersion)) && !(prefs.snooze?.version === version && prefs.snooze.until > now);
}
export function hasUpdateAttention(view: UpdateView) { return view.phase === "ready" || view.phase === "available"
  && !(view.preferences.skippedVersion && !newerVersion(view.version, view.preferences.skippedVersion)); }
interface Dependencies { check(): Promise<UpdateHandle | null>; load(): Promise<UpdatePreferences>; save(value: UpdatePreferences): Promise<void>;
  activity(): Promise<{ running: number }>; prepare(): Promise<{ id: string }>; release(id: string): Promise<void>; restart(): Promise<void>; error(error: unknown): string; now?: () => number }
/** One owner for timers, checks and signed downloads. No background install or automatic resend. */
export class WorkspaceUpdater {
  private value: UpdateView = { phase: "latest", version: "", notes: "", downloaded: 0, total: null, notice: false, message: "", preferences: updateDefaults(), installing: false };
  private readonly listeners = new Set<() => void>();
  private handle: UpdateHandle | null = null;
  private disposed = false;
  private operation = false;
  private first?: ReturnType<typeof setTimeout>;
  private timer?: ReturnType<typeof setInterval>;
  private nextCheck = Infinity;
  private lifecycle = 0;
  private preferenceQueue: Promise<void> = Promise.resolve();
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private now() { return this.deps.now?.() ?? Date.now(); }
  private update(next: Partial<UpdateView>) { if (this.disposed) return; this.value = { ...this.value, ...next }; this.listeners.forEach(listener => listener()); }
  async start() {
    const owner = ++this.lifecycle; this.disposed = false; clearTimeout(this.first); clearInterval(this.timer);
    try { const preferences = await this.deps.load(); if (this.disposed || owner !== this.lifecycle) return; this.update({ preferences }); }
    catch { if (this.disposed || owner !== this.lifecycle) return; this.update({ preferences: { ...updateDefaults(), autoCheck: false }, message: "更新偏好暂未读取；可以手动检查，不会改写原设置。" }); }
    if (this.disposed || owner !== this.lifecycle) return;
    this.nextCheck = this.now() + 30000;
    this.first = setTimeout(() => { void this.wake(); }, 30000);
    this.timer = setInterval(() => { void this.wake(); }, 60000);
  }
  async wake() { if (this.value.preferences.autoCheck && this.now() >= this.nextCheck) await this.check(false); }
  private persist(patch: Partial<UpdatePreferences>) {
    const preferences = { ...this.value.preferences, ...patch }; this.update({ preferences });
    this.preferenceQueue = this.preferenceQueue.catch(() => {}).then(() => this.deps.save(preferences));
    return this.preferenceQueue.catch(() => { this.update({ message: "更新偏好保存未确认，请重新打开设置核对；不会自动重送。" }); });
  }
  async setAutoCheck(value: boolean) { await this.persist({ autoCheck: value }); this.nextCheck = value ? this.now() + 30000 : Infinity; }
  async check(manual = true) {
    if (this.operation || this.disposed || this.value.phase === "ready" || this.value.phase === "downloading") return;
    this.operation = true; const previous = this.handle; this.handle = null;
    this.update({ phase: "checking", message: "", notice: false, version: "", notes: "" });
    try {
      await previous?.close().catch(() => {});
      const handle = await this.deps.check();
      if (this.disposed) { await handle?.close().catch(() => {}); return; }
      if (handle && !validVersion(handle.version)) { await handle.close(); throw new Error("Invalid Hara update version"); }
      this.handle = handle;
      this.update({ phase: handle ? "available" : "latest", version: handle?.version ?? "", notes: (handle?.body ?? "").slice(0, 4000),
        notice: Boolean(handle && (manual || shouldNotify(handle.version, this.value.preferences, this.now()))) });
    } catch (error) { this.update({ phase: "error", message: this.deps.error(error), notice: false }); }
    finally { this.nextCheck = this.now() + UPDATE_INTERVAL; await this.persist({ lastChecked: this.now() }); this.operation = false; }
  }
  async later() { if (!this.value.version) return; this.update({ notice: false }); await this.persist({ snooze: { version: this.value.version, until: this.now() + 86400000 } }); }
  async skip() { if (!this.value.version || this.value.phase !== "available") return; this.update({ notice: false }); await this.persist({ skippedVersion: this.value.version }); }
  async download() {
    if (this.operation || this.value.phase !== "available" || !this.handle || this.disposed) return;
    this.operation = true; const handle = this.handle; this.update({ phase: "downloading", downloaded: 0, total: null, notice: false, message: "" });
    try {
      const activity = await this.deps.activity();
      if (activity.running) this.update({ message: "有同事正在工作。下载完成后会等待任务结束，再请你重启；不会打断同事。" });
      await handle.download(event => {
        if (this.disposed) return;
        if (event.event === "Started") this.update({ total: event.data.contentLength ?? null });
        if (event.event === "Progress") this.update({ downloaded: this.value.downloaded + (event.data.chunkLength ?? 0) });
      });
      // download() resolves only after the native minisign verifier succeeds. Finished events alone
      // are not signature evidence and never enable installation.
      this.update({ phase: "ready", notice: true });
    } catch (error) { this.update({ phase: "error", message: this.deps.error(error), notice: false }); }
    finally { this.operation = false; }
  }
  async restart() {
    if (this.operation || this.value.phase !== "ready" || !this.handle || this.disposed) return;
    this.operation = true; let lease: { id: string } | undefined;
    try {
      if ((await this.deps.activity()).running) { this.update({ message: "有同事正在工作，请等待任务结束后再重启；当前任务不会被打断。" }); return; }
      // Host refuses new work between this atomic idle check and install/restart.
      lease = await this.deps.prepare(); this.update({ installing: true, notice: false, message: "" });
      await this.handle.install(); await this.deps.restart();
    } catch (error) { this.update({ message: "尚未重启：同事可能正在工作，或安装结果未确认。请核对后再操作。", installing: false }); }
    finally { if (lease) await this.deps.release(lease.id).catch(() => {}); this.operation = false; }
  }
  hideNotice() { this.update({ notice: false }); }
  dispose() { this.disposed = true; this.lifecycle++; clearTimeout(this.first); clearInterval(this.timer); void this.handle?.close().catch(() => {}); }
}
