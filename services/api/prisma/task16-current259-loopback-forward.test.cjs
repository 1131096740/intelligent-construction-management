'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { once, EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');

const CONTAINER = '3'.repeat(64);
const SOURCE = fs.readFileSync(path.join(__dirname, 'task16-current259-loopback-forward.cjs'), 'utf8');
const fixedArgs = ['--host', 'unix:///Users/leoyang/.docker/run/docker.sock', 'exec', '--interactive', '--user', 'postgres',
  CONTAINER, '/usr/bin/env', '-i', '/usr/bin/perl', '-T', '-e'];
const payload = Buffer.from(Array.from({ length: 72051 }, (_, i) => (i * 53) & 255));
const reply = Buffer.from([0, 255, 1, 0, 0, 0, 0, 97, 98, 99]);

function load(t, handler) {
  const root = fs.mkdtempSync('/private/tmp/jg-loopback-model-');
  const dockerConfig = path.join(root, 'tls-private', 'docker-config');
  fs.mkdirSync(dockerConfig, { mode: 0o700, recursive: true });
  fs.writeFileSync(path.join(dockerConfig, 'config.json'), '{"auths":{}}\n', { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const holder = { exports: {} }, calls = [];
  const original = request => request === 'node:child_process' ? { spawn(file, argv, options) {
    assert.equal(file, '/Applications/Docker.app/Contents/Resources/bin/docker');
    assert.deepEqual(argv.slice(0, -1), fixedArgs);
    assert.deepEqual(options, {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', DOCKER_CONFIG: dockerConfig },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    assert.match(argv.at(-1), /PeerAddr => '127\.0\.0\.1', PeerPort => 5432/u);
    calls.push(argv);
    return handler(argv.at(-1));
  } } : require(request);
  new Function('require', 'module', SOURCE)(original, holder);
  const controller = new AbortController();
  const start = options => holder.exports.startCurrent259LoopbackForward(options ?? { containerId: CONTAINER, dockerConfig, signal: controller.signal });
  return { start, dockerConfig, controller, calls };
}

async function listener(t, accept) {
  const server = net.createServer({ allowHalfOpen: true }, accept);
  const peers = new Set();
  server.on('connection', peer => {
    peers.add(peer);
    peer.once('close', () => peers.delete(peer));
  });
  server.listen({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(async () => {
    for (const peer of peers) peer.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}

async function connect(port) {
  const socket = net.createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
  await once(socket, 'connect');
  return socket;
}

function fakeWorker() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.stdout.end();
    child.stderr.end();
    queueMicrotask(() => child.emit('close', null));
    return true;
  };
  return child;
}

for (const pgClosesFirst of [false, true]) {
  test('real local Perl model preserves bytes and half-close order, pg first = ' + pgClosesFirst, { timeout: 5000 }, async t => {
    let resolveReceived;
    const received = new Promise(resolve => { resolveReceived = resolve; });
    const pgPort = await listener(t, peer => {
      const chunks = [];
      peer.on('data', chunk => chunks.push(chunk));
      peer.on('end', () => {
        resolveReceived(Buffer.concat(chunks));
        if (!pgClosesFirst) peer.end(reply);
      });
      if (pgClosesFirst) peer.end(reply);
    });
    const fixture = load(t, pump => {
      // Only the test adapter relocates the fixed destination to an ephemeral
      // synthetic peer. The production argv above is checked before replacing it.
      const relocated = pump.replace('PeerPort => 5432,', 'PeerPort => ' + pgPort + ',');
      return spawn('/usr/bin/perl', ['-T', '-e', relocated], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    });
    const relay = await fixture.start();
    t.after(() => relay.close());
    const client = await connect(relay.port);
    t.after(() => client.destroy());
    const chunks = [];
    client.on('data', chunk => chunks.push(chunk));
    const fin = once(client, 'end');
    const closed = once(client, 'close');
    if (!pgClosesFirst) client.end(payload);
    await fin;
    assert.deepEqual(Buffer.concat(chunks), reply);
    if (pgClosesFirst) client.end(payload);
    assert.deepEqual(await received, payload);
    await closed;
    relay.check();
    assert.equal(fixture.calls.length, 1);
    const closing = relay.close();
    assert.equal(relay.close(), closing);
    await closing;
    await assert.rejects(connect(relay.port), { code: 'ECONNREFUSED' });
  });
}

test('malformed frames fail closed and the first fault survives later abort', { timeout: 5000 }, async t => {
  const child = fakeWorker();
  const fixture = load(t, () => child);
  const relay = await fixture.start();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  const finished = once(client, 'end');
  client.resume();
  child.stdout.write(Buffer.from([0, 0, 128, 1]));
  await finished;
  client.destroy();
  fixture.controller.abort();
  assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_FRAME' });
  await relay.close();
});

test('connection cap closes the listener and never spawns a ninth worker', { timeout: 5000 }, async t => {
  let notify, started = 0;
  const full = new Promise(resolve => { notify = resolve; });
  const fixture = load(t, () => {
    if (++started === 8) notify();
    return fakeWorker();
  });
  const relay = await fixture.start();
  t.after(() => relay.close());
  const clients = [];
  t.after(() => clients.forEach(client => client.destroy()));
  for (let i = 0; i < 8; i++) clients.push(await connect(relay.port));
  await full;
  assert.equal(fixture.calls.length, 8);
  const ninth = net.createConnection({ host: '127.0.0.1', port: relay.port });
  ninth.resume();
  await once(ninth, 'close');
  assert.equal(fixture.calls.length, 8);
  assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_LIMIT' });
  await relay.close();
});

test('refuses foreign input and a changed owned CLI configuration', { timeout: 5000 }, async t => {
  const fixture = load(t, () => assert.fail('must not spawn'));
  await assert.rejects(fixture.start({ containerId: CONTAINER, dockerConfig: fixture.dockerConfig,
    signal: fixture.controller.signal, port: 5432 }), { code: 'CURRENT259_LOOPBACK_FORWARD_INPUT' });
  const relay = await fixture.start();
  t.after(() => relay.close());
  fs.writeFileSync(path.join(fixture.dockerConfig, 'config.json'), '{"auths":{},"evil":1}\n');
  const client = net.createConnection({ host: '127.0.0.1', port: relay.port });
  client.resume();
  await once(client, 'close');
  assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_CONFIG' });
  await relay.close();
});

test('a health check closes an active worker on CLI configuration drift', { timeout: 5000 }, async t => {
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  const fixture = load(t, () => { notify(); return fakeWorker(); });
  const relay = await fixture.start();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  await started;
  const finished = once(client, 'end');
  client.resume();
  fs.writeFileSync(path.join(fixture.dockerConfig, 'config.json'), '{}\n');
  assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_CONFIG' });
  await finished;
  client.destroy();
  await relay.close();
  await assert.rejects(connect(relay.port), { code: 'ECONNREFUSED' });
});

test('abort closes an active worker and rejects later connections', { timeout: 5000 }, async t => {
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  const fixture = load(t, () => {
    notify();
    return fakeWorker();
  });
  const relay = await fixture.start();
  const client = await connect(relay.port);
  await started;
  const finished = once(client, 'end');
  client.resume();
  fixture.controller.abort();
  await finished;
  client.destroy();
  await relay.close();
  assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_ABORTED' });
  await assert.rejects(connect(relay.port), { code: 'ECONNREFUSED' });
});

test('a worker failure records a fixed class without retaining stderr or overriding it on abort', { timeout: 5000 }, async t => {
  const child = fakeWorker();
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  const fixture = load(t, () => { notify(); return child; });
  const relay = await fixture.start();
  const client = await connect(relay.port);
  await started;
  const finished = once(client, 'end');
  client.resume();
  child.stderr.write('private output from the fake executable');
  child.emit('close', 41);
  child.stdout.end();
  child.stderr.end();
  await finished;
  client.destroy();
  fixture.controller.abort();
  assert.throws(() => relay.check(), error => error.code === 'CURRENT259_LOOPBACK_FORWARD_CHILD' &&
    !JSON.stringify(error).includes('private output'));
  await relay.close();
});

for (const confirmsExit of [true, false]) {
  test('cleanup escalates and requires a confirmed worker close: ' + confirmsExit, { timeout: 5000 }, async t => {
    const child = fakeWorker(), signals = [];
    let notify;
    const started = new Promise(resolve => { notify = resolve; });
    child.kill = signal => {
      signals.push(signal);
      if (confirmsExit && signal === 'SIGKILL') {
        child.stdout.end();
        child.stderr.end();
        queueMicrotask(() => child.emit('close', null));
      }
      return true;
    };
    const fixture = load(t, () => { notify(); return child; });
    const relay = await fixture.start();
    const client = await connect(relay.port);
    await started;
    const closing = relay.close();
    client.destroy();
    if (confirmsExit) await closing;
    else {
      await assert.rejects(closing, { code: 'CURRENT259_LOOPBACK_FORWARD_CLEANUP' });
      child.stdout.end();
      child.stderr.end();
      child.emit('close', null);
    }
    assert.equal(relay.close(), closing);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    await assert.rejects(connect(relay.port), { code: 'ECONNREFUSED' });
  });
}

test('a real TLS handshake and SAN rejection cross the local Perl relay without ending its lifetime', { timeout: 10000 }, async t => {
  const tls = require('node:tls'), { execFileSync } = require('node:child_process');
  const directory = fs.mkdtempSync('/private/tmp/jg-loopback-tls-model-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'openssl.cnf'), key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem');
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ext\n[dn]\nCN=isolated-test\n[ext]\nsubjectAltName=IP:127.0.0.1\n');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const ca = fs.readFileSync(cert);
  const server = tls.createServer({ key: fs.readFileSync(key), cert: ca }, peer => {
    peer.on('error', () => {});
    peer.once('data', data => peer.end(data));
  });
  server.on('tlsClientError', () => {});
  server.listen({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const fixture = load(t, pump => {
    const relocated = pump.replace('PeerPort => 5432,', 'PeerPort => ' + server.address().port + ',');
    return spawn('/usr/bin/perl', ['-T', '-e', relocated], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
  });
  const relay = await fixture.start();
  t.after(() => relay.close());
  const open = expectedIp => tls.connect({ host: '127.0.0.1', port: relay.port, ca, rejectUnauthorized: true,
    checkServerIdentity: (_, presented) => tls.checkServerIdentity(expectedIp, presented) });
  const wrong = open('127.0.0.2');
  t.after(() => wrong.destroy());
  const [rejection] = await once(wrong, 'error');
  assert.equal(rejection.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  relay.check();
  const client = open('127.0.0.1');
  t.after(() => client.destroy());
  await once(client, 'secureConnect');
  assert.equal(client.authorized, true);
  client.write(reply);
  const [received] = await once(client, 'data');
  assert.deepEqual(received, reply);
  await once(client, 'close');
  relay.check();
  await relay.close();
});

test('one local TCP reset drains the exact Perl worker and leaves a later connection usable', { timeout: 10000 }, async t => {
  let observeFin;
  const observedFin = new Promise(resolve => { observeFin = resolve; });
  const pgPort = await listener(t, peer => {
    peer.once('data', data => peer.write(data));
    peer.once('end', () => { observeFin(); peer.end(); });
  });
  const exits = [];
  const fixture = load(t, pump => {
    const relocated = pump.replace('PeerPort => 5432,', 'PeerPort => ' + pgPort + ',');
    const child = spawn('/usr/bin/perl', ['-T', '-e', relocated], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    exits.push(once(child, 'close'));
    return child;
  });
  const relay = await fixture.start();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  const clientClosed = once(client, 'close');
  client.write(reply);
  assert.deepEqual((await once(client, 'data'))[0], reply);
  client.resetAndDestroy();
  await clientClosed;
  await observedFin;
  assert.deepEqual(await exits[0], [0, null]);
  relay.check();

  const later = await connect(relay.port);
  t.after(() => later.destroy());
  later.end(reply);
  assert.deepEqual((await once(later, 'data'))[0], reply);
  await once(later, 'close');
  assert.deepEqual(await exits[1], [0, null]);
  relay.check();
});

for (const faultAfterReset of ['FRAME', 'CHILD']) {
  test('a retiring peer does not hide a later ' + faultAfterReset + ' failure', { timeout: 5000 }, async t => {
    const child = fakeWorker();
    let observeStart;
    const started = new Promise(resolve => { observeStart = resolve; });
    const fixture = load(t, () => { observeStart(); return child; });
    const relay = await fixture.start();
    t.after(() => relay.close());
    const client = await connect(relay.port);
    t.after(() => client.destroy());
    await started;
    const input = once(child.stdin, 'data');
    const clientClosed = once(client, 'close');
    client.resetAndDestroy();
    await clientClosed;
    assert.deepEqual((await input)[0], Buffer.alloc(4));
    relay.check();

    if (faultAfterReset === 'FRAME') {
      const invalidFrame = Buffer.alloc(4);
      invalidFrame.writeUInt32BE(32769);
      child.stdout.write(invalidFrame);
    } else {
      child.emit('close', 41);
      child.stdout.end();
      child.stderr.end();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_' + faultAfterReset });
    await relay.close();
    await assert.rejects(connect(relay.port), { code: 'ECONNREFUSED' });
  });
}
