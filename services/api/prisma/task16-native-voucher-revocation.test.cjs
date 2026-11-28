'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runNativeVoucherRevocation,runNativeVoucherDisabled,prepareNativeVoucherForRevocation}=require('./task16-native-voucher-revocation.cjs');

// These are protocol tests of the GET-only case using a fake transport and
// observer. They do not claim PostgreSQL, Nest or storage acceptance.
const ids={actor:'00000000-0000-4000-8000-000000000001',project:'00000000-0000-4000-8000-000000000002',other:'00000000-0000-4000-8000-000000000003',member:'00000000-0000-4000-8000-000000000004',execution:'00000000-0000-4000-8000-000000000005',file:'00000000-0000-4000-8000-000000000006',payment:'00000000-0000-4000-8000-000000000007'};
const base='http://127.0.0.1:30001';
const bytes=Buffer.from('synthetic voucher');
const sha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');

function scenario({retainsTicket=false,extraRoster=false,drift=false,inactive=false,disabledMode=false,readOnDenied=false,writerOid='10'}={}) {
 let revoked=false,issued=false,downloaded=false,storageReads=0;const requests=[];
 const origin=new URL(base);
 const members=()=>revoked&&!disabledMode?[]:[{id:ids.member,positionKey:'project_manager'}];
 const observe=async()=>({stdout:JSON.stringify({databaseOid:'16384',systemIdentifier:'12345',readerOid:'10',readerPid:7,readerTls:true,ownerSession:true,readOnly:true,
  active:!inactive&&!(revoked&&disabledMode),targetActive:true,otherActive:true,sessionVersion:0,globalPositions:0,targetPositions:0,targetRoster:extraRoster?1:0,
  targetMembers:members(),otherMembers:[{id:'77777777-7777-4777-8777-777777777777',positionKey:'project_manager'}],paymentPresent:true,executionPresent:true,fundingPresent:true,voucherPresent:true,
  fileSha256:sha,fileSize:bytes.length,financialSha:drift&&revoked?'b'.repeat(64):'a'.repeat(64),
  ticketAudits:issued?1:0,downloadAudits:downloaded?1:0})});
 const revoke=async()=>{revoked=true;return {stdout:JSON.stringify({deleted:1,updated:1,databaseOid:'16384',systemIdentifier:'12345',writerOid,writerPid:8,writerTls:true,ownerSession:true})};};
 const transport=async(target,init)=>{
  const u=new URL(target);requests.push([u.pathname,init.method,Boolean(init.headers?.authorization)]);
  if(u.pathname==='/projects')return {status:200,url:u.href,redirected:false,json:async()=>[{id:ids.other},...(!revoked?[{id:ids.project}]:[])]};
  if(u.pathname.endsWith('/download-ticket-capability'))return {status:revoked?403:200,url:u.href,redirected:false,json:async()=>({action:{enabled:true}})};
  if(u.pathname.endsWith('/voucher-ticket')){
   if(revoked)return {status:403,url:u.href,redirected:false,json:async()=>({})};
   issued=true;const expiresAt=new Date(Date.now()+60000).toISOString();
   const p=new URL(`/files/${ids.file}/download`,origin);for(const [k,v] of Object.entries({actorUserId:ids.actor,expiresAt,downloadReason:'实际付款凭证下载',accessMode:'download',token:'A'.repeat(43)}))p.searchParams.set(k,v);
   return {status:200,url:u.href,redirected:false,json:async()=>({fileId:ids.file,sizeBytes:bytes.length,expiresAt,downloadUrl:p.pathname+p.search})};
  }
  if(u.pathname.endsWith('/download')) {const allowed=!revoked||retainsTicket;if(allowed){downloaded=true;storageReads++;}else if(readOnDenied)storageReads++;return {status:allowed?200:403,url:u.href,redirected:false,headers:{get:key=>key==='content-length'?String(bytes.length):'image/png'},body:{getReader:()=>{let sent=false;return {read:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes}),releaseLock(){}};}}};}
  throw Error('unexpected route');
 };
 return {input:{ids,origin:base,token:'synthetic-token',fileSha256:sha,fileSize:bytes.length,known:{databaseOid:'16384',systemIdentifier:'12345',ownerOid:'10',sessionPids:[1,2,3]},observe,revoke,transport,check(){},storageReadCount:()=>storageReads},requests};
}

