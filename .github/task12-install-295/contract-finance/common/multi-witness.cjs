'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const name='20261119003800_company_transfer_ordinary_loan_multi_witness';
const digest='e5b56cb299eb4a51eb094267fbf302b6fa6b40b31c0337c6dfcf628694d5de25';
const prior='1b66e6c98907b9c06d64ad2294e203a877157fcb0ca463b4989657ea1d86396d';
const final='b0d398a46c4c6a3209e1448ddd415938ea95425c3d823f1f8a77d81dde396f2d';
const hash=value=>createHash('sha256').update(value).digest('hex');
const ledgerHash=rows=>hash(JSON.stringify(rows));
function expected(ledger){
  assert.equal(ledger.length,294);
  assert.equal(ledgerHash(ledger),prior);
  const rows=[...ledger,{name,sha256:digest,finished:true,rolledBack:false}];
  assert.equal(ledgerHash(rows),final);
  return rows;
}
function verify(file='/qualification/multi-witness.sql'){
  const bytes=fs.readFileSync(file);
  assert.equal(hash(bytes),digest,'MULTI_WITNESS_295_SQL_BYTES');
  return bytes;
}
function stage(folder){
  const dir=path.join(folder,'migrations',name);
  fs.mkdirSync(dir,{mode:0o700});
  fs.writeFileSync(path.join(dir,'migration.sql'),verify(),{flag:'wx',mode:0o600});
}
const relation='public.jg_company_transfer_loan_repayment_scope_v1';
const catalogSql=`
WITH relation AS (SELECT * FROM pg_class WHERE oid='${relation}'::regclass)
SELECT jsonb_build_object(
  'ownerOnly',r.relkind='r' AND r.relowner=10 AND NOT EXISTS (
    SELECT FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) acl WHERE acl.grantee<>10
  ) AND NOT EXISTS (
    SELECT FROM pg_attribute a,LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=r.oid AND acl.grantee<>10
  ),
  'logicalConstraints',(SELECT jsonb_agg(jsonb_build_object('type',c.contype,'column',a.attname,
     'valid',c.convalidated AND NOT c.condeferrable) ORDER BY c.contype,a.attname)
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND c.conkey=ARRAY[a.attnum]
    WHERE c.conrelid=r.oid AND c.contype IN ('p','u')),
  'trueMarker',EXISTS(SELECT FROM pg_constraint c WHERE c.conrelid=r.oid AND c.contype='c'
    AND c.convalidated AND pg_get_expr(c.conbin,c.conrelid)='singleton'),
  'scopeEmpty',NOT EXISTS(SELECT FROM ${relation})
) FROM relation r;`;
function valid(catalog,multi){
  const expected=multi?[['p','request_key'],['u','approval_id'],['u','repayment_id']]:[['p','singleton']];
  return catalog?.ownerOnly===true&&catalog.trueMarker===true&&catalog.scopeEmpty===true&&
    catalog.logicalConstraints?.length===expected.length&&catalog.logicalConstraints.every(({type,column,valid},i)=>
      valid===true&&type===expected[i][0]&&column===expected[i][1]);
}
const twoRowRollbackSql=`
BEGIN;
DO $scope_probe$
DECLARE changed integer;
BEGIN
  INSERT INTO ${relation}(database_oid,system_identifier,server_port,runtime_role_oid,
    applicant_id,loan_id,request_key,amount_cents)
  SELECT db.oid,ctl.system_identifier::text,inet_server_port(),runtime.oid,
    'probe-applicant','probe-same-loan',entry.request_key,entry.cents
  FROM pg_database db CROSS JOIN pg_control_system() ctl CROSS JOIN pg_roles runtime
  CROSS JOIN (VALUES('probe-request-a',6000::bigint),('probe-request-b',4000::bigint)) entry(request_key,cents)
  WHERE db.datname=current_database() AND runtime.rolname='jg_task01_runtime';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>2 OR (SELECT count(*) FROM ${relation} WHERE singleton AND loan_id='probe-same-loan')<>2
     OR (SELECT sum(amount_cents) FROM ${relation})<>10000 THEN
    RAISE EXCEPTION 'company_transfer_multi_witness_two_rows';
  END IF;
  BEGIN
    UPDATE ${relation} SET request_key='probe-request-a' WHERE request_key='probe-request-b';
    RAISE EXCEPTION 'company_transfer_multi_witness_duplicate_request';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$scope_probe$;
SELECT jsonb_build_object('twoSameLoanRows',true,'duplicateRequestRejected',true);
ROLLBACK;
`;
module.exports={name,digest,final,expected,verify,stage,ledgerHash,catalogSql,valid,twoRowRollbackSql,relation};
