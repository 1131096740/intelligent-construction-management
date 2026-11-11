'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=name=>readFileSync(path.join(__dirname,name),'utf8');
const model=new Function('require',read('task16-current259-seven-preimage.test.cjs')+'\nreturn syntheticObservation;')(name=>name==='node:test'?()=>{}:require(name));
const candidateSha='b'.repeat(40),sealSha256='a'.repeat(64);
const source={candidateSha,sourceSealSha256:sealSha256,profile:qualifyCurrent259Source({candidateSha,sealSha256,
 schemaSha256:hash(read('schema.prisma')),migrations:readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().map(name=>({path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(read(`migrations/${name}/migration.sql`))}))})};
const runId='12345678-1234-4234-8234-123456789012',database='jg_task01_'+runId.replaceAll('-','');
const containerId='c'.repeat(64),nonce='d'.repeat(64);
const identity={database,databaseOid:'90',namespaceOid:'2200',ownerOid:'10',systemIdentifier:'1234567890123456789'};
const roles=[{name:'jg_task01_runtime',oid:'110',xmin:'201',login:true,limit:1,password:'scram'},{name:'jg_task01_observer',oid:'111',xmin:'201',login:true,limit:1,password:'scram'}];
const ordinary={name:'jg_fixture_app_'+'e'.repeat(24),oid:'100',login:true,limit:0,password:'absent'};
const databaseAcl={after:[{name:database,oid:'90',owner:'10',acl:[['10','100','CONNECT',false]]}]};
const oldBody=read('migrations/20261108220000_contract_archive_v2_authority/migration.sql').match(/EXECUTE \$new_registry\$CREATE FUNCTION public\.jg_file_business_binding_columns\(\)[^\n]+? AS \$body\$(.*?)\$body\$\$new_registry\$/u)[1];
const registry={namespaceOid:'2200',ownerOid:'10',publicDefault:null,globalDefault:null,alias:null,publicRoutine:{
 oid:'800',name:'jg_file_business_binding_columns',config:null,rawAcl:['owner','ordinary'],acl:[['10','10','EXECUTE',false],['10','100','EXECUTE',false]],shapeVerified:true,
 definition:{pronamespace:'2200',proowner:'10',prosrc:oldBody},
}};
const roleCompletion=Object.freeze({status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:candidateSha,runId,containerId,databaseIdentity:identity,ordinary,roles,databaseAcl,commitXid:'201'});
function fixture(mutate,competition=false){
 const suppliedRoles=competition?{...roleCompletion,roles:[{...roles[0],limit:2},roles[1]]}:roleCompletion;
 const token=Object.freeze({}),metadata={parent:0};let forbidFull=false;
 const full=()=>{assert.equal(forbidFull,false);};
 const issuer=(t,h)=>{assert.equal(t,token);assert.equal(h,handle);};
 const calls=[],handle=Object.freeze({}),secretClaim={source,completion:suppliedRoles,competition,check:full,checkContinuity(t){issuer(t,handle);metadata.parent++;}};
 let closed=false,claimed=false;
 const view={source,runId,verifyFull:full,check:full,checkLifetime(){assert.equal(closed,false);},resource:{containerId,databaseName:database,async execOwnerSql(sql,phase){
  const index=calls.length;calls.push({sql,phase});
  const row={nonce,phase,backendPid:11+index,backendStart:`2026-11-11T04:00:0${index}.000000Z`,
   pre:index===0?model():null,registry:index===0?registry:null,fileRoles:index===0?['10','100']:null,
   catalogSha256:(index?'6':'5').repeat(64),installXid:index?'202':null,commitStatus:index===2?'committed':null};
  mutate?.(row,index);
  return {stdout:JSON.stringify(row)+'\n'};
 }}};
 const imports={
  './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer:issuer},
  './task16-current259-role-provision.cjs':{claimCurrent259ProvisionedRoles(completion,owned){assert.equal(completion,suppliedRoles);assert.equal(owned,handle);assert.equal(claimed,false);claimed=true;return secretClaim;}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(owned){assert.equal(owned,handle);assert.equal(closed,false);return view;},async closeCurrent259OwnedResource(owned){assert.equal(owned,handle);closed=true;}},
  'node:crypto':{...require('node:crypto'),randomBytes:()=>Buffer.from(nonce,'hex')},
 };
 const holder={exports:{}};
 new Function('require','module','__dirname',read('task16-current259-seven-install.cjs'))(name=>imports[name]??require(name),holder,__dirname);
 return {api:holder.exports,handle,token,metadata,suppliedRoles,forbidFull(){forbidFull=true;},calls,closed:()=>closed};
}

