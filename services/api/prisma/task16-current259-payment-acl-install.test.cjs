'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

function fixture(mode = '') {
  const calls = [];
  const competition = mode === 'competition';
  const handle = {}, token = Object.freeze({}), metadata = {parent:0};let forbidFull=false;
  const full=()=>assert.equal(forbidFull,false),issuer=(t,h)=>{assert.equal(t,token);assert.equal(h,handle);};
  const completion = { installXid: '451' };
  const profile = { schemaSha256: 'f'.repeat(64), ledger: [{ name: '20260101120000_schema', sha256: 'a'.repeat(64) }] };
  const source = { candidateSha: '1'.repeat(40), sourceSealSha256: 'a'.repeat(64), profile };
  const runId = '01234567-89ab-cdef-0123-456789abcdef';
  const identity = { database: 'jg_task01_0123456789abcdef0123456789abcdef',
    databaseOid: '16384', namespaceOid: '2200', ownerOid: '10', systemIdentifier: '7540000000000000000' };
  const roleCompletion = {
    sourceSha: source.candidateSha, runId, containerId: 'c'.repeat(64), databaseIdentity: identity,
    roles: [{ name: 'jg_task01_runtime', oid: '25004', limit: competition || mode === 'wrong-lane-mode' ? 2 : 1 },
      { name: 'jg_task01_observer', oid: '25005', limit: 1 }]
  };
  const projection = { phase: 'before', otherAclSha256: 'e'.repeat(64) };
  const resource = {
    databaseName: identity.database,
    containerId: roleCompletion.containerId,
    async execOwnerSql(sql, phase) {
      calls.push({ sql, phase });
      const write = phase === 'current259-payment-acl-write';
      const nonce = /'challenge','([a-f0-9]{64})'/u.exec(sql)[1];
      const catalog = {
        ...projection, nonce,
        extraFunctions: [], publicAclViolations: [],
        otherAclSha256: !write && mode === 'catalog-drift' ? 'f'.repeat(64) : projection.otherAclSha256,
        identity: { ...identity, backendPid: write || mode === 'same-backend' ? 11 : 12,
          backendStart: write || mode === 'same-backend' ? '2026-11-11T00:00:01.000000Z' : '2026-11-11T00:00:02.000000Z',
          readOnly: !write },
        writeXid: write ? '452' : null
      };
      if (write && mode === 'write-lost') throw new Error('private material');
      return { stdout: JSON.stringify({
        challenge: nonce, commitStatus: write ? null : 'committed', aclXid: '452',
        guardXmin: mode === 'xmin-drift' ? '99' : '452', catalog
      }) };
    }
  };
  let claimed = false;
  const inject = {
    './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer:issuer},
    './task16-current259-seven-install.cjs': {
      claimCurrent259SevenInstallation(input, actualHandle) {
        if (input !== completion || actualHandle !== handle || claimed) throw new Error('claim');
        claimed = true;
        return { source, roleCompletion, completion, check:full,checkContinuity(t){issuer(t,handle);metadata.parent++;},
          ...(competition ? { competition: true } : {}) };
      }
    },
    './task16-current259-owned-resource.cjs': {
      claimCurrent259TechnicalResource() {
        return { runId, source, resource, check:full,checkLifetime(){}, verifyFull:full };
      },
      async closeCurrent259OwnedResource() { calls.push({ phase: 'cleanup' }); }
    },
    './task16-current259-runtime-acl.cjs': {
      renderCurrent259RuntimeAcl(_, input) {
        assert.equal(input, roleCompletion);
        assert.equal(input.roles[0].limit, 1);
        return { sql: 'SELECT 1 /* runtime acl */;', witnessSql: 'SELECT 1 AS result;' };
      },
      renderCurrent259CompetitionRuntimeAcl(_, input) {
        assert.equal(input, roleCompletion);
        assert.deepEqual(input.roles.map(role => role.limit), [2, 1]);
        return { sql: 'SELECT 1 /* competition runtime acl */;', witnessSql: 'SELECT 1 AS result;' };
      }
    },
    './task16-current259-public-access.cjs': {
      renderCurrent259PublicAccess(input) {
        assert.equal(input, roleCompletion);
        assert.equal(roleCompletion.roles[0].limit, 1);
        return 'SELECT 1 /* public acl */;';
      },
      renderCurrent259CompetitionPublicAccess(input) {
        assert.equal(input, roleCompletion);
        assert.deepEqual(input.roles.map(role => role.limit), [2, 1]);
        return 'SELECT 1 /* competition public acl */;';
      }
    },
    './task16-current259-catalog.cjs': {
      parseCurrent259CatalogRead(stdout, request) {
        assert.equal(request.phase, 'before');
        assert.equal(request.identity.runtimeProfile, competition ? 'CURRENT259_TWO_RUNTIME_LANES' : undefined);
        const raw = JSON.parse(stdout);
        assert.equal(raw.nonce, request.nonce);
        assert.equal(raw.identity.readOnly, true);
        return { raw, status: 'CURRENT259_B7_CATALOG_MATCHED_NOT_ADMISSION' };
      }
    }
  };
  const file = require.resolve('./task16-current259-payment-acl-install.cjs');
  const originalLoad = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (parent?.filename === file && Object.hasOwn(inject, request)) return inject[request];
    return originalLoad.call(this, request, parent, ...rest);
  };
  let api;
  try {
    delete require.cache[file];
    api = require(file);
  } finally {
    Module._load = originalLoad;
  }
  return { api, calls, handle, token,metadata,forbidFull(){forbidFull=true;}, completion, roleCompletion };
}

