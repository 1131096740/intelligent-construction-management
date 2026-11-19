'use strict';

const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { realpathSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { isDeepStrictEqual } = require('node:util');
const { withCurrent259LiveSessions, claimCurrent259LiveSessions } = require('./task16-current259-live-sessions.cjs');
const { claimCurrent259TechnicalResource } = require('./task16-current259-owned-resource.cjs');

const API_ROOT = path.resolve(__dirname, '..');
const CASE = 'src/database/project-financing-quota-concurrency.spec.ts';
const TIMEOUT_MS = 15 * 60_000;
const failures = new WeakSet();
function fail(kind) {
  const code = 'CURRENT259_PFQ_' + kind;
  const error = Object.assign(new Error(code), { code });
  failures.add(error);
  return error;
}
function need(value, kind = 'CONCURRENCY_FAILED_CLOSED') {
  if (!value) throw fail(kind);
}

async function runCurrent259PfqConcurrency(b7, handle, signal, check) {
  const view = claimCurrent259TechnicalResource(handle);
  let first;
  try {
    return await withCurrent259LiveSessions(b7, handle, proof => runWithSession(proof).catch(error => {
      // The live-session owner always closes its pools and sanitizes failures.
      // Retain only errors minted by this module while its callback was live.
      if (failures.has(error)) first ??= error;
      throw error;
    }));
  } catch {
    throw first ?? fail('LIVE_SESSIONS_FAILED_CLOSED');
  }
  async function runWithSession(proof) {
    const session = claimCurrent259LiveSessions(proof, handle);
    const guard = () => {
      check(); session.checkLight();
      need(!signal.aborted && claimCurrent259TechnicalResource(handle) === view && session.b7.xid === b7.installXid);
    };
    guard(); await session.verifyInstalled259(); guard();
    const { databaseName, port, caPath, relayId } = view.resource;
    const endpoint = await view.resource.inspectConnectionEndpoint();
    guard();
    need(endpoint.transport === 'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS' && endpoint.relayId === relayId &&
      endpoint.host === '127.0.0.1' && endpoint.port === port && endpoint.databaseName === databaseName &&
      session.identity[0]?.database === databaseName && /^jg_task01_[a-f0-9]{32}$/u.test(databaseName), 'SESSION_ADMISSION');
    const password = view.credentials().owner;
    need(/^[a-f0-9]{96}$/u.test(password), 'SESSION_ADMISSION');
    const url = new URL(`postgresql://jg_task01_owner:${password}@127.0.0.1:${port}/${databaseName}`);
    for (const [key, value] of Object.entries({ schema: 'public', connection_limit: '1', sslmode: 'require',
      sslaccept: 'strict', sslcert: caPath, connect_timeout: '5', pool_timeout: '5' })) url.searchParams.set(key, value);
    const nonce = randomBytes(16).toString('hex');
    const { database, databaseOid, systemIdentifier, effectiveOid: ownerOid } = session.identity[0];
    const identity = { database, databaseOid, systemIdentifier, ownerOid };
    const result = await runJest({ url: url.toString(), identity, nonce }, signal, async rows => {
      guard();
      need(Array.isArray(rows) && rows.length === 4 && new Set(rows.map(row => row?.pid)).size === 4 &&
        rows.every(row => Number.isInteger(row?.pid) && row.pid > 0 && row.pid <= 0x7fffffff &&
          typeof row.start === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.start)), 'SESSION_ADMISSION');
      const bindings = await session.owner.$queryRawUnsafe(`SELECT a.pid, to_char(a.backend_start AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start, a.application_name AS name
        FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_stat_ssl s USING (pid)
        WHERE s.ssl AND a.datid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
        AND a.usename=current_user AND pg_catalog.host(a.client_addr)='127.0.0.1'
        AND a.pid IN ($1,$2,$3,$4)`, ...rows.map(row => row.pid));
      guard();
      need(bindings.length === 4 && rows.every((row, index) => bindings.some(bound =>
        bound.pid === row.pid && bound.start === row.start && bound.name === `jg_pfq_${nonce}_${index}`)), 'SESSION_ADMISSION');
    });
    guard(); await session.verifyInstalled259(); guard();
    return result;
  }
}

async function runJest(packet, signal, verify) {
  const entry = realpathSync(require.resolve('jest/bin/jest', { paths: [API_ROOT] }));
  need(entry.startsWith(path.resolve(API_ROOT, '../../node_modules/.pnpm') + path.sep));
  need(!signal.aborted);
  const child = spawn(process.execPath, [entry, '--runInBand', '--runTestsByPath', CASE, '--json'], {
    cwd: API_ROOT,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', NODE_ENV: 'test', PFQ_NATIVE_COMPOSITION: '1' },
    stdio: ['pipe', 'pipe', 'ignore']
  });
  let timer, killTimer, bytes = 0, observations = 0, firstRows, report, interrupted;
  const stop = kind => {
    interrupted ??= kind;
    child.stdin.destroy(); child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1500);
  };
  const closed = new Promise(resolve => child.once('close', (code, killed) => resolve({ code, killed })));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const messages = lines[Symbol.asyncIterator]();
  child.on('error', () => stop('JEST_SPAWN'));
  child.stdin.on('error', () => stop('JEST_STREAM'));
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 512 * 1024) stop('JEST_OUTPUT_LIMIT'); });
  const abort = () => stop('JEST_ABORTED');
  signal.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => stop('JEST_TIMEOUT'), TIMEOUT_MS);
  try {
    child.stdin.write(JSON.stringify(packet) + '\n');
    for await (const line of messages) {
      if (line.startsWith('JG_PFQ_SESSIONS ')) {
        need(observations < 2 && !report, 'JEST_PROTOCOL');
        const rows = JSON.parse(line.slice('JG_PFQ_SESSIONS '.length));
        if (observations === 0) firstRows = rows;
        else need(isDeepStrictEqual(rows, firstRows), 'SESSION_DRIFT');
        try { await verify(rows); } catch (error) {
          throw failures.has(error) ? error : fail('SESSION_ADMISSION');
        }
        need(!signal.aborted, 'JEST_ABORTED');
        observations++;
        const ready = `JG_PFQ_READY ${packet.nonce} ${observations}\n`;
        if (observations === 2) child.stdin.end(ready);
        else child.stdin.write(ready);
      } else {
        need(observations === 2 && !report, 'JEST_PROTOCOL');
        report = JSON.parse(line);
      }
    }
    const status = await closed;
    need(!interrupted, interrupted);
    need(!signal.aborted, 'JEST_ABORTED');
    need(status.code === 0 && !status.killed, 'JEST_EXIT');
    need(observations === 2 && report?.success === true && report.numTotalTests === 14 && report.numPassedTests === 14 &&
      report.numTotalTestSuites === 1 && report.testResults?.[0]?.name === path.join(API_ROOT, CASE), 'JEST_RESULT');
    return { suite: 'project-financing-quota-concurrency', businessCases: 13, connectionCases: 1 };
  } catch (error) {
    const first = interrupted ? fail(interrupted) : failures.has(error) ? error : fail('JEST_PROTOCOL');
    stop(); await closed; throw first;
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort); lines.close();
  }
}

module.exports = Object.freeze({ runCurrent259PfqConcurrency });
