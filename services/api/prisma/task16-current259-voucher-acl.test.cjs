'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { current259VoucherAcl } = require('./task16-current259-voucher-acl.cjs');
const baseline = require('./task16-registered-access.json');

test('the fixed voucher profile adds only the real upload, attach and collision permissions', () => {
  assert.throws(() => current259VoucherAcl({role:'custom'}));
  const profile = current259VoucherAcl();
  assert.ok(Object.isFrozen(profile));
  assert.equal(profile.tables.filter(row=>row.select.length).length,78);
  assert.equal(profile.tables.reduce((sum,row)=>sum+row.select.length,0),116);
  for(const table of profile.tables){
    const before=baseline.runtime.tables.find(row=>row.table===table.table);
    for(const operation of ['select','insert','update']){
      assert.ok(table[operation].every(column=>!before?.[operation]?.includes(column)));
    }
  }
  const file=profile.tables.find(row=>row.table==='FileObject');
  const payment=profile.tables.find(row=>row.table==='PaymentExecution');
  const voucher=profile.tables.find(row=>row.table==='RegisteredPaymentVoucher');
  assert.equal(file.select.length,12);
  assert.equal(file.insert.length,10);
  assert.deepEqual(file.update,['createdAt']);
  assert.deepEqual(payment.update,['id']);
  assert.deepEqual(voucher.insert,['contentSha256','executionId','fileId','uploadedByUserId']);
  assert.equal(profile.functions.length,23);
  assert.ok(!profile.functions.some(fn=>/exclusive_file_business_binding|voucher_insert/.test(fn)));
});

test('the voucher guards preserve the former roles and prove the exact additional grants', () => {
  const profile=current259VoucherAcl();
  const before=profile.preimageSql(baseline.functionProofs);
  const continuity=profile.continuitySql(baseline.functionProofs);
  assert.match(before,/jg_contract_direct_upward_closure_v2/);
  assert.match(before,/jg_contract_direct_pending_binding_v1/);
  assert.match(before,/pg_catalog\.aclexplode/);
  assert.match(before,/CONTRACT_FILE_CALLER/u);
  assert.match(before,/BEFORE_IMAGE/u);
  assert.match(profile.lockSql,/jg_contract_direct_pending_binding_v1 IN SHARE MODE NOWAIT/u);
  assert.match(profile.bindingSha256Sql,/to_jsonb\(b\)::text/u);
  for(const proof of [before,continuity]){
    assert.match(proof,/anchorNamespaceOid/u);
    assert.match(proof,/fileCallerOids/u);
    assert.match(proof,/p\.proargnames/u);
    assert.match(proof,/p\.proallargtypes/u);
    assert.match(proof,/p\.proargmodes/u);
    assert.match(proof,/p\.proargdefaults IS NULL/u);
  }
  assert.throws(()=>profile.continuitySql(baseline.functionProofs.slice(0,1)),/CURRENT259_VOUCHER_ACL/u);
  assert.match(continuity,/is_grantable/u);
  assert.match(continuity,/tgtype/u);
  assert.match(continuity,/tgqual IS NULL/u);
  assert.match(continuity,/tgenabled='A'/u);
  assert.match(profile.guardSql,/session_user = 'jg_task01_runtime'/u);
  assert.match(profile.guardSql,/NEW\."supersedesFileObjectId" IS NOT NULL/u);
  assert.match(profile.guardSql,/NEW\."storageStatus" IS DISTINCT FROM 'active'/u);
  assert.equal((profile.guardSql.match(/ENABLE ALWAYS TRIGGER/g)||[]).length,3);
  assert.equal((profile.guardSql.match(/BEFORE UPDATE/g)||[]).length,2);
  assert.equal((profile.guardSql.match(/BEFORE INSERT/g)||[]).length,1);
  assert.doesNotMatch(profile.guardSql,/^GRANT |SECURITY DEFINER/mu);
});
