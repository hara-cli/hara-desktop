#!/usr/bin/env node
// Dedicated runner transport only: CONNECT bodies stay opaque and no client headers
// or upstream configuration are logged, persisted, or forwarded to another proxy.
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTED_HOSTS = new Set(['api.github.com', 'broker.actions.githubusercontent.com']);
const ACTIONS_DISPATCH_HOST = 'run-actions-2-azure-eastus.actions.githubusercontent.com';
const APPLE_NOTARY_HOSTS = new Set([
  'appstoreconnect.apple.com',
  'notary-submissions-prod.s3-accelerate.amazonaws.com',
]);
const MAX_HEADER_BYTES = 8192;
const HANDSHAKE_TIMEOUT_MS = 12000;
const unavailable = () => new Error('transport unavailable');

export function parseAuthority(value) {
  if (typeof value !== 'string' || value.length > 260 || /[^\x21-\x7e]/.test(value)) {
    throw new Error('invalid CONNECT authority');
  }
  const match = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):443$/.exec(value);
  if (!match) throw new Error('invalid CONNECT authority');
  let host = match[1].toLowerCase();
  const bracketed = host.startsWith('[');
  if (bracketed) {
    host = host.slice(1, -1);
    if (net.isIP(host) !== 6) throw new Error('invalid CONNECT authority');
  } else if (!net.isIP(host)) {
    const dnsName = host.endsWith('.') ? host.slice(0, -1) : host;
    if (dnsName.length > 253 || !dnsName.split('.').every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new Error('invalid CONNECT authority');
    }
  }
  return { host, port: 443, authority: `${bracketed ? `[${host}]` : host}:443` };
}

function validateAppleNotaryRoute(value) {
  if (typeof value !== 'boolean') throw new Error('invalid Apple notarization route flag');
}

function validateActionsDispatchRoute(value) {
  if (typeof value !== 'boolean') throw new Error('invalid Actions dispatch route flag');
}

export function routeDecision(authority, { appleNotaryRoute = false, actionsDispatchRoute = false } = {}) {
  validateAppleNotaryRoute(appleNotaryRoute);
  validateActionsDispatchRoute(actionsDispatchRoute);
  const target = parseAuthority(authority);
  const routed = ROUTED_HOSTS.has(target.host) || (appleNotaryRoute && APPLE_NOTARY_HOSTS.has(target.host))
    || (actionsDispatchRoute && target.host === ACTIONS_DISPATCH_HOST);
  return { ...target, route: routed ? 'upstream' : 'direct' };
}

export function parseUpstream(value) {
  if (typeof value !== 'string' || /[\s\x00-\x1f\x7f@]/.test(value)) {
    throw new Error('invalid loopback upstream');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('invalid loopback upstream'); }
  if (!['http:', 'socks5:', 'socks5h:'].includes(parsed.protocol)
    || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password
    || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new Error('invalid loopback upstream');
  }
  // Require a literal host and explicit canonical port; URL normalization must
  // not silently turn alternate host spellings or an absent port into a route.
  const match = /^(http|socks5|socks5h):\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(value);
  const port = match ? Number(match[2]) : 0;
  if (port < 1 || port > 65535) throw new Error('invalid loopback upstream');
  return Object.freeze({ protocol: parsed.protocol, host: '127.0.0.1', port });
}

function defaultDial({ host, port, signal }) {
  return new Promise((resolveSocket, reject) => {
    const socket = net.createConnection({ host, port, allowHalfOpen: true, signal });
    const onError = () => { socket.destroy(); reject(unavailable()); };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.removeListener('error', onError);
      socket.on('error', () => {});
      resolveSocket(socket);
    });
  });
}

// Read only the handshake bytes, retaining any TLS bytes in the same TCP chunk.
class HandshakeReader {
  constructor(socket, signal) {
    this.socket = socket;
    this.signal = signal;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.failure = null;
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.check();
    };
    this.onFailure = () => {
      this.failure = unavailable();
      if (this.pending) this.finish(this.failure);
    };
    socket.on('data', this.onData);
    socket.on('error', this.onFailure);
    socket.on('end', this.onFailure);
    socket.on('close', this.onFailure);
    signal.addEventListener('abort', this.onFailure, { once: true });
    socket.resume();
  }
  finish(error, bytes) {
    const pending = this.pending;
    this.pending = null;
    if (error) pending.reject(error);
    else pending.resolve(bytes);
  }
  check() {
    if (!this.pending) return;
    let length = this.pending.length;
    if (length === null) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end !== -1) length = end + 4;
      else if (this.buffer.length > MAX_HEADER_BYTES) return this.finish(unavailable());
      else return;
      if (length > MAX_HEADER_BYTES) return this.finish(unavailable());
    }
    if (this.buffer.length < length) return;
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    this.finish(null, result);
  }
  read(length) {
    if (this.signal.aborted) return Promise.reject(unavailable());
    return new Promise((resolveBytes, reject) => {
      this.pending = { length, resolve: resolveBytes, reject };
      this.check();
      // A peer may half-close after putting the complete handshake in one
      // chunk. Its already-buffered bytes remain valid for subsequent reads.
      if (this.pending && this.failure) this.finish(this.failure);
    });
  }
  detach() {
    this.socket.pause();
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onFailure);
    this.socket.removeListener('end', this.onFailure);
    this.socket.removeListener('close', this.onFailure);
    this.signal.removeEventListener('abort', this.onFailure);
    return this.buffer;
  }
}

