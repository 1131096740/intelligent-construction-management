"use strict";

// Importing this file performs no vendor discovery, reads or initialization.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");

const EVENTS = Object.freeze(["jest-key-enter", "transform-source-enter", "jest-key-ready", "cache-path-ready",
  "disk-accepted", "memory-accepted", "disk-unavailable", "validator-accepted", "validator-rejected",
  "code-write-attempt", "atomic-write-returned", "disk-no-accepted-code", "ts-config-request",
  "ts-key-enter", "transformer-process", "ts-compiler-created", "dependency-resolution-enter",
  "compiler-output-enter", "emit-enter", "emit-returned", "transpile-enter", "transpile-returned"]);
const PINS = Object.freeze([
  { id: "jest-transform", pkg: "@jest/transform", version: "29.7.0", relative: "build/ScriptTransformer.js",
    sha256: "e07cd7a88714d6600d2d0cf88071f2df5635ece2bab9428bf5ae5b396d8d36ff",
    sites: [[5919,"jest-key-enter"], [15919,"transform-source-enter"], [8236,"jest-key-ready","filename,cacheKey"],
      [16152,"cache-path-ready","filename,cacheFilePath"], [16678,"disk-accepted"], [22599,"memory-accepted"],
      [27401,"disk-unavailable"], [27620,"validator-accepted"], [27639,"validator-rejected"],
      [26843,"code-write-attempt"], [28131,"atomic-write-returned","cachePath"], [16768,"disk-no-accepted-code"]] },
  { id: "ts-transformer", pkg: "ts-jest", version: "29.4.11", relative: "dist/legacy/ts-jest-transformer.js",
    sha256: "96176a6b3d96f564caf334628c4e81e8956e56ba0c9aaba9861aa97e10263887",
    sites: [[1961,"ts-config-request"], [12737,"ts-key-enter"], [5806,"transformer-process"], [5033,"ts-compiler-created"]] },
  { id: "ts-compiler", pkg: "ts-jest", version: "29.4.11", relative: "dist/legacy/compiler/ts-compiler.js",
    sha256: "5d2a3f6ac1a085edf8ae1e7279c5d890f722ed187d93b472b02a90e195d95ade",
    sites: [[3812,"dependency-resolution-enter"], [13762,"compiler-output-enter"], [15561,"emit-enter"],
      [15622,"emit-returned"], [20216,"transpile-enter"], [20276,"transpile-returned"]] },
  { id: "ts-config", pkg: "ts-jest", version: "29.4.11", relative: "dist/legacy/config/config-set.js",
    sha256: "b07c6fc6ffb59f821791e7a774a1ec122449c1e0e3c456218e599d5235fc96ed", sites: [] },
  { id: "typescript", pkg: "typescript", version: "5.9.3", relative: "lib/typescript.js",
    sha256: "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675", sites: [] }
]);
const ENTRY_PINS = Object.freeze({
  "@jest/transform": ["07c378f9ba2537946fdb24bffdb3fcc69472abe9a1dd00f3e530039585677f32", "7b780a1a5a7c2b21ec7bd829301213835db61a2b60a01535d5b4a8380aeeebf5"],
  "ts-jest": ["a1cec1ba5c519b32ff925e6734daa90e07dc3e648e3b4afb4bd8a6929888bcf9", "1d7b1b9e3001ea9a4bd92471ea580b46f7d9dbd90201c9114c9f129908c96213"],
  "typescript": ["3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675", "822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6"]
});
const FLAGS = Object.freeze({ instrument: false, supportsDynamicImport: false, supportsExportNamespaceFrom: false,
  supportsStaticESM: false, supportsTopLevelAwait: false });
