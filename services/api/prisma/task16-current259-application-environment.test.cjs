"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const KEYS=['NODE_ENV','SMS_ENABLED','APPROVAL_SMS_ENABLED','FILE_STORAGE_DRIVER','FILE_STORAGE_ROOT','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'];
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jg-env-model-'))),handle=Object.freeze({});fs.chmodSync(root,0o700);
 const resource=path.join(root,'resource');fs.mkdirSync(resource,{mode:0o700});
 const view={resource:{caPath:path.join(resource,'tls-private','ca.crt')},source:{candidateSha:'a'.repeat(40)},runId:'model',check(){},verifyFull(){}};
 const holder={exports:{}};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task16-current259-application-environment.cjs'),'utf8'))(name=>{
  if(name==='./task16-current259-application-factory.cjs')return {};
  if(name==='./task16-current259-owned-resource.cjs')return {claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;}};
  return require(name);
 },holder);
 return {api:holder.exports,handle,root,resource,view};
}
function cleanEnvironment(){const prior={...process.env};for(const key of Object.keys(process.env))if(KEYS.includes(key)||/^(?:SMS_|APPROVAL_SMS_|COS_|TENCENT|WX_|WECHAT_|PRISMA_)/u.test(key)||['DATABASE_URL','NODE_OPTIONS','NODE_PATH','HOST','PORT','WEB_ORIGIN','SKIP_DATABASE_CONNECT'].includes(key))delete process.env[key];return ()=>{for(const key of Object.keys(process.env))if(!Object.hasOwn(prior,key))delete process.env[key];Object.assign(process.env,prior);};}
test('scoped environment uses private owned storage and restores every original setting',async()=>{
 const restore=cleanEnvironment();let f,guard,directory;
 try{
  f=fixture();process.env.NODE_ENV='test';
  const value=await f.api.withCurrent259ApplicationEnvironment(f.handle,async scope=>{
   guard=scope.check;directory=scope.storageRoot;guard();
   assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.SMS_ENABLED,'false');assert.equal(process.env.APPROVAL_SMS_ENABLED,'false');
   assert.equal(process.env.FILE_STORAGE_DRIVER,'local');assert.equal(process.env.FILE_STORAGE_ROOT,directory);
   assert.equal(path.dirname(directory),f.resource);assert.equal(fs.statSync(directory).mode&0o777,0o700);
   const secrets=KEYS.slice(-3).map(k=>process.env[k]);assert.equal(new Set(secrets).size,3);for(const s of secrets)assert.match(s,/^[a-f0-9]{64}$/u);
   fs.writeFileSync(path.join(directory,'synthetic-voucher.txt'),'synthetic',{mode:0o600});return 'done';
  });
  assert.equal(value,'done');assert.equal(process.env.NODE_ENV,'test');for(const k of KEYS.slice(1))assert.equal(process.env[k],undefined);
  assert.equal(fs.existsSync(directory),false);assert.throws(guard,/CURRENT259_APP_ENV_CLOSED/u);
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});

