// Page.navigate acknowledges a navigation before the old execution context is gone. Do not evaluate
// (or replay an action) in that old document: wait for this exact frame/loader's DOMContentLoaded.
export async function navigateCdp(send, socket, { url, sessionId, step, timeoutMs = 12000 }) {
  let navigation, resolveReady, rejectReady;
  const seen = new Set();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const key = (frameId, loaderId) => JSON.stringify([frameId, loaderId]);
  const onMessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.sessionId !== sessionId || message.method !== "Page.lifecycleEvent"
      || message.params?.name !== "DOMContentLoaded") return;
    const { frameId, loaderId } = message.params;
    if (typeof frameId !== "string" || typeof loaderId !== "string") return;
    if (seen.size >= 64) { rejectReady(new Error(`Too many document loaders at ${step}`)); return; }
    seen.add(key(frameId, loaderId));
    if (navigation && seen.has(key(navigation.frameId, navigation.loaderId))) resolveReady();
  };
  const onClose = () => rejectReady(new Error(`Navigation target closed at ${step}`));
  const timer = setTimeout(() => rejectReady(new Error(`Document navigation timed out at ${step}`)), timeoutMs);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onClose);
  try {
    // Observe both promises immediately, including a socket failure before Page.navigate replies.
    navigation = await Promise.race([send("Page.navigate", { url }), ready]);
    if (!navigation?.frameId || !navigation.loaderId || navigation.errorText || navigation.isDownload)
      throw new Error(`Document navigation failed at ${step}`);
    if (seen.has(key(navigation.frameId, navigation.loaderId))) resolveReady();
    await ready;
    return navigation;
  } finally {
    clearTimeout(timer);
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    socket.removeEventListener("error", onClose);
  }
}
