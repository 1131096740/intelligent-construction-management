#!/usr/bin/env node
'use strict';
// Fixed native two-actor competition and remaining-payment case; root dispatch only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {types,isDeepStrictEqual:equal}=require('node:util');
const ROOT=path.resolve(__dirname,'../../..'),PURPOSE='TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1',GAP_PURPOSE='TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1',SOURCE_PURPOSE='TASK16_NATIVE_PROJECT_SOURCE_INSUFFICIENT_V1',VOUCHER_PURPOSE='TASK16_NATIVE_COMPETITION_VOUCHER_V1',CASH_PURPOSE='TASK16_NATIVE_PUBLIC_CASH_V1',LEDGER_COMPETITION_PURPOSE='TASK16_NATIVE_LEDGER_COMPETITION_V1',LEDGER_CANCEL_PURPOSE='TASK16_NATIVE_LEDGER_CANCEL_V1',REVOCATION_PURPOSE='TASK16_NATIVE_VOUCHER_REVOCATION_V1',DISABLED_PURPOSE='TASK16_NATIVE_VOUCHER_DISABLED_ACCOUNT_V1',LEDGER_LOSS_PURPOSE='TASK16_NATIVE_LEDGER_RESPONSE_LOSS_V1';
// Root's independently reviewed official16.15/pgcrypto93-file qualification.
const BINARY_QUALIFICATION_SHA='26e93f289366a2f9c60c61b9035849052d59509d54f2c388cbdf7c419d3663a1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(value,code='NATIVE_DIRECT_INPUT')=>{if(!value)fail(code);};
function assertNativeTask16RevocationTarget(origin,ids,target,method){
 const base=new URL(origin),url=new URL(target);const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(x);
 need(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port&&url.origin===base.origin&&!url.username&&!url.password&&!url.hash&&uuid(ids?.file)&&uuid(ids?.execution)&&method==='GET','NATIVE_DIRECT_REVOCATION_ROUTE');
 const isDownload=url.pathname===`/files/${ids.file}/download`;
 need((isDownload||!url.search)&&[ '/projects',`/files/${ids.file}/download-ticket-capability`,`/payment-executions/${ids.execution}/voucher-ticket`,`/files/${ids.file}/download`].includes(url.pathname),'NATIVE_DIRECT_REVOCATION_ROUTE');
}
// This additional ingress fence is installed only in the revocation app.
// Normal seed openings end before any voucher-read routes become reachable.
function nativeTask16RevocationInboundAllowed(method,raw,ids){
 if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//'))return false;
 let url;try{url=new URL(raw,'http://127.0.0.1:1025');}catch{return false;}
 if(url.origin!=='http://127.0.0.1:1025'||url.hash)return false;
 if(method==='POST'&&!url.search&&(url.pathname==='/auth/login'||!ids&&url.pathname==='/fund-accounts/openings'))return true;
 if(method!=='GET'||!ids)return false;
 try{assertNativeTask16RevocationTarget('http://127.0.0.1:1025',ids,url,method);return true;}catch{return false;}
}
function nativeTask16CaseSelection(purpose){
 need(purpose===PURPOSE||purpose===GAP_PURPOSE||purpose===SOURCE_PURPOSE||purpose===VOUCHER_PURPOSE||purpose===CASH_PURPOSE||purpose===LEDGER_COMPETITION_PURPOSE||purpose===LEDGER_CANCEL_PURPOSE||purpose===REVOCATION_PURPOSE||purpose===DISABLED_PURPOSE||purpose===LEDGER_LOSS_PURPOSE,'NATIVE_DIRECT_CASE_PURPOSE');
 const competition=purpose!==GAP_PURPOSE&&purpose!==SOURCE_PURPOSE;
 if(purpose===SOURCE_PURPOSE)return Object.freeze({purpose,caseId:'registered.project-source-insufficient',paymentProfile:'TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1',competition:false,runtimeLimit:1,insertAdditionCount:5,sourceInsufficient:true});
 if(purpose===LEDGER_CANCEL_PURPOSE)return Object.freeze({purpose,caseId:'registered.ledger-payment.cancel-commit',paymentProfile:'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:13,ledgerCancel:true});
 if(purpose===LEDGER_LOSS_PURPOSE)return Object.freeze({purpose,caseId:'registered.ledger-payment.response-loss',paymentProfile:'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:13,ledgerCompetition:true,ledgerLoss:true});
 if(purpose===LEDGER_COMPETITION_PURPOSE)return Object.freeze({purpose,caseId:'registered.ledger-payment-competition',paymentProfile:'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:13,ledgerCompetition:true});
 if(purpose===CASH_PURPOSE)return Object.freeze({purpose,caseId:'registered.public-cash.payment',paymentProfile:'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:13,cash:true});
 if(purpose===DISABLED_PURPOSE)return Object.freeze({purpose,caseId:'registered.voucher.disabled-account',paymentProfile:'TASK16_PAYMENT261_VOUCHER_REVOCATION_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:11,voucher:true,revocation:true,disabled:true});
 if(purpose===REVOCATION_PURPOSE)return Object.freeze({purpose,caseId:'registered.voucher.project-revocation',paymentProfile:'TASK16_PAYMENT261_VOUCHER_REVOCATION_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:11,voucher:true,revocation:true});
 if(purpose===VOUCHER_PURPOSE)return Object.freeze({purpose,caseId:'registered.two-actor.payment-voucher',paymentProfile:'TASK16_PAYMENT261_VOUCHER_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:11,voucher:true});
 return Object.freeze({purpose,caseId:competition?'registered.two-actor.payment-competition-follow-up':'registered.project-attribution-gap',
  paymentProfile:competition?'TASK16_PAYMENT261_COMPETITION_RUNTIME_V1':'TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1',
  competition,runtimeLimit:competition?2:1,insertAdditionCount:competition?9:5});
}
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$','u').test(v);
function fixed(value,keys){need(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length);return Object.fromEntries(keys.map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'));return [key,d.value];}));}
function capture(file,max=16*1024*1024){
 need(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&fs.realpathSync(file)===file);
 let cursor='/';for(const part of file.slice(1).split('/')){cursor=path.join(cursor,part);need(!fs.lstatSync(cursor).isSymbolicLink());}
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const a=fs.fstatSync(fd,{bigint:true});need(a.isFile()&&a.size<=BigInt(max)&&a.uid===BigInt(file==='/usr/bin/security'?0:process.getuid())&&(a.mode&0o022n)===0n);
  const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd,{bigint:true}),c=fs.lstatSync(file,{bigint:true});const identity=Object.fromEntries(['dev','ino','size','mode','uid','gid','mtimeNs','ctimeNs'].map(k=>[k,String(a[k])]));
  need(bytes.length===Number(a.size)&&Object.keys(identity).every(k=>String(b[k])===identity[k]&&String(c[k])===identity[k]));return {sha256:hash(bytes),identity,bytes};
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function directory(file,empty=false){need(typeof file==='string'&&file.startsWith('/private/tmp/')&&file.length<70&&fs.realpathSync(file)===file);const s=fs.lstatSync(file);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700&&(!empty||fs.readdirSync(file).length===0));return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,s[k]]));}
function writeNew(root,name,value){need(path.basename(name)===name);const file=path.join(root,name),bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value)+'\n');const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(root,fs.constants.O_RDONLY);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return {file,sha256:hash(bytes),bytes:bytes.length};}
function writeNativeTask16CashRecoveryIdentity(root,input){
 const {runId,candidateSha,planSha256,identity,projectId,paymentId,requestKey}=fixed(input,['runId','candidateSha','planSha256','identity','projectId','paymentId','requestKey']);
 const db=fixed(identity,['databaseOid','systemIdentifier']);
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
 need(uuid(runId)&&uuid(projectId)&&uuid(paymentId)&&uuid(requestKey)&&hex(candidateSha,40)&&hex(planSha256,64)&&/^[1-9][0-9]{0,9}$/u.test(db.databaseOid)&&/^[1-9][0-9]{0,19}$/u.test(db.systemIdentifier),'NATIVE_DIRECT_CASH_RECOVERY_IDENTITY');
 return writeNew(root,'cash-recovery-identity.json',{schemaVersion:1,purpose:CASH_PURPOSE,caseId:'registered.public-cash.payment',candidateSha,planSha256,runId,databaseOid:db.databaseOid,systemIdentifier:db.systemIdentifier,requestKeySha256:hash(Buffer.from(requestKey)),projectIdSha256:hash(Buffer.from(projectId)),paymentIdSha256:hash(Buffer.from(paymentId))});
}
// Production runner uses this same ordered barrier: no cash case can begin
// until the same-run, hash-only observation has been durably published.
async function runNativeTask16CashPreparedCase(root,plan,identity,fixturePlan,prepared,receipt,verifyIdentity,needLive,enter,runCase){
 await verifyIdentity();needLive();
 receipt.cashRecoveryIdentity=writeNativeTask16CashRecoveryIdentity(root,{runId:plan.runId,candidateSha:plan.source.head,planSha256:receipt.planSha256,identity:{databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier},projectId:fixturePlan.ids.project,paymentId:fixturePlan.ids.payment,requestKey:prepared.contender.requestKey});
 needLive();receipt.cashRegistrationHttp={status:'UNKNOWN'};enter('CASH_PAYMENT_AND_OBSERVER');
 return await runCase();
}
async function runNativeTask16LedgerCompetitionPrepared(root,plan,identity,fixturePlan,prepared,receipt,verifyIdentity,needLive,enter,runCase){
 await verifyIdentity();needLive();
 const keys=[fixturePlan.ids.requestKey,prepared.contender.requestKey];
 need(keys.every(key=>typeof key==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(key))&&keys[0]!==keys[1]&&hex(plan.source.head,40)&&hex(receipt.planSha256,64),'NATIVE_DIRECT_LEDGER_RECOVERY_IDENTITY');
 receipt.ledgerCompetitionRecoveryIdentity=writeNew(root,'ledger-competition-recovery-identity.json',{
  schemaVersion:1,purpose:LEDGER_COMPETITION_PURPOSE,candidateSha:plan.source.head,planSha256:receipt.planSha256,runId:plan.runId,
  databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,
  projectIdSha256:hash(Buffer.from(fixturePlan.ids.project)),paymentIdSha256:hash(Buffer.from(fixturePlan.ids.payment)),requestKeySha256:keys.map(key=>hash(Buffer.from(key)))
 });
 needLive();receipt.ledgerCompetitionOutcome='UNKNOWN';enter('LEDGER_COMPETITION_RACE_AND_OBSERVER');return await runCase();
}
function recordNativeTask16CashRegistrationStatus(root,receipt,status){
 if(receipt.cashRegistrationHttp?.status!=='UNKNOWN'||!Number.isInteger(status)||status<100||status>599)return;
 receipt.cashRegistrationHttp={status};
 try{receipt.cashRegistrationResponse=writeNew(root,'cash-registration-response.json',{schemaVersion:1,recoveryIdentitySha256:receipt.cashRecoveryIdentity.sha256,httpStatus:status});}
 catch{receipt.cashRegistrationResponsePublication='UNKNOWN';}
}
function git(args){return execFileSync('/usr/bin/git',args,{cwd:ROOT,encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:10000,maxBuffer:4*1024*1024}).trim();}
function sourceCapture(){
 need(git(['status','--porcelain'])==='','NATIVE_DIRECT_SOURCE_DIRTY');
 const head=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
 const files=git(['ls-files','-z']).split('\0').filter(Boolean).map(relative=>({relative,...capture(path.join(ROOT,relative))})).map(({relative,sha256})=>({relative,sha256}));
 const migrationFiles=files.filter(row=>/^services\/api\/prisma\/migrations\/\d{14}_[a-z0-9_]+\/migration.sql$/u.test(row.relative));need(migrationFiles.length===261);
 const code={candidateSha:head,sealSha256:hash(Buffer.from(JSON.stringify(files))),schemaSha256:capture(path.join(__dirname,'schema.prisma')).sha256,migrations:migrationFiles.map(row=>({path:row.relative,sha256:row.sha256}))};
 const profile=require('./task16-current259-profile.cjs').qualifyCurrent259Source(code);
 return {head,tree,files,code,witness:{candidateSha:head,sourceSealSha256:code.sealSha256,profile}};
}
function treeFiles(root,allowed=root){
 const result=[],visited=new Set();
 const visit=dir=>{const real=fs.realpathSync(dir);need(real===allowed||real.startsWith(allowed+'/'));if(visited.has(real))return;visited.add(real);
  for(const row of fs.readdirSync(real,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const lexical=path.join(real,row.name);let file=lexical;
   if(row.isSymbolicLink()){file=fs.realpathSync(lexical);need(file===allowed||file.startsWith(allowed+'/'));const st=fs.lstatSync(lexical,{bigint:true});result.push({link:lexical,target:fs.readlinkSync(lexical),identity:Object.fromEntries(['dev','ino','mode','uid','gid','mtimeNs','ctimeNs'].map(k=>[k,String(st[k])]))});}
   const stat=fs.lstatSync(file);if(stat.isDirectory())visit(file);else {need(stat.isFile());const c=capture(file,64*1024*1024);result.push({file,sha256:c.sha256,identity:c.identity});}
  }
 };visit(root);return result;
}
function dependencyDigest(){const rows=['node_modules','services/api/node_modules','packages/shared-domain/node_modules'].flatMap(relative=>treeFiles(path.join(ROOT,relative),ROOT));return {sha256:hash(Buffer.from(JSON.stringify(rows))),entries:rows.length};}
function compiledMaterials(){return [...treeFiles(path.join(ROOT,'services/api/dist')),...treeFiles(path.join(ROOT,'packages/shared-domain/dist'))];}

function validateNativePlan(value){
 const p=fixed(value,['schemaVersion','purpose','runId','database','runRoot','rootIdentity','source','artifacts','dependencies','prismaTools','interfaces','binaryManifest','binaries','openssl','externalLibraries','node','security','limits','differences']);
 need(p.schemaVersion===2&&[PURPOSE,GAP_PURPOSE,SOURCE_PURPOSE,VOUCHER_PURPOSE,CASH_PURPOSE,LEDGER_COMPETITION_PURPOSE,LEDGER_CANCEL_PURPOSE,REVOCATION_PURPOSE,DISABLED_PURPOSE,LEDGER_LOSS_PURPOSE].includes(p.purpose)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(p.runId)&&p.database==='jg_task01_'+p.runId.replaceAll('-',''));
 need(equal(fixed(p.limits,['resourceMs','migrationMs','ownerSqlMs','httpMs','commandBytes','ownerSqlBytes']),{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216}));
 need(equal(directory(p.runRoot),p.rootIdentity));return p;
}
function prepareNativeTask16Plan(options,purpose=PURPOSE){
 nativeTask16CaseSelection(purpose);
 need(process.version==='v20.20.2'&&process.platform==='darwin'&&process.arch==='arm64','NATIVE_DIRECT_RUNTIME');
 const o=fixed(options,['runRoot','binaryManifest','binaryManifestSha256','output']);directory(o.runRoot,true);need(path.dirname(o.output)===o.runRoot&&path.basename(o.output)==='plan.json'&&hex(o.binaryManifestSha256,64));
 need(o.binaryManifestSha256===BINARY_QUALIFICATION_SHA,'NATIVE_DIRECT_BINARY_APPROVAL');
 const manifest=capture(o.binaryManifest,1024*1024);need(manifest.sha256===o.binaryManifestSha256);const qualified=JSON.parse(manifest.bytes);
 need(qualified.version==='16.15'&&qualified.versionObserved==='postgres (PostgreSQL) 16.15'&&typeof qualified.privatePrefix==='string');
 const binaries=treeFiles(qualified.privatePrefix);
 for(const [relative,expected]of Object.entries(qualified.files??{})){const actual=binaries.find(row=>row.file===path.join(qualified.privatePrefix,relative));need(actual&&actual.sha256===expected.sha256&&Number(actual.identity.size)===expected.bytes&&nativeTask16QualifiedModeMatches(actual.identity.mode,expected.mode)&&['dev','ino','uid','gid','mtimeNs','ctimeNs'].every(key=>actual.identity[key]===String(expected[key])),'NATIVE_DIRECT_BINARY_QUALIFICATION');}
 need(binaries.some(row=>row.file?.endsWith('/lib/postgresql/pgcrypto.dylib'))&&binaries.some(row=>row.file?.endsWith('/share/postgresql/extension/pgcrypto.control')),'NATIVE_DIRECT_PGCRYPTO_REQUIRED');
 const required=['postgres','initdb','pg_isready','psql'];need(required.every(name=>binaries.some(row=>row.file===path.join(qualified.privatePrefix,'bin',name))));
 const opensslFile=fs.realpathSync('/opt/homebrew/opt/openssl@3/bin/openssl'),openssl=capture(opensslFile,64*1024*1024);
 const externalLibraries=Object.entries(qualified.externalLibraries??{}).map(([file,expected])=>{const actual=capture(file,64*1024*1024);need(actual.sha256===expected.sha256&&Number(actual.identity.size)===expected.bytes&&nativeTask16QualifiedModeMatches(actual.identity.mode,expected.mode)&&['dev','ino','uid','gid','mtimeNs','ctimeNs'].every(key=>actual.identity[key]===String(expected[key])),'NATIVE_DIRECT_EXTERNAL_LIBRARY');return {file,sha256:actual.sha256,identity:actual.identity};});need(externalLibraries.length===2,'NATIVE_DIRECT_EXTERNAL_LIBRARY');
 const prismaTools=resolveNativeTask16PrismaTools(),interfaces=resolveNativeTask16Interfaces(purpose);
 const nodeFile=fs.realpathSync(process.execPath),nodeCapture=capture(nodeFile,128*1024*1024);
 const runId=randomUUID(),p={schemaVersion:2,purpose,runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:o.runRoot,rootIdentity:directory(o.runRoot),source:sourceCapture(),artifacts:compiledMaterials(),dependencies:dependencyDigest(),prismaTools,interfaces,binaryManifest:{file:o.binaryManifest,sha256:manifest.sha256,identity:manifest.identity},binaries,openssl:{file:opensslFile,sha256:openssl.sha256,identity:openssl.identity},externalLibraries,node:{file:nodeFile,sha256:nodeCapture.sha256,identity:nodeCapture.identity,version:process.version,platform:process.platform,arch:process.arch},security:captureNativeTask16Security(),limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},differences:['V2 controlled name policy evidence; SDK direct cause remains unproven','macOS native PG16.15/OpenSSL3/C locale/noICU','Production function reader; no F object-reader private lease wrapper','No Docker CPU/memory/pids/tmpfs enforcement equivalent']};
 validateNativePlan(p);return writeNew(o.runRoot,'plan.json',p);
}
function verifyNativeTask16Plan(file,expected,purpose=PURPOSE){
 nativeTask16CaseSelection(purpose);
 need(process.version==='v20.20.2'&&process.platform==='darwin'&&process.arch==='arm64','NATIVE_DIRECT_RUNTIME');
 need(hex(expected,64));const saved=capture(file,4*1024*1024);need(saved.sha256===expected);const p=validateNativePlan(JSON.parse(saved.bytes));need(p.purpose===purpose,'NATIVE_DIRECT_CASE_PURPOSE');
 need(file===path.join(p.runRoot,'plan.json')&&equal(sourceCapture(),p.source),'NATIVE_DIRECT_SOURCE_CHANGED');
 need(p.binaryManifest.sha256===BINARY_QUALIFICATION_SHA,'NATIVE_DIRECT_BINARY_APPROVAL');
 const qualified=JSON.parse(capture(p.binaryManifest.file,1024*1024).bytes);need(qualified.version==='16.15'&&qualified.versionObserved==='postgres (PostgreSQL) 16.15'&&equal(treeFiles(qualified.privatePrefix),p.binaries),'NATIVE_DIRECT_BINARY_APPROVAL');
 need(equal(compiledMaterials(),p.artifacts)&&equal(dependencyDigest(),p.dependencies),'NATIVE_DIRECT_MATERIAL_CHANGED');
 need(equal(captureNativeTask16Security(),p.security),'NATIVE_DIRECT_SECURITY_CHANGED');
 need(equal(resolveNativeTask16PrismaTools(),p.prismaTools)&&equal(resolveNativeTask16Interfaces(purpose),p.interfaces),'NATIVE_DIRECT_PRISMA_OR_INTERFACE_CHANGED');
 for(const row of [...p.binaries,p.openssl,...p.externalLibraries,p.binaryManifest,p.node]){if(row.link){need(fs.readlinkSync(row.link)===row.target,'NATIVE_DIRECT_MATERIAL_CHANGED');continue;}const now=capture(row.file,128*1024*1024);need(now.sha256===row.sha256&&equal(now.identity,row.identity),'NATIVE_DIRECT_MATERIAL_CHANGED');}
 need(p.node.file===fs.realpathSync(process.execPath)&&p.node.version===process.version&&p.node.platform===process.platform&&p.node.arch===process.arch,'NATIVE_DIRECT_RUNTIME');return p;
}
function parse(args){
 need(Array.isArray(args)&&args.every(x=>typeof x==='string'),'NATIVE_DIRECT_ARGUMENTS');
 if(['--prepare','--prepare-gap','--prepare-source-insufficient','--prepare-voucher','--prepare-cash','--prepare-ledger-competition','--prepare-ledger-cancel','--prepare-revocation','--prepare-disabled','--prepare-ledger-loss'].includes(args[0])&&args.length===9&&args[1]==='--run-root'&&args[3]==='--binary-manifest'&&args[5]==='--expected-binary-sha256'&&args[7]==='--output')return {mode:'prepare',purpose:args[0]==='--prepare-ledger-loss'?LEDGER_LOSS_PURPOSE:args[0]==='--prepare-disabled'?DISABLED_PURPOSE:args[0]==='--prepare-ledger-cancel'?LEDGER_CANCEL_PURPOSE:args[0]==='--prepare-ledger-competition'?LEDGER_COMPETITION_PURPOSE:args[0]==='--prepare-source-insufficient'?SOURCE_PURPOSE:args[0]==='--prepare-revocation'?REVOCATION_PURPOSE:args[0]==='--prepare-gap'?GAP_PURPOSE:args[0]==='--prepare-voucher'?VOUCHER_PURPOSE:args[0]==='--prepare-cash'?CASH_PURPOSE:PURPOSE,options:{runRoot:args[2],binaryManifest:args[4],binaryManifestSha256:args[6],output:args[8]}};
 if(['--verify','--once','--verify-gap','--once-gap','--verify-source-insufficient','--once-source-insufficient','--verify-voucher','--once-voucher','--verify-cash','--once-cash','--verify-ledger-competition','--once-ledger-competition','--verify-ledger-cancel','--once-ledger-cancel','--verify-revocation','--once-revocation','--verify-disabled','--once-disabled','--verify-ledger-loss','--once-ledger-loss'].includes(args[0])&&args.length===5&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256')return {mode:args[0].slice(2).replace(/-(?:gap|voucher|cash|revocation|disabled|source-insufficient|ledger-competition|ledger-cancel|ledger-loss)$/u,''),purpose:args[0].endsWith('-ledger-loss')?LEDGER_LOSS_PURPOSE:args[0].endsWith('-disabled')?DISABLED_PURPOSE:args[0].endsWith('-ledger-cancel')?LEDGER_CANCEL_PURPOSE:args[0].endsWith('-ledger-competition')?LEDGER_COMPETITION_PURPOSE:args[0].endsWith('-source-insufficient')?SOURCE_PURPOSE:args[0].endsWith('-revocation')?REVOCATION_PURPOSE:args[0].endsWith('-gap')?GAP_PURPOSE:args[0].endsWith('-voucher')?VOUCHER_PURPOSE:args[0].endsWith('-cash')?CASH_PURPOSE:PURPOSE,file:args[2],sha256:args[4]};
 fail('NATIVE_DIRECT_ARGUMENTS');
}
function recordNativeTask16CashSecretCleanup(receipt,state,pending){
 need(receipt&&state&&['NOT_STARTED','PENDING','CLEARED','UNKNOWN'].includes(state.cleanup)&&Number.isSafeInteger(pending)&&pending>=0,'NATIVE_DIRECT_CASH_SECRET_STATUS');
 const status=pending>0||state.cleanup==='PENDING'||!state.complete&&state.cleanup!=='NOT_STARTED'?'UNKNOWN':state.cleanup;
 if(receipt.cashSecretCleanup!=='UNKNOWN')receipt.cashSecretCleanup=status;
}
async function runNativeTask16CashScope(scope,owner,identity,check,state,run){
 try{return await scope(owner,identity,check,run,state);}finally{state.complete=true;}
}
function waitNativeTask16Operation(operation,signal,onLate){
 return new Promise((resolve,reject)=>{
  let finished=false;const aborted=()=>{if(!finished){finished=true;reject(Object.assign(new Error('NATIVE_DIRECT_DEADLINE'),{code:'NATIVE_DIRECT_DEADLINE'}));}};
  try{need(typeof operation==='function'&&signal&&!types.isProxy(signal)&&Object.getPrototypeOf(signal)===AbortSignal.prototype);if(signal.aborted){aborted();return;}signal.addEventListener('abort',aborted,{once:true});
   Promise.resolve(operation()).then(value=>{signal.removeEventListener('abort',aborted);if(finished){if(onLate)Promise.resolve().then(()=>onLate(value)).catch(()=>{});return;}finished=true;resolve(value);},error=>{signal.removeEventListener('abort',aborted);if(!finished){finished=true;reject(error);}});
  }catch(error){signal?.removeEventListener?.('abort',aborted);if(!finished){finished=true;reject(error);}}
 });
}
function nativeDirectoryBytes(root){let bytes=0,count=0;const visit=dir=>{for(const row of fs.readdirSync(dir,{withFileTypes:true})){need(++count<=10000,'NATIVE_DIRECT_DIRECTORY_COUNT');const file=path.join(dir,row.name),st=fs.lstatSync(file);need(!st.isSymbolicLink(),'NATIVE_DIRECT_DIRECTORY_LINK');if(st.isDirectory())visit(file);else if(st.isFile())bytes+=st.size;need(bytes<=512*1024*1024,'NATIVE_DIRECT_DIRECTORY_BYTES');}};visit(root);return bytes;}
function trackNativeTask16Child(child){
 const {ChildProcess}=require('node:child_process');need(child instanceof ChildProcess&&!types.isProxy(child)&&Number.isSafeInteger(child.pid)&&child.pid>0,'NATIVE_DIRECT_CHILD');
 const pid=child.pid,kill=child.kill;let exited=child.exitCode!==null||child.signalCode!==null;
 const terminal=new Promise(resolve=>{if(exited)resolve();else {child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});}});
 const running=()=>!exited&&child.pid===pid&&child.kill===kill&&child.exitCode===null&&child.signalCode===null;
 return Object.freeze({pid,terminal,running,stop(){need(running(),'NATIVE_DIRECT_CHILD_CHANGED');need(kill.call(child,'SIGINT'),'NATIVE_DIRECT_PG_STOP');}});
}
function captureNativeTask16Security(){
 const file='/usr/bin/security',row=capture(file,16*1024*1024);need(row.identity.uid==='0'&&(Number(row.identity.mode)&0o111)!==0,'NATIVE_DIRECT_SECURITY');return Object.freeze({file,sha256:row.sha256,identity:row.identity});
}
function projectNativeTask16SecurityPolicy(value){
 const row=fixed(value,['code','stdout','stderr']);need(Number.isInteger(row.code)&&typeof row.stdout==='string'&&typeof row.stderr==='string'&&Buffer.byteLength(row.stdout)+Buffer.byteLength(row.stderr)<=1048576,'NATIVE_DIRECT_POLICY_OUTPUT');
 const text=row.stdout+'\n'+row.stderr;return Object.freeze({exitCode:row.code,hostnameMismatch:/host name mismatch/iu.test(text),error67602:/(?<![0-9])-67602(?![0-9])/u.test(text)});
}
function controlledNativeTask16NameResult(error,contextJson){
 const unknown=()=>Object.freeze({kind:'UNKNOWN',accepted:false,sdkDirectCause:false});
 try{
  need(typeof contextJson==='string'&&Buffer.byteLength(contextJson)<=8192);const context=fixed(JSON.parse(contextJson),['binding','currentBinding','positiveClientsVerified','onlyHostnameChanged','positivePolicy','negativePolicy']);
  const binding=fixed(context.binding,['runId','port','caSha256','serverSha256','configurationSha256']),current=fixed(context.currentBinding,Object.keys(binding));
  need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(binding.runId)&&Number.isInteger(binding.port)&&binding.port>1024&&binding.port<=65535&&binding.port!==5432&&['caSha256','serverSha256','configurationSha256'].every(key=>hex(binding[key],64))&&equal(binding,current));
  need(context.positiveClientsVerified===true&&context.onlyHostnameChanged===true);
  need(equal(fixed(context.positivePolicy,['exitCode','hostnameMismatch','error67602']),{exitCode:0,hostnameMismatch:false,error67602:false})&&equal(fixed(context.negativePolicy,['exitCode','hostnameMismatch','error67602']),{exitCode:1,hostnameMismatch:true,error67602:true}));
  const words=projectNativeTask16TlsWords(error),strict=classifyNativeTask16TlsFailure(error,'wrong-san');
  need(words.messageState==='BOUNDED_OWN_DATA'&&strict.prismaCode==='P1011'&&words.tokens.tlsConnection&&words.tokens.certificateWasNotTrusted&&!words.tokens.otherIssuerMarker&&!words.tokens.connectionRefused&&!words.tokens.dnsFailure);
  return Object.freeze({kind:'CONTROLLED_NAME_REJECTION_WITH_NATIVE_POLICY',accepted:true,sdkDirectCause:false});
 }catch{return unknown();}
}
function projectNativeTask16TlsWords(error){
 const phrases={certificateWasNotTrusted:['certificate was not trusted'],otherIssuerMarker:['unknownissuer','unknown issuer','unable to get local issuer','unable to verify the first certificate','self signed certificate','self-signed certificate'],tlsConnection:['tls connection'],notValidForName:['notvalidforname'],notValidForNameSpaced:['not valid for name'],hostnameMismatch:['hostname mismatch'],hostnameDoesNotMatch:['hostname does not match'],certificateIsNotValidFor:['certificate is not valid for'],certificateNotValidForName:['certificate not valid for name'],ipAddressMismatch:['ip address mismatch'],certificateVerifyFailed:['certificate verify failed'],issuerMarker:['unknownissuer','unknown issuer','unable to get local issuer','unable to verify the first certificate','self signed certificate','self-signed certificate','certificate was not trusted'],connectionRefused:['connection refused','econnrefused'],dnsFailure:['dns','getaddrinfo','enotfound']};
 let text,messageState='UNKNOWN';
 if(error&&typeof error==='object'&&!types.isProxy(error)){const d=Object.getOwnPropertyDescriptor(error,'message');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&Buffer.byteLength(d.value)<=32768){text=d.value.toLowerCase();messageState='BOUNDED_OWN_DATA';}}
 return Object.freeze({messageState,tokens:Object.freeze(Object.fromEntries(Object.entries(phrases).map(([key,values])=>[key,text!==undefined&&values.some(value=>text.includes(value))])))});
}
function classifyNativeTask16TlsFailure(error,mode,hba){
 need(['wrong-ca','wrong-san','no-tls'].includes(mode),'NATIVE_DIRECT_TLS_MODE');
 const own=key=>{if(!error||typeof error!=='object'||types.isProxy(error))return undefined;const d=Object.getOwnPropertyDescriptor(error,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
 const code=own('errorCode')??own('code'),message=own('message');const text=typeof message==='string'?message.toLowerCase():'';
 const tls=code==='P1011'&&text.includes('tls connection');
 const name=tls&&(text.includes('notvalidforname')||text.includes('not valid for name')||text.includes('hostname mismatch')||text.includes('hostname does not match')||text.includes('certificate is not valid for'));
 const issuer=tls&&(text.includes('unknownissuer')||text.includes('unknown issuer')||text.includes('unable to get local issuer')||text.includes('unable to verify the first certificate')||text.includes('self signed certificate')||text.includes('self-signed certificate')||text.includes('certificate was not trusted'));
 let plaintext=false;if(mode==='no-tls'&&code==='P1010'&&hba&&!types.isProxy(hba)){try{const row=fixed(hba,['family','backendPids','count']);plaintext=row.family==='HBA_PLAINTEXT_REJECT'&&Array.isArray(row.backendPids)&&!types.isProxy(row.backendPids)&&Number.isInteger(row.count)&&row.count>0&&row.count<=16&&row.backendPids.length===row.count&&Array.from({length:row.count},(_,i)=>Object.getOwnPropertyDescriptor(row.backendPids,String(i))?.value).every(pid=>Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647);}catch{/* Unknown HBA data grants no negative proof. */}}
 const accepted=mode==='no-tls'?plaintext:mode==='wrong-san'?name:issuer;
 return Object.freeze({prismaCode:typeof code==='string'&&/^P[0-9]{4}$/u.test(code)?code:null,kind:mode==='wrong-san'&&name?'CERTIFICATE_NAME_REJECTED':mode==='wrong-ca'&&issuer?'CERTIFICATE_ISSUER_REJECTED':mode==='no-tls'&&plaintext?'PLAINTEXT_HBA_REJECTED':'UNKNOWN',accepted});
}
function verifyNativeTask16LocalhostAnswers(answers){
 need(Array.isArray(answers)&&!types.isProxy(answers),'NATIVE_DIRECT_LOCALHOST');const length=Object.getOwnPropertyDescriptor(answers,'length')?.value;need(Number.isInteger(length)&&length>0&&length<=16,'NATIVE_DIRECT_LOCALHOST');
 return Object.freeze(Array.from({length},(_,index)=>{const d=Object.getOwnPropertyDescriptor(answers,String(index));need(d&&Object.hasOwn(d,'value'),'NATIVE_DIRECT_LOCALHOST');const row=fixed(d.value,['address','family']);need(row.address==='127.0.0.1'&&row.family===4||row.address==='::1'&&row.family===6,'NATIVE_DIRECT_LOCALHOST');return Object.freeze(row);}));
}
function projectNativeTask16PlaintextHba(text,database){
 need(typeof text==='string'&&Buffer.byteLength(text)<=65536&&typeof database==='string'&&/^jg_task01_[a-f0-9]{32}$/u.test(database),'NATIVE_DIRECT_HBA_INPUT');
 const suffix=' FATAL:  pg_hba.conf rejects connection for host "127.0.0.1", user "jg_task01_runtime", database "'+database+'", no encryption';
 const pids=[];for(const line of text.split('\n')){const match=/^NATIVE_TASK16 \[([1-9][0-9]{0,9})\]/u.exec(line);if(match&&line==='NATIVE_TASK16 ['+match[1]+']'+suffix){const pid=Number(match[1]);need(pid<=2147483647,'NATIVE_DIRECT_HBA_INPUT');pids.push(pid);}}
 need(pids.length<=16,'NATIVE_DIRECT_HBA_INPUT');return pids.length?Object.freeze({family:'HBA_PLAINTEXT_REJECT',backendPids:Object.freeze(pids),count:pids.length}):undefined;
}
function nativeTask16QualifiedModeMatches(observed,declared){return typeof observed==='string'&&/^[0-9]+$/u.test(observed)&&Number.isInteger(declared)&&declared>=0&&declared<=511&&(BigInt(observed)&0o170000n)===0o100000n&&Number(BigInt(observed)&0o777n)===declared;}
function assertNativeTask16LogIdentity(fd,expected,namedPath){
 need(Number.isInteger(fd)&&fd>=0,'NATIVE_DIRECT_LOG_WINDOW');const stat=fs.fstatSync(fd,{bigint:true});need(stat.isFile()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o777n)===0o600n,'NATIVE_DIRECT_LOG_WINDOW');
 const identity=Object.freeze(Object.fromEntries(['dev','ino','mode','uid','gid'].map(key=>[key,String(stat[key])])));if(expected)need(equal(identity,expected),'NATIVE_DIRECT_LOG_WINDOW');if(namedPath!==undefined){need(typeof namedPath==='string'&&path.basename(namedPath)==='postgres.log','NATIVE_DIRECT_LOG_WINDOW');const named=fs.lstatSync(namedPath,{bigint:true});need(named.isFile()&&!named.isSymbolicLink()&&Object.keys(identity).every(key=>String(named[key])===identity[key]),'NATIVE_DIRECT_LOG_WINDOW');}return identity;
}
function nativeTask16FixtureDates(now){need(typeof now==='number'&&Number.isFinite(now)&&Number.isFinite(new Date(now+8*3600000).getTime()),'NATIVE_DIRECT_FIXTURE_DATE');const paidAt=new Date(now+8*3600000).toISOString().slice(0,10),openingDate=new Date(Date.parse(paidAt+'T00:00:00.000Z')-86400000).toISOString().slice(0,10);return Object.freeze({paidAt,openingDate});}
function resolveNativeTask16PrismaTools(){
 const cli=fs.realpathSync(require.resolve('prisma/build/index.js'));
 const cliRequire=require('node:module').createRequire(cli),packageFile=fs.realpathSync(cliRequire.resolve('@prisma/engines/package.json'));
 const pkg=capture(packageFile),version=JSON.parse(pkg.bytes).version;need(version==='5.22.0','NATIVE_DIRECT_PRISMA_VERSION');
 const engine=fs.realpathSync(path.join(path.dirname(packageFile),'schema-engine-darwin-arm64'));
 const collect=file=>{need(file.startsWith(ROOT+'/node_modules/')||file.startsWith(ROOT+'/services/api/node_modules/'),'NATIVE_DIRECT_PRISMA_PATH');const row=capture(file,64*1024*1024);return Object.freeze({file,sha256:row.sha256,identity:row.identity});};
 const tools={version,cli:collect(cli),package:collect(packageFile),engine:collect(engine)};need((Number(tools.engine.identity.mode)&0o111)===0o111,'NATIVE_DIRECT_PRISMA_EXECUTABLE');return Object.freeze(tools);
}
function inspectNativeTask16Interfaces(purpose=PURPOSE){
 const selected=nativeTask16CaseSelection(purpose);
 // Fixed source-owned list, matching the original application factory/main.
 // Read exports only: never construct a client, assemble Nest, or call a route.
 const specs=[
  ['./local-staged-migration-controls.cjs',[['inspectSql',0],['setupSql',1],['checkSetup',2],['readbackSql',2],['parseReadback',1],['checkCompletion',3],['cleanupSql',2],['cleanReadSql',2]]],
  ['./local-staged-tail-qualification.cjs',[['createLocalTailQualification',2]]],
  ['./task16-current259-role-provision.cjs',[['renderNativeTask16CompetitionRoleRead',2],['renderNativeTask16CompetitionRoleInstall',3],['parseNativeTask16CompetitionRoleRead',3]]],
  ['./task16-current259-seven-install.cjs',[['renderNativeTask16CompetitionSeven',4],['parseNativeTask16CompetitionSeven',4]]],
  ['./task16-current259-runtime-acl.cjs',[['renderCurrent259CompetitionRuntimeAcl',3]]],
  ['./task16-current259-public-access.cjs',[['renderCurrent259CompetitionPublicAccess',1]]],
  ['./task16-current259-catalog.cjs',[['loadCurrent259CatalogMaterial',2],['renderCurrent259CatalogRead',1],['parseCurrent259CatalogRead',3],['describeNativeTask16CatalogFailure',3],['renderCurrent259B7Install',1]]],
  ['./task16-current259-payment-competition.cjs',[['renderNativeTask16CompetitionHold',0],['renderNativeTask16CompetitionMonitor',1]]],
  ['./task16-current259-session-identity.cjs',[['current259ClientIdentitySql','string']]],
  ['./task16-current261-seed-json.cjs',[['requestCurrent261SeedJson',4]]],
  ['../dist/api-security.js',[['configureApiSecurity',1]]],
  ['../dist/operating-projection/projection-export-json.js',[['configureProjectionExportJson',1]]],
  ['../dist/api-json-replacer.js',[['apiJsonReplacer',2]]],
  ['../dist/validation/api-validation.js',[['createApiValidationPipe',0]]],
  ['../dist/api-listen.js',[['listenApi',3]]],
  ['../dist/database/prisma.service.js',[['PrismaService',0]]],
  ['../dist/database/task16-registered-application.module.js',[['Task16RegisteredApplicationModule',0],['Task16ImpactReaderToken','symbol']]],
  ['../dist/payment/registered-payment-impact-reader.js',[['readTask16RegisteredPaymentImpacts',3]]],
  ['../dist/database/registered-payment-postgres.fixture.js',[['buildRegisteredPgFixturePlan',3],['seedRegisteredPgCompetitionFollowUpFixture',5],['assertRegisteredPgCompetitionRoles',3]]],
  ['../dist/database/registered-payment-postgres.cases.js',[['runRegisteredTwoActorPaymentCompetitionFollowUp',4]]],
  ['@prisma/client',[['PrismaClient',1]]],
  ['@nestjs/testing/test.js',[['Test',0]]],
  ['@nestjs/testing',[['Test',0]]]
 ];
 if(selected.cash||selected.ledgerCompetition||selected.ledgerCancel){
  const replacements={
   './task16-current259-seven-install.cjs':[['renderNativeTask16CashSeven',4],['parseNativeTask16CashSeven',4]],
   '../dist/database/registered-payment-postgres.fixture.js':[['buildRegisteredPgFixturePlan',3],['seedRegisteredPgPublicCashFormalFixture',5],['assertRegisteredPgCompetitionRoles',3]],
   '../dist/database/registered-payment-postgres.cases.js':[[selected.ledgerCancel?'runRegisteredLedgerPaymentCancellation':selected.ledgerCompetition?'runRegisteredLedgerPaymentCompetition':'runRegisteredPublicCashPayment',selected.ledgerCancel?5:4]]
  };
  for(let i=0;i<specs.length;i++)if(replacements[specs[i][0]])specs[i]=[specs[i][0],replacements[specs[i][0]]];
  if(selected.ledgerCompetition)specs.push(['../dist/database/registered-payment-ledger-competition-observer.js',[['readLedgerCompetitionPaymentInTransaction',2]]]);
  if(selected.ledgerCancel)specs.push(['./run-task16-native-cancel-once.cjs',[['runNativeTask16CancelPreparedCase',8],['createNativeCancelBodyBinding',3],['executeNativeA16CancelCase',1]]],['./task16-native-a16-cancel-transport.cjs',[['createNativeA16CancelTransport',1]]],['./task16-native-a16-cancel-fault.cjs',[['createNativeLedgerA16CancelFault',1],['runNativeA16Cancellation',4]]],['../dist/database/registered-payment-public-cash-prerequisite.js',[['readCashSettlementPrerequisiteInTransaction',2]]]);

  specs.push(['../dist/database/registered-payment-public-cash-secret.js',[['withCashLedgerSecret',4]]]);
  specs.push(['../dist/database/registered-payment-public-cash-prerequisite.js',[['readCashSettlementPrerequisite',2]]]);
 }
 if(selected.revocation)specs.push(['../dist/database/task16-revocation-application.module.js',[['Task16RevocationApplicationModule',0]]],['./task16-native-voucher-revocation.cjs',[['readVoucherFundingSnapshot',1],['seedNativeVoucherRevocationReader',1],['prepareNativeVoucherForRevocation',1],['runNativeVoucherRevocation',1]]],['../dist/payment/payment-request.service.js',[['PaymentRequestService','function']]],['../dist/file/file.service.js',[['FileService','function']]]);
 if(selected.ledgerLoss)specs.push(['./run-task16-native-response-loss-once.cjs',[['runNativeTask16ResponseLossPreparedCase',8],['createNativeResponseLossBodyBinding',3]]],['./task16-native-response-loss-transport.cjs',[['createNativeResponseLossTransport',1]]],['./task16-ledger-loss-flow.cjs',[['runLedgerLossFlow',1]]],['../dist/database/registered-payment-postgres.cases.js',[['runRegisteredLedgerResponseLoss',4]]]);
 if(selected.disabled)specs.push(['./task16-native-voucher-revocation.cjs',[['runNativeVoucherDisabled',1]]]);
 if(selected.voucher){
  specs.push(['./task16-native-voucher-roster-query.cjs',[['projectNativeTask16RosterQuery',3],['nativeTask16VoucherQueryLogOptions',2],['createNativeTask16RosterQueryDiagnostic',2]]]);
  const replacements={
   './task16-current259-seven-install.cjs':[['renderNativeTask16VoucherSeven',4],['parseNativeTask16VoucherSeven',4],['renderNativeTask16VoucherSevenPreimage',3]],
   './task16-current259-runtime-acl.cjs':[['renderCurrent259VoucherRuntimeAcl',3]],
   './task16-current259-payment-competition.cjs':[['renderNativeTask16CompetitionHold',0],['renderNativeTask16CompetitionMonitor',1],['supplementNativeTask16CompetitionVoucher',1]],
   '../dist/database/registered-payment-postgres.fixture.js':[['buildRegisteredPgFixturePlan',3],['seedRegisteredPgCompetitionFixture',5],['assertRegisteredPgCompetitionRoles',3]],
   '../dist/database/registered-payment-postgres.cases.js':[['runRegisteredTwoActorPaymentCompetition',4],['observeRegisteredPaymentVoucherLedger',3]]
  };
  if(selected.revocation)replacements['./task16-current259-seven-install.cjs']=[['renderNativeTask16RevocationSeven',4],['parseNativeTask16RevocationSeven',4],['renderNativeTask16RevocationSevenPreimage',3]];
  for(let i=0;i<specs.length;i++)if(replacements[specs[i][0]])specs[i]=[specs[i][0],replacements[specs[i][0]]];
 }
 if(!selected.competition){
  const replacements={
   './task16-current259-role-provision.cjs':[['renderNativeTask16RoleRead',2],['renderNativeTask16RoleInstall',3],['parseNativeTask16RoleRead',3]],
   './task16-current259-seven-install.cjs':[['renderNativeTask16GapSeven',4],['parseNativeTask16GapSeven',4]],
   './task16-current259-runtime-acl.cjs':[['renderCurrent259RuntimeAcl',3]],
   './task16-current259-public-access.cjs':[['renderCurrent259PublicAccess',1]],
   '../dist/database/registered-payment-postgres.fixture.js':[['buildRegisteredPgFixturePlan',3],['seedRegisteredPgAttributionGapFixture',3],['assertRegisteredPgConnectedRoles',2]],
   '../dist/database/registered-payment-postgres.cases.js':[[selected.sourceInsufficient?'runRegisteredProjectSourceInsufficient':'runRegisteredProjectAttributionGap',3]]
  };
  for(let i=specs.length-1;i>=0;i--){if(specs[i][0]==='./task16-current259-payment-competition.cjs')specs.splice(i,1);else if(replacements[specs[i][0]])specs[i]=[specs[i][0],replacements[specs[i][0]]];}
 }
 return Object.freeze(specs.map(([specifier,exports])=>{
  const file=fs.realpathSync(require.resolve(specifier));need(file.startsWith(ROOT+'/'),'NATIVE_DIRECT_INTERFACE_PATH');const before=capture(file,64*1024*1024),loaded=require(specifier);
  const shapes=exports.map(([name,expected])=>{const d=Object.getOwnPropertyDescriptor(loaded,name);need(d,'NATIVE_DIRECT_INTERFACE_EXPORT');let value;if(Object.hasOwn(d,'value'))value=d.value;else {need(specifier==='@nestjs/testing'&&name==='Test'&&typeof d.get==='function'&&d.set===undefined,'NATIVE_DIRECT_INTERFACE_EXPORT');value=loaded.Test;need(value===require('@nestjs/testing/test.js').Test,'NATIVE_DIRECT_INTERFACE_EXPORT');}const kind=typeof value;need(typeof expected==='number'?kind==='function'&&value.length===expected:kind===expected,'NATIVE_DIRECT_INTERFACE_EXPORT');
   if(name==='Test'){const method=Object.getOwnPropertyDescriptor(value,'createTestingModule');need(method&&Object.hasOwn(method,'value')&&typeof method.value==='function'&&method.value.length===1,'NATIVE_DIRECT_INTERFACE_EXPORT');}
   return Object.freeze({name,kind,...(kind==='function'?{arity:value.length}:{})});});
  const after=capture(file,64*1024*1024);need(before.sha256===after.sha256&&equal(before.identity,after.identity),'NATIVE_DIRECT_INTERFACE_CHANGED');return Object.freeze({file,sha256:after.sha256,identity:after.identity,exports:Object.freeze(shapes)});
 }));
}
function resolveNativeTask16Interfaces(purpose=PURPOSE){
 nativeTask16CaseSelection(purpose);
 // Discard qualification-only module state in a fixed read-only child. Actual
 // business still sets its real temporary environment before importing Nest.
 const source='const value=require('+JSON.stringify(__filename)+').inspectNativeTask16Interfaces('+JSON.stringify(purpose)+');process.stdout.write(JSON.stringify(value));';
 let output;try{output=execFileSync(process.execPath,['-e',source],{cwd:ROOT,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC',PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1048576});}catch{fail('NATIVE_DIRECT_INTERFACE_QUALIFICATION');}
 return JSON.parse(output);
}
function parseNativeTask16CatalogRead(stdout,input,prior,receipt){
 const catalog=require('./task16-current259-catalog.cjs');
 try{return catalog.parseCurrent259CatalogRead(stdout,input,prior);}
 catch(error){
  let family='UNKNOWN';try{const result=catalog.describeNativeTask16CatalogFailure(stdout,input,prior);if(result.matched===false)family=result.family;}catch{}
  const phase=input&&!types.isProxy(input)?Object.getOwnPropertyDescriptor(input,'phase')?.value:undefined;
  try{if(receipt&&!types.isProxy(receipt)&&Object.getPrototypeOf(receipt)===Object.prototype)Object.defineProperty(receipt,'catalogReadbackFailure',{value:Object.freeze({phase:['before','staged','committed'].includes(phase)?phase:'UNKNOWN',family}),enumerable:true,configurable:true,writable:true});}catch{}
  throw error;
 }
}
function renderNativeTask16RuntimeAcl(inputJson,nonce){
 need(typeof inputJson==='string'&&Buffer.byteLength(inputJson)<=512*1024,'NATIVE_DIRECT_ACL_ENDPOINT');const value=JSON.parse(inputJson);
 need(value&&Object.keys(value).sort().join(',')==='provisioned,source','NATIVE_DIRECT_ACL_ENDPOINT');const {source,provisioned}=value,id=provisioned?.databaseIdentity;
 const voucher=['TASK16_PAYMENT261_VOUCHER_RUNTIME_V1','TASK16_PAYMENT261_VOUCHER_REVOCATION_RUNTIME_V1'].includes(provisioned?.paymentProfile),competition=voucher||provisioned?.paymentProfile==='TASK16_PAYMENT261_COMPETITION_RUNTIME_V1'||provisioned?.paymentProfile==='TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1';
 need((competition||provisioned?.paymentProfile==='TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1')&&id?.tls===true&&id.clientAddress==='127.0.0.1'&&id.serverAddress==='127.0.0.1'&&Number.isInteger(id.serverPort)&&id.serverPort>1024&&id.serverPort<=65535&&id.serverPort!==5432,'NATIVE_DIRECT_ACL_ENDPOINT');
 if(!competition)need(Array.isArray(provisioned.roles)&&provisioned.roles.find(role=>role.name==='jg_task01_runtime')?.limit===1&&provisioned.roles.find(role=>role.name==='jg_task01_observer')?.limit===1,'NATIVE_DIRECT_GAP_ROLE_LIMIT');
 const acl=require('./task16-current259-runtime-acl.cjs'),rendered=(voucher?acl.renderCurrent259VoucherRuntimeAcl:competition?acl.renderCurrent259CompetitionRuntimeAcl:acl.renderCurrent259RuntimeAcl)(source,provisioned,nonce);
 const original="pg_catalog.host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1'\n    OR pg_catalog.host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'\n    OR inet_server_port() IS DISTINCT FROM 5432";
 const parts=rendered.sql.split(original);
 need(parts.length===2&&(rendered.sql.match(/inet_server_port\(\)/gu)||[]).length===1&&['readbackSql','witnessSql'].every(field=>typeof rendered[field]==='string'&&!rendered[field].includes('inet_server_port(')),'NATIVE_DIRECT_ACL_ENDPOINT_RENDER');
 const sql=parts.join(original.replace('5432',String(id.serverPort)));
 // Match the original payment ACL transaction: runtime ACL, then its public-access closure.
 const publicAccess=require('./task16-current259-public-access.cjs'),publicOriginal=(competition?publicAccess.renderCurrent259CompetitionPublicAccess:publicAccess.renderCurrent259PublicAccess)(provisioned),publicParts=publicOriginal.split(original);
 need(publicParts.length===2&&(publicOriginal.match(/inet_server_port\(\)/gu)||[]).length===1,'NATIVE_DIRECT_PUBLIC_ENDPOINT_RENDER');
 const publicSql=publicParts.join(original.replace('5432',String(id.serverPort)));
 return Object.freeze({...rendered,sql,publicSql,writeSql:sql+'\n'+publicSql});
}
function assertNativeTask16CompetitionLoopbackListeners(text,postmasterPid,port){
 const code='NATIVE_DIRECT_LOOPBACK_LISTENERS';
 need(arguments.length===3&&typeof text==='string'&&Buffer.byteLength(text)<=1048576&&Number.isSafeInteger(postmasterPid)&&postmasterPid>0&&postmasterPid<=2147483647&&Number.isInteger(port)&&port>1024&&port<=65535&&port!==5432,code);
 const addresses=[];
 for(const line of text.split('\n')){
  const match=/^NATIVE_TASK16 \[([1-9][0-9]{0,9})\] LOG:  listening on (IPv4|IPv6) address "([^"]+)", port ([1-9][0-9]{0,4})$/u.exec(line);
  if(!match)continue;
  need(Number(match[1])===postmasterPid&&Number(match[4])===port&&((match[2]==='IPv4'&&match[3]==='127.0.0.1')||(match[2]==='IPv6'&&match[3]==='::1'))&&!addresses.includes(match[3]),code);
  addresses.push(match[3]);
 }
 need(addresses.length===2&&addresses.includes('127.0.0.1')&&addresses.includes('::1'),code);
 return Object.freeze({postmasterPid,port,addresses:Object.freeze(['127.0.0.1','::1']),ownedStartupListeners:true});
}
module.exports=Object.freeze({writeNativeTask16CashAccounting,writeNativeTask16LedgerCompetitionAccounting,runNativeTask16LedgerCompetitionPrepared,validateNativeTask16LedgerCompetitionAccounting,writeNativeTask16SourceAccounting,nativeTask16RevocationInboundAllowed,assertNativeTask16RevocationTarget,runNativeTask16CashPreparedCase,writeNativeTask16CashRecoveryIdentity,recordNativeTask16CashRegistrationStatus,runNativeTask16CashScope,recordNativeTask16CashSecretCleanup,parseNativeTask16Args:parse,validateNativeTask16CashAccounting,createNativeTask16BusinessClients,createNativeTask16VoucherStageRecorder,writeNativeTask16VoucherAccounting,nativeTask16CaseSelection,writeNativeTask16GapAccounting,assertNativeTask16CompetitionLoopbackListeners,withNativeTask16CompetitionLock,writeNativeTask16CompetitionAccounting,assertNativeTask16CompetitionTarget,captureNativeTask16Security,projectNativeTask16SecurityPolicy,controlledNativeTask16NameResult,projectNativeTask16TlsWords,parseNativeTask16CatalogRead,renderNativeTask16RuntimeAcl,inspectNativeTask16Interfaces,resolveNativeTask16PrismaTools,resolveNativeTask16Interfaces,nativeTask16FixtureDates,nativeTask16QualifiedModeMatches,assertNativeTask16LogIdentity,projectNativeTask16PlaintextHba,verifyNativeTask16LocalhostAnswers,classifyNativeTask16TlsFailure,trackNativeTask16Child,waitNativeTask16Operation,prepareNativeTask16Plan,verifyNativeTask16Plan,validateNativePlan});
if(require.main===module){(async()=>{let request;request=parse(process.argv.slice(2));if(request.mode==='prepare')return {status:'NATIVE_DIRECT_PREPARED_NO_RESOURCES',...prepareNativeTask16Plan(request.options,request.purpose)};
 const plan=verifyNativeTask16Plan(request.file,request.sha256,request.purpose);if(request.mode==='verify')return {status:'NATIVE_DIRECT_VERIFIED_NO_RESOURCES',candidateSha:plan.source.head};
 return await executeNativeTask16Once(plan,request.sha256);
})().then(result=>{process.exitCode=result.status==='STOPPED'?1:0;process.stdout.write(JSON.stringify(result)+'\n',()=>{if(['--once','--once-gap','--once-source-insufficient','--once-voucher','--once-cash','--once-ledger-competition','--once-ledger-cancel','--once-revocation','--once-disabled','--once-ledger-loss'].includes(process.argv[2]))process.exit(process.exitCode);});},error=>{const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:typeof code==='string'&&/^NATIVE_DIRECT_[A-Z_]+$/u.test(code)?code:'NATIVE_DIRECT_INPUT'})+'\n');process.exitCode=1;});}

async function executeNativeTask16Once(plan,planSha256){
 need(require.main===module&&process.execArgv.length===0&&!process._preload_modules?.length&&!Object.hasOwn(process.env,'NODE_OPTIONS')&&!Object.hasOwn(process.env,'NODE_PATH'),'NATIVE_DIRECT_FRESH_MAIN');
 need(equal(fs.readdirSync(plan.runRoot).sort(),['plan.json']),'NATIVE_DIRECT_ROOT_NOT_UNUSED');
 writeNew(plan.runRoot,'started.json',{purpose:plan.purpose,planSha256,candidateSha:plan.source.head,startedAt:new Date().toISOString(),pid:process.pid});
 const {spawn}=require('node:child_process');
 const selection=nativeTask16CaseSelection(plan.purpose);
 const root=plan.runRoot,runId=plan.runId,db=plan.database,prefix=path.dirname(path.dirname(plan.binaries.find(row=>row.file?.endsWith('/bin/postgres')).file));
 const owner='jg_task01_owner',credentials=Object.fromEntries(['owner','runtime','observer'].map(k=>[k,randomBytes(48).toString('hex')]));
 const cashSecretState={cleanup:'NOT_STARTED',complete:false};
 const receipt={schemaVersion:2,purpose:plan.purpose,planSha256,candidateSha:plan.source.head,runId,status:'STOPPED',business:'NOT_ENTERED',stages:[],differences:plan.differences,cleanup:{status:'NOT_NEEDED'},financialAcceptance:false};
 const started=Date.now(),deadline=started+plan.limits.resourceMs;let stage='INIT',closing=false,pending=0,pgStarted=false,pgPid,pgStart,pgChild,pgLifetime,pgLogIdentity,apps=[],moduleRefs=[],restoreEnvironment,clients=[],port,dbReady=false,publicCertificateBinding;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),plan.limits.resourceMs);const onSignal=()=>controller.abort();process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
 const childOwnedAndRunning=()=>pgLifetime?.running()===true;
 const needLive=()=>{need(!closing&&Date.now()<deadline&&!controller.signal.aborted,'NATIVE_DIRECT_DEADLINE');need(equal(directory(root),plan.rootIdentity),'NATIVE_DIRECT_ROOT_CHANGED');for(const row of plan.externalLibraries){const st=fs.lstatSync(row.file,{bigint:true});need(st.isFile()&&Object.keys(row.identity).every(key=>String(st[key])===row.identity[key]),'NATIVE_DIRECT_EXTERNAL_LIBRARY');}if(fs.existsSync(path.join(root,'postgres.log')))need(fs.lstatSync(path.join(root,'postgres.log')).size<=1048576,'NATIVE_DIRECT_LOG_BYTES');if(pgChild)need(childOwnedAndRunning(),'NATIVE_DIRECT_PG_CHANGED');if(pgStarted)need(fs.readFileSync(path.join(root,'data/postmaster.pid'),'utf8').split('\n')[2]===pgStart,'NATIVE_DIRECT_PG_CHANGED');};
 const checkPublicCertificateContext=()=>{needLive();need(publicCertificateBinding&&publicCertificateBinding.length===3,'NATIVE_DIRECT_CERT_CONTEXT');for(const row of publicCertificateBinding){const now=capture(row.file,1048576);need(now.sha256===row.sha256&&equal(now.identity,row.identity),'NATIVE_DIRECT_CERT_CONTEXT');}return Object.freeze({runId,port,caSha256:publicCertificateBinding[0].sha256,serverSha256:publicCertificateBinding[1].sha256,configurationSha256:publicCertificateBinding[2].sha256});};
 const enter=name=>{needLive();stage=name;receipt.stages.push({stage:name,elapsedMs:Date.now()-started});};
 const wait=(operation,onLate)=>waitNativeTask16Operation(()=>{needLive();pending++;return Promise.resolve().then(()=>{needLive();return operation();}).finally(()=>{pending--;});},controller.signal,onLate);
 const cleanupWait=async operation=>{let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('NATIVE_DIRECT_CLOSE_TIMEOUT'),{code:'NATIVE_DIRECT_CLOSE_TIMEOUT'})),5000);})]);}finally{clearTimeout(timer);}};

 const env={PATH:path.join(prefix,'bin')+':'+path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,LC_ALL:'C',LANG:'C',TZ:'UTC',PGCONNECT_TIMEOUT:'5'};
 async function command(file,args,{stdin,timeoutMs=120000,extra={},allowFailure=false,cleanup=false}={}){
  if(!cleanup)needLive();need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=180000);if(stdin!==undefined)need(Buffer.byteLength(stdin)<=plan.limits.ownerSqlBytes,'NATIVE_DIRECT_SQL_BYTES');
  const remaining=cleanup?Math.min(timeoutMs,15000):Math.min(timeoutMs,deadline-Date.now());need(remaining>0,'NATIVE_DIRECT_DEADLINE');
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(file,args,{cwd:root,env:{...env,...extra},stdio:['pipe','pipe','pipe'],detached:false});let count=0,problem,hard,hardReject;const out=[],err=[];
   const stop=code=>{if(problem)return;problem=code;child.kill('SIGTERM');hard=setTimeout(()=>child.kill('SIGKILL'),1000);hardReject=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();reject(Object.assign(new Error('NATIVE_DIRECT_PROCESS_REMAINS'),{code:'NATIVE_DIRECT_PROCESS_REMAINS'}));},5000);};
   const t=setTimeout(()=>stop('NATIVE_DIRECT_COMMAND_TIMEOUT'),remaining);const abort=()=>stop('NATIVE_DIRECT_ABORTED');if(!cleanup)controller.signal.addEventListener('abort',abort,{once:true});
   child.once('error',()=>stop('NATIVE_DIRECT_COMMAND_SPAWN'));child.once('close',code=>{clearTimeout(t);clearTimeout(hard);clearTimeout(hardReject);controller.signal.removeEventListener('abort',abort);if(problem)reject(Object.assign(new Error(problem),{code:problem}));else resolve({code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
   for(const [stream,rows]of [[child.stdout,out],[child.stderr,err]])stream.on('data',bytes=>{count+=bytes.length;if(count>plan.limits.commandBytes)stop('NATIVE_DIRECT_COMMAND_BYTES');else if(!problem)rows.push(Buffer.from(bytes));});
   child.stdin.on('error',()=>{});child.stdin.end(stdin);
  });
  if(!allowFailure)need(result.code===0,'NATIVE_DIRECT_COMMAND_FAILED');return result;
 }
 const bin=name=>path.join(prefix,'bin',name),openssl=(args,options)=>command(plan.openssl.file,args,options);
 const ownerEnv=()=>({PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:owner,PGDATABASE:db,PGPASSWORD:credentials.owner,PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(root,'ca.crt')});
 async function sql(text,{database=db,allowFailure=false,extra={}}={}){need(dbReady||database==='postgres','NATIVE_DIRECT_DATABASE');const r=await command(bin('psql'),['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','--dbname',database],{stdin:"SET log_min_error_statement='panic';SET log_error_verbosity='terse';SET log_parameter_max_length_on_error=0;\n"+text,extra:{...ownerEnv(),...extra},allowFailure,timeoutMs:plan.limits.ownerSqlMs});return r;}
 const jsonSql=async(text,options)=>JSON.parse((await sql(text,options)).stdout.trim());
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 async function connectPort(){return new Promise((resolve,reject)=>{const server=require('node:net').createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value));});});}
 try{
  enter('TLS_AND_INITDB');for(const dir of ['socket','storage','prefixes',...(selection.voucher?['application-private-voucher']:[])])fs.mkdirSync(path.join(root,dir),{mode:0o700});
  for(const name of ['ca','wrong-ca']){await openssl(['req','-new','-newkey','rsa:2048','-nodes','-x509','-sha256','-days','2','-subj','/CN=native-'+name+'-'+runId,'-keyout',path.join(root,name+'.key'),'-out',path.join(root,name+'.crt')]);fs.chmodSync(path.join(root,name+'.key'),0o600);fs.chmodSync(path.join(root,name+'.crt'),0o600);}
  writeNew(root,'server.ext','subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  await openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=native-'+runId,'-keyout',path.join(root,'server.key'),'-out',path.join(root,'server.csr')]);fs.chmodSync(path.join(root,'server.key'),0o600);
  await openssl(['x509','-req','-sha256','-days','2','-in',path.join(root,'server.csr'),'-CA',path.join(root,'ca.crt'),'-CAkey',path.join(root,'ca.key'),'-set_serial','1','-extfile',path.join(root,'server.ext'),'-out',path.join(root,'server.crt')]);fs.chmodSync(path.join(root,'server.crt'),0o600);
  writeNew(root,'initdb.secret',credentials.owner+'\n');
  try{await command(bin('initdb'),['-D',path.join(root,'data'),'-U',owner,'--encoding=UTF8','--locale=C','--auth-local=peer','--auth-host=scram-sha-256','--pwfile',path.join(root,'initdb.secret')]);}finally{fs.unlinkSync(path.join(root,'initdb.secret'));}
  port=await connectPort();need(port>1024&&port!==5432,'NATIVE_DIRECT_PORT');
  const hba=`local all ${owner} peer map=native_owner\nlocal all all reject\nhostnossl all all 127.0.0.1/32 reject\nhostssl all ${owner} 127.0.0.1/32 scram-sha-256\nhostssl ${db} jg_task01_runtime,jg_task01_observer 127.0.0.1/32 scram-sha-256\nhostssl all all 127.0.0.1/32 reject\n`;
  fs.writeFileSync(path.join(root,'data/pg_hba.conf'),hba,{mode:0o600});fs.writeFileSync(path.join(root,'data/pg_ident.conf'),`native_owner ${os.userInfo().username} ${owner}\n`,{mode:0o600});
  const config=`listen_addresses='127.0.0.1,::1'\nport=${port}\nunix_socket_directories='${root}/socket'\nssl=on\nssl_min_protocol_version='TLSv1.2'\nssl_cert_file='${root}/server.crt'\nssl_key_file='${root}/server.key'\npassword_encryption='scram-sha-256'\nmax_connections=16\nshared_buffers='64MB'\nmax_wal_size='64MB'\nmin_wal_size='32MB'\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length_on_error=0\nlog_error_verbosity='terse'\nlog_duration=off\nlog_min_duration_statement=-1\nlog_min_duration_sample=-1\nlog_transaction_sample_rate=0\nlogging_collector=off\nlog_destination='stderr'\nlog_line_prefix='NATIVE_TASK16 [%p] '\nlc_messages='C'\nstatement_timeout='60s'\n`;
  fs.writeFileSync(path.join(root,'data/postgresql.conf'),config,{mode:0o600});writeNew(root,'postgres.log','');
  const publicRows=()=>['ca.crt','server.crt','data/postgresql.conf'].map(name=>{const row=capture(path.join(root,name),1048576);return {file:path.join(root,name),sha256:row.sha256,identity:row.identity};});
  publicCertificateBinding=publicRows();
  enter('PG_START');const logFd=fs.openSync(path.join(root,'postgres.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
  try{pgLogIdentity=assertNativeTask16LogIdentity(logFd);pgChild=spawn(bin('postgres'),['-D',path.join(root,'data')],{cwd:root,env,stdio:['ignore',logFd,logFd],detached:false});pgChild.once('error',()=>{});pgPid=pgChild.pid;
   pgLifetime=trackNativeTask16Child(pgChild);
  }finally{fs.closeSync(logFd);}
  need(Number.isSafeInteger(pgPid)&&pgPid>0,'NATIVE_DIRECT_PG_START');const readyBy=Math.min(deadline,Date.now()+60000);let ready=false;
  while(Date.now()<readyBy){needLive();const result=await command(bin('pg_isready'),['--host','127.0.0.1','--port',String(port),'--username',owner,'--dbname','postgres'],{timeoutMs:5000,allowFailure:true});if(result.code===0){ready=true;break;}await wait(()=>new Promise(resolve=>setTimeout(resolve,250)));}
  need(ready&&childOwnedAndRunning(),'NATIVE_DIRECT_PG_READINESS');const pidRows=capture(path.join(root,'data/postmaster.pid'),8192).bytes.toString('utf8').split('\n');
  need(Number(pidRows[0])===pgPid&&pidRows[1]===path.join(root,'data')&&Number(pidRows[3])===port&&Number(pidRows[2])>=Math.floor(started/1000),'NATIVE_DIRECT_PG_IDENTITY');pgStart=pidRows[2];pgStarted=true;receipt.resource={pid:pgPid,startEpoch:pgStart,host:'127.0.0.1',port,database:db};writeNew(root,'resource-ready.json',{purpose:plan.purpose,candidateSha:plan.source.head,planSha256,runId,pid:pgPid,startEpoch:pgStart,host:'127.0.0.1',port,database:db,status:'POSTGRES_READY_NOT_BUSINESS_ADMISSION'});
  // Startup-only evidence from the original child's existing append-only log.
  // IPv4 readiness alone cannot attest that localhost's IPv6 endpoint is owned.
  let startupLogFd;try{
   const startupLogPath=path.join(root,'postgres.log');startupLogFd=fs.openSync(startupLogPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   assertNativeTask16LogIdentity(startupLogFd,pgLogIdentity,startupLogPath);const before=fs.fstatSync(startupLogFd,{bigint:true});need(before.size<=1048576n,'NATIVE_DIRECT_LOG_BYTES');
   const bytes=Buffer.alloc(Number(before.size));need(fs.readSync(startupLogFd,bytes,0,bytes.length,0)===bytes.length,'NATIVE_DIRECT_LOG_WINDOW');
   assertNativeTask16LogIdentity(startupLogFd,pgLogIdentity,startupLogPath);const after=fs.fstatSync(startupLogFd,{bigint:true});need(after.size>=before.size&&after.size<=1048576n,'NATIVE_DIRECT_LOG_WINDOW');needLive();
   receipt.loopbackListeners=assertNativeTask16CompetitionLoopbackListeners(bytes.toString('utf8'),pgPid,port);
  }finally{if(startupLogFd!==undefined)fs.closeSync(startupLogFd);}
  enter('TLS_NEGATIVES');const positive=await jsonSql("SELECT jsonb_build_object('version',current_setting('server_version_num'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'client',host(inet_client_addr()),'server',host(inet_server_addr()),'port',inet_server_port());",{database:'postgres'});need(positive.version==='160015'&&positive.tls===true&&positive.client==='127.0.0.1'&&positive.server==='127.0.0.1'&&positive.port===port,'NATIVE_DIRECT_TLS');
  for(const extra of [{PGSSLROOTCERT:path.join(root,'wrong-ca.crt')},{PGHOST:'127.0.0.2',PGHOSTADDR:'127.0.0.1'},{PGSSLMODE:'disable'}])need((await sql('SELECT 1;',{database:'postgres',extra,allowFailure:true})).code!==0,'NATIVE_DIRECT_TLS_NEGATIVE');receipt.tls={correct:true,wrongCaRejected:true,wrongSanRejected:true,noTlsRejected:true};
  await sql(`CREATE DATABASE ${db} OWNER ${owner} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';`,{database:'postgres'});dbReady=true;
  const locale=await jsonSql("SELECT jsonb_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',datlocprovider) FROM pg_database WHERE datname=current_database();");need(equal(locale,{encoding:'UTF8',collate:'C',ctype:'C',provider:'c'}),'NATIVE_DIRECT_LOCALE');receipt.locale=locale;
  enter('MIGRATIONS');const migration=await migrateNativeTask16(plan,root,port,credentials.owner,sql,jsonSql,command,enter);receipt.migrationMaterials=migration.materials;
  enter('ROLES');const roles=require('./task16-current259-role-provision.cjs'),nonce=randomBytes(32).toString('hex');
  const roleIdentity=await jsonSql(`SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'clientAddress',host(inet_client_addr()),'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port()) FROM pg_database d WHERE d.datname=current_database();`);
  need(roleIdentity.ownerOid==='10'&&roleIdentity.actorOid==='10'&&roleIdentity.tls===true&&roleIdentity.clientAddress==='127.0.0.1'&&roleIdentity.serverAddress==='127.0.0.1'&&roleIdentity.serverPort===port,'NATIVE_DIRECT_OWNER');
  const roleScope=JSON.stringify({identity:roleIdentity,app:{name:migration.plan.appName,oid:migration.setup.appOid,nonce:migration.plan.nonce},ledger:plan.source.witness.profile.ledger,competition:selection.competition});
  const roleRead=selection.competition?roles.renderNativeTask16CompetitionRoleRead:roles.renderNativeTask16RoleRead,roleInstall=selection.competition?roles.renderNativeTask16CompetitionRoleInstall:roles.renderNativeTask16RoleInstall,roleParse=selection.competition?roles.parseNativeTask16CompetitionRoleRead:roles.parseNativeTask16RoleRead;
  const before=(await sql(roleRead(migration.setup.appOid,null))).stdout;roleParse(roleScope,before,'before');
  const staged=(await sql(roleInstall(roleScope,before,{runtime:credentials.runtime,observer:credentials.observer}))).stdout;const stagedRow=roleParse(roleScope,staged,'install',before);
  const committed=(await sql(roleRead(migration.setup.appOid,stagedRow.writeXid))).stdout;const roleRow=roleParse(roleScope,committed,'committed',before,staged);
  need(roleRow.state.roles.length===9,'NATIVE_DIRECT_NINE_ROLES');
  const provisioned={status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:plan.source.head,runId,databaseIdentity:roleIdentity,ordinary:roleRow.state.app,roles:roleRow.state.roles,commitXid:stagedRow.writeXid,databaseAcl:{before:JSON.parse(before).state.databases,after:roleRow.state.databases},paymentProfile:selection.paymentProfile};
  enter('SEVEN_FRAGMENTS');const seven=require('./task16-current259-seven-install.cjs'),renderSeven=(selection.cash||selection.ledgerCompetition||selection.ledgerCancel)?seven.renderNativeTask16CashSeven:selection.revocation?seven.renderNativeTask16RevocationSeven:selection.voucher?seven.renderNativeTask16VoucherSeven:selection.competition?seven.renderNativeTask16CompetitionSeven:seven.renderNativeTask16GapSeven,parseSeven=(selection.cash||selection.ledgerCompetition||selection.ledgerCancel)?seven.parseNativeTask16CashSeven:selection.revocation?seven.parseNativeTask16RevocationSeven:selection.voucher?seven.parseNativeTask16VoucherSeven:selection.competition?seven.parseNativeTask16CompetitionSeven:seven.parseNativeTask16GapSeven;
  const sevenInput=JSON.stringify({source:plan.source.witness,id:roleIdentity,ordinary:provisioned.ordinary,runtime:provisioned.roles.find(r=>r.name==='jg_task01_runtime'),observer:provisioned.roles.find(r=>r.name==='jg_task01_observer'),roleCommitXid:provisioned.commitXid,databaseAclAfter:provisioned.databaseAcl.after});
  const sevenRaw=[],sevenRows=[];for(let phase=0;phase<3;phase++){const out=(await sql(renderSeven(sevenInput,phase,nonce,phase===0?null:sevenRaw[phase-1]))).stdout;sevenRaw.push(out);sevenRows.push(parseSeven(sevenInput,phase,nonce,out));}
  need(sevenRows[1].installXid!==provisioned.commitXid&&sevenRows[1].catalogSha256!==sevenRows[0].catalogSha256&&sevenRows[2].installXid===sevenRows[1].installXid&&sevenRows[2].catalogSha256===sevenRows[1].catalogSha256&&new Set(sevenRows.map(row=>row.backendPid)).size===3&&new Set(sevenRows.map(row=>row.backendStart)).size===3,'NATIVE_DIRECT_SEVEN_COMMIT');
  enter('ACL_AND_B7');const acl=renderNativeTask16RuntimeAcl(JSON.stringify({source:plan.source.witness,provisioned}),nonce);
  enter('ACL_APPLY');await sql('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;\n'+(selection.voucher?acl.lockSql+'\n'+(selection.revocation?seven.renderNativeTask16RevocationSevenPreimage:seven.renderNativeTask16VoucherSevenPreimage)(sevenInput,nonce,sevenRaw[2])+'\n':'')+acl.writeSql+'\nCOMMIT;');enter('ACL_READBACK');await sql(acl.readbackSql);
  const catalog=require('./task16-current259-catalog.cjs'),source=plan.source.code;
  const identity={runId,database:db,databaseOid:roleIdentity.databaseOid,namespaceOid:roleIdentity.namespaceOid,ownerOid:'10',systemIdentifier:roleIdentity.systemIdentifier,runtimeOid:provisioned.roles.find(r=>r.name==='jg_task01_runtime').oid,observerOid:provisioned.roles.find(r=>r.name==='jg_task01_observer').oid,...(selection.competition?{runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES'}:{}),...(selection.voucher?{voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1'}:{}),paymentProfile:selection.paymentProfile};
  const request={source,identity,nonce,phase:'before'};enter('B7_BEFORE_RENDER');const beforeSql=catalog.renderCurrent259CatalogRead(request);
  enter('B7_BEFORE_QUERY');const beforeRaw=(await sql(beforeSql)).stdout;enter('B7_BEFORE_VALIDATE');const beforeCatalog=parseNativeTask16CatalogRead(beforeRaw,request,undefined,receipt);
  enter('B7_INSTALL_RENDER');const b7Sql=catalog.renderCurrent259B7Install({source,identity,nonce,before:beforeCatalog});
  enter('B7_INSTALL_QUERY');const stagedRaw=(await sql(b7Sql)).stdout;enter('B7_STAGED_VALIDATE');const stagedCatalog=parseNativeTask16CatalogRead(stagedRaw,{...request,phase:'staged'},beforeCatalog,receipt);
  const finalRequest={...request,phase:'committed',installXid:stagedCatalog.raw.writeXid};enter('B7_COMMITTED_RENDER');const finalSql=catalog.renderCurrent259CatalogRead(finalRequest);
  enter('B7_COMMITTED_QUERY');const finalRaw=(await sql(finalSql)).stdout;enter('B7_COMMITTED_VALIDATE');const finalCatalog=parseNativeTask16CatalogRead(finalRaw,finalRequest,stagedCatalog,receipt);
  receipt.installation={migrations:261,roles:9,sevenCommitXid:sevenRows[2].installXid,b7CommitXid:stagedCatalog.raw.writeXid,catalogSha256:hash(Buffer.from(JSON.stringify(finalCatalog.raw)))};
  if(!selection.competition||selection.voucher||selection.cash||selection.ledgerCompetition||selection.ledgerCancel){
   const material=catalog.loadCurrent259CatalogMaterial(source,selection.paymentProfile),binding=material.effectiveAccessBinding;
   need(binding?.paymentProfile===selection.paymentProfile&&binding.insertAdditionCount===selection.insertAdditionCount&&hex(binding.accessPlanSha256,64)&&finalCatalog.raw.roles.find(role=>role.name==='jg_task01_runtime')?.connectionLimit===selection.runtimeLimit,'NATIVE_DIRECT_GAP_CATALOG_BINDING');
   receipt.effectiveAccessBinding=binding;
  }
  need(equal(sourceCapture(),plan.source)&&equal(compiledMaterials(),plan.artifacts)&&equal(dependencyDigest(),plan.dependencies),'NATIVE_DIRECT_SOURCE_CHANGED');
  receipt.directoryBytesBeforeBusiness=nativeDirectoryBytes(root);
  enter('REAL_CLIENTS_NEST_AND_CASE');await wait(()=>runNativeTask16Business(plan,{root,port,credentials,identity,finalCatalog,sql,jsonSql,needLive,wait,cleanupWait,enter,receipt,cashSecretState,checkPublicCertificateContext,command,logIdentity:pgLogIdentity,setRestoreEnvironment:value=>{restoreEnvironment=value;},setClients:value=>{clients=value;},setApplication:(a,m)=>{if(a&&!apps.includes(a))apps.push(a);if(m&&!moduleRefs.includes(m))moduleRefs.push(m);}}));
  need(equal(sourceCapture(),plan.source)&&equal(compiledMaterials(),plan.artifacts)&&equal(dependencyDigest(),plan.dependencies),'NATIVE_DIRECT_SOURCE_CHANGED');receipt.status='NATIVE_DIRECT_CASE_RETURNED_NOT_FULL_ACCEPTANCE';
 }catch(error){const code=error&&!types.isProxy(error)?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;receipt.failure={stage,code:typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(code)?code:'UNKNOWN',elapsedMs:Date.now()-started};receipt.status='STOPPED';}
 finally{
  closing=true;const errors=[];
  for(const app of apps.toReversed())try{await cleanupWait(()=>app.close());}catch{errors.push('APPLICATION_CLOSE_UNKNOWN');}
  for(const moduleRef of moduleRefs.toReversed())try{await cleanupWait(()=>moduleRef.close());}catch{errors.push('MODULE_CLOSE_UNKNOWN');}
  for(const client of clients)try{await cleanupWait(()=>client.$disconnect());}catch{errors.push('CLIENT_CLOSE_UNKNOWN');}
  if(pgLifetime&&!pgLifetime.running()&&(pgChild.exitCode!==null||pgChild.signalCode!==null)){
   receipt.postgresExitedBeforeOwnedStop=true;if(!receipt.failure){receipt.failure={stage:'OWNED_CLEANUP',code:'NATIVE_DIRECT_POSTGRES_EARLY_EXIT',elapsedMs:Date.now()-started};receipt.status='STOPPED';}
  }
  if(pgLifetime&&pgLifetime.running())try{
   // This exact unreaped child cannot have a recycled PID. Never find/kill a
   // replacement from postmaster.pid, a process name, or an arbitrary URL.
   need(childOwnedAndRunning(),'NATIVE_DIRECT_PG_CHANGED');pgLifetime.stop();
   let stopTimer;try{await Promise.race([pgLifetime.terminal,new Promise((_,reject)=>{stopTimer=setTimeout(()=>reject(new Error('native stop timeout')),15000);})]);}finally{clearTimeout(stopTimer);}
   need(!pgLifetime.running(),'NATIVE_DIRECT_CLEANUP_UNKNOWN');
  }catch{errors.push('POSTGRES_CLOSE_UNKNOWN');}
  if(pgChild&&(!pgLifetime||!pgLifetime.running()&&pgChild.exitCode===null&&pgChild.signalCode===null))errors.push('UNCONFIRMED_POSTGRES_START');
  if(!pgChild&&fs.existsSync(path.join(root,'data/postmaster.pid')))errors.push('UNCONFIRMED_POSTGRES_START');
  if(pending>0)errors.push('NATIVE_OPERATIONS_NOT_SETTLED');if(receipt.sdkTlsCleanup==='UNKNOWN')errors.push('SDK_TLS_PROBE_CLEANUP_UNKNOWN');if(receipt.sdkTlsLogClose==='UNKNOWN')errors.push('SDK_TLS_LOG_CLOSE_UNKNOWN');
  for(const name of ['ca.key','wrong-ca.key','server.key'])if(fs.existsSync(path.join(root,name)))try{fs.unlinkSync(path.join(root,name));}catch{errors.push('PRIVATE_KEY_ERASURE_UNKNOWN');}
  if(restoreEnvironment)try{restoreEnvironment();}catch{errors.push('ENVIRONMENT_RESTORE_UNKNOWN');}
  clearTimeout(timer);process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
  try{receipt.directoryBytesAfterCleanup=nativeDirectoryBytes(root);}catch{errors.push('DIRECTORY_OBSERVATION_UNKNOWN');}
  if(selection.cash||selection.ledgerCompetition||selection.ledgerCancel)recordNativeTask16CashSecretCleanup(receipt,cashSecretState,pending);
  receipt.cleanup={status:errors.length?'UNKNOWN':'COMPLETED',failures:errors};if(errors.length)receipt.status='STOPPED';if(selection.ledgerCancel&&receipt.status==='STOPPED'&&receipt.cancelOutcome)receipt.cancelOutcome='UNKNOWN_DO_NOT_RETRY';receipt.elapsedMs=Date.now()-started;
  try{writeNew(root,'receipt.json',receipt);}catch{receipt.status='STOPPED';receipt.publication='UNKNOWN';}
 }
 return {status:receipt.status,candidateSha:plan.source.head,runId,failedStage:receipt.failure?.stage,failureCode:receipt.failure?.code,cleanup:receipt.cleanup.status,elapsedMs:receipt.elapsedMs};
}

async function migrateNativeTask16(plan,root,port,password,sql,jsonSql,command,enter){
 const controls=require('./local-staged-migration-controls.cjs'),{createLocalTailQualification}=require('./local-staged-tail-qualification.cjs');
 const ledger=plan.source.witness.profile.ledger,migrations=ledger.map(({name,sha256})=>({name,sha256})),database=plan.database;
 const tools=resolveNativeTask16PrismaTools();need(equal(tools,plan.prismaTools),'NATIVE_DIRECT_PRISMA_TOOLS_CHANGED');const cli=tools.cli.file,engine=tools.engine.file;
 const schema=capture(path.join(__dirname,'schema.prisma')).bytes;
 const roots=new Map();
 for(const size of [203,205,213,215,218,221,261]){
  const dir=path.join(root,'prefixes',String(size));fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(path.join(dir,'migrations'),{mode:0o700});
  fs.writeFileSync(path.join(dir,'schema.prisma'),schema,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(dir,'migrations/migration_lock.toml'),'provider = "postgresql"\n',{flag:'wx',mode:0o600});
  for(const row of ledger.slice(0,size)){
   const bytes=capture(path.join(__dirname,'migrations',row.name,'migration.sql')).bytes;need(hash(bytes)===row.sha256,'NATIVE_DIRECT_MIGRATION_SOURCE');
   const target=path.join(dir,'migrations',row.name);fs.mkdirSync(target,{mode:0o700});fs.writeFileSync(path.join(target,'migration.sql'),bytes,{flag:'wx',mode:0o600});
  }
  roots.set(size,dir);
 }
 const baseUrl=new URL('postgresql://jg_task01_owner@127.0.0.1:'+port+'/'+database);baseUrl.password=password;
 for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5'}))baseUrl.searchParams.set(key,value);
 const deploy=async(size,url=baseUrl)=>{enter('MIGRATE_'+size);await command(process.execPath,[cli,'migrate','deploy','--schema',path.join(roots.get(size),'schema.prisma')],{timeoutMs:plan.limits.migrationMs,extra:{DATABASE_URL:url.toString(),PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'}});};
 const identity=row=>{need(row.database===database&&row.ownerOid==='10'&&row.actorOid==='10'&&row.actor==='jg_task01_owner'&&row.sessionActor==='jg_task01_owner'&&row.version===160015&&row.encoding==='UTF8'&&row.replication==='origin','NATIVE_DIRECT_MIGRATION_IDENTITY');return Object.fromEntries(['database','databaseOid','namespaceOid','actorOid','ownerOid','systemIdentifier'].map(k=>[k,row[k]]));};
 const checkLedger=(row,size)=>{need(equal(row.ledger,ledger.slice(0,size)),'NATIVE_DIRECT_MIGRATION_LEDGER');};
 await deploy(203);const first=await jsonSql(controls.inspectSql());const bound=identity(first);checkLedger(first,203);
 const migrationPlan={...bound,runId:randomUUID(),nonce:randomBytes(32).toString('hex'),appName:'jg_fixture_app_'+randomBytes(12).toString('hex'),schemaName:'jg_fixture_'+randomBytes(12).toString('hex'),technicalProfile:'CURRENT259_OWNED_TECHNICAL_V1',resourceRunId:plan.runId,migrations:migrations.slice(0,205)};
 const setup=await jsonSql(controls.setupSql(migrationPlan));controls.checkSetup(setup,migrationPlan);
 const qualified=new URL(baseUrl);qualified.searchParams.set('options','-c app.contract_archive_v2_application_role_oid='+setup.appOid+' -c app.contract_archive_v2_file_caller_oids='+JSON.stringify(setup.fileCallerOids)+' -c app.local_migration_nonce='+migrationPlan.nonce);
 await deploy(205,qualified);const completed=controls.parseReadback((await sql(controls.readbackSql(migrationPlan,setup))).stdout);need(equal(identity(completed),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(completed,205);controls.checkCompletion(completed,migrationPlan,setup);
 await sql(controls.cleanupSql(migrationPlan,setup));const clean=await jsonSql(controls.cleanReadSql(migrationPlan,setup));need(clean.schemaAbsent===true&&clean.eventAbsent===true&&clean.appOid===setup.appOid&&clean.applicationQualified===true,'NATIVE_DIRECT_QUALIFICATION_CLEANUP');
 const materials=[];const tail=createLocalTailQualification({plan:migrationPlan,setup,migrations},{read:async(_phase,text)=>jsonSql(text),write:async(_phase,text)=>jsonSql(text),recordMaterial:row=>{need(hash(Buffer.from(row.sql))===row.afterSha256,'NATIVE_DIRECT_SQL_MATERIAL');materials.push({kind:row.kind,beforeSha256:row.beforeSha256,afterSha256:row.afterSha256});}});
 for(const size of [213,215,218,221]){await deploy(size);const row=await jsonSql(controls.inspectSql());need(equal(identity(row),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(row,size);await tail.qualify(size);}
 await deploy(261);const final=await jsonSql(controls.inspectSql());need(equal(identity(final),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(final,261);
 return {plan:migrationPlan,setup,materials};
}

async function runNativeTask16Business(plan,state){
 const {root,port,credentials,identity,finalCatalog,needLive,wait,cleanupWait,enter,receipt}=state;
 const selection=nativeTask16CaseSelection(plan.purpose),clientLanes=selection.competition?['owner','runtime_a','runtime_b','observer']:['owner','runtime','observer'];
 const env={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:path.join(root,selection.voucher?'application-private-voucher':'storage'),JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),FILE_DOWNLOAD_SECRET:randomBytes(32).toString('hex')};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));state.setRestoreEnvironment(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});for(const [k,v]of Object.entries(env))process.env[k]=v;
 try{
  const {PrismaClient}=require('@prisma/client');
  const controllerAborted=error=>Object.getOwnPropertyDescriptor(error??{},'code')?.value==='NATIVE_DIRECT_DEADLINE';
  const urlFor=lane=>{const kind=lane==='runtime_a'||lane==='runtime_b'?'runtime':lane;const url=new URL('postgresql://jg_task01_'+kind+'@127.0.0.1:'+port+'/'+plan.database);url.password=credentials[kind];for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5',application_name:'task16_live_'+plan.runId.replaceAll('-','')+'_'+lane}))url.searchParams.set(key,value);return url.toString();};
  const clients=createNativeTask16BusinessClients(PrismaClient,plan.purpose,urlFor,receipt);state.setClients(clients);
  await wait(()=>Promise.all(clients.map(client=>client.$connect())));
  const owner=clients[0],runtime=clients[1],runtimeB=selection.competition?clients[2]:undefined,observer=clients.at(-1),identitySql=require('./task16-current259-session-identity.cjs').current259ClientIdentitySql;
  let retained;
  const verifyIdentity=async()=>{
   needLive();const nonce=randomBytes(32).toString('hex');const rows=await wait(()=>Promise.all(clients.map(client=>client.$queryRawUnsafe(identitySql,nonce))));
   need(rows.every((result,i)=>result.length===1&&result[0].database===plan.database&&result[0].databaseOid===identity.databaseOid&&result[0].systemIdentifier===identity.systemIdentifier&&result[0].effectiveRole==='jg_task01_'+(selection.competition?['owner','runtime','runtime','observer']:['owner','runtime','observer'])[i]&&result[0].loginRole===result[0].effectiveRole&&result[0].effectiveOid===result[0].loginOid&&result[0].tls===true&&result[0].version===160015&&result[0].encoding==='UTF8'&&result[0].replication==='origin'&&result[0].clientAddress==='127.0.0.1'&&result[0].serverAddress==='127.0.0.1'&&result[0].serverPort===port&&result[0].nonce===nonce&&result[0].readOnly===(i===clientLanes.length-1?'on':'off')),'NATIVE_DIRECT_CLIENT_IDENTITY');
   need(new Set(rows.map(r=>r[0].pid)).size===clientLanes.length&&new Set(rows.map(r=>r[0].loginOid)).size===3&&(!selection.competition||rows[1][0].loginOid===rows[2][0].loginOid)&&new Set(rows.map(r=>r[0].clientPort)).size===clientLanes.length&&new Set(rows.map(r=>r[0].start)).size===clientLanes.length,'NATIVE_DIRECT_CLIENT_SEPARATION');
   const next=rows.map(r=>{const copy={...r[0]};delete copy.nonce;return copy;});if(retained)need(equal(next,retained),'NATIVE_DIRECT_CLIENT_CHANGED');else retained=next;return next;
  };
  await verifyIdentity();receipt.sdkPositiveClients=retained.map(row=>({role:row.loginRole,pid:row.pid,startedAt:row.start,tls:row.tls,databaseOid:row.databaseOid,clientAddress:row.clientAddress,clientPort:row.clientPort,serverAddress:row.serverAddress,serverPort:row.serverPort}));
  const policyBinding=state.checkPublicCertificateContext();need(equal(captureNativeTask16Security(),plan.security),'NATIVE_DIRECT_SECURITY_CHANGED');
  const policies=[];for(const hostname of ['127.0.0.1','localhost']){
   state.checkPublicCertificateContext();need(equal(captureNativeTask16Security(),plan.security),'NATIVE_DIRECT_SECURITY_CHANGED');
   const result=await wait(()=>state.command('/usr/bin/security',['verify-cert','-c',path.join(root,'server.crt'),'-r',path.join(root,'ca.crt'),'-p','ssl','-n',hostname,'-N','-L','-R','offline','-v'],{timeoutMs:5000,allowFailure:true}));
   policies.push(projectNativeTask16SecurityPolicy(result));state.checkPublicCertificateContext();
  }
  receipt.nativeNamePolicy={binding:policyBinding,positive:policies[0],negative:policies[1],sdkDirectCause:false};
  need(equal(policies[0],{exitCode:0,hostnameMismatch:false,error67602:false})&&equal(policies[1],{exitCode:1,hostnameMismatch:true,error67602:true}),'NATIVE_DIRECT_NATIVE_POLICY_UNKNOWN');
  receipt.sdkTls={};receipt.sdkTlsWords={};
  for(const mode of ['wrong-ca','no-tls','wrong-san']){
   const originalRuntimeUrl=urlFor('runtime_a'),url=new URL(originalRuntimeUrl);if(mode==='wrong-ca')url.searchParams.set('sslcert',path.join(root,'wrong-ca.crt'));else if(mode==='no-tls')url.searchParams.set('sslmode','disable');else url.hostname='localhost';
   if(mode==='wrong-san')receipt.localhostAnswers=verifyNativeTask16LocalhostAnswers(await wait(()=>require('node:dns').promises.lookup('localhost',{all:true,verbatim:true})));
   const restored=new URL(url);restored.hostname='127.0.0.1';const onlyHostnameChanged=mode==='wrong-san'&&url.hostname==='localhost'&&restored.toString()===originalRuntimeUrl;if(mode==='wrong-san')receipt.nameControlOnlyHostnameChanged=onlyHostnameChanged;state.checkPublicCertificateContext();
   const probe=new PrismaClient({datasources:{db:{url:url.toString()}}});state.setClients([...clients,probe]);let primary,logFd,logBefore;
   try{
    if(mode==='no-tls'){logFd=fs.openSync(path.join(root,'postgres.log'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);assertNativeTask16LogIdentity(logFd,state.logIdentity,path.join(root,'postgres.log'));logBefore=fs.fstatSync(logFd,{bigint:true});need(logBefore.isFile()&&logBefore.uid===BigInt(process.getuid())&&(logBefore.mode&0o777n)===0o600n,'NATIVE_DIRECT_LOG_WINDOW');}
    let rejected,controlled;try{await wait(()=>probe.$connect());}catch(error){if(controllerAborted(error))throw error;receipt.sdkTlsWords[mode]=projectNativeTask16TlsWords(error);receipt.sdkTls[mode]={status:'UNKNOWN',...classifyNativeTask16TlsFailure(error,mode)};let hba;
     if(mode==='no-tls'){
      assertNativeTask16LogIdentity(logFd,state.logIdentity,path.join(root,'postgres.log'));const after=fs.fstatSync(logFd,{bigint:true}),named=fs.lstatSync(path.join(root,'postgres.log'),{bigint:true});
      need(['dev','ino','mode','uid','gid'].every(key=>after[key]===logBefore[key]&&named[key]===logBefore[key])&&!named.isSymbolicLink()&&after.size>=logBefore.size&&after.size-logBefore.size<=65536n,'NATIVE_DIRECT_LOG_WINDOW');
      const bytes=Buffer.alloc(Number(after.size-logBefore.size));let read=0;while(read<bytes.length){const count=fs.readSync(logFd,bytes,read,bytes.length-read,Number(logBefore.size)+read);need(count>0,'NATIVE_DIRECT_LOG_WINDOW');read+=count;}
      assertNativeTask16LogIdentity(logFd,state.logIdentity,path.join(root,'postgres.log'));const checked=fs.fstatSync(logFd,{bigint:true});need(['dev','ino','size','mtimeNs','ctimeNs'].every(key=>checked[key]===after[key]),'NATIVE_DIRECT_LOG_WINDOW');
      hba=projectNativeTask16PlaintextHba(bytes.toString('utf8'),plan.database);if(hba)receipt.plaintextHba=hba;
     }
     rejected=classifyNativeTask16TlsFailure(error,mode,hba);if(mode==='wrong-san'&&!rejected.accepted){controlled=controlledNativeTask16NameResult(error,JSON.stringify({binding:policyBinding,currentBinding:state.checkPublicCertificateContext(),positiveClientsVerified:true,onlyHostnameChanged,positivePolicy:policies[0],negativePolicy:policies[1]}));receipt.controlledNameRejection=controlled;}}
    if(!rejected){receipt.sdkTls[mode]={status:'UNEXPECTEDLY_ACCEPTED'};fail('NATIVE_DIRECT_TLS_NEGATIVE_ACCEPTED');}
    receipt.sdkTls[mode]={status:rejected.accepted?'REJECTED':'UNKNOWN',...rejected};state.checkPublicCertificateContext();need(rejected.accepted||controlled?.accepted===true,'NATIVE_DIRECT_TLS_NEGATIVE_UNKNOWN');
   }catch(error){primary=error;throw error;}
   finally{let logCloseFailed=false;if(logFd!==undefined)try{fs.closeSync(logFd);}catch{logCloseFailed=true;receipt.sdkTlsLogClose='UNKNOWN';}state.setClients(clients);try{await cleanupWait(()=>probe.$disconnect());}catch{receipt.sdkTlsCleanup='UNKNOWN';if(!primary)fail('NATIVE_DIRECT_PROBE_CLEANUP_UNKNOWN');}if(logCloseFailed&&!primary)fail('NATIVE_DIRECT_LOG_CLOSE_UNKNOWN');}
  }
  const {Test}=require('@nestjs/testing');const {PrismaService}=require('../dist/database/prisma.service.js');
  const {Task16RegisteredApplicationModule,Task16ImpactReaderToken}=require('../dist/database/task16-registered-application.module.js');
  const {readTask16RegisteredPaymentImpacts}=require('../dist/payment/registered-payment-impact-reader.js');
  const selectedRuntimes=selection.competition?[runtime,runtimeB]:[runtime];
  const origins=[],applicationHandles=[];let revocationRouteIds;
  const ApplicationModule=selection.revocation?require('../dist/database/task16-revocation-application.module.js').Task16RevocationApplicationModule:Task16RegisteredApplicationModule;
  for(const selectedRuntime of selectedRuntimes){
   const module=await wait(()=>Test.createTestingModule({imports:[ApplicationModule]}).overrideProvider(PrismaService).useValue(selectedRuntime).overrideProvider(Task16ImpactReaderToken).useValue(readTask16RegisteredPaymentImpacts).compile(),late=>cleanupWait(()=>late.close()));state.setApplication(undefined,module);
  const app=module.createNestApplication();state.setApplication(app,module);
  if(selection.revocation)app.use((req,res,next)=>{if(!nativeTask16RevocationInboundAllowed(req.method,req.originalUrl,revocationRouteIds))return res.status(404).end();return next();});
  need(module.get(PrismaService)===selectedRuntime&&module.get(Task16ImpactReaderToken)===readTask16RegisteredPaymentImpacts&&app.get(PrismaService)===selectedRuntime&&app.get(Task16ImpactReaderToken)===readTask16RegisteredPaymentImpacts,'NATIVE_DIRECT_REAL_PROVIDERS');
  require('../dist/api-security.js').configureApiSecurity(app);require('../dist/operating-projection/projection-export-json.js').configureProjectionExportJson(app);
  app.getHttpAdapter().getInstance().set('json replacer',require('../dist/api-json-replacer.js').apiJsonReplacer);app.enableCors({origin:[],credentials:false});app.useGlobalPipes(require('../dist/validation/api-validation.js').createApiValidationPipe());
  await wait(()=>app.init());await wait(()=>require('../dist/api-listen.js').listenApi(app,0,'127.0.0.1'));
  const address=app.getHttpServer().address();need(address.address==='127.0.0.1'&&address.family==='IPv4'&&address.port>1024,'NATIVE_DIRECT_HTTP_ENDPOINT');
  origins.push('http://127.0.0.1:'+address.port);applicationHandles.push(app);
  }
  need(selection.competition?origins.length===2&&origins[0]!==origins[1]:origins.length===1,'NATIVE_DIRECT_TWO_APPLICATIONS');const origin=origins[0];
  const catalog=require('./task16-current259-catalog.cjs'),material=catalog.loadCurrent259CatalogMaterial(plan.source.code,selection.paymentProfile);
  const proof=Object.freeze({authorizationReference:'root-native-plan-sha256:'+receipt.planSha256,runId:plan.runId.replaceAll('-','').slice(0,12),resourceRunId:plan.runId,databaseName:plan.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,host:'127.0.0.1',port,ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',sourceSealSha256:plan.source.code.sealSha256,preparedSqlSha256:Object.freeze(Object.fromEntries(material.sevenFragments.map(row=>[path.basename(row.path),row.sha256]))),transport:'isolated-loopback-tls-verify-full',application:Object.freeze({origin,databaseRole:'jg_task01_runtime',sourceSealSha256:plan.source.code.sealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'})});
  const contexts=selectedRuntimes.map((selectedRuntime,index)=>Object.freeze({proof:Object.freeze({...proof,application:Object.freeze({...proof.application,origin:origins[index]})}),owner,runtime:selectedRuntime,observer,password:randomBytes(32).toString('hex'),httpTimeoutMs:5000}));
  const [context,contender]=contexts;
  const fixture=require('../dist/database/registered-payment-postgres.fixture.js'),cases=require('../dist/database/registered-payment-postgres.cases.js');
  const dates=nativeTask16FixtureDates(Date.now());const fixturePlan=fixture.buildRegisteredPgFixturePlan(proof.runId,dates.paidAt,dates.openingDate);receipt.fixtureDates=dates;
  if(!selection.competition){
   const allowed=new Set(['POST /auth/login','POST /fund-accounts/openings','GET /fund-accounts/company:'+fixturePlan.ids.companyB,
    'GET /payment-executions/'+fixturePlan.ids.payment+'/registration-options','POST /payment-executions/'+fixturePlan.ids.payment+'/registrations','GET /payment-executions/results/'+fixturePlan.ids.requestKey]);
   const assertTarget=(target,method)=>{needLive();const url=new URL(target,origin);need(url.origin===origin&&!url.username&&!url.password&&!url.hash&&!url.search&&allowed.has(method+' '+url.pathname),'NATIVE_DIRECT_HTTP_ROUTE');};
   const requestJson=require('./task16-current261-seed-json.cjs').requestCurrent261SeedJson;
   const continuity={seedProfile:selection.paymentProfile,checkLight:needLive,assertHttpRequest:(route,method)=>assertTarget(route,method),
    fetch:async(target,init)=>{assertTarget(target,init.method??'GET');return fetch(target,init);},
    requestJson:async(target,init,timeout)=>{assertTarget(target,init.method??'GET');need(timeout===5000&&!Object.hasOwn(init,'signal'),'NATIVE_DIRECT_HTTP_TIMEOUT');return requestJson(target,init,timeout);},
    markAttributionGapStage:phase=>{if(selection.sourceInsufficient)receipt.sourceInsufficientStage=phase;else receipt.attributionGapStage=phase;},
    recordSeedFailure:(failedStage,code,status)=>{if(!receipt.seedFailure)receipt.seedFailure={stage:failedStage,code:typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(code)?code:'UNKNOWN',...(Number.isInteger(status)?{httpStatus:status}:{})};}};
   await wait(()=>fixture.assertRegisteredPgConnectedRoles(context,continuity));enter('SEED_LOGIN_AND_OPENINGS');receipt.business='ENTERED';
   const prepared=await wait(()=>fixture.seedRegisteredPgAttributionGapFixture(context,fixturePlan,continuity));receipt.loginAndOpenings='ORIGINAL_FIXTURE_RETURNED';
   await verifyIdentity();enter(selection.sourceInsufficient?'SOURCE_INSUFFICIENT_409_AND_ORIGINAL_KEY_GET':'ATTRIBUTION_GAP_409_AND_ORIGINAL_KEY_GET');
   const result=await wait(()=>(selection.sourceInsufficient?cases.runRegisteredProjectSourceInsufficient:cases.runRegisteredProjectAttributionGap)(context,prepared,continuity));
   need(result.passed===true&&result.caseId===selection.caseId&&result.registrationStatus===409&&result.projectAmountCents==='500'&&result.gapAmountCents==='300'&&result.originalResultUnconfirmed===true&&!Object.hasOwn(result,'executionId')&&!Object.hasOwn(result,'rootId'),'NATIVE_DIRECT_CASE_RESULT');
   receipt.accounting=(selection.sourceInsufficient?writeNativeTask16SourceAccounting:writeNativeTask16GapAccounting)(root,plan.source.head,plan.runId,JSON.stringify(result.accountingEvidence));
   if(selection.sourceInsufficient){receipt.sourceInsufficientObserved=true;receipt.business='SOURCE_INSUFFICIENT_CASE_RETURNED';}
   else {receipt.attributionGapObserved=true;receipt.business='ORIGINAL_ATTRIBUTION_GAP_CASE_RETURNED';}
   await verifyIdentity();await wait(()=>fixture.assertRegisteredPgConnectedRoles(context,continuity));
   receipt.clients=retained.map(row=>({role:row.loginRole,pid:row.pid,startedAt:row.start,tls:row.tls,clientAddress:row.clientAddress,serverAddress:row.serverAddress,serverPort:row.serverPort}));
   need(finalCatalog.status==='CURRENT259_CATALOG_COMMITTED'||finalCatalog.raw?.reader,'NATIVE_DIRECT_B7_CURRENT');return;
  }
  const resultKeys=[fixturePlan.ids.requestKey];
  const requestCurrent261SeedJson=require('./task16-current261-seed-json.cjs').requestCurrent261SeedJson;
  let prepared,used=false,armed=false,raceLoser,followUpLane,followUpCommand,cashCommand;
  const posts=[0,0],followUpPosts=[0,0],seedPosts=[[],[]];
  const lanes=origins.map((laneOrigin,index)=>{
   const assertTarget=(target,method)=>{needLive();assertNativeTask16CompetitionTarget(laneOrigin,fixturePlan.ids.payment,resultKeys,target,method);};
   const checkCommand=(target,init)=>{
    assertTarget(target,init.method??'GET');
    if(selection.cash&&prepared&&init.method==='POST'){
     const command=JSON.parse(init.body);
     need(index===1&&command.idempotencyKey===prepared.contender.requestKey&&command.amountCents==='4000'&&command.scopeKey==='public_cash'&&command.expectedRegistrationId===prepared.cashRegistrationId&&equal(command.sourceAllocations,[{sourceBatchId:prepared.cashSourceId,amountCents:'4000'}])&&command.paidAt===fixturePlan.paidAt&&command.confirmationPassword===contexts[index].password,'NATIVE_DIRECT_CASH_COMMAND');
     if(cashCommand)need(equal(command,cashCommand),'NATIVE_DIRECT_CASH_REPLAY');else cashCommand=command;
    }
    if(followUpLane===index&&init.method==='POST'){
     const command=JSON.parse(init.body);
     need(command.idempotencyKey===prepared.followUpRequestKey&&command.amountCents==='1000'&&command.scopeKey==='company:'+fixturePlan.ids.companyA&&command.expectedRegistrationId===prepared.companyARegistrationId&&equal(command.sourceAllocations,[{sourceBatchId:prepared.companyASourceId,amountCents:'1000'}])&&command.paidAt===fixturePlan.paidAt&&command.confirmationPassword===contexts[index].password,'NATIVE_DIRECT_FOLLOW_UP_COMMAND');
     if(followUpCommand)need(equal(command,followUpCommand),'NATIVE_DIRECT_FOLLOW_UP_REPLAY');else followUpCommand=command;
    }
   };
   const assertRequest=(route,method)=>{
    assertTarget(route,method);
    if(!prepared){const routes=index===0?['/auth/login','/fund-accounts/openings','/fund-accounts/openings']:(selection.cash||selection.ledgerCompetition||selection.ledgerCancel)?['/auth/login','/fund-accounts/openings']:['/auth/login'];need(method==='POST'&&route===routes[seedPosts[index].length],'NATIVE_DIRECT_SEED_ROUTE');seedPosts[index].push(route);return;}
    if(method==='POST'){
     need(!selection.revocation,'NATIVE_DIRECT_REVOCATION_PAYMENT_POST_FORBIDDEN');
     if(selection.ledgerLoss){need(index===0&&route==='/payment-executions/'+fixturePlan.ids.payment+'/registrations'&&posts[index]<2,'NATIVE_DIRECT_LEDGER_LOSS_POST');posts[index]++;return;}
     if(selection.ledgerCancel){need(index===0&&route==='/payment-executions/'+fixturePlan.ids.payment+'/registrations'&&posts[index]===0,'NATIVE_DIRECT_LEDGER_CANCEL_POST');posts[index]++;return;}
     if(selection.cash){need(index===1&&route==='/payment-executions/'+fixturePlan.ids.payment+'/registrations'&&posts[index]<2,'NATIVE_DIRECT_CASH_POST');posts[index]++;return;}
     need(route==='/payment-executions/'+fixturePlan.ids.payment+'/registrations','NATIVE_DIRECT_REGISTRATION_ROUTE');
     if(followUpLane===index){need(!armed&&used&&followUpPosts[index]<2,'NATIVE_DIRECT_FOLLOW_UP_COUNT');followUpPosts[index]++;}
     else {need(armed&&posts[index]===0,'NATIVE_DIRECT_COMPETITION_COUNT');posts[index]++;}return;
    }
    need(method==='GET','NATIVE_DIRECT_CASE_GET');
    const key=index===0?fixturePlan.ids.requestKey:prepared.contender.requestKey;
    need(['/payment-executions/work-items','/payment-executions/'+fixturePlan.ids.payment+'/registration-options','/payment-executions/results/'+key,...(followUpLane!==undefined?['/payment-executions/results/'+prepared.followUpRequestKey,'/payment-executions/results/'+(index===0?prepared.contender.requestKey:fixturePlan.ids.requestKey),'/payment-executions/recorded-items?paymentId='+fixturePlan.ids.payment]:[])].includes(route),'NATIVE_DIRECT_CASE_ROUTE_PHASE');
   };
   return {seedProfile:(selection.cash||selection.ledgerCompetition||selection.ledgerCancel)?'TASK16_PAYMENT261_PUBLIC_CASH_FIXTURE_V1':selection.revocation?'TASK16_PAYMENT261_VOUCHER_RUNTIME_V1':selection.paymentProfile,checkLight:needLive,assertHttpRequest:assertRequest,fetch:async(target,init)=>{checkCommand(target,init);return fetch(target,init);},requestJson:async(target,init,timeout)=>{checkCommand(target,init);need(timeout===5000&&!Object.hasOwn(init,'signal'),'NATIVE_DIRECT_HTTP_TIMEOUT');return requestCurrent261SeedJson(target,init,timeout);},...(selection.cash&&index===1?{recordCashRegistrationStatus:status=>recordNativeTask16CashRegistrationStatus(root,receipt,status)}:{}),recordSeedFailure:(failedStage,code,status)=>{if(!receipt.seedFailure)receipt.seedFailure={stage:failedStage,code:typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(code)?code:'UNKNOWN',...(Number.isInteger(status)?{httpStatus:status}:{})};}};
  });
  if(selection.ledgerCancel){
   await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
   const {withCashLedgerSecret}=require('../dist/database/registered-payment-public-cash-secret.js');
   return await runNativeTask16CashScope(withCashLedgerSecret,owner,{database:plan.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerPid:retained[0].pid},needLive,state.cashSecretState,async()=>{
    enter('LEDGER_CANCEL_SEED_AND_SETTLEMENT_REPLAY');receipt.business='ENTERED';
    prepared=await wait(()=>fixture.seedRegisteredPgPublicCashFormalFixture(context,contender,fixturePlan,...lanes));
    need(equal(seedPosts.map(rows=>rows.length),[3,2])&&prepared.accessToken!==prepared.contender.accessToken,'NATIVE_DIRECT_LEDGER_CANCEL_SEED');
    resultKeys.push(prepared.contender.requestKey);receipt.cancelOutcome='UNKNOWN_DO_NOT_RETRY';enter('LEDGER_CANCEL_AND_OBSERVER');
    const cancelApi=require('./run-task16-native-cancel-once.cjs');
    const result=await cancelApi.runNativeTask16CancelPreparedCase(root,plan,identity,fixturePlan,receipt,verifyIdentity,needLive,async binding=>{
     const prepareBody=cancelApi.createNativeCancelBodyBinding(root,receipt,binding,LEDGER_CANCEL_PURPOSE);
     const transport=require('./task16-native-a16-cancel-transport.cjs').createNativeA16CancelTransport({origin:origins[0],payment:fixturePlan.ids.payment,key:fixturePlan.ids.requestKey,check:binding,prepareBody});
     const cancelContinuity={...lanes[0],checkLight:binding,requestJson:undefined,fetch:async(target,init)=>transport.fetch(target,init)};
     const faultApi=require('./task16-native-a16-cancel-fault.cjs');
     const fault=faultApi.createNativeLedgerA16CancelFault({nonce:randomBytes(32).toString('hex'),runId:plan.runId,candidateSha:plan.source.head,planSha256:receipt.planSha256,
      database:{name:plan.database,oid:identity.databaseOid,namespaceOid:identity.namespaceOid,systemIdentifier:identity.systemIdentifier,port},
      runtime:{oid:retained[1].loginOid,pid:retained[1].pid,startedAt:retained[1].start,clientAddress:retained[1].clientAddress,clientPort:retained[1].clientPort},
      peer:{oid:retained[2].loginOid,pid:retained[2].pid,startedAt:retained[2].start,clientAddress:retained[2].clientAddress,clientPort:retained[2].clientPort}});
     return await cancelApi.executeNativeA16CancelCase({fault,sql:text=>state.sql(text),binding,verifyIdentity,transport,receipt,
      runCase:cancel=>wait(()=>cases.runRegisteredLedgerPaymentCancellation(context,contender,prepared,cancelContinuity,cancel))});
    },LEDGER_CANCEL_PURPOSE);
    need(result.passed===true&&result.caseId===selection.caseId&&result.rollbackObserved===true&&result.originalResultUnconfirmed===true&&equal(posts,[1,0]),'NATIVE_DIRECT_LEDGER_CANCEL_RESULT');
    receipt.accounting=writeNew(root,'accounting-evidence.json',{schemaVersion:1,purpose:LEDGER_CANCEL_PURPOSE,candidateSha:plan.source.head,runId:plan.runId,settlementWitness:result.settlementWitness,accountingEvidence:result.accountingEvidence});
    await verifyIdentity();await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
    receipt.cancelOutcome='CANCELLED_ROLLBACK_CONFIRMED';receipt.business='LEDGER_CANCEL_CASE_RETURNED';
   });
  }
  if(selection.ledgerCompetition){
   await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
   const {withCashLedgerSecret}=require('../dist/database/registered-payment-public-cash-secret.js');
   return await runNativeTask16CashScope(withCashLedgerSecret,owner,{database:plan.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerPid:retained[0].pid},needLive,state.cashSecretState,async()=>{
    enter('LEDGER_COMPETITION_SEED_AND_SETTLEMENT_REPLAY');receipt.business='ENTERED';
    prepared=await wait(()=>fixture.seedRegisteredPgPublicCashFormalFixture(context,contender,fixturePlan,...lanes));
    need(equal(seedPosts.map(rows=>rows.length),[3,2])&&prepared.accessToken!==prepared.contender.accessToken,'NATIVE_DIRECT_LEDGER_COMPETITION_SEED');
    resultKeys.push(prepared.contender.requestKey);
    if(selection.ledgerLoss){
     const lossApi=require('./run-task16-native-response-loss-once.cjs');receipt.ledgerLossOutcome='UNKNOWN';enter('LEDGER_LOSS_RESULT_OBSERVE_REPLAY');
     return await lossApi.runNativeTask16ResponseLossPreparedCase(root,plan,identity,fixturePlan,receipt,verifyIdentity,needLive,async binding=>{
      const prepareBody=lossApi.createNativeResponseLossBodyBinding(root,receipt,binding,LEDGER_LOSS_PURPOSE);
      const transport=await wait(()=>require('./task16-native-response-loss-transport.cjs').createNativeResponseLossTransport({origin:origins[0],payment:fixturePlan.ids.payment,key:fixturePlan.ids.requestKey,check:binding,prepareBody}),late=>cleanupWait(()=>late.close()));
      const loss={...lanes[0],checkLight:binding,requestJson:undefined,fetch:(target,init)=>transport.fetch(target,init),loseRegistrationResponse:async submit=>{binding();await verifyIdentity();binding();return transport.lose(submit);},authorizeResponseLossReplay:async()=>{binding();await verifyIdentity();binding();transport.authorizeReplay();}};
      let result,primary;try{result=await wait(()=>cases.runRegisteredLedgerResponseLoss(context,contender,prepared,{lanes,loss}));}
      catch(error){primary=error;throw error;}finally{try{await cleanupWait(()=>transport.close());}catch(error){receipt.responseLossProxyCleanup='UNKNOWN';if(!primary)throw error;}}
      transport.assertCompleted();need(result.passed===true&&result.caseId===selection.caseId&&result.ledgerWitness?.impactCount===3&&equal(posts,[2,0]),'NATIVE_DIRECT_LEDGER_LOSS_RESULT');
      receipt.accounting=writeNew(root,'accounting-evidence.json',{schemaVersion:1,purpose:LEDGER_LOSS_PURPOSE,candidateSha:plan.source.head,runId:plan.runId,settlementFactId:prepared.settlementFactId,accountingEvidence:result.accountingEvidence,ledgerWitness:result.ledgerWitness});
      receipt.ledgerLossOutcome='COMPLETED';receipt.business='LEDGER_RESPONSE_LOSS_CASE_RETURNED';await verifyIdentity();
     },LEDGER_LOSS_PURPOSE);
    }
    return await runNativeTask16LedgerCompetitionPrepared(root,plan,identity,fixturePlan,prepared,receipt,verifyIdentity,needLive,enter,async()=>{
    const controls={lanes,async withSamePaymentLock(paymentId,pids,submissions){
     needLive();need(!used&&paymentId===fixturePlan.ids.payment&&equal(pids,retained.slice(1,3).map(row=>row.pid))&&submissions.length===2&&submissions.every(fn=>typeof fn==='function'),'NATIVE_DIRECT_COMPETITION_ARM');
     used=true;armed=true;try{
      const responses=await withNativeTask16CompetitionLock(context,{runId:plan.runId},async text=>state.sql(text),needLive,paymentId,retained.slice(0,3),submissions);
      need(responses.length===2&&responses.map(row=>row.status).sort().join(',')==='201,409','NATIVE_DIRECT_COMPETITION_RESPONSES');return responses;
     }finally{armed=false;}
    }};
    const result=await wait(()=>cases.runRegisteredLedgerPaymentCompetition(context,contender,prepared,controls));
    need(used&&!armed&&equal(posts,[1,1])&&result.caseId===selection.caseId&&result.passed===true&&result.competitionObserved===true&&result.ledgerWitness?.impactCount===3,'NATIVE_DIRECT_LEDGER_COMPETITION_RESULT');
    receipt.accounting=writeNativeTask16LedgerCompetitionAccounting(root,plan,result,prepared,fixturePlan.ids);
    receipt.ledgerCompetitionOutcome='COMPLETED';receipt.business='LEDGER_COMPETITION_CASE_RETURNED';await verifyIdentity();
    await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
    });
   });
  }
  if(selection.cash){
   await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
   const {withCashLedgerSecret}=require('../dist/database/registered-payment-public-cash-secret.js');
   return await runNativeTask16CashScope(withCashLedgerSecret,owner,{database:plan.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerPid:retained[0].pid},needLive,state.cashSecretState,async()=>{
    enter('CASH_SEED_AND_SETTLEMENT_REPLAY');receipt.business='ENTERED';
    prepared=await wait(()=>fixture.seedRegisteredPgPublicCashFormalFixture(context,contender,fixturePlan,...lanes));
    need(equal(seedPosts.map(rows=>rows.length),[3,2])&&prepared.accessToken!==prepared.contender.accessToken,'NATIVE_DIRECT_CASH_SEED');
    resultKeys.push(prepared.contender.requestKey);
    const result=await runNativeTask16CashPreparedCase(root,plan,identity,fixturePlan,prepared,receipt,verifyIdentity,needLive,enter,()=>wait(()=>cases.runRegisteredPublicCashPayment(context,contender,prepared,lanes)));
    need(result.passed===true&&result.caseId===selection.caseId&&result.cashBalanceYuan4==='60.0000'&&result.paidCents==='4000'&&result.costCents==='4000'&&result.rootCount===0&&result.replayUnchanged===true&&equal(posts,[0,2]),'NATIVE_DIRECT_CASH_RESULT');
    receipt.accounting=writeNativeTask16CashAccounting(root,plan,result);
    receipt.cash={caseId:result.caseId,paidCents:result.paidCents,cashBalanceYuan4:result.cashBalanceYuan4,costCents:result.costCents,rootCount:0,replayUnchanged:true,observerPid:result.observerPid};
    receipt.business='SYNTHETIC_PUBLIC_CASH_CASE_RETURNED';await verifyIdentity();
   });
  }
  await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));enter('SEED_TWO_LOGINS_AND_OPENINGS');receipt.business='ENTERED';
  prepared=await wait(()=>(selection.voucher?fixture.seedRegisteredPgCompetitionFixture:fixture.seedRegisteredPgCompetitionFollowUpFixture)(context,contender,fixturePlan,...lanes));receipt.loginAndOpenings='ORIGINAL_COMPETITION_FIXTURE_RETURNED';
  need(equal(seedPosts.map(rows=>rows.length),[3,1])&&prepared.accessToken!==prepared.contender.accessToken,'NATIVE_DIRECT_SEED_ACTORS');resultKeys.push(prepared.contender.requestKey,...(selection.voucher?[]:[prepared.followUpRequestKey]));
  if(selection.revocation){
   await verifyIdentity();state.checkPublicCertificateContext();enter('REVOCATION_SYNTHETIC_PREPARE');
   const {PaymentRequestService}=require('../dist/payment/payment-request.service.js');
   const {FileService}=require('../dist/file/file.service.js');
   const service=applicationHandles[0].get(PaymentRequestService),files=applicationHandles[0].get(FileService);
   need(service&&applicationHandles[0].get(PrismaService)===runtime&&applicationHandles[0].get(PaymentRequestService)===service&&service.prisma===runtime&&service.files===files&&files.prisma===runtime,'NATIVE_DIRECT_REVOCATION_PROVIDER');
   const providerCheck=()=>{needLive();state.checkPublicCertificateContext();need(applicationHandles[0].get(PrismaService)===runtime&&applicationHandles[0].get(PaymentRequestService)===service&&service.prisma===runtime&&service.files===files&&files.prisma===runtime,'NATIVE_DIRECT_REVOCATION_PROVIDER');};
   const revocation=require('./task16-native-voucher-revocation.cjs');
   const diagnose=value=>{if(!receipt.revocationFailure)receipt.revocationFailure=value;};
   const cleanupDiagnostic=value=>{if(!receipt.revocationCleanup)receipt.revocationCleanup=value;};
   const httpDiagnostic=value=>{if(!receipt.revocationHttpFailure)receipt.revocationHttpFailure=value;};
   receipt.revocationHttpObservations=[];
   const httpObservation=value=>{receipt.revocationHttpObservations.push(value);};
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgCF0FAAFYAQDfZmccAAAAAElFTkSuQmCC','base64');
   receipt.revocationPreparation='ENTERED_UNKNOWN_DO_NOT_RETRY';
   const voucher=await wait(()=>revocation.prepareNativeVoucherForRevocation({service,fixture:prepared,password:context.password,voucherBytes:png,diagnose,snapshot:()=>revocation.readVoucherFundingSnapshot({observer,fixture:prepared,known:{observerPid:retained.at(-1).pid,databaseOid:identity.databaseOid,observerOid:retained.at(-1).loginOid},check:providerCheck}),check:providerCheck}));
   const ids={actor:randomUUID(),project:fixturePlan.ids.project,other:randomUUID(),member:randomUUID(),execution:voucher.executionId,file:voucher.fileId,payment:fixturePlan.ids.payment};revocationRouteIds=Object.freeze({execution:ids.execution,file:ids.file});
   const managerPassword=randomBytes(32).toString('hex'),phone='197'+(BigInt('0x'+randomBytes(8).toString('hex'))%100000000n).toString().padStart(8,'0');
   const passwordHash=await wait(()=>require('bcryptjs').hash(managerPassword,12));
   await verifyIdentity();enter('REVOCATION_READER_SEED');await wait(()=>revocation.seedNativeVoucherRevocationReader({owner,ids,phone,passwordHash,check:providerCheck}));
   receipt.revocationPreparation='FIXTURE_RETURNED';enter('REVOCATION_MANAGER_LOGIN');
   const loginUrl=new URL('/auth/login',origin);need(loginUrl.origin===origin,'NATIVE_DIRECT_REVOCATION_LOGIN_ORIGIN');
   const login=await wait(()=>fetch(loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,password:managerPassword}),redirect:'error',signal:AbortSignal.timeout(5000)}));
   need(login.url===loginUrl.href&&!login.redirected&&login.status===201,'NATIVE_DIRECT_REVOCATION_LOGIN');
   const loginBody=await wait(()=>login.json());const token=loginBody?.tokens?.accessToken;need(typeof token==='string'&&token.length>0,'NATIVE_DIRECT_REVOCATION_LOGIN');
   await verifyIdentity();enter('REVOCATION_BEFORE_AFTER_AND_ACCOUNTING');
   const observe=async(sql)=>{needLive();state.checkPublicCertificateContext();return await state.sql(sql);};
   const check=providerCheck;
   let reads=0;const storage=files.storage,originalRead=storage?.read;
   if(selection.disabled){need(storage&&typeof originalRead==='function'&&!Object.hasOwn(storage,'read'),'NATIVE_DIRECT_DISABLED_STORAGE');storage.read=function(...args){reads++;return originalRead.apply(this,args);};}
   let result;
   try{const operation=selection.disabled?revocation.runNativeVoucherDisabled:revocation.runNativeVoucherRevocation;
    result=await wait(()=>operation({ids,origin,token,fileSha256:voucher.fileSha256,fileSize:voucher.fileSize,diagnose,cleanupDiagnostic,httpDiagnostic,httpObservation,known:{databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerOid:identity.ownerOid,sessionPids:retained.map(row=>row.pid)},observe,revoke:observe,transport:(target,init)=>{assertNativeTask16RevocationTarget(origin,ids,target,init.method);return fetch(target,init);},check,...(selection.disabled?{storageReadCount:()=>reads}:{})}));
   }finally{if(selection.disabled)delete storage.read;}
   if(selection.disabled)need(result.authorizedBefore&&result.accountDisabled&&result.membershipUnchanged&&result.oldTicketDenied&&result.storageUnread&&result.observedFactsUnchanged&&equal(posts,[0,0]),'NATIVE_DIRECT_DISABLED_RESULT');
   else need(result.authorizedBefore&&result.capabilityDenied&&result.newTicketDenied&&result.oldTicketDenied&&result.otherProjectReadable&&result.observedFactsUnchanged&&equal(posts,[0,0]),'NATIVE_DIRECT_REVOCATION_RESULT');
   receipt.voucherRevocation=result;receipt.business=selection.disabled?'SYNTHETIC_VOUCHER_DISABLED_RETURNED':'SYNTHETIC_VOUCHER_REVOCATION_RETURNED';await verifyIdentity();return;
  }
  await verifyIdentity();enter('COMPETITION_FOLLOW_UP_REPLAY_GET');
  const controls={lanes,
   async withSamePaymentLock(paymentId,pids,submissions){
    needLive();need(!used&&paymentId===fixturePlan.ids.payment&&equal(pids,retained.slice(1,3).map(row=>row.pid))&&submissions.length===2&&submissions.every(fn=>typeof fn==='function'),'NATIVE_DIRECT_COMPETITION_ARM');
    used=true;armed=true;
    try{
     const responses=await withNativeTask16CompetitionLock(context,{runId:plan.runId},async text=>state.sql(text),needLive,paymentId,retained.slice(0,3),submissions);
     need(responses.length===2&&responses.map(row=>row.status).sort().join(',')==='201,409','NATIVE_DIRECT_COMPETITION_RESPONSES');raceLoser=responses[0].status===201?1:0;receipt.competitionObserved=true;return responses;
    }finally{armed=false;}
   },
   async withFollowUp(index,key,consume){
    needLive();need(used&&!armed&&equal(posts,[1,1])&&followUpLane===undefined&&index===raceLoser&&key===prepared.followUpRequestKey&&typeof consume==='function','NATIVE_DIRECT_FOLLOW_UP_INTENT');followUpLane=index;return consume();
   }
  };
  if(selection.voucher){
   enter('ORIGINAL_THIRTY_YUAN_COMPETITION');
   const race=await wait(()=>cases.runRegisteredTwoActorPaymentCompetition(context,contender,prepared,controls));
   need(used&&!armed&&equal(posts,[1,1])&&equal(followUpPosts,[0,0])&&followUpLane===undefined&&race.passed===true&&race.competitionObserved===true&&race.caseId==='registered.two-actor.payment-competition','NATIVE_DIRECT_VOUCHER_ORIGINAL_RACE');
   const certificate=state.checkPublicCertificateContext();
   const voucher=await wait(()=>require('./task16-current259-payment-competition.cjs').supplementNativeTask16CompetitionVoucher({result:race,prepared,contexts,lanes,
    root,storageRoot:env.FILE_STORAGE_ROOT,resource:{caPath:path.join(root,'ca.crt')},caSha256:certificate.caSha256,
    observe:(text,label)=>{needLive();state.checkPublicCertificateContext();return state.sql(text);},known:retained,
    readLedger:cases.observeRegisteredPaymentVoucherLedger,check:needLive,full:async()=>{needLive();state.checkPublicCertificateContext();await verifyIdentity();},markFailureStage:createNativeTask16VoucherStageRecorder(receipt,enter)}));
   receipt.voucher=voucher;receipt.accounting=writeNativeTask16VoucherAccounting(root,plan.source.head,plan.runId,JSON.stringify({accountingEvidence:race.accountingEvidence,voucher}));
   receipt.business='ORIGINAL_THIRTY_YUAN_COMPETITION_VOUCHER_CASE_RETURNED';await verifyIdentity();await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
   receipt.clients=retained.map(row=>({role:row.loginRole,pid:row.pid,startedAt:row.start,tls:row.tls,clientAddress:row.clientAddress,serverAddress:row.serverAddress,serverPort:row.serverPort}));
   need(finalCatalog.status==='CURRENT259_CATALOG_COMMITTED'||finalCatalog.raw?.reader,'NATIVE_DIRECT_B7_CURRENT');return;
  }
  const result=await wait(()=>cases.runRegisteredTwoActorPaymentCompetitionFollowUp(context,contender,prepared,controls));
  need(used&&!armed&&equal(posts,[1,1])&&equal(followUpPosts,raceLoser===0?[2,0]:[0,2])&&followUpLane===raceLoser&&result.passed===true&&result.competitionObserved===true&&result.fullyPaid===true&&result.caseId==='registered.two-actor.payment-competition-follow-up'&&result.accountingEvidence?.origin==='INDEPENDENT_OBSERVER_REPEATABLE_READ','NATIVE_DIRECT_CASE_RESULT');
  try{receipt.accounting=writeNativeTask16CompetitionAccounting(root,plan.source.head,plan.runId,JSON.stringify(result.accountingEvidence));}catch{receipt.accounting={status:'UNKNOWN_DO_NOT_RETRY'};fail('NATIVE_DIRECT_ACCOUNTING_UNKNOWN');}
  receipt.business='ORIGINAL_COMPETITION_FOLLOW_UP_CASE_RETURNED';await verifyIdentity();await wait(()=>fixture.assertRegisteredPgCompetitionRoles(context,contender,lanes[0]));
  receipt.clients=retained.map(row=>({role:row.loginRole,pid:row.pid,startedAt:row.start,tls:row.tls,clientAddress:row.clientAddress,serverAddress:row.serverAddress,serverPort:row.serverPort}));
  need(finalCatalog.status==='CURRENT259_CATALOG_COMMITTED'||finalCatalog.raw?.reader,'NATIVE_DIRECT_B7_CURRENT');
 }finally{/* The outer owned cleanup restores this environment after app/client closure. */}
}

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function withNativeTask16CompetitionLock(context, resource, observe, check, paymentId, owners, submissions){
 const [owner,...lanes]=owners;
 const protocol=require('./task16-current259-payment-competition.cjs');const sql=protocol.renderNativeTask16CompetitionMonitor(JSON.stringify({owner,lanes,runId:resource.runId})),holdSql=protocol.renderNativeTask16CompetitionHold();
 const ready=deferred(),release=deferred();
 check();
 const transaction=context.owner.$transaction(async tx=>{
  check();
  const rows=await tx.$queryRawUnsafe(holdSql,paymentId);
  check();need(equal(rows,[{id:paymentId,pid:owner.pid,oid:owner.loginOid,databaseOid:owner.databaseOid,start:owner.start,tls:true,sameRole:true}]));
  ready.resolve(true);await release.promise;check();
 });
 const ownerDone=Promise.resolve(transaction).then(()=>({ok:true}),()=>({ok:false}));
 let pending,verified=false,submittedDone=false,writer;
 try{
  const armed=await Promise.race([ready.promise,ownerDone.then(()=>false)]);
  check();need(armed);
  const deadline=performance.now()+5000;
  pending=Promise.allSettled(submissions.map(submit=>Promise.resolve().then(submit))).then(results=>{submittedDone=true;return results;});
  // Start both original submissions before asking the independent backend to observe their waits.
  await Promise.resolve();
  while(!submittedDone&&performance.now()<deadline){
   check();
   const output=await Promise.race([observe(sql,'current259-competition-overlap'),ownerDone.then(()=>null)]);
   check();need(!submittedDone&&performance.now()<deadline&&typeof output?.stdout==='string'&&Buffer.byteLength(output.stdout)<=1024);
   const row=JSON.parse(output.stdout.trim());
   need(typeof row.overlap==='boolean'&&row.databaseOid===owner.databaseOid&&row.systemIdentifier===owner.systemIdentifier&&row.readerOid===owner.loginOid&&row.readerTls===true&&
    Number.isInteger(row.readerPid)&&row.readerPid>0&&owners.every(item=>item.pid!==row.readerPid));
   if(row.overlap){verified=true;break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }finally{
  release.resolve();
  writer=await ownerDone;
  if(!verified&&pending)await pending;
 }
 check();need(verified&&writer.ok);
 const responses=await pending;
 check();need(responses?.length===2&&responses.every(row=>row.status==='fulfilled'));
 return responses.map(row=>row.value);
}


function assertNativeTask16CompetitionTarget(origin,paymentId,resultKeys,target,method){
 need(arguments.length===5&&typeof origin==='string'&&/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(origin)&&typeof paymentId==='string'&&Array.isArray(resultKeys)&&resultKeys.length<=3&&resultKeys.every(key=>typeof key==='string'),'NATIVE_DIRECT_HTTP_ROUTE');
 const url=new URL(target,origin);need(url.origin===origin&&!url.username&&!url.password&&!url.hash,'NATIVE_DIRECT_HTTP_ROUTE');
 if(method==='GET'&&url.pathname==='/payment-executions/recorded-items'){
  need(url.search==='?paymentId='+paymentId,'NATIVE_DIRECT_HTTP_ROUTE');return;
 }
 need(url.search==='','NATIVE_DIRECT_HTTP_ROUTE');
 const allowed=new Set(['POST /auth/login','POST /fund-accounts/openings','GET /payment-executions/work-items','GET /payment-executions/'+paymentId+'/registration-options','POST /payment-executions/'+paymentId+'/registrations',...resultKeys.map(key=>'GET /payment-executions/results/'+key)]);
 need(allowed.has(method+' '+url.pathname),'NATIVE_DIRECT_HTTP_ROUTE');
}

function writeNativeTask16CompetitionAccounting(root,candidateSha,runId,accountingJson){
 need(arguments.length===4&&hex(candidateSha,40)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId)&&typeof accountingJson==='string'&&Buffer.byteLength(accountingJson)<=8192,'NATIVE_DIRECT_ACCOUNTING_INPUT');directory(root);
 const evidence=fixed(JSON.parse(accountingJson),['origin','currency','before','afterCompetition','after','replay','executionId','followUpExecutionId','rootId','debtorCompanyId','creditorCompanyId','debtAmountCents']);
 need(evidence.origin==='INDEPENDENT_OBSERVER_REPEATABLE_READ'&&evidence.currency==='CNY'&&evidence.debtAmountCents==='3000','NATIVE_DIRECT_ACCOUNTING_ORIGIN');
 for(const key of ['executionId','followUpExecutionId','rootId','debtorCompanyId','creditorCompanyId'])need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(evidence[key]),'NATIVE_DIRECT_ACCOUNTING_ID');
 need(evidence.executionId!==evidence.followUpExecutionId&&evidence.debtorCompanyId!==evidence.creditorCompanyId,'NATIVE_DIRECT_ACCOUNTING_ID');
 for(const [key,phase,n,a,b,paid]of [['before','BEFORE',0,'100.0000','100.0000','0'],['afterCompetition','AFTER_COMPETITION',1,'100.0000','70.0000','3000'],['after','AFTER',2,'90.0000','70.0000','4000'],['replay','REPLAY',2,'90.0000','70.0000','4000']]){
  const row=fixed(evidence[key],['phase','balanceAYuan4','balanceBYuan4','paidAmountCents','settlementPaidAmountCents','executionCount','rootCount','fundingCount','allocationCount','eventCount','auditCount','projectFactCount','projectImpactCount']);
  need(equal(row,{phase,balanceAYuan4:a,balanceBYuan4:b,paidAmountCents:paid,settlementPaidAmountCents:paid,executionCount:n,rootCount:n?1:0,fundingCount:n,allocationCount:n,eventCount:n,auditCount:n,projectFactCount:0,projectImpactCount:0}),'NATIVE_DIRECT_ACCOUNTING_COUNTS');
 }
 const bytes=Buffer.from(JSON.stringify({schemaVersion:1,purpose:PURPOSE,candidateSha,runId,caseId:'registered.two-actor.payment-competition-follow-up',accountingEvidence:evidence})+'\n');need(bytes.length<=8192,'NATIVE_DIRECT_ACCOUNTING_BYTES');return writeNew(root,'accounting-evidence.json',bytes);
}

function validateNativeTask16CashAccounting(accountingJson){
 need(arguments.length===1&&typeof accountingJson==='string'&&Buffer.byteLength(accountingJson)<=8192,'NATIVE_DIRECT_CASH_ACCOUNTING');
 const e=fixed(JSON.parse(accountingJson),['origin','currency','before','after','replay','cashAccountId','paymentFactId','executionId','settlementFactId','costCents']);
 need(e.origin==='INDEPENDENT_OBSERVER_REPEATABLE_READ'&&e.currency==='CNY'&&e.costCents==='4000','NATIVE_DIRECT_CASH_ACCOUNTING');
 for(const key of ['cashAccountId','paymentFactId','executionId','settlementFactId'])need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(e[key]),'NATIVE_DIRECT_CASH_ACCOUNTING');
 need(new Set([e.cashAccountId,e.paymentFactId,e.executionId,e.settlementFactId]).size===4,'NATIVE_DIRECT_CASH_ACCOUNTING');
 for(const [key,phase,done]of [['before','BEFORE',false],['after','AFTER',true],['replay','REPLAY',true]]){
  const row=fixed(e[key],['phase','balanceAYuan4','balanceBYuan4','paidAmountCents','settlementPaidAmountCents','executionCount','rootCount','fundingCount','allocationCount','eventCount','auditCount','projectFactCount','projectImpactCount']);
  const n=done?1:0,paid=done?'4000':'0';
  need(equal(row,{phase,balanceAYuan4:'100.0000',balanceBYuan4:done?'60.0000':'100.0000',paidAmountCents:paid,settlementPaidAmountCents:paid,executionCount:n,rootCount:0,fundingCount:n,allocationCount:n,eventCount:n,auditCount:n,projectFactCount:n,projectImpactCount:done?2:0}),'NATIVE_DIRECT_CASH_ACCOUNTING');
 }
 return e;
}

function writeNativeTask16CashAccounting(root,plan,result){
 need(plan&&hex(plan.source?.head,40)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(plan.runId)&&result?.caseId==='registered.public-cash.payment','NATIVE_DIRECT_CASH_ACCOUNTING_INPUT');
 const accounting=validateNativeTask16CashAccounting(JSON.stringify(result.accountingEvidence));
 return writeNew(root,'accounting-evidence.json',{schemaVersion:1,purpose:CASH_PURPOSE,candidateSha:plan.source.head,runId:plan.runId,caseId:result.caseId,accountingEvidence:accounting});
}
function writeNativeTask16LedgerCompetitionAccounting(root,plan,result,prepared,ids){
 need(plan&&hex(plan.source?.head,40)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(plan.runId)&&result?.caseId==='registered.ledger-payment-competition'&&result.ledgerWitness?.impactCount===3&&typeof prepared?.settlementFactId==='string','NATIVE_DIRECT_LEDGER_ACCOUNTING_INPUT');
 const evidence=validateNativeTask16LedgerCompetitionAccounting(JSON.stringify(result.accountingEvidence),ids);
 return writeNew(root,'accounting-evidence.json',{schemaVersion:1,purpose:LEDGER_COMPETITION_PURPOSE,candidateSha:plan.source.head,runId:plan.runId,caseId:result.caseId,ledgerWitness:result.ledgerWitness,settlementFactId:prepared.settlementFactId,accountingEvidence:evidence});
}
function validateNativeTask16LedgerCompetitionAccounting(accountingJson,ids){
 need(typeof accountingJson==='string'&&Buffer.byteLength(accountingJson)<=8192&&ids&&typeof ids.companyA==='string'&&typeof ids.companyB==='string'&&ids.companyA!==ids.companyB,'NATIVE_DIRECT_LEDGER_ACCOUNTING_INPUT');
 const e=fixed(JSON.parse(accountingJson),['origin','currency','before','after','executionId','rootId','debtorCompanyId','creditorCompanyId','debtAmountCents']);
 need(e.origin==='INDEPENDENT_OBSERVER_REPEATABLE_READ'&&e.currency==='CNY'&&e.debtorCompanyId===ids.companyA&&e.creditorCompanyId===ids.companyB&&e.debtAmountCents==='3000'&&typeof e.executionId==='string'&&typeof e.rootId==='string','NATIVE_DIRECT_LEDGER_ACCOUNTING');
 for(const [key,phase,done]of [['before','BEFORE',false],['after','AFTER',true]]){
  const row=fixed(e[key],['phase','balanceAYuan4','balanceBYuan4','paidAmountCents','settlementPaidAmountCents','executionCount','rootCount','fundingCount','allocationCount','eventCount','auditCount','projectFactCount','projectImpactCount']);
  const n=done?1:0;need(equal(row,{phase,balanceAYuan4:'100.0000',balanceBYuan4:done?'70.0000':'100.0000',paidAmountCents:done?'3000':'0',settlementPaidAmountCents:done?'3000':'0',executionCount:n,rootCount:n,fundingCount:n,allocationCount:n,eventCount:n,auditCount:n,projectFactCount:n,projectImpactCount:done?3:0}),'NATIVE_DIRECT_LEDGER_ACCOUNTING');
 }
 return e;
}
function writeNativeTask16GapAccounting(root,candidateSha,runId,accountingJson){
 need(arguments.length===4,'NATIVE_DIRECT_ACCOUNTING_INPUT');return writeNativeTask16SourceRejectionAccounting(root,candidateSha,runId,accountingJson,false);
}
function writeNativeTask16SourceAccounting(root,candidateSha,runId,accountingJson){
 need(arguments.length===4,'NATIVE_DIRECT_ACCOUNTING_INPUT');return writeNativeTask16SourceRejectionAccounting(root,candidateSha,runId,accountingJson,true);
}
function writeNativeTask16SourceRejectionAccounting(root,candidateSha,runId,accountingJson,insufficient){
 need(arguments.length===5&&hex(candidateSha,40)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId)&&typeof accountingJson==='string'&&Buffer.byteLength(accountingJson)<=8192,'NATIVE_DIRECT_ACCOUNTING_INPUT');directory(root);
 const evidence=fixed(JSON.parse(accountingJson),['origin','currency','before','after','sourceAllocation','ownerUnchanged','originalKeyAbsent']);
 need(evidence.origin==='INDEPENDENT_OBSERVER_AND_OWNER_REPEATABLE_READ'&&evidence.currency==='CNY'&&evidence.ownerUnchanged===true&&evidence.originalKeyAbsent===true,'NATIVE_DIRECT_ACCOUNTING_ORIGIN');
 need(equal(fixed(evidence.sourceAllocation,['basis','balanceCents','projectCents','gapCents']),{basis:'EXACT_OWNER_SOURCE_PREDICATES',balanceCents:'800',projectCents:'500',gapCents:'300'}),'NATIVE_DIRECT_ACCOUNTING_COUNTS');
 for(const [key,phase]of [['before','BEFORE'],['after','AFTER']]){
  const row=fixed(evidence[key],['phase','balanceAYuan4','balanceBYuan4','paidAmountCents','settlementPaidAmountCents','executionCount','rootCount','fundingCount','allocationCount','eventCount','auditCount','projectFactCount','projectImpactCount']);
  need(equal(row,{phase,balanceAYuan4:'100.0000',balanceBYuan4:'8.0000',paidAmountCents:'0',settlementPaidAmountCents:'0',executionCount:0,rootCount:0,fundingCount:0,allocationCount:0,eventCount:0,auditCount:0,projectFactCount:0,projectImpactCount:0}),'NATIVE_DIRECT_ACCOUNTING_COUNTS');
 }
 const bytes=Buffer.from(JSON.stringify({schemaVersion:1,purpose:insufficient?SOURCE_PURPOSE:GAP_PURPOSE,candidateSha,runId,caseId:insufficient?'registered.project-source-insufficient':'registered.project-attribution-gap',accountingEvidence:evidence})+'\n');need(bytes.length<=8192,'NATIVE_DIRECT_ACCOUNTING_BYTES');return writeNew(root,'accounting-evidence.json',bytes);
}

