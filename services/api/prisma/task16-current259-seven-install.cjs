'use strict';
const {assertCurrent259BusinessIssuer:businessIssuer}=require('./task16-current259-business-continuity.cjs');

const {createHash,randomBytes}=require('node:crypto');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {isDeepStrictEqual:equal,types}=require('node:util');
// Import the fixed role producer before the owned resource. The technical
// profile rejects any earlier resource load in the same process.
const {claimCurrent259ProvisionedRoles}=require('./task16-current259-role-provision.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {loadCurrent259CatalogMaterial}=require('./task16-current259-catalog.cjs');
const {renderCurrent259SevenPreimage,parseCurrent259SevenPreimage}=require('./task16-current259-seven-preimage.cjs');
const {functionProofSql}=require('./task16-registered-access-check.cjs');
const {registeredObjectWitnessSql,schema205RegistrySql,schema205RegistryValid,schema205EnforceConfigSql,schema205WitnessSql,SCHEMA205_DEPARSE_LOCAL}=require('./task16-registered-object-witness.cjs');
const {schema205ScopeSql,schema205SevenDeltaSql}=require('./task16-schema205-scope.cjs');

const CODE='CURRENT259_SEVEN_INSTALL';
const ROOT=path.resolve(__dirname,'../../..');
const PENDING='public.jg_contract_direct_pending_binding_v1';
const REGISTRY='public.jg_file_business_binding_columns()';
const ALIAS='public.jg_file_business_binding_columns_before_registered_payment()';
const VOUCHER='public."RegisteredPaymentVoucher"';
const VOUCHER_GUARD='public.jg_registered_payment_voucher_file_immutable()';
const TEMP='pg_temp."jg_current259_seven_reference"';
const RELATION='public."InterEntityRelationshipEntry"';
const OWNER='jg_task01_owner';
const config=['search_path=pg_catalog, public, pg_temp'];
const phases=['current259-seven-before','current259-seven-install','current259-seven-committed'];
const fragmentNames=['funding','history-revision','write-authority','canonical-proof','intercompany','canonical-adapter','voucher'];
const newTables=['RegisteredPaymentFunding','RegisteredFundPaymentAllocation','RegisteredPaymentEvent','RegisteredPaymentVoucher','RegisteredContractHistoryRevision'];
const archiveBindings=['jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_archive_native_nonce_v1','jg_contract_direct_upward_issuer_binding_v2','jg_contract_direct_upward_closure_v2','jg_contract_direct_upward_execution_binding_v2'];
const installed=new WeakMap();
const attempted=new WeakSet();
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=(value,n)=>typeof value==='string'&&value.length===n&&/^[0-9a-f]+$/u.test(value);
const bounded=(value,max)=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/u.test(value)&&BigInt(value)<=max;
const oid=value=>bounded(value,0xffffffffn);
const xid=value=>bounded(value,0xffffffffffffffffn);
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const shaSql=value=>`encode(sha256(convert_to((${value})::text,'UTF8')),'hex')`;
const error=part=>Object.assign(new Error(`${CODE}_${part}`),{code:`${CODE}_${part}`});
const need=(ok,part='QUALIFICATION')=>{if(!ok)throw error(part);};

// Recover the three other dynamically rewritten predecessors by undoing the
// literal deltas in the pinned fragments. The new function proofs remain fixed.
function priorRewriteBodies(rows){
 const rewind=(body,after,before,count=1)=>{need(body.split(after).length===count+1);return body.replaceAll(after,()=>before);};
 return rows.filter(row=>!row.signature.includes('guard_inter_entity_relationship_')).map(row=>{
  let body=row.body;
  if(row.signature.includes('validateOperatingFactReferences')){
   const ordinary=`CASE WHEN NEW."actualPayerSubjectKind" = 'participating_company' THEN NEW."actualPayerSubjectId" ELSE NULL END`;
   const edited=`CASE WHEN NEW."actualPayerSubjectKind" = 'participating_company' THEN CASE WHEN NEW."sourceType" = 'payment_execution' AND public."jg_registered_payment_source_matches"(NEW."sourceBusinessId",NEW."projectId",NEW."amountCents",NEW."actualPayerSubjectKind",NEW."actualPayerSubjectId") THEN NULL ELSE NEW."actualPayerSubjectId" END ELSE NULL END`;
   body=rewind(body,edited,ordinary,3);
   body=rewind(body,`candidate_subject->>'kind' NOT IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee', 'public_cash')`,
    `candidate_subject->>'kind' NOT IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee')`);
  }else if(row.signature.includes('validateOperatingImpactEntryReferences')){
   const condition=`IF NOT FOUND AND NOT coalesce(NEW."sourceType" = 'payment_execution' AND NEW."subjectRole" = 'actual_payer' AND public."jg_registered_payment_impact_matches"(NEW."sourceBusinessId",NEW."projectId",NEW."amountCents",NEW."subjectKind",NEW."subjectId",NEW."impactKind",NEW."sourceImpactKey",NEW."direction",NEW."idempotencyKey"),FALSE) THEN\n      RAISE EXCEPTION '影响分录引用的我方公司未在本项目事实日参与'`;
   body=rewind(body,condition,`IF NOT FOUND THEN\n      RAISE EXCEPTION '影响分录引用的我方公司未在本项目事实日参与'`);
   body=rewind(body,`'downstream_counterparty', 'employee', 'public_cash'\n     ) THEN`,`'downstream_counterparty', 'employee'\n     ) THEN`);
  }else{
   need(row.signature.includes('jg_registered_fund_immutable'));
   const added=`IF TG_TABLE_NAME = 'RegisteredFundAccount' THEN
   IF TG_OP = 'UPDATE' AND
      (to_jsonb(NEW) - 'writeRevision') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'writeRevision') AND
      NEW."writeRevision" = OLD."writeRevision" + 1 THEN RETURN NEW; END IF;
 END IF;
 `;
   body=rewind(body,added,'');
  }
  return [row.signature,hash(body)];
 });
}
function material(witness){
 const profile=witness.profile;
 need(profile?.profile==='TASK16_CURRENT259_SOURCE_V1'&&profile.candidateSha===witness.candidateSha&&profile.sealSha256===witness.sourceSealSha256);
 const catalog=loadCurrent259CatalogMaterial({candidateSha:witness.candidateSha,sealSha256:witness.sourceSealSha256,schemaSha256:profile.schemaSha256,
  migrations:profile.ledger.map(row=>({path:`services/api/prisma/migrations/${row.name}/migration.sql`,sha256:row.sha256}))});
 const files=new Map(catalog.sevenFragments.map(({path:relative,sha256})=>{
  const name=fragmentNames.find(name=>relative===`services/api/prisma/prepared/task16/registered-${name}.sql`);
  const bytes=readFileSync(path.join(ROOT,relative));need(name&&hash(bytes)===sha256);
  return [name,bytes.toString('utf8')];
 }));
 need(files.size===fragmentNames.length);
 const legacyBytes=readFileSync(path.join(__dirname,'task16-registered-access.json'));
 need(hash(legacyBytes)==='d19fe664e58659b3008ab2ef2769c6d3e421cb8504d3f98b8fd332133291b5eb');
 const {functionProofs}=JSON.parse(legacyBytes);
 const newRoutines=functionProofs.filter(row=>/^public\."?jg_(registered|assert_registered)_/u.test(row.signature)&&!row.signature.includes('jg_registered_fund_immutable'));
 const changedRoutines=functionProofs.filter(row=>/^public\.(guard_inter_entity_relationship_|"(?:validateOperating(?:Fact|ImpactEntry)References|jg_registered_fund_immutable))/u.test(row.signature));
 need(newRoutines.length===35&&changedRoutines.length===6);
 const intercompany=files.get('intercompany');
 const constraintEdit=intercompany.match(/ALTER TABLE public\."InterEntityRelationshipEntry" ALTER COLUMN "evidenceFileId" DROP NOT NULL;\nDO \$\$\nDECLARE constraint_name[\s\S]+?\nEND \$\$;/u)?.[0];
 need(constraintEdit&&constraintEdit.split(RELATION).length===4);
 return {ledger:catalog.ledger,fragments:fragmentNames.map(name=>files.get(name)),newRoutines,changedRoutines,
  priorRoutines:priorRewriteBodies(changedRoutines),referenceEdit:`ALTER TABLE ${TEMP} ADD COLUMN "confirmedByUserId" text, ADD COLUMN "confirmedAt" timestamp(3);\n${constraintEdit.replaceAll(RELATION,TEMP)}`};
}
function inputOf(lease,view){
 const {completion:roleCompletion,source}=lease;
 const competition=lease.competition===true;
 need(roleCompletion.status==='CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'&&roleCompletion.sourceSha===source.candidateSha&&equal(source,view.source));
 need(hex(roleCompletion.sourceSha,40)&&roleCompletion.runId===view.runId&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(roleCompletion.runId));
 const id=roleCompletion.databaseIdentity;
 need(id.database===`jg_task01_${roleCompletion.runId.replaceAll('-', '')}`&&id.database===view.resource.databaseName&&roleCompletion.containerId===view.resource.containerId&&hex(roleCompletion.containerId,64));
 need(oid(id.databaseOid)&&oid(id.namespaceOid)&&id.ownerOid==='10'&&xid(id.systemIdentifier)&&xid(roleCompletion.commitXid));
 need(Array.isArray(roleCompletion.databaseAcl?.after));
 const ordinary=roleCompletion.ordinary;
 need(oid(ordinary?.oid)&&typeof ordinary.name==='string'&&/^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary.name)&&ordinary.login===true&&ordinary.limit===0&&ordinary.password==='absent');
 const role=name=>{const matches=roleCompletion.roles.filter(r=>r.name===name);
  const limit=competition&&name==='jg_task01_runtime'?2:1;
  need(matches.length===1&&oid(matches[0].oid)&&oid(matches[0].xmin)&&matches[0].login===true&&matches[0].limit===limit&&matches[0].password==='scram');
  return matches[0];};
 const runtime=role('jg_task01_runtime'),observer=role('jg_task01_observer');
 need(new Set(['10',ordinary.oid,runtime.oid,observer.oid]).size===4);
 const xmin=String(BigInt(roleCompletion.commitXid)%4294967296n);
 need(runtime.xmin===xmin&&observer.xmin===xmin);
 return {source,id,ordinary,runtime,observer,roleCompletion,competition,material:material(source)};
}

function scopeGuards(input,phase,archiveXid){
 const {roleCompletion,id,runtime,observer,ordinary}=input;
 const checkedRoles=[{...ordinary,xmin:null},runtime,observer];
 const databaseAcl=`(SELECT jsonb_agg(jsonb_build_object('oid',d.oid::text,'name',d.datname,'owner',d.datdba::text,
   'acl',coalesce((SELECT jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)
    ORDER BY a.grantor,a.grantee,a.privilege_type COLLATE "C",a.is_grantable) FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a),'[]'::jsonb))
   ORDER BY d.datname COLLATE "C") FROM pg_database d)`;
 return `DO $current259_seven_scope$
BEGIN
 IF current_user IS DISTINCT FROM '${OWNER}' OR session_user IS DISTINCT FROM current_user OR current_user::regrole::oid<>10
  OR current_database() IS DISTINCT FROM ${quote(id.database)} OR to_regnamespace('public')::oid IS DISTINCT FROM ${id.namespaceOid}::oid
  OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND oid=${id.databaseOid}::oid AND datdba=10)
  OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM ${quote(id.systemIdentifier)}
  OR host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port() IS DISTINCT FROM 5432
  OR NOT EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_isolation')<>'${phase===2?'repeatable read':'serializable'}' OR current_setting('transaction_read_only')<>'${phase===2?'on':'off'}'
  OR pg_xact_status(${quote(roleCompletion.commitXid)}::xid8) IS DISTINCT FROM 'committed'
  OR EXISTS(SELECT 1 FROM jsonb_to_recordset(${json(checkedRoles)}) e(name text,oid text,login boolean,"limit" integer,password text,xmin text)
    WHERE NOT EXISTS(SELECT 1 FROM pg_authid r WHERE r.oid=e.oid::oid AND r.rolname::text=e.name AND r.rolcanlogin=e.login AND r.rolconnlimit=e."limit"
       AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
       AND r.rolvaliduntil IS NULL AND (e.xmin IS NULL OR r.xmin::text=e.xmin)
       AND CASE e.password WHEN 'absent' THEN r.rolpassword IS NULL ELSE r.rolpassword LIKE 'SCRAM-SHA-256$%' END
       AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid)
       AND NOT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.usesysid=r.oid)))
  OR (SELECT coalesce(jsonb_agg(jsonb_build_array(s.setrole::text,s.setdatabase::text,s.setconfig) ORDER BY s.setrole,s.setdatabase),'[]'::jsonb)
       FROM pg_db_role_setting s WHERE s.setrole IN (${runtime.oid}::oid,${observer.oid}::oid)) IS DISTINCT FROM ${json([[observer.oid,'0',['default_transaction_read_only=on']]])}
  OR ${databaseAcl} IS DISTINCT FROM ${json(roleCompletion.databaseAcl.after)}
  OR (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL)
    ORDER BY migration_name COLLATE "C") FROM public._prisma_migrations) IS DISTINCT FROM ${json(input.material.ledger)}
  OR (SELECT count(*) FROM ${PENDING} b WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=${ordinary.oid}::oid
    AND b."databaseOid"=${id.databaseOid}::oid AND b."anchorNamespaceOid"=${id.namespaceOid}::oid AND b."anchorOwnerOid"=10)<>1
  ${archiveBindings.map((table,index)=>archiveXid&&index<2
    ?`OR (SELECT count(*)=1 AND bool_and(xmin::text::numeric=mod((${archiveXid})::text::numeric,4294967296)) FROM public.${table}) IS DISTINCT FROM true`
    :`OR EXISTS(SELECT 1 FROM public.${table})`).join('\n  ')}
  ${phase===2?'':`OR NOT (${schema205EnforceConfigSql(false)})
   OR EXISTS(SELECT 1 FROM (VALUES ${input.material.priorRoutines.map(([signature,digest])=>`(${quote(signature)},${quote(digest)})`).join(',')}) e(signature,body_sha)
     WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(e.signature) AND p.proowner=10 AND p.pronamespace=to_regnamespace('public')
       AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=e.body_sha))`} THEN RAISE EXCEPTION '${CODE}_SCOPE'; END IF;
END $current259_seven_scope$;`;
}
function newObjects(input){
 const names=input.material.newRoutines.map(row=>/^public\."?([a-z_0-9]+)"?\(/u.exec(row.signature)?.[1]);
 need(names.every(Boolean));
 return `DO $current259_seven_fresh$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace=to_regnamespace('public') AND relname IN (${newTables.map(quote).join(',')}))
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=to_regnamespace('public') AND proname IN (${[...new Set(names),'jg_file_business_binding_columns_before_registered_payment'].map(quote).join(',')}))
   THEN RAISE EXCEPTION '${CODE}_FRESH_OBJECTS'; END IF;
END $current259_seven_fresh$;`;
}
const fileRolesSql=input=>`(SELECT jsonb_agg(allowed::text ORDER BY allowed) FROM (
 SELECT unnest(b."fileCallerOids") AS allowed FROM ${PENDING} b WHERE b."protocolVersion"=1
 UNION SELECT ${input.ordinary.oid}::oid UNION SELECT 10::oid) role_ids)`;
function stableSql(input,registry=schema205RegistrySql(),schemaWitness=schema205WitnessSql()){
 const routines=[...input.material.newRoutines,...input.material.changedRoutines].map(row=>`to_regprocedure(${quote(row.signature)})`).join(',');
 return shaSql(`jsonb_build_array(${registeredObjectWitnessSql()},${schema205ScopeSql()},${schemaWitness},${registry},
  (SELECT to_jsonb(b) FROM ${PENDING} b WHERE b."protocolVersion"=1),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN (${routines})),
  (SELECT c.relacl FROM pg_class c WHERE c.oid=to_regclass(${quote(VOUCHER)})),
  (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attacl) ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid=to_regclass(${quote(VOUCHER)}) AND a.attnum>0 AND NOT a.attisdropped))`);
}
function readbackSql(input,phase,nonce,prior,reference){
 const before=phase===0,committed=phase===2;
 const writeXid=before?'NULL::text':committed?quote(prior.installXid):'pg_current_xact_id()::text';
 const pre=before?`(SELECT * FROM (${reference}) w)`:'NULL::jsonb';
 return `SELECT jsonb_build_object('nonce',${quote(nonce)},'phase',${quote(phases[phase])},
 'backendPid',pg_backend_pid(),'backendStart',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'pre',${pre},'registry',${before?schema205RegistrySql():'NULL::jsonb'},'fileRoles',${before?fileRolesSql(input):'NULL::jsonb'},
 'catalogSha256',${stableSql(input)},'installXid',${writeXid},'commitStatus',${committed?`pg_xact_status(${quote(prior.installXid)}::xid8)`:'NULL::text'})
 FROM pg_stat_activity a WHERE a.pid=pg_backend_pid();`;
}
function preimageGuard(input,prior,reference){
 const {registry,fileRoles,pre}=prior;
 return `DO $current259_seven_preimage$
DECLARE observation jsonb;
BEGIN
 SELECT value INTO STRICT observation FROM (${reference}) w(value);
 IF observation->'actual' IS DISTINCT FROM ${json(pre.actual)} OR observation->'guards' IS DISTINCT FROM ${json(pre.guards)}
   OR observation->'deparsePremises' IS DISTINCT FROM 'true'::jsonb OR ${schema205RegistrySql()} IS DISTINCT FROM ${json(registry)}
   OR ${stableSql(input)} IS DISTINCT FROM ${quote(prior.catalogSha256)} OR ${fileRolesSql(input)} IS DISTINCT FROM ${json(fileRoles)}
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${json(fileRoles)}) x(role_oid)
      WHERE NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=x.role_oid::oid AND has_function_privilege(r.oid,to_regprocedure(${quote(REGISTRY)}),'EXECUTE')))
   THEN RAISE EXCEPTION '${CODE}_PREIMAGE_DRIFT'; END IF;
END $current259_seven_preimage$;`;
}
function bridgeSql(input,prior,executorOid){
 const {registry}=prior;
 const fileRoles=executorOid?[...prior.fileRoles,executorOid].sort((a,b)=>Number(a)-Number(b)):prior.fileRoles;
 const expectedOwner=[['10','10','EXECUTE',false]];
 const expectedAcl=fileRoles.map(id=>['10',id,'EXECUTE',false]);
 const alias=executorOid?`((SELECT registry->'publicRoutine' FROM pg_temp.jg_current259_seven_archive_registry)||${json({name:'jg_file_business_binding_columns_before_registered_payment',config})})`
  :json({...registry.publicRoutine,name:'jg_file_business_binding_columns_before_registered_payment',config});
 const grantRoles=fileRoles.filter(id=>id!=='10');
 return `DO $current259_seven_bridge$
DECLARE witness jsonb; role_name text; item text;
BEGIN
 witness := ${schema205RegistrySql()};
 IF witness->'alias' IS DISTINCT FROM ${alias} OR witness->'publicDefault' IS DISTINCT FROM ${json(registry.publicDefault)}
  OR witness->'globalDefault'->'acl' IS DISTINCT FROM ${json(expectedOwner)}
  OR witness->'publicRoutine'->>'oid'=witness->'alias'->>'oid' OR witness->'publicRoutine'->'shapeVerified' IS DISTINCT FROM 'true'::jsonb
  OR witness->'publicRoutine'->'config' IS DISTINCT FROM ${json(config)}
  OR encode(sha256(convert_to(witness->'publicRoutine'->'definition'->>'prosrc','UTF8')),'hex') IS DISTINCT FROM '46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3'
  OR witness->'publicRoutine'->'acl' IS DISTINCT FROM ${json(expectedOwner)}
  OR ((witness->'publicRoutine'->'definition')-'prosrc') IS DISTINCT FROM ((witness->'alias'->'definition')-'prosrc')
  THEN RAISE EXCEPTION '${CODE}_REGISTRY_INTERMEDIATE'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements_text(${json(grantRoles)}) LOOP
  SELECT rolname INTO STRICT role_name FROM pg_roles WHERE oid=item::oid;
  EXECUTE format('GRANT EXECUTE ON FUNCTION ${REGISTRY} TO %I',role_name);
  EXECUTE format('GRANT SELECT ("fileId") ON TABLE ${VOUCHER} TO %I',role_name);
 END LOOP;
 witness := ${schema205RegistrySql()};
 IF witness->'alias' IS DISTINCT FROM ${alias} OR witness->'publicRoutine'->'acl' IS DISTINCT FROM ${json(expectedAcl)}
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=${quote(VOUCHER_GUARD)}::regprocedure AND (a.grantee<>10 OR a.grantor<>10 OR a.is_grantable))
  OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=${quote(VOUCHER)}::regclass AND c.relowner=10 AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>10 OR a.grantor<>10 OR a.is_grantable))
  OR (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable) ORDER BY a.grantee),'[]'::jsonb)
   FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
   WHERE c.attrelid=${quote(VOUCHER)}::regclass AND c.attnum>0 AND NOT c.attisdropped AND c.attname='fileId') IS DISTINCT FROM ${json(grantRoles.map(id=>['10',id,'SELECT',false]))}
  OR EXISTS(SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE c.attrelid=${quote(VOUCHER)}::regclass AND c.attnum>0 AND NOT c.attisdropped AND c.attname<>'fileId')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${json(grantRoles)}) x(id)
   WHERE NOT has_function_privilege(x.id::oid,to_regprocedure(${quote(ALIAS)}),'EXECUTE') OR NOT has_function_privilege(x.id::oid,to_regprocedure(${quote(REGISTRY)}),'EXECUTE')
    OR NOT has_column_privilege(x.id::oid,${quote(VOUCHER)},'fileId','SELECT') OR has_table_privilege(x.id::oid,${quote(VOUCHER)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(x.id::oid,${quote(VOUCHER)},'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION'))
  THEN RAISE EXCEPTION '${CODE}_VOUCHER_ACL'; END IF;
END $current259_seven_bridge$;`;
}
function checkTransition(input,prior,reference){
 const priorActual=prior.pre.actual;
 const columns=priorActual.columns.map(column=>column.name==='evidenceFileId'?{...column,notNull:false}:column);
 const postBodies=functionProofSql({functionProofs:[...input.material.newRoutines,...input.material.changedRoutines]});
 return `DO $current259_seven_postimage$
DECLARE observation jsonb; item jsonb; original jsonb; compiled jsonb; actual_scope jsonb; prior_scope jsonb; delta jsonb;
BEGIN
 SELECT value INTO STRICT observation FROM (${reference}) w(value);
 SELECT payload INTO STRICT prior_scope FROM pg_temp.jg_current259_seven_scope;
 actual_scope := ${schema205ScopeSql()}; delta := ${schema205SevenDeltaSql()};
 IF observation->'actual'->'relation' IS DISTINCT FROM ${json(priorActual.relation)}
   OR observation->'actual'->'columns' IS DISTINCT FROM ${json(columns)} OR observation->'actual'->'triggers' IS DISTINCT FROM ${json(priorActual.triggers)}
   OR jsonb_array_length(observation->'actual'->'checks')<>5 OR jsonb_array_length(observation->'expected'->'checks')<>5
   OR delta IS NULL OR EXISTS(SELECT 1 FROM jsonb_each_text(delta) x WHERE x.value IS NULL) OR (SELECT count(DISTINCT value) FROM jsonb_each_text(delta))<>4
   OR (actual_scope-ARRAY['constraints','triggers']) IS DISTINCT FROM (prior_scope-ARRAY['constraints','triggers'])
   OR (SELECT coalesce(jsonb_agg(row ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(actual_scope->'constraints') WITH ORDINALITY q(row,ord) WHERE row->>'id'<>delta->>'foreignKey') IS DISTINCT FROM prior_scope->'constraints'
   OR (SELECT coalesce(jsonb_agg(row ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(actual_scope->'triggers') WITH ORDINALITY q(row,ord)
       WHERE row->>'id' NOT IN (delta->>'voucherGuard',delta->>'restrictDelete',delta->>'restrictUpdate')) IS DISTINCT FROM prior_scope->'triggers'
   OR ${schema205WitnessSql()} IS DISTINCT FROM (SELECT witness FROM pg_temp.jg_current259_seven_scope)
   OR NOT (${schema205EnforceConfigSql(true)}) OR NOT (${postBodies}) THEN RAISE EXCEPTION '${CODE}_POSTIMAGE'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(observation->'actual'->'checks') LOOP
  SELECT x INTO STRICT original FROM jsonb_array_elements(${json(priorActual.checks)}) x WHERE x->>'name'=item->>'name';
  SELECT x INTO STRICT compiled FROM jsonb_array_elements(observation->'expected'->'checks') x WHERE x->>'name'=item->>'name';
  IF (item-ARRAY['oid','key','tree','expression','definition']) IS DISTINCT FROM (original-ARRAY['oid','key','tree','expression','definition'])
   OR item->>'oid'=original->>'oid' OR item->>'expression' IS DISTINCT FROM compiled->>'expression' OR item->>'definition' IS DISTINCT FROM compiled->>'definition'
   OR (SELECT array_agg(a.attname::text ORDER BY a.attname COLLATE "C") FROM jsonb_array_elements_text(item->'key') k(n)
       JOIN pg_attribute a ON a.attrelid=${quote(RELATION)}::regclass AND a.attnum=k.n::smallint)
     IS DISTINCT FROM (SELECT array_agg(a.attname::text ORDER BY a.attname COLLATE "C") FROM jsonb_array_elements_text(compiled->'key') k(n)
       JOIN pg_attribute a ON a.attrelid=${quote(TEMP)}::regclass AND a.attnum=k.n::smallint)
   OR NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.oid=(item->>'oid')::oid AND c.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296))
   THEN RAISE EXCEPTION '${CODE}_CHECK_TRANSITION'; END IF;
 END LOOP;
END $current259_seven_postimage$;`;
}
const newConstraints=[
 ['RegisteredPaymentFunding','p',['executionId']],['RegisteredPaymentFunding','u',['executionId','accountId']],
 ['RegisteredPaymentFunding','c',['openingTreatment']],['RegisteredPaymentFunding','c',['openingReason']],
 ['RegisteredPaymentFunding','c',['openingEvidence']],['RegisteredPaymentFunding','c',['payloadFingerprint']],
 ['RegisteredPaymentFunding','f',['executionId'],'PaymentExecution',['id'],'r','c'],
 ['RegisteredPaymentFunding','f',['accountId'],'RegisteredFundAccount',['id'],'r','c'],
 ['RegisteredPaymentFunding','f',['balanceRegistrationId','accountId'],'FundAccountBalanceRegistration',['id','accountId'],'r','c'],
 ['RegisteredFundPaymentAllocation','p',['id']],['RegisteredFundPaymentAllocation','u',['executionId','sourceBatchId']],
 ['RegisteredFundPaymentAllocation','c',['amountCents']],
 ['RegisteredFundPaymentAllocation','f',['sourceBatchId'],'FundAccountSourceBatch',['id'],'r','c'],
 ['RegisteredFundPaymentAllocation','f',['executionId','accountId'],'RegisteredPaymentFunding',['executionId','accountId'],'r','c'],
 ['RegisteredFundPaymentAllocation','f',['accountId'],'RegisteredFundAccount',['id'],'r','c'],
 ['RegisteredPaymentEvent','p',['executionId']],['RegisteredPaymentEvent','c',['eventType']],
 ['RegisteredPaymentEvent','f',['executionId'],'PaymentExecution',['id'],'r','c'],
 ['RegisteredPaymentVoucher','p',['executionId']],['RegisteredPaymentVoucher','u',['fileId']],
 ['RegisteredPaymentVoucher','c',['contentSha256']],
 ['RegisteredPaymentVoucher','f',['executionId'],'PaymentExecution',['id'],'r','c'],
 ['RegisteredPaymentVoucher','f',['fileId'],'FileObject',['id'],'r','r'],
 ['RegisteredContractHistoryRevision','p',['contractId']],['RegisteredContractHistoryRevision','c',['revision']],
 ['RegisteredContractHistoryRevision','f',['contractId'],'Contract',['id'],'c','a'],
];
function newConstraintSql(){
 const expected=newConstraints.map(row=>row.length===3?[...row,null,null,null,null]:row);
 const names=(relation,columns)=>`(SELECT jsonb_agg(a.attname ORDER BY n.ord) FROM unnest(${columns}) WITH ORDINALITY n(attnum,ord)
   JOIN pg_attribute a ON a.attrelid=${relation} AND a.attnum=n.attnum AND NOT a.attisdropped)`;
 return `NOT EXISTS(WITH actual AS (
   SELECT jsonb_build_array(c.relname,k.contype,${names('k.conrelid','k.conkey')},dst.relname,${names('k.confrelid','k.confkey')},
     CASE WHEN k.contype='f' THEN k.confdeltype END,CASE WHEN k.contype='f' THEN k.confupdtype END) AS row,
     k.convalidated AND NOT k.condeferrable AND NOT k.condeferred AND k.conislocal AND k.coninhcount=0 AND k.conparentid=0
      AND (k.contype<>'f' OR (k.confmatchtype='s' AND dst.relnamespace=c.relnamespace)) AS valid
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid LEFT JOIN pg_class dst ON dst.oid=k.confrelid
   WHERE c.relnamespace=to_regnamespace('public') AND c.relname IN (${newTables.map(quote).join(',')}) AND k.contype IN ('p','u','f','c')
  ), expected AS (SELECT value AS row FROM jsonb_array_elements(${json(expected)}))
  SELECT row FROM actual WHERE valid IS DISTINCT FROM true
  UNION ALL (SELECT row FROM actual EXCEPT ALL SELECT row FROM expected)
  UNION ALL (SELECT row FROM expected EXCEPT ALL SELECT row FROM actual))`;
}
function installObjectsSql(input){
 return `(SELECT count(*)=${newTables.length} AND bool_and(c.relowner=10 AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
   AND c.xmin::text::numeric=mod(__INSTALL_XID__::text::numeric,4294967296)) FROM pg_class c WHERE c.relnamespace=to_regnamespace('public') AND c.relname IN (${newTables.map(quote).join(',')}))
 AND (SELECT count(*)=${input.material.newRoutines.length+1} AND bool_and(p.proowner=10 AND p.pronamespace=to_regnamespace('public')
   AND p.xmin::text::numeric=mod(__INSTALL_XID__::text::numeric,4294967296)) FROM pg_proc p WHERE p.oid IN
   (${[REGISTRY,...input.material.newRoutines.map(row=>row.signature)].map(signature=>`to_regprocedure(${quote(signature)})`).join(',')}))
 AND (${newConstraintSql()})`;
}
function installedCheckSql(input,xidSql){
 const predicate=installObjectsSql(input).replaceAll('__INSTALL_XID__',`(${xidSql})`);
 return `DO $current259_seven_objects$ BEGIN IF (${predicate}) IS DISTINCT FROM true THEN RAISE EXCEPTION '${CODE}_XMIN'; END IF; END $current259_seven_objects$;`;
}
function applyFragments(input,prior,reference,executorOid){
 return [
  `CREATE TEMP TABLE jg_current259_seven_scope ON COMMIT DROP AS SELECT ${schema205ScopeSql()} AS payload,${schema205WitnessSql()} AS witness;`,
  'ALTER DEFAULT PRIVILEGES FOR ROLE jg_task01_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
  `DO $current259_seven_runtime$ BEGIN PERFORM pg_catalog.set_config('jg.task16_runtime_role',${quote(input.runtime.name)},true); END $current259_seven_runtime$;`,
  ...input.material.fragments,input.material.referenceEdit,checkTransition(input,prior,reference),bridgeSql(input,prior,executorOid),
  installedCheckSql(input,'pg_current_xact_id()'),
 ];
}
function render(input,phase,nonce,prior){
 const before=phase===0,write=phase===1;
 const start=phase===2?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;':'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;';
 const common=[start,SCHEMA205_DEPARSE_LOCAL,'SET LOCAL standard_conforming_strings=on;',
  ...(phase===2?[]:[`LOCK TABLE public._prisma_migrations, ${PENDING}, ${archiveBindings.map(table=>`public.${table}`).join(', ')} IN SHARE MODE NOWAIT;`]),scopeGuards(input,phase)];
 const pre=before||write?renderCurrent259SevenPreimage(nonce):null;
 const ref=pre?.witnessSql.trim().slice(0,-1);
 if(before)return [...common,newObjects(input),pre.setupSql,readbackSql(input,phase,nonce,prior,ref),pre.cleanupSql,'ROLLBACK;'].join('\n');
 const xidSql=write?'pg_current_xact_id()':`${quote(prior.installXid)}::xid8`;
 if(!write)return [...common,installedCheckSql(input,xidSql),readbackSql(input,phase,nonce,prior),'ROLLBACK;'].join('\n');
 return [...common,newObjects(input),pre.setupSql,preimageGuard(input,prior,ref),...applyFragments(input,prior,ref),
  readbackSql(input,phase,nonce,prior),pre.cleanupSql,'COMMIT;'].join('\n');
}
function readResult(result,input,phase,nonce){
 need(typeof result?.stdout==='string'&&Buffer.byteLength(result.stdout)<=256*1024,'OUTPUT');
 const row=JSON.parse(result.stdout);
 need(row&&Object.keys(row).length===10&&row.phase===phases[phase]&&row.nonce===nonce&&
  Number.isInteger(row.backendPid)&&row.backendPid>0&&row.backendPid<=2147483647&&typeof row.backendStart==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.backendStart)&&Number.isFinite(Date.parse(row.backendStart))&&hex(row.catalogSha256,64),'OUTPUT');
 if(phase!==0){
  need(row.pre===null&&row.registry===null&&row.fileRoles===null&&xid(row.installXid)&&row.commitStatus===(phase===2?'committed':null),'OUTPUT');
  return row;
 }
 const {registry,fileRoles}=row;
 need(row.installXid===null&&row.commitStatus===null&&schema205RegistryValid(registry,'10','first')&&registry.namespaceOid===input.id.namespaceOid,'BEFORE');
 need(registry.publicDefault===null&&(!registry.globalDefault||registry.globalDefault.acl.every(a=>a[0]==='10'&&['10','0'].includes(a[1])&&!a[3]))&&
  !registry.publicRoutine.acl.some(a=>['0',input.runtime.oid,input.observer.oid].includes(a[1])),'REGISTRY');
 need(Array.isArray(fileRoles)&&fileRoles.length>=2&&fileRoles.every((id,i)=>oid(id)&&(!i||Number(id)>Number(fileRoles[i-1])))&&
  ['10',input.ordinary.oid].every(id=>fileRoles.includes(id))&&![input.runtime.oid,input.observer.oid].some(id=>fileRoles.includes(id)),'FILE_CALLERS');
 return {...row,pre:parseCurrent259SevenPreimage(JSON.stringify(row.pre),'10',nonce)};
}
function archiveSevenMaterial(lease,view,nonce){
 const input=inputOf(lease,view);
 need(!input.competition,'ARCHIVE_EXECUTOR');
 const executor=input.roleCompletion.roles.find(role=>role.name==='jg_c259_outside_executor_owner');
 need(hex(nonce,64)&&executor?.login===false&&oid(executor.oid)&&![input.ordinary.oid,input.runtime.oid,input.observer.oid,'10'].includes(executor.oid));
 const pre=renderCurrent259SevenPreimage(nonce),reference=pre.witnessSql.trim().slice(0,-1);
 return Object.freeze({
  beforeSql:render(input,0,nonce),
  readBefore(result){
   const prior=readResult(result,input,0,nonce);
   need(!prior.fileRoles.includes(executor.oid)&&!prior.registry.publicRoutine.acl.some(row=>row[1]===executor.oid),'ARCHIVE_EXECUTOR');
   const oldRegistry=prior.registry.publicRoutine;
   const enforcer="pg_catalog.to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')";
   const witness=schema205WitnessSql(),acl="coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))";
   need(witness.split(acl).length===2,'ARCHIVE_WITNESS');
   // The archive stage has already proved the exact 24-grant overlay. Remove
   // its one enforcer grant from the witness projection only, never the catalog.
   const historicEnforcerAcl=`CASE WHEN p.oid=${enforcer} THEN ARRAY(
    SELECT u.entry FROM pg_catalog.unnest(p.proacl) u(entry)
    WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(ARRAY[u.entry]) a WHERE a.grantee=${executor.oid}::oid))
    ELSE ${acl} END`;
   const historicWitness=witness.replace(acl,()=>historicEnforcerAcl);
   const overlay=[...oldRegistry.acl,['10',executor.oid,'EXECUTE',false]].sort((a,b)=>Number(a[0])-Number(b[0])||Number(a[1])-Number(b[1])||a[2].localeCompare(b[2])||Number(a[3])-Number(b[3]));
   const expectedMiddle={...prior.registry,publicRoutine:{...oldRegistry,acl:overlay}};
   const midGuard=`CREATE TEMP TABLE jg_current259_seven_archive_registry ON COMMIT DROP AS SELECT ${schema205RegistrySql()} AS registry;
DO $current259_seven_archive_mid$
DECLARE observed jsonb;
BEGIN
 SELECT registry INTO STRICT observed FROM pg_temp.jg_current259_seven_archive_registry;
 IF jsonb_set(observed,'{publicRoutine,rawAcl}',${json(oldRegistry.rawAcl)}) IS DISTINCT FROM ${json(expectedMiddle)}
  OR ${stableSql(input,json(prior.registry),historicWitness)} IS DISTINCT FROM ${quote(prior.catalogSha256)}
  OR ${fileRolesSql(input)} IS DISTINCT FROM ${json(prior.fileRoles)}
 THEN RAISE EXCEPTION '${CODE}_ARCHIVE_PREIMAGE_DRIFT'; END IF;
END $current259_seven_archive_mid$;`;
   return Object.freeze({
    backendPid:prior.backendPid,backendStart:prior.backendStart,
    writerBefore:[SCHEMA205_DEPARSE_LOCAL,'SET LOCAL standard_conforming_strings=on;',scopeGuards(input,1),
     newObjects(input),pre.setupSql,preimageGuard(input,prior,reference)].join('\n'),
    writerMiddle:[SCHEMA205_DEPARSE_LOCAL,scopeGuards(input,1,'pg_current_xact_id()'),midGuard,
     ...applyFragments(input,prior,reference,executor.oid),pre.cleanupSql].join('\n'),
    committedCheck(installXid){need(xid(installXid));return installedCheckSql(input,`${quote(installXid)}::xid8`);},
    // Render with the same deparse settings after M259 on both backends.
    finalCatalog:stableSql(input),
   });
  },
 });
}
async function installCurrent259SevenFragments(roleCompletion,handle){
 need(arguments.length===2&&handle&&typeof handle==='object'&&!types.isProxy(handle)&&!attempted.has(handle),'HANDLE');
 const lease=claimCurrent259ProvisionedRoles(roleCompletion,handle);
 attempted.add(handle);
 let writing=false;
 try{
  const view=claimCurrent259TechnicalResource(handle);
  const check=()=>{lease.check();view.check();};
 const checkContinuity=token=>{businessIssuer(token,handle);lease.checkContinuity(token);view.checkLifetime();};
  check();
  const input=inputOf(lease,view),nonce=randomBytes(32).toString('hex');
  const run=async(phase,prior)=>{
   check();const sql=render(input,phase,nonce,prior);check();
   if(phase===1)writing=true;
   const result=await view.resource.execOwnerSql(sql,phases[phase]);check();
   return readResult(result,input,phase,nonce);
  };
  const before=await run(0);
  const staged=await run(1,before);
  need(staged.installXid!==input.roleCompletion.commitXid&&staged.catalogSha256!==before.catalogSha256&&
   before.backendPid!==staged.backendPid&&before.backendStart!==staged.backendStart,'STAGED');
  const committed=await run(2,staged);
  need([before,staged].every(row=>row.backendPid!==committed.backendPid&&row.backendStart!==committed.backendStart)&&
   committed.installXid===staged.installXid&&committed.catalogSha256===staged.catalogSha256,'COMMITTED');
  check();
  const completion=Object.freeze({status:'CURRENT259_SEVEN_INSTALLED_NOT_ADMISSION',sourceSha:input.roleCompletion.sourceSha,
   runId:input.roleCompletion.runId,containerId:input.roleCompletion.containerId,installXid:committed.installXid,catalogSha256:committed.catalogSha256,nativeAdmission:false});
  installed.set(completion,{handle,check,checkContinuity,source:input.source,roleCompletion:input.roleCompletion,
   competition:input.competition,...(input.competition?{input}:{})});
  return completion;
 }catch{
  const primary=error(writing?'COMMIT_UNCONFIRMED':'PRESTATE_REJECTED');
  try{await closeCurrent259OwnedResource(handle);}catch{Object.defineProperty(primary,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});}
  throw primary;
 }
}
function claimCurrent259SevenInstallation(completion,handle){
 need(arguments.length===2,'HANDLE');
 return claimSevenInstallation(completion,handle,false);
}
function claimCurrent259VoucherSevenInstallation(completion,handle){
 need(arguments.length===2,'HANDLE');
 return claimSevenInstallation(completion,handle,true);
}
function claimSevenInstallation(completion,handle,voucher){
 need(completion&&!types.isProxy(completion)&&installed.has(completion),'HANDLE');
 const receipt=installed.get(completion);
 need(receipt.handle===handle&&(!voucher||receipt.competition),'HANDLE');
 installed.delete(completion);receipt.check();
 const {check,checkContinuity,source,roleCompletion,competition}=receipt;
 return Object.freeze({completion,check,checkContinuity,source,roleCompletion,...(competition?{competition:true}:{}),
  ...(voucher?{voucherPreimageSql:voucherSevenPreimageSql(receipt.input,completion.catalogSha256)}:{})});
}
function voucherSevenPreimageSql(input,catalogSha256){
 const {current259VoucherAcl}=require('./task16-current259-voucher-acl.cjs');
 const {bindingSha256Sql}=current259VoucherAcl();
 return `${SCHEMA205_DEPARSE_LOCAL}
CREATE TEMP TABLE pg_temp.jg_c259_voucher_preimage ON COMMIT DROP AS
 SELECT ${stableSql(input)} AS catalog_sha256, ${bindingSha256Sql} AS binding_sha256;
DO $current259_voucher_seven_preimage$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_temp.jg_c259_voucher_preimage
   WHERE catalog_sha256=${quote(catalogSha256)} AND binding_sha256 IS NOT NULL)
 THEN RAISE EXCEPTION '${CODE}_VOUCHER_PREIMAGE_DRIFT'; END IF;
END $current259_voucher_seven_preimage$;
SET LOCAL search_path=pg_catalog,pg_temp;`;
}
module.exports=Object.freeze({installCurrent259SevenFragments,claimCurrent259SevenInstallation,archiveSevenMaterial,
 claimCurrent259VoucherSevenInstallation});
