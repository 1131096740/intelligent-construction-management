'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const digest=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const source=path.join(__dirname,'task12-current259-first-q2-http.cjs');
const id='12345678-1234-4234-8234-123456789012',port=34567;
const routes=[['POST','/auth/login'],['POST','/contracts'],['POST','/contract-drafts/'+id+'/edit-lease'],
  ['POST','/contract-drafts/'+id+'/files'],['PUT','/contract-drafts/'+id],['POST','/contracts/'+id+'/signed-archive'],
  ['GET','/contracts/'+id+'/archive-requests/'+id],['POST','/files/'+id+'/download-ticket'],['GET','/files/'+id+'/download?token=model']];
function model({rejectAt=0,changePathAt=0,driftAt=0,firstOutside=false,firstOutsideOperating=false,wrongUploadName=false}={}){
  const requests=[],events=[],payloads=[],server={listening:true,address:()=>({address:'127.0.0.1',family:'IPv4',port})};
  const controller=new AbortController();
  let next=0,physicalChecks=0;
  const bridge={signal:controller.signal,checkHttpFiles(){if(++physicalChecks===driftAt)throw new Error('model file drift');},check(){assert.equal(controller.signal.aborted,false);},fixture:{...(firstOutside?{relationship:'outside'}:{}),...(firstOutsideOperating?{outsideOperating:true}:{}),createCase(){return {
    next(){
      const index=next++,route=routes[index];
      return {method:route[0],path:changePathAt===index+1?'https://elsewhere.invalid/':route[1],
        ...(index===0?{json:{phone:'synthetic'}}:index===3?{multipart:{idempotencyKey:id,file:{field:'file',name:firstOutside&&!wrongUploadName?'首条表外原件.pdf':'首条对上原件.pdf',mimeType:'application/pdf',bytes:Buffer.from('%PDF')}}}:{})};
    },
    accept(reply){assert.equal(reply.status,200);if(next===9)assert.deepEqual(reply.body,Buffer.from('proof'));},
    uploadObservation(){return 'same fixed upload';},
    acceptUploadObservation(row){assert.equal(row.objectGeneration,'v1');},
    observation(){return {actorId:id,inputSha256:digest('frozen Q')};},
    finish(result){assert.equal(result.storage.upload.objectGeneration,'v1');assert.equal(result.storage.download.objectGeneration,'v1');
      return {status:firstOutsideOperating?'CURRENT259_FIRST_OUTSIDE_OPERATING_PROTOCOL_MATCHED_NOT_ACCEPTANCE':'CURRENT259_FIRST_Q2_PROTOCOL_MATCHED_NOT_ACCEPTANCE',
        httpSteps:9,operatingMode:firstOutsideOperating?'projection_required':'not_applicable',
        ...(firstOutside?{persistedGenerationSha256:digest('v1')}:{}),
        ...(firstOutsideOperating?{operatingLedger:{factId:id,amountYuan:'100.0054'}}:{})};}
  };}},async observeUpload(coord){events.push('owner-upload');assert.equal(coord,'same fixed upload');return {fileId:id};},
    async observeArchive(coord){events.push('owner-archive');assert.equal(coord.inputSha256,digest('frozen Q'));return {archive:{id,idempotencyKey:id,confirmedAt:'2026-11-11T02:00:00.000Z',requestSha256:'b'.repeat(64),authoritySha256:'c'.repeat(64),qText:'{}',token:'never-export'},
      version:{id,contractId:id,status:'effective',draftRevision:2,effectiveAt:'2026-11-11T02:00:00.000Z'},
      archivedFile:{fileId:id,mimeType:'application/pdf',sizeBytes:5,contentSha256:digest('proof')},
      counts:{archives:1,evidenceFiles:1,physicalAliases:0,draftSlots:0,approvalRounds:0,sealTasks:0,operatingFacts:Number(firstOutsideOperating),operatingImpacts:Number(firstOutsideOperating),
        archiveAudits:1,uploadAudits:1,downloadTicketAudits:1,downloadAudits:1}};},
    cos:{versioning:'Enabled',async read(stage,upload){events.push('cos-'+stage);if(stage==='current')assert.equal(upload.fileId,id);return {objectGeneration:'v1',contentSha256:digest('proof'),sizeBytes:5,objectKey:'keep-private'};}}
  };
  const holder={exports:{}};
  const request=(option,callback)=>{
    requests.push(option);events.push(option.method+' '+option.path);
    const outgoing=new EventEmitter();
    outgoing.end=body=>{payloads.push(body);queueMicrotask(()=>{
      const response=new EventEmitter();
      Object.assign(response,{statusCode:requests.length===rejectAt?307:200,complete:true,headers:{},
        socket:{remoteAddress:'127.0.0.1',remotePort:port},destroy(){}});
      callback(response);
      response.emit('data',Buffer.from(requests.length===9?'proof':'{}'));response.emit('end');
    });};
    return outgoing;
  };
  const rq=name=>name==='node:http'?{request}:name==='./task12-current259-contract-application.cjs'?{
    takeCurrent259FirstQ2HttpBridge(value,target){assert.equal(value,bridge);assert.equal(target,server);}
  }:require(name);
  new Function('require','module',fs.readFileSync(source,'utf8'))(rq,holder);
  return {bridge,requests,events,payloads,send:()=>holder.exports.runCurrent259FirstQ2Http(bridge,server)};
}
test('the sender binds each of nine requests to the owned loopback server and uses owner and COS evidence before save',async()=>{
  const f=model(),out=await f.send();
  assert.equal(out.httpSteps,9);
  assert.match(out.proofSha256,/^[a-f0-9]{64}$/u);
  assert.equal(out.evidence.archiveId,id);
  assert.equal(out.evidence.operatingFacts,0);
  assert.equal(out.evidence.archiveAudits,1);
  assert.equal(out.evidence.downloadSha256,digest('proof'));
  assert.equal(out.evidence.downloadSha256,out.evidence.fileSha256);
  assert.equal(out.evidence.inputSha256,digest('frozen Q'));
  assert.equal(out.evidence.idempotencyKey,id);
  assert.equal(out.evidence.actorId,id);
  assert.equal(out.evidence.cosCurrentGenerationSha256,digest('v1'));
  assert.equal(out.evidence.cosFixedGenerationSha256,digest('v1'));
  assert.equal(out.evidence.cosCurrentContentSha256,digest('proof'));
  assert.equal(out.evidence.cosFixedContentSha256,digest('proof'));
  assert.equal(out.evidence.cosCurrentBytes,5);
  assert.equal(out.evidence.cosFixedBytes,5);
  assert.equal(out.evidenceSha256,digest(JSON.stringify(out.evidence)));
  assert.doesNotMatch(JSON.stringify(out.evidence),/never-export|keep-private|token|download\? /u);
  assert.deepEqual(f.requests.map(r=>[r.method,r.path]),routes);
  assert.ok(f.requests.every(r=>r.hostname==='127.0.0.1'&&r.port===port&&r.agent===false));
  assert.match(f.requests[3].headers['Content-Type'],/^multipart\/form-data; boundary=/u);
  assert.match(f.payloads[3].toString(),/name="idempotencyKey"\r\n\r\n12345678/u);
  assert.match(f.payloads[3].toString(),/filename="首条对上原件.pdf"/u);
  assert.deepEqual(f.events.slice(4,7),['owner-upload','cos-current','PUT /contract-drafts/'+id]);
  assert.deepEqual(f.events.slice(-2),['owner-archive','cos-fixed']);
});
test('redirect or out of scope route stops without any later request',async()=>{
  const redirect=model({rejectAt:2});
  await assert.rejects(redirect.send(),/CURRENT259_FIRST_Q2_HTTP/u);
  assert.equal(redirect.requests.length,2);
  const outside=model({changePathAt:2});
  await assert.rejects(outside.send(),/CURRENT259_FIRST_Q2_HTTP/u);
  assert.equal(outside.requests.length,1);
});


