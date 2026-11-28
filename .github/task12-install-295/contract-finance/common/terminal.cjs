'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {name,sha256,ledgerSha256}=require('./terminal.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseLedger='739451e0ff81740db53707acc013709436a746a2b019f99059c6375a5039a775';
function verify(file){
  assert.equal(name,'20261119003600_fund_balance_notice_lock');
  const bytes=fs.readFileSync(file);
  assert.equal(hash(bytes),sha256,'NOTICE293_TERMINAL_BYTES');
  assert.match(bytes.toString('utf8'),/REVOKE ALL ON FUNCTION public\.jg_lock_fund_balance_notice_v1\(text(?:,text){8}\) FROM PUBLIC;/u);
  return bytes;
}
function expected(ledger){
  assert.equal(ledger.length,292);
  assert.equal(hash(JSON.stringify(ledger)),baseLedger);
  const final=[...ledger,{name,sha256,finished:true,rolledBack:false}];
  assert.equal(hash(JSON.stringify(final)),ledgerSha256,'NOTICE293_EXPECTED_LEDGER');
  return final;
}
function stage(folder,file){
  const dir=path.join(folder,'migrations',name);
  fs.mkdirSync(dir,{mode:0o700});
  fs.writeFileSync(path.join(dir,'migration.sql'),verify(file),{mode:0o600,flag:'wx'});
}
const catalogSql=`SELECT jsonb_build_object(
  'keyUnprovisioned',NOT EXISTS(SELECT FROM public.jg_fund_balance_notice_witness),
  'workerAbsent',NOT EXISTS(SELECT FROM pg_roles WHERE rolname='jg_task419_notice_worker'),
  'ownership',EXISTS(SELECT FROM pg_class WHERE oid='public.jg_fund_balance_notice_witness'::regclass AND relowner=10),
  'restrictedLock',EXISTS(SELECT FROM pg_proc p WHERE p.oid=
    'public.jg_lock_fund_balance_notice_v1(text,text,text,text,text,text,text,text,text)'::regprocedure
    AND p.proowner=10 AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']
    AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee<>10)),
  'restrictedTrigger',EXISTS(SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgname='AuditLog_fund_balance_notice_dispatch_worker' AND t.tgrelid='public."AuditLog"'::regclass
      AND t.tgenabled='O' AND NOT t.tgisinternal AND p.proname='jg_guard_fund_balance_notice_dispatch_v1'
      AND p.proowner=10 AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']
      AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee<>10))
);`;
function exact(shape){return shape&&Object.keys(shape).sort().join(',')==='keyUnprovisioned,ownership,restrictedLock,restrictedTrigger,workerAbsent'&&Object.values(shape).every(value=>value===true);}
module.exports={verify,expected,stage,catalogSql,exact,hash,name,sha256,ledgerSha256};
