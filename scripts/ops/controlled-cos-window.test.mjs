import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCosControls,installCosHold,observeCosHold,withdrawCosHold,cosTransport,verifyKnownWriterDenial} from './controlled-cos-window.mjs';
const initial=()=>({policy:'{"version":"2.0","Statement":[]}',acl:'<AccessControlPolicy><Owner><ID>100049377606</ID></Owner></AccessControlPolicy>',lifecycle:'<LifecycleConfiguration></LifecycleConfiguration>',replication:'<ReplicationConfiguration></ReplicationConfiguration>',versioning:'<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',uploads:'<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>'});
test('exact policy install, continuous observe and withdrawal preserve other controls and do not claim actual denial',async()=>{
 const live=initial(),writes=[];
 const request=async(method,q,b)=>{const key=Object.keys(q)[0];if(method==='PUT'){writes.push(key);live[key]=b.toString();return Buffer.alloc(0);}return Buffer.from(live[key]);};
 const before=await inspectCosControls(request),journal=await installCosHold({request,before,runId:'fixture'});
 assert.equal(journal.writerCoverageVerified,false);await observeCosHold({request,journal});
 live.acl+=' ';await assert.rejects(withdrawCosHold({request,journal}),/drift/);assert.equal(writes.length,1);live.acl=before.acl;
 await withdrawCosHold({request,journal});assert.deepEqual(live,before);assert.deepEqual(writes,['policy','policy']);
});
test('active internal writer, multipart ambiguity, wrong owner and error responses are not an empty successful state',async()=>{
 for(const change of [{lifecycle:'<LifecycleConfiguration><Rule><Status>Enabled</Status></Rule></LifecycleConfiguration>'},{uploads:'<ListMultipartUploadsResult><IsTruncated>true</IsTruncated></ListMultipartUploadsResult>'},{acl:'<Owner><ID>other</ID></Owner>'}]){
  const v={...initial(),...change};await assert.rejects(inspectCosControls(async(m,q)=>Buffer.from(v[Object.keys(q)[0]])));
 }
 const calls=[],transport=cosTransport({COS_BUCKET:'jiangkong-prod-files-1438687719',COS_REGION:'ap-chengdu',COS_SECRET_ID:'fixture-id',COS_SECRET_KEY:'fixture-key'},async(url,options)=>{calls.push([url,options]);return new Response('not empty',{status:404});});
 await assert.rejects(transport('GET',{lifecycle:undefined}),/stopped/);assert.equal(calls.length,1);
 await assert.rejects(transport('DELETE',{policy:undefined}),/scope/);assert.equal(calls.length,1);
});

test('attributed/namespaced children and nested disabled status never hide an active writer or upload',async()=>{
 const changes=[{lifecycle:'<LifecycleConfiguration><Rule xmlns="http://fixture"><Status>Enabled</Status></Rule></LifecycleConfiguration>'},{lifecycle:'<LifecycleConfiguration><Rule><Status>Enabled</Status><Nested><Status>Disabled</Status></Nested></Rule></LifecycleConfiguration>'},{uploads:'<ListMultipartUploadsResult><Upload extra="x"/><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>'},{uploads:'<ListMultipartUploadsResult><cos:Upload/><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>'}];
 for(const change of changes){const v={...initial(),...change};await assert.rejects(inspectCosControls(async(m,q)=>Buffer.from(v[Object.keys(q)[0]])));}
});

test('asynchronous policy installation pins the original snapshot before awaiting requests',async()=>{
 const live=initial(),before={...live};let first=true;
 const request=async(method,q,b)=>{if(first){first=false;before.policy='{"version":"2.0","Statement":[{"Sid":"unapproved"}]}';}const key=Object.keys(q)[0];if(method==='PUT'){live[key]=b.toString();return Buffer.alloc(0);}return Buffer.from(live[key]);};
 const journal=await installCosHold({request,before,runId:'fixture'});
 assert.equal(journal.before.policy,initial().policy);await withdrawCosHold({request,journal});assert.equal(live.policy,initial().policy);
});

test('actual HTTP-shaped denial needs authenticated read and AccessDenied; unexpected success deletes only the verified probe version',async()=>{
 const {createHash}=await import('node:crypto');const sample=Buffer.from('fixture-read');const p={runId:'fixture',actorUin:'100050465776',sampleKey:'uploads/fixture',sampleSha256:createHash('sha256').update(sample).digest('hex')};
 const denied=await verifyKnownWriterDenial({...p,request:async(method,key)=>method==='GET'?new Response(sample):method==='HEAD'?new Response(null,{status:404}):new Response('<Error><Code>AccessDenied</Code></Error>',{status:403})});
 assert.equal(denied.writeDenied,true);assert.equal(denied.objectCreated,false);
 await assert.rejects(verifyKnownWriterDenial({...p,request:async(method)=>method==='GET'?new Response(sample):method==='HEAD'?new Response(null,{status:404}):new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>',{status:403})}),/did not prove/);
 let written;const deletes=[];
 await assert.rejects(verifyKnownWriterDenial({...p,request:async(method,key,body,version)=>{if(key===p.sampleKey)return new Response(sample);if(method==='HEAD')return new Response(null,{status:404});if(method==='PUT'){written=body;return new Response(null,{status:200,headers:{'x-cos-version-id':'new-version'}});}if(method==='GET')return new Response(written,{headers:{'x-cos-version-id':'new-version'}});deletes.push({key,version});return new Response(null,{status:204});}}),/owned probe removed/);
 assert.deepEqual(deletes,[{key:'controlled-launch-probes/fixture/writer-100050465776.txt',version:'new-version'}]);
});

test('a successful write without an exact new version never deletes or claims probe removal',async()=>{
 const {createHash}=await import('node:crypto'),sample=Buffer.from('fixture');let deletes=0;
 await assert.rejects(verifyKnownWriterDenial({runId:'fixture',actorUin:'100050465776',sampleKey:'sample',sampleSha256:createHash('sha256').update(sample).digest('hex'),request:async method=>{if(method==='GET')return new Response(sample);if(method==='HEAD')return new Response(null,{status:404});if(method==='DELETE')deletes++;return new Response(null,{status:200});}}),/version unverified/);
 assert.equal(deletes,0);
});