let phaseUsed = false;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function reject(code) { const error = new Error(code); error.code = code; throw error; }
function canonical(directory) {
  const resolved = fs.realpathSync(directory);
  if (resolved !== path.resolve(directory) || fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) reject("path-rejected");
  return resolved;
}
function privateDirectory(directory) {
  const result = canonical(directory), stat = fs.statSync(result);
  if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) reject("private-directory-rejected");
  return result;
}
function within(root, file) { return file === root || file.startsWith(root + path.sep); }
function inputFile(file, cap = 1024 * 1024) {
  const resolved = fs.realpathSync(file), stat = fs.lstatSync(file);
  if (resolved !== path.resolve(file) || stat.isSymbolicLink() || !stat.isFile() || stat.size > cap) reject("input-rejected");
  return fs.readFileSync(resolved);
}
function safeWrite(file, value) {
  const parent = privateDirectory(path.dirname(file));
  if (path.join(parent, path.basename(file)) !== path.resolve(file)) reject("output-rejected");
  fs.writeFileSync(file, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
}
function applyInsertions(original, expectedHash, edits) {
  if (hash(original) !== expectedHash || original.includes("__jgPr348CacheMark")) reject("vendor-pin-rejected");
  const ordered = [...edits].sort((a,b) => a.offset - b.offset);
  if (ordered.some((edit,i) => !Number.isInteger(edit.offset) || edit.offset < 0 || edit.offset > original.length ||
      typeof edit.text !== "string" || !edit.text || (i && edit.offset === ordered[i-1].offset))) reject("insertion-rejected");
  let patched = original;
  for (const edit of [...ordered].reverse()) patched = patched.slice(0,edit.offset) + edit.text + patched.slice(edit.offset);
  let restored = patched, added = ordered.reduce((n,e) => n + e.text.length,0);
  for (const edit of [...ordered].reverse()) { added -= edit.text.length; const offset = edit.offset + added;
    if (restored.slice(offset,offset+edit.text.length) !== edit.text) reject("inverse-rejected");
    restored = restored.slice(0,offset) + restored.slice(offset+edit.text.length);
  }
  if (restored !== original) reject("inverse-rejected");
  return patched;
}
function vendorFiles(vendorRoot) {
  const root = canonical(vendorRoot), packages = new Map(), files = new Map();
  for (const pin of PINS) {
    if (!packages.has(pin.pkg)) {
      const packageFile = require.resolve(pin.pkg + "/package.json", { paths: [path.join(root,"node_modules/.pnpm/node_modules"),path.join(root,"services/api")] });
      const bytes = inputFile(packageFile), data = JSON.parse(bytes), base = path.dirname(packageFile), entry = path.resolve(base,data.main);
      if (data.version !== pin.version || hash(bytes) !== ENTRY_PINS[pin.pkg][1] || hash(inputFile(entry,12*1024*1024)) !== ENTRY_PINS[pin.pkg][0]) reject("vendor-pin-rejected");
      packages.set(pin.pkg,{base,entry});
    }
    const file = path.join(packages.get(pin.pkg).base,pin.relative), bytes = inputFile(file,12*1024*1024);
    if (hash(bytes) !== pin.sha256) reject("vendor-pin-rejected");
    const edits = pin.sites.map(([offset,event,args]) => ({offset,text:";__jgPr348CacheMark("+JSON.stringify(event)+(args?","+args:"")+");"}));
    if (edits.length) edits.push({offset:0,text:'"use strict";const __jgPr348CacheMark=module.__jgPr348CacheMark;\n'});
    files.set(file,{pin,original:bytes.toString("utf8"),patched:edits.length?applyInsertions(bytes.toString("utf8"),pin.sha256,edits):null});
  }
  return {root,packages,files};
}
function validateConfig(config, vendor, privateRoot) {
  const privateBase = privateDirectory(privateRoot), root = canonical(config.rootDir);
  if (typeof config.cache !== "boolean" || !path.isAbsolute(config.cacheDirectory) || !within(privateBase,path.resolve(config.cacheDirectory))) reject("cache-directory-rejected");
  let probe = path.resolve(config.cacheDirectory);
  while (probe !== privateBase) { if (fs.existsSync(probe) && fs.lstatSync(probe).isSymbolicLink()) reject("cache-directory-rejected"); probe=path.dirname(probe); }
  if (config.resolver || Object.keys(config.globals || {}).length || (config.moduleNameMapper || []).length || !Array.isArray(config.transform) || config.transform.length !== 1) reject("configuration-rejected");
  const transform = config.transform[0], tsEntry = vendor.packages.get("ts-jest").entry;
  if (transform[0] !== "^.+\\.ts$" || fs.realpathSync(transform[1]) !== tsEntry || Object.keys(transform[2] || {}).some(k=>k!=="tsconfig")) reject("configuration-rejected");
  const compiler = transform[2]?.tsconfig;
  if (compiler && (typeof compiler !== "object" || Array.isArray(compiler) || Object.keys(compiler).some(k=>!['module','target','types','sourceMap','esModuleInterop','strict','isolatedModules'].includes(k)))) reject("configuration-rejected");
  return root;
}
function createRecorder(targets, cacheEnabled) {
  const counters = () => Object.fromEntries(EVENTS.map(event=>[event,0]));
  const state={active:null,phase:"inactive",initializationCounters:counters(),events:0,failures:0,overflow:false,rows:targets.map(t=>({id:t.id,sourceSha256:t.sha256,counters:counters(),keySha256:[],codeSha256:null,cachePath:null}))};
  const record=(event,first,second)=>{try {
    if (!EVENTS.includes(event)) {state.failures++;return;}
    if (!state.active && state.phase!=="initialization") {state.failures++;return;}
    if (++state.events > 2000) {state.overflow=true;return;}
    if (!state.active) {state.initializationCounters[event]++;return;}
    const row=state.active;
    if (event === "atomic-write-returned" && first !== row.cachePath) return;
    row.counters[event]++;
    if (event === "cache-path-ready") row.cachePath=second;
    if (event === "jest-key-ready") {if(typeof second!=="string")state.failures++;else row.keySha256.push(hash(second));}
  } catch {state.failures++;}};
  return {state,record,result(){return state.rows.map(({cachePath,...row})=>({...row,keySha256:[...new Set(row.keySha256)],cachePathSha256:typeof cachePath==='string'?hash(cachePath):null,cacheEnabled}));}};
}
async function runCacheObservation({vendorRoot,config,targets,outputFile,privateRoot,transformOptions=FLAGS,onFactoryBoundary}) {
  if (phaseUsed) reject("phase-already-used");
  phaseUsed=true;
  const vendor=vendorFiles(vendorRoot), sourceRoot=validateConfig(config,vendor,privateRoot || process.env.TMPDIR);
  if (!Array.isArray(targets) || targets.length<1 || targets.length>2 || new Set(targets.map(t=>t.id)).size!==targets.length) reject("targets-rejected");
  for(const target of targets) {if(!['tiny','onboarding','roster'].includes(target.id) || !within(sourceRoot,fs.realpathSync(target.file)) || !target.file.endsWith('.ts') || !/^[a-f0-9]{64}$/.test(target.sha256) || hash(inputFile(target.file,4*1024*1024))!==target.sha256)reject("targets-rejected");}
  if (Object.keys(transformOptions).some(k=>!Object.hasOwn(FLAGS,k)) || Object.keys(FLAGS).some(k=>typeof transformOptions[k]!=="boolean")) reject("flags-rejected");
  if(onFactoryBoundary!==undefined&&typeof onFactoryBoundary!=="function")reject("factory-callback-rejected");
  for(const [file,meta] of vendor.files) if(meta.patched && require.cache[file]) reject("vendor-already-loaded");
  const recorder=createRecorder(targets,config.cache), originalExtension=Module._extensions['.js'], oldMask=process.umask(0o077);
  const patchedLoaded=new Set(), phases={configAccepted:true,vendorPinned:true,factoryStarted:false,factoryReturned:false};
  let failure=null,receipt;
  Module._extensions['.js']=function(module,filename){
    if (within(sourceRoot,filename) || filename.includes('/.prisma/client/') || filename.includes('/@prisma/client/') || within(path.join(vendor.root,'packages/shared-domain/dist'),filename)) reject("application-evaluation-rejected");
    const selected=vendor.files.get(filename);
    if(selected?.patched) {module.__jgPr348CacheMark=recorder.record;patchedLoaded.add(selected.pin.id);module._compile(selected.patched,filename);return;}
    return originalExtension(module,filename);
  };
  try {
    if(onFactoryBoundary)await onFactoryBoundary({phase:"before-factory"});
    phases.factoryStarted=true;recorder.state.phase="initialization";
    const transformFile=[...vendor.files].find(([,v])=>v.pin.id==='jest-transform')[0];
    const {createScriptTransformer}=require(transformFile), transformer=await createScriptTransformer(config);
    if(onFactoryBoundary)await onFactoryBoundary({phase:"after-factory"});
    phases.factoryReturned=true;recorder.state.phase="targets";
    for(let i=0;i<targets.length;i++) {const target=targets[i];recorder.state.active=recorder.state.rows[i];
      const result=transformer.transformSource(target.file,inputFile(target.file,4*1024*1024).toString('utf8'),transformOptions);
      if(!result || typeof result.code!=="string") reject("transform-result-rejected");
      recorder.state.active.codeSha256=hash(result.code);recorder.state.active=null;
    }
  } catch(error) {failure=error;} finally {
    recorder.state.active=null;Module._extensions['.js']=originalExtension;process.umask(oldMask);
    const integrity=recorder.state.failures===0&&!recorder.state.overflow&&patchedLoaded.size===3;
    receipt={schemaVersion:1,status:failure?'transform-failed':integrity?'observed':'observation-incomplete',scope:'pure-transform-declared-flags',
      pinsVerified:true,inverseVerified:true,observationIntegrity:integrity,phases,patchedComponents:[...patchedLoaded].sort(),
      targets:recorder.result(),initializationCounters:recorder.state.initializationCounters,
      factoryInventoryBoundary:onFactoryBoundary?'external-callback':'not-observed',
      phaseDefinitions:{initialization:"vendor factory/loadTransformers; never attributed to first target",targets:"explicit sequential sync transformSource calls"},
      eventCount:recorder.state.events,observerFailures:recorder.state.failures,overflow:recorder.state.overflow,
      declaredFlags:transformOptions,runtimeOptionsMatchOriginalJest:'unknown',cacheDirectorySha256:hash(config.cacheDirectory),
      otherLayers:{hasteMapIndex:'not-observed',jestRuntimeModules:'not-observed',v8:'unknown',os:'unknown'},
      applicationModuleEvaluated:false,clientEvaluated:false,original22Executed:false,historicalRootCauseProven:false};
    safeWrite(outputFile,receipt);
  }
  if(failure)throw failure;
  if(!receipt.observationIntegrity)reject("observation-incomplete");
  return receipt;
}
function readJson(file) {return JSON.parse(inputFile(file).toString('utf8'));}
function cliArgs(args) {
  const mode=args.shift();if(!['observe','positive-control'].includes(mode)||args.length%2)reject("arguments-rejected");
  const options={};for(let i=0;i<args.length;i+=2){if(!/^--[a-z-]+$/.test(args[i])||Object.hasOwn(options,args[i]))reject("arguments-rejected");options[args[i]]=args[i+1];}
  const allowed=mode==='observe'?['--vendor-root','--config-file','--files-file','--output','--private-root']:['--vendor-root','--private-root'];
  if(Object.keys(options).some(k=>!allowed.includes(k)) || allowed.some(k=>!options[k]))reject("arguments-rejected");
  return {mode,options};
}
async function runPositiveControl({vendorRoot,privateRoot}) {
  const root=privateDirectory(privateRoot);if(fs.readdirSync(root).length)reject("control-directory-not-empty");
  const vendor=vendorFiles(vendorRoot),fixture=path.join(root,'fixture'),cache=path.join(root,'cache'),marker=path.join(root,'evaluated.marker');
  fs.mkdirSync(fixture,{mode:0o700});fs.mkdirSync(cache,{mode:0o700});
  const file=path.join(fixture,'tiny.ts'),text='declare const require: (name: string) => any;\nrequire("node:fs").writeFileSync('+JSON.stringify(marker)+',"unexpected");\nexport const value: number = 7;\n';
  fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
  const declaredConfig={rootDir:fixture,cacheDirectory:cache,
    transform:{'^.+\\.ts$':[vendor.packages.get('ts-jest').entry,{tsconfig:{module:'CommonJS',target:'ES2022',types:[],sourceMap:true,esModuleInterop:true,strict:true}}]}};
  const configFile=path.join(root,'config.json'),filesFile=path.join(root,'files.json'),declaredConfigFile=path.join(root,'declared-config.json');
  safeWrite(declaredConfigFile,declaredConfig);
  const configModule=require.resolve('jest-config',{paths:[path.join(vendor.root,'node_modules/.pnpm/node_modules')]});
  const {projectConfig}=await require(configModule).readConfig({config:declaredConfigFile,runInBand:true},fixture);
  safeWrite(configFile,projectConfig);safeWrite(filesFile,[{id:'tiny',file,sha256:hash(text)}]);
  const stages={};
  for(const stage of ['cold','warm','rejected']) {
    if(stage==='rejected') {const entries=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile()&&!f.endsWith('.map')){const b=fs.readFileSync(f);if(/^[a-f0-9]{32}\n/.test(b.subarray(0,33).toString('utf8')))entries.push(f);}}};walk(cache);if(entries.length!==1)reject("control-cache-rejected");const b=fs.readFileSync(entries[0]);b[0]=b[0]===48?49:48;fs.writeFileSync(entries[0],b,{mode:0o600});}
    const output=path.join(root,stage+'.safe.json'),child=spawnSync(process.execPath,[__filename,'observe','--vendor-root',vendorRoot,'--config-file',configFile,'--files-file',filesFile,'--output',output,'--private-root',root],{encoding:'utf8',timeout:120000,env:{PATH:process.env.PATH,HOME:process.env.HOME,CI:'true',NODE_ENV:'test',LANG:'C.UTF-8',TMPDIR:root},maxBuffer:1024*1024});
    if(child.status!==0 || !fs.existsSync(output))reject("control-child-failed");
    const r=readJson(output);if(r.status!=='observed'||!r.observationIntegrity||r.targets.length!==1)reject("control-observation-rejected");
    const t=r.targets[0],c=t.counters;
    if(stage==='warm' ? c['disk-accepted']!==1||c['transformer-process']!==0||c['emit-enter']!==0||c['atomic-write-returned']!==0 : c['disk-accepted']!==0||c['transformer-process']!==1||c['emit-enter']!==1||c['atomic-write-returned']!==1||(stage==='rejected'&&c['validator-rejected']!==1))reject("control-verdict-rejected");
    stages[stage]={status:r.status,sourceSha256:t.sourceSha256,codeSha256:t.codeSha256,keySha256:t.keySha256,counters:c};
  }
  const moduleEvaluationMarkerAbsent=!fs.existsSync(marker);
  if(!moduleEvaluationMarkerAbsent||new Set(Object.values(stages).map(s=>s.codeSha256)).size!==1)reject("control-execution-rejected");
  const result={schemaVersion:1,status:'positive-controls-passed',scope:'isolated-tool-controls-not-original22',stages,moduleEvaluationMarkerAbsent,
    appModuleEvaluated:false,clientEvaluated:false,original22Executed:false,historicalRootCauseProven:false};
  safeWrite(path.join(root,'controls.safe.json'),result);return result;
}
module.exports={runCacheObservation,runPositiveControl,_testing:{applyInsertions,createRecorder,cliArgs,hash,PINS}};
if(require.main===module) (async()=>{try{const {mode,options:o}=cliArgs(process.argv.slice(2));const result=mode==='observe'
  ?await runCacheObservation({vendorRoot:o['--vendor-root'],config:readJson(o['--config-file']),targets:readJson(o['--files-file']),outputFile:o['--output'],privateRoot:o['--private-root']})
  :await runPositiveControl({vendorRoot:o['--vendor-root'],privateRoot:o['--private-root']});
  process.stdout.write(JSON.stringify({status:result.status,scope:result.scope,historicalRootCauseProven:false})+'\n');
}catch{process.stderr.write('{"status":"cache-observation-rejected"}\n');process.exitCode=1;}})();
