'use strict';

// The owned starter supplies only its exact container, private CLI config and
// lifetime signal. The bridge is not a Docker or PostgreSQL command interface.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { types } = require('node:util');
const { decodeRelaySysreadExit } = require('./task16-current259-relay-sysread.cjs');
const { readQualifiedTask16File } = require('./task16-runtime-inputs.cjs');


function requireFixedIdentityMain() {
  const main=require.main;
  const allowed=['task12-current259-readonly-relay-once.cjs','task12-current259-generated-draft-once.cjs','task12-current259-first-q2-once.cjs'];
  const file=main&&!types.isProxy(main)&&Object.getOwnPropertyDescriptor(main,'filename')?.value;
  const exported=main&&Object.getOwnPropertyDescriptor(main,'exports')?.value;
  const claim=exported&&!types.isProxy(exported)&&Object.getOwnPropertyDescriptor(exported,'assertIdentityFreshMain')?.value;
  if(!allowed.some(name=>file===path.join(__dirname,name))||Object.getOwnPropertyDescriptor(require.cache,file)?.value!==main||
    process.argv[1]!==file||process.execArgv.length!==0||process._preload_modules?.length||
    !Object.isFrozen(exported)||typeof claim!=='function'||types.isProxy(claim)||claim()!==true)
    throw new Error('CURRENT259_IDENTITY_AUTHORITY');
}

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
use Errno qw(EAGAIN EWOULDBLOCK EINTR ECONNRESET ENOTCONN);
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
    if (!defined($count)) {
      my $errno = 0 + $!;
      next if $errno == EINTR || $errno == EAGAIN || $errno == EWOULDBLOCK;
      my $base = fileno($fh) == fileno($pg) ? 70 : 73;
      exit($base + ($errno == ECONNRESET ? 0 : $errno == ENOTCONN ? 1 : 2));
    }
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
  if (!fin) {
    try { needFrame(false, 'STDOUT_EOF_WITHOUT_FIN'); }
    catch (error) {
      Object.defineProperty(error, 'completeFrames', { value: pending.length === 0 && length === null });
      throw error;
    }
  }
}