for(const value of [undefined,null,0,false])test('a falsey callback failure is preserved after environment and storage cleanup ('+String(value)+')',async()=>{
 const restore=cleanEnvironment();let f,directory,rejected=false;
 try{
  f=fixture();
  try{await f.api.withCurrent259ApplicationEnvironment(f.handle,scope=>{directory=scope.storageRoot;throw value;});}
  catch(error){rejected=true;assert.equal(error,value);}
  assert.equal(rejected,true);assert.equal(fs.existsSync(directory),false);for(const k of KEYS)assert.equal(process.env[k],undefined);
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});
test('pre-existing credentials are retained and cannot be adopted as test settings',async()=>{
 const restore=cleanEnvironment();let f;
 try{
  f=fixture();process.env.JWT_ACCESS_SECRET='user-owned-input';
  await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,()=>assert.fail('must not prepare')),/CURRENT259_APP_ENV_OWNERSHIP/u);
  assert.equal(process.env.JWT_ACCESS_SECRET,'user-owned-input');assert.deepEqual(fs.readdirSync(f.resource),[]);
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});
test('overlapping environment scopes cannot replace the live scope',async()=>{
 const restore=cleanEnvironment();let f;
 try{
  f=fixture();await f.api.withCurrent259ApplicationEnvironment(f.handle,async scope=>{
   const original=process.env.JWT_ACCESS_SECRET;
   await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,()=>{}),/CURRENT259_APP_ENV_BUSY/u);
   scope.check();assert.equal(process.env.JWT_ACCESS_SECRET,original);
  });
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});
test('environment replacement remains untouched and reports cleanup UNKNOWN',async()=>{
 const restore=cleanEnvironment();let f,directory;
 try{
  f=fixture();await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,scope=>{
   directory=scope.storageRoot;process.env.FILE_STORAGE_ROOT='/caller-replacement';
  }),error=>error.code==='CURRENT259_APP_ENV_CLEANUP_UNKNOWN'&&error.environmentRestoration==='UNKNOWN'&&error.storageCleanup==='REMOVED'&&Object.getOwnPropertyDescriptor(error,'cause').enumerable===false);
  assert.equal(process.env.FILE_STORAGE_ROOT,'/caller-replacement');assert.equal(fs.existsSync(directory),false);
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});
test('a changed directory inode is retained rather than deleting the replacement',async()=>{
 const restore=cleanEnvironment();let f,replacement;
 try{
  f=fixture();await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,scope=>{
   replacement=scope.storageRoot;fs.renameSync(replacement,replacement+'-original');fs.mkdirSync(replacement,{mode:0o700});
   fs.writeFileSync(path.join(replacement,'retained.txt'),'replacement');
  }),error=>error.code==='CURRENT259_APP_ENV_CLEANUP_UNKNOWN'&&error.environmentRestoration==='RESTORED'&&error.storageCleanup==='UNKNOWN');
  assert.equal(fs.readFileSync(path.join(replacement,'retained.txt'),'utf8'),'replacement');
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});
test('owned storage removal never follows a descendant symlink outside its root',async()=>{
 const restore=cleanEnvironment();let f;
 try{
  f=fixture();const outside=path.join(f.root,'retained');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'evidence.txt'),'retained');
  await f.api.withCurrent259ApplicationEnvironment(f.handle,scope=>{fs.symlinkSync(outside,path.join(scope.storageRoot,'external'));});
  assert.equal(fs.readFileSync(path.join(outside,'evidence.txt'),'utf8'),'retained');
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});

test('unknown application shutdown retains its environment and storage for the unresolved application',async()=>{
 const restore=cleanEnvironment();let f,directory;
 const applicationFailure=Object.assign(new Error('TASK16_APP_CLOSE_UNKNOWN'),{code:'TASK16_APP_CLOSE_UNKNOWN',appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
 try{
  f=fixture();await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,scope=>{
   directory=scope.storageRoot;throw applicationFailure;
  }),error=>error.code==='CURRENT259_APP_ENV_CLEANUP_UNKNOWN'&&error.environmentRestoration==='UNKNOWN'&&error.storageCleanup==='UNKNOWN'&&error.cause===applicationFailure);
  assert.equal(process.env.FILE_STORAGE_ROOT,directory);assert.equal(fs.existsSync(directory),true);
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});

test('actual WeChat credential aliases cannot be inherited into the isolated application',async()=>{
 const restore=cleanEnvironment();let f;
 try{
  f=fixture();process.env.WECHAT_APP_ID='synthetic-id';process.env.WECHAT_APP_SECRET='synthetic-secret';
  await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,()=>assert.fail('no scope')),/CURRENT259_APP_ENV_OWNERSHIP/u);
  assert.equal(process.env.WECHAT_APP_SECRET,'synthetic-secret');assert.deepEqual(fs.readdirSync(f.resource),[]);
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});

for(const key of ['DATABASE_URL','WECHAT_APP_SECRET'])test('new foreign '+key+' is rejected without deleting the caller value',async()=>{
 const restore=cleanEnvironment();let f;
 try{
  f=fixture();await assert.rejects(f.api.withCurrent259ApplicationEnvironment(f.handle,scope=>{
   process.env[key]='synthetic-caller-value';scope.check();
  }),error=>error.code==='CURRENT259_APP_ENV_CLEANUP_UNKNOWN'&&error.environmentRestoration==='UNKNOWN');
  assert.equal(process.env[key],'synthetic-caller-value');
 }finally{restore();if(f)fs.rmSync(f.root,{recursive:true,force:true});}
});
