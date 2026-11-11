'use strict';
const {request}=require('node:http');
const {createHash,randomBytes}=require('node:crypto');
const {takeCurrent259FirstQ2HttpBridge}=require('./task12-current259-contract-application.cjs');

const id='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const route=[
  ['POST',/^\/auth\/login$/u],['POST',/^\/contracts$/u],['POST',new RegExp('^/contract-drafts/'+id+'/edit-lease$','u')],
  ['POST',new RegExp('^/contract-drafts/'+id+'/files$','u')],['PUT',new RegExp('^/contract-drafts/'+id+'$','u')],
  ['POST',new RegExp('^/contracts/'+id+'/signed-archive$','u')],
  ['GET',new RegExp('^/contracts/'+id+'/archive-requests/'+id+'$','u')],['POST',new RegExp('^/files/'+id+'/download-ticket$','u')],
  ['GET',new RegExp('^/files/'+id+'/download\\?[!-~]{1,900}$','u')],
];
const error=phase=>Object.assign(new Error('CURRENT259_FIRST_Q2_HTTP_'+phase),{code:'CURRENT259_FIRST_Q2_HTTP_'+phase});
const need=(ok,phase)=>{if(!ok)throw error(phase);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function requestBody(message,index,headers,outside){
  if(index===3){
    const part=message.multipart;
    const filename=outside?'首条表外原件.pdf':'首条对上原件.pdf';
    need(part&&new RegExp('^'+id+'$','u').test(part.idempotencyKey)&&part.file.field==='file'&&
      part.file.name===filename&&part.file.mimeType==='application/pdf'&&
      Buffer.isBuffer(part.file.bytes)&&part.file.bytes.length>0&&part.file.bytes.length<16384,'BODY');
    const boundary='q2-'+randomBytes(16).toString('hex');
    const start='--'+boundary+'\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\n'+part.idempotencyKey+
      '\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+filename+'"\r\nContent-Type: application/pdf\r\n\r\n';
    headers['Content-Type']='multipart/form-data; boundary='+boundary;
    return Buffer.concat([Buffer.from(start),part.file.bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
  }
  if(message.json===undefined)return undefined;
  need(message.method!=='GET','BODY');
  headers['Content-Type']='application/json; charset=utf-8';
  return Buffer.from(JSON.stringify(message.json));
}
function send(server,port,bridge,message,index){
  const [verb,pattern]=route[index];
  need(message.method===verb&&typeof message.path==='string'&&pattern.test(message.path)&&!/[#\\]/u.test(message.path),'ROUTE');
  const hdr={Host:'127.0.0.1:'+port,'Accept-Encoding':'identity'};
  for(const [key,value] of Object.entries(message.headers??{})){
    need(['authorization','x-contract-draft-lease'].includes(key)&&typeof value==='string'&&value.length<=4096&&
      /^[\x21-\x7e]+(?: [\x21-\x7e]+)?$/u.test(value),'HEADERS');
    hdr[key]=value;
  }
  const body=requestBody(message,index,hdr,bridge.fixture.relationship==='outside');
  if(body){need(body.length<=256*1024,'BODY');hdr['Content-Length']=body.length;}
  const timeout=AbortSignal.any([bridge.signal,AbortSignal.timeout(15000)]);
  const cap=index===8?16384:512*1024;
  return new Promise((resolve,reject)=>{
    const bad=()=>reject(error('TRANSPORT'));
    const outgoing=request({hostname:'127.0.0.1',port,method:verb,path:message.path,headers:hdr,agent:false,
      maxHeaderSize:16384,signal:timeout},reply=>{
      reply.once('error',bad);reply.once('aborted',bad);reply.once('close',()=>{if(!reply.complete)bad();});
      try{
        need(reply.socket?.remoteAddress==='127.0.0.1'&&reply.socket.remotePort===port&&server.listening===true&&
          Number.isInteger(reply.statusCode)&&reply.statusCode>=200&&reply.statusCode<=299&&
          !Object.hasOwn(reply.headers,'location')&&!Object.hasOwn(reply.headers,'content-range')&&
          (!reply.headers['content-encoding']||reply.headers['content-encoding']==='identity'),'RESPONSE');
      }catch{bad();reply.destroy();return;}
      const chunks=[];
      let seen=0;
      reply.on('data',chunk=>{
        seen+=chunk.length;
        if(seen>cap){bad();reply.destroy();}else chunks.push(chunk);
      });
      reply.once('end',()=>{
        try{
          need(!timeout.aborted&&reply.complete===true&&seen<=cap,'RESPONSE');
          const bytes=Buffer.concat(chunks,seen);
          const body=index===8?bytes:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
          resolve({status:reply.statusCode,headers:reply.headers,body});
        }catch{bad();}
      });
    });
    outgoing.once('error',bad);
    outgoing.end(body);
  });
}
async function runCurrent259FirstQ2Http(bridge,server){
  need(arguments.length===2,'SCOPE');
  takeCurrent259FirstQ2HttpBridge(bridge,server);
  const address=server.address();
  const port=address?.port;
  const check=()=>{
    bridge.check();
    const current=server.address();
    need(server.listening===true&&current?.address==='127.0.0.1'&&current.family==='IPv4'&&
      Number.isInteger(port)&&port>1024&&port<=65535&&current.port===port,'SERVER');
  };
  check();
  const scenario=bridge.fixture.createCase();
  let upload,downloadBytes,downloadSha256;
  for(let index=0;index<route.length;index++){
    bridge.checkHttpFiles();check();
    const response=await send(server,port,bridge,scenario.next(),index);
    check();scenario.accept(response);
    if(index===8){downloadBytes=response.body.length;downloadSha256=digest(response.body);}
    if(index===3){
      const observed=await bridge.observeUpload(scenario.uploadObservation());
      check();
      upload=await bridge.cos.read('current',observed);
      check();
      scenario.acceptUploadObservation({driver:'cos',versioning:bridge.cos.versioning,...upload});
    }
  }
  const coordinates=scenario.observation();
  const evidence=await bridge.observeArchive(coordinates);
  check();
  const download=await bridge.cos.read('fixed');
  check();
  const observed={...evidence,storage:{driver:'cos',versioning:bridge.cos.versioning,upload,download}};
  const result=scenario.finish(observed);
  const {archive,version,archivedFile,counts}=evidence;
  const safe=Object.freeze({
    archiveId:archive.id,contractId:version.contractId,versionId:version.id,fileId:archivedFile.fileId,
    actorId:coordinates.actorId,idempotencyKey:archive.idempotencyKey,
    status:version.status,revision:version.draftRevision,effectiveAt:version.effectiveAt,operatingMode:result.operatingMode,
    fileBytes:archivedFile.sizeBytes,fileSha256:archivedFile.contentSha256,downloadBytes,downloadSha256,
    cosCurrentGenerationSha256:digest(upload.objectGeneration),cosCurrentContentSha256:upload.contentSha256,cosCurrentBytes:upload.sizeBytes,
    cosFixedGenerationSha256:digest(download.objectGeneration),cosFixedContentSha256:download.contentSha256,cosFixedBytes:download.sizeBytes,
    ...(bridge.fixture.relationship==='outside'?{persistedGenerationSha256:result.persistedGenerationSha256}:{}),
    ...(bridge.fixture.outsideOperating===true?{operatingLedger:result.operatingLedger}:{}),
    inputSha256:coordinates.inputSha256,requestSha256:archive.requestSha256,authoritySha256:archive.authoritySha256,
    archives:counts.archives,evidenceFiles:counts.evidenceFiles,physicalAliases:counts.physicalAliases,
    draftSlots:counts.draftSlots,approvalRounds:counts.approvalRounds,sealTasks:counts.sealTasks,
    operatingFacts:counts.operatingFacts,operatingImpacts:counts.operatingImpacts,archiveAudits:counts.archiveAudits,
    uploadAudits:counts.uploadAudits,downloadTicketAudits:counts.downloadTicketAudits,downloadAudits:counts.downloadAudits
  });
  return Object.freeze({...result,proofSha256:digest(JSON.stringify(observed)),evidence:safe,evidenceSha256:digest(JSON.stringify(safe))});
}
module.exports=Object.freeze({runCurrent259FirstQ2Http});
