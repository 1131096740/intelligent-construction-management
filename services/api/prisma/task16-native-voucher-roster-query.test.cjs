'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('./task16-native-voucher-roster-query.cjs');
const phase='VOUCHER_AUTHORIZED_TICKET';
const sql='SELECT "public"."ProjectRosterMember"."projectId" FROM "public"."ProjectRosterMember" WHERE "public"."ProjectRosterMember"."userId" = $1 OFFSET $2';
test('voucher query projection retains only the fixed scope and actual allowed column references',()=>{
 assert.deepEqual(api.projectNativeTask16RosterQuery({query:sql},'runtime_a',phase),{lane:'runtime_a',stage:phase,relation:'ProjectRosterMember',operation:'SELECT',columns:['projectId','userId'],unknownShape:false});
});
for(const [query,operation,columns]of [
 ['SELECT r."projectId" FROM public."ProjectRosterMember" AS r WHERE r."userId" = $1 ORDER BY r."id" ASC OFFSET $2','SELECT',['id','projectId','userId']],
 ['SELECT "member"."projectId" AS "visible" FROM "public"."ProjectRosterMember" "member" WHERE ("member"."userId" = $1 AND 1=1)','SELECT',['projectId','userId']],
 ['SELECT COUNT(*) FROM "public"."ProjectRosterMember" r WHERE r."createdAt" > $1','COUNT',['createdAt']],
 ['SELECT COUNT(1) AS "count" FROM "ProjectRosterMember" WHERE "userId" IN ($1,$2)','COUNT',['userId']]
])test('aliases and COUNT stay unknown outside the fixed Prisma findMany shape '+operation+columns.join(','),()=>{
 assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_b',phase),{lane:'runtime_b',stage:phase,relation:'ProjectRosterMember',operation:'UNKNOWN',columns:[],unknownShape:true});
});

