'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const name='20261119003700_company_transfer_ordinary_loan_payout_checkpoints';
const digest='0060614fc78fc16eb0f0e223a36545fffc3ca0db76e563c087f52fdcdde4364a';
const prior='042901da1b14312d69d8adeced56cddde1a91fdd3afa9bb83b21ea6de58d91fe';
const hash=value=>createHash('sha256').update(value).digest('hex');
const ledgerHash=rows=>hash(JSON.stringify(rows));
function expected(ledger){
 assert.equal(ledger.length,293);
 assert.equal(ledgerHash(ledger),prior);
 return [...ledger,{name,sha256:digest,finished:true,rolledBack:false}];
}
function verify(file='/qualification/payout-terminal.sql'){
 const bytes=fs.readFileSync(file);
 assert.equal(hash(bytes),digest);
 return bytes;
}
function stage(folder){
 const dir=path.join(folder,'migrations',name);
 fs.mkdirSync(dir,{mode:0o700});
 fs.writeFileSync(path.join(dir,'migration.sql'),verify(),{flag:'wx',mode:0o600});
}
const catalogSql=`SELECT jsonb_build_object(
  'exactFunction',EXISTS(SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid='public.jg_company_transfer_ordinary_payout_checkpoints(text,text,text)'::regprocedure
      AND p.proowner=10 AND p.prokind='f' AND p.prosecdef AND p.proretset AND l.lanname='plpgsql'
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7296038bd7811de0918aa06044ce0b824f4010d18ca5997df77139ceb9a7d29f'
      AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>10)),
  'scopeEmpty',NOT EXISTS(SELECT FROM public.jg_company_transfer_loan_repayment_scope_v1),
  'fixtureRolesAbsent',NOT EXISTS(SELECT FROM pg_roles WHERE rolname ~ '^finance_(runtime|untrusted)_[a-f0-9]{32}$')
);`;
function valid(catalog){return JSON.stringify(Object.keys(catalog).sort())===JSON.stringify(['exactFunction','fixtureRolesAbsent','scopeEmpty'])&&Object.values(catalog).every(value=>value===true);}
module.exports={name,digest,expected,verify,stage,ledgerHash,catalogSql,valid};