test('revoked manager loses capability and both new and already issued tickets while other project and immutable facts remain',async()=>{
 const {input,requests}=scenario();const receipt=await runNativeVoucherRevocation(input);
 assert.deepEqual(receipt,{authorizedBefore:true,capabilityDenied:true,newTicketDenied:true,oldTicketDenied:true,otherProjectReadable:true,observedFactsUnchanged:true});
 assert.ok(requests.every(([,method])=>method==='GET'));
 assert.equal(requests.filter(([path])=>path.endsWith('/download')).every(([, ,hasBearer])=>!hasBearer),true);
});
test('refuses to revoke when another target visibility path remains',async()=>{
 const {input,requests}=scenario({extraRoster:true});await assert.rejects(runNativeVoucherRevocation(input));assert.equal(requests.length,0);
});
test('never marks success if old ticket still works or immutable funds changed',async()=>{
 await assert.rejects(runNativeVoucherRevocation(scenario({retainsTicket:true}).input));
 await assert.rejects(runNativeVoucherRevocation(scenario({drift:true}).input));
});

function fundingSnapshot(after=false){return {requestStatus:after?'partially_paid':'approved_pending_payment',approvedCents:'4000',paidCents:after?'3000':'0',settlementPayableCents:'4000',settlementPaidCents:after?'3000':'0',balanceA:'100.0000',balanceB:after?'70.0000':'100.0000',sourceAvailable:after?'70.0000':'100.0000',executionCount:after?1:0,fundingCount:after?1:0,allocationCount:after?1:0,eventCount:after?1:0,rootCount:after?1:0,recordAuditCount:after?1:0,factCount:0,impactCount:0,executionId:after?ids.execution:null,executionCents:after?'3000':null,allocationCents:after?'3000':'0',rightKey:after,rightSource:after?true:false,rightPayer:after?true:false,rightRoot:after?true:false};}

test('fixture prepares an existing registered voucher through the real service seam without a payment HTTP POST',async()=>{
 const calls=[];const key='00000000-0000-4000-8000-000000000008',registration='00000000-0000-4000-8000-000000000009',source='00000000-0000-4000-8000-00000000000a',company='00000000-0000-4000-8000-00000000000b';
 const snapshot=(()=>{let n=0;return async()=>fundingSnapshot(n++>0);})();
 const service={registeredExecutionOptions:async()=>({expectedPaymentUpdatedAt:'2026-11-05T00:00:00.000Z',remainingAmountCents:'4000',accounts:[{scopeKey:`company:${company}`,eligible:true,currentRegistrationId:registration}]}),recordRegisteredExecution:async(...args)=>{calls.push(['record',...args]);return {id:ids.execution};},uploadRegisteredVoucherFile:async(...args)=>{calls.push(['upload',...args]);return {id:ids.file,contentSha256:sha,sizeBytes:bytes.length};},attachRegisteredVoucher:async(...args)=>{calls.push(['attach',...args]);return {executionId:ids.execution,voucherPending:false};}};
 const result=await prepareNativeVoucherForRevocation({service,fixture:{plan:{ids:{actor:ids.actor,payment:ids.payment,companyB:company,requestKey:key},paidAt:'2026-11-06'},companyBRegistrationId:registration,companyBSourceId:source},password:'synthetic-password',voucherBytes:bytes,snapshot,check(){}});
 assert.deepEqual(result,{executionId:ids.execution,fileId:ids.file,fileSha256:sha,fileSize:bytes.length});
 assert.deepEqual(calls.map(x=>x[0]),['record','upload','attach']);assert.equal(calls[0][3].amountCents,'3000');
});

