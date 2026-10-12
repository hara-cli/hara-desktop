/** A late read cannot update the mailbox page after a company change or unmount. */
export class MailboxScopeGuard {
  private revision = 0;
  begin(): () => boolean { const captured = ++this.revision; return () => this.revision === captured; }
  invalidate(): void { this.revision++; }
}
/** Preserve the same retry identity after a failed request; successful intentional repeats get a new one. */
export class MailboxRequestKeys {
  private keys = new Map<string, string>();
  private uuid: () => string;
  constructor(uuid: () => string = () => crypto.randomUUID()) { this.uuid = uuid; }
  get(operation: string, input: Record<string, unknown>): string {
    const identity = JSON.stringify([operation, input]);
    let key = this.keys.get(identity);
    if (!key) { key = this.uuid(); this.keys.set(identity, key); }
    return key;
  }
  complete(operation: string, input: Record<string, unknown>): void { this.keys.delete(JSON.stringify([operation, input])); }
}
