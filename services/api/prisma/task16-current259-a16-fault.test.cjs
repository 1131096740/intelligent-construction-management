'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const file = './task16-current259-a16-fault.cjs';
const scope = () => ({
  mode: 'cancel-commit',
  nonce: 'a'.repeat(64),
  database: { name: 'jg_task01_0123456789abcdef0123456789abcdef', oid: '16384',
    namespaceOid: '2200', systemIdentifier: '7540000000000000000' },
  runtime: { oid: '25004', pid: 112, startedAt: '2026-11-11T00:00:01.123456Z',
    clientAddress: '172.17.0.1', clientPort: 49152 }
});

test('renders separate read-only readiness and one transaction holding the fixed commit barrier', () => {
  const { createCurrent259A16FaultPlan } = require(file);
  const plan = createCurrent259A16FaultPlan(scope());
  assert.match(plan.readySql, /^BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;/u);
  assert.doesNotMatch(plan.readySql, /LOCK TABLE|pg_cancel_backend|pg_terminate_backend/u);
  assert.equal(plan.parseReady(JSON.stringify({ nonce: scope().nonce, state: 'waiting', owner: null })), null);
  assert.match(plan.ownerSql, /^BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE;/u);
  assert.match(plan.ownerSql, /LOCK TABLE public\."OperatingImpactEntry" IN ACCESS EXCLUSIVE MODE NOWAIT;/u);
  assert.match(plan.ownerSql, /pg_cancel_backend\(112\)/u);
  assert.doesNotMatch(plan.ownerSql, /pg_terminate_backend/u);
  assert.match(plan.ownerSql, /ROLLBACK;$/u);
});

const owner = { pid: 120, startedAt: '2026-11-11T00:00:10.123456Z' };
const readyOutput = () => JSON.stringify({ nonce: scope().nonce, state: 'ready', owner });
const result = mode => ({
  nonce: scope().nonce, mode, state: mode === 'cancel-commit' ? 'commit-cancelled' : 'commit-disconnected',
  owner, runtimePid: scope().runtime.pid, runtimeStartedAt: scope().runtime.startedAt,
  transactionId: '5432', commitStartedAt: '2026-11-11T00:00:12.012345Z'
});

test('requires the original ready witness and keeps cancel and disconnect evidence distinct', () => {
  const { createCurrent259A16FaultPlan } = require(file);
  for (const mode of ['cancel-commit', 'disconnect-commit']) {
    const plan = createCurrent259A16FaultPlan({ ...scope(), mode });
    const ready = plan.parseReady(readyOutput());
    if (mode === 'disconnect-commit') {
      assert.match(plan.ownerSql, /pg_terminate_backend\(112\)/u);
      assert.doesNotMatch(plan.ownerSql, /pg_cancel_backend/u);
    }
    const copied = createCurrent259A16FaultPlan({ ...scope(), mode });
    const copiedReady = copied.parseReady(readyOutput());
    assert.throws(() => copied.parseOutcome(JSON.stringify(result(mode)), { ...copiedReady }), /TASK16_CURRENT259_A16_FAULT/u);
    assert.throws(() => copied.parseOutcome(JSON.stringify(result(mode)), copiedReady), /TASK16_CURRENT259_A16_FAULT/u);
    assert.deepEqual(plan.parseOutcome(JSON.stringify(result(mode)), ready), {
      mode, state: result(mode).state, transactionId: '5432', executionAllowed: false, nativeAdmission: false
    });
    assert.throws(() => plan.parseOutcome(JSON.stringify(result(mode)), ready), /TASK16_CURRENT259_A16_FAULT/u);
  }
});

