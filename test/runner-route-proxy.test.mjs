import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { configurationFromEnv, createServer, parseAuthority, parseUpstream, routeDecision } from '../scripts/runner-route-proxy.mjs';

const fixtureProxy = 'http://127.0.0.1:12345';
const dispatchHost = 'run-actions-2-azure-eastus.actions.githubusercontent.com';
const pipelineHost = 'pipelinesghubeus7.actions.githubusercontent.com';
const tlsBytes = Buffer.from([0x16, 0x03, 0x01, 0x00, 0xff, 0x80, 0x00, 0x7f]);
const serverBytes = Buffer.from([0x16, 0x03, 0x03, 0x00, 0xfe, 0x00]);

async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

function echoAfterEnd(socket, initial = Buffer.alloc(0)) {
  const chunks = [initial];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('end', () => socket.end(Buffer.concat(chunks)));
}

async function httpProxy(t, { status = 200, split = false, prefix = Buffer.alloc(0),
  hang = false, dropAfterSuccess = false, slow = false } = {}) {
  const requests = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      socket.removeListener('data', onData);
      requests.push(buffer.subarray(0, headerEnd + 4).toString('latin1'));
      if (hang) return;
      if (status !== 200) { socket.end(`HTTP/1.1 ${status} Unavailable\r\n\r\n`); return; }
      echoAfterEnd(socket, buffer.subarray(headerEnd + 4));
      if (slow) {
        socket.pause();
        setTimeout(() => socket.resume(), 20);
      }
      const response = Buffer.concat([Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'), prefix]);
      if (split) {
        socket.write(response.subarray(0, 9));
        setImmediate(() => socket.write(response.subarray(9)));
      } else socket.write(response);
      if (dropAfterSuccess) setTimeout(() => socket.destroy(), 10);
    };
    socket.on('data', onData);
  });
  const port = await listen(t, server);
  return { url: `http://127.0.0.1:${port}`, port, requests };
}

async function socksProxy(t, { replyType = 1, prefix = Buffer.alloc(0), method = 0 } = {}) {
  const requests = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let buffer = Buffer.alloc(0);
    let phase = 'greeting';
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (phase === 'greeting' && buffer.length >= 3) {
        assert.deepEqual(buffer.subarray(0, 3), Buffer.from([5, 1, 0]));
        buffer = buffer.subarray(3);
        phase = 'request';
        socket.write(Buffer.from([5]));
        setImmediate(() => socket.write(Buffer.from([method])));
      }
      if (phase !== 'request' || buffer.length < 5) return;
      const size = 7 + buffer[4];
      if (buffer.length < size) return;
      assert.deepEqual(buffer.subarray(0, 4), Buffer.from([5, 1, 0, 3]));
      requests.push({ hostname: buffer.subarray(5, size - 2).toString('ascii'),
        port: buffer.readUInt16BE(size - 2) });
      socket.removeListener('data', onData);
      echoAfterEnd(socket, buffer.subarray(size));
      const address = replyType === 1 ? Buffer.from([127, 0, 0, 1, 0, 1])
        : replyType === 4 ? Buffer.alloc(18) : Buffer.from([3, 97, 98, 99, 0, 1]);
      const reply = Buffer.concat([Buffer.from([5, 0, 0, replyType]), address, prefix]);
      socket.write(reply.subarray(0, 2));
      setImmediate(() => socket.write(reply.subarray(2)));
    };
    socket.on('data', onData);
  });
  const port = await listen(t, server);
  return { url: `socks5h://127.0.0.1:${port}`, port, requests };
}

async function rawClient(t, port) {
  const socket = net.createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  const chunks = [];
  let headerResolve;
  let headerReject;
  const header = new Promise((resolve, reject) => { headerResolve = resolve; headerReject = reject; });
  // Rejections are observed even when a test expects failure before the header.
  header.catch(() => {});
  const complete = new Promise((resolve, reject) => {
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const end = buffer.indexOf('\r\n\r\n');
      if (end !== -1) headerResolve(buffer.subarray(0, end + 4).toString('latin1'));
    });
    socket.once('end', () => {
      const buffer = Buffer.concat(chunks);
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) headerReject(new Error('missing response'));
      resolve({ header: buffer.subarray(0, end + 4).toString('latin1'), body: buffer.subarray(end + 4) });
    });
    socket.once('error', (error) => { headerReject(error); reject(error); });
  });
  complete.catch(() => {});
  return { socket, header, complete };
}

