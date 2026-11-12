'use strict';

// The owned starter supplies only its exact container, private CLI config and
// lifetime signal. The bridge is not a Docker or PostgreSQL command interface.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { types } = require('node:util');
const { readQualifiedTask16File } = require('./task16-runtime-inputs.cjs');

const DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker';
const ENDPOINT = 'unix:///Users/leoyang/.docker/run/docker.sock';
const HOST = '127.0.0.1';
const FRAME = 32768;
const CONNECTIONS = 8;
const HALF_CLOSE_MS = 5000;
const PRISMA_DRAIN_MS = 5000;
const CLOSE_MS = 3000;
const CONFIG_SHA = createHash('sha256').update('{"auths":{}}\n').digest('hex');
const EOF = Buffer.alloc(4);
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const onEvent = EventTarget.prototype.addEventListener;
const offEvent = EventTarget.prototype.removeEventListener;
const code = suffix => 'CURRENT259_LOOPBACK_FORWARD_' + suffix;
const fault = suffix => Object.assign(new Error(code(suffix)), { code: code(suffix) });
const need = (ok, suffix) => { if (!ok) throw fault(suffix); };
const needFrame = (ok, relayFrameStage) => {
  if (!ok) throw Object.assign(fault('FRAME'), { relayFrameStage });
};

// A zero-length frame means a write-side EOF. Both directions use ordered
// frames inside Docker stdio so neither TCP FIN depends on CLI stream closure.
const PUMP = String.raw`
use strict;
use warnings;
use IO::Select;
use IO::Socket::INET;
use Socket qw(SHUT_WR);
use Fcntl qw(F_GETFL F_SETFL O_NONBLOCK);
use Errno qw(EAGAIN EWOULDBLOCK EINTR);
$SIG{PIPE} = 'IGNORE';
$SIG{ALRM} = sub { exit 48 };
my $max = 32768;
my $pg = IO::Socket::INET->new(PeerAddr => '127.0.0.1', PeerPort => 5432, Proto => 'tcp', Timeout => 3);
exit 41 unless $pg;
for my $fh (\*STDIN, \*STDOUT, $pg) {
  binmode($fh) or exit 42;
  my $flags = fcntl($fh, F_GETFL, 0);
  defined($flags) && fcntl($fh, F_SETFL, $flags | O_NONBLOCK) or exit 42;
}
my ($frames, $to_pg, $to_host) = ('', '', '');
my ($host_fin, $stdin_eof, $pg_fin, $pg_write_closed) = (0, 0, 0, 0);
while (1) {
  if (!$host_fin && !length($to_pg) && length($frames) >= 4) {
    my $length = unpack('N', substr($frames, 0, 4));
    exit 43 if $length > $max;
    if (length($frames) >= 4 + $length) {
      substr($frames, 0, 4, '');
      if ($length) { $to_pg = substr($frames, 0, $length, ''); }
      else { exit 43 if length($frames); alarm(5) unless $pg_fin; $host_fin = 1; }
    }
  }
  if ($host_fin && !$pg_write_closed && !length($to_pg)) {
    shutdown($pg, SHUT_WR) or exit 44;
    $pg_write_closed = 1;
  }
  last if $pg_write_closed && $pg_fin && !length($to_host);
  my ($read, $write) = (IO::Select->new(), IO::Select->new());
  $read->add(\*STDIN) if !$stdin_eof && !length($to_pg);
  $read->add($pg) if !$pg_fin && !length($to_host);
  $write->add($pg) if length($to_pg);
  $write->add(\*STDOUT) if length($to_host);
  my ($ready_read, $ready_write) = IO::Select->select($read, $write, undef);
  if (!$ready_read || !$ready_write) { next if $! == EINTR; exit 45; }
  for my $fh (@$ready_write) {
    my $is_pg = fileno($fh) == fileno($pg);
    my $buf = $is_pg ? \$to_pg : \$to_host;
    my $count = syswrite($fh, $$buf);
    if (!defined($count)) { next if $! == EINTR || $! == EAGAIN || $! == EWOULDBLOCK; exit 46; }
    exit 46 unless $count;
    substr($$buf, 0, $count, '');
  }
  for my $fh (@$ready_read) {
    my $is_pg = fileno($fh) == fileno($pg);
    my $room = $is_pg ? $max : $max + 4 - length($frames);
    exit 43 unless $room > 0;
    my $data = '';
    my $count = sysread($fh, $data, $room);
    if (!defined($count)) { next if $! == EINTR || $! == EAGAIN || $! == EWOULDBLOCK; exit 47; }
    if ($is_pg) {
      $to_host = pack('N', $count) . $data;
      unless ($count) { alarm(5) unless $host_fin; $pg_fin = 1; }
    } else {
      if (!$count) { exit 43 unless $host_fin; $stdin_eof = 1; }
      else { exit 43 if $host_fin; $frames .= $data; }
    }
  }
}
close($pg);
exit 0;
`;

