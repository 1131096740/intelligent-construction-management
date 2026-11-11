'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {types}=require('node:util');
const {isCurrent259OwnedModule,createCurrent259OwnedApplication,current259OwnedApplicationView,
  takeCurrent259CreationFailure}=require('./task16-current259-client-loader.cjs');

const ENVIRONMENT=Object.freeze({NODE_ENV:'production',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local'});
const SECRET_KEYS=['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'];
const KEYS=[...Object.keys(ENVIRONMENT),'FILE_STORAGE_ROOT',...SECRET_KEYS];
const COS_KEYS=['COS_BUCKET','COS_REGION','COS_SECRET_ID','COS_SECRET_KEY','COS_SESSION_TOKEN'];
const HTTP_BRIDGES=new WeakMap();
const FOREIGN=/^(?:SMS_|APPROVAL_SMS_|COS_|TENCENT|WX_|WECHAT_|PRISMA_|JWT_|FILE_|CONTRACT_CUTOVER_|OPERATIONAL_WRITE_FREEZE|DIRECT_ARCHIVE_|UPWARD_DIRECT_ARCHIVE_|OPERATING_LEDGER_DB_WRITE_SECRET|DATABASE_URL|SKIP_DATABASE_CONNECT|HOST$|PORT$|WEB_ORIGIN$|NODE_OPTIONS$|NODE_PATH$)/u;
const ownFaults=new WeakMap();
let busy=false;
function fault(reason) {
  const code='CURRENT259_FIRST_Q2_APP_'+reason;
  const error=Object.assign(new Error(code),{code});
  ownFaults.set(error,reason);
  return error;
}
function need(ok,reason) { if(!ok)throw fault(reason); }
function data(object,key) {
  need(object && !types.isProxy(object),'DESCRIPTOR');
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  need(descriptor && Object.hasOwn(descriptor,'value'),'DESCRIPTOR');
  return descriptor.value;
}
function method(object,key) {
  for(let owner=object,depth=0;owner && depth<32;owner=Object.getPrototypeOf(owner),depth++){
    need(!types.isProxy(owner),'DESCRIPTOR');
    const descriptor=Object.getOwnPropertyDescriptor(owner,key);
    if(descriptor){
      need(Object.hasOwn(descriptor,'value') && typeof descriptor.value==='function','DESCRIPTOR');
      return descriptor.value;
    }
  }
  throw fault('DESCRIPTOR');
}
function directoryIdentity(directory) {
  const stat=fs.lstatSync(directory);
  need(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(directory)===directory &&
    stat.uid===process.getuid() && (stat.mode&0o077)===0,'STORAGE');
  return [stat.dev,stat.ino,stat.uid,stat.mode].join(':');
}
function foreign(env,keys) {
  return Object.keys(env).some(key=>!keys.includes(key) && key!=='PRISMA_HIDE_UPDATE_MESSAGE' && FOREIGN.test(key));
}
function prepareEnvironment(caPath,native) {
  const env=process.env;
  const keys=native?[...KEYS,...COS_KEYS]:KEYS;
  const prior=keys.map(key=>Object.getOwnPropertyDescriptor(env,key));
  need(prior.every((descriptor,index)=>descriptor===undefined ||
    (keys[index]==='NODE_ENV' && Object.hasOwn(descriptor,'value') && descriptor.value==='production')) && !foreign(env,keys),'ENVIRONMENT');
  need(typeof caPath==='string' && path.isAbsolute(caPath) && path.normalize(caPath)===caPath &&
    path.basename(caPath)==='ca.crt' && path.basename(path.dirname(caPath))==='tls-private','STORAGE');
  const storage=native?native.storageEnvironment():undefined;
  if(native)need(storage && Reflect.ownKeys(storage).length===COS_KEYS.length+1 && data(storage,'FILE_STORAGE_DRIVER')==='cos' &&
    COS_KEYS.every(key=>typeof data(storage,key)==='string' && data(storage,key).length>0),'ENVIRONMENT');
  const parent=path.dirname(path.dirname(caPath));
  const parentIdentity=directoryIdentity(parent);
  const secrets=SECRET_KEYS.map(()=>randomBytes(32).toString('hex'));
  need(new Set(secrets).size===3,'ENVIRONMENT');
  const root=fs.mkdtempSync(path.join(parent,'first-q2-application-'));
  const rootIdentity=directoryIdentity(root);
  const owned=Object.freeze({...ENVIRONMENT,...storage,FILE_STORAGE_ROOT:root,
    ...Object.fromEntries(SECRET_KEYS.map((key,index)=>[key,secrets[index]]))});
  for(const key of keys)env[key]=owned[key];
  const matches=()=>process.env===env && keys.every(key=>env[key]===owned[key]);
  const sameStorage=()=>directoryIdentity(parent)===parentIdentity && directoryIdentity(root)===rootIdentity;
  return Object.freeze({
    check(){need(matches() && !foreign(env,keys) && sameStorage(),'ENVIRONMENT');},
    restore(){
      let unknown=!matches();
      if(!unknown){
        unknown=foreign(env,keys);
        keys.forEach((key,index)=>{
          if(prior[index])Object.defineProperty(env,key,prior[index]);else delete env[key];
        });
      }
      need(sameStorage(),'STORAGE');
      fs.rmSync(root,{recursive:true,force:false});
      need(!unknown,'ENVIRONMENT');
    },
  });
}

function takeCurrent259FirstQ2HttpBridge(bridge,server) {
  need(arguments.length===2 && HTTP_BRIDGES.get(bridge)===server && HTTP_BRIDGES.delete(bridge),'SCOPE');
}

async function runCurrent259FirstQ2Application(bridge) {
  const {takeCurrent259FirstQ2Bridge}=require('./task12-current259-contract-login.cjs');
  takeCurrent259FirstQ2Bridge(bridge);
  need(arguments.length===1 && !busy,'SCOPE');
  busy=true;
  let environment,testing,application,owned,orphan,server;
  let closeModule,closeApplication,nativeResult;
  let providersAttempted=false,compileAttempted=false,pending=false;
  let failure,cleanupUnknown=false,stage='PREPARE';
  const check=()=>{bridge.check();environment.check();};
  const bounded=async operation=>{
    let timer;
    try{
      return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
        timer=setTimeout(()=>{pending=true;reject(fault('TIMEOUT'));},30000);
      })]);
    }finally{clearTimeout(timer);}
  };
  try{
    bridge.check();
    environment=prepareEnvironment(bridge.caPath,bridge.native);
    check();
    const loaded=bridge.loaded;
    const tokens=['PrismaService','ContractDirectArchiveRuntime','ContractUpwardDirectArchiveRuntime'].map(key=>data(loaded,key));
    need(tokens.every(token=>typeof token==='function') && new Set(tokens).size===3,'PROVIDERS');
    stage='CONSTRUCT';
    providersAttempted=true;
    const providers=bridge.constructProviders();
    check();
    need(Array.isArray(providers) && providers.length===3 && new Set(providers).size===3 && providers.every(Boolean),'PROVIDERS');
    const builder=bridge.createTestingModule();
    const override=method(builder,'overrideProvider');
    tokens.forEach((token,index)=>{
      const binding=override.call(builder,token);
      method(binding,'useValue').call(binding,providers[index]);
    });
    const verifyProviderIdentity=target=>{
      const get=method(target,'get');
      need(tokens.every((token,index)=>get.call(target,token)===providers[index]),'PROVIDERS');
    };
    stage='COMPILE';
    compileAttempted=true;
    testing=await bounded(()=>method(builder,'compile').call(builder));
    need(isCurrent259OwnedModule(testing),'MODULE');
    closeModule=method(testing,'close');
    check();verifyProviderIdentity(testing);
    stage='CREATE';
    try{application=createCurrent259OwnedApplication(testing);}
    catch(error){orphan=takeCurrent259CreationFailure(error);throw error;}
    owned=current259OwnedApplicationView(application);
    closeApplication=method(owned,'close');
    check();verifyProviderIdentity(owned);
    data(loaded,'configureApiSecurity')(owned);check();
    data(loaded,'configureProjectionExportJson')(owned);check();
    const adapter=method(owned,'getHttpAdapter').call(owned);
    const express=method(adapter,'getInstance').call(adapter);
    method(express,'set').call(express,'json replacer',data(loaded,'apiJsonReplacer'));
    method(owned,'enableCors').call(owned,{origin:[],credentials:false});
    method(owned,'useGlobalPipes').call(owned,data(loaded,'createApiValidationPipe')());
    stage='INIT';
    check();await bounded(()=>method(owned,'init').call(owned));check();
    verifyProviderIdentity(testing);verifyProviderIdentity(owned);
    stage='TLS';
    need(await bridge.verifyProviders()===5,'PROVIDERS');check();
    verifyProviderIdentity(owned);
    stage='LISTEN';
    server=method(owned,'getHttpServer').call(owned);
    await bounded(()=>data(loaded,'listenApi')(owned,0,'127.0.0.1'));check();
    const address=method(server,'address').call(server);
    need(server.listening===true && data(address,'address')==='127.0.0.1' && data(address,'family')==='IPv4' &&
      Number.isInteger(data(address,'port')) && data(address,'port')>1024 && data(address,'port')<=65535,'ADDRESS');
    verifyProviderIdentity(owned);
    if(bridge.native){
      stage='HTTP';
      const {runCurrent259FirstQ2Http}=require('./task12-current259-first-q2-http.cjs');
      const qualified=Object.freeze({...bridge.native,check});
      bridge.native.beginHttp();
      HTTP_BRIDGES.set(qualified,server);
      try{nativeResult=await runCurrent259FirstQ2Http(qualified,server);}
      finally{
        HTTP_BRIDGES.delete(qualified);
        bridge.native.endHttp(Boolean(nativeResult));
      }
      const protocol=bridge.native.fixture.relationship==='outside'
        ?'CURRENT259_FIRST_OUTSIDE_DIRECT_PROTOCOL_MATCHED_NOT_ACCEPTANCE':'CURRENT259_FIRST_Q2_PROTOCOL_MATCHED_NOT_ACCEPTANCE';
      need(nativeResult?.status===protocol&&nativeResult.httpSteps===9 &&
        typeof nativeResult.proofSha256==='string' && /^[a-f0-9]{64}$/u.test(nativeResult.proofSha256),'HTTP');
      check();verifyProviderIdentity(owned);
    }
  }catch(error){
    failure=fault(ownFaults.get(error)??stage);
  }
  try{
    if(closeApplication)await bounded(()=>closeApplication.call(owned));
    else if(orphan)await bounded(()=>orphan.close());
    else if(closeModule)await bounded(()=>closeModule.call(testing));
    else if(providersAttempted && !compileAttempted)await bridge.disconnectUnowned();
    else if(compileAttempted)cleanupUnknown=true;
    if(server)need(server.listening===false,'CLOSE');
    if(providersAttempted && !pending && !cleanupUnknown)await bridge.verifyClosed();
  }catch{cleanupUnknown=true;}
  finally{
    if(environment && !cleanupUnknown && !pending){
      try{environment.restore();}catch{cleanupUnknown=true;}
    }
    // An unresolved operation may still own the process environment.
    if(!cleanupUnknown && !pending)busy=false;
  }
  if(cleanupUnknown || pending){
    const error=Object.assign(failure??fault('CLOSE'),{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
    throw error;
  }
  if(failure)throw failure;
  if(nativeResult)return Object.freeze({status:bridge.native.fixture.relationship==='outside'
    ?'CURRENT259_FIRST_OUTSIDE_DIRECT_HTTP_AND_NEST_CLOSED':'CURRENT259_FIRST_Q2_HTTP_AND_NEST_CLOSED',verifiedClients:5,httpSteps:9,storageAcceptance:true,proofSha256:nativeResult.proofSha256,evidence:nativeResult.evidence,evidenceSha256:nativeResult.evidenceSha256});
  return Object.freeze({status:'CURRENT259_FIRST_Q2_NEST_ASSEMBLY_CLOSED',verifiedClients:5,storageAcceptance:false,
    executionAllowed:false,nativeAdmission:false});
}

module.exports=Object.freeze({runCurrent259FirstQ2Application,takeCurrent259FirstQ2HttpBridge});