async function proxyHandshake(socket, proxy, target, signal) {
  const reader = new HandshakeReader(socket, signal);
  try {
    if (proxy.protocol === 'http:') {
      socket.write(`CONNECT ${target.authority} HTTP/1.1\r\nHost: ${target.authority}\r\n\r\n`);
      const response = (await reader.read(null)).toString('latin1');
      if (!/^HTTP\/1\.[01] 200(?:[ \t][^\r\n]*)?\r\n/.test(response)) throw unavailable();
    } else {
      // No authentication negotiation and remote DNS for both SOCKS variants.
      socket.write(Buffer.from([5, 1, 0]));
      const greeting = await reader.read(2);
      if (greeting[0] !== 5 || greeting[1] !== 0) throw unavailable();
      const hostname = Buffer.from(target.host, 'ascii');
      socket.write(Buffer.concat([
        Buffer.from([5, 1, 0, 3, hostname.length]), hostname, Buffer.from([1, 187]),
      ]));
      const reply = await reader.read(4);
      if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) throw unavailable();
      if (reply[3] === 1) await reader.read(6);
      else if (reply[3] === 4) await reader.read(18);
      else if (reply[3] === 3) {
        const length = (await reader.read(1))[0];
        if (!length) throw unavailable();
        await reader.read(length + 2);
      } else throw unavailable();
    }
    return reader.detach();
  } catch {
    reader.detach();
    throw unavailable();
  }
}

