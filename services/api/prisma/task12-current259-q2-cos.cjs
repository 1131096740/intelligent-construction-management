'use strict';
const {createHash}=require('node:crypto');
const {types}=require('node:util');

const uuid='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uploadKey=new RegExp('^uploads/idempotent/('+uuid+')/'+uuid+'-([a-f0-9]{64})-首条(对上|表外)原件\\.pdf$','u');
const bucketName=/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?-[0-9]{5,20}$/u;
const regionName=/^[a-z]{2}(?:-[a-z0-9]+)+$/u;
const interesting=new Set(['content-length','content-encoding','content-range','location','x-cos-version-id','x-cos-request-id']);
const encodePart=value=>encodeURIComponent(value).replace(/[!'()*]/gu,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const visible=(value,limit)=>typeof value==='string' && value.length<=limit && /^[!-~]+$/u.test(value);
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');

function need(ok,phase) {
  if(!ok)throw new Error('CURRENT259_FIRST_Q2_COS_'+phase);
}
function readOwn(input,keys,phase) {
  need(input && !types.isProxy(input) && Object.getPrototypeOf(input)===Object.prototype,phase);
  const data=Object.getOwnPropertyDescriptors(input);
  need(Reflect.ownKeys(data).length===keys.length && keys.every(key=>data[key] && Object.hasOwn(data[key],'value')),phase);
  return Object.fromEntries(keys.map(key=>[key,data[key].value]));
}
function selectHeaders(raw) {
  need(Array.isArray(raw) && !types.isProxy(raw) && raw.length<=128 && raw.length%2===0,'RESPONSE');
  const selected=new Map();
  for(let index=0;index<raw.length;index+=2){
    const name=Object.getOwnPropertyDescriptor(raw,index)?.value;
    const value=Object.getOwnPropertyDescriptor(raw,index+1)?.value;
    need(typeof name==='string' && typeof value==='string','RESPONSE');
    const key=name.toLowerCase();
    if(interesting.has(key)){
      need(!selected.has(key),'RESPONSE');
      selected.set(key,value);
    }
  }
  return selected;
}

// Pure protocol for an independently approved read-only COS observer. It has
// no credential, signer, transport or permission to report bucket versioning.
function createCurrent259FirstQ2CosRead(bucket,region,observedUpload,outside) {
  const relationship=arguments.length===3?'对上':outside===true?'表外':outside===false?'对上':undefined;
  need((arguments.length===3||arguments.length===4) && relationship!==undefined && typeof bucket==='string' && bucket.length<=63 && bucketName.test(bucket) &&
    typeof region==='string' && region.length<=63 && regionName.test(region),'INPUT');
  const {fileId,bucket:uploadBucket,objectKey,mimeType,sizeBytes,contentSha256}=readOwn(observedUpload,
    ['fileId','bucket','objectKey','mimeType','sizeBytes','contentSha256'],'INPUT');
  const key=typeof objectKey==='string' && objectKey.length<256 && uploadKey.exec(objectKey);
  need(key && fileId===key[1] && contentSha256===key[2] && key[3]===relationship && bucket===uploadBucket && mimeType==='application/pdf' &&
    Number.isInteger(sizeBytes) && sizeBytes>=1 && sizeBytes<=16_384,'INPUT');
  const host=bucket+'.cos.'+region+'.myqcloud.com';
  const uri='/'+objectKey.split('/').map(encodePart).join('/');
  let state='current',objectGeneration;
  return Object.freeze({
    next(stage){
      need(arguments.length===1 && ['current','fixed'].includes(stage) && state===stage,'STATE');
      state=stage+'-issued';
      const versionId=stage==='fixed'?objectGeneration:null;
      const query=versionId===null?'':'?versionId='+encodePart(versionId);
      return Object.freeze({host,port:443,path:uri+query,objectKey,versionId,method:'GET'});
    },
    accept(stage,reply){
      need(arguments.length===2 && ['current','fixed'].includes(stage) && state===stage+'-issued','STATE');
      state='closed';
      const {status,rawHeaders,body}=readOwn(reply,['status','rawHeaders','body'],'RESPONSE');
      const headers=selectHeaders(rawHeaders),version=headers.get('x-cos-version-id');
      const length=headers.get('content-length'),encoding=headers.get('content-encoding');
      need(status===200 && !headers.has('location') && !headers.has('content-range') &&
        (length===undefined || length===String(sizeBytes)) && (encoding===undefined || encoding.toLowerCase()==='identity') &&
        visible(version,1024) && version.toLowerCase()!=='null' && !version.includes(',') &&
        visible(headers.get('x-cos-request-id'),160) && Buffer.isBuffer(body) && !types.isProxy(body) &&
        body.length===sizeBytes && digest(body)===contentSha256,'RESPONSE');
      if(stage==='fixed')need(version===objectGeneration,'RESPONSE');
      else {objectGeneration=version;state='fixed';}
      return Object.freeze({bucket,objectKey,mimeType,sizeBytes,contentSha256,objectGeneration});
    },
  });
}
module.exports=Object.freeze({createCurrent259FirstQ2CosRead});