function writeNativeTask16VoucherAccounting(root,candidateSha,runId,accountingJson){
 need(arguments.length===4&&hex(candidateSha,40)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId)&&typeof accountingJson==='string'&&Buffer.byteLength(accountingJson)<=8192,'NATIVE_DIRECT_ACCOUNTING_INPUT');directory(root);
 const value=fixed(JSON.parse(accountingJson),['accountingEvidence','voucher']),evidence=fixed(value.accountingEvidence,['origin','currency','before','after','executionId','rootId','debtorCompanyId','creditorCompanyId','debtAmountCents']);
 need(evidence.origin==='INDEPENDENT_OBSERVER_REPEATABLE_READ'&&evidence.currency==='CNY'&&evidence.debtAmountCents==='3000','NATIVE_DIRECT_ACCOUNTING_ORIGIN');
 for(const key of ['executionId','rootId','debtorCompanyId','creditorCompanyId'])need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(evidence[key]),'NATIVE_DIRECT_ACCOUNTING_ID');
 need(evidence.debtorCompanyId!==evidence.creditorCompanyId,'NATIVE_DIRECT_ACCOUNTING_ID');
 for(const [key,phase,n,b,paid]of [['before','BEFORE',0,'100.0000','0'],['after','AFTER',1,'70.0000','3000']]){
  const row=fixed(evidence[key],['phase','balanceAYuan4','balanceBYuan4','paidAmountCents','settlementPaidAmountCents','executionCount','rootCount','fundingCount','allocationCount','eventCount','auditCount','projectFactCount','projectImpactCount']);
  need(equal(row,{phase,balanceAYuan4:'100.0000',balanceBYuan4:b,paidAmountCents:paid,settlementPaidAmountCents:paid,executionCount:n,rootCount:n,fundingCount:n,allocationCount:n,eventCount:n,auditCount:n,projectFactCount:0,projectImpactCount:0}),'NATIVE_DIRECT_ACCOUNTING_COUNTS');
 }
 const voucher=fixed(value.voucher,['voucherVerified','amountCents','uploadCount','attachCount','fileCount','voucherCount','attachAuditCount','uploadAuditCount','ticketAuditCount','downloadAuditCount','downloadSha256','financialStateUnchanged']);
 need(equal(voucher,{voucherVerified:true,amountCents:'3000',uploadCount:2,attachCount:2,fileCount:1,voucherCount:1,attachAuditCount:1,uploadAuditCount:1,ticketAuditCount:1,downloadAuditCount:1,downloadSha256:'2cd8199aadfabd393418573074b0c3b1671ec159fbea6a3ddb3f0a6e54072041',financialStateUnchanged:true}),'NATIVE_DIRECT_VOUCHER_COUNTS');
 return writeNew(root,'accounting-evidence.json',{schemaVersion:1,purpose:VOUCHER_PURPOSE,candidateSha,runId,caseId:'registered.two-actor.payment-voucher',accountingEvidence:evidence,voucher});
}

