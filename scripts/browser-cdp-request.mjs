// Keep synchronous socket failures inside the same observed promise as protocol failures.
export function requestCdp(socket, pending, { id, method, params = {}, sessionId, step, timeoutMs = 15000 }) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(new Error(`${method} timed out at ${step} (request ${id})`));
    }, timeoutMs);
    pending.set(id, { done, fail, timer, method });
    try {
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      fail(error);
    }
  });
}