test('installs the pinned seven fragments in one write and issues only a same-resource committed continuation',async()=>{
 const f=fixture();const result=await f.api.installCurrent259SevenFragments(roleCompletion,f.handle);
 assert.deepEqual(f.calls.map(x=>x.phase),['current259-seven-before','current259-seven-install','current259-seven-committed']);
 const write=f.calls[1].sql;
 const scopedRole="pg_catalog.set_config('jg.task16_runtime_role','jg_task01_runtime',true)";
 const roleSetting=write.indexOf(scopedRole);
 assert.ok(roleSetting>write.indexOf("RAISE EXCEPTION 'CURRENT259_SEVEN_INSTALL_SCOPE'")&&roleSetting<write.indexOf('ADD COLUMN "writeRevision"'),'binds the verified runtime role locally before the first fragment');
 assert.ok(f.calls.filter((_,index)=>index!==1).every(call=>!call.sql.includes(scopedRole)));
 const ordered=['ADD COLUMN "writeRevision"','CREATE TABLE public."RegisteredContractHistoryRevision"','jg_registered_timestamp_iso','jg_registered_payment_source_matches','CREATE FUNCTION public."jg_assert_registered_payment_relationship"','CREATE FUNCTION public."jg_registered_payment_fact_guard"','RENAME TO jg_file_business_binding_columns_before_registered_payment'];
 let position=-1;
 for(const marker of ordered){const next=write.indexOf(marker,position+1);assert.ok(next>position,marker);position=next;}
 assert.equal([...write.matchAll(/^COMMIT;/gmu)].length,1);
 assert.match(f.calls[2].sql,/pg_xact_status\('202'::xid8\)/u);
 assert.doesNotMatch(write,/REVOKE .*ON ALL|GRANT .* TO jg_task01_observer/u);
 assert.match(write,/OR EXISTS\(SELECT 1 FROM public\.jg_contract_direct_archive_intent_binding_v1\)/u);
 assert.match(write,/OR EXISTS\(SELECT 1 FROM public\.jg_contract_direct_upward_execution_binding_v2\)/u);
 assert.doesNotMatch(write,/jg_install_contract_direct_archive_outside_v1|jg_install_contract_direct_upward_v2/u);
 assert.ok(write.includes("((witness->'publicRoutine'->'definition')-'prosrc') IS DISTINCT FROM ((witness->'alias'->'definition')-'prosrc')"));
 assert.equal(result.nativeAdmission,false);
 assert.throws(()=>f.api.claimCurrent259SevenInstallation({...result},f.handle),/CURRENT259_SEVEN_INSTALL_HANDLE/u);
 const lease=f.api.claimCurrent259SevenInstallation(result,f.handle);
 assert.equal(lease.roleCompletion,roleCompletion);
 assert.equal(lease.source,source);
 assert.equal(lease.completion.installXid,'202');
 assert.throws(()=>f.api.claimCurrent259SevenInstallation(result,f.handle),/CURRENT259_SEVEN_INSTALL_HANDLE/u);
});


for(const [name,index,mutate,calls] of [
 ['preimage guard body drift',0,row=>{row.pre.guards[0].bodySha256='0'.repeat(64);},1],
 ['an unexpected global default ACL',0,row=>{row.registry={...row.registry,globalDefault:{oid:'401',rawAcl:['unexpected'],acl:[['10','222','EXECUTE',false]]}};},1],
 ['a Task16 login in the frozen file-callers closure',0,row=>{row.fileRoles=['10','100','110'];},1],
 ['role write XID reused',1,row=>{row.installXid='201';},2],
 ['committed connection reused',2,row=>{row.backendPid=12;row.backendStart='2026-11-11T04:00:01.000000Z';},3],
 ['postcommit catalog drift',2,row=>{row.catalogSha256='7'.repeat(64);},3],
 ['unconfirmed PostgreSQL transaction',2,row=>{row.commitStatus='aborted';},3],
])test(`does not issue seven-fragment continuation for ${name}`,async()=>{
 const f=fixture((row,phase)=>{if(phase===index)mutate(row);});
 const code=index===0?'PRESTATE_REJECTED':'COMMIT_UNCONFIRMED';
 await assert.rejects(f.api.installCurrent259SevenFragments(roleCompletion,f.handle),new RegExp(`CURRENT259_SEVEN_INSTALL_${code}`));
 assert.equal(f.calls.length,calls);
 assert.equal(f.closed(),true);
});

test('issued seven continuity retains the original role capability and rejects copied tokens without full work',async()=>{
 const f=fixture(),result=await f.api.installCurrent259SevenFragments(roleCompletion,f.handle),lease=f.api.claimCurrent259SevenInstallation(result,f.handle);
 f.forbidFull();lease.checkContinuity(f.token);assert.equal(f.metadata.parent,1);assert.throws(()=>lease.check());
 assert.throws(()=>lease.checkContinuity({...f.token}));
});

test('voucher seven claim supplies the exact installed stable catalog witness only once to the same handle',async()=>{
 const f=fixture(undefined,true);
 const result=await f.api.installCurrent259SevenFragments(f.suppliedRoles,f.handle);
 const claim=f.api.claimCurrent259VoucherSevenInstallation;
 assert.equal(typeof claim,'function');
 assert.throws(()=>claim(result,{}),/CURRENT259_SEVEN_INSTALL_HANDLE/u);
 assert.throws(()=>claim({...result},f.handle),/CURRENT259_SEVEN_INSTALL_HANDLE/u);
 const lease=claim(result,f.handle);
 assert.equal(lease.completion,result);
 assert.match(lease.voucherPreimageSql,/SET LOCAL search_path=pg_catalog,public,pg_temp;/u);
 assert.match(lease.voucherPreimageSql,/SET LOCAL quote_all_identifiers=off;/u);
 const original=f.calls[2].sql.split("'catalogSha256',")[1].split(",'installXid'")[0];
 assert.ok(lease.voucherPreimageSql.includes(original));
 assert.ok(lease.voucherPreimageSql.includes(result.catalogSha256));
 assert.match(lease.voucherPreimageSql,/pg_temp\.jg_c259_voucher_preimage/u);
 assert.throws(()=>f.api.claimCurrent259SevenInstallation(result,f.handle),/CURRENT259_SEVEN_INSTALL_HANDLE/u);
 assert.throws(()=>claim(result,f.handle),/CURRENT259_SEVEN_INSTALL_HANDLE/u);

 const single=fixture();
 const other=await single.api.installCurrent259SevenFragments(single.suppliedRoles,single.handle);
 assert.throws(()=>single.api.claimCurrent259VoucherSevenInstallation(other,single.handle),/CURRENT259_SEVEN_INSTALL_HANDLE/u);
 assert.equal(single.api.claimCurrent259SevenInstallation(other,single.handle).voucherPreimageSql,undefined);
});