async function openTunnel(target, proxy, dial, outerSignal, timeoutMs) {
  const controller = new AbortController();
  const signal = AbortSignal.any([outerSignal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  let socket;
  const work = (async () => {
    socket = await dial({ host: proxy?.host ?? target.host, port: proxy?.port ?? target.port, signal });
    socket.on('error', () => {});
    if (signal.aborted) { socket.destroy(); throw unavailable(); }
    socket.allowHalfOpen = true;
    socket.pause();
    const head = proxy ? await proxyHandshake(socket, proxy, target, signal) : Buffer.alloc(0);
    if (signal.aborted || socket.destroyed) throw unavailable();
    socket.setTimeout?.(0);
    return { socket, head };
  })();
  let abortHandler;
  const aborted = new Promise((_, reject) => {
    abortHandler = () => { socket?.destroy(); reject(unavailable()); };
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
  });
  try { return await Promise.race([work, aborted]); }
  catch { socket?.destroy(); throw unavailable(); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abortHandler);
  }
}

function rejectClient(socket, code) {
  if (!socket.destroyed && socket.writable) {
    socket.end(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } else socket.destroy();
}

export function createServer({ primaryProxy, fallbackProxy, dialDirect = defaultDial,
  dialProxy = defaultDial, handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS, appleNotaryRoute = false,
  actionsDispatchRoute = false } = {}) {
  validateAppleNotaryRoute(appleNotaryRoute);
  validateActionsDispatchRoute(actionsDispatchRoute);
  const primary = parseUpstream(primaryProxy);
  const fallback = fallbackProxy ? parseUpstream(fallbackProxy) : null;
  if (!Number.isInteger(handshakeTimeoutMs) || handshakeTimeoutMs < 1
    || handshakeTimeoutMs > HANDSHAKE_TIMEOUT_MS) throw new Error('invalid handshake deadline');
  const counts = { received: 0, direct: 0, routed: 0, established: 0, failed: 0, fallbacks: 0, active: 0 };
  const initialTimers = new WeakMap();
  const stopInitialTimer = (socket) => {
    clearTimeout(initialTimers.get(socket));
    initialTimers.delete(socket);
  };
  const server = http.createServer({ allowHalfOpen: true, maxHeaderSize: MAX_HEADER_BYTES }, (req, res) => {
    stopInitialTimer(req.socket);
    res.setHeader('Connection', 'close');
    if (req.method === 'GET' && req.url === '/healthz') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ healthy: server.listening, ...counts }));
    } else {
      res.writeHead(405);
      res.end();
    }
  });
  server.allowHalfOpen = true;
  server.headersTimeout = HANDSHAKE_TIMEOUT_MS;
  server.requestTimeout = HANDSHAKE_TIMEOUT_MS;
  server.maxHeadersCount = 100;
  server.on('connection', (socket) => {
    socket.allowHalfOpen = true;
    const timer = setTimeout(() => rejectClient(socket, '408 Request Timeout'), handshakeTimeoutMs);
    timer.unref();
    initialTimers.set(socket, timer);
    socket.once('close', () => stopInitialTimer(socket));
  });
  server.on('clientError', (_error, socket) => {
    stopInitialTimer(socket);
    rejectClient(socket, '400 Bad Request');
  });
  server.on('connect', async (req, client, clientHead) => {
    stopInitialTimer(client);
    client.pause();
    counts.received++;
    let target;
    try { target = routeDecision(req.url, { appleNotaryRoute, actionsDispatchRoute }); }
    catch {
      counts.failed++;
      rejectClient(client, '400 Bad Request');
      return;
    }
    const controller = new AbortController();
    const onClientClose = () => controller.abort();
    client.once('close', onClientClose);
    client.on('error', () => {});
    let tunnel;
    try {
      if (target.route === 'direct') {
        counts.direct++;
        tunnel = await openTunnel(target, null, dialDirect, controller.signal, handshakeTimeoutMs);
      } else {
        counts.routed++;
        try { tunnel = await openTunnel(target, primary, dialProxy, controller.signal, handshakeTimeoutMs); }
        catch {
          if (!fallback || controller.signal.aborted) throw unavailable();
          counts.fallbacks++;
          tunnel = await openTunnel(target, fallback, dialProxy, controller.signal, handshakeTimeoutMs);
        }
      }
    } catch {
      counts.failed++;
      client.removeListener('close', onClientClose);
      rejectClient(client, '502 Bad Gateway');
      return;
    }
    client.removeListener('close', onClientClose);
    if (client.destroyed) { tunnel.socket.destroy(); return; }
    counts.established++;
    counts.active++;
    client.once('close', () => { counts.active--; tunnel.socket.destroy(); });
    tunnel.socket.once('close', (hadError) => {
      // On graceful EOF pipe has queued the final bytes and client.end(). Let
      // those buffered writes drain instead of truncating a slow recipient.
      if (hadError || !tunnel.socket.readableEnded) client.destroy();
    });
    tunnel.socket.on('error', () => client.destroy());
    client.on('error', () => tunnel.socket.destroy());
    client.setTimeout(0);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // unshift + pipe preserve ordering and use Node's stream backpressure. EOF
    // half-closes only the peer's writable side, permitting its remaining reply.
    if (!tunnel.socket.readableEnded && tunnel.head.length) tunnel.socket.unshift(tunnel.head);
    if (client.readableEnded) {
      // A client can send its complete TLS payload and FIN while the upstream
      // handshake is pending. unshift after EOF would discard that payload.
      if (clientHead.length) tunnel.socket.write(clientHead);
      tunnel.socket.end();
    } else {
      if (clientHead.length) client.unshift(clientHead);
      client.pipe(tunnel.socket);
    }
    if (tunnel.socket.readableEnded) {
      if (tunnel.head.length) client.write(tunnel.head);
      client.end();
    } else tunnel.socket.pipe(client);
  });
  const originalListen = server.listen;
  server.listen = function (...args) {
    const bindHost = typeof args[0] === 'object' ? args[0]?.host : args[1];
    if (bindHost !== '127.0.0.1' || (typeof args[0] === 'object'
      && (args[0]?.fd !== undefined || args[0]?.path !== undefined))) {
      throw new Error('loopback bind required');
    }
    return originalListen.apply(this, args);
  };
  server.getStats = () => ({ healthy: server.listening, ...counts });
  return server;
}

export function configurationFromEnv(env) {
  const portText = env.HARA_RUNNER_ROUTE_PORT;
  if (!/^[1-9][0-9]{0,4}$/.test(portText ?? '') || Number(portText) > 65535) {
    throw new Error('invalid local port');
  }
  const primaryProxy = env.HARA_GITHUB_RELEASE_PROXY;
  const fallbackProxy = env.HARA_GITHUB_RELEASE_FALLBACK_PROXY;
  const appleFlag = env.HARA_RUNNER_ROUTE_APPLE_NOTARY;
  if (appleFlag !== undefined && appleFlag !== 'true' && appleFlag !== 'false') {
    throw new Error('invalid Apple notarization route flag');
  }
  const dispatchFlag = env.HARA_RUNNER_ROUTE_ACTIONS_DISPATCH;
  if (dispatchFlag !== undefined && dispatchFlag !== 'true' && dispatchFlag !== 'false') {
    throw new Error('invalid Actions dispatch route flag');
  }
  parseUpstream(primaryProxy);
  if (fallbackProxy) parseUpstream(fallbackProxy);
  return { port: Number(portText), primaryProxy, fallbackProxy, appleNotaryRoute: appleFlag === 'true',
    actionsDispatchRoute: dispatchFlag === 'true' };
}

function main() {
  try {
    const { port, ...configuration } = configurationFromEnv(process.env);
    const server = createServer(configuration);
    server.on('error', () => { console.error('runner route service unavailable'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log('runner route service ready'));
  } catch {
    console.error('runner route service configuration rejected');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
