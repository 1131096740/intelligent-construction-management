'use strict';
const {request}=require('node:https');
const {createHash,createHmac}=require('node:crypto');
const {claimCurrent259FirstQ2CosPermit}=require('./task12-current259-first-q2-once.cjs');
const {createCurrent259FirstQ2CosRead}=require('./task12-current259-q2-cos.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hmac=(key,input)=>createHmac('sha1',key).update(input).digest('hex');
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/gu,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
const fail=phase=>Object.assign(new Error('CURRENT259_FIRST_Q2_COS_NATIVE_'+phase),{code:'CURRENT259_FIRST_Q2_COS_NATIVE_'+phase});
const need=(ok,phase)=>{if(!ok)throw fail(phase);};
const bound=16384;
const critical=new Set(['location','content-encoding','content-range','content-length','x-cos-request-id','x-cos-version-id']);
function headers(raw,extra){
  need(Array.isArray(raw)&&raw.length%2===0&&raw.length<=128,'RESPONSE');
  const selected=new Map();
  for(let i=0;i<raw.length;i+=2){
    const key=raw[i].toLowerCase();
    if(critical.has(key)||extra?.includes(key)){
      need(!selected.has(key),'RESPONSE');
      selected.set(key,raw[i+1]);
    }
  }
  return selected;
}
function auth(host,key,query,observer,expiresAt){
  const now=Math.floor(Date.now()/1000),end=Math.min(now+60,Math.floor(Date.parse(expiresAt)/1000));
  need(end>now,'TIME');
  const time=now+';'+end;
  const canonical=query?query.name.toLowerCase()+'='+query.encoded:'';
  const http=['get',key,canonical,'host='+encodeURIComponent(host),''].join('\n');
  const sign=['sha1',time,createHash('sha1').update(http).digest('hex'),''].join('\n');
  return ['q-sign-algorithm=sha1','q-ak='+observer.secretId,'q-sign-time='+time,'q-key-time='+time,
    'q-header-list=host','q-url-param-list='+(query?.name.toLowerCase()??''),'q-signature='+hmac(hmac(observer.secretKey,time),sign)].join('&');
}
// Accept only the short element/text replies used by the fixed COS controls.
function xml(body,tag){
  const source=new TextDecoder('utf-8',{fatal:true}).decode(body).trim()
    .replace(/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>/iu,'').trim();
  need(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(source),'XML');
  const token=/<\/(\w[\w-]*)\s*>|<(\w[\w-]*)((?:\s+[A-Za-z][\w:-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>|([^<>]+)/uy;
  const stack=[];
  let root,count=0;
  while(token.lastIndex<source.length){
    const part=token.exec(source);
    need(part,'XML');
    const [,close,open,,empty,text]=part;
    if(close){
      need(stack.length>0&&stack.at(-1).name===close,'XML');
      stack.pop();
    }else if(open){
      need(++count<=128&&stack.length<16&&(stack.length>0||!root),'XML');
      const node={name:open,children:[],text:''};
      if(stack.length)stack.at(-1).children.push(node);else root=node;
      if(!empty)stack.push(node);
    }else if(stack.length)stack.at(-1).text+=text;
    else need(text.trim()==='','XML');
  }
  need(root?.name===tag&&stack.length===0,'XML');
  return root;
}
const elements=node=>node.children;
function one(node,tag){
  const values=elements(node).filter(child=>child.name===tag);
  need(values.length===1,'XML');
  return values[0];
}
function value(node,tag){
  const field=one(node,tag);
  need(elements(field).length===0,'XML');
  return field.text.trim();
}
function noBucketPolicy(response){
  if(response.status!==404)return false;
  if(response.body.length>0)return value(xml(response.body,'Error'),'Code')==='NoSuchBucketPolicy';
  // The fixed signed COS policy endpoint also returns a bodyless 404.
  const observed=headers(response.rawHeaders,['content-type','server','x-cos-error-code']);
  return observed.get('content-length')==='0'&&observed.get('content-type')==='application/xml'&&
    observed.get('server')==='tencent-cos'&&!observed.has('x-cos-error-code');
}
function ownerOnly(body){
  const acl=xml(body,'AccessControlPolicy'),owner=one(acl,'Owner'),list=one(acl,'AccessControlList');
  const ownerId=value(owner,'ID'),grants=elements(list),grant=one(list,'Grant'),grantee=one(grant,'Grantee');
  need(grants.length===1&&/^[A-Za-z0-9:._/-]{1,256}$/u.test(ownerId)&&value(grantee,'ID')===ownerId&&
    !elements(grantee).some(child=>child.name==='URI')&&value(grant,'Permission')==='FULL_CONTROL','ACL');
}
async function openCurrent259FirstQ2Cos(permit){
  need(arguments.length===1,'SCOPE');
  const {plan,signal,check:checkScope,application,observer}=claimCurrent259FirstQ2CosPermit(permit);
  const host=plan.bucket+'.cos.'+plan.region+'.myqcloud.com';
  const cancel=new AbortController();
  let closed=false,ready=false,observing=false,readback;
  function check(){
    need(!closed&&!signal.aborted&&!cancel.signal.aborted,'CLOSED');
    checkScope();
  }
  function close(){closed=true;cancel.abort();}
  function send(key,query=null,signed=true){
    check();
    const target=key.split('/').map(encode).join('/')+(query?'?'+query.name+'='+query.encoded:'');
    const scopedSignal=AbortSignal.any([signal,cancel.signal,AbortSignal.timeout(15000)]);
    const outbound={Host:host,'Accept-Encoding':'identity',...(signed?{
      Authorization:auth(host,key,query,observer,plan.expiresAt),'x-cos-security-token':observer.sessionToken
    }:{})};
    return new Promise((resolve,reject)=>{
      const bad=()=>reject(fail('TRANSPORT'));
      const call=request({hostname:host,servername:host,port:443,path:target,method:'GET',headers:outbound,
        agent:false,rejectUnauthorized:true,maxHeaderSize:bound,signal:scopedSignal},response=>{
        response.once('aborted',bad);response.once('error',bad);response.once('close',()=>{if(!response.complete)bad();});
        try{
          check();
          const known=headers(response.rawHeaders),length=known.get('content-length');
          need(response.socket?.encrypted===true&&response.socket.authorized===true&&
            [200,403,404].includes(response.statusCode)&&!known.has('location')&&!known.has('content-range')&&
            (!known.has('content-encoding')||known.get('content-encoding').toLowerCase()==='identity')&&
            (length===undefined||/^\d{1,5}$/u.test(length)&&Number(length)<=bound)&&
            /^[A-Za-z0-9+/=_-]{1,160}$/u.test(known.get('x-cos-request-id')??''),'RESPONSE');
          const chunks=[];
          let count=0;
          response.on('data',chunk=>{
            count+=chunk.length;
            if(count>bound){bad();response.destroy();}
            else chunks.push(chunk);
          });
          response.once('end',()=>{
            try{
              check();
              need(!scopedSignal.aborted&&response.complete===true&&count<=bound&&
                (length===undefined||String(count)===length),'RESPONSE');
              resolve({status:response.statusCode,rawHeaders:response.rawHeaders,body:Buffer.concat(chunks,count)});
            }catch{bad();}
          });
        }catch{bad();response.destroy();}
      });
      call.once('error',bad);call.end();
    });
  }
  try{
    const getControl=name=>send('/',{name,encoded:''});
    const version=await getControl('versioning');
    need(version.status===200&&value(xml(version.body,'VersioningConfiguration'),'Status')==='Enabled','VERSIONING');
    const acl=await getControl('acl');
    need(acl.status===200,'ACL');
    ownerOnly(acl.body);
    const policy=await getControl('policy');
    need(noBucketPolicy(policy),'POLICY');
    const canaryPath='/'+plan.canary.key;
    const exists=await send(canaryPath);
    const id=headers(exists.rawHeaders).get('x-cos-version-id');
    need(exists.status===200&&/^[!-~]{1,1024}$/u.test(id??'')&&id.toLowerCase()!=='null'&&!id.includes(',')&&
      exists.body.length===plan.canary.sizeBytes&&sha(exists.body)===plan.canary.sha256,'CANARY');
    const anonymous=await send(canaryPath,null,false);
    need(anonymous.status===403&&value(xml(anonymous.body,'Error'),'Code')==='AccessDenied','PRIVATE');
    ready=true;
  }catch(error){close();throw error;}
  return Object.freeze({
    versioning:'Enabled',
    check,close,
    environment(){
      check();
      return Object.freeze({FILE_STORAGE_DRIVER:'cos',COS_BUCKET:plan.bucket,COS_REGION:plan.region,
        COS_SECRET_ID:application.secretId,COS_SECRET_KEY:application.secretKey,COS_SESSION_TOKEN:application.sessionToken});
    },
    async read(stage,upload){
      try{
        check();
        need(ready&&!observing,'SCOPE');
        observing=true;
        if(stage==='current'){
          need(!readback&&upload?.objectKey?.startsWith(plan.prefix),'SCOPE');
          readback=createCurrent259FirstQ2CosRead(plan.bucket,plan.region,upload);
        }else need(stage==='fixed'&&arguments.length===1&&readback,'SCOPE');
        const next=readback.next(stage);
        const query=next.versionId===null?null:{name:'versionId',encoded:encode(next.versionId)};
        const actual=await send('/'+next.objectKey,query);
        return readback.accept(stage,actual);
      }catch(error){close();throw error;}
      finally{observing=false;}
    }
  });
}
module.exports=Object.freeze({openCurrent259FirstQ2Cos});
