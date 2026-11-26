'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const deadlineMs = 20_000;

function openStaleTransaction(owner, cert, batch) {
  let stdout = '';
  let stderr = '';
  const child = spawn('stdbuf', [
    '-oL', '-eL', 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'
  ], {
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', PGHOST: owner.hostname,
      PGPORT: owner.port, PGUSER: owner.username, PGPASSWORD: decodeURIComponent(owner.password),
      PGDATABASE: owner.pathname.slice(1), PGSSLMODE: 'verify-full', PGSSLROOTCERT: cert,
      PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=5000 -c idle_in_transaction_session_timeout=12000'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const close = new Promise(resolve => {
    child.once('error', () => {
      rejectReady(new Error('ISSUE417_RACE_PSQL_SPAWN'));
      resolve({ spawnFailed: true });
    });
    child.once('close', (code, signal) => {
      rejectReady(new Error('ISSUE417_RACE_STALE_SNAPSHOT_NOT_READY'));
      resolve({ code, signal, sqlstate: /\bERROR:\s+([0-9A-Z]{5}):/u.exec(stderr)?.[1] });
    });
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), deadlineMs);
  void close.then(() => clearTimeout(timer));
  child.stdin.on('error', () => rejectReady(new Error('ISSUE417_RACE_STALE_STDIN')));
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    const marker = /(?:^|\n)ISSUE417_RACE_SNAPSHOT_READY:([1-9]\d{0,9})\n/u.exec(stdout);
    if (marker) resolveReady(marker[1]);
    if (stdout.length > 8_192) child.kill('SIGKILL');
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
    if (stderr.length > 8_192) child.kill('SIGKILL');
  });
  child.stdin.write(`
    BEGIN ISOLATION LEVEL REPEATABLE READ;
    SELECT CASE WHEN count(*) = 0 AND (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid())
      THEN 'ISSUE417_RACE_SNAPSHOT_READY:' || pg_backend_pid() ELSE 'ISSUE417_RACE_FIXTURE_NOT_READY' END
    FROM public."OperatingTakeoverActivation" WHERE "batchId" = '${batch}';
  `);
  return {
    ready,
    mutate() {
      child.stdin.end(`
        UPDATE public."OperatingTakeoverBatch" SET "sceneKeys" = '["ordinary"]'::jsonb WHERE "id" = '${batch}';
        COMMIT;
      `);
      return close;
    },
    abort() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      return close;
    }
  };
}

