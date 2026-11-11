'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const file = './task16-current259-ordinary-archive-acl.cjs';
const ordinary = Object.freeze({ name: 'jg_fixture_app_abcdefabcdefabcdefabcdef', oid: '16392', login: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const catalogSha256 = 'a'.repeat(64);
const installXid = '12401';
const scope = Object.freeze({
  sourceSha: 'a'.repeat(40), runId: '12345678-1234-4234-8234-123456789abc', containerId: 'b'.repeat(64),
  databaseIdentity: Object.freeze({database: 'jg_task01_12345678123442348234123456789abc', databaseOid: '16384',
    namespaceOid: '2200', ownerOid: '10', systemIdentifier: '7200000000000000001'}),
  ordinary, installXid, catalogSha256, registeredFileSource: true, executionAllowed: false, nativeAdmission: false,
  upwardClosureSha256: 'c'.repeat(64), bindingSha256: 'd'.repeat(64), registrySha256: 'e'.repeat(64),
  pendingSha256: 'f'.repeat(64), originalRegistrySha256: '1'.repeat(64), sevenCatalogSha256: '2'.repeat(64),
  status: 'CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED'
});
const changes = [
  { relation: 'AuthRateLimit', column: null, relationOid: '17000', attnum: 0, privileges: ['DELETE'], rawAcl: null,
    acl: [['10','10','DELETE',false]] },
  { relation: 'ContractDraftAttachment', column: null, relationOid: '17001', attnum: 0, privileges: ['DELETE'], rawAcl: null,
    acl: [['10','10','DELETE',false]] },
  { relation: 'FileObject', column: 'bucket', relationOid: '17002', attnum: 5, privileges: ['INSERT','SELECT'], rawAcl: null, acl: [] },
];
const phases = ['current259-ordinary-acl-before','current259-ordinary-acl-write','current259-ordinary-acl-committed'];

function fixture(options={}) {
  const handle = Object.freeze({}), completion = Object.freeze({...scope,...options.completion});
  const source = Object.freeze({candidateSha: completion.sourceSha, tree:'b'.repeat(40), sourceSealSha256:'3'.repeat(64)});
  const roleCompletion = Object.freeze({ordinary});
  const calls = [];
  let claimed=false, closes=0;
  const check = () => { assert.equal(closes,0); options.check?.(); };
  const anchor = options.witness ?? (() => Object.freeze({guardSql: 'PERFORM 1;', sevenCatalogSql: "pg_catalog.repeat('2',64) /* pg_catalog.aclexplode(coalesce(a.attacl,'{}'::aclitem[])) jsonb_build_array(a.attnum,a.attacl) */", catalogSql: 'pg_catalog.repeat(\'a\',64) /* c.relacl::text a.attacl::text */'}));
  const view = {source,runId:completion.runId,check,resource:{containerId:completion.containerId,databaseName:scope.databaseIdentity.database,
    async execOwnerSql(sql,phase){
      calls.push({sql,phase});
      const n=phases.indexOf(phase);
      assert.notEqual(n,-1);
      const challenge=sql.match(/'challenge',\s*'([a-f0-9]{64})'/u)[1];
      const row={phase,challenge,backendPid:700+n,backendStart:`2026-11-11T10:00:0${n}.000001Z`,
        catalogSha256:n?hash('staged'):catalogSha256,protectedSha256:'3'.repeat(64),changes:n?null:structuredClone(changes),
        installXid:n?'12402':null,commitStatus:n===2?'committed':null};
      options.observe?.(row,n,sql);
      return {stdout:JSON.stringify(row)};
    }}};
  const ports = {
    './task16-current259-archive-install.cjs': {
      claimCurrent259ArchiveInstallation(value,h){
        assert.equal(value,completion);assert.equal(h,handle);assert.equal(claimed,false);
        claimed=true;
        return Object.freeze({source:Object.freeze(structuredClone(source)),completion,roleCompletion,check,ordinaryAclWitness:anchor});
      }
    },
    './task16-current259-owned-resource.cjs':{
      claimCurrent259TechnicalResource(h){assert.equal(h,handle);check();return view;},
      async closeCurrent259OwnedResource(h){assert.equal(h,handle);closes++;}
    }
  };
  const holder={exports:{}};
  new Function('require','module','__dirname',fs.readFileSync(path.resolve(__dirname,file),'utf8'))(
    name=>ports[name]??require(name),holder,__dirname);
  return {api:holder.exports,handle,completion,calls,closes:()=>closes};
}

test('same archive handle supplies only actual missing privileges then requires independent committed proof',async()=>{
  const f=fixture();
  const result=await f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle);
  assert.deepEqual(f.calls.map(row=>row.phase),phases);
  assert.match(f.calls[1].sql,/GRANT DELETE ON TABLE public\."AuthRateLimit" TO "jg_fixture_app_abcdefabcdefabcdefabcdef"/u);
  assert.match(f.calls[1].sql,/GRANT INSERT \("bucket"\), SELECT \("bucket"\) ON TABLE public\."FileObject"/u);
  assert.match(f.calls[1].sql,/^LOCK TABLE .*"jg_contract_direct_pending_binding_v1".* IN SHARE ROW EXCLUSIVE MODE NOWAIT;$/mu);
  assert.doesNotMatch(f.calls[1].sql,/GRANT UPDATE \("id"\) ON TABLE public\."FileObject"/u);
  assert.doesNotMatch(f.calls[0].sql,/^GRANT /mu);
  assert.doesNotMatch(f.calls[2].sql,/^GRANT /mu);
  assert.equal(result.installXid,'12402');
  assert.equal(result.executionAllowed,false);
  assert.equal(result.nativeAdmission,false);
  const lease=f.api.claimCurrent259OrdinaryArchiveAcl(result,f.handle);
  assert.equal(lease.archiveCompletion,f.completion);
  assert.equal(typeof lease.catalogSql,'string');
  assert.match(lease.protectedSql,/jg_contract_direct_pending_binding_v1/u);
  assert.doesNotMatch(lease.catalogSql+lease.protectedSql,/pg_authid|GRANT |rolpassword/u);
  assert.equal(result.catalogSql,undefined);
  assert.equal(result.protectedSql,undefined);
  assert.throws(()=>f.api.claimCurrent259OrdinaryArchiveAcl(result,f.handle));
  assert.equal(f.closes(),0);
});

for(const [label,override] of [
  ['archive without registered file source',{registeredFileSource:false}],
  ['technical payment runtime substituted for ordinary',{ordinary:{name:'jg_task01_runtime',oid:ordinary.oid,login:true}}]
])test(label+' never gets owner SQL',async()=>{
  const f=fixture({completion:override});
  await assert.rejects(f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle), /PRESTATE_REJECTED/u);
  assert.equal(f.calls.length,0);
  assert.equal(f.closes(),1);
});