function createNativeTask16VoucherStageRecorder(receipt,enter){
 need(arguments.length===2&&receipt&&typeof receipt==='object'&&!types.isProxy(receipt)&&Object.getPrototypeOf(receipt)===Object.prototype&&typeof enter==='function'&&!types.isProxy(enter),'NATIVE_DIRECT_VOUCHER_DIAGNOSTIC');
 const stages=new Set(['LEDGER_BEFORE','OWNER_BEFORE','MULTIPART_UPLOAD','ATTACH','REPEAT_UPLOAD','REPEAT_ATTACH','AUTHORIZED_TICKET','HTTP_DOWNLOAD','ORIGINAL_RESULT','RECORDED_ITEMS','OWNER_AFTER','STORAGE_BYTES','LEDGER_AFTER']);
 return (phase,cleanup)=>{
  need(stages.has(phase),'NATIVE_DIRECT_VOUCHER_DIAGNOSTIC');
  if(cleanup===undefined){enter('VOUCHER_'+phase);return;}
  need(phase==='HTTP_DOWNLOAD','NATIVE_DIRECT_VOUCHER_DIAGNOSTIC');const flags=fixed(cleanup,['cancelFailed','releaseFailed']);
  need(typeof flags.cancelFailed==='boolean'&&typeof flags.releaseFailed==='boolean'&&(flags.cancelFailed||flags.releaseFailed)&&Object.getOwnPropertyDescriptor(receipt,'voucherDownloadCleanup')===undefined,'NATIVE_DIRECT_VOUCHER_DIAGNOSTIC');
  Object.defineProperty(receipt,'voucherDownloadCleanup',{value:Object.freeze(flags),enumerable:true});
 };
}

function createNativeTask16BusinessClients(Client,purpose,urlFor,receipt){
 const selection=nativeTask16CaseSelection(purpose);
 const queryProjection=require('./task16-native-voucher-roster-query.cjs');
 const diagnostic=selection.voucher?queryProjection.createNativeTask16RosterQueryDiagnostic(receipt,()=>receipt.stages.at(-1)?.stage):undefined;
 const cashDiagnostic=selection.cash?queryProjection.createNativeTask16CashPartyDiagnostic(receipt,()=>receipt.stages.at(-1)?.stage):undefined;
 return (selection.competition?['owner','runtime_a','runtime_b','observer']:['owner','runtime','observer']).map(lane=>{
  const logging=selection.cash?queryProjection.nativeTask16CashPartyQueryLogOptions(purpose,lane):queryProjection.nativeTask16VoucherQueryLogOptions(purpose,lane);
  const client=new Client({datasources:{db:{url:urlFor(lane)}},...logging});
  if(logging)client.$on('query',selection.cash?cashDiagnostic:diagnostic.forLane(lane));
  return client;
 });
}
