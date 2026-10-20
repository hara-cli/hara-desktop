/** Preserve the existing explicit loopback-only preview boundary. Never accept credentials. */
export function workspacePreviewURL(address: string): string | null {
  try {
    const value = new URL(address);
    if (!["https:", "http:"].includes(value.protocol) || value.username || value.password
      || !["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)) return null;
    return value.href;
  } catch { return null; }
}