test('file identity drift stops before the next fixed HTTP request',async()=>{
  const f=model({driftAt:5});
  await assert.rejects(f.send(),/model file drift/u);
  assert.equal(f.requests.length,4);
  assert.deepEqual(f.events.slice(-2),['owner-upload','cos-current']);
});

test('outside uses its fixed multipart name and rejects the original Q2 filename',async()=>{
  const outside=model({firstOutside:true});
  const result=await outside.send();
  assert.equal(result.httpSteps,9);
  assert.equal(result.evidence.persistedGenerationSha256,digest('v1'));
  assert.match(outside.payloads[3].toString(),/filename="首条表外原件.pdf"/u);
  const wrong=model({firstOutside:true,wrongUploadName:true});
  await assert.rejects(wrong.send(),/FIRST_Q2_HTTP_BODY/u);
  assert.equal(wrong.requests.length,3);
});

test('the operating sender preserves nine original routes and projects the qualified ledger without raw proof',async()=>{
  const f=model({firstOutside:true,firstOutsideOperating:true});
  const out=await f.send();
  assert.deepEqual(f.requests.map(r=>[r.method,r.path]),routes);
  assert.equal(out.evidence.operatingMode,'projection_required');
  assert.equal(out.evidence.operatingFacts,1);
  assert.deepEqual(out.evidence.operatingLedger,{factId:id,amountYuan:'100.0054'});
  assert.equal(out.evidence.persistedGenerationSha256,out.evidence.cosFixedGenerationSha256);
  assert.doesNotMatch(JSON.stringify(out.evidence),/never-export|keep-private|payloadText|downloadUrl/u);
});
