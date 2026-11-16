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
