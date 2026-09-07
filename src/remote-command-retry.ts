export type RemoteCommandMethod =
  | "external.sessions.submit"
  | "external.sessions.steer"
  | "external.sessions.interrupt";

interface PendingRemoteCommand {
  version: 1;
  method: RemoteCommandMethod;
  resourceId: string;
  fingerprint: string;
  commandId: string;
  updatedAt: number;
}

interface StoredPendingRemoteCommands {
  version: 1;
  salt: string;
  commands: PendingRemoteCommand[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RemoteCommandRetryTrackerOptions {
  storage?: StorageLike;
  now?: () => number;
  uuid?: () => string;
  fingerprint?: (input: string) => Promise<string>;
}

const STORAGE_KEY = "hara.external-command-retries.v1";
const MAX_PENDING_COMMANDS = 32;
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1_000;

const validUuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

const validRecord = (value: unknown): value is PendingRemoteCommand => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingRemoteCommand>;
  return candidate.version === 1
    && ["external.sessions.submit", "external.sessions.steer", "external.sessions.interrupt"].includes(candidate.method ?? "")
    && typeof candidate.resourceId === "string"
    && candidate.resourceId.length > 0
    && candidate.resourceId.length <= 256
    && typeof candidate.fingerprint === "string"
    && /^[a-f0-9]{64}$/u.test(candidate.fingerprint)
    && validUuid(candidate.commandId)
    && Number.isSafeInteger(candidate.updatedAt)
    && (candidate.updatedAt ?? -1) >= 0;
};

const defaultFingerprint = async (input: string): Promise<string> => {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Keeps only opaque identifiers and salted payload fingerprints. If the transport disappears before the
 * RPC result is visible, Desktop can reuse the same UUID without persisting the user's instruction text.
 */
export class RemoteCommandRetryTracker {
  private readonly storage?: StorageLike;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly fingerprint: (input: string) => Promise<string>;
  private salt: string;
  private commands: PendingRemoteCommand[];

  constructor(options: RemoteCommandRetryTrackerOptions = {}) {
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.fingerprint = options.fingerprint ?? defaultFingerprint;
    const restored = this.read();
    this.salt = restored?.salt ?? this.uuid();
    this.commands = restored?.commands ?? [];
    this.prune();
  }

  async begin(method: RemoteCommandMethod, resourceId: string, payload: string): Promise<string> {
    const fingerprint = await this.fingerprint(`${this.salt}\0${method}\0${resourceId}\0${payload}`);
    this.prune();
    const prior = this.commands.find((command) => (
      command.method === method
      && command.resourceId === resourceId
      && command.fingerprint === fingerprint
    ));
    if (prior) return prior.commandId;
    const command: PendingRemoteCommand = {
      version: 1,
      method,
      resourceId,
      fingerprint,
      commandId: this.uuid(),
      updatedAt: this.now(),
    };
    this.commands.push(command);
    this.prune();
    this.persist();
    return command.commandId;
  }

  settle(commandId: string | undefined): void {
    if (!commandId) return;
    const next = this.commands.filter((command) => command.commandId !== commandId);
    if (next.length === this.commands.length) return;
    this.commands = next;
    this.persist();
  }

  private prune(): void {
    const oldest = this.now() - MAX_PENDING_AGE_MS;
    this.commands = this.commands
      .filter((command) => command.updatedAt >= oldest)
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(-MAX_PENDING_COMMANDS);
  }

  private read(): StoredPendingRemoteCommands | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw || raw.length > 32 * 1_024) return null;
      const parsed = JSON.parse(raw) as Partial<StoredPendingRemoteCommands>;
      if (
        parsed.version !== 1
        || !validUuid(parsed.salt)
        || !Array.isArray(parsed.commands)
        || parsed.commands.length > MAX_PENDING_COMMANDS
        || !parsed.commands.every(validRecord)
      ) return null;
      return { version: 1, salt: parsed.salt, commands: parsed.commands };
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (this.commands.length === 0) {
        this.storage.removeItem(STORAGE_KEY);
        return;
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        salt: this.salt,
        commands: this.commands,
      } satisfies StoredPendingRemoteCommands));
    } catch {
      // The CLI receipt remains authoritative. Storage only improves renderer-restart retry continuity.
    }
  }
}