test('reader fixture creates exactly two scoped memberships through the owner transaction',async()=>{
 const api=require('./task16-native-voucher-revocation.cjs');const writes=[];
 const tx={user:{create:async x=>writes.push(['user',x])},project:{create:async x=>writes.push(['project',x])},projectMember:{create:async x=>writes.push(['member',x])}};
 const owner={$transaction:async cb=>cb(tx)};
 const result=await api.seedNativeVoucherRevocationReader({owner,ids,phone:'19712345678',passwordHash:'synthetic-hash',check(){}});
 assert.deepEqual(result,{actor:ids.actor,project:ids.project,other:ids.other,member:ids.member});
 assert.deepEqual(writes.map(x=>x[0]),['user','project','member','member']);
 assert.equal(writes[2][1].data.positionKey,'project_manager');assert.equal(writes[3][1].data.positionKey,'project_manager');
 assert.equal(writes[0][1].data.mustChangePassword,false);
});

test('unknown registration outcome is never retried and never uploads a voucher',async()=>{
 let registrations=0,uploads=0;
 const key='00000000-0000-4000-8000-000000000008',registration='00000000-0000-4000-8000-000000000009',source='00000000-0000-4000-8000-00000000000a',company='00000000-0000-4000-8000-00000000000b';
 const service={registeredExecutionOptions:async()=>({expectedPaymentUpdatedAt:'2026-11-05T00:00:00.000Z',remainingAmountCents:'4000',accounts:[{scopeKey:`company:${company}`,eligible:true,currentRegistrationId:registration}]}),recordRegisteredExecution:async()=>{registrations++;throw Error('unknown commit');},uploadRegisteredVoucherFile:async()=>{uploads++;},attachRegisteredVoucher:async()=>{throw Error('unexpected attachment');}};
 await assert.rejects(prepareNativeVoucherForRevocation({service,fixture:{plan:{ids:{actor:ids.actor,payment:ids.payment,companyB:company,requestKey:key},paidAt:'2026-11-06'},companyBRegistrationId:registration,companyBSourceId:source},password:'synthetic-password',voucherBytes:bytes,snapshot:async()=>fundingSnapshot(),check(){}}),/unknown commit/);
 assert.equal(registrations,1);assert.equal(uploads,0);
});

test('inactive actor and deletion from a foreign owner never pass',async()=>{
 const inactive=scenario({inactive:true});await assert.rejects(runNativeVoucherRevocation(inactive.input));assert.equal(inactive.requests.length,0);
 await assert.rejects(runNativeVoucherRevocation(scenario({writerOid:'11'}).input));
});

test('payment preimage or postimage drift blocks fixture and never retries',async()=>{
 const api=require('./task16-native-voucher-revocation.cjs');
 assert.throws(()=>api.assertVoucherFundingSnapshot({...fundingSnapshot(),sourceAvailable:'99.0000'},false,ids.execution));
 assert.throws(()=>api.assertVoucherFundingSnapshot({...fundingSnapshot(true),allocationCents:'2999'},true,ids.execution));
});

test('old ticket cannot pass if its validity crosses the request boundary',async()=>{
 let clock=1000000,crossed=false;const {input}=scenario();input.now=()=>clock;const original=input.transport;
 input.transport=async(target,init)=>{const response=await original(target,init);if(new URL(target).pathname.endsWith('/voucher-ticket')&&response.status===200){const read=response.json;response.json=async()=>{const value=await read();const expiresAt=new Date(clock+12000).toISOString();const u=new URL(value.downloadUrl,base);u.searchParams.set('expiresAt',expiresAt);return {...value,expiresAt,downloadUrl:u.pathname+u.search};};}else if(new URL(target).pathname.endsWith('/download')&&response.status===403){crossed=true;clock+=13000;};return response;};
 await assert.rejects(runNativeVoucherRevocation(input));assert.equal(crossed,true);
});