function requestBytes(authority, head = Buffer.alloc(0), headers = '') {
  return Buffer.concat([Buffer.from(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${headers}\r\n`), head]);
}

async function roundTrip(t, port, authority, { initial = Buffer.alloc(0), payload = tlsBytes,
  headers = '', split = false, idleMs = 0 } = {}) {
  const client = await rawClient(t, port);
  const bytes = requestBytes(authority, initial, headers);
  if (split) {
    client.socket.write(bytes.subarray(0, 7));
    await new Promise((resolve) => setImmediate(resolve));
    client.socket.write(bytes.subarray(7));
  } else client.socket.write(bytes);
  const response = await client.header;
  assert.match(response, /^HTTP\/1\.1 200 /);
  if (idleMs) await new Promise((resolve) => setTimeout(resolve, idleMs));
  client.socket.end(payload);
  return client.complete;
}

test('authority parser allows only unambiguous 443 CONNECT targets', () => {
  assert.deepEqual(parseAuthority('API.GITHUB.COM:443'), {
    host: 'api.github.com', port: 443, authority: 'api.github.com:443',
  });
  assert.equal(parseAuthority('[2001:db8::1]:443').host, '2001:db8::1');
  assert.equal(parseAuthority('192.0.2.1:443').host, '192.0.2.1');
  for (const value of [undefined, '', 'api.github.com', 'api.github.com:80', 'api.github.com:0443',
    'api.github.com:443/path', 'api.github.com:443?token=x', 'api.github.com:443#x',
    'user@api.github.com:443', 'https://api.github.com:443', '.:443',
    'api..github.com:443', '-api.github.com:443', 'api-.github.com:443',
    'api.github.com:443\r\nX: value', 'api.github.com:443\0', ' api.github.com:443',
    'api.github.com:443 ', 'api.github.com:443\t', 'api%2egithub.com:443',
    'аpi.github.com:443', '[not-an-ip]:443', '2001:db8::1:443', '[::1]:444',
    `${'a'.repeat(64)}.github.com:443`]) {
    assert.throws(() => parseAuthority(value), /invalid CONNECT authority/);
  }
});

test('exact two-host allowlist leaves Azure, Apple, other GitHub hosts, and lookalikes direct', () => {
  for (const host of ['api.github.com', 'broker.actions.githubusercontent.com', 'API.GITHUB.COM']) {
    assert.equal(routeDecision(`${host}:443`).route, 'upstream');
  }
  for (const host of ['github.com', 'objects.githubusercontent.com', 'results-receiver.actions.githubusercontent.com',
    'example.blob.core.windows.net', 'example.vsblob.vsassets.io', 'apple.com', 'api.apple.com',
    'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com',
    dispatchHost, pipelineHost,
    'api.github.com.example.net', 'notapi.github.com', 'broker.actions.githubusercontent.com.example.net',
    'broker-actions.githubusercontent.com', 'api.github.com.', 'unknown.example', '[::1]']) {
    assert.equal(routeDecision(`${host}:443`).route, 'direct');
  }
});

test('Apple notarization opt-in routes exactly two added hosts and leaves regional S3, Apple and suffixes direct', () => {
  const enabled = { appleNotaryRoute: true };
  for (const host of ['api.github.com', 'broker.actions.githubusercontent.com',
    'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com']) {
    assert.equal(routeDecision(`${host}:443`, enabled).route, 'upstream');
  }
  for (const host of ['notary-submissions-prod.s3.us-west-2.amazonaws.com',
    'notary-submissions-prod.s3.amazonaws.com', 'apple.com', 'api.apple.com', 'developer.apple.com',
    'foo.appstoreconnect.apple.com', 'appstoreconnect.apple.com.example.net', 'appstoreconnect.apple.com.',
    'notary-submissions-prod.s3-accelerate.amazonaws.com.example.net',
    'other-bucket.s3-accelerate.amazonaws.com', 'example.blob.core.windows.net']) {
    assert.equal(routeDecision(`${host}:443`, enabled).route, 'direct');
  }
  assert.throws(() => routeDecision('appstoreconnect.apple.com:443', { appleNotaryRoute: 'true' }),
    /invalid Apple notarization route flag/);
  assert.throws(() => createServer({ primaryProxy: fixtureProxy, appleNotaryRoute: 'false' }),
    /invalid Apple notarization route flag/);
});

test('independent pipeline, dispatch and Apple flag matrix preserves exact hosts, suffixes and port boundaries', () => {
  for (const appleNotaryRoute of [false, true]) {
    for (const actionsDispatchRoute of [false, true]) {
      for (const actionsPipelineRoute of [false, true]) {
        const options = { appleNotaryRoute, actionsDispatchRoute, actionsPipelineRoute };
        for (const host of ['api.github.com', 'broker.actions.githubusercontent.com']) {
          assert.equal(routeDecision(`${host}:443`, options).route, 'upstream');
        }
        for (const host of [dispatchHost, dispatchHost.toUpperCase()]) {
          assert.equal(routeDecision(`${host}:443`, options).route, actionsDispatchRoute ? 'upstream' : 'direct');
        }
        for (const host of [pipelineHost, pipelineHost.toUpperCase()]) {
          assert.equal(parseAuthority(`${host}:443`).host, pipelineHost);
          assert.equal(routeDecision(`${host}:443`, options).route, actionsPipelineRoute ? 'upstream' : 'direct');
        }
        for (const host of ['appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com']) {
          assert.equal(routeDecision(`${host}:443`, options).route, appleNotaryRoute ? 'upstream' : 'direct');
        }
        for (const host of ['run-actions-2-azure-westus.actions.githubusercontent.com',
          'run-actions-3-azure-eastus.actions.githubusercontent.com', 'actions.githubusercontent.com',
          'results-receiver.actions.githubusercontent.com', `foo.${dispatchHost}`, `${dispatchHost}.example.net`,
          `${dispatchHost}.`, 'pipelinesghubeus6.actions.githubusercontent.com', 'pipelinesghubeus8.actions.githubusercontent.com',
          `foo.${pipelineHost}`, `${pipelineHost}.example.net`, `${pipelineHost}.`,
          'pipelinesghubeus7-actions.githubusercontent.com', 'notary-submissions-prod.s3.us-west-2.amazonaws.com', 'developer.apple.com']) {
          assert.equal(routeDecision(`${host}:443`, options).route, 'direct');
        }
        for (const authority of [`${dispatchHost}:80`, `${dispatchHost}:444`, `${dispatchHost}:0443`,
          `user@${dispatchHost}:443`, `${dispatchHost}:443/path`, `${dispatchHost}:443\r\nX: spoof`,
          `${pipelineHost}:80`, `${pipelineHost}:444`, `${pipelineHost}:0443`, `user@${pipelineHost}:443`,
          `${pipelineHost}:443/path`, `${pipelineHost}:443?token=x`, `${pipelineHost}:443#x`,
          `${pipelineHost}:443\r\nX: spoof`, `${pipelineHost}:443\0`, `${pipelineHost}:443 `]) {
          assert.throws(() => parseAuthority(authority), /invalid CONNECT authority/);
          assert.throws(() => routeDecision(authority, options), /invalid CONNECT authority/);
        }
      }
    }
  }
  assert.throws(() => routeDecision(`${dispatchHost}:443`, { actionsDispatchRoute: 'true' }),
    /invalid Actions dispatch route flag/);
  assert.throws(() => createServer({ primaryProxy: fixtureProxy, actionsDispatchRoute: 'false' }),
    /invalid Actions dispatch route flag/);
});

