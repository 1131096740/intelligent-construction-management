#!/usr/bin/env node
'use strict';
// Fixed native diagnostic B. No Docker, relay, old admission token or generic adapter.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {types,isDeepStrictEqual:equal}=require('node:util');
const ROOT=path.resolve(__dirname,'../../..'),PURPOSE='TASK16_NATIVE_DIRECT_CONTROLLED_NAME_V2';
// Root's independently reviewed official16.15/pgcrypto93-file qualification.
const BINARY_QUALIFICATION_SHA='26e93f289366a2f9c60c61b9035849052d59509d54f2c388cbdf7c419d3663a1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(value,code='NATIVE_DIRECT_INPUT')=>{if(!value)fail(code);};
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
 need(p.schemaVersion===2&&p.purpose===PURPOSE&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(p.runId)&&p.database==='jg_task01_'+p.runId.replaceAll('-',''));
 need(equal(fixed(p.limits,['resourceMs','migrationMs','ownerSqlMs','httpMs','commandBytes','ownerSqlBytes']),{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216}));
 need(equal(directory(p.runRoot),p.rootIdentity));return p;
}
function prepareNativeTask16Plan(options){
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
 const prismaTools=resolveNativeTask16PrismaTools(),interfaces=resolveNativeTask16Interfaces();
 const nodeFile=fs.realpathSync(process.execPath),nodeCapture=capture(nodeFile,128*1024*1024);
 const runId=randomUUID(),p={schemaVersion:2,purpose:PURPOSE,runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:o.runRoot,rootIdentity:directory(o.runRoot),source:sourceCapture(),artifacts:compiledMaterials(),dependencies:dependencyDigest(),prismaTools,interfaces,binaryManifest:{file:o.binaryManifest,sha256:manifest.sha256,identity:manifest.identity},binaries,openssl:{file:opensslFile,sha256:openssl.sha256,identity:openssl.identity},externalLibraries,node:{file:nodeFile,sha256:nodeCapture.sha256,identity:nodeCapture.identity,version:process.version,platform:process.platform,arch:process.arch},security:captureNativeTask16Security(),limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},differences:['V2 controlled name policy evidence; SDK direct cause remains unproven','macOS native PG16.15/OpenSSL3/C locale/noICU','Production function reader; no F object-reader private lease wrapper','No Docker CPU/memory/pids/tmpfs enforcement equivalent']};
 validateNativePlan(p);return writeNew(o.runRoot,'plan.json',p);
}
function verifyNativeTask16Plan(file,expected){
 need(process.version==='v20.20.2'&&process.platform==='darwin'&&process.arch==='arm64','NATIVE_DIRECT_RUNTIME');
 need(hex(expected,64));const saved=capture(file,4*1024*1024);need(saved.sha256===expected);const p=validateNativePlan(JSON.parse(saved.bytes));
 need(file===path.join(p.runRoot,'plan.json')&&equal(sourceCapture(),p.source),'NATIVE_DIRECT_SOURCE_CHANGED');
 need(p.binaryManifest.sha256===BINARY_QUALIFICATION_SHA,'NATIVE_DIRECT_BINARY_APPROVAL');
 const qualified=JSON.parse(capture(p.binaryManifest.file,1024*1024).bytes);need(qualified.version==='16.15'&&qualified.versionObserved==='postgres (PostgreSQL) 16.15'&&equal(treeFiles(qualified.privatePrefix),p.binaries),'NATIVE_DIRECT_BINARY_APPROVAL');
 need(equal(compiledMaterials(),p.artifacts)&&equal(dependencyDigest(),p.dependencies),'NATIVE_DIRECT_MATERIAL_CHANGED');
 need(equal(captureNativeTask16Security(),p.security),'NATIVE_DIRECT_SECURITY_CHANGED');
 need(equal(resolveNativeTask16PrismaTools(),p.prismaTools)&&equal(resolveNativeTask16Interfaces(),p.interfaces),'NATIVE_DIRECT_PRISMA_OR_INTERFACE_CHANGED');
 for(const row of [...p.binaries,p.openssl,...p.externalLibraries,p.binaryManifest,p.node]){if(row.link){need(fs.readlinkSync(row.link)===row.target,'NATIVE_DIRECT_MATERIAL_CHANGED');continue;}const now=capture(row.file,128*1024*1024);need(now.sha256===row.sha256&&equal(now.identity,row.identity),'NATIVE_DIRECT_MATERIAL_CHANGED');}
 need(p.node.file===fs.realpathSync(process.execPath)&&p.node.version===process.version&&p.node.platform===process.platform&&p.node.arch===process.arch,'NATIVE_DIRECT_RUNTIME');return p;
}
function parse(args){
 need(Array.isArray(args)&&args.every(x=>typeof x==='string'),'NATIVE_DIRECT_ARGUMENTS');
 if(args[0]==='--prepare'&&args.length===9&&args[1]==='--run-root'&&args[3]==='--binary-manifest'&&args[5]==='--expected-binary-sha256'&&args[7]==='--output')return {mode:'prepare',options:{runRoot:args[2],binaryManifest:args[4],binaryManifestSha256:args[6],output:args[8]}};
 if(['--verify','--once'].includes(args[0])&&args.length===5&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256')return {mode:args[0].slice(2),file:args[2],sha256:args[4]};
 fail('NATIVE_DIRECT_ARGUMENTS');
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
function inspectNativeTask16Interfaces(){
 // Fixed source-owned list, matching the original application factory/main.
 // Read exports only: never construct a client, assemble Nest, or call a route.
 const specs=[
  ['./local-staged-migration-controls.cjs',[['inspectSql',0],['setupSql',1],['checkSetup',2],['readbackSql',2],['parseReadback',1],['checkCompletion',3],['cleanupSql',2],['cleanReadSql',2]]],
  ['./local-staged-tail-qualification.cjs',[['createLocalTailQualification',2]]],
  ['./task16-current259-role-provision.cjs',[['renderNativeTask16RoleRead',2],['renderNativeTask16RoleInstall',3],['parseNativeTask16RoleRead',3]]],
  ['./task16-current259-seven-install.cjs',[['renderNativeTask16Seven',4],['parseNativeTask16Seven',4]]],
  ['./task16-current259-runtime-acl.cjs',[['renderCurrent259RuntimeAcl',3]]],
  ['./task16-current259-public-access.cjs',[['renderCurrent259PublicAccess',1]]],
  ['./task16-current259-catalog.cjs',[['loadCurrent259CatalogMaterial',2],['renderCurrent259CatalogRead',1],['parseCurrent259CatalogRead',3],['describeNativeTask16CatalogFailure',3],['renderCurrent259B7Install',1]]],
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
  ['../dist/database/registered-payment-postgres.fixture.js',[['buildRegisteredPgFixturePlan',3],['seedRegisteredPgFixture',3],['assertRegisteredPgConnectedRoles',2]]],
  ['../dist/database/registered-payment-postgres.cases.js',[['runRegisteredNullCrossCompanyCommit',3]]],
  ['@prisma/client',[['PrismaClient',1]]],
  ['@nestjs/testing/test.js',[['Test',0]]],
  ['@nestjs/testing',[['Test',0]]]
 ];
 return Object.freeze(specs.map(([specifier,exports])=>{
  const file=fs.realpathSync(require.resolve(specifier));need(file.startsWith(ROOT+'/'),'NATIVE_DIRECT_INTERFACE_PATH');const before=capture(file,64*1024*1024),loaded=require(specifier);
  const shapes=exports.map(([name,expected])=>{const d=Object.getOwnPropertyDescriptor(loaded,name);need(d,'NATIVE_DIRECT_INTERFACE_EXPORT');let value;if(Object.hasOwn(d,'value'))value=d.value;else {need(specifier==='@nestjs/testing'&&name==='Test'&&typeof d.get==='function'&&d.set===undefined,'NATIVE_DIRECT_INTERFACE_EXPORT');value=loaded.Test;need(value===require('@nestjs/testing/test.js').Test,'NATIVE_DIRECT_INTERFACE_EXPORT');}const kind=typeof value;need(typeof expected==='number'?kind==='function'&&value.length===expected:kind===expected,'NATIVE_DIRECT_INTERFACE_EXPORT');
   if(name==='Test'){const method=Object.getOwnPropertyDescriptor(value,'createTestingModule');need(method&&Object.hasOwn(method,'value')&&typeof method.value==='function'&&method.value.length===1,'NATIVE_DIRECT_INTERFACE_EXPORT');}
   return Object.freeze({name,kind,...(kind==='function'?{arity:value.length}:{})});});
  const after=capture(file,64*1024*1024);need(before.sha256===after.sha256&&equal(before.identity,after.identity),'NATIVE_DIRECT_INTERFACE_CHANGED');return Object.freeze({file,sha256:after.sha256,identity:after.identity,exports:Object.freeze(shapes)});
 }));
}
function resolveNativeTask16Interfaces(){
 // Discard qualification-only module state in a fixed read-only child. Actual
 // business still sets its real temporary environment before importing Nest.
 const source='const value=require('+JSON.stringify(__filename)+').inspectNativeTask16Interfaces();process.stdout.write(JSON.stringify(value));';
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
 need(provisioned?.paymentProfile==='TASK16_PAYMENT261_RUNTIME_V1'&&id?.tls===true&&id.clientAddress==='127.0.0.1'&&id.serverAddress==='127.0.0.1'&&Number.isInteger(id.serverPort)&&id.serverPort>1024&&id.serverPort<=65535&&id.serverPort!==5432,'NATIVE_DIRECT_ACL_ENDPOINT');
 const rendered=require('./task16-current259-runtime-acl.cjs').renderCurrent259RuntimeAcl(source,provisioned,nonce);
 const original="pg_catalog.host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1'\n    OR pg_catalog.host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'\n    OR inet_server_port() IS DISTINCT FROM 5432";
 const parts=rendered.sql.split(original);
 need(parts.length===2&&(rendered.sql.match(/inet_server_port\(\)/gu)||[]).length===1&&['readbackSql','witnessSql'].every(field=>typeof rendered[field]==='string'&&!rendered[field].includes('inet_server_port(')),'NATIVE_DIRECT_ACL_ENDPOINT_RENDER');
 const sql=parts.join(original.replace('5432',String(id.serverPort)));
 // Match the original payment ACL transaction: runtime ACL, then its public-access closure.
 const publicOriginal=require('./task16-current259-public-access.cjs').renderCurrent259PublicAccess(provisioned),publicParts=publicOriginal.split(original);
 need(publicParts.length===2&&(publicOriginal.match(/inet_server_port\(\)/gu)||[]).length===1,'NATIVE_DIRECT_PUBLIC_ENDPOINT_RENDER');
 const publicSql=publicParts.join(original.replace('5432',String(id.serverPort)));
 return Object.freeze({...rendered,sql,publicSql,writeSql:sql+'\n'+publicSql});
}
module.exports=Object.freeze({captureNativeTask16Security,projectNativeTask16SecurityPolicy,controlledNativeTask16NameResult,projectNativeTask16TlsWords,parseNativeTask16CatalogRead,renderNativeTask16RuntimeAcl,inspectNativeTask16Interfaces,resolveNativeTask16PrismaTools,resolveNativeTask16Interfaces,nativeTask16FixtureDates,nativeTask16QualifiedModeMatches,assertNativeTask16LogIdentity,projectNativeTask16PlaintextHba,verifyNativeTask16LocalhostAnswers,classifyNativeTask16TlsFailure,trackNativeTask16Child,waitNativeTask16Operation,prepareNativeTask16Plan,verifyNativeTask16Plan,validateNativePlan});
if(require.main===module){(async()=>{let request;request=parse(process.argv.slice(2));if(request.mode==='prepare')return {status:'NATIVE_DIRECT_PREPARED_NO_RESOURCES',...prepareNativeTask16Plan(request.options)};
 const plan=verifyNativeTask16Plan(request.file,request.sha256);if(request.mode==='verify')return {status:'NATIVE_DIRECT_VERIFIED_NO_RESOURCES',candidateSha:plan.source.head};
 return await executeNativeTask16Once(plan,request.sha256);
})().then(result=>{process.exitCode=result.status==='STOPPED'?1:0;process.stdout.write(JSON.stringify(result)+'\n',()=>{if(process.argv[2]==='--once')process.exit(process.exitCode);});},error=>{const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:typeof code==='string'&&/^NATIVE_DIRECT_[A-Z_]+$/u.test(code)?code:'NATIVE_DIRECT_INPUT'})+'\n');process.exitCode=1;});}