test('assembled fixture reads observer preimage and postimage before attaching evidence',async()=>{
 const api=require('./task16-native-voucher-revocation.cjs'),calls=[];
 const values=['00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-00000000000b','00000000-0000-4000-8000-00000000000c','00000000-0000-4000-8000-00000000000d'];
 const [key,regA,regB,source,companyA,companyB]=values;
 const fixture={plan:{ids:{actor:ids.actor,payment:ids.payment,settlement:ids.other,project:ids.project,companyA,companyB,requestKey:key},paidAt:'2026-11-06'},companyARegistrationId:regA,companyBRegistrationId:regB,companyBSourceId:source};
 let reads=0;const observer={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn({$executeRawUnsafe:async sql=>{assert.equal(sql,'SET TRANSACTION READ ONLY');calls.push('readonly');},$queryRawUnsafe:async sql=>{assert.ok(sql.includes('FundAccountSourceBatch')&&sql.includes('RegisteredFundPaymentAllocation'));assert.doesNotMatch(sql,/SELECT\s+\*/iu);assert.doesNotMatch(sql,/executedByUserId|balanceRegistrationId/u);calls.push('snapshot');return [{result:{databaseOid:'16384',readerOid:'11',pid:123,reader:'jg_task01_observer',readOnly:true,tls:true,data:fundingSnapshot(reads++>0)}}];}});}};
 const service={registeredExecutionOptions:async()=>({expectedPaymentUpdatedAt:'2026-11-05T00:00:00.000Z',remainingAmountCents:'4000',accounts:[{scopeKey:`company:${companyB}`,eligible:true,currentRegistrationId:regB}]}),recordRegisteredExecution:async()=>{calls.push('record');return {id:ids.execution};},uploadRegisteredVoucherFile:async()=>{calls.push('upload');return {id:ids.file,contentSha256:sha,sizeBytes:bytes.length};},attachRegisteredVoucher:async()=>{calls.push('attach');return {executionId:ids.execution,voucherPending:false};}};
 await api.prepareNativeVoucherForRevocation({service,fixture,password:'synthetic-password',voucherBytes:bytes,check(){},snapshot:()=>api.readVoucherFundingSnapshot({observer,fixture,known:{observerPid:123,databaseOid:'16384',observerOid:'11'},check(){}})});
 assert.deepEqual(calls,['readonly','snapshot','record','readonly','snapshot','upload','attach']);
});

test('funding snapshot rejects a foreign observer or missing read-only transaction',async()=>{
 const api=require('./task16-native-voucher-revocation.cjs');
 const fixture={plan:{ids:{actor:ids.actor,payment:ids.payment,settlement:ids.other,project:ids.project,companyA:ids.member,companyB:ids.file,requestKey:ids.execution}},companyARegistrationId:'00000000-0000-4000-8000-000000000008',companyBRegistrationId:'00000000-0000-4000-8000-000000000009',companyBSourceId:'00000000-0000-4000-8000-00000000000a'};
 const observer={$transaction:async fn=>fn({$executeRawUnsafe:async()=>{},$queryRawUnsafe:async()=>[{result:{databaseOid:'16384',readerOid:'11',pid:999,reader:'jg_task01_observer',readOnly:true,tls:true,data:fundingSnapshot()}}]})};
 await assert.rejects(api.readVoucherFundingSnapshot({observer,fixture,known:{observerPid:123,databaseOid:'16384',observerOid:'11'},check(){}}));
});

test('old ticket is not consumed without a full request budget',async()=>{
 let clock=1000000,deniedDownload=false;const {input}=scenario();input.now=()=>clock;const original=input.transport;
 input.transport=async(target,init)=>{const response=await original(target,init);if(new URL(target).pathname.endsWith('/voucher-ticket')&&response.status===200){const read=response.json;response.json=async()=>{const value=await read();const expiresAt=new Date(clock+12000).toISOString();const u=new URL(value.downloadUrl,base);u.searchParams.set('expiresAt',expiresAt);return {...value,expiresAt,downloadUrl:u.pathname+u.search};};}else if(new URL(target).pathname.endsWith('/voucher-ticket')&&response.status===403)clock+=7000;else if(new URL(target).pathname.endsWith('/download')&&response.status===403)deniedDownload=true;return response;};
 await assert.rejects(runNativeVoucherRevocation(input));assert.equal(deniedDownload,false);
});


