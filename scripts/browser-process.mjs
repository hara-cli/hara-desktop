// Inspect the complete incoming chunk before retaining a bounded tail. Linux browser diagnostics
// can share one large chunk with the readiness line; trimming first can discard that line forever.
export function readDevToolsAnnouncement(tail, chunk) {
  const text = tail + chunk.toString();
  return { url: /DevTools listening on (ws:\/\/[^\s]+)\r?\n/.exec(text)?.[1] ?? null, tail: text.slice(-4000) };
}

export async function stopOwnedBrowser(child, { graceMs = 4000 } = {}) {
  const live = () => child.exitCode === null && child.signalCode === null;
  if (!live()) return;
  let onExit;
  const exited = new Promise(resolve => { onExit = resolve; child.once("exit", onExit); });
  const wait = async () => {
    let timer;
    try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, graceMs); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    child.kill("SIGTERM"); await wait();
    if (live()) { child.kill("SIGKILL"); await wait(); }
    if (live()) throw new Error("Owned browser process did not exit within cleanup bounds");
  } finally { child.removeListener("exit", onExit); }
}