function inputs(options) {
  need(options && !types.isProxy(options) && Object.getPrototypeOf(options) === Object.prototype, 'INPUT');
  const fields = Object.getOwnPropertyDescriptors(options);
  need(Reflect.ownKeys(fields).length === 3 &&
    ['containerId', 'dockerConfig', 'signal'].every(key => fields[key] && Object.hasOwn(fields[key], 'value')), 'INPUT');
  const { containerId, dockerConfig, signal } = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]));
  need(typeof containerId === 'string' && /^[a-f0-9]{64}$/u.test(containerId) &&
    typeof dockerConfig === 'string' && dockerConfig.startsWith('/private/tmp/') && path.normalize(dockerConfig) === dockerConfig &&
    dockerConfig.endsWith('/tls-private/docker-config') && !types.isProxy(signal) && signal instanceof AbortSignal, 'INPUT');
  return { containerId, dockerConfig, signal };
}

function checkConfig(directory, expectedIdentity) {
  try {
    const stat = fs.lstatSync(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700 &&
      fs.realpathSync(directory) === directory && fs.readdirSync(directory).join(',') === 'config.json', 'CONFIG');
    const config = readQualifiedTask16File(path.join(directory, 'config.json'), {
      privateFile: true, maxBytes: 32, expectedIdentity, code: code('CONFIG')
    });
    need(config.sha256 === CONFIG_SHA, 'CONFIG');
    return config.identity;
  } catch { throw fault('CONFIG'); }
}

function write(stream, data, retirePeer) {
  return new Promise((resolve, reject) => stream.write(data, error =>
    error && !retirePeer?.(error) ? reject(fault('STREAM')) : resolve()));
}

function end(stream, data, retirePeer) {
  return new Promise((resolve, reject) => stream.end(data, error =>
    error && !retirePeer?.(error) ? reject(fault('STREAM')) : resolve()));
}

async function send(socket, stdin, halfClosed, peer) {
  try {
    for await (const chunk of socket.iterator({ destroyOnReturn: false })) {
      for (let offset = 0; offset < chunk.length; offset += FRAME) {
        const data = chunk.subarray(offset, offset + FRAME);
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(data.length);
        await write(stdin, Buffer.concat([header, data]));
      }
    }
  } catch (error) {
    if (!peer.retire(error)) throw error;
  }
  halfClosed();
  // The framed FIN carries the PostgreSQL meaning. Closing the CLI stdin after
  // those bytes separately releases the Docker attach transport's input side.
  await end(stdin, EOF);
}

async function receive(stdout, socket, halfClosed, peer) {
  let pending = Buffer.alloc(0), length = null, fin = false;
  for await (const chunk of stdout) {
    needFrame(!fin, 'DATA_AFTER_FIN');
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length) {
      if (length === null) {
        if (pending.length < 4) break;
        length = pending.readUInt32BE();
        pending = pending.subarray(4);
        needFrame(length <= FRAME, 'OVERSIZED_LENGTH');
        if (!length) {
          needFrame(!pending.length, 'TRAILING_AFTER_FIN');
          fin = true;
          halfClosed();
          if (!peer.retired()) {
            await end(socket, undefined, peer.retire);
            peer.endReturned();
          }
          break;
        }
      }
      if (pending.length < length) break;
      if (!peer.retired()) await write(socket, pending.subarray(0, length), peer.retire);
      pending = pending.subarray(length);
      length = null;
    }
  }
  needFrame(fin, 'STDOUT_EOF_WITHOUT_FIN');
}