test('diagnostic reports first fixed field and never changes the original error',async()=>{
 const seen=[];const original=Error('private detail must never appear');
 const fixture={plan:{ids:{actor:ids.actor,payment:ids.payment,companyB:ids.file,requestKey:ids.execution},paidAt:'2026-11-06'},companyBRegistrationId:ids.member,companyBSourceId:ids.other};
 const service={registeredExecutionOptions:async()=>{throw original;},recordRegisteredExecution(){},uploadRegisteredVoucherFile(){},attachRegisteredVoucher(){}};
 await assert.rejects(prepareNativeVoucherForRevocation({service,fixture,password:'synthetic-password',voucherBytes:bytes,snapshot:async()=>fundingSnapshot(),check(){},diagnose:value=>{seen.push(value);throw Error('diagnostic failure');}}),error=>error===original);
 assert.deepEqual(seen,[{stage:'PAYMENT_OPTIONS',field:'OPERATION'}]);assert.ok(!JSON.stringify(seen).includes('private'));
});

test('funding snapshot reports the first differing fixed field without values',async()=>{
 const seen=[];const fixture={plan:{ids:{actor:ids.actor,payment:ids.payment,companyB:ids.file,requestKey:ids.execution},paidAt:'2026-11-06'},companyBRegistrationId:ids.member,companyBSourceId:ids.other};
 const service={registeredExecutionOptions(){throw Error('unreachable');},recordRegisteredExecution(){},uploadRegisteredVoucherFile(){},attachRegisteredVoucher(){}};
 await assert.rejects(prepareNativeVoucherForRevocation({service,fixture,password:'synthetic-password',voucherBytes:bytes,snapshot:async()=>({...fundingSnapshot(),balanceA:'secret',balanceB:'different'}),check(){},diagnose:value=>seen.push(value)}));
 assert.deepEqual(seen,[{stage:'PAYMENT_BEFORE',field:'BALANCE_A'}]);assert.ok(!JSON.stringify(seen).includes('secret'));
});

test('revocation records first permission failure with only fixed codes',async()=>{
 const {input}=scenario({extraRoster:true,inactive:true}),seen=[];input.diagnose=value=>seen.push(value);
 await assert.rejects(runNativeVoucherRevocation(input));assert.deepEqual(seen,[{stage:'BEFORE',field:'ACCOUNT_STATE'}]);
});

test('ticket expiry after denied download is distinguished without ticket data',async()=>{
 let clock=1000000;const {input}=scenario(),seen=[];input.now=()=>clock;input.diagnose=value=>seen.push(value);const original=input.transport;
 input.transport=async(target,init)=>{const response=await original(target,init);if(new URL(target).pathname.endsWith('/voucher-ticket')&&response.status===200){const read=response.json;response.json=async()=>{const value=await read(),expiresAt=new Date(clock+12000).toISOString(),u=new URL(value.downloadUrl,base);u.searchParams.set('expiresAt',expiresAt);return {...value,expiresAt,downloadUrl:u.pathname+u.search};};}else if(new URL(target).pathname.endsWith('/download')&&response.status===403)clock+=13000;return response;};
 await assert.rejects(runNativeVoucherRevocation(input));assert.deepEqual(seen,[{stage:'OLD_TICKET',field:'TICKET_LIFETIME'}]);assert.ok(!JSON.stringify(seen).includes('token'));
});

test('download cleanup failure remains secondary to original read error',async()=>{
 const {input}=scenario(),original=Error('private read failure'),events=[];const transport=input.transport;
 input.diagnose=value=>events.push(value);input.cleanupDiagnostic=value=>{events.push(value);throw Error('receipt failure');};
 input.transport=async(target,init)=>{const response=await transport(target,init);if(new URL(target).pathname.endsWith('/download')&&response.status===200)response.body.getReader=()=>({read:async()=>{throw original;},releaseLock(){throw Error('private cleanup');}});return response;};
 await assert.rejects(runNativeVoucherRevocation(input),error=>error===original);
 assert.deepEqual(events,[{stage:'DOWNLOAD_BEFORE',field:'READER_RELEASE'},{stage:'DOWNLOAD_BEFORE',field:'OPERATION'}]);assert.ok(!JSON.stringify(events).includes('private'));
});

