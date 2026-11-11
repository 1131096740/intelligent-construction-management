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
function model(change){
  const controller=new AbortController(),calls=[],permit=Object.freeze({});
  const replies=[[200,version],[200,acl],[404,policy],[200,bytes],[403,denied]];
  let claimed=false;
  const ports={
    '@xmldom/xmldom':{get DOMParser(){assert.fail('external XML module would enter the sealed app cache');}},
    './task12-current259-first-q2-once.cjs':{claimCurrent259FirstQ2CosPermit(value){
      assert.equal(value,permit);assert.equal(claimed,false);claimed=true;
      return {plan,signal:controller.signal,check(){assert.equal(controller.signal.aborted,false);},
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
