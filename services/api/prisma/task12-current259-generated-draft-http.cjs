'use strict';

const {request}=require('node:http');
const {generatedDraftHttpSteps,projectGeneratedDraftHttpFailure}=require('./task12-current259-generated-draft-diagnostic.cjs');
const {takeCurrent259GeneratedHttpBridge}=require('./task12-current259-contract-application.cjs');

const id='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const versionPath=new RegExp('^/contract-drafts/('+id+')/(edit-lease|workbench)$','u');
const error=()=>Object.assign(new Error('CURRENT259_GENERATED_DRAFT_HTTP'),{code:'CURRENT259_GENERATED_DRAFT_HTTP'});
const need=value=>{if(!value)throw error();};

function send(port,message,observeStatus){
  const data=message.json===undefined?undefined:Buffer.from(JSON.stringify(message.json));
  need(!data||data.length<=1024);
  const headers={Host:'127.0.0.1:'+port,'Accept-Encoding':'identity'};
  for(const [key,value] of Object.entries(message.headers??{})){
    need(key==='content-type'&&value==='application/json' || key==='x-contract-numeric-protocol'&&value==='2' ||
      key==='authorization'&&typeof value==='string'&&value.length<=4103&&/^Bearer [\w.-]+$/u.test(value));
    headers[key]=value;
  }
  if(data)headers['Content-Length']=data.length;
  const signal=AbortSignal.timeout(15000),cap=512*1024;
  return new Promise((resolve,reject)=>{
    const fail=()=>reject(error());
    const outgoing=request({hostname:'127.0.0.1',port,method:message.method,path:message.path,headers,agent:false,maxHeaderSize:16384,signal},reply=>{
      reply.once('error',fail);reply.once('aborted',fail);reply.once('close',()=>{if(!reply.complete)fail();});
      if(reply.socket?.remoteAddress!=='127.0.0.1'||reply.socket.remotePort!==port||
        Object.hasOwn(reply.headers,'location')||Object.hasOwn(reply.headers,'content-range')||
        (reply.headers['content-encoding']&&reply.headers['content-encoding']!=='identity')){
        fail();reply.destroy();return;
      }
      observeStatus(reply.statusCode);
      let size=0;const chunks=[];
      reply.on('data',chunk=>{size+=chunk.length;if(size>cap){fail();reply.destroy();}else chunks.push(chunk);});
      reply.once('end',()=>{
        try{
          need(!signal.aborted&&reply.complete&&size<=cap);
          const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
          resolve({status:reply.statusCode,body});
        }catch{fail();}
      });
    });
    outgoing.once('error',fail);
    outgoing.end(data);
  });
}

async function runCurrent259GeneratedDraftHttp(bridge,server){
  need(arguments.length===2);
  takeCurrent259GeneratedHttpBridge(bridge,server);
  const port=server.address()?.port;
  const check=()=>{
    bridge.checkHttpFiles();bridge.check();
    const address=server.address();
    need(server.listening===true&&address?.address==='127.0.0.1'&&address.family==='IPv4'&&
      Number.isInteger(port)&&port>1024&&port<=65535&&address.port===port);
  };
  let index=0,version,step,httpStatus;
  try{
    const result=await bridge.openDraft(async message=>{
      step=generatedDraftHttpSteps[index];
      httpStatus=undefined;
      check();
      if(index<3){
        const paths=['/auth/login','/contracts/create-capability?projectId='+bridge.projectId+'&relationship=inside','/contracts'];
        need(message.path===paths[index]&&message.method===(index===1?'GET':'POST'));
      }else{
        const parts=versionPath.exec(message.path);
        need(parts&&((index===3&&parts[2]==='edit-lease'&&message.method==='POST') ||
          (index===4&&parts[2]==='workbench'&&message.method==='GET'&&parts[1]===version)));
        if(index===3)version=parts[1];
      }
      index++;
      const response=await send(port,message,status=>{httpStatus=status;});
      check();return response;
    });
    need(index===5&&result?.versionId===version);
    return result;
  }catch{
    const detail=projectGeneratedDraftHttpFailure({step,httpStatus});
    throw Object.assign(error(),detail?{generatedHttpFailure:detail}:{});
  }
}
module.exports=Object.freeze({runCurrent259GeneratedDraftHttp});
