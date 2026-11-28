'use strict';
const { spawn } = require('node:child_process');
const { realpathSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { isDeepStrictEqual } = require('node:util');
const API_ROOT = '/qualification/workspace/services/api';
const CASE = 'src/database/project-financing-quota-concurrency.owned282.spec.ts';
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

module.exports={runJest};