test('installs ACL once, then reads the exact committed result from another backend', async () => {
  const f = fixture();
  const result = await f.api.installCurrent259PaymentAcl(f.completion, f.handle);
  assert.equal(result.status, 'CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION');
  assert.equal(result.installXid, '452');
  assert.equal(result.nativeAdmission, false);
  assert.deepEqual(f.calls.map(row => row.phase), ['current259-payment-acl-write', 'current259-payment-acl-committed']);
  const [write, read] = f.calls.map(row => row.sql);
  assert.match(write, /pg_xact_status\('451'::xid8\)/);
  assert.ok(write.indexOf('runtime acl') < write.indexOf('public acl'));
  assert.ok(write.indexOf('public acl') < write.indexOf('publicAclViolations'));
  assert.match(read, /pg_xact_status\('452'::xid8\)/);
  assert.doesNotMatch(write, /registered-impact-reader|CREATE.*jg_read_registered_payment_impacts/);
  const claim = f.api.claimCurrent259PaymentAcl(result, f.handle);
  assert.equal(claim.roleCompletion, f.roleCompletion);
  assert.equal(claim.catalogProof.raw.identity.readOnly, true);
  assert.throws(() => f.api.claimCurrent259PaymentAcl(result, f.handle));
});
test('a copied seven completion cannot run ACL SQL', async () => {
  const f = fixture();
  await assert.rejects(f.api.installCurrent259PaymentAcl({ ...f.completion }, f.handle), /claim/);
  assert.deepEqual(f.calls, []);
});
for (const [mode, expected] of [
  ['write-lost', ['current259-payment-acl-write', 'cleanup']],
  ['xmin-drift', ['current259-payment-acl-write', 'cleanup']],
  ['same-backend', ['current259-payment-acl-write', 'current259-payment-acl-committed', 'cleanup']],
  ['catalog-drift', ['current259-payment-acl-write', 'current259-payment-acl-committed', 'cleanup']]
]) test('stops once and closes owned resource after ' + mode, async () => {
  const f = fixture(mode);
  await assert.rejects(f.api.installCurrent259PaymentAcl(f.completion, f.handle),
    error => error.code === 'TASK16_CURRENT259_PAYMENT_ACL_COMMIT_UNCONFIRMED');
  assert.deepEqual(f.calls.map(row => row.phase), expected);
});

test('issued ACL continuity retains its original seven capability without full work',async()=>{
 const f=fixture(),result=await f.api.installCurrent259PaymentAcl(f.completion,f.handle),lease=f.api.claimCurrent259PaymentAcl(result,f.handle);
 f.forbidFull();lease.checkContinuity(f.token);assert.equal(f.metadata.parent,1);assert.throws(()=>lease.check());
 assert.throws(()=>lease.checkContinuity({...f.token}));
});


test('claimed competition uses only the fixed two-lane ACL and carries the same profile into catalog readback', async () => {
  const f = fixture('competition');
  const installed = await f.api.installCurrent259PaymentAcl(f.completion, f.handle);
  assert.equal(installed.status, 'CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION');
  assert.match(f.calls[0].sql, /competition runtime acl/u);
  assert.match(f.calls[0].sql, /competition public acl/u);
  assert.equal(f.api.claimCurrent259PaymentAcl(installed, f.handle).request.identity.runtimeProfile, 'CURRENT259_TWO_RUNTIME_LANES');
});

test('a two-lane receipt without the genuine competition claim stops before owner SQL', async () => {
  const f = fixture('wrong-lane-mode');
  await assert.rejects(f.api.installCurrent259PaymentAcl(f.completion, f.handle), { code: 'TASK16_CURRENT259_PAYMENT_ACL_NOT_ATTEMPTED' });
  assert.deepEqual(f.calls, [{ phase: 'cleanup' }]);
});
