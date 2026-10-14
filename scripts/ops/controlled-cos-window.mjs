import {parseCosXml,children,singleText} from './restricted-cos-xml.mjs';
import {createHash} from 'node:crypto';
import {authorization,requestUrl} from './private-object-backup.mjs';
import {BUSINESS_BUCKET,prepareCosHold} from './controlled-cos-hold-policy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const samePolicy=(a,b)=>JSON.stringify(canonical(JSON.parse(a)))===JSON.stringify(canonical(JSON.parse(b)));
const controls=['policy','acl','lifecycle','replication','versioning','uploads'];
export function cosTransport(config,fetchImpl=fetch){
 config=structuredClone(config);
 if(config.COS_BUCKET!==BUSINESS_BUCKET||config.COS_REGION!=='ap-chengdu'||!config.COS_SECRET_ID||!config.COS_SECRET_KEY)throw Error('fixed business bucket configuration required');
 const endpoint=`https://${BUSINESS_BUCKET}.cos.ap-chengdu.myqcloud.com`,host=new URL(endpoint).host;
 let calls=0;const start=Date.now();
 return async(method,query,body)=>{
  if(!['GET','PUT'].includes(method)||Object.keys(query).length!==1||!controls.includes(Object.keys(query)[0])||method==='PUT'&&!Object.hasOwn(query,'policy')||++calls>20||Date.now()-start>=180000)throw Error('COS stage scope/time limit');
  const response=await fetchImpl(requestUrl(endpoint,'/',query),{method,redirect:'error',headers:{Host:host,Authorization:authorization(method,'/',host,query,config.COS_SECRET_ID,config.COS_SECRET_KEY)},body,signal:AbortSignal.timeout(Math.min(10000,180000-(Date.now()-start)))});
  let size=0;const chunks=[];for await(const chunk of response.body??[]){size+=chunk.length;if(size>262144)throw Error('COS metadata response limit');chunks.push(Buffer.from(chunk));}
  // Unknown 404/error is not turned into an empty successful configuration.
  if(!response.ok)throw Error('COS control request stopped');
  return Buffer.concat(chunks);
 };
}
export async function inspectCosControls(request){
 const result={};for(const key of controls)result[key]=(await request('GET',{[key]:undefined})).toString('utf8');
 const acl=parseCosXml(result.acl,'AccessControlPolicy'),owners=children(acl,'Owner');
 if(owners.length!==1||!['100049377606','qcs::cam::uin/100049377606:uin/100049377606'].includes(singleText(owners[0],'ID')))throw Error('bucket owner identity unverified');
 JSON.parse(result.policy);
 const uploads=parseCosXml(result.uploads,'ListMultipartUploadsResult');
 if(children(uploads,'Upload').length||singleText(uploads,'IsTruncated')!=='false')throw Error('multipart uploads incomplete or not drained');
 parseCosXml(result.versioning,'VersioningConfiguration');
 for(const name of ['lifecycle','replication']){
  const parsed=parseCosXml(result[name],name==='lifecycle'?'LifecycleConfiguration':'ReplicationConfiguration');
  for(const rule of children(parsed,'Rule'))if(singleText(rule,'Status')!=='Disabled')throw Error('internal COS writer requires separately approved pause');
 }
 return result;
}
export async function installCosHold({request,before,runId}){
 before=structuredClone(before);
 const current=await inspectCosControls(request);
 if(controls.some(k=>current[k]!==before[k]))throw Error('COS original controls changed');
 const packet=prepareCosHold(Buffer.from(before.policy),runId,'known-and-anonymous');
 await request('PUT',{policy:undefined},packet.afterBytes);
 // An uncertain PUT is never retried. An after-read failure leaves the possible hold for inspection.
 const observed=await inspectCosControls(request);
 if(!samePolicy(observed.policy,packet.afterBytes)||controls.filter(k=>k!=='policy').some(k=>observed[k]!==before[k]))throw Error('COS hold installation unverified; retain original and possible hold');
 return {runId,before,after:observed,afterPolicySha256:hash(observed.policy),writerCoverageVerified:false,requiresActualDenyAndReadChecks:true};
}
export async function observeCosHold({request,journal}){
 journal=structuredClone(journal);
 const observed=await inspectCosControls(request);
 if(controls.some(k=>observed[k]!==journal.after[k]))throw Error('COS continuous hold drift');
 return {status:'control-snapshot-unchanged',actualWriterDenialVerified:false};
}
export async function withdrawCosHold({request,journal}){
 journal=structuredClone(journal);
 await observeCosHold({request,journal});
 await request('PUT',{policy:undefined},Buffer.from(journal.before.policy));
 const restored=await inspectCosControls(request);
 if(!samePolicy(restored.policy,journal.before.policy)||controls.filter(k=>k!=='policy').some(k=>restored[k]!==journal.before[k]))throw Error('COS policy restoration unverified; no retry');
 return {status:'original-policy-restored',businessUnfrozen:false};
}

// request is the stage-approved fixed-bucket object adapter. The probe prefix
// and sample key/hash must be listed in the production approval, never inferred.
export async function verifyKnownWriterDenial({request,runId,actorUin,sampleKey,sampleSha256}){
 if(!/^[a-z0-9-]{1,60}$/.test(runId)||!['100050465776','100050728192'].includes(actorUin)||!/^[a-f0-9]{64}$/.test(sampleSha256)||!sampleKey||sampleKey.split('/').some(x=>x==='.'||x==='..'))throw Error('exact known writer and approved read sample required');
 const key=`controlled-launch-probes/${runId}/writer-${actorUin}.txt`,body=Buffer.from(`controlled-first-launch ${runId} ${actorUin}\n`);
 const sample=await request('GET',sampleKey);
 if(sample.status!==200||hash(Buffer.from(await sample.arrayBuffer()))!==sampleSha256)throw Error('writer authenticated read proof failed');
 const absent=await request('HEAD',key);
 if(absent.status!==404)throw Error('probe key absence unverified');
 const put=await request('PUT',key,body);
 if(put.status===403){const error=parseCosXml(await put.text(),'Error');if(singleText(error,'Code')!=='AccessDenied')throw Error('403 did not prove write permission denial');return {actorUin,probeKey:key,authenticatedReadVerified:true,writeDenied:true,objectCreated:false};}
 if(put.status!==200)throw Error('probe write outcome uncertain; preserve exact probe key, no retry');
 // Unexpected success exits through a single, approved owned-probe cleanup.
 const version=put.headers.get('x-cos-version-id');
 if(!version||version==='null'||!/^[A-Za-z0-9_.-]{1,1024}$/.test(version))throw Error('created probe version unverified; retain key, do not delete');
 const owned=await request('GET',key,undefined,version);
 if(owned.status!==200||owned.headers.get('x-cos-version-id')!==version||hash(Buffer.from(await owned.arrayBuffer()))!==hash(body))throw Error('unexpected write probe ownership unverified; do not delete');
 const removed=await request('DELETE',key,undefined,version);
 if(![200,204].includes(removed.status))throw Error('owned probe cleanup unconfirmed; preserve exact key/version');
 throw Error('write fence failed; owned probe removed, stop maintenance release');
}