for(const [label,alter] of [
  ['archive catalog drift', row=>{row.catalogSha256='0'.repeat(64);}],
  ['missing required relation or column', row=>{row.changes=null;}],
  ['unexpected FileObject id UPDATE', row=>{row.changes.push({relation:'FileObject',column:'id',relationOid:'17002',attnum:1,privileges:['UPDATE'],rawAcl:null,acl:[]});}],
  ['unexpected voucher createdAt access', row=>{row.changes.push({relation:'RegisteredPaymentVoucher',column:'createdAt',relationOid:'17003',attnum:1,privileges:['SELECT'],rawAcl:null,acl:[]});}],
  ['private upward intent access', row=>{row.changes.push({relation:'jg_contract_direct_upward_intent_receipt_v2',column:'id',relationOid:'17004',attnum:1,privileges:['SELECT'],rawAcl:null,acl:[]});}],
  ['an already granted permission repeated in the delta', row=>{row.changes[2].acl.push(['10',ordinary.oid,'SELECT',false]);}],
  ['two targets represented by one physical catalog row', row=>{row.changes[1].relationOid=row.changes[0].relationOid;}],
])test(label+' rejects before grant',async()=>{
  const f=fixture({observe(row,n){if(n===0)alter(row);}});
  await assert.rejects(f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle), /PRESTATE_REJECTED/u);
  assert.deepEqual(f.calls.map(row=>row.phase),phases.slice(0,1));
  assert.equal(f.closes(),1);
});