test('unexpected HTTP status is recorded with fixed stage only and no response data',async()=>{
 const {input}=scenario(),events=[],original=input.transport;input.httpDiagnostic=value=>events.push(value);
 input.transport=async(target,init)=>{const response=await original(target,init);if(new URL(target).pathname==='/projects')return {...response,status:404,json:async()=>{throw Error('response body must not be read');}};return response;};
 await assert.rejects(runNativeVoucherRevocation(input));assert.deepEqual(events,[{stage:'PROJECTS_BEFORE',status:404}]);
});

test('HTTP diagnostic recording failure does not replace original assertion',async()=>{
 const {input}=scenario(),original=input.transport;let recorded=0;input.httpDiagnostic=()=>{recorded++;throw Error('private recording error');};
 input.transport=async(target,init)=>{const response=await original(target,init);return new URL(target).pathname==='/projects'?{...response,status:403}:response;};
 await assert.rejects(runNativeVoucherRevocation(input),error=>error.code==='NATIVE_VOUCHER_REVOCATION_FAILED_CLOSED');assert.equal(recorded,1);
});

test('out of range status is never recorded',async()=>{
 const {input}=scenario(),events=[],original=input.transport;input.httpDiagnostic=value=>events.push(value);
 input.transport=async(target,init)=>{const response=await original(target,init);return new URL(target).pathname==='/projects'?{...response,status:999}:response;};
 await assert.rejects(runNativeVoucherRevocation(input));assert.deepEqual(events,[]);
});

test('records each completed request as a fixed stage and status without ticket or response data',async()=>{
 const {input}=scenario(),observed=[];input.httpObservation=value=>observed.push(value);
 await runNativeVoucherRevocation(input);
 assert.deepEqual(observed,[{stage:'PROJECTS_BEFORE',status:200},{stage:'CAPABILITY_BEFORE',status:200},{stage:'TICKET_ISSUE',status:200},{stage:'DOWNLOAD_BEFORE',status:200},{stage:'PROJECTS_AFTER',status:200},{stage:'CAPABILITY_AFTER',status:403},{stage:'TICKET_AFTER',status:403},{stage:'OLD_TICKET',status:403}]);
 assert.doesNotMatch(JSON.stringify(observed),/token|127\.0\.0\.1|00000000/);
});


test('disabled account cannot use an unexpired old ticket or reach storage while membership and facts remain',async()=>{
 const {input,requests}=scenario({disabledMode:true});const result=await runNativeVoucherDisabled(input);
 assert.deepEqual(result,{authorizedBefore:true,accountDisabled:true,membershipUnchanged:true,oldTicketDenied:true,storageUnread:true,observedFactsUnchanged:true});
 assert.equal(requests.filter(([path])=>path.endsWith('/download')).length,2);
});
test('disabled-account proof rejects a still-valid download, storage read, or financial drift',async()=>{
 for(const options of [{retainsTicket:true},{readOnDenied:true},{drift:true}])await assert.rejects(runNativeVoucherDisabled(scenario({disabledMode:true,...options}).input));
});

test('disable SQL mutates exactly the supplied active actor and preserves membership',()=>{
 const api=require('./task16-native-voucher-revocation.cjs'),sql=api.voucherDisableAccountSql(ids);
 assert.match(sql,/UPDATE public\."User" SET "isActive"=false/u);assert.ok(sql.includes(`WHERE id='${ids.actor}' AND "isActive"=true`));
 assert.doesNotMatch(sql,/DELETE\s+FROM|UPDATE\s+public\."ProjectMember"/iu);assert.throws(()=>api.voucherDisableAccountSql({...ids,actor:"bad"}));
});
