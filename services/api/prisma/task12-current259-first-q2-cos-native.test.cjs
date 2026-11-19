'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createHash}=require('node:crypto');
const fixtureFile=path.join(__dirname,'task12-current259-first-q2-cos-native.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=Buffer.from('fixed synthetic canary');
const prefix='uploads/idempotent/12345678-1234-4234-8234-123456789012/';
const bucket='jg-q2-isolated-1234567890',region='ap-guangzhou';
const plan={bucket,region,prefix,expiresAt:'2099-12-31T00:00:00.000Z',canary:{key:prefix+'q2-private-canary.bin',sha256:sha(bytes),sizeBytes:bytes.length}};
const acl='<AccessControlPolicy><Owner><ID>owner-123</ID></Owner><AccessControlList><Grant><Grantee><ID>owner-123</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
const version='<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>';
const policy='<Error><Code>NoSuchBucketPolicy</Code></Error>';
const denied='<Error><Code>AccessDenied</Code></Error>';
// Header names and values observed on the signed fixed Chengdu COS policy read.
// The request id in this model is synthetic.
const emptyPolicyHeaders=['Content-Length','0','Content-Type','application/xml','Server','tencent-cos'];
const original=Buffer.from('%PDF-1.4\nfixed original\n');
const objectId='12345678-1234-4234-8234-123456789013';
const generation='archive/v1+?=';
const originalNames=['首条对上原件.pdf','首条表外原件.pdf'];
const profiles=[
  {casePrefix:prefix,outside:false},
  {casePrefix:'uploads/idempotent/22345678-1234-4234-8234-123456789012/',outside:true},
  {casePrefix:'uploads/idempotent/32345678-1234-4234-8234-123456789012/',outside:true},
];
function upload(casePrefix,name){
  const contentSha256=sha(original);
  return {fileId:casePrefix.split('/')[2],bucket,objectKey:casePrefix+objectId+'-'+contentSha256+'-'+name,
    mimeType:'application/pdf',sizeBytes:original.length,contentSha256};
}
function model(change,{casePrefix=prefix,outside=false}={}){
  const controller=new AbortController(),calls=[],permit=Object.freeze({});
  const casePlan={...plan,prefix:casePrefix,canary:{...plan.canary,key:casePrefix+'q2-private-canary.bin'}};
  const objectReply=[200,original,['X-Cos-Version-Id',generation]];
  const replies=[[200,version],[200,acl],[404,policy],[200,bytes],[403,denied],objectReply,objectReply];
  let claimed=false;
  const ports={
    '@xmldom/xmldom':{get DOMParser(){assert.fail('external XML module would enter the sealed app cache');}},
    './task12-current259-first-q2-once.cjs':{claimCurrent259FirstQ2CosPermit(value){
      assert.equal(value,permit);assert.equal(claimed,false);claimed=true;
      return {plan:casePlan,outside,signal:controller.signal,check(){assert.equal(controller.signal.aborted,false);},
        application:{secretId:'TMP-APP',secretKey:'app-key',sessionToken:'app-token'},
        observer:{secretId:'TMP-OBS',secretKey:'obs-key',sessionToken:'obs-token'}};
    }},
    'node:https':{request(options,callback){
      const i=calls.length;
      calls.push(options);
      const outgoing=new EventEmitter();
      outgoing.destroy=()=>{};
      outgoing.end=()=>queueMicrotask(()=>{
        const incoming=new EventEmitter();
        const [statusCode,body,extra=[],socket={encrypted:true,authorized:true}]=change?.(i,replies[i])??replies[i];
        Object.assign(incoming,{statusCode,socket,complete:true,
          rawHeaders:['X-Cos-Request-Id','model-'+i,...(i===3?['X-Cos-Version-Id','canary-v1']:[]),...extra],destroy(){}});
        callback(incoming);
        incoming.emit('data',Buffer.from(body));incoming.emit('end');
      });
      return outgoing;
    }}
  };
  const holder={exports:{}},rq=name=>ports[name]??require(name);
  new Function('require','module',fs.readFileSync(fixtureFile,'utf8'))(rq,holder);
  return {open:()=>holder.exports.openCurrent259FirstQ2Cos(permit),calls};
}
test('fixed independent HTTPS proves Enabled, owner-only ACL, absent bucket policy and signed/anonymous private canary',async()=>{
  const f=model(),result=await f.open();
  assert.deepEqual(f.calls.map(call=>call.path),['/?versioning=','/?acl=','/?policy=','/'+plan.canary.key,'/'+plan.canary.key]);
  for(const call of f.calls){
    assert.equal(call.hostname,bucket+'.cos.'+region+'.myqcloud.com');
    assert.equal(call.servername,call.hostname);assert.equal(call.port,443);assert.equal(call.rejectUnauthorized,true);
    assert.equal(call.method,'GET');assert.equal(call.agent,false);
  }
  assert.ok(f.calls.slice(0,4).every(call=>call.headers['x-cos-security-token']==='obs-token'));
  assert.equal(f.calls[4].headers.Authorization,undefined);
  assert.equal(result.environment().COS_SESSION_TOKEN,'app-token');
  assert.equal(result.versioning,'Enabled');
  result.close();
  assert.throws(()=>result.environment(),/CLOSED/u);
});
test('wrong version, ACL, policy, canary contents or ambiguous anonymous response stops at the first observation',async()=>{
  for(const [at,reply] of [[0,[200,version.replace('Enabled','Suspended')]],
    [0,[200,version.replace('</VersioningConfiguration>','<Status>Enabled</Status></VersioningConfiguration>')]],
    [0,[200,'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///never-read">]>'+version]],
    [0,[200,version.replace('</Status>','</Other>')]],
    [1,[200,acl.replace('<ID>owner-123</ID></Grantee>','<ID>another</ID></Grantee>')]],
    [2,[200,'{"statement":[]}']],[3,[200,'other bytes']],[4,[404,denied]]]){
    const f=model((i,value)=>i===at?reply:value);
    await assert.rejects(f.open(),/CURRENT259_FIRST_Q2_COS_NATIVE_/u);
    assert.equal(f.calls.length,at+1);
  }
});


test('the fixed signed TLS policy read accepts the observed empty Tencent 404 and continues through both canary checks',async()=>{
  const f=model((i,reply)=>i===2?[404,'',emptyPolicyHeaders]:reply);
  const result=await f.open();
  assert.deepEqual(f.calls.map(call=>call.path),['/?versioning=','/?acl=','/?policy=','/'+plan.canary.key,'/'+plan.canary.key]);
  assert.equal(f.calls[2].headers['x-cos-security-token'],'obs-token');
  assert.equal(f.calls[2].servername,bucket+'.cos.'+region+'.myqcloud.com');
  assert.equal(f.calls[2].rejectUnauthorized,true);
  result.close();
  assert.ok(f.calls.every(call=>call.signal.aborted));
  assert.throws(()=>result.environment(),/CLOSED/u);
});

test('unproven empty policy replies and the same response at another route stop and close',async()=>{
  const bad=[
    [2,[200,'',emptyPolicyHeaders]], [2,[403,'',emptyPolicyHeaders]], [2,[404,denied]],
    [2,[404,'',[]]], [2,[404,'',emptyPolicyHeaders.slice(2)]],
    [2,[404,'',['Content-Length','0','Content-Type','application/xml','Server','other']]],
    [2,[404,'',['Content-Length','0','Content-Type','text/plain','Server','tencent-cos']]],
    [2,[404,'',[...emptyPolicyHeaders,'X-Cos-Error-Code','AccessDenied']]],
    [2,[404,'',[...emptyPolicyHeaders,'server','tencent-cos']]],
    [2,[404,'',[...emptyPolicyHeaders,'x-cos-request-id','duplicate']]],
    [2,[404,'',emptyPolicyHeaders,{encrypted:true,authorized:false}]],
    [0,[404,'',emptyPolicyHeaders]], [1,[404,'',emptyPolicyHeaders]],
  ];
  for(const [at,badReply] of bad){
    const f=model((i,reply)=>i===at?badReply:reply);
    await assert.rejects(f.open(),/CURRENT259_FIRST_Q2_COS_NATIVE_/u);
    assert.equal(f.calls.length,at+1);
    assert.ok(f.calls.every(call=>call.signal.aborted));
  }
});

test('upward and both outside profiles each read their exact current and fixed original over the real COS helper',async()=>{
  for(const profile of profiles){
    const f=model(undefined,profile),cos=await f.open();
    const originalUpload=upload(profile.casePrefix,originalNames[Number(profile.outside)]);
    const observed=await cos.read('current',originalUpload);
    const fixed=await cos.read('fixed');
    assert.deepEqual(fixed,observed);
    assert.equal(fixed.objectKey,originalUpload.objectKey);
    assert.equal(fixed.objectGeneration,generation);
    assert.equal(fixed.contentSha256,originalUpload.contentSha256);
    const encoded='/'+originalUpload.objectKey.split('/').map(encodeURIComponent).join('/');
    assert.deepEqual(f.calls.slice(5).map(call=>call.path),[encoded,encoded+'?versionId=archive%2Fv1%2B%3F%3D']);
    assert.ok(f.calls.slice(5).every(call=>call.headers['x-cos-security-token']==='obs-token'));
    cos.close();
  }
});

test('crossed original names or outside case prefixes are rejected before any object GET',async()=>{
  const violations=[
    [profiles[0],upload(profiles[0].casePrefix,originalNames[1])],
    [profiles[1],upload(profiles[1].casePrefix,originalNames[0])],
    [profiles[2],upload(profiles[2].casePrefix,originalNames[0])],
    [profiles[2],upload(profiles[1].casePrefix,originalNames[1])],
    [profiles[1],upload(profiles[2].casePrefix,originalNames[1])],
  ];
  for(const [profile,wrongUpload] of violations){
    const f=model(undefined,profile),cos=await f.open();
    await assert.rejects(cos.read('current',wrongUpload),/CURRENT259_FIRST_Q2_COS_(?:NATIVE_SCOPE|INPUT)/u);
    assert.equal(f.calls.length,5);
    assert.ok(f.calls.every(call=>call.signal.aborted));
  }
});