async function executeNativeTask16Once(plan,planSha256){
 need(require.main===module&&process.execArgv.length===0&&!process._preload_modules?.length&&!Object.hasOwn(process.env,'NODE_OPTIONS')&&!Object.hasOwn(process.env,'NODE_PATH'),'NATIVE_DIRECT_FRESH_MAIN');
 need(equal(fs.readdirSync(plan.runRoot).sort(),['plan.json']),'NATIVE_DIRECT_ROOT_NOT_UNUSED');
 writeNew(plan.runRoot,'started.json',{purpose:PURPOSE,planSha256,candidateSha:plan.source.head,startedAt:new Date().toISOString(),pid:process.pid});
 const {spawn}=require('node:child_process');
 const root=plan.runRoot,runId=plan.runId,db=plan.database,prefix=path.dirname(path.dirname(plan.binaries.find(row=>row.file?.endsWith('/bin/postgres')).file));
 const owner='jg_task01_owner',credentials=Object.fromEntries(['owner','runtime','observer'].map(k=>[k,randomBytes(48).toString('hex')]));
 const receipt={schemaVersion:2,purpose:PURPOSE,planSha256,candidateSha:plan.source.head,runId,status:'STOPPED',business:'NOT_ENTERED',stages:[],differences:plan.differences,cleanup:{status:'NOT_NEEDED'},financialAcceptance:false};
 const started=Date.now(),deadline=started+plan.limits.resourceMs;let stage='INIT',closing=false,pending=0,pgStarted=false,pgPid,pgStart,pgChild,pgLifetime,pgLogIdentity,app,moduleRef,restoreEnvironment,clients=[],port,dbReady=false,publicCertificateBinding;
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
  enter('TLS_AND_INITDB');for(const dir of ['socket','storage','prefixes'])fs.mkdirSync(path.join(root,dir),{mode:0o700});
  for(const name of ['ca','wrong-ca']){await openssl(['req','-new','-newkey','rsa:2048','-nodes','-x509','-sha256','-days','2','-subj','/CN=native-'+name+'-'+runId,'-keyout',path.join(root,name+'.key'),'-out',path.join(root,name+'.crt')]);fs.chmodSync(path.join(root,name+'.key'),0o600);fs.chmodSync(path.join(root,name+'.crt'),0o600);}
  writeNew(root,'server.ext','subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  await openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=native-'+runId,'-keyout',path.join(root,'server.key'),'-out',path.join(root,'server.csr')]);fs.chmodSync(path.join(root,'server.key'),0o600);
  await openssl(['x509','-req','-sha256','-days','2','-in',path.join(root,'server.csr'),'-CA',path.join(root,'ca.crt'),'-CAkey',path.join(root,'ca.key'),'-set_serial','1','-extfile',path.join(root,'server.ext'),'-out',path.join(root,'server.crt')]);fs.chmodSync(path.join(root,'server.crt'),0o600);
  writeNew(root,'initdb.secret',credentials.owner+'\n');
  try{await command(bin('initdb'),['-D',path.join(root,'data'),'-U',owner,'--encoding=UTF8','--locale=C','--auth-local=peer','--auth-host=scram-sha-256','--pwfile',path.join(root,'initdb.secret')]);}finally{fs.unlinkSync(path.join(root,'initdb.secret'));}
  port=await connectPort();need(port>1024&&port!==5432,'NATIVE_DIRECT_PORT');
  const hba=`local all ${owner} peer map=native_owner\nlocal all all reject\nhostnossl all all 127.0.0.1/32 reject\nhostssl all ${owner} 127.0.0.1/32 scram-sha-256\nhostssl ${db} jg_task01_runtime,jg_task01_observer 127.0.0.1/32 scram-sha-256\nhostssl all all 127.0.0.1/32 reject\n`;
  fs.writeFileSync(path.join(root,'data/pg_hba.conf'),hba,{mode:0o600});fs.writeFileSync(path.join(root,'data/pg_ident.conf'),`native_owner ${os.userInfo().username} ${owner}\n`,{mode:0o600});
  const config=`listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories='${root}/socket'\nssl=on\nssl_min_protocol_version='TLSv1.2'\nssl_cert_file='${root}/server.crt'\nssl_key_file='${root}/server.key'\npassword_encryption='scram-sha-256'\nmax_connections=16\nshared_buffers='64MB'\nmax_wal_size='64MB'\nmin_wal_size='32MB'\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length_on_error=0\nlog_error_verbosity='terse'\nlog_duration=off\nlog_min_duration_statement=-1\nlog_min_duration_sample=-1\nlog_transaction_sample_rate=0\nlogging_collector=off\nlog_destination='stderr'\nlog_line_prefix='NATIVE_TASK16 [%p] '\nlc_messages='C'\nstatement_timeout='60s'\n`;
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
  need(Number(pidRows[0])===pgPid&&pidRows[1]===path.join(root,'data')&&Number(pidRows[3])===port&&Number(pidRows[2])>=Math.floor(started/1000),'NATIVE_DIRECT_PG_IDENTITY');pgStart=pidRows[2];pgStarted=true;receipt.resource={pid:pgPid,startEpoch:pgStart,host:'127.0.0.1',port,database:db};writeNew(root,'resource-ready.json',{purpose:PURPOSE,candidateSha:plan.source.head,planSha256,runId,pid:pgPid,startEpoch:pgStart,host:'127.0.0.1',port,database:db,status:'POSTGRES_READY_NOT_BUSINESS_ADMISSION'});
  enter('TLS_NEGATIVES');const positive=await jsonSql("SELECT jsonb_build_object('version',current_setting('server_version_num'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'client',host(inet_client_addr()),'server',host(inet_server_addr()),'port',inet_server_port());",{database:'postgres'});need(positive.version==='160015'&&positive.tls===true&&positive.client==='127.0.0.1'&&positive.server==='127.0.0.1'&&positive.port===port,'NATIVE_DIRECT_TLS');
  for(const extra of [{PGSSLROOTCERT:path.join(root,'wrong-ca.crt')},{PGHOST:'127.0.0.2',PGHOSTADDR:'127.0.0.1'},{PGSSLMODE:'disable'}])need((await sql('SELECT 1;',{database:'postgres',extra,allowFailure:true})).code!==0,'NATIVE_DIRECT_TLS_NEGATIVE');receipt.tls={correct:true,wrongCaRejected:true,wrongSanRejected:true,noTlsRejected:true};
  await sql(`CREATE DATABASE ${db} OWNER ${owner} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';`,{database:'postgres'});dbReady=true;
  const locale=await jsonSql("SELECT jsonb_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',datlocprovider) FROM pg_database WHERE datname=current_database();");need(equal(locale,{encoding:'UTF8',collate:'C',ctype:'C',provider:'c'}),'NATIVE_DIRECT_LOCALE');receipt.locale=locale;
  enter('MIGRATIONS');const migration=await migrateNativeTask16(plan,root,port,credentials.owner,sql,jsonSql,command,enter);receipt.migrationMaterials=migration.materials;
  enter('ROLES');const roles=require('./task16-current259-role-provision.cjs'),nonce=randomBytes(32).toString('hex');
  const roleIdentity=await jsonSql(`SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'clientAddress',host(inet_client_addr()),'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port()) FROM pg_database d WHERE d.datname=current_database();`);
  need(roleIdentity.ownerOid==='10'&&roleIdentity.actorOid==='10'&&roleIdentity.tls===true&&roleIdentity.clientAddress==='127.0.0.1'&&roleIdentity.serverAddress==='127.0.0.1'&&roleIdentity.serverPort===port,'NATIVE_DIRECT_OWNER');
  const roleScope=JSON.stringify({identity:roleIdentity,app:{name:migration.plan.appName,oid:migration.setup.appOid,nonce:migration.plan.nonce},ledger:plan.source.witness.profile.ledger,competition:false});
  const before=(await sql(roles.renderNativeTask16RoleRead(migration.setup.appOid,null))).stdout;roles.parseNativeTask16RoleRead(roleScope,before,'before');
  const staged=(await sql(roles.renderNativeTask16RoleInstall(roleScope,before,{runtime:credentials.runtime,observer:credentials.observer}))).stdout;const stagedRow=roles.parseNativeTask16RoleRead(roleScope,staged,'install',before);
  const committed=(await sql(roles.renderNativeTask16RoleRead(migration.setup.appOid,stagedRow.writeXid))).stdout;const roleRow=roles.parseNativeTask16RoleRead(roleScope,committed,'committed',before,staged);
  need(roleRow.state.roles.length===9,'NATIVE_DIRECT_NINE_ROLES');
  const provisioned={status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:plan.source.head,runId,databaseIdentity:roleIdentity,ordinary:roleRow.state.app,roles:roleRow.state.roles,commitXid:stagedRow.writeXid,databaseAcl:{before:JSON.parse(before).state.databases,after:roleRow.state.databases},paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'};
  enter('SEVEN_FRAGMENTS');const seven=require('./task16-current259-seven-install.cjs');
  const sevenInput=JSON.stringify({source:plan.source.witness,id:roleIdentity,ordinary:provisioned.ordinary,runtime:provisioned.roles.find(r=>r.name==='jg_task01_runtime'),observer:provisioned.roles.find(r=>r.name==='jg_task01_observer'),roleCommitXid:provisioned.commitXid,databaseAclAfter:provisioned.databaseAcl.after});
  const sevenRaw=[],sevenRows=[];for(let phase=0;phase<3;phase++){const out=(await sql(seven.renderNativeTask16Seven(sevenInput,phase,nonce,phase===0?null:sevenRaw[phase-1]))).stdout;sevenRaw.push(out);sevenRows.push(seven.parseNativeTask16Seven(sevenInput,phase,nonce,out));}
  need(sevenRows[1].installXid!==provisioned.commitXid&&sevenRows[1].catalogSha256!==sevenRows[0].catalogSha256&&sevenRows[2].installXid===sevenRows[1].installXid&&sevenRows[2].catalogSha256===sevenRows[1].catalogSha256&&new Set(sevenRows.map(row=>row.backendPid)).size===3&&new Set(sevenRows.map(row=>row.backendStart)).size===3,'NATIVE_DIRECT_SEVEN_COMMIT');
  enter('ACL_AND_B7');const acl=renderNativeTask16RuntimeAcl(JSON.stringify({source:plan.source.witness,provisioned}),nonce);
  enter('ACL_APPLY');await sql('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;\n'+acl.writeSql+'\nCOMMIT;');enter('ACL_READBACK');await sql(acl.readbackSql);
  const catalog=require('./task16-current259-catalog.cjs'),source=plan.source.code;
  const identity={runId,database:db,databaseOid:roleIdentity.databaseOid,namespaceOid:roleIdentity.namespaceOid,ownerOid:'10',systemIdentifier:roleIdentity.systemIdentifier,runtimeOid:provisioned.roles.find(r=>r.name==='jg_task01_runtime').oid,observerOid:provisioned.roles.find(r=>r.name==='jg_task01_observer').oid,paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'};
  const request={source,identity,nonce,phase:'before'};enter('B7_BEFORE_RENDER');const beforeSql=catalog.renderCurrent259CatalogRead(request);
  enter('B7_BEFORE_QUERY');const beforeRaw=(await sql(beforeSql)).stdout;enter('B7_BEFORE_VALIDATE');const beforeCatalog=parseNativeTask16CatalogRead(beforeRaw,request,undefined,receipt);
  enter('B7_INSTALL_RENDER');const b7Sql=catalog.renderCurrent259B7Install({source,identity,nonce,before:beforeCatalog});
  enter('B7_INSTALL_QUERY');const stagedRaw=(await sql(b7Sql)).stdout;enter('B7_STAGED_VALIDATE');const stagedCatalog=parseNativeTask16CatalogRead(stagedRaw,{...request,phase:'staged'},beforeCatalog,receipt);
  const finalRequest={...request,phase:'committed',installXid:stagedCatalog.raw.writeXid};enter('B7_COMMITTED_RENDER');const finalSql=catalog.renderCurrent259CatalogRead(finalRequest);
  enter('B7_COMMITTED_QUERY');const finalRaw=(await sql(finalSql)).stdout;enter('B7_COMMITTED_VALIDATE');const finalCatalog=parseNativeTask16CatalogRead(finalRaw,finalRequest,stagedCatalog,receipt);
  receipt.installation={migrations:261,roles:9,sevenCommitXid:sevenRows[2].installXid,b7CommitXid:stagedCatalog.raw.writeXid,catalogSha256:hash(Buffer.from(JSON.stringify(finalCatalog.raw)))};
  need(equal(sourceCapture(),plan.source)&&equal(compiledMaterials(),plan.artifacts)&&equal(dependencyDigest(),plan.dependencies),'NATIVE_DIRECT_SOURCE_CHANGED');
  receipt.directoryBytesBeforeBusiness=nativeDirectoryBytes(root);
  enter('REAL_CLIENTS_NEST_AND_CASE');await wait(()=>runNativeTask16Business(plan,{root,port,credentials,identity,finalCatalog,sql,jsonSql,needLive,wait,cleanupWait,enter,receipt,checkPublicCertificateContext,command,logIdentity:pgLogIdentity,setRestoreEnvironment:value=>{restoreEnvironment=value;},setClients:value=>{clients=value;},setApplication:(a,m)=>{app=a;moduleRef=m;}}));
  need(equal(sourceCapture(),plan.source)&&equal(compiledMaterials(),plan.artifacts)&&equal(dependencyDigest(),plan.dependencies),'NATIVE_DIRECT_SOURCE_CHANGED');receipt.status='NATIVE_DIRECT_CASE_RETURNED_NOT_FULL_ACCEPTANCE';
 }catch(error){const code=error&&!types.isProxy(error)?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;receipt.failure={stage,code:typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(code)?code:'UNKNOWN',elapsedMs:Date.now()-started};receipt.status='STOPPED';}
 finally{
  closing=true;const errors=[];
  if(app)try{await cleanupWait(()=>app.close());}catch{errors.push('APPLICATION_CLOSE_UNKNOWN');}
  if(moduleRef)try{await cleanupWait(()=>moduleRef.close());}catch{errors.push('MODULE_CLOSE_UNKNOWN');}
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
  receipt.cleanup={status:errors.length?'UNKNOWN':'COMPLETED',failures:errors};if(errors.length)receipt.status='STOPPED';receipt.elapsedMs=Date.now()-started;
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
 const env={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:path.join(root,'storage'),JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),FILE_DOWNLOAD_SECRET:randomBytes(32).toString('hex')};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));state.setRestoreEnvironment(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});for(const [k,v]of Object.entries(env))process.env[k]=v;
 try{
  const {PrismaClient}=require('@prisma/client');
  const controllerAborted=error=>Object.getOwnPropertyDescriptor(error??{},'code')?.value==='NATIVE_DIRECT_DEADLINE';
  const urlFor=kind=>{const url=new URL('postgresql://jg_task01_'+kind+'@127.0.0.1:'+port+'/'+plan.database);url.password=credentials[kind];for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5',application_name:'native_task16_'+plan.runId.replaceAll('-','')+'_'+kind}))url.searchParams.set(key,value);return url.toString();};
  const clients=['owner','runtime','observer'].map(kind=>new PrismaClient({datasources:{db:{url:urlFor(kind)}}}));state.setClients(clients);
  await wait(()=>Promise.all(clients.map(client=>client.$connect())));
  const [owner,runtime,observer]=clients,identitySql=require('./task16-current259-session-identity.cjs').current259ClientIdentitySql;
  let retained;
  const verifyIdentity=async()=>{
   needLive();const nonce=randomBytes(32).toString('hex');const rows=await wait(()=>Promise.all(clients.map(client=>client.$queryRawUnsafe(identitySql,nonce))));
   need(rows.every((result,i)=>result.length===1&&result[0].database===plan.database&&result[0].databaseOid===identity.databaseOid&&result[0].systemIdentifier===identity.systemIdentifier&&result[0].effectiveRole==='jg_task01_'+['owner','runtime','observer'][i]&&result[0].loginRole===result[0].effectiveRole&&result[0].effectiveOid===result[0].loginOid&&result[0].tls===true&&result[0].version===160015&&result[0].encoding==='UTF8'&&result[0].replication==='origin'&&result[0].clientAddress==='127.0.0.1'&&result[0].serverAddress==='127.0.0.1'&&result[0].serverPort===port&&result[0].nonce===nonce&&result[0].readOnly===(i===2?'on':'off')),'NATIVE_DIRECT_CLIENT_IDENTITY');
   need(new Set(rows.map(r=>r[0].pid)).size===3&&new Set(rows.map(r=>r[0].loginOid)).size===3&&new Set(rows.map(r=>r[0].clientPort)).size===3,'NATIVE_DIRECT_CLIENT_SEPARATION');
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
   const originalRuntimeUrl=urlFor('runtime'),url=new URL(originalRuntimeUrl);if(mode==='wrong-ca')url.searchParams.set('sslcert',path.join(root,'wrong-ca.crt'));else if(mode==='no-tls')url.searchParams.set('sslmode','disable');else url.hostname='localhost';
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
  const module=await wait(()=>Test.createTestingModule({imports:[Task16RegisteredApplicationModule]}).overrideProvider(PrismaService).useValue(runtime).overrideProvider(Task16ImpactReaderToken).useValue(readTask16RegisteredPaymentImpacts).compile(),late=>cleanupWait(()=>late.close()));state.setApplication(undefined,module);
  const app=module.createNestApplication();state.setApplication(app,module);
  need(module.get(PrismaService)===runtime&&module.get(Task16ImpactReaderToken)===readTask16RegisteredPaymentImpacts&&app.get(PrismaService)===runtime&&app.get(Task16ImpactReaderToken)===readTask16RegisteredPaymentImpacts,'NATIVE_DIRECT_REAL_PROVIDERS');
  require('../dist/api-security.js').configureApiSecurity(app);require('../dist/operating-projection/projection-export-json.js').configureProjectionExportJson(app);
  app.getHttpAdapter().getInstance().set('json replacer',require('../dist/api-json-replacer.js').apiJsonReplacer);app.enableCors({origin:[],credentials:false});app.useGlobalPipes(require('../dist/validation/api-validation.js').createApiValidationPipe());
  await wait(()=>app.init());await wait(()=>require('../dist/api-listen.js').listenApi(app,0,'127.0.0.1'));
  const address=app.getHttpServer().address();need(address.address==='127.0.0.1'&&address.family==='IPv4'&&address.port>1024,'NATIVE_DIRECT_HTTP_ENDPOINT');
  const origin='http://127.0.0.1:'+address.port;
  const catalog=require('./task16-current259-catalog.cjs'),material=catalog.loadCurrent259CatalogMaterial(plan.source.code,'TASK16_PAYMENT261_RUNTIME_V1');
  const proof=Object.freeze({authorizationReference:'root-native-plan-sha256:'+receipt.planSha256,runId:plan.runId.replaceAll('-','').slice(0,12),resourceRunId:plan.runId,databaseName:plan.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,host:'127.0.0.1',port,ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',sourceSealSha256:plan.source.code.sealSha256,preparedSqlSha256:Object.freeze(Object.fromEntries(material.sevenFragments.map(row=>[path.basename(row.path),row.sha256]))),transport:'isolated-loopback-tls-verify-full',application:Object.freeze({origin,databaseRole:'jg_task01_runtime',sourceSealSha256:plan.source.code.sealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'})});
  const context=Object.freeze({proof,owner,runtime,observer,password:randomBytes(32).toString('hex'),httpTimeoutMs:5000});
  const fixture=require('../dist/database/registered-payment-postgres.fixture.js'),cases=require('../dist/database/registered-payment-postgres.cases.js');
  const dates=nativeTask16FixtureDates(Date.now());const fixturePlan=fixture.buildRegisteredPgFixturePlan(proof.runId,dates.paidAt,dates.openingDate);receipt.fixtureDates=dates;
  const allowed=new Set(['POST /auth/login','POST /fund-accounts/openings','GET /payment-executions/'+fixturePlan.ids.payment+'/registration-options','POST /payment-executions/'+fixturePlan.ids.payment+'/registrations','GET /payment-executions/results/'+fixturePlan.ids.requestKey]);
  const assertTarget=(target,method)=>{needLive();const url=new URL(target,origin);need(url.origin===origin&&!url.username&&!url.password&&!url.hash&&allowed.has(method+' '+url.pathname),'NATIVE_DIRECT_HTTP_ROUTE');};
  const requestCurrent261SeedJson=require('./task16-current261-seed-json.cjs').requestCurrent261SeedJson;
  const continuity={seedProfile:'TASK16_PAYMENT261_RUNTIME_V1',checkLight:needLive,assertHttpRequest:(route,method)=>assertTarget(route,method),fetch:async(target,init)=>{assertTarget(target,init.method??'GET');return fetch(target,init);},requestJson:async(target,init,timeout)=>{assertTarget(target,init.method??'GET');need(timeout===5000&&!Object.hasOwn(init,'signal'),'NATIVE_DIRECT_HTTP_TIMEOUT');return requestCurrent261SeedJson(target,init,timeout);},recordSeedFailure:(failedStage,code,status)=>{if(!receipt.seedFailure)receipt.seedFailure={stage:failedStage,code:typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(code)?code:'UNKNOWN',...(Number.isInteger(status)?{httpStatus:status}:{})};}};
  await wait(()=>fixture.assertRegisteredPgConnectedRoles(context,continuity));enter('SEED_LOGIN_AND_OPENINGS');receipt.business='ENTERED';
  const prepared=await wait(()=>fixture.seedRegisteredPgFixture(context,fixturePlan,continuity));receipt.loginAndOpenings='ORIGINAL_FIXTURE_RETURNED';
  await verifyIdentity();enter('NORMAL_PAYMENT_REPLAY_GET');const result=await wait(()=>cases.runRegisteredNullCrossCompanyCommit(context,prepared,continuity));
  need(result.passed===true&&result.caseId==='registered.null-cross-company.commit'&&result.accountingEvidence?.origin==='INDEPENDENT_OBSERVER_REPEATABLE_READ','NATIVE_DIRECT_CASE_RESULT');
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,purpose:PURPOSE,candidateSha:plan.source.head,runId:plan.runId,accountingEvidence:result.accountingEvidence})+'\n');need(bytes.length<=8192,'NATIVE_DIRECT_ACCOUNTING_BYTES');
  try{receipt.accounting=writeNew(root,'accounting-evidence.json',bytes);}catch{receipt.accounting={status:'UNKNOWN_DO_NOT_RETRY'};fail('NATIVE_DIRECT_ACCOUNTING_UNKNOWN');}
  receipt.business='ORIGINAL_NORMAL_CASE_RETURNED';await verifyIdentity();await wait(()=>fixture.assertRegisteredPgConnectedRoles(context,continuity));
  receipt.clients=retained.map(row=>({role:row.loginRole,pid:row.pid,startedAt:row.start,tls:row.tls,clientAddress:row.clientAddress,serverAddress:row.serverAddress,serverPort:row.serverPort}));
  need(finalCatalog.status==='CURRENT259_CATALOG_COMMITTED'||finalCatalog.raw?.reader,'NATIVE_DIRECT_B7_CURRENT');
 }finally{/* The outer owned cleanup restores this environment after app/client closure. */}
}