for(const [label,step,alter,attempts] of [
  ['role privilege drift rejected inside writer',1,()=>{throw new Error('synthetic privilege boundary');},2],
  ['reused archive transaction',1,row=>{row.installXid=installXid;},2],
  ['uncommitted write',2,row=>{row.commitStatus='aborted';},3],
  ['protected binding drift',1,row=>{row.protectedSha256='0'.repeat(64);},2],
  ['committed readback catalog drift',2,row=>{row.catalogSha256='0'.repeat(64);},3],
  ['readback backend reused',2,row=>{row.backendPid=701;},3],
  ['readback backend start reused',2,row=>{row.backendStart='2026-11-11T10:00:01.000001Z';},3],
])test(label+' closes the original scope and denies another write',async()=>{
  const f=fixture({observe(row,n){if(n===step)alter(row);}});
  await assert.rejects(f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle), /COMMIT_UNCONFIRMED/u);
  assert.equal(f.calls.length,attempts);
  assert.equal(f.closes(),1);
  await assert.rejects(f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle), /HANDLE/u);
  assert.equal(f.calls.length,attempts);
});

function archiveModel() {
  const filename=path.join(__dirname,'task16-current259-archive-install.test.cjs');
  const load=new Function('require','__dirname',fs.readFileSync(filename,'utf8')+'\nreturn model;')(
    name=>name==='node:test'?{test(){}}:require(name),__dirname);
  return load();
}

test('only the registered archive claim carries fixed source guards into the new stages',async()=>{
  const plain=archiveModel();
  const old=await plain.installCurrent259ArchiveAuthorities(plain.provisionResult,plain.handle);
  assert.equal(plain.claimCurrent259ArchiveInstallation(old,plain.handle).ordinaryAclWitness,undefined);
  const archive=archiveModel();
  const result=await archive.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(archive.provisionResult,archive.handle);
  const claim=archive.claimCurrent259ArchiveInstallation(result,archive.handle);
  assert.equal(typeof claim.ordinaryAclWitness,'function');
  assert.equal(result.ordinaryAclWitness,undefined);
  assert.throws(()=>claim.ordinaryAclWitness('foreign'));
  assert.throws(()=>claim.ordinaryAclWitness(phases[0],'GRANT arbitrary'));
  const f=fixture({witness:claim.ordinaryAclWitness});
  await f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle);
  assert.match(f.calls[0].sql,/jg_require_contract_direct_upward_source_v2\(\)/u);
  assert.match(f.calls[0].sql,/jg_file_business_binding_columns_before_registered_payment/u);
  assert.match(f.calls[1].sql,/SERIALIZABLE READ WRITE[\s\S]+WITH prior AS[\s\S]+COMMIT;$/u);
  assert.match(f.calls[2].sql,/REPEATABLE READ READ ONLY[\s\S]+pg_xact_status\('12402'::xid8\)[\s\S]+ROLLBACK;$/u);
});

test('a qualified already-present privilege vector emits no grants',async()=>{
  const f=fixture({observe(row,n){
    if(n===0)row.changes=[];
    else row.catalogSha256=catalogSha256;
  }});
  const result=await f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle);
  assert.deepEqual(f.calls.map(row=>row.phase),phases);
  assert.doesNotMatch(f.calls[1].sql,/^GRANT /mu);
  assert.equal(result.catalogSha256,catalogSha256);
});