test('only the fixed voucher purpose and its two runtime constructor shapes request event logging',()=>{
 const purpose='TASK16_NATIVE_COMPETITION_VOUCHER_V1';
 for(const lane of ['runtime_a','runtime_b'])assert.deepEqual(api.nativeTask16VoucherQueryLogOptions(purpose,lane),{log:[{emit:'event',level:'query'}]});
 for(const lane of ['owner','observer','runtime',undefined,{},new String('runtime_a')])assert.equal(api.nativeTask16VoucherQueryLogOptions(purpose,lane),undefined);
 for(const purpose of ['TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1','TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1','voucher',undefined,{}])assert.equal(api.nativeTask16VoucherQueryLogOptions(purpose,'runtime_a'),undefined);
});
test('two query handlers persist at most twelve fixed projections and never read params or arbitrary event fields',()=>{
 const receipt={},collector=api.createNativeTask16RosterQueryDiagnostic(receipt,()=>phase),a=collector.forLane('runtime_a'),b=collector.forLane('runtime_b');let traps=0;
 const event={query:sql,get params(){traps++;throw Error('SECRET');},get target(){traps++;throw Error('SECRET');}};
 for(let i=0;i<13;i++)assert.doesNotThrow(()=>(i%2?a:b)(event));
 assert.equal(traps,0);assert.equal(receipt.voucherRosterQueries.events.length,12);assert.equal(receipt.voucherRosterQueries.overflow,true);
 assert.ok(Object.isFrozen(receipt.voucherRosterQueries.events));assert.doesNotMatch(JSON.stringify(receipt),/SECRET|params|SELECT "|OFFSET|"query"|"target"/u);
 assert.equal(collector.forLane('owner'),undefined);assert.equal(collector.forLane('observer'),undefined);
});

for(const query of [
 sql+'; SELECT "id" FROM "ProjectRosterMember"',
 sql+' /* SECRET comment */',sql.replace(' WHERE',' -- SECRET\n WHERE'),
 'UPDATE "public"."ProjectRosterMember" SET "projectId" = $1 WHERE "userId" = $2',
 'DELETE FROM "public"."ProjectRosterMember" WHERE "userId" = $1',
 'SELECT * FROM "public"."ProjectRosterMember"',
 'SELECT "projectId" FROM "public"."ProjectRosterMember" WHERE "userId" = \'SECRET token\'',
 'SELECT "projectId" FROM "public"."ProjectRosterMember" WHERE "userId" = $$SECRET token$$',
 'SELECT "projectId" FROM "public"."ProjectRosterMember" WHERE "userId" = $value$SECRET$value$',
 'SELECT "projectId" FROM "public"."ProjectRosterMember" JOIN "User" ON 1=1',
 'SELECT "secret" FROM "public"."ProjectRosterMember"',
 'SELECT "projectId" FROM "public"."ProjectRosterMember" LIMIT $1 LIMIT $2',
 'SELECT COUNT(*) FROM (SELECT "projectId" FROM "public"."ProjectRosterMember") AS sub',
 'SELECT "projectId" FROM "public"."ProjectRosterMember" WHERE '+'('.repeat(40)+'"userId" = $1'+')'.repeat(40),
 'SELECT "projectId" FROM "public"."ProjectRosterMember" WHERE 1=1 /* /* SECRET */ */'
])test('unsupported target query shapes stay UNKNOWN with no partial column or value inference '+query.slice(0,28),()=>{
 assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_a',phase),{lane:'runtime_a',stage:phase,relation:'ProjectRosterMember',operation:'UNKNOWN',columns:[],unknownShape:true});
});
test('comments and string values cannot impersonate a roster relation',()=>{
 for(const query of ['SELECT \'"ProjectRosterMember"\' FROM "User"','SELECT $secret$FROM "ProjectRosterMember"$secret$ FROM "User"','SELECT "id" FROM "User" /* FROM "ProjectRosterMember" */','SELECT "id" AS "ProjectRosterMember" FROM "User"'])assert.equal(api.projectNativeTask16RosterQuery({query},'runtime_a',phase),null);
});
test('untrusted SDK event descriptors and oversized queries cannot read params, invoke user code or escape the fixed scope',()=>{
 let traps=0;const getter={get query(){traps++;throw Error('SECRET');}},proxy=new Proxy({},{get(){traps++;throw Error('SECRET');},getOwnPropertyDescriptor(){traps++;throw Error('SECRET');}});
 for(const event of [getter,proxy,Object.create(getter),{query:new String(sql)},null,undefined,sql,{query:sql+' '.repeat(32769)}])assert.equal(api.projectNativeTask16RosterQuery(event,'runtime_a',phase),null);
 assert.equal(traps,0);
 for(const [lane,stage]of [['owner',phase],['observer',phase],['runtime',phase],['runtime_a','SECRET stage'],['runtime_a','VOUCHER_AUTHORIZED_TICKET;SECRET']])assert.equal(api.projectNativeTask16RosterQuery({query:sql},lane,stage),null);
});
test('all thirteen existing voucher stages are finite and non-voucher stages remain silent',()=>{
 const receipt={};let stage='SEED_TWO_LOGINS_AND_OPENINGS';const handler=api.createNativeTask16RosterQueryDiagnostic(receipt,()=>stage).forLane('runtime_a');handler({query:sql});assert.deepEqual(receipt,{});
 for(const suffix of ['LEDGER_BEFORE','OWNER_BEFORE','MULTIPART_UPLOAD','ATTACH','REPEAT_UPLOAD','REPEAT_ATTACH','AUTHORIZED_TICKET','HTTP_DOWNLOAD','ORIGINAL_RESULT','RECORDED_ITEMS','OWNER_AFTER','STORAGE_BYTES','LEDGER_AFTER']){
  const result=api.projectNativeTask16RosterQuery({query:sql},'runtime_b','VOUCHER_'+suffix);assert.equal(result.stage,'VOUCHER_'+suffix);
 }
});
test('diagnostic handlers cannot throw or replace a source error even if receipt or stage access fails',()=>{
 for(const receipt of [Object.freeze({}),Object.defineProperty({},'voucherRosterQueries',{get(){throw Error('SECRET');}})]){
  const handler=api.createNativeTask16RosterQueryDiagnostic(receipt,()=>phase).forLane('runtime_a');assert.doesNotThrow(()=>handler({query:sql}));
 }
 const handler=api.createNativeTask16RosterQueryDiagnostic({},()=>{throw Error('SECRET');}).forLane('runtime_b');assert.doesNotThrow(()=>handler({query:sql}));
 const source=Error('ORIGINAL BUSINESS FAILURE'),receipt={},normal=api.createNativeTask16RosterQueryDiagnostic(receipt,()=>phase).forLane('runtime_a');
 const run=()=>{normal({query:sql});throw source;};assert.throws(run,error=>error===source);
 assert.deepEqual(Object.keys(receipt),['voucherRosterQueries']);
});

test('escaped identifiers never turn arbitrary quoted contents into allowed column names',()=>{
 const query='SELECT "projectId""SECRET" FROM "public"."ProjectRosterMember" WHERE "userId" = $1';
 assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_a',phase),{lane:'runtime_a',stage:phase,relation:'ProjectRosterMember',operation:'UNKNOWN',columns:[],unknownShape:true});
});

test('fixed archive discovery query emits only its nine allowed scalar references and fileId predicate',()=>{
 const columns=['id','archiveFileId','contractVersionId','fileId','displayOrder','mimeType','sizeBytes','contentSha256','createdAt'];
 const query='SELECT '+columns.map(c=>'"public"."ContractArchiveEvidenceFile"."'+c+'"').join(', ')+' FROM "public"."ContractArchiveEvidenceFile" WHERE "public"."ContractArchiveEvidenceFile"."fileId" = $1 LIMIT $2 OFFSET $3';
 assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_b',phase),{lane:'runtime_b',stage:phase,relation:'ContractArchiveEvidenceFile',operation:'SELECT',columns,unknownShape:false});
});

for(const tail of [
 'WHERE "public"."ContractArchiveEvidenceFile"."fileId" = $1',
 'WHERE "public"."ContractArchiveEvidenceFile"."fileId" = $1 LIMIT 1 OFFSET $2',
 'WHERE "public"."ContractArchiveEvidenceFile"."userId" = $1 LIMIT $2 OFFSET $3',
 'AS evidence WHERE evidence."fileId" = $1 LIMIT $2 OFFSET $3',
 'WHERE "public"."ContractArchiveEvidenceFile"."fileId" = $1 LIMIT $2 OFFSET $3; SELECT 1',
 'WHERE "public"."ContractArchiveEvidenceFile"."fileId" = \'SECRET_VALUE\' LIMIT $2 OFFSET $3',
 'WHERE "public"."ContractArchiveEvidenceFile"."fileId" = $1 LIMIT $2 OFFSET $3 /* SECRET */'
])test('archive discovery accepts no aliases, literal values, multi-statements or non-source pagination '+tail.slice(0,25),()=>{
 const query='SELECT "public"."ContractArchiveEvidenceFile"."id" FROM "public"."ContractArchiveEvidenceFile" '+tail;
 assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_a',phase),{lane:'runtime_a',stage:phase,relation:'ContractArchiveEvidenceFile',operation:'UNKNOWN',columns:[],unknownShape:true});
});
test('archive relation and roster relation cannot borrow each other\'s allowed fields',()=>{
 for(const [relation,column,predicate,limit]of [['ProjectRosterMember','archiveFileId','userId',''],['ContractArchiveEvidenceFile','projectId','fileId',' LIMIT $2']]){
  const query=`SELECT "public"."${relation}"."${column}" FROM "public"."${relation}" WHERE "public"."${relation}"."${predicate}" = $1${limit}`;
  assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_a',phase),{lane:'runtime_a',stage:phase,relation,operation:'UNKNOWN',columns:[],unknownShape:true});
 }
});
test('both fixed relations share the same twelve-event cap and never read SDK params or return their data',()=>{
 const receipt={},collector=api.createNativeTask16RosterQueryDiagnostic(receipt,()=>phase),a=collector.forLane('runtime_a'),b=collector.forLane('runtime_b');let params=0;
 const archive='SELECT "public"."ContractArchiveEvidenceFile"."id" FROM "public"."ContractArchiveEvidenceFile" WHERE "public"."ContractArchiveEvidenceFile"."fileId" = $1 LIMIT $2 OFFSET $3';
 for(let i=0;i<14;i++)assert.doesNotThrow(()=>(i%2?a:b)({query:i%2?sql:archive,get params(){params++;throw Error('SECRET_UUID_HASH_TOKEN');}}));
 assert.equal(params,0);assert.equal(receipt.voucherRosterQueries.events.length,12);assert.equal(receipt.voucherRosterQueries.overflow,true);
 assert.deepEqual([...new Set(receipt.voucherRosterQueries.events.map(e=>e.relation))].sort(),['ContractArchiveEvidenceFile','ProjectRosterMember']);
 assert.doesNotMatch(JSON.stringify(receipt),/SECRET|SELECT "|params|OFFSET/u);
});
test('archive quoted text cannot impersonate the second fixed relation',()=>{
 for(const query of ['SELECT \'FROM "ContractArchiveEvidenceFile"\' FROM "User"','SELECT "id" FROM "User" /* FROM "ContractArchiveEvidenceFile" */'])assert.equal(api.projectNativeTask16RosterQuery({query},'runtime_a',phase),null);
});

test('voucher download wage evidence lookup projects only the selected and predicate column names',()=>{
 const query='SELECT "public"."WageApprovedSourceVersion"."id" FROM "public"."WageApprovedSourceVersion" WHERE "public"."WageApprovedSourceVersion"."evidenceFileId" = $1 LIMIT $2 OFFSET $3';
 assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_a','VOUCHER_HTTP_DOWNLOAD'),{lane:'runtime_a',stage:'VOUCHER_HTTP_DOWNLOAD',relation:'WageApprovedSourceVersion',operation:'SELECT',columns:['id','evidenceFileId'],unknownShape:false});
});

test('wage diagnostic is download-only and closes on non-source shapes without exposing values',()=>{
 const prefix='SELECT "public"."WageApprovedSourceVersion"."id" FROM "public"."WageApprovedSourceVersion" WHERE ';
 const valid=prefix+'"public"."WageApprovedSourceVersion"."evidenceFileId" = $1 LIMIT $2 OFFSET $3';
 assert.equal(api.projectNativeTask16RosterQuery({query:valid},'runtime_a','VOUCHER_AUTHORIZED_TICKET'),null);
 for(const query of [
  prefix+'"public"."WageApprovedSourceVersion"."evidenceFileId" = \'SECRET\' LIMIT $2 OFFSET $3',
  prefix+'"public"."WageApprovedSourceVersion"."id" = $1 LIMIT $2 OFFSET $3',
  valid+'; SELECT 1', valid+' /* SECRET */',
  valid.replace('."id" FROM','."evidenceFileId" FROM'),
  valid.replace(' LIMIT $2',' LIMIT 1')
 ]) assert.deepEqual(api.projectNativeTask16RosterQuery({query},'runtime_b','VOUCHER_HTTP_DOWNLOAD'),{lane:'runtime_b',stage:'VOUCHER_HTTP_DOWNLOAD',relation:'WageApprovedSourceVersion',operation:'UNKNOWN',columns:[],unknownShape:true});
 const receipt={},handler=api.createNativeTask16RosterQueryDiagnostic(receipt,()=> 'VOUCHER_HTTP_DOWNLOAD').forLane('runtime_a');
 handler({query:valid,get params(){throw Error('SECRET');}});
 assert.doesNotMatch(JSON.stringify(receipt),/SECRET|SELECT "|params/u);
});
test('cash replay projects only bounded ContractPartySnapshot query shape without values',()=>{
 const api=require('./task16-native-voucher-roster-query.cjs');
 const query='SELECT "public"."ContractPartySnapshot"."businessPartyVersionId", "public"."ContractPartySnapshot"."snapshot" FROM "public"."ContractPartySnapshot" WHERE ("public"."ContractPartySnapshot"."contractVersionId" = $1 AND "public"."ContractPartySnapshot"."roleKey" = $2) ORDER BY "public"."ContractPartySnapshot"."displayOrder" ASC LIMIT $3 OFFSET $4';
 let readParams=0;const event={query,get params(){readParams++;throw Error('PRIVATE');}};
 assert.deepEqual(api.projectNativeTask16CashPartyQuery(event,'runtime_a','CASH_SEED_AND_SETTLEMENT_REPLAY'),{lane:'runtime_a',stage:'CASH_SEED_AND_SETTLEMENT_REPLAY',relation:'ContractPartySnapshot',operation:'SELECT',columns:['businessPartyVersionId','contractVersionId','displayOrder','roleKey','snapshot'],unknownShape:false});
 assert.equal(readParams,0);assert.equal(api.projectNativeTask16CashPartyQuery(event,'runtime_b','CASH_SEED_AND_SETTLEMENT_REPLAY'),null);
 assert.equal(api.projectNativeTask16CashPartyQuery(event,'runtime_a','CASH_PAYMENT_AND_OBSERVER'),null);
 const unknown=api.projectNativeTask16CashPartyQuery({query:query.replace('"snapshot"','*')},'runtime_a','CASH_SEED_AND_SETTLEMENT_REPLAY');
 assert.equal(unknown.unknownShape,true);assert.deepEqual(unknown.columns,[]);
});
test('cash query diagnostic is bounded and refuses unsupported shapes, accessors and unrelated purposes',()=>{
 const api=require('./task16-native-voucher-roster-query.cjs'),stage='CASH_SEED_AND_SETTLEMENT_REPLAY',prefix='SELECT * FROM "public"."ContractPartySnapshot"';let traps=0;
 assert.equal(api.projectNativeTask16CashPartyQuery({get query(){traps++;throw Error('PRIVATE');}},'runtime_a',stage),null);assert.equal(traps,0);
 for(const query of [prefix,prefix+' -- private',prefix+' WHERE secret=\'PRIVATE\'',prefix+' JOIN "public"."User" u ON true']){
  const result=api.projectNativeTask16CashPartyQuery({query},'runtime_a',stage);assert.equal(result.unknownShape,true);assert.deepEqual(result.columns,[]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SELECT |secret/u);
 }
 const receipt={},record=api.createNativeTask16CashPartyDiagnostic(receipt,()=>stage);
 for(let i=0;i<14;i++)record({query:prefix});assert.equal(receipt.cashPartyQueries.events.length,12);assert.equal(receipt.cashPartyQueries.overflow,true);
 for(const purpose of ['TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1','TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1','TASK16_NATIVE_COMPETITION_VOUCHER_V1'])assert.equal(api.nativeTask16CashPartyQueryLogOptions(purpose,'runtime_a'),undefined);
});
test('cash close diagnostic captures only whitelisted token shapes with no values',()=>{
 const api=require('./task16-native-voucher-roster-query.cjs'),stage='CASH_SEED_AND_SETTLEMENT_REPLAY';let traps=0;
 const query='INSERT INTO "public"."ProjectCloseAggregate" ("projectId","revision","createdAt","updatedAt") VALUES ($1,$2,$3,$4) ON CONFLICT ("projectId") DO UPDATE SET "updatedAt" = $5 WHERE "public"."ProjectCloseAggregate"."projectId" = $6 RETURNING "public"."ProjectCloseAggregate"."projectId"';
 const event={query,get params(){traps++;throw Error('PRIVATE');}},result=api.projectNativeTask16CashCloseQuery(event,'runtime_a',stage);
 assert.equal(result.unknownShape,false);assert.equal(result.operation,'INSERT');assert.ok(result.tokens.includes('projectId'));assert.ok(result.tokens.includes('PARAM'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE|\$1|params/u);assert.equal(traps,0);
 assert.equal(api.projectNativeTask16CashCloseQuery(event,'runtime_b',stage),null);
 for(const input of [query+' -- PRIVATE',query.replace('$1',"'PRIVATE'"),query.replace('"revision"','"private_unknown"')]){
  const out=api.projectNativeTask16CashCloseQuery({query:input},'runtime_a',stage);assert.equal(out.unknownShape,true);assert.deepEqual(out.tokens,[]);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|private_unknown/u);
 }
});
test('cash close recorder remains stage-limited, lane-limited and bounded',()=>{
 const api=require('./task16-native-voucher-roster-query.cjs'),stage='CASH_SEED_AND_SETTLEMENT_REPLAY';let now=stage,receipt={};
 const record=api.createNativeTask16CashPartyDiagnostic(receipt,()=>now),event={query:'SELECT 1 FROM "ProjectCloseAggregate" WHERE "projectId" = $1 FOR UPDATE'};
 assert.equal(api.projectNativeTask16CashCloseQuery(event,'runtime_b',stage),null);now='CASH_PAYMENT_AND_OBSERVER';record(event);assert.equal(receipt.cashCloseQueries,undefined);
 now=stage;for(let i=0;i<14;i++)record(event);assert.equal(receipt.cashCloseQueries.events.length,12);assert.equal(receipt.cashCloseQueries.overflow,true);
});
test('cash close impact diagnostic records bounded model columns and no values',()=>{
 const api=require('./task16-native-voucher-roster-query.cjs'),stage='CASH_SEED_AND_SETTLEMENT_REPLAY';let traps=0;
 const query='SELECT "public"."ProjectCloseImpact"."id" FROM "public"."ProjectCloseImpact" WHERE ("public"."ProjectCloseImpact"."projectId" = $1 AND "public"."ProjectCloseImpact"."sourceType" = $2 AND "public"."ProjectCloseImpact"."sourceId" = $3 AND "public"."ProjectCloseImpact"."sourceFingerprint" = $4) LIMIT $5 OFFSET $6';
 const event={query,get params(){traps++;throw Error('PRIVATE');}},out=api.projectNativeTask16CashImpactQuery(event,'runtime_a',stage);
 assert.equal(out.unknownShape,false);assert.equal(out.operation,'SELECT');assert.ok(out.tokens.includes('id'));assert.ok(out.tokens.includes('sourceFingerprint'));assert.equal(traps,0);
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE|\$1|params/u);assert.equal(api.projectNativeTask16CashImpactQuery(event,'runtime_b',stage),null);
 for(const query2 of [query+' -- PRIVATE',query.replace('$1',"'PRIVATE'"),query.replace('"sourceType"','"private_unknown"')]){
  const value=api.projectNativeTask16CashImpactQuery({query:query2},'runtime_a',stage);assert.equal(value.unknownShape,true);assert.deepEqual(value.tokens,[]);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|private_unknown/u);
 }
 const receipt={},record=api.createNativeTask16CashPartyDiagnostic(receipt,()=>stage);for(let i=0;i<14;i++)record(event);
 assert.equal(receipt.cashImpactQueries.events.length,12);assert.equal(receipt.cashImpactQueries.overflow,true);
});
test('cash close stage diagnostic only records whitelisted shape in bounded runtime lane',()=>{
 const api=require('./task16-native-voucher-roster-query.cjs'),stage='CASH_SEED_AND_SETTLEMENT_REPLAY';let traps=0;
 const query='SELECT "public"."ProjectCloseStageVersion"."id", "public"."ProjectCloseStageVersion"."projectId", "public"."ProjectCloseStageVersion"."stageKey", "public"."ProjectCloseStageVersion"."revision", "public"."ProjectCloseStageVersion"."status" FROM "public"."ProjectCloseStageVersion" WHERE ("public"."ProjectCloseStageVersion"."projectId" = $1 AND "public"."ProjectCloseStageVersion"."stageKey" IN ($2,$3)) ORDER BY "public"."ProjectCloseStageVersion"."stageKey" ASC, "public"."ProjectCloseStageVersion"."revision" DESC OFFSET $4';
 const event={query,get params(){traps++;throw Error('PRIVATE');}},out=api.projectNativeTask16CashStageQuery(event,'runtime_a',stage);
 assert.equal(out.unknownShape,false);assert.equal(out.operation,'SELECT');assert.ok(out.tokens.includes('stageKey'));assert.equal(traps,0);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|\$1|params/u);
 assert.equal(api.projectNativeTask16CashStageQuery(event,'runtime_b',stage),null);assert.equal(api.projectNativeTask16CashStageQuery(event,'runtime_a','CASH_PAYMENT_AND_OBSERVER'),null);
 for(const query2 of [query+' -- PRIVATE',query.replace('$1',"'PRIVATE'"),query.replace('"status"','"private_unknown"')]){
  const value=api.projectNativeTask16CashStageQuery({query:query2},'runtime_a',stage);assert.equal(value.unknownShape,true);assert.deepEqual(value.tokens,[]);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|private_unknown/u);
 }
 const receipt={},record=api.createNativeTask16CashPartyDiagnostic(receipt,()=>stage);for(let i=0;i<14;i++)record(event);
 assert.equal(receipt.cashStageQueries.events.length,12);assert.equal(receipt.cashStageQueries.overflow,true);
});