test('pipeline option is strictly boolean, defaults off and never enables other optional hosts', () => {
  for (const options of [undefined, {}, { actionsPipelineRoute: undefined }, { actionsPipelineRoute: false }]) {
    assert.equal(routeDecision(`${pipelineHost}:443`, options).route, 'direct');
  }
  const enabled = { actionsPipelineRoute: true };
  assert.equal(routeDecision(`${pipelineHost}:443`, enabled).route, 'upstream');
  for (const host of [dispatchHost, 'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com']) {
    assert.equal(routeDecision(`${host}:443`, enabled).route, 'direct');
  }
  for (const value of ['true', 'false', '', 'TRUE', 1, 0, null, {}, []]) {
    assert.throws(() => routeDecision(`${pipelineHost}:443`, { actionsPipelineRoute: value }),
      /^Error: invalid Actions pipeline route flag$/);
    assert.throws(() => createServer({ primaryProxy: fixtureProxy, actionsPipelineRoute: value }),
      /^Error: invalid Actions pipeline route flag$/);
  }
});

test('upstreams accept only explicit unauthenticated literal-loopback HTTP or SOCKS ports', () => {
  for (const protocol of ['http', 'socks5', 'socks5h']) {
    assert.equal(parseUpstream(`${protocol}://127.0.0.1:8080`).port, 8080);
  }
  for (const value of [undefined, '', 'https://127.0.0.1:8080', 'http://localhost:8080',
    'http://127.0.0.2:8080', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
    'http://127.0.0.1:08080', 'http://127.0.0.1:8080/path', 'http://127.0.0.1:8080?token=secret',
    'http://127.0.0.1:8080#secret', 'http://user:secret@127.0.0.1:8080', 'http://@127.0.0.1:8080',
    'http://2130706433:8080', 'http://127.0.0.1:8080\n']) {
    assert.throws(() => parseUpstream(value), /^Error: invalid loopback upstream$/);
  }
  assert.throws(() => createServer({ primaryProxy: fixtureProxy, handshakeTimeoutMs: 12001 }));
  assert.throws(() => createServer({ primaryProxy: fixtureProxy }).listen(0, '0.0.0.0'), /loopback bind required/);
});

test('CLI environment reads the canonical release fallback variable without a misspelled alias', () => {
  const env = {
    HARA_RUNNER_ROUTE_PORT: '18080',
    HARA_GITHUB_RELEASE_PROXY: 'http://127.0.0.1:18081',
    HARA_GITHUB_RELEASE_FALLBACK_PROXY: 'socks5h://127.0.0.1:18082',
    HARA_GITHUB_RELEASE_PROXY_FALLBACK: 'http://127.0.0.1:18083',
    HTTPS_PROXY: 'http://unused.example:8080',
  };
  assert.deepEqual(configurationFromEnv(env), {
    port: 18080,
    primaryProxy: 'http://127.0.0.1:18081',
    fallbackProxy: 'socks5h://127.0.0.1:18082',
    appleNotaryRoute: false,
    actionsDispatchRoute: false,
    actionsPipelineRoute: false,
  });
  assert.equal(configurationFromEnv({ ...env, HARA_GITHUB_RELEASE_FALLBACK_PROXY: undefined }).fallbackProxy, undefined);
  assert.throws(() => configurationFromEnv({ ...env, HARA_GITHUB_RELEASE_FALLBACK_PROXY: 'http://user:secret@127.0.0.1:18082' }),
    /^Error: invalid loopback upstream$/);
  assert.throws(() => configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_PORT: '0' }), /invalid local port/);
  assert.throws(() => configurationFromEnv({ ...env, HARA_GITHUB_RELEASE_PROXY: undefined }), /invalid loopback upstream/);
});

