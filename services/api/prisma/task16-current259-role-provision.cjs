'use strict';
const {assertCurrent259BusinessIssuer:businessIssuer}=require('./task16-current259-business-continuity.cjs');

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
// The technical profile owns the fixed core-import order.
const {claimCurrent259TechnicalSupply,claimCurrent261AuthOnlyDiagnosticSupply}=require('./local-staged-current259-profile.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');

const OWNER='jg_task01_owner';
const {isExactCurrentArchiveProfile,PAYMENT261_RUNTIME_PROFILE}=require('./task16-current259-profile.cjs');
const {isExactCurrentPaymentRuntimeSource,isCurrentPaymentRuntimeMode,PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
const ROLE_SPECS=Object.freeze([
 ['jg_c259_outside_executor_login',true],['jg_c259_outside_executor_owner',false],
 ['jg_c259_outside_issuer_login',true],['jg_c259_outside_issuer_owner',false],
 ['jg_c259_upward_issuer_login',true],['jg_c259_upward_issuer_owner',false],['jg_c259_upward_runtime_login',true],
 ['jg_task01_observer',true,'observer'],['jg_task01_runtime',true,'runtime'],
]);
const BINDINGS=Object.freeze([
 ['jg_contract_direct_pending_binding_v1','anchorOwnerOid','anchorNamespaceOid'],
 ['jg_contract_direct_review_retention_binding_v1','anchorOwnerOid'],
 ['jg_contract_direct_archive_binding_v1','anchorOwnerOid','anchorNamespaceOid'],
 ['jg_contract_direct_archive_retention_binding_v1','anchorOwnerOid'],
 ['jg_contract_direct_archive_dispatch_binding_v1','anchorOwnerOid','namespaceOid'],
 ['jg_contract_upward_pending_create_binding_v1','ownerOid','namespaceOid'],
 ['jg_contract_direct_archive_completion_binding_v1','anchorOwnerOid','namespaceOid'],
 ['jg_contract_upward_pending_save_binding_v1','ownerOid','namespaceOid'],
 ['jg_contract_direct_archive_intent_binding_v1'],['jg_contract_direct_upward_issuer_binding_v2'],
 ['jg_contract_direct_upward_execution_binding_v2'],['jg_contract_direct_upward_closure_v2'],
]);
const logging=Object.freeze({statement:'none',errorStatement:'panic',verbosity:'terse',errorParameters:'0',duration:'off',minDurationStatement:'-1',
 transactionSampleRate:'0',minDurationSample:'-1',debugParse:'off',debugRewritten:'off',debugPlan:'off'});
const commonRole=Object.freeze({superuser:false,createRole:false,createDb:false,inherit:false,replication:false,bypassRls:false,unlimitedValidity:true});
const invariantKeys=['ledger','bindings','oldRoleSha256','membershipsSha256','protectedSha256'];
const roleSpec=([name,login,secret],competition)=>({...commonRole,name,login,
 limit:competition&&name==='jg_task01_runtime'?2:login?1:0,password:secret?'scram':'absent'});
const proofs=new WeakMap(),authRoleProofs=new WeakMap(),authRoleFailures=new WeakMap();
const fault=code=>Object.assign(new Error(`CURRENT259_ROLE_PROVISION_${code}`),{code:`CURRENT259_ROLE_PROVISION_${code}`});
const need=(test,code)=>{if(!test)throw fault(code);};
const snapshotBytes=fs.readFileSync(path.join(__dirname,'task16-current259-role-provision.sql'));
need(createHash('sha256').update(snapshotBytes).digest('hex')==='e1b98579325c57e4d65e0a79cdcaad09656021c37de572e34863b0d82f1fe2ca','SOURCE');
const snapshotTemplate=snapshotBytes.toString('utf8');
const quote=value=>`'${value.replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;
const oid=x=>typeof x==='string'&&/^[1-9][0-9]{0,9}$/u.test(x)&&BigInt(x)<=0xffffffffn;
const xid=x=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/u.test(x)&&BigInt(x)<=0xffffffffffffffffn;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const plain=x=>x&&typeof x==='object'&&!types.isProxy(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(x,wanted)=>plain(x)&&equal(Object.keys(x).sort(),wanted.slice().sort());
const omit=(x,...names)=>Object.fromEntries(Object.entries(x).filter(([key])=>!names.includes(key)));
const freeze=x=>{if(x&&typeof x==='object'){for(const item of Object.values(x))freeze(item);Object.freeze(x);}return x;};

// These links are stored by the eight original binding installers. Read only the
// fixed coordinates used to establish their continuity; retain full row digests.
const callersSql=`'fileCallerOids',to_jsonb(ARRAY(SELECT v::text FROM unnest(r."fileCallerOids") AS caller(v) ORDER BY v))`;
const linkSql=(oid,sha)=>`jsonb_build_object('oid',${oid},'sha',${sha})`;
const fieldLink=(oid,sha)=>linkSql(`b->>'${oid}'`,`b->>'${sha}'`);
const nestedLink=(oid,sha)=>linkSql(`b->'links'->>'${oid}'`,`b->'links'->>'${sha}'`);
const BINDING_LINKS=[callersSql,'',
 `${callersSql},'pending',${fieldLink('pendingRelationOid','pendingSha256')},'review',${fieldLink('reviewRelationOid','reviewSha256')}`,
 `'preparation',${fieldLink('preparationRelationOid','preparationSha256')}`,
 `'pending',${nestedLink('pendingOid','pendingSha')},'preparation',${nestedLink('prepareOid','prepareSha')},'retention',${nestedLink('retentionOid','retentionSha')}`,
 `'dispatch',b->>'directDispatchSha256'`,
 `'retention',${nestedLink('retentionOid','retentionSha')},'dispatch',${nestedLink('dispatchOid','dispatchSha')}`,
 `'create',b->>'createBindingSha256'`,
];
function projection(appOid,committedXid){
 const bindings=BINDINGS.map(([name,owner,namespace],index)=>`SELECT ${index} AS position,
 jsonb_build_object('name',${quote(name)},'oid',c.oid::text,'owner',c.relowner::text,'namespace',c.relnamespace::text,
 'kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('appOid',b->>'applicationRoleOid','databaseOid',b->>'databaseOid',
   'ownerOid',${owner?`b->>${quote(owner)}`:'NULL'},'namespaceOid',${namespace?`b->>${quote(namespace)}`:'NULL'},
   'protocol',b->'protocolVersion','sha256',encode(sha256(convert_to(b::text,'UTF8')),'hex'),'xmin',r.xmin::text,'links',jsonb_build_object(${BINDING_LINKS[index]??''})) ORDER BY b::text),'[]'::jsonb)
   FROM public.${name} r CROSS JOIN LATERAL (SELECT to_jsonb(r) AS b) snapshot)) AS row
 FROM pg_class c WHERE c.oid='public.${name}'::regclass`).join('\nUNION ALL\n');
 return snapshotTemplate.replaceAll('__APP_OID__',quote(appOid)).replaceAll('__NAMES__',ROLE_SPECS.map(([name])=>quote(name)).join(','))
  .replace('__COMMIT_STATUS__',committedXid?`pg_xact_status(${quote(committedXid)}::xid8)`:'NULL').replace('__BINDINGS__',bindings);
}

const startRead='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog,pg_temp;\n';
function readSql(appOid,committedXid){return `${startRead}${projection(appOid,committedXid)};\nROLLBACK;\n`;}

function observed(stdout){
 need(typeof stdout==='string'&&Buffer.byteLength(stdout)<=512*1024,'OUTPUT');
 try{return JSON.parse(stdout);}catch{throw fault('OUTPUT');}
}
function verifyBase(row,scope,phase){
 const code=phase.toUpperCase();
 need(keys(row,['identity','backend','logging','access','readOnly','isolation','writeXid','commitStatus','state']),code);
 need(equal(row.logging,logging),code);
 const {identity,backend,state}=row;
 need(equal(omit(identity,'version','encoding','replication'),scope.identity)&&Number.isInteger(identity.version)&&identity.version>=160000&&identity.version<170000&&identity.encoding==='UTF8'&&identity.replication==='origin',code);
 need(keys(backend,['pid','start'])&&Number.isInteger(backend.pid)&&backend.pid>0&&backend.pid<=2147483647&&typeof backend.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(backend.start)&&Number.isFinite(Date.parse(backend.start)),code);
 need(keys(state,[...invariantKeys,'app','roles','databases','settings','violations'])&&state.violations===0&&equal(state.ledger,scope.ledger)&&invariantKeys.slice(2).every(key=>sha(state[key])),code);
 need(Array.isArray(state.bindings)&&state.bindings.length===BINDINGS.length,code);
 const bindingOids=new Set();
 for(let i=0;i<BINDINGS.length;i++){
  const entry=state.bindings[i],[name,owner,namespace]=BINDINGS[i];
  need(keys(entry,['name','oid','owner','namespace','kind','persistence','rls','forceRls','rows'])&&entry.name===name&&oid(entry.oid)&&!bindingOids.has(entry.oid)&&entry.owner==='10'&&entry.namespace===identity.namespaceOid&&entry.kind==='r'&&entry.persistence==='p'&&entry.rls===false&&entry.forceRls===false&&Array.isArray(entry.rows)&&entry.rows.length===Number(Boolean(owner)),code);
  bindingOids.add(entry.oid);
  if(owner){const row=entry.rows[0];need(keys(row,['appOid','databaseOid','ownerOid','namespaceOid','protocol','sha256','xmin','links'])&&row.appOid===scope.app.oid&&row.databaseOid===identity.databaseOid&&row.ownerOid==='10'&&row.namespaceOid===(namespace?identity.namespaceOid:null)&&row.protocol===1&&sha(row.sha256)&&oid(row.xmin),code);}
 }
 verifyBindingLinks(state.bindings,code);
 need(equal(state.app,{...commonRole,name:scope.app.name,oid:scope.app.oid,login:true,limit:0,password:'absent'}),code);
 need(row.readOnly===(phase!=='install')&&row.isolation===(phase==='install'?'serializable':'repeatable read')&&(phase==='install'?xid(row.writeXid):row.writeXid===null)&&row.commitStatus===(phase==='committed'?'committed':null),code);
 return state;
}

function verifyBindingLinks(bindings,code){
 const link=index=>({oid:bindings[index].oid,sha:bindings[index].rows[0].sha256});
 const rows=bindings.slice(0,8).map(binding=>binding.rows[0].links);
 const callers=rows[0]?.fileCallerOids;
 need(Array.isArray(callers)&&callers.length>0&&callers.every((v,i)=>oid(v)&&(!i||Number(v)>Number(callers[i-1]))),code);
 need(equal(rows,[{fileCallerOids:callers},{},{fileCallerOids:callers,pending:link(0),review:link(1)},
  {preparation:link(2)},{pending:link(0),preparation:link(2),retention:link(3)},{dispatch:link(4).sha},
  {retention:link(3),dispatch:link(4)},{create:link(5).sha}]),code);
}
function verifyAccess(row,code){
 const {app,roles,databases}=row.state;
 const expected=[app,...roles].flatMap(role=>databases.map(db=>{
  const has=privilege=>db.acl.some(a=>['0',role.oid].includes(a[1])&&a[2]===privilege);
  return {roleOid:role.oid,databaseOid:db.oid,connect:has('CONNECT'),temporary:has('TEMPORARY'),create:has('CREATE')};
 }));
 const order=(a,b)=>Number(a.roleOid)-Number(b.roleOid)||Number(a.databaseOid)-Number(b.databaseOid);
 need(Array.isArray(row.access)&&row.access.every(x=>keys(x,['roleOid','databaseOid','connect','temporary','create']))&&
  equal(row.access.slice().sort(order),expected.sort(order)),code);
}
function verifyBefore(row,scope){
 const state=verifyBase(row,scope,'before');
 need(equal(state.roles,[])&&equal(state.settings,[])&&Array.isArray(state.databases)&&state.databases.length===4,'BEFORE');
 const names=[scope.identity.database,'postgres','template0','template1'];
 const seen=new Set();
 for(const database of state.databases){
  need(keys(database,['oid','name','owner','acl'])&&oid(database.oid)&&database.owner==='10'&&names.includes(database.name)&&!seen.has(database.name)&&Array.isArray(database.acl),'BEFORE');
  seen.add(database.name);
  const entries=new Set();
  for(const acl of database.acl){
   need(Array.isArray(acl)&&acl.length===4&&oid(acl[0])&&(oid(acl[1])||acl[1]==='0')&&['CONNECT','TEMPORARY','CREATE'].includes(acl[2])&&typeof acl[3]==='boolean','BEFORE');
   const key=JSON.stringify(acl.slice(0,3));need(!entries.has(key),'BEFORE');entries.add(key);
  }
  if(database.name===scope.identity.database)need(database.oid===scope.identity.databaseOid&&database.acl.some(a=>equal(a,['10',scope.app.oid,'CONNECT',false])),'BEFORE');
 }
 verifyAccess(row,'BEFORE');
 return state;
}
function xid32(value){return String(BigInt(value)%0x100000000n);}
function verifyInstall(row,before,scope){
 const state=verifyBase(row,scope,'install');
 need(row.backend.pid!==before.backend.pid&&row.backend.start!==before.backend.start&&invariantKeys.every(k=>equal(state[k],before.state[k]))&&Array.isArray(state.roles)&&state.roles.length===ROLE_SPECS.length,'INSTALL');
 const ids=new Set([scope.app.oid,'10']);
 for(let i=0;i<ROLE_SPECS.length;i++){
  const role=state.roles[i];
  need(equal(omit(role,'oid','xmin'),roleSpec(ROLE_SPECS[i],scope.competition))&&oid(role.oid)&&!ids.has(role.oid)&&role.xmin===xid32(row.writeXid),'INSTALL');ids.add(role.oid);
 }
 const observer=state.roles.find(r=>r.name==='jg_task01_observer');
 need(equal(state.settings,[{oid:observer.oid,database:'0',config:['default_transaction_read_only=on']}]),'INSTALL');
 const expected=before.state.databases.map(d=>({...d,acl:d.name===scope.identity.database?[...d.acl,...state.roles.filter(r=>r.login).map(r=>['10',r.oid,'CONNECT',false])]:d.acl}));
 const normalized=databases=>databases.map(d=>({...d,acl:d.acl.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 need(Array.isArray(state.databases)&&equal(normalized(state.databases),normalized(expected)),'INSTALL');
 verifyAccess(row,'INSTALL');
 return state;
}

function installSql(scope,before,credentials){
 const read=projection(scope.app.oid,null),specs=ROLE_SPECS.map(spec=>roleSpec(spec,scope.competition)),expectedRoles=json(specs);
 const changes=ROLE_SPECS.map(([name,login,secret],i)=>`CREATE ROLE ${name} ${login?'LOGIN':'NOLOGIN'} PASSWORD ${secret?quote(credentials[secret]):'NULL'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${specs[i].limit};`).join('\n');
 const loginRoles=ROLE_SPECS.filter(([,login])=>login).map(([name])=>name).join(', ');
 // PostgreSQL samples a transaction when it starts. This dedicated psql
 // backend must disable sampling before BEGIN, then recheck inside it.
 return `SET log_transaction_sample_rate=0;
BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL log_statement='none';
SET LOCAL log_min_error_statement='panic';
SET LOCAL log_error_verbosity='terse';
SET LOCAL log_parameter_max_length_on_error=0;
SET LOCAL log_duration=off;
SET LOCAL log_min_duration_statement=-1;
SET LOCAL log_min_duration_sample=-1;
SET LOCAL debug_print_parse=off;
SET LOCAL debug_print_rewritten=off;
SET LOCAL debug_print_plan=off;
SET LOCAL password_encryption='scram-sha-256';
LOCK TABLE public._prisma_migrations,${BINDINGS.map(([name])=>`public.${name}`).join(',')} IN SHARE MODE NOWAIT;
CREATE TEMP TABLE jg_c259_role_preimage ON COMMIT DROP AS ${read};
DO $guard$
DECLARE prior jsonb;
BEGIN
 SELECT payload INTO STRICT prior FROM pg_temp.jg_c259_role_preimage;
 IF prior->'logging' IS DISTINCT FROM ${json(logging)} OR prior->'identity' IS DISTINCT FROM ${json(before.identity)} OR prior->'state' IS DISTINCT FROM ${json(before.state)}
   OR (prior->'backend'->>'pid')::integer=${before.backend.pid} OR prior->'backend'->>'start'=${quote(before.backend.start)} THEN
   RAISE EXCEPTION 'CURRENT259_ROLE_PROVISION_PREIMAGE';
 END IF;
END $guard$;
${changes}
ALTER ROLE jg_task01_observer SET default_transaction_read_only=on;
GRANT CONNECT ON DATABASE ${scope.identity.database} TO ${loginRoles};
CREATE TEMP TABLE jg_c259_role_postimage ON COMMIT DROP AS ${read};
DO $verify$
DECLARE old_state jsonb; next_state jsonb; expected_acl jsonb; actual_acl jsonb;
BEGIN
 SELECT payload->'state' INTO STRICT old_state FROM pg_temp.jg_c259_role_preimage;
 SELECT payload->'state' INTO STRICT next_state FROM pg_temp.jg_c259_role_postimage;
 IF (old_state - ARRAY['roles','databases','settings']) IS DISTINCT FROM (next_state - ARRAY['roles','databases','settings'])
   OR (SELECT jsonb_agg(r-ARRAY['oid','xmin'] ORDER BY n) FROM jsonb_array_elements(next_state->'roles') WITH ORDINALITY q(r,n)) IS DISTINCT FROM ${expectedRoles}
   OR next_state->'settings' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('oid',r->>'oid','database','0','config',ARRAY['default_transaction_read_only=on']))
      FROM jsonb_array_elements(next_state->'roles') q(r) WHERE r->>'name'='jg_task01_observer')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(next_state->'roles') q(r) WHERE r->>'xmin' IS DISTINCT FROM (pg_current_xact_id()::text::numeric % 4294967296)::text)
   OR (SELECT jsonb_agg(d-'acl' ORDER BY n) FROM jsonb_array_elements(old_state->'databases') WITH ORDINALITY q(d,n))
     IS DISTINCT FROM (SELECT jsonb_agg(d-'acl' ORDER BY n) FROM jsonb_array_elements(next_state->'databases') WITH ORDINALITY q(d,n)) THEN
   RAISE EXCEPTION 'CURRENT259_ROLE_PROVISION_POSTIMAGE';
 END IF;
 SELECT jsonb_agg(jsonb_build_array(db,acl) ORDER BY db,acl) INTO expected_acl FROM (
   SELECT d->>'oid' AS db,a AS acl FROM jsonb_array_elements(old_state->'databases') q(d) CROSS JOIN LATERAL jsonb_array_elements(d->'acl') z(a)
   UNION ALL SELECT ${quote(scope.identity.databaseOid)},jsonb_build_array('10',r->>'oid','CONNECT',false) FROM jsonb_array_elements(next_state->'roles') q(r) WHERE r->'login'='true'
 ) expected;
 SELECT jsonb_agg(jsonb_build_array(d->>'oid',a) ORDER BY d->>'oid',a) INTO actual_acl
 FROM jsonb_array_elements(next_state->'databases') q(d) CROSS JOIN LATERAL jsonb_array_elements(d->'acl') z(a);
 IF actual_acl IS DISTINCT FROM expected_acl THEN RAISE EXCEPTION 'CURRENT259_ROLE_PROVISION_DATABASE_ACL'; END IF;
