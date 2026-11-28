'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHash}=require('node:crypto');
const {createCurrent259FirstQ2CosRead}=require('./task12-current259-q2-cos.cjs');

const bytes=Buffer.from('%PDF-1.4\nQ2 isolated\n');
const contentSha256=createHash('sha256').update(bytes).digest('hex');
const fileId='12345678-1234-4234-8234-123456789012';
const objectId='12345678-1234-4234-8234-123456789013';
const fileName='首条对上原件.pdf';
const bucket='q2-test-1234567890',region='ap-guangzhou';
const objectKey='uploads/idempotent/'+fileId+'/'+objectId+'-'+contentSha256+'-'+fileName;
const upload=Object.freeze({fileId,bucket,objectKey,mimeType:'application/pdf',sizeBytes:bytes.length,contentSha256});
const generation='current/plus+?#';
const response=(version=generation)=>({status:200,rawHeaders:['X-Cos-Version-Id',version,'Content-Length',String(bytes.length),
  'Content-Encoding','identity','X-Cos-Request-Id','model-request-id'],body:bytes});

test('one current GET and one fixed generation GET bind one original and produce independent COS evidence only',()=>{
  const read=createCurrent259FirstQ2CosRead(bucket,region,upload);
  assert.throws(()=>read.next(),/STATE/u); // fixed stage must be named, never inferred from callers
  const first=read.next('current');
  assert.equal(first.host,bucket+'.cos.'+region+'.myqcloud.com');
  assert.equal(first.port,443);
  assert.equal(first.path,'/'+objectKey.split('/').map(encodeURIComponent).join('/'));
  assert.equal(first.objectKey,objectKey);
  assert.equal(first.method,'GET');
  const observed=read.accept('current',response());
  assert.deepEqual(observed,{bucket,objectKey,mimeType:'application/pdf',
    sizeBytes:bytes.length,contentSha256,objectGeneration:generation});
  assert.throws(()=>read.next('current'),/STATE/u);
  const fixed=read.next('fixed');
  assert.equal(fixed.path,first.path+'?versionId='+encodeURIComponent(generation));
  assert.deepEqual(read.accept('fixed',response()),{bucket,objectKey,mimeType:'application/pdf',
    sizeBytes:bytes.length,contentSha256,objectGeneration:generation});
  assert.throws(()=>read.next('fixed'),/STATE/u);
});

test('unrecognized coordinates, non-versioned responses, extra headers and changed content stop without a fixed GET',()=>{
  for(const patch of [{bucket:'other-1234567890'},{fileId:objectId},{mimeType:'image/png'},{objectKey:objectKey+'/extra'}])
    assert.throws(()=>createCurrent259FirstQ2CosRead(bucket,region,{...upload,...patch}),/INPUT/u);
  assert.throws(()=>createCurrent259FirstQ2CosRead(bucket,'ap-x/evil',upload),/INPUT/u);
  for(const change of [
    {status:302},{status:206},{body:Buffer.from('different')},{rawHeaders:['X-Cos-Version-Id','null','X-Cos-Request-Id','id']},
    {rawHeaders:[...response().rawHeaders,'x-cos-version-id',generation]},
    {rawHeaders:[...response().rawHeaders,'Content-Range','bytes 0-8/9']},
    {rawHeaders:[...response().rawHeaders,'Location','https://unrelated.invalid/']},
  ]){
    const read=createCurrent259FirstQ2CosRead(bucket,region,upload);
    read.next('current');
    assert.throws(()=>read.accept('current',{...response(),...change}),/RESPONSE/u);
    assert.throws(()=>read.next('fixed'),/STATE/u);
  }
  const read=createCurrent259FirstQ2CosRead(bucket,region,upload);
  read.next('current');read.accept('current',response());read.next('fixed');
  assert.throws(()=>read.accept('fixed',response('other-generation')),/RESPONSE/u);
  assert.throws(()=>read.accept('fixed',response()),/STATE/u);
});