test('CLI Apple routing opt-in requires literal true or false and defaults to false', () => {
  const env = { HARA_RUNNER_ROUTE_PORT: '18080', HARA_GITHUB_RELEASE_PROXY: fixtureProxy };
  assert.equal(configurationFromEnv(env).appleNotaryRoute, false);
  assert.equal(configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_APPLE_NOTARY: 'false' }).appleNotaryRoute, false);
  assert.equal(configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_APPLE_NOTARY: 'true' }).appleNotaryRoute, true);
  for (const flag of ['', 'TRUE', 'False', '1', '0', 'yes', 'true ', ' false', null, true, false]) {
    assert.throws(() => configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_APPLE_NOTARY: flag }),
      /^Error: invalid Apple notarization route flag$/);
  }
});

test('CLI Actions routing opt-in is strict, default-off and independent of the Apple environment flag', () => {
  const env = { HARA_RUNNER_ROUTE_PORT: '18080', HARA_GITHUB_RELEASE_PROXY: fixtureProxy };
  assert.equal(configurationFromEnv(env).actionsDispatchRoute, false);
  for (const appleFlag of [undefined, 'false', 'true']) {
    for (const dispatchFlag of [undefined, 'false', 'true']) {
      const config = configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_APPLE_NOTARY: appleFlag,
        HARA_RUNNER_ROUTE_ACTIONS_DISPATCH: dispatchFlag });
      assert.equal(config.actionsDispatchRoute, dispatchFlag === 'true');
      assert.equal(config.appleNotaryRoute, appleFlag === 'true');
    }
  }
  for (const flag of ['', 'TRUE', 'False', '1', '0', 'yes', 'true ', ' false', null, true, false]) {
    assert.throws(() => configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_ACTIONS_DISPATCH: flag }),
      /^Error: invalid Actions dispatch route flag$/);
  }
  assert.throws(() => configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_ACTIONS_DISPATCH: 'true',
    HARA_RUNNER_ROUTE_APPLE_NOTARY: 'TRUE' }), /invalid Apple notarization route flag/);
});

test('CLI pipeline flag is strictly literal true/false, default-off and independent of both other flags', () => {
  const env = { HARA_RUNNER_ROUTE_PORT: '18080', HARA_GITHUB_RELEASE_PROXY: fixtureProxy };
  assert.equal(configurationFromEnv(env).actionsPipelineRoute, false);
  for (const appleFlag of [undefined, 'false', 'true']) {
    for (const dispatchFlag of [undefined, 'false', 'true']) {
      for (const pipelineFlag of [undefined, 'false', 'true']) {
        const config = configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_APPLE_NOTARY: appleFlag,
          HARA_RUNNER_ROUTE_ACTIONS_DISPATCH: dispatchFlag, HARA_RUNNER_ROUTE_ACTIONS_PIPELINE: pipelineFlag });
        assert.equal(config.appleNotaryRoute, appleFlag === 'true');
        assert.equal(config.actionsDispatchRoute, dispatchFlag === 'true');
        assert.equal(config.actionsPipelineRoute, pipelineFlag === 'true');
      }
    }
  }
  for (const flag of ['', 'TRUE', 'False', '1', '0', 'yes', 'true ', ' false', null, true, false]) {
    assert.throws(() => configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_ACTIONS_PIPELINE: flag }),
      /^Error: invalid Actions pipeline route flag$/);
  }
  for (const wrongOtherFlag of [{ HARA_RUNNER_ROUTE_APPLE_NOTARY: 'TRUE' }, { HARA_RUNNER_ROUTE_ACTIONS_DISPATCH: 'TRUE' }]) {
    assert.throws(() => configurationFromEnv({ ...env, HARA_RUNNER_ROUTE_ACTIONS_PIPELINE: 'true', ...wrongOtherFlag }),
      /invalid (Apple notarization|Actions dispatch) route flag/);
  }
});