END $verify$;
SELECT payload FROM pg_temp.jg_c259_role_postimage;
COMMIT;
`;
}

async function provisionCurrent259Roles(technicalCompletion,handle){
 need(arguments.length===2,'HANDLE');
 return provision(technicalCompletion,handle,false);
}
async function provisionCurrent259CompetitionRoles(technicalCompletion,handle,permit){
 need(arguments.length===3,'HANDLE');
 const issuer=require('./task16-current259-payment-run-authorization.cjs');
 const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259CompetitionRolePermit');
 need(claim&&Object.hasOwn(claim,'value')&&typeof claim.value==='function'&&claim.value(permit,handle,technicalCompletion)===true,'HANDLE');
 return provision(technicalCompletion,handle,true);
}
async function provisionCurrent259Payment261Roles(technicalCompletion,handle,permit){
 need(arguments.length===3,'HANDLE');
 const issuer=require('./task16-current259-payment-run-authorization.cjs');
 const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259Payment261RolePermit')?.value;
 need(typeof claim==='function'&&claim(permit,handle,technicalCompletion)===true,'HANDLE');
 return provision(technicalCompletion,handle,false,PAYMENT261_RUNTIME_PROFILE);
}
async function provisionCurrent259Payment261CompetitionRoles(technicalCompletion,handle,permit){
 need(arguments.length===3,'HANDLE');
 const issuer=require('./task16-current259-payment-run-authorization.cjs');
 const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259Payment261CompetitionRolePermit')?.value;
 need(typeof claim==='function'&&claim(permit,handle,technicalCompletion)===true,'HANDLE');
 return provision(technicalCompletion,handle,true,PAYMENT261_COMPETITION_RUNTIME_PROFILE);
}
async function provisionCurrent259Payment261VoucherRoles(technicalCompletion,handle,permit){
 need(arguments.length===3,'HANDLE');
 const issuer=require('./task16-current259-payment-run-authorization.cjs');
 const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259Payment261VoucherRolePermit')?.value;
 need(typeof claim==='function'&&claim(permit,handle,technicalCompletion)===true,'HANDLE');
 return provision(technicalCompletion,handle,true,PAYMENT261_VOUCHER_RUNTIME_PROFILE);
}
async function provisionCurrent259Payment261AttributionGapRoles(technicalCompletion,handle,permit){
 need(arguments.length===3,'HANDLE');
 const issuer=require('./task16-current259-payment-run-authorization.cjs');
 const claim=Object.getOwnPropertyDescriptor(issuer,'claimCurrent259Payment261AttributionGapRolePermit')?.value;
 need(typeof claim==='function'&&claim(permit,handle,technicalCompletion)===true,'HANDLE');
 return provision(technicalCompletion,handle,false,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE);
}
async function provisionCurrent261AuthOnlyDiagnosticRoles(technicalCompletion,handle){
 need(arguments.length===2,'HANDLE');return provision(technicalCompletion,handle,false,undefined,true);
}
async function provision(technicalCompletion,handle,competition,paymentProfile,authOnly=false){
 const supply=authOnly?claimCurrent261AuthOnlyDiagnosticSupply(technicalCompletion,handle):claimCurrent259TechnicalSupply(technicalCompletion,handle);
 if(authOnly)need(supply.executionPurpose==='AUTH_ONLY_DIAGNOSTIC','HANDLE');
 let phase='BEFORE',authPhase='BEFORE';
 try{
  const view=claimCurrent259TechnicalResource(handle),{completion,source}=supply,{application:app,databaseIdentity:identity}=completion;
  const check=()=>{supply.check();view.verifyFull();};
  const checkContinuity=token=>{businessIssuer(token,handle);supply.checkContinuity(token);view.checkLifetime();};
  check();
  need(completion===technicalCompletion&&completion.runId===view.runId&&completion.containerId===view.resource.containerId&&completion.sourceSha===source.candidateSha&&equal(view.source,source),'HANDLE');
  need((authOnly?completion.status==='CURRENT261_AUTH_ONLY_DIAGNOSTIC_SUPPLIED_NOT_ADMISSION'&&completion.executionPurpose==='AUTH_ONLY_DIAGNOSTIC':completion.status==='CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION')&&completion.database===view.resource.databaseName&&identity.database===completion.database&&/^jg_task01_[a-f0-9]{32}$/u.test(identity.database)&&identity.actor===OWNER&&identity.sessionActor===OWNER&&identity.ownerOid==='10'&&identity.actorOid==='10'&&oid(identity.databaseOid)&&oid(identity.namespaceOid)&&typeof identity.systemIdentifier==='string'&&/^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier)&&identity.tls===true&&identity.clientAddress==='127.0.0.1'&&identity.serverAddress==='127.0.0.1'&&identity.serverPort===5432,'HANDLE');
  need(/^jg_fixture_app_[a-f0-9]{24}$/u.test(app.name)&&oid(app.oid)&&app.oid!=='10'&&sha(app.nonce),'HANDLE');
  const {profile}=source;
  const qualified=competition||paymentProfile!==undefined?isExactCurrentPaymentRuntimeSource(profile,paymentProfile):isExactCurrentArchiveProfile(profile);
  need(qualified&&isCurrentPaymentRuntimeMode(paymentProfile,competition)&&
   profile.candidateSha===source.candidateSha&&profile.sealSha256===source.sourceSealSha256,'HANDLE');
  const scope={identity,app,ledger:profile.ledger,competition};
  const run=async(sql,label)=>{if(authOnly)authPhase=label==='committed'?'COMMITTED_READBACK':label.toUpperCase();check();const value=await view.resource.execOwnerSql(sql,`current259-roles-${label}`);check();return observed(value?.stdout);};
  const before=await run(readSql(app.oid),'before');verifyBefore(before,scope);
  const credentials=view.credentials();
  need(['runtime','observer'].every(key=>typeof credentials[key]==='string'&&/^[a-f0-9]{96}$/u.test(credentials[key]))&&credentials.runtime!==credentials.observer,'BEFORE');
  const sql=installSql(scope,before,credentials);
  phase='COMMIT_UNCONFIRMED';
  const staged=await run(sql,'install');const state=verifyInstall(staged,before,scope);
  const committed=await run(readSql(app.oid,staged.writeXid),'committed');verifyBase(committed,scope,'committed');
  need([before,staged].every(r=>r.backend.pid!==committed.backend.pid&&r.backend.start!==committed.backend.start)&&equal(committed.identity,staged.identity)&&equal(committed.state,state)&&equal(committed.access,staged.access),'COMMITTED');
  if(authOnly)authPhase='FINAL_CHECK';check();
  const result=freeze({status:authOnly?'CURRENT261_AUTH_ONLY_ROLES_PROVISIONED_NOT_ADMISSION':'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',...(authOnly?{executionPurpose:'AUTH_ONLY_DIAGNOSTIC',financialAcceptance:false}:{}),sourceSha:source.candidateSha,runId:view.runId,containerId:view.resource.containerId,
   databaseIdentity:{...identity},ordinary:{...state.app},roles:state.roles,commitXid:staged.writeXid,
   databaseAcl:{before:before.state.databases,after:state.databases,effective:committed.access},executionAllowed:false,nativeAdmission:false,
   ...(paymentProfile?{paymentProfile}:{})});
  (authOnly?authRoleProofs:proofs).set(result,{handle,source,check,checkContinuity,competition,paymentProfile});return result;
 }catch(cause){
  if(authOnly){
   let cleanupFailed=false;try{await closeCurrent259OwnedResource(handle);}catch{cleanupFailed=true;}
   // Preserve the original thrown object, including frozen errors. Diagnostics
   // contain only our finite phase and cleanup outcome, never transport fields.
   if(cause!==null&&(typeof cause==='object'||typeof cause==='function')&&!authRoleFailures.has(cause))
    authRoleFailures.set(cause,Object.freeze({phase:authPhase,resourceCleanup:Object.freeze({status:cleanupFailed?'UNKNOWN':'COMPLETED'})}));
   throw cause;
  }
  const error=fault(phase);
  try{await closeCurrent259OwnedResource(handle);}catch{Object.defineProperty(error,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});}
  throw error;
 }
}
function describeCurrent261AuthOnlyRoleFailure(error){
 if(error===null||(typeof error!=='object'&&typeof error!=='function'))return undefined;
 return authRoleFailures.get(error);
}
function claimCurrent259ProvisionedRoles(result,handle){
 need(arguments.length===2&&result&&!types.isProxy(result)&&proofs.has(result),'HANDLE');
 const proof=proofs.get(result);need(proof.handle===handle,'HANDLE');proofs.delete(result);proof.check();
 return Object.freeze({source:proof.source,completion:result,check:proof.check,checkContinuity:proof.checkContinuity,
  ...(proof.competition?{competition:true}:{}),...(proof.paymentProfile?{paymentProfile:proof.paymentProfile}:{})});
}
function claimCurrent261AuthOnlyDiagnosticRoles(result,handle){
 need(arguments.length===2&&result&&!types.isProxy(result)&&authRoleProofs.has(result),'HANDLE');
 const proof=authRoleProofs.get(result);need(proof.handle===handle,'HANDLE');authRoleProofs.delete(result);proof.check();
 return Object.freeze({source:proof.source,completion:result,executionPurpose:'AUTH_ONLY_DIAGNOSTIC',check:proof.check,checkContinuity:proof.checkContinuity});
}
// Pure native diagnostic protocol only: JSON readbacks are data, never an
// original resource completion or a private continuation/admission.
function nativeRoleScope(text,competition=false){
 need(typeof text==='string'&&Buffer.byteLength(text)<=256*1024,'NATIVE_INPUT');
 const scope=JSON.parse(text);need(keys(scope,['identity','app','ledger','competition'])&&scope.competition===competition&&
  plain(scope.identity)&&scope.identity.ownerOid==='10'&&/^jg_task01_[a-f0-9]{32}$/u.test(scope.identity.database)&&
  plain(scope.app)&&/^jg_fixture_app_[a-f0-9]{24}$/u.test(scope.app.name)&&oid(scope.app.oid)&&Array.isArray(scope.ledger),'NATIVE_INPUT');
 return scope;
}
function renderNativeTask16RoleRead(appOid,commitXid){
 need(arguments.length===2&&oid(appOid)&&(commitXid===null||xid(commitXid)),'NATIVE_INPUT');return readSql(appOid,commitXid);
}
function renderNativeTask16RoleInstall(scopeJson,beforeStdout,credentials){
 need(arguments.length===3&&plain(credentials)&&keys(credentials,['runtime','observer']),'NATIVE_INPUT');
 const values=Object.fromEntries(['runtime','observer'].map(key=>{const d=Object.getOwnPropertyDescriptor(credentials,key);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[a-f0-9]{96}$/u.test(d.value),'NATIVE_INPUT');return [key,d.value];}));
 need(values.runtime!==values.observer,'NATIVE_INPUT');const scope=nativeRoleScope(scopeJson),before=observed(beforeStdout);verifyBefore(before,scope);return installSql(scope,before,values);
}
function parseNativeTask16RoleRead(scopeJson,stdout,phase,beforeStdout=null,stagedStdout=null){
 need(arguments.length>=3&&['before','install','committed'].includes(phase),'NATIVE_INPUT');
 const scope=nativeRoleScope(scopeJson),row=observed(stdout);
 if(phase==='before')verifyBefore(row,scope);
 else if(phase==='install')verifyInstall(row,observed(beforeStdout),scope);
 else {verifyBase(row,scope,'committed');const before=observed(beforeStdout),staged=observed(stagedStdout);verifyBefore(before,scope);const state=verifyInstall(staged,before,scope);
  need([before,staged].every(r=>r.backend.pid!==row.backend.pid&&r.backend.start!==row.backend.start)&&equal(row.identity,staged.identity)&&equal(row.state,state)&&equal(row.access,staged.access),'COMMITTED');}
 return row;
}
// Fixed competition data protocol; it does not mint private lease authority.
function renderNativeTask16CompetitionRoleRead(appOid,commitXid){
 need(arguments.length===2,'NATIVE_INPUT');return renderNativeTask16RoleRead(appOid,commitXid);
}
function renderNativeTask16CompetitionRoleInstall(scopeJson,beforeStdout,credentials){
 need(arguments.length===3&&plain(credentials)&&keys(credentials,['runtime','observer']),'NATIVE_INPUT');
 const values=Object.fromEntries(['runtime','observer'].map(key=>{const d=Object.getOwnPropertyDescriptor(credentials,key);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[a-f0-9]{96}$/u.test(d.value),'NATIVE_INPUT');return [key,d.value];}));
 need(values.runtime!==values.observer,'NATIVE_INPUT');const scope=nativeRoleScope(scopeJson,true),before=observed(beforeStdout);verifyBefore(before,scope);return installSql(scope,before,values);
}
function parseNativeTask16CompetitionRoleRead(scopeJson,stdout,phase,beforeStdout=null,stagedStdout=null){
 need(arguments.length>=3&&['before','install','committed'].includes(phase),'NATIVE_INPUT');
 const scope=nativeRoleScope(scopeJson,true),row=observed(stdout);
 if(phase==='before')verifyBefore(row,scope);
 else if(phase==='install')verifyInstall(row,observed(beforeStdout),scope);
 else {verifyBase(row,scope,'committed');const before=observed(beforeStdout),staged=observed(stagedStdout);verifyBefore(before,scope);const state=verifyInstall(staged,before,scope);
  need([before,staged].every(r=>r.backend.pid!==row.backend.pid&&r.backend.start!==row.backend.start)&&equal(row.identity,staged.identity)&&equal(row.state,state)&&equal(row.access,staged.access),'COMMITTED');}
 return row;
}
module.exports=Object.freeze({renderNativeTask16CompetitionRoleRead,renderNativeTask16CompetitionRoleInstall,parseNativeTask16CompetitionRoleRead,renderNativeTask16RoleRead,renderNativeTask16RoleInstall,parseNativeTask16RoleRead,describeCurrent261AuthOnlyRoleFailure,provisionCurrent261AuthOnlyDiagnosticRoles,claimCurrent261AuthOnlyDiagnosticRoles,provisionCurrent259Roles,provisionCurrent259CompetitionRoles,provisionCurrent259Payment261Roles,provisionCurrent259Payment261CompetitionRoles,provisionCurrent259Payment261VoucherRoles,
 provisionCurrent259Payment261AttributionGapRoles,claimCurrent259ProvisionedRoles});