for(const [label,step,required] of [
  ['changed default during ordinary ACL writer',1,['pg_catalog.pg_attrdef','attidentity','attgenerated']],
  ['changed index after ACL commit',2,['pg_catalog.pg_index','indisvalid','indisready']],
])test(label+' cannot acquire the next phase claim',async()=>{
  const archive=archiveModel();
  const result=await archive.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(archive.provisionResult,archive.handle);
  const claim=archive.claimCurrent259ArchiveInstallation(result,archive.handle);
  const f=fixture({witness:claim.ordinaryAclWitness,observe(_row,n,sql){
    if(n!==step)return;
    const post=Array.from(sql.matchAll(/DO \$ordinary_archive_acl\$([\s\S]+?)\$ordinary_archive_acl\$;/gu)).at(-1)?.[1]??'';
    // Model only a structural drift detected by the executed postimage guard.
    // Earlier guards, and fields only included in a final SELECT, cannot stop it.
    if(required.every(field=>post.includes(field)))throw new Error('synthetic seven-fragment drift');
  }});
  await assert.rejects(f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle), /COMMIT_UNCONFIRMED/u);
  assert.equal(f.calls.length,step+1);
  assert.equal(f.closes(),1);
});

test('the next-stage protection restores exactly the allowed seven-fragment ACL coordinates',async()=>{
  const archive=archiveModel();
  const result=await archive.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(archive.provisionResult,archive.handle);
  const claim=archive.claimCurrent259ArchiveInstallation(result,archive.handle);
  const aclChanges=[
    {relation:'ContractVersion',column:'originalSignedNumber',relationOid:'17030',attnum:19,
      privileges:['INSERT'],rawAcl:'{jg_fixture_app_abcdefabcdefabcdefabcdef=r/jg_task01_owner}',acl:[['10',ordinary.oid,'SELECT',false]]},
    {relation:'RegisteredPaymentVoucher',column:'executionId',relationOid:'17031',attnum:3,
      privileges:['SELECT'],rawAcl:null,acl:[]},
  ];
  const f=fixture({witness:claim.ordinaryAclWitness,observe(row,n){if(n===0)row.changes.push(...aclChanges);}});
  const completion=await f.api.installCurrent259OrdinaryArchiveAcl(f.completion,f.handle);
  const lease=f.api.claimCurrent259OrdinaryArchiveAcl(completion,f.handle);
  const prior=lease.protectedSql.match(/WITH prior AS \(SELECT \* FROM pg_catalog.jsonb_to_recordset\('([^']+)'::jsonb\)/u)?.[1];
  assert.ok(prior);
  assert.deepEqual(JSON.parse(prior),aclChanges);
  assert.match(lease.protectedSql,/pg_catalog\.pg_attrdef[\s\S]+pg_catalog\.pg_index/u);
  assert.match(lease.protectedSql,/p\.relation='ContractVersion' AND p\."column" IN \('originalSignedNumber'\)/u);
  assert.match(lease.protectedSql,/p\.relation='RegisteredPaymentVoucher' AND p\."column" IN \('contentSha256','executionId','fileId'\)/u);
  assert.match(lease.protectedSql,/p\."rawAcl"::aclitem\[\]/u);
  assert.ok(f.calls[2].sql.includes(lease.protectedSql+' IS DISTINCT FROM'));
});

test('only the fixed generated ACL admits the actual pristine workbench read columns',async()=>{
  const candidate={relation:'ContractBillRow',column:'contractBillId',relationOid:'17003',attnum:2,
    privileges:['SELECT'],rawAcl:null,acl:[]};
  const observe=(row,n)=>{if(!n)row.changes.push(candidate);};
  const old=fixture({observe});
  await assert.rejects(old.api.installCurrent259OrdinaryArchiveAcl(old.completion,old.handle),/PRESTATE_REJECTED/u);
  assert.equal(old.calls.length,1);
  const generated=fixture({observe});
  const result=await generated.api.installCurrent259GeneratedDraftOrdinaryAcl(generated.completion,generated.handle);
  assert.match(generated.calls[1].sql,/GRANT SELECT \("contractBillId"\) ON TABLE public\."ContractBillRow"/u);
  const lease=generated.api.claimCurrent259OrdinaryArchiveAcl(result,generated.handle);
  assert.equal(lease.generatedDraft,true);
  assert.equal(result.nativeAdmission,false);
  const bad=fixture({observe:(row,n)=>{if(!n)row.changes.push({...candidate,privileges:['UPDATE']});}});
  await assert.rejects(bad.api.installCurrent259GeneratedDraftOrdinaryAcl(bad.completion,bad.handle),/PRESTATE_REJECTED/u);
  assert.equal(bad.calls.length,1);
});