async function startCurrent259LoopbackForward(options) {
  need(arguments.length === 1, 'INPUT');
  const { containerId, dockerConfig, signal } = inputs(options);
  need(!aborted.call(signal), 'ABORTED');
  const configIdentity = checkConfig(dockerConfig);
  const argv = ['--host', ENDPOINT, 'exec', '--interactive', '--user', 'postgres', containerId,
    '/usr/bin/env', '-i', '/usr/bin/perl', '-T', '-e', PUMP];
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', DOCKER_CONFIG: dockerConfig };
  const workers = new Set();
  let firstFailure, closing, active = false, prismaWindow, notifyStopped;
  const stopped = new Promise(resolve => { notifyStopped = resolve; });
  const fail = (suffix, relayCloseState, relayFrameStage, waitForNaturalExit = false) => {
    if (!firstFailure) {
      firstFailure = fault(suffix);
      if (relayCloseState) Object.defineProperty(firstFailure, 'relayCloseState', { value: Object.freeze({ ...relayCloseState }) });
      if (relayFrameStage) Object.defineProperty(firstFailure, 'relayFrameStage', { value: relayFrameStage });
    }
    if (!waitForNaturalExit) void close().catch(() => {});
  };
  const onAbort = () => fail('ABORTED');
  const server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, socket => {
    if (firstFailure || !active || closing) { socket.destroy(); return; }
    if (socket.remoteAddress !== HOST || socket.localAddress !== HOST || workers.size >= CONNECTIONS) {
      socket.destroy();
      fail('LIMIT');
      return;
    }
    try { checkConfig(dockerConfig, configIdentity); }
    catch { socket.destroy(); fail('CONFIG'); return; }
    let child;
    try { child = spawn(DOCKER, argv, { env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { socket.destroy(); fail('CHILD'); return; }

    let exited = false, halfCloseTimer, missingFin, childExitCode;
    const closeState = { hostFin: false, stdinEnded: false, pgFin: false, stdoutEnded: false, cliClosed: false,
      stdoutRawEnd: false, receiveSettled: false, cliExited: false, peerEndReturned: false };
    const closeSnapshot = () => ({ ...closeState, peerSocketDestroyed: socket.destroyed });
    const observeExit = exitCode => {
      if (!closing && Number.isInteger(exitCode) && (exitCode === 0 || exitCode >= 41 && exitCode <= 48))
        childExitCode = exitCode;
    };
    const finishMissingFin = () => {
      if (!closing && missingFin) {
        if (childExitCode !== undefined)
          Object.defineProperty(missingFin, 'relayChildExitCode', { value: childExitCode });
        void close().catch(() => {});
      }
    };
    child.once('exit', exitCode => {
      closeState.cliExited = true;
      observeExit(exitCode);
      finishMissingFin();
    });
    child.stdout.once('end', () => { closeState.stdoutRawEnd = true; });
    const worker = { socket, child, closeSnapshot, closed: new Promise(resolve => child.once('close', exitCode => {
      exited = true;
      closeState.cliClosed = true;
      observeExit(exitCode);
      resolve(exitCode);
      if (missingFin) finishMissingFin();
      else if (!closing && exitCode !== 0) fail('CHILD');
    })) };
    workers.add(worker);
    const observeError = () => { if (!closing && !missingFin) fail('STREAM'); };
    const halfClosed = side => {
      closeState[side] = true;
      if (!halfCloseTimer) halfCloseTimer = setTimeout(() => {
        if (missingFin) finishMissingFin();
        else fail('HALF_CLOSE_TIMEOUT', closeSnapshot());
      }, HALF_CLOSE_MS);
    };
    // Native clients may reset after a terminal PostgreSQL reply. Retire only
    // that peer, then send an ordered EOF and drain its exact worker. Child and
    // framing failures still stop the relay, including while this peer retires.
    let retired = false;
    const peer = {
      retired: () => retired,
      endReturned() { closeState.peerEndReturned = true; },
      retire(error) {
        const reason = error?.code;
        if (!['ECONNRESET', 'EPIPE'].includes(reason) &&
          !(retired && ['ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED'].includes(reason))) return false;
        retired = true;
        halfClosed('hostFin');
        return true;
      }
    };
    socket.on('error', error => { if (!closing && !peer.retire(error)) observeError(); });
    child.stdin.on('error', observeError);
    child.stdout.on('error', observeError);
    child.stderr.on('error', observeError);
    child.on('error', () => { if (!closing) fail('CHILD'); });
    child.stderr.on('data', chunk => {
      if (!closing && !missingFin && chunk.length) fail('CHILD');
    });
    worker.stop = () => {
      socket.destroy();
      child.stdin.destroy();
      if (!exited) { try { child.kill('SIGTERM'); } catch { /* Wait for close or escalate. */ } }
    };
    worker.kill = () => { if (!exited) { try { child.kill('SIGKILL'); } catch { /* Close proof remains required. */ } } };
    const fromHost = send(socket, child.stdin, () => halfClosed('hostFin'), peer).then(() => { closeState.stdinEnded = true; });
    const fromPg = receive(child.stdout, socket, () => halfClosed('pgFin'), peer).then(() => {
      closeState.stdoutEnded = true;
      closeState.receiveSettled = true;
    });
    const window = prismaWindow?.accepting ? prismaWindow : undefined;
    window?.workers.add(worker);
    worker.done = Promise.all([fromHost, fromPg, worker.closed]).catch(async error => {
      if (!closing) {
        if (error?.code === code('FRAME')) {
          const stage = error.relayFrameStage;
          if (!firstFailure && stage === 'STDOUT_EOF_WITHOUT_FIN' && closeState.hostFin && closeState.stdinEnded) {
            // Quarantine immediately. Observe only this worker's natural exit
            // within the remaining half-close budget before starting teardown.
            fail('FRAME', closeSnapshot(), stage, true);
            missingFin = firstFailure;
            if (closeState.cliExited || closeState.cliClosed) finishMissingFin();
            await Promise.race([worker.closed, stopped]);
          } else fail('FRAME', closeSnapshot(), stage);
        } else fail('STREAM');
      }
    }).finally(() => {
      clearTimeout(halfCloseTimer);
      socket.destroy();
      child.stdin.destroy();
      if (exited) workers.delete(worker);
      window?.workers.delete(worker);
    });
  });

  function close() {
    if (closing) return closing;
    active = false;
    notifyStopped();
    offEvent.call(signal, 'abort', onAbort);
    closing = Promise.resolve().then(async () => {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(fault('CLEANUP')) : resolve()));
      const pending = [...workers];
      for (const worker of pending) worker.stop();
      const force = setTimeout(() => { for (const worker of pending) worker.kill(); }, 750);
      let timeout;
      try {
        await Promise.race([
          Promise.all([closed, ...pending.map(worker => worker.closed)]),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(fault('CLEANUP')), CLOSE_MS); })
        ]);
        workers.clear();
      } finally {
        clearTimeout(force);
        clearTimeout(timeout);
      }
    });
    return closing;
  }

  function check() {
    if (firstFailure) throw firstFailure;
    need(active && !closing && server.listening, 'CLOSED');
    try { checkConfig(dockerConfig, configIdentity); }
    catch { fail('CONFIG'); throw firstFailure; }
  }
  function beginPrismaDrain() {
    need(arguments.length === 0, 'INPUT');
    check();
    need(!prismaWindow, 'DEPLOY_DRAIN_ACTIVE');
    const window = { workers: new Set(), accepting: true };
    prismaWindow = window;
    return async function waitPrismaDrain() {
      need(arguments.length === 0 && prismaWindow === window && window.accepting, 'DEPLOY_DRAIN_ACTIVE');
      window.accepting = false;
      let timeout;
      try {
        await Promise.race([
          Promise.all([...window.workers].map(worker => worker.done)),
          stopped,
          new Promise(resolve => { timeout = setTimeout(() => {
            fail('DEPLOY_DRAIN_TIMEOUT', window.workers.values().next().value?.closeSnapshot());
            resolve();
          }, PRISMA_DRAIN_MS); })
        ]);
        if (firstFailure) throw firstFailure;
        need(active && !closing && window.workers.size === 0, 'CLOSED');
      } finally {
        clearTimeout(timeout);
        prismaWindow = undefined;
      }
    };
  }

  await new Promise((resolve, reject) => {
    const failed = () => reject(fault('LISTEN'));
    server.once('error', failed);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      server.removeListener('error', failed);
      resolve();
    });
  });
  server.on('error', () => { if (!closing) fail('LISTEN'); });
  try {
    const address = server.address();
    need(address?.address === HOST && Number.isInteger(address.port) && address.port > 1024 && address.port <= 65535, 'LISTEN');
    need(!aborted.call(signal), 'ABORTED');
    active = true;
    onEvent.call(signal, 'abort', onAbort, { once: true });
    return Object.freeze({ port: address.port, check, close, beginPrismaDrain });
  } catch (error) {
    try { await close(); } catch { throw fault('CLEANUP'); }
    throw error;
  }
}

module.exports = Object.freeze({ startCurrent259LoopbackForward });