test('scopes both signals to the admitted runtime COMMIT blocked by the original owner', () => {
  const { createCurrent259A16FaultPlan } = require(file);
  const { ownerSql } = createCurrent259A16FaultPlan(scope());
  assert.match(ownerSql, /a\.pid=112 AND a\.datid=16384::oid AND a\.usesysid=25004::oid/u);
  assert.match(ownerSql, /pg_catalog\.host\(a\.client_addr\)='172\.17\.0\.1' AND a\.client_port=49152/u);
  assert.match(ownerSql, /a\.xact_start=observed\.xact_start AND a\.query_start=observed\.query_start AND a\.backend_xid=observed\.backend_xid/u);
  assert.match(ownerSql, /a\.state='active' AND a\.wait_event_type='Lock' AND a\.wait_event='relation'/u);
  assert.match(ownerSql, /pg_catalog\.upper\(pg_catalog\.btrim\(a\.query\)\) IN \('COMMIT','COMMIT;'\)/u);
  assert.match(ownerSql, /pg_catalog\.pg_blocking_pids\(a\.pid\)=ARRAY\[pg_backend_pid\(\)\]/u);
  assert.match(ownerSql, /l\.database=16384::oid AND l\.relation=locked_relation AND l\.mode='AccessShareLock' AND NOT l\.granted/u);
  assert.match(ownerSql, /THEN pg_catalog\.pg_cancel_backend\(112\) ELSE false END\)/u);
  assert.equal(ownerSql.match(/pg_cancel_backend\(/gu).length, 1);
  assert.doesNotMatch(ownerSql, /COMMIT PREPARED|EXECUTE format|CREATE (?:TABLE|TRIGGER)|\bGRANT\b/u);
  assert.match(ownerSql, /a\.state='idle' AND a\.xact_start IS NULL AND a\.backend_xid IS NULL/u);
});

test('rejects unsafe plans before observing the owner or target', () => {
  const { createCurrent259A16FaultPlan } = require(file);
  let getterCalls = 0;
  const bad = scope();
  Object.defineProperty(bad.runtime, 'pid', { get() { getterCalls++; return 112; } });
  for (const input of [bad, { ...scope(), mode: 'kill' },
    { ...scope(), runtime: { ...scope().runtime, clientAddress: '127.0.0.1' } },
    { ...scope(), runtime: { ...scope().runtime, oid: '25004;COMMIT' } },
    { ...scope(), runtime: { ...scope().runtime, startedAt: '2026-02-30T00:00:01.123456Z' } }]) {
    assert.throws(() => createCurrent259A16FaultPlan(input), /TASK16_CURRENT259_A16_FAULT/u);
  }
  assert.equal(getterCalls, 0);
});

test('stops at invalid readiness and spends the original receipt on a drifting committed result', () => {
  const { createCurrent259A16FaultPlan } = require(file);
  const plan = createCurrent259A16FaultPlan(scope());
  assert.throws(() => plan.parseReady(JSON.stringify({ nonce: scope().nonce, state: 'invalid', owner })), /TASK16_CURRENT259_A16_FAULT/u);
  assert.throws(() => plan.parseReady(readyOutput()), /TASK16_CURRENT259_A16_FAULT/u);
  for (const drift of [{ nonce: 'b'.repeat(64) }, { mode: 'disconnect-commit' }, { runtimePid: 113 },
    { owner: { ...owner, startedAt: '2026-11-11T00:00:11.123456Z' } }, { transactionId: '0' },
    { commitStartedAt: owner.startedAt }]) {
    const current = createCurrent259A16FaultPlan(scope());
    const ready = current.parseReady(readyOutput());
    assert.throws(() => current.parseOutcome(JSON.stringify({ ...result('cancel-commit'), ...drift }), ready), /TASK16_CURRENT259_A16_FAULT/u);
    assert.throws(() => current.parseOutcome(JSON.stringify(result('cancel-commit')), ready), /TASK16_CURRENT259_A16_FAULT/u);
  }
});

test('only the fixed cancellation relay renders loopback runtime coordinates',()=>{
 const {createCurrent259A16FaultPlan}=require(file);
 const original=scope(),runtime={...original.runtime,clientAddress:'127.0.0.1'};
 assert.throws(()=>createCurrent259A16FaultPlan({...original,runtime}),/TASK16_CURRENT259_A16_FAULT/u);
 const relay={...original,mode:'cancel-commit',transport:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS',runtime};
 assert.match(createCurrent259A16FaultPlan(relay).ownerSql,/pg_catalog.host\(a.client_addr\)='127\.0\.0\.1'/u);
 assert.throws(()=>createCurrent259A16FaultPlan({...relay,mode:'disconnect-commit'}),/TASK16_CURRENT259_A16_FAULT/u);
 assert.throws(()=>createCurrent259A16FaultPlan({...relay,runtime:original.runtime}),/TASK16_CURRENT259_A16_FAULT/u);
});