async function startCurrent259LoopbackForward(options, readonlyPermit) {
  need(arguments.length === 1 || arguments.length === 2, 'INPUT');
  const { containerId, dockerConfig, signal } = inputs(options);
  if(arguments.length===2)requireFixedIdentityMain();
  const verifyBackendGone = arguments.length === 2 ?
    require('./task12-current259-identity-authority.cjs').claimIdentityBackendVerifier(readonlyPermit, { containerId, dockerConfig, signal }) : undefined;
  need(arguments.length === 1 || typeof verifyBackendGone === 'function', 'INPUT');
  const identityProfile=verifyBackendGone&&Object.getOwnPropertyDescriptor(verifyBackendGone,'identityProfile')?.value;
  need(identityProfile===undefined||require('./task12-current259-identity261-profile.cjs').isIdentity261(identityProfile),'INPUT');
  need(!aborted.call(signal), 'ABORTED');
  const configIdentity = checkConfig(dockerConfig);
  const argv = ['--host', ENDPOINT, 'exec', '--interactive', '--user', 'postgres', containerId,
    '/usr/bin/env', '-i', '/usr/bin/perl', '-T', '-e', PUMP];
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', DOCKER_CONFIG: dockerConfig };
  const workers = new Set();
  let firstFailure, closing, active = false, prismaWindow, notifyStopped, readonlyStarted = false, identityQualification, identityFinished = false;
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
    if (firstFailure || !active || closing ||
      readonlyStarted && (!prismaWindow?.readonly || !prismaWindow.accepting || prismaWindow.claimed)) {
      socket.destroy();
      return;
    }
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

    let exited = false, halfCloseTimer, missingFin, childExitCode, halfCloseDeadline, resetCandidate, stderrSeen = false;
    const closeState = { hostFin: false, stdinEnded: false, pgFin: false, stdoutEnded: false, cliClosed: false,
      stdoutRawEnd: false, receiveSettled: false, cliExited: false, peerEndReturned: false };
    const closeSnapshot = () => ({ ...closeState, peerSocketDestroyed: socket.destroyed });
    const observeExit = exitCode => {
      if (!closing && Number.isInteger(exitCode) && (exitCode === 0 || exitCode >= 41 && exitCode <= 48 || decodeRelaySysreadExit(exitCode)))
        childExitCode = exitCode;
    };
    const finishMissingFin = () => {
      if (!closing && missingFin) {
        if (childExitCode !== undefined) {
          const sysread = decodeRelaySysreadExit(childExitCode);
          Object.defineProperty(missingFin, 'relayChildExitCode', { value: sysread ? 47 : childExitCode });
          if (sysread) Object.defineProperty(missingFin, 'relaySysreadExit', { value: childExitCode });
        }
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
      else if (!closing && !resetCandidate && exitCode !== 0) fail('CHILD');
    })) };
    workers.add(worker);
    const observeError = () => { if (!closing && !missingFin) fail('STREAM'); };
    const halfClosed = side => {
      closeState[side] = true;
      if (!halfCloseTimer) {
        halfCloseDeadline = Date.now() + HALF_CLOSE_MS;
        halfCloseTimer = setTimeout(() => {
          if (missingFin) finishMissingFin();
          else fail('HALF_CLOSE_TIMEOUT', closeSnapshot());
        }, HALF_CLOSE_MS);
      }
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
      if (chunk.length) stderrSeen = true;
      if (!closing && !missingFin && stderrSeen) fail('CHILD');
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
    if (window?.readonly) window.claimed = true;
    worker.done = Promise.all([fromHost, fromPg, worker.closed]).catch(async error => {
      if (!closing) {
        if (error?.code === code('FRAME')) {
          const stage = error.relayFrameStage;
          if (!firstFailure && stage === 'STDOUT_EOF_WITHOUT_FIN' && closeState.hostFin && closeState.stdinEnded &&
            window?.readonly && window.identity && error.completeFrames && !retired && !stderrSeen &&
            socket.writableLength === 0 && child.stdin.writableLength === 0) {
            resetCandidate = true;
            window.paused = true;
            const [naturalExit] = await Promise.race([worker.closed.then(exit => [exit]), stopped.then(() => [])]);
            if (!closing && naturalExit === 70 && childExitCode === 70 && !stderrSeen && Date.now() < halfCloseDeadline)
              window.resetDeadline = halfCloseDeadline;
            else if (!closing) fail('FRAME', closeSnapshot(), stage);
          } else if (!firstFailure && stage === 'STDOUT_EOF_WITHOUT_FIN' && closeState.hostFin && closeState.stdinEnded) {
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
    need(!prismaWindow?.paused, 'DEPLOY_DRAIN_ACTIVE');
    need(active && !closing && server.listening, 'CLOSED');
    try { checkConfig(dockerConfig, configIdentity); }
    catch { fail('CONFIG'); throw firstFailure; }
  }
  function openDrain(readonly) {
    check();
    need(!prismaWindow, 'DEPLOY_DRAIN_ACTIVE');
    const window = { workers: new Set(), accepting: true, readonly };
    prismaWindow = window;
    return window;
  }
  function beginPrismaDrain() {
    need(arguments.length === 0 && (!verifyBackendGone||identityProfile&&!identityQualification), 'INPUT');
    const window = openDrain(false);
    return async function () { need(arguments.length === 0, 'DEPLOY_DRAIN_ACTIVE'); return waitDrain(window); };
  }
  function beginReadonlyRelayProbe() {
    need(arguments.length === 0 && verifyBackendGone && !identityProfile && workers.size === 0, 'INPUT');
    return readonlyWindow();
  }
  function readonlyWindow() {
    need(workers.size===0,'INPUT');
    readonlyStarted = true;
    const window = openDrain(true);
    return Object.freeze({
      markDisconnect(pid, start) {
        need(arguments.length === 2 && prismaWindow === window && window.workers.size === 1 &&
          !window.identity && Number.isInteger(pid) && pid > 0 && pid <= 2147483647 &&
          typeof start === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(start), 'INPUT');
        window.identity = Object.freeze({pid,start});
      },
      finish() {
        need(arguments.length === 0 && window.identity, 'INPUT');
        return waitDrain(window);
      },
    });
  }
  function beginIdentityQualification(roles) {
    need(arguments.length===1&&identityProfile&&!identityQualification&&!identityFinished&&
      require('./task12-current259-identity261-profile.cjs').identityRoles(roles)&&workers.size===0,'INPUT');
    const qualification={roles:roles.slice(),index:0,evidence:[],active:true};
    identityQualification=qualification;
    return Object.freeze({
      begin(index,role){
        need(arguments.length===2&&identityQualification===qualification&&qualification.active&&
          index===qualification.index&&role===qualification.roles[index]&&index<5,'INPUT');
        const lease=readonlyWindow();
        return Object.freeze({
          markDisconnect(pid,start){need(arguments.length===2,'INPUT');lease.markDisconnect(pid,start);},
          async finish(){
            need(arguments.length===0&&identityQualification===qualification&&qualification.active,'INPUT');
            const closeKind=await lease.finish();
            qualification.evidence.push(Object.freeze({name:role,identityVerified:true,closeKind,
              ...(closeKind==='CLOSED_BY_RESET'?{backendGone:true}:{})}));
            qualification.index++;
            return closeKind;
          },
        });
      },
      finish(){
        need(arguments.length===0&&identityQualification===qualification&&qualification.active&&
          qualification.index===5&&qualification.evidence.length===5&&!prismaWindow&&workers.size===0,'INPUT');
        qualification.active=false;identityQualification=undefined;identityFinished=true;readonlyStarted=false;
        check();
        return Object.freeze(qualification.evidence.slice());
      },
    });
  }
  async function waitDrain(window) {
      need(prismaWindow === window && window.accepting, 'DEPLOY_DRAIN_ACTIVE');
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
        if (window.readonly) {
          need(window.claimed && workers.size === 0, 'CLOSED');
          if (window.paused) {
            need(window.resetDeadline && Date.now() < window.resetDeadline, 'DEPLOY_DRAIN_TIMEOUT');
            let ownerTimer;
            let verified;
            try {
              verified = await Promise.race([
                verifyBackendGone(window.identity, window.resetDeadline),
                stopped.then(() => false),
                new Promise(resolve => { ownerTimer = setTimeout(() => {
                  fail('DEPLOY_DRAIN_TIMEOUT');
                  resolve(false);
                }, Math.max(0, window.resetDeadline - Date.now())); }),
              ]);
            } finally { clearTimeout(ownerTimer); }
            if (firstFailure) throw firstFailure;
            need(verified === true && active && !closing && !firstFailure && Date.now() < window.resetDeadline &&
              workers.size === 0 && prismaWindow === window, 'CLOSED');
            return 'CLOSED_BY_RESET';
          }
          return 'REAL_FIN';
        }
      } catch (error) {
        if (window.readonly && !firstFailure) fail('FRAME', undefined, 'STDOUT_EOF_WITHOUT_FIN');
        throw error;
      } finally {
        clearTimeout(timeout);
        prismaWindow = undefined;
      }
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
    return Object.freeze({ port: address.port, check, close, beginPrismaDrain,
      ...(identityProfile ? {beginIdentityQualification}:verifyBackendGone ? { beginReadonlyRelayProbe } : {}) });
  } catch (error) {
    try { await close(); } catch { throw fault('CLEANUP'); }
    throw error;
  }
}

module.exports = Object.freeze({ startCurrent259LoopbackForward });