test('real env-to-server flag combinations route only opted-in hosts with synthesized upstream headers', { timeout: 5000 }, async (t) => {
  const upstream = await httpProxy(t);
  const endpoint = net.createServer({ allowHalfOpen: true }, (socket) => echoAfterEnd(socket));
  const endpointPort = await listen(t, endpoint);
  const optionalHosts = [dispatchHost, pipelineHost, 'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com'];
  for (const appleFlag of ['false', 'true']) {
    for (const dispatchFlag of ['false', 'true']) {
      for (const pipelineFlag of ['false', 'true']) {
        const directHosts = [];
        const { port: ignoredPort, ...config } = configurationFromEnv({
          HARA_RUNNER_ROUTE_PORT: '18080', HARA_GITHUB_RELEASE_PROXY: upstream.url,
          HARA_RUNNER_ROUTE_APPLE_NOTARY: appleFlag, HARA_RUNNER_ROUTE_ACTIONS_DISPATCH: dispatchFlag,
          HARA_RUNNER_ROUTE_ACTIONS_PIPELINE: pipelineFlag,
        });
        const server = createServer({ ...config, dialDirect: async ({ host, port }) => {
          directHosts.push({ host, port });
          const socket = net.createConnection({ host: '127.0.0.1', port: endpointPort, allowHalfOpen: true });
          await once(socket, 'connect');
          return socket;
        } });
        const port = await listen(t, server);
        const upstreamCount = upstream.requests.length;
        const expectedRouted = [];
        const expectedDirect = [];
        for (const host of optionalHosts) {
          const routed = host === dispatchHost ? dispatchFlag === 'true'
            : host === pipelineHost ? pipelineFlag === 'true' : appleFlag === 'true';
          (routed ? expectedRouted : expectedDirect).push(host);
          const response = await roundTrip(t, port, `${host}:443`, {
            initial: tlsBytes, headers: 'Authorization: Bearer private-token\r\nProxy-Authorization: Basic private-password\r\n',
          });
          assert.deepEqual(response.body, Buffer.concat([tlsBytes, tlsBytes]));
        }
        assert.deepEqual(upstream.requests.slice(upstreamCount), expectedRouted.map((host) =>
          `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
        assert.deepEqual(directHosts, expectedDirect.map((host) => ({ host, port: 443 })));
        assert.equal(server.getStats().routed, expectedRouted.length);
        assert.equal(server.getStats().direct, expectedDirect.length);
      }
    }
  }
});

test('pipeline opts into remote-DNS SOCKS without enlarging routes or forwarding client credentials', { timeout: 5000 }, async (t) => {
  const upstream = await socksProxy(t, { replyType: 3, prefix: serverBytes });
  const directHosts = [];
  const endpoint = net.createServer({ allowHalfOpen: true }, (socket) => echoAfterEnd(socket));
  const endpointPort = await listen(t, endpoint);
  const server = createServer({ primaryProxy: upstream.url, actionsPipelineRoute: true,
    dialDirect: async ({ host, port }) => {
      directHosts.push({ host, port });
      const socket = net.createConnection({ host: '127.0.0.1', port: endpointPort, allowHalfOpen: true });
      await once(socket, 'connect');
      return socket;
    } });
  const port = await listen(t, server);
  const response = await roundTrip(t, port, `${pipelineHost}:443`, {
    initial: tlsBytes, headers: 'Authorization: Bearer private-token\r\nProxy-Authorization: Basic private-password\r\n',
  });
  assert.deepEqual(response.body, Buffer.concat([serverBytes, tlsBytes, tlsBytes]));
  assert.deepEqual(upstream.requests, [{ hostname: pipelineHost, port: 443 }]);
  for (const host of [dispatchHost, 'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com',
    'pipelinesghubeus8.actions.githubusercontent.com', `${pipelineHost}.example.net`]) {
    assert.deepEqual((await roundTrip(t, port, `${host}:443`)).body, tlsBytes);
  }
  assert.equal(upstream.requests.length, 1);
  assert.equal(directHosts.length, 5);
});

test('Actions dispatch fallback occurs only before success, never by direct bypass or tunnel replay', { timeout: 5000 }, async (t) => {
  const primary = await httpProxy(t, { status: 502 });
  const fallback = await httpProxy(t, { dropAfterSuccess: true });
  let directCalls = 0;
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url, actionsDispatchRoute: true,
    dialDirect: () => { directCalls++; throw new Error('wrong route'); } });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes(`${dispatchHost}:443`));
  assert.match(await client.header, /^HTTP\/1\.1 200 /);
  await client.complete;
  client.socket.end();
  assert.equal(primary.requests.length, 1);
  assert.equal(fallback.requests.length, 1);
  assert.equal(server.getStats().fallbacks, 1);
  assert.equal(directCalls, 0);
});

test('pipeline handshake fallback preserves opaque bytes and idle tunnels without replay or direct bypass', { timeout: 5000 }, async (t) => {
  const primary = await httpProxy(t, { hang: true });
  const fallback = await httpProxy(t, { split: true, prefix: serverBytes });
  let directCalls = 0;
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url, actionsPipelineRoute: true,
    handshakeTimeoutMs: 35, dialDirect: () => { directCalls++; throw new Error('wrong route'); } });
  const port = await listen(t, server);
  const response = await roundTrip(t, port, `${pipelineHost}:443`, { initial: tlsBytes, split: true, idleMs: 110 });
  assert.deepEqual(response.body, Buffer.concat([serverBytes, tlsBytes, tlsBytes]));
  assert.equal(primary.requests.length, 1);
  assert.equal(fallback.requests.length, 1);
  assert.equal(server.getStats().fallbacks, 1);

  const successfulPrimary = await httpProxy(t, { dropAfterSuccess: true });
  const unusedFallback = await httpProxy(t);
  const secondServer = createServer({ primaryProxy: successfulPrimary.url, fallbackProxy: unusedFallback.url,
    actionsPipelineRoute: true, dialDirect: () => { directCalls++; throw new Error('wrong route'); } });
  const secondPort = await listen(t, secondServer);
  const client = await rawClient(t, secondPort);
  client.socket.write(requestBytes(`${pipelineHost}:443`));
  assert.match(await client.header, /^HTTP\/1\.1 200 /);
  await client.complete;
  client.socket.end();
  assert.equal(successfulPrimary.requests.length, 1);
  assert.equal(unusedFallback.requests.length, 0);
  assert.equal(secondServer.getStats().fallbacks, 0);
  assert.equal(directCalls, 0);
});

test('opted-in Apple hosts use existing upstream without relaying credentials or enlarging other routes', { timeout: 5000 }, async (t) => {
  const upstream = await httpProxy(t);
  const directHosts = [];
  const endpoint = net.createServer({ allowHalfOpen: true }, (socket) => echoAfterEnd(socket));
  const endpointPort = await listen(t, endpoint);
  const server = createServer({ primaryProxy: upstream.url, appleNotaryRoute: true,
    dialDirect: async ({ host, port }) => {
      directHosts.push({ host, port });
      const socket = net.createConnection({ host: '127.0.0.1', port: endpointPort, allowHalfOpen: true });
      await once(socket, 'connect');
      return socket;
    },
  });
  const port = await listen(t, server);
  for (const host of ['appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com']) {
    const response = await roundTrip(t, port, `${host}:443`, {
      initial: tlsBytes, headers: 'Authorization: Bearer private-token\r\nProxy-Authorization: Basic private-password\r\n',
    });
    assert.deepEqual(response.body, Buffer.concat([tlsBytes, tlsBytes]));
    assert.equal(upstream.requests.at(-1), `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
  }
  for (const host of ['notary-submissions-prod.s3.us-west-2.amazonaws.com', 'developer.apple.com',
    'appstoreconnect.apple.com.example.net', 'notary-submissions-prod.s3-accelerate.amazonaws.com.example.net']) {
    const response = await roundTrip(t, port, `${host}:443`);
    assert.deepEqual(response.body, tlsBytes);
  }
  assert.equal(upstream.requests.length, 2);
  assert.deepEqual(directHosts, ['notary-submissions-prod.s3.us-west-2.amazonaws.com', 'developer.apple.com',
    'appstoreconnect.apple.com.example.net', 'notary-submissions-prod.s3-accelerate.amazonaws.com.example.net']
    .map((host) => ({ host, port: 443 })));
  assert.equal(server.getStats().routed, 2);
  assert.equal(server.getStats().direct, 4);
});

test('both allowlisted hosts use HTTP upstream without forwarding any client headers', { timeout: 5000 }, async (t) => {
  const upstream = await httpProxy(t);
  let directCalls = 0;
  const server = createServer({ primaryProxy: upstream.url, dialDirect: () => { directCalls++; throw new Error('wrong route'); } });
  const port = await listen(t, server);
  for (const host of ['api.github.com', 'broker.actions.githubusercontent.com']) {
    const response = await roundTrip(t, port, `${host}:443`, { headers:
      'Authorization: Bearer secret-token\r\nProxy-Authorization: Basic secret-password\r\nX-Private: private-value\r\n' });
    assert.deepEqual(response.body, tlsBytes);
    assert.equal(upstream.requests.at(-1), `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
  }
  assert.equal(directCalls, 0);
  assert.equal(server.getStats().routed, 2);
});

test('direct destinations never contact configured upstream and keep their original host', { timeout: 5000 }, async (t) => {
  const directHosts = [];
  const endpoint = net.createServer({ allowHalfOpen: true }, (socket) => echoAfterEnd(socket));
  const endpointPort = await listen(t, endpoint);
  const server = createServer({ primaryProxy: fixtureProxy,
    dialProxy: () => { throw new Error('unexpected upstream'); },
    dialDirect: async ({ host, port }) => {
      directHosts.push({ host, port });
      const socket = net.createConnection({ host: '127.0.0.1', port: endpointPort, allowHalfOpen: true });
      await once(socket, 'connect');
      return socket;
    },
  });
  const port = await listen(t, server);
  for (const host of ['example.blob.core.windows.net', 'apple.com', 'unknown.example', 'api.github.com.example.net',
    'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com', dispatchHost, pipelineHost]) {
    const response = await roundTrip(t, port, `${host}:443`);
    assert.deepEqual(response.body, tlsBytes);
  }
  assert.deepEqual(directHosts, ['example.blob.core.windows.net', 'apple.com', 'unknown.example', 'api.github.com.example.net',
    'appstoreconnect.apple.com', 'notary-submissions-prod.s3-accelerate.amazonaws.com', dispatchHost, pipelineHost]
    .map((host) => ({ host, port: 443 })));
  assert.equal(server.getStats().direct, 8);
});

test('ordinary HTTP and malformed targets fail before any dial; health contains counters only', { timeout: 5000 }, async (t) => {
  let calls = 0;
  const dial = () => { calls++; throw new Error('unreachable'); };
  const server = createServer({ primaryProxy: fixtureProxy, dialDirect: dial, dialProxy: dial });
  const port = await listen(t, server);
  for (const request of [
    'GET http://api.github.com/ HTTP/1.1\r\nHost: api.github.com\r\n\r\n',
    'POST /healthz HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
    'GET /healthz?token=private HTTP/1.1\r\nHost: localhost\r\n\r\n',
    requestBytes('api.github.com:80'), requestBytes('user@api.github.com:443'),
    requestBytes('api.github.com:443/path'),
    'CONNECT api.github.com:443 HTTP/1.1\r\nX: bad\0header\r\n\r\n',
  ]) {
    const client = await rawClient(t, port);
    client.socket.write(request);
    const response = await client.complete;
    assert.match(response.header, /^HTTP\/1\.1 (400|405) /);
    client.socket.end();
  }
  const health = await rawClient(t, port);
  health.socket.write('GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  const response = await health.complete;
  health.socket.end();
  const data = JSON.parse(response.body.toString());
  assert.deepEqual(Object.keys(data).sort(), ['healthy', 'received', 'direct', 'routed', 'established', 'failed', 'fallbacks', 'active'].sort());
  assert.equal(data.healthy, true);
  assert.doesNotMatch(response.body.toString(), /github|127\.0\.0\.1|private|token/);
  assert.equal(calls, 0);
});

test('non-200 primary falls back only before client success and preserves split-header TLS bytes', { timeout: 5000 }, async (t) => {
  const primary = await httpProxy(t, { status: 502 });
  const fallback = await httpProxy(t, { split: true, prefix: serverBytes });
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url });
  const port = await listen(t, server);
  const response = await roundTrip(t, port, 'api.github.com:443', { initial: tlsBytes, payload: tlsBytes, split: true });
  assert.deepEqual(response.body, Buffer.concat([serverBytes, tlsBytes, tlsBytes]));
  assert.equal(primary.requests.length, 1);
  assert.equal(fallback.requests.length, 1);
  assert.equal(server.getStats().fallbacks, 1);
  assert.equal((response.header.match(/200/g) ?? []).length, 1);
});

test('bounded handshake timeout permits fallback and a silent broker tunnel has no short idle deadline', { timeout: 5000 }, async (t) => {
  const primary = await httpProxy(t, { hang: true });
  const fallback = await httpProxy(t);
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url, handshakeTimeoutMs: 35 });
  const port = await listen(t, server);
  const response = await roundTrip(t, port, 'broker.actions.githubusercontent.com:443', { idleMs: 110 });
  assert.deepEqual(response.body, tlsBytes);
  assert.equal(server.getStats().fallbacks, 1);
});

test('failed upstreams never bypass the allowlist route by dialing the destination directly', { timeout: 5000 }, async (t) => {
  const primary = await httpProxy(t, { status: 407 });
  const fallback = await httpProxy(t, { status: 503 });
  let directCalls = 0;
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url,
    dialDirect: () => { directCalls++; throw new Error('wrong route'); } });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes('api.github.com:443', tlsBytes));
  const response = await client.complete;
  client.socket.end();
  assert.match(response.header, /^HTTP\/1\.1 502 /);
  assert.equal(response.body.length, 0);
  assert.equal(directCalls, 0);
  assert.equal(server.getStats().established, 0);
});

test('successful tunnel failure never triggers fallback or replay', { timeout: 5000 }, async (t) => {
  const primary = await httpProxy(t, { dropAfterSuccess: true });
  const fallback = await httpProxy(t);
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes('api.github.com:443'));
  assert.match(await client.header, /^HTTP\/1\.1 200 /);
  await client.complete;
  client.socket.end();
  assert.equal(fallback.requests.length, 0);
  assert.equal(server.getStats().fallbacks, 0);
});

test('SOCKS5 and SOCKS5h request remote DNS; split binary replies keep TLS bytes for every address type', { timeout: 5000 }, async (t) => {
  for (const replyType of [1, 3, 4]) {
    const upstream = await socksProxy(t, { replyType, prefix: serverBytes });
    const server = createServer({ primaryProxy: replyType === 1 ? upstream.url.replace('socks5h:', 'socks5:') : upstream.url });
    const port = await listen(t, server);
    const response = await roundTrip(t, port, 'broker.actions.githubusercontent.com:443', { initial: tlsBytes });
    assert.deepEqual(response.body, Buffer.concat([serverBytes, tlsBytes, tlsBytes]));
    assert.deepEqual(upstream.requests, [{ hostname: 'broker.actions.githubusercontent.com', port: 443 }]);
  }
});

test('SOCKS authentication challenge fails closed before fallback', { timeout: 5000 }, async (t) => {
  const primary = await socksProxy(t, { method: 2 });
  const fallback = await httpProxy(t);
  const server = createServer({ primaryProxy: primary.url, fallbackProxy: fallback.url });
  const port = await listen(t, server);
  const response = await roundTrip(t, port, 'api.github.com:443');
  assert.deepEqual(response.body, tlsBytes);
  assert.deepEqual(primary.requests, []);
  assert.equal(server.getStats().fallbacks, 1);
});

test('binary payload and client half-close survive slow downstream backpressure', { timeout: 5000 }, async (t) => {
  const upstream = await httpProxy(t, { slow: true });
  const server = createServer({ primaryProxy: upstream.url });
  const port = await listen(t, server);
  const payload = Buffer.allocUnsafe(1024 * 1024);
  for (let index = 0; index < payload.length; index++) payload[index] = index % 256;
  const response = await roundTrip(t, port, 'api.github.com:443', { initial: tlsBytes, payload });
  assert.deepEqual(response.body, Buffer.concat([tlsBytes, payload]));
});

test('oversized upstream handshake is rejected without exposing proxy headers', { timeout: 5000 }, async (t) => {
  const upstream = net.createServer((socket) => socket.once('data', () =>
    socket.end(`HTTP/1.1 200 OK\r\nX-Private: ${'s'.repeat(9000)}\r\n\r\n`)));
  const upstreamPort = await listen(t, upstream);
  const server = createServer({ primaryProxy: `http://127.0.0.1:${upstreamPort}` });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes('api.github.com:443'));
  const response = await client.complete;
  client.socket.end();
  assert.match(response.header, /^HTTP\/1\.1 502 /);
  assert.doesNotMatch(response.header, /X-Private|ssss/);
});

test('client EOF before proxy success retains its initial TLS bytes and the final reply', { timeout: 5000 }, async (t) => {
  const upstream = await httpProxy(t, { split: true, prefix: serverBytes });
  const server = createServer({ primaryProxy: upstream.url });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.end(requestBytes('api.github.com:443', tlsBytes));
  const response = await client.complete;
  assert.match(response.header, /^HTTP\/1\.1 200 /);
  assert.deepEqual(response.body, Buffer.concat([serverBytes, tlsBytes]));
});

test('graceful upstream EOF drains all final bytes while the client is temporarily paused', { timeout: 5000 }, async (t) => {
  const upstream = await httpProxy(t);
  const server = createServer({ primaryProxy: upstream.url });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes('api.github.com:443'));
  await client.header;
  client.socket.pause();
  const payload = Buffer.alloc(8 * 1024 * 1024, 0xa5);
  client.socket.end(payload);
  setTimeout(() => client.socket.resume(), 60);
  const response = await client.complete;
  assert.deepEqual(response.body, payload);
});

test('deadline also bounds a dialer that ignores abort and disposes of a late socket', { timeout: 5000 }, async (t) => {
  const endpoint = net.createServer({ allowHalfOpen: true }, (socket) => echoAfterEnd(socket));
  const endpointPort = await listen(t, endpoint);
  let lateSocket;
  let dialFinished;
  const finished = new Promise((resolve) => { dialFinished = resolve; });
  const server = createServer({ primaryProxy: fixtureProxy, handshakeTimeoutMs: 20,
    dialDirect: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      lateSocket = net.createConnection({ host: '127.0.0.1', port: endpointPort, allowHalfOpen: true });
      await once(lateSocket, 'connect');
      dialFinished();
      return lateSocket;
    },
  });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes('unknown.example:443'));
  const response = await client.complete;
  client.socket.end();
  assert.match(response.header, /^HTTP\/1\.1 502 /);
  await finished;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateSocket.destroyed, true);
});

test('incomplete client headers have a bounded deadline without dialing', { timeout: 5000 }, async (t) => {
  let calls = 0;
  const server = createServer({ primaryProxy: fixtureProxy, handshakeTimeoutMs: 20,
    dialProxy: () => { calls++; throw new Error('unexpected'); } });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write('CONNECT api.github.com:443 HTTP/1.1\r\n');
  const response = await client.complete;
  client.socket.end();
  assert.match(response.header, /^HTTP\/1\.1 408 /);
  assert.equal(calls, 0);
});

test('upstream can half-close immediately after successful handshake and still receive client bytes', { timeout: 5000 }, async (t) => {
  let payloadResolve;
  const received = new Promise((resolve) => { payloadResolve = resolve; });
  const upstream = net.createServer({ allowHalfOpen: true }, (socket) => {
    let headerBuffer = Buffer.alloc(0);
    const chunks = [];
    const parseHeader = (chunk) => {
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const end = headerBuffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.removeListener('data', parseHeader);
      chunks.push(headerBuffer.subarray(end + 4));
      socket.on('data', (bytes) => chunks.push(bytes));
      socket.on('end', () => payloadResolve(Buffer.concat(chunks)));
      socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\n\r\n'), serverBytes]));
    };
    socket.on('data', parseHeader);
  });
  const upstreamPort = await listen(t, upstream);
  const server = createServer({ primaryProxy: `http://127.0.0.1:${upstreamPort}` });
  const port = await listen(t, server);
  const client = await rawClient(t, port);
  client.socket.write(requestBytes('api.github.com:443'));
  const response = await client.complete;
  assert.match(response.header, /^HTTP\/1\.1 200 /);
  assert.deepEqual(response.body, serverBytes);
  client.socket.end(tlsBytes);
  assert.deepEqual(await received, tlsBytes);
});