async function verifyHistoryExpenseInvariant({ ownerUrl, workDir, database, runId, sql }) {
  const owner = new URL(ownerUrl);
  const run = runId.replaceAll('-', '');
  const cert = path.join(workDir, 'ca.crt');
  assert.notEqual(process.getuid(), 0);
  assert.match(run, /^[a-f0-9]{32}$/u);
  assert.equal(database, 'jg_task01_' + run);
  assert.equal(owner.protocol, 'postgresql:');
  assert.equal(owner.hostname, '127.0.0.1');
  assert.equal(owner.username, 'jg_task01_owner');
  assert.ok(owner.port && owner.password);
  assert.equal(owner.pathname, '/' + database);
  assert.equal(owner.searchParams.getAll('sslmode').join(','), 'require');
  assert.equal(owner.searchParams.getAll('sslaccept').join(','), 'strict');
  assert.equal(owner.searchParams.get('sslcert'), cert);
  assert.equal(typeof sql, 'function');

  const ordinary = 'issue417-race-ordinary-' + run;
  const history = 'issue417-race-history-' + run;
  const project = 'issue417-race-project-' + run;
  const actor = 'issue417-race-actor-' + run;
  const ordinaryRow = ordinary + '-row';
  const historyRow = history + '-row';
  const transition = await sql(`
    SELECT _prisma_migrations.migration_name
    FROM public._prisma_migrations
    WHERE migration_name = '20261129012000_issue417_historical_expense_states'
      AND checksum = '924effc588fe48f9f4e63bd5187c2eb6a1a48b35d1749d699fccc4135ddaaecd'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      AND (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)=335
      AND current_user=session_user AND current_user='jg_task01_owner'
      AND (SELECT datdba=current_user::regrole::oid FROM pg_database WHERE datname=current_database())
      AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid());
  `);
  assert.equal(transition.stdout.trim(), '20261129012000_issue417_historical_expense_states');
  const activation = (batch, status) => `
    INSERT INTO public."OperatingTakeoverActivation" (
      "idempotencyKey", "batchId", revision, status, "generatedFactIds", "gapRowIds", "activatedByUserId"
    ) VALUES ('${batch}-activate', '${batch}', 1, '${status}', '[]', '[]', '${actor}')
  `;
  let stale;
  try {
    await sql(`
      BEGIN;
      INSERT INTO public."OperatingTakeoverBatch" (
        id, "projectId", "batchNo", "sceneKeys", "importFingerprint", "createdByUserId", "updatedAt"
      ) VALUES
        ('${ordinary}', '${project}', '${ordinary}', '["ordinary"]', '${ordinary}', '${actor}', now()),
        ('${history}', '${project}', '${history}', '["historical_expense"]', '${history}', '${actor}', now());
      INSERT INTO public."OperatingTakeoverRow" (
        id, "batchId", "rowNo", "sceneKey", "definitionVersion", "valuesSnapshot", "evidenceLevel", "updatedAt"
      ) VALUES
        ('${ordinaryRow}', '${ordinary}', 1, 'ordinary', 1, '{}', 'B', now()),
        ('${historyRow}', '${history}', 1, 'historical_expense', 1, '{}', 'B', now());
      DO $verify$
      DECLARE v text; caught_constraint text;
      BEGIN
        FOREACH v IN ARRAY ARRAY['draft', 'under_review', 'activated'] LOOP
          UPDATE public."OperatingTakeoverBatch" SET status = v WHERE id = '${ordinary}';
        END LOOP;
        FOREACH v IN ARRAY ARRAY['pending', 'accepted', 'blocked', 'activated'] LOOP
          UPDATE public."OperatingTakeoverRow" SET "reviewStatus" = v WHERE id = '${ordinaryRow}';
        END LOOP;
        FOREACH v IN ARRAY ARRAY['verified', 'not_occurred'] LOOP
          UPDATE public."OperatingTakeoverRow" SET "reviewStatus" = v WHERE id = '${historyRow}';
          BEGIN
            UPDATE public."OperatingTakeoverRow" SET "reviewStatus" = v WHERE id = '${ordinaryRow}';
            RAISE EXCEPTION 'ISSUE417_RACE_UNSCOPED_ROW_STATE';
          EXCEPTION WHEN check_violation THEN
            GET STACKED DIAGNOSTICS caught_constraint = CONSTRAINT_NAME;
            IF caught_constraint <> 'OperatingTakeoverRow_status_check' THEN RAISE; END IF;
          END;
        END LOOP;
        UPDATE public."OperatingTakeoverBatch" SET status = 'partially_activated' WHERE id = '${history}';
        UPDATE public."OperatingTakeoverBatch" SET status = 'under_review' WHERE id = '${history}';
        BEGIN
          UPDATE public."OperatingTakeoverBatch" SET status = 'partially_activated' WHERE id = '${ordinary}';
          RAISE EXCEPTION 'ISSUE417_RACE_UNSCOPED_BATCH_STATE';
        EXCEPTION WHEN check_violation THEN
          GET STACKED DIAGNOSTICS caught_constraint = CONSTRAINT_NAME;
          IF caught_constraint <> 'OperatingTakeoverBatch_status_check' THEN RAISE; END IF;
        END;
        ${activation(ordinary, 'activated')};
        BEGIN
          UPDATE public."OperatingTakeoverActivation" SET status = 'partially_activated' WHERE "batchId" = '${ordinary}';
          RAISE EXCEPTION 'ISSUE417_RACE_UNSCOPED_ACTIVATION_STATE';
        EXCEPTION WHEN check_violation THEN
          GET STACKED DIAGNOSTICS caught_constraint = CONSTRAINT_NAME;
          IF caught_constraint <> 'OperatingTakeoverActivation_partial_history_expense_check' THEN RAISE; END IF;
        END;
      END $verify$;
      COMMIT;
    `);

    // Connection A takes a fixed snapshot with no partial child. In connection
    // B the implicit transaction commits a valid partial child before A writes.
    stale = openStaleTransaction(owner, cert, history);
    const stalePid = await stale.ready;
    const committed = await sql(activation(history, 'partially_activated') + ' RETURNING pg_backend_pid();');
    const writerPid = committed.stdout.trim();
    assert.match(writerPid, /^[1-9]\d{0,9}$/u, 'ISSUE417_RACE_WRITER_SESSION');
    assert.notEqual(stalePid, writerPid, 'ISSUE417_RACE_DISTINCT_SESSIONS');
    const conflicting = await stale.mutate();
    if (conflicting.code !== 3 || conflicting.signal !== null || conflicting.sqlstate !== '40001') {
      throw Object.assign(new Error('ISSUE417_RACE_CONFLICT'), { sqlstate: conflicting.sqlstate });
    }

    const row = await sql(`
      DO $verify$
      DECLARE caught_constraint text;
      BEGIN
        BEGIN
          UPDATE public."OperatingTakeoverBatch" SET "sceneKeys" = '["ordinary"]' WHERE id = '${history}';
          RAISE EXCEPTION 'ISSUE417_RACE_LIVE_REWRITE';
        EXCEPTION WHEN check_violation THEN
          GET STACKED DIAGNOSTICS caught_constraint = CONSTRAINT_NAME;
          IF caught_constraint <> 'OperatingTakeoverBatch_partial_history_expense_scene_check' THEN RAISE; END IF;
        END;
      END $verify$;
      SELECT a.status = 'partially_activated' AND b.revision = 1 AND b.status = 'under_review'
        AND b."sceneKeys" = '["historical_expense"]'::jsonb
      FROM public."OperatingTakeoverActivation" a JOIN public."OperatingTakeoverBatch" b ON b.id = a."batchId"
      WHERE b.id = '${history}';
    `);
    assert.equal(row.stdout.trim(), 't', 'ISSUE417_RACE_PARTIAL_READBACK');
    return { oldStatesAllowed: true, validPartial: true, wrongScenesRejected: true,
      distinctSessions: true, staleSceneWriteSqlstate: '40001', fixtureCleaned: true };
  } finally {
    if (stale) await stale.abort();
    const cleaned = await sql(`
      BEGIN;
      DELETE FROM public."OperatingTakeoverActivation" WHERE "batchId" IN ('${ordinary}', '${history}');
      DELETE FROM public."OperatingTakeoverRow" WHERE id IN ('${ordinaryRow}', '${historyRow}');
      DELETE FROM public."OperatingTakeoverBatch" WHERE id IN ('${ordinary}', '${history}');
      COMMIT;
      SELECT NOT EXISTS (SELECT 1 FROM public."OperatingTakeoverBatch" WHERE id IN ('${ordinary}', '${history}'))
         AND NOT EXISTS (SELECT 1 FROM public."OperatingTakeoverRow" WHERE id IN ('${ordinaryRow}', '${historyRow}'))
         AND NOT EXISTS (SELECT 1 FROM public."OperatingTakeoverActivation" WHERE "batchId" IN ('${ordinary}', '${history}'));
    `);
    assert.equal(cleaned.stdout.trim(), 't', 'ISSUE417_RACE_FIXTURE_CLEANUP');
  }
}

module.exports = { verifyHistoryExpenseInvariant };
