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

function load(t, handler, readonlyVerifier) {
  const root = fs.mkdtempSync('/private/tmp/jg-loopback-model-');
  const dockerConfig = path.join(root, 'tls-private', 'docker-config');
  fs.mkdirSync(dockerConfig, { mode: 0o700, recursive: true });
  fs.writeFileSync(path.join(dockerConfig, 'config.json'), '{"auths":{}}\n', { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const holder = { exports: {} }, calls = [], permit = Object.freeze({});
  let permitUsed = false;
  const original = request => request === './enterprise-task01-resources.cjs' && readonlyVerifier ? {
    claimReadonlyRelayBackendVerifier(value, coordinates) {
      if (value !== permit || permitUsed) return undefined;
      assert.deepEqual(coordinates, { containerId: CONTAINER, dockerConfig, signal: controller.signal });
      permitUsed = true;
      return readonlyVerifier;
    },
  } : request === 'node:child_process' ? { spawn(file, argv, options) {
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
  const startReadonly = (token = permit) => holder.exports.startCurrent259LoopbackForward(
    { containerId: CONTAINER, dockerConfig, signal: controller.signal }, token);
  return { start, startReadonly, dockerConfig, controller, calls };
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
  assert.throws(() => relay.check(), { code: 'CURRENT259_LOOPBACK_FORWARD_FRAME', relayFrameStage: 'OVERSIZED_LENGTH' });
  await relay.close();
});

for (const [stage, output] of [
  ['TRAILING_AFTER_FIN', child => child.stdout.write(Buffer.alloc(5))],
  ['DATA_AFTER_FIN', async (child, client) => {
    const ended = once(client, 'end');
    child.stdout.write(Buffer.alloc(4));
    await ended;
    child.stdout.write(Buffer.from([1]));
  }],
  ['STDOUT_EOF_WITHOUT_FIN', child => child.stdout.end()],
]) {
  test('relay retains the first fixed frame guard ' + stage, { timeout: 5000 }, async t => {
    const child = fakeWorker();
    let accepted;
    const ready = new Promise(resolve => { accepted = resolve; });
    const fixture = load(t, () => { accepted(); return child; });
    const relay = await fixture.start(), wait = relay.beginPrismaDrain();
    t.after(() => relay.close());
    const client = await connect(relay.port);
    t.after(() => client.destroy());
    client.resume();
    await ready;
    const failed = assert.rejects(wait(), error => {
      assert.equal(error.code, 'CURRENT259_LOOPBACK_FORWARD_FRAME');
      assert.equal(error.relayFrameStage, stage);
      assert.equal(Object.isFrozen(error.relayCloseState), true);
      assert.equal(error.relayCloseState.stdoutRawEnd, stage === 'STDOUT_EOF_WITHOUT_FIN');
      assert.equal(error.relayCloseState.pgFin, stage === 'DATA_AFTER_FIN');
      return true;
    });
    await output(child, client);
    await failed;
  });
}

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

test('the framed host FIN also ends CLI stdin before an attach adapter releases output', { timeout: 7000 }, async t => {
  const child = fakeWorker(), input = [];
  child.stdin.on('data', chunk => input.push(chunk));
  child.stdin.once('finish', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(reply.length);
    assert.deepEqual(Buffer.concat(input), Buffer.concat([header, reply, Buffer.alloc(4)]));
    child.stdout.end(Buffer.concat([header, reply, Buffer.alloc(4)]));
    child.stderr.end();
    queueMicrotask(() => child.emit('close', 0));
  });
  const fixture = load(t, () => child);
  const relay = await fixture.start();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  const received = once(client, 'data'), closed = once(client, 'close');
  client.end(reply);
  assert.deepEqual((await received)[0], reply);
  await closed;
  relay.check();
});

for (const trailing of [false, true]) {
  test('Perl rejects physical stdin protocol violations before releasing the worker: ' + trailing, { timeout: 5000 }, async t => {
    let observeFin;
    const observedFin = new Promise(resolve => { observeFin = resolve; });
    const pgPort = await listener(t, peer => { peer.on('end', observeFin); peer.resume(); });
    let provideChild;
    const childPromise = new Promise(resolve => { provideChild = resolve; });
    const fixture = load(t, pump => {
      const relocated = pump.replace('PeerPort => 5432,', 'PeerPort => ' + pgPort + ',');
      const child = spawn('/usr/bin/perl', ['-T', '-e', relocated], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
      provideChild(child);
      return child;
    });
    const relay = await fixture.start();
    t.after(() => relay.close());
    const client = await connect(relay.port);
    t.after(() => client.destroy());
    const child = await childPromise, exited = once(child, 'close');
    if (trailing) {
      child.stdin.write(Buffer.alloc(4));
      await observedFin;
      child.stdin.end(Buffer.from([1]));
    } else child.stdin.end();
    assert.deepEqual(await exited, [43, null]);
    await relay.close();
  });
}

test('timeout freezes the exact host, framed output and local CLI closure milestones', { timeout: 9000 }, async t => {
  const child = fakeWorker();
  child.stdin.once('finish', () => { child.stdout.write(Buffer.alloc(4)); });
  const fixture = load(t, () => child);
  const relay = await fixture.start();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  const clientClosed = once(client, 'close');
  client.resume();client.end();
  await clientClosed;
  const deadline = Date.now() + 6500;
  let failure;
  while (!failure && Date.now() < deadline) {
    try { relay.check(); } catch (error) { failure = error; }
    if (!failure) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(failure?.code, 'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT');
  assert.deepEqual(failure.relayCloseState, { hostFin: true, stdinEnded: true, pgFin: true, stdoutEnded: false, cliClosed: false,
    stdoutRawEnd: false, receiveSettled: false, cliExited: false, peerSocketDestroyed: true, peerEndReturned: true });
  assert.equal(Object.isFrozen(failure.relayCloseState), true);
  await relay.close();
  assert.equal(failure.relayCloseState.cliClosed, false);
});

test('one Prisma window waits for its worker local CLI close and excludes an earlier long-lived peer', { timeout: 7000 }, async t => {
  const oldWorker = fakeWorker(), prisma = fakeWorker();
  let oldAccepted, prismaAccepted;
  const oldReady = new Promise(resolve => { oldAccepted = resolve; });
  const prismaReady = new Promise(resolve => { prismaAccepted = resolve; });
  let count = 0;
  const fixture = load(t, () => {
    if (++count === 1) { oldAccepted(); return oldWorker; }
    prismaAccepted();return prisma;
  });
  const relay = await fixture.start();
  t.after(() => relay.close());
  const long = await connect(relay.port);
  t.after(() => long.destroy());
  await oldReady;
  const wait = relay.beginPrismaDrain();
  assert.throws(() => relay.beginPrismaDrain(), { code: 'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_ACTIVE' });
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  await prismaReady;
  let finished = false;
  const drained = wait().then(() => { finished = true; });
  prisma.stdin.once('finish', () => {
    prisma.emit('exit', 0);
    prisma.stdout.end(Buffer.alloc(4));
    prisma.stderr.end();
  });
  const closed = once(client, 'close');
  client.resume();client.end();
  await closed;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(long.destroyed, false);
  prisma.emit('close', 0);
  await drained;
  assert.equal(long.destroyed, false);
  assert.equal(oldWorker.stdin.destroyed, false);
  await assert.rejects(wait(), { code: 'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_ACTIVE' });
  await relay.beginPrismaDrain()();
  relay.check();
});

test('the bounded Prisma wait times out only its unsettled window and projects close milestones', { timeout: 8000 }, async t => {
  const child = fakeWorker();
  let accepted;
  const ready = new Promise(resolve => { accepted = resolve; });
  const fixture = load(t, () => { accepted();return child; });
  const relay = await fixture.start(), wait = relay.beginPrismaDrain();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  await ready;
  await assert.rejects(wait(), error => {
    assert.equal(error.code, 'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT');
    assert.deepEqual(error.relayCloseState, {hostFin:false,stdinEnded:false,pgFin:false,stdoutEnded:false,cliClosed:false,
      stdoutRawEnd:false,receiveSettled:false,cliExited:false,peerSocketDestroyed:false,peerEndReturned:false});
    return true;
  });
  await relay.close();
});

test('a Prisma wait preserves the original malformed frame failure', { timeout: 5000 }, async t => {
  const child = fakeWorker();
  let accepted;
  const ready = new Promise(resolve => { accepted = resolve; });
  const fixture = load(t, () => { accepted();return child; });
  const relay = await fixture.start(), wait = relay.beginPrismaDrain();
  t.after(() => relay.close());
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  await ready;
  const bad = Buffer.alloc(4);bad.writeUInt32BE(32769);
  const outcome = assert.rejects(wait(), { code: 'CURRENT259_LOOPBACK_FORWARD_FRAME' });
  child.stdout.write(bad);
  await outcome;await relay.close();
});

for (const exitCode of [0, 47, 70, 71, 72, 73, 74, 75, 76, 255]) {
  test('missing FIN quarantines immediately and preserves only the natural allowed exit ' + exitCode, { timeout: 5000 }, async t => {
    const child = fakeWorker();
    const kill = child.kill;
    let kills = 0;
    child.kill = (...args) => { kills++; return kill(...args); };
    const fixture = load(t, () => child);
    const relay = await fixture.start();
    t.after(() => relay.close());
    const drain = relay.beginPrismaDrain();
    const client = await connect(relay.port);
    t.after(() => client.destroy());
    const hostFinished = once(child.stdin, 'finish');
    client.end(reply);
    await hostFinished;
    await new Promise(resolve => setImmediate(resolve));
    child.stdout.end();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(kills, 0);
    let first;
    assert.throws(() => relay.check(), error => {
      first = error;
      return error.code === 'CURRENT259_LOOPBACK_FORWARD_FRAME' &&
        error.relayFrameStage === 'STDOUT_EOF_WITHOUT_FIN' && error.relayChildExitCode === undefined;
    });
    assert.throws(() => relay.beginPrismaDrain(), error => error === first);
    child.stderr.write('private relay message');
    const another = net.createConnection({ host: '127.0.0.1', port: relay.port });
    const rejected = once(another, 'close');
    another.resume();
    await rejected;
    assert.equal(fixture.calls.length, 1);
    assert.equal(kills, 0);
    const failed = assert.rejects(drain(), error => {
      assert.equal(error, first);
      const sysread = exitCode >= 70 && exitCode <= 75;
      assert.equal(error.relayChildExitCode, sysread ? 47 : exitCode === 76 || exitCode === 255 ? undefined : exitCode);
      assert.equal(error.relaySysreadExit, sysread ? exitCode : undefined);
      assert.equal(error.relayCloseState.cliExited, false);
      assert.equal(error.relayCloseState.pgFin, false);
      assert.doesNotMatch(String(error) + JSON.stringify(error), /private/u);
      return true;
    });
    child.emit('exit', exitCode, null);
    child.stderr.end();
    child.emit('close', exitCode, null);
    await failed;
    await relay.close();
    assert.equal(kills, 0);
  });
}

test('a missing FIN with no natural status retains the original FRAME through the fixed half-close deadline', { timeout: 7500 }, async t => {
  const child = fakeWorker();
  const fixture = load(t, () => child);
  const relay = await fixture.start();
  t.after(() => relay.close());
  const drain = relay.beginPrismaDrain();
  const client = await connect(relay.port);
  t.after(() => client.destroy());
  const hostFinished = once(child.stdin, 'finish');
  client.end(reply);
  await hostFinished;
  await new Promise(resolve => setImmediate(resolve));
  child.stdout.end();
  await new Promise(resolve => setImmediate(resolve));
  let first;
  assert.throws(() => relay.check(), error => {
    first = error;
    return error.code === 'CURRENT259_LOOPBACK_FORWARD_FRAME';
  });
  await assert.rejects(drain(), error => {
    assert.equal(error, first);
    assert.equal(error.relayFrameStage, 'STDOUT_EOF_WITHOUT_FIN');
    assert.equal(error.relayChildExitCode, undefined);
    return true;
  });
  await relay.close();
});

const qualifiedStart = '2026-11-12T09:00:00.000001Z';
async function enterReadonlyWorker(relay, child) {
  const window = relay.beginReadonlyRelayProbe();
  const client = await connect(relay.port);
  const acknowledged = once(child.stdin, 'data');
  client.write(reply);
  await acknowledged;
  client.resume();
  return {window,client};
}
async function closeReadonlyWorker(child, client, code, bytes=Buffer.alloc(0)) {
  const hostFinished = once(child.stdin, 'finish');
  client.end();
  await hostFinished;
  await new Promise(resolve => setImmediate(resolve));
  child.stdout.end(bytes);
  await new Promise(resolve => setImmediate(resolve));
  child.emit('exit', code, null);
  child.stderr.end();
  child.emit('close', code, null);
}
test('readonly reset pauses before owner proof and permits the next single probe only after proof', {timeout: 5000}, async t => {
  const children = [fakeWorker(),fakeWorker()], ownerCalls = [];
  let permitProof, seenOwner;
  const waiting = new Promise(resolve => { seenOwner = resolve; });
  const fixture = load(t, () => children[fixture.calls.length-1], async (identity,deadline) => {
    ownerCalls.push(identity);
    assert.ok(deadline>Date.now()&&deadline<=Date.now()+5000);
    if(ownerCalls.length===1)return new Promise(resolve => { permitProof=resolve; seenOwner(); });
    return true;
  });
  await assert.rejects(fixture.startReadonly({}), {code:'CURRENT259_LOOPBACK_FORWARD_INPUT'});
  const relay = await fixture.startReadonly();
  t.after(() => relay.close());
  await assert.rejects(fixture.startReadonly(), {code:'CURRENT259_LOOPBACK_FORWARD_INPUT'});
  assert.throws(() => relay.beginPrismaDrain(), {code:'CURRENT259_LOOPBACK_FORWARD_INPUT'});
  const first = await enterReadonlyWorker(relay,children[0]);
  t.after(() => first.client.destroy());
  first.window.markDisconnect(501,qualifiedStart);
  assert.throws(() => first.window.markDisconnect(501,qualifiedStart), {code:'CURRENT259_LOOPBACK_FORWARD_INPUT'});
  const drain=first.window.finish();
  await closeReadonlyWorker(children[0],first.client,70);
  await waiting;
  assert.throws(() => relay.check(), {code:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_ACTIVE'});
  assert.throws(() => relay.beginReadonlyRelayProbe(), {code:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_ACTIVE'});
  const stranger = net.createConnection({host:'127.0.0.1',port:relay.port});
  const refused=once(stranger,'close');
  stranger.resume();await refused;
  assert.equal(fixture.calls.length,1);
  permitProof(true);
  assert.equal(await drain,'CLOSED_BY_RESET');
  relay.check();
  assert.throws(() => first.window.markDisconnect(502,qualifiedStart), {code:'CURRENT259_LOOPBACK_FORWARD_INPUT'});
  await assert.rejects(first.window.finish(), {code:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_ACTIVE'});
  const second = await enterReadonlyWorker(relay,children[1]);
  t.after(() => second.client.destroy());
  second.window.markDisconnect(502,qualifiedStart);
  const secondResult=second.window.finish();
  await closeReadonlyWorker(children[1],second.client,0,Buffer.alloc(4));
  assert.equal(await secondResult,'REAL_FIN');
  assert.deepEqual(ownerCalls,[{pid:501,start:qualifiedStart}]);
  assert.equal(fixture.calls.length,2);
  await relay.close();
});

for(const [mode,exit,bytes] of [
  ['owner-still-live',70,Buffer.alloc(0)],
  ['stdin-reset',73,Buffer.alloc(0)],
  ['unclassified-reset',72,Buffer.alloc(0)],
  ['truncated-frame',70,Buffer.from([0,0,0,3,42])],
]){
  test('readonly closes without resuming for '+mode,{timeout:5000},async t=>{
    const child=fakeWorker();
    let owners=0;
    const fixture=load(t,()=>child,async()=>{owners++;return false;});
    const relay=await fixture.startReadonly();
    t.after(()=>relay.close());
    const probe=await enterReadonlyWorker(relay,child);
    t.after(()=>probe.client.destroy());
    probe.window.markDisconnect(501,qualifiedStart);
    const failed=assert.rejects(probe.window.finish());
    await closeReadonlyWorker(child,probe.client,exit,bytes);
    await failed;
    assert.equal(owners,mode==='owner-still-live'?1:0);
    assert.throws(()=>relay.beginReadonlyRelayProbe());
    assert.equal(fixture.calls.length,1);
  });
}

test('readonly owner deadline fails closed and a late owner reply cannot resume it', {timeout:7500}, async t=>{
 const child=fakeWorker();
 let ownerStarted,late;
 const checking=new Promise(resolve=>{ownerStarted=resolve;});
 const fixture=load(t,()=>child,()=>new Promise(resolve=>{late=resolve;ownerStarted();}));
 const relay=await fixture.startReadonly();
 t.after(()=>relay.close());
 const probe=await enterReadonlyWorker(relay,child);
 t.after(()=>probe.client.destroy());
 probe.window.markDisconnect(501,qualifiedStart);
 const failed=assert.rejects(probe.window.finish(),{code:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT'});
 await closeReadonlyWorker(child,probe.client,70);
 await checking;
 await failed;
 late(true);
 assert.throws(()=>relay.beginReadonlyRelayProbe());
 assert.equal(fixture.calls.length,1);
});
