'use strict';
// System-boundary model only: a virtual filesystem, Git transport and content
// hash oracle represent a pre-audited fixed packet. No binaries are executed.
// Production uses real fs/crypto/Git and separately verifies physical materials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const SOURCE = path.resolve(__dirname,'../../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function model(options={}) {
  const files = new Map(), aliases = new Map(); let inode = 0;
  const put = (name, bytes, expected, mode=0o100644) => {
    const value=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    files.set(name,{bytes:value,mode,ino:++inode});
    if (expected) aliases.set(sha(value),expected);
  };
  const hash = bytes => aliases.get(sha(bytes)) ?? sha(bytes);
  const descriptor=require('./task12-official-document-profiles.cjs').officialDocumentProfile(options.profile??'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1');
  const lockPath=path.join(SOURCE,'services/api/assets/document-converter',descriptor.lockName);
  const lock=JSON.parse(fs.readFileSync(lockPath));
  put(lockPath,fs.readFileSync(lockPath));
  put(path.join(SOURCE,'fixture.js'),'fixed source');
  const registryPath='services/api/prisma/task12-official-document-qualification-registry.json';
  const tracked=['fixture.js','scripts/qualify-task12-official-document-runtime.cjs','services/api/prisma/task12-current259-generated-document-runtime.cjs',
   ...['task16-current259-client-loader.cjs','task16-current259-build.cjs','task16-current259-business-continuity.cjs'].map(name=>'services/api/prisma/'+name),
   ...['task12-document-context.cjs','task12-official-document-child.cjs','task12-official-document-profiles.cjs','task12-official-document-registry.cjs','task12-official-document-fidelity.cjs','task12-official-document-profile.cjs','task12-official-qualification-actions.cjs'].map(name=>'services/api/prisma/'+name),
   'services/api/src/contract-document/contract-body-pdf-converter.ts','services/api/src/contract-document/libreoffice-converter.ts','services/api/src/contract-document/task12-official-qualification-sample.ts',
   'services/api/test-support/task12-official-document-fidelity.py','services/api/test-support/task12-read-drawn-pdf.py','services/api/assets/templates/material-purchase-real-v1.docx',
   ...['runtime-lock.json','runtime-lock-material-body25-v4.json','runtime-lock-material-body25-v4-temurin17-official-v1.json','runtime-lock-material-body25-v4-temurin17-official-v2.json'].map(name=>'services/api/assets/document-converter/'+name),registryPath].sort();
  for(const name of tracked)if(!files.has(path.join(SOURCE,name)))put(path.join(SOURCE,name),'fixed source '+name);
  put(path.join(SOURCE,registryPath),JSON.stringify({version:1,profile:lock.qualification.profile,qualification:null}));
  const source={head:'a'.repeat(40),tree:'b'.repeat(40),sha256:'0'.repeat(64),files:tracked.length};
  const nodePath='/Users/leoyang/.nvm/versions/node/v20.20.2/bin/node',pnpmRoot='/Users/leoyang/.local/lib/node_modules/pnpm';
  put(nodePath,'fixed node','38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6',0o100755);
  const pnpmRows=[];
  for(let index=0;index<902;index++){const name=String(index).padStart(3,'0')+'.js';put(pnpmRoot+'/'+name,name);pnpmRows.push([name,'file',sha(name),0o644]);}
  aliases.set(sha(JSON.stringify(pnpmRows)),'a5349873e73f589c36d576e719d52581505aa6b84ec8ffb7ca8982f01d85aaca');
  const build={status:'SOURCE_BOUND_BUILD_NOT_QUALIFICATION',source,files:[],toolchain:{node:{path:nodePath,sha256:'38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6',version:'v20.20.2'},pnpm:{root:pnpmRoot,files:902,sha256:'a5349873e73f589c36d576e719d52581505aa6b84ec8ffb7ca8982f01d85aaca'}}};
  put(path.join(SOURCE,'services/api/dist/fixture.js'),'fixed build');
  build.files.push({path:'services/api/dist',kind:'directory',mode:0o700},
    {path:'services/api/dist/fixture.js',kind:'file',sha256:sha('fixed build'),mode:0o644},
    ...['packages/shared-domain/dist','node_modules','services/api/node_modules','packages/shared-domain/node_modules'].map(name=>({path:name,kind:'directory',mode:0o700})));
  put('/private/tmp/qualification/build.json',JSON.stringify(build),undefined,0o100600);
  const runtime={libreOffice:{wrapper:'/private/tmp/runtime/dependencies/bin/override/soffice',native:'/private/tmp/runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice'},python:{executable:'/private/tmp/python-runtime/bin/python3.11',package:'/private/tmp/pymupdf',fontToolsPackage:'/private/tmp/fontTools'},body25:{jdkHome:'/private/tmp/jdk',jars:[],classes:[],fonts:[]}};
  put(runtime.libreOffice.wrapper,'wrapper','81c7db1c6dbcdd606d95abef337b4529aeda6a4fa1cf23a5a567f9c5655c8b66',0o100755);
  put(runtime.libreOffice.native,'native',descriptor.nativeSha256,0o100755);
  put(runtime.python.executable,'python','7e470bc0e4889177f9acb5f62208fae2825aba9ccd6a67b7c3378f522aa8f148',0o100755);
  const pyNames=['__init__.py','__main__.py','_apply_pages.py','_build.py','_extra.so','_mupdf.so','_wxcolors.py','extra.py','libmupdf.dylib','libmupdfcpp.so','mupdf.py','pymupdf.py','table.py','utils.py'];
  for (const name of pyNames) put(path.join(runtime.python.package,name),name);
  aliases.set(sha(JSON.stringify(pyNames.map(name=>[name,sha(name)]))),'1a72fa8292254ce92d0030b1adcddd1bbceeacaaf602c84e9a8afebe23566f39');
  const fontTools=[];
  for(let index=0;index<descriptor.fontToolsFiles;index++) { const name=String(index).padStart(3,'0')+'.py';put('/private/tmp/fontTools/'+name,name);fontTools.push([name,'file',sha(name),0o644]); }
  aliases.set(sha(JSON.stringify(fontTools)),descriptor.fontToolsSha256);
  put(path.join(SOURCE,'services/api/test-support/task12-official-document-fidelity.py'),'fixed inspector');
  const tree=[];
  for(let index=0;index<456;index++) {const name=String(index).padStart(3,'0');put('/private/tmp/jdk/'+name,name);tree.push([name,'file',sha(name),0o644]);}
  if (options.jdkLink) {
    const entry=files.get('/private/tmp/jdk/001'); entry.mode=0o120777;entry.bytes=Buffer.from('000');
    tree[1]=['001','link','000'];
  }
  aliases.set(sha(JSON.stringify(tree)),lock.jdkTreeSha256);
  for(const group of ['jars','classes','fonts']) for(const entry of lock[group]) {
    const target='/private/tmp/materials/'+entry.name;put(target,entry.name,entry.sha256);runtime.body25[group].push({name:entry.name,path:target});
  }
  // Real-sized inert bytes exercise the archive size predicate; no archive is
  // parsed/extracted and the model oracle supplies the independently pinned SHA.
  put('/private/tmp/archive',Buffer.alloc(185617580),lock.qualification.archiveSha256);
  const PizZip=require('pizzip'),zip=new PizZip();zip.file('word/document.xml','<model>fixed formal renderer output</model>');
  const documentBytes=zip.generate({type:'nodebuffer'});
  const scopeValue={version:1,sourceSha256:'44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd',typographyVersion:'reviewed-material-primary-secondary-body25-v4',paragraphs:[],docxSha256:sha(documentBytes)};
  const sample={docx:documentBytes,officeDocx:documentBytes,scope:scopeValue,expectations:{actualPdfQualification:'NOT_EXECUTED'}};
  put('/private/tmp/input.docx',documentBytes);put('/private/tmp/scope.json',JSON.stringify(scopeValue));put('/private/tmp/expected.json',JSON.stringify(sample.expectations));
  put(path.join(SOURCE,'services/api/assets/templates/material-purchase-real-v1.docx'),'fixed template','44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd');
  let seq=0;
  function packet() {
    source.sha256=sha(JSON.stringify(tracked.map(name=>[name,hash(files.get(path.join(SOURCE,name)).bytes),files.get(path.join(SOURCE,name)).mode & 0o7777])));
    put('/private/tmp/qualification/build.json',JSON.stringify(build),undefined,0o100600);
    const runRoot='/private/tmp/run-'+(++seq); dirs.add(runRoot);
    const plan={version:1,profile:lock.qualification.profile,source,build:{path:'/private/tmp/qualification/build.json',sha256:sha(JSON.stringify(build))},archive:'/private/tmp/archive',runtime,document:{path:'/private/tmp/input.docx',sha256:sha(documentBytes),scopePath:'/private/tmp/scope.json',scopeSha256:sha(JSON.stringify(scopeValue)),expectationsPath:'/private/tmp/expected.json',expectationsSha256:sha(JSON.stringify(sample.expectations)),officePath:'/private/tmp/input.docx',officeSha256:sha(documentBytes)},runRoot};
    const name='/private/tmp/qualification/plan-'+seq+'.json';put(name,JSON.stringify(plan),undefined,0o100600);
    return {name,sha256:sha(JSON.stringify(plan)),plan};
  }
  const dirs=new Set([pnpmRoot,'/private/tmp/jdk','/private/tmp/fontTools','/private/tmp/qualification',...['services/api/dist','packages/shared-domain/dist','node_modules','services/api/node_modules','packages/shared-domain/node_modules'].map(x=>path.join(SOURCE,x))]);
  const stat = name => {
    const file=files.get(name); if (!file && !dirs.has(name)) { const e=new Error('missing');e.code='ENOENT';throw e; }
    const mode=file?.mode??0o40700;
    return {dev:1,ino:file?.ino??name.length,mode,uid:process.getuid(),gid:process.getgid(),size:file?.bytes.length??0,mtimeMs:file?.mtimeMs??1,ctimeMs:file?.ctimeMs??1,nlink:1,isFile:()=>Boolean(file) && (mode & 0o170000) !== 0o120000,isDirectory:()=>dirs.has(name),isSymbolicLink:()=>(mode & 0o170000) === 0o120000};
  };
  const fakeFs={
    lstatSync:stat, realpathSync:name=>{stat(name);const f=files.get(name);return (f?.mode & 0o170000) === 0o120000 ? path.resolve(path.dirname(name),f.bytes.toString()) : name;},
    readFileSync:name=>{const f=files.get(name);if(!f) throw new Error('missing '+name);return f.bytes;},
    readdirSync:name=>{stat(name);const prefix=name+'/';return [...new Set([...files.keys(),...dirs].filter(x=>x.startsWith(prefix)).map(x=>x.slice(prefix.length).split('/')[0]))].sort();},
    writeFileSync:(name,value,options)=>{if(options?.flag==='wx'&&files.has(name))throw new Error('exists');put(name,value,undefined,0o100000|(options?.mode??0o600));},
    mkdtempSync:prefix=>{const name=prefix+'owned-'+(++seq);dirs.add(name);return name;},
    mkdirSync:(name,options)=>{dirs.add(name);if(options?.recursive){let parent=path.dirname(name);while(parent!=='/'&&!dirs.has(parent)){dirs.add(parent);parent=path.dirname(parent);}}},chmodSync:()=>{},readlinkSync:name=>files.get(name).bytes.toString()
  };
  // Model full installations at the filesystem boundary. Their independent
  // real inventories live in the source candidate lock; no executables run here.
  for(const [root,expected] of [[path.resolve(path.dirname(runtime.libreOffice.native),'../..'),lock.officialInstalledTrees.libreOffice],['/private/tmp/python-runtime',lock.officialInstalledTrees.python]]){
    dirs.add(root);
    for(const name of files.keys())if(name.startsWith(root+'/')){
      let parent=path.dirname(name);while(parent.startsWith(root)){dirs.add(parent);if(parent===root)break;parent=path.dirname(parent);}
    }
    const members=()=>[...dirs,...files.keys()].filter(name=>name===root||name.startsWith(root+'/'));
    let count=0;const missing=expected.entries-members().length;while(count<missing)put(root+'/fixed-'+String(count++).padStart(4,'0'),'installation model file');
    const rows=[];
    const walk=current=>{const s=stat(current),rel=path.relative(root,current)||'.';
      if(s.isDirectory()){rows.push([rel,'directory',s.mode & 0o7777]);for(const name of fakeFs.readdirSync(current))walk(path.join(current,name));}
      else if(s.isSymbolicLink())rows.push([rel,'link',fakeFs.readlinkSync(current),s.mode & 0o7777]);
      else rows.push([rel,'file',hash(files.get(current).bytes),s.mode & 0o7777]);
    };walk(root);aliases.set(sha(JSON.stringify(rows)),expected.sha256);
  }
  const fakeCrypto={createHash:algorithm=>{
    if(algorithm==='sha1')return crypto.createHash('sha1');
    const chunks=[];const value={update:bytes=>{chunks.push(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes));return value;},digest:()=>hash(Buffer.concat(chunks))};return value;
  }};
  const module={exports:{}};
  const loaded=[],moduleView=Object.freeze({}),leaseState={active:true};
  const checkLease=()=>{if(!leaseState.active)throw Object.assign(new Error("model module lease revoked"),{code:"CURRENT259_LOADER_CHANGED"});};
  const lease={root:options.leaseRoot??SOURCE,get source(){const value=module.exports.sourceWitness();return options.leaseSource??{candidateSha:value.head,tree:value.tree};},check:checkLease,verifyFull:checkLease,createOfficialQualificationSample:()=>sample,canonicalDocx:bytes=>sha(bytes)};
  const fakeRequire=name=>{loaded.push(name);if(name==='./task16-current259-client-loader.cjs')return {claimCurrent261OfficialDocumentModules:view=>{assertView(view);checkLease();return lease;}};return name.endsWith('/task12-official-qualification-sample.js')?{createOfficialQualificationSample:()=>sample,canonicalOfficialQualificationDocx:bytes=>sha(bytes)}:name==='node:os'?{release:()=> 'model-os-release',version:()=> 'model-os-version'}:name==='node:fs'?fakeFs:name==='node:crypto'?fakeCrypto:name==='node:child_process'?{execFileSync:(_bin,raw)=>{
    const args=raw[0]==='--no-replace-objects'?raw.slice(3):raw;
    if(args[0]==='status'||args[0]==='merge-base')return Buffer.from('');
    if(args[0]==='ls-files')return Buffer.from(tracked.join('\0')+'\0');
    if(args[0]==='ls-tree')return Buffer.from(tracked.map(name=>{
      const f=files.get(path.join(SOURCE,name)),oid=crypto.createHash('sha1').update('blob '+f.bytes.length+'\0').update(f.bytes).digest('hex');
      return '100644 blob '+oid+'\t'+name;
    }).join('\0')+'\0');
    return Buffer.from(args[1]==='HEAD'?source.head:args[1]==='--show-toplevel'?SOURCE:source.tree);
  }}:require(name);};
  function assertView(view){if(view!==moduleView)throw Object.assign(new Error('model opaque module view required'),{code:'CURRENT261_OFFICIAL_MODULE_VIEW'});}
  const modelProcess={...process,execPath:nodePath,version:'v20.20.2',platform:'darwin',arch:'arm64',execArgv:[],_preload_modules:[],env:{},getuid:()=>process.getuid(),getgid:()=>process.getgid()};
  const filename=path.join(__dirname,'task12-official-document-profile.cjs');
  fakeRequire.cache={[filename]:module};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'task12-official-document-profile.cjs'),'utf8'),{require:fakeRequire,module,exports:module.exports,__dirname,__filename:filename,process:modelProcess,Buffer,Object,Promise,JSON},{filename:'official-profile-model.cjs'});
  function publish(){
    const api=module.exports,input=packet(),proof=api.inspectOfficialDocumentQualification(input.name,input.sha256),controls=api.toolControlWitness();
    const base={version:1,pageCount:2,pages:['隔离工具资格材料合同 壹佰壹拾叁元整 资格样张材料 第1页 / 共2页','买方 虚构甲方公司 卖方 虚构乙方公司 第2页 / 共2页'],a4Portrait:true,outOfPageGlyphs:0,unembeddedFonts:0,badGlyphs:0,substitutionFonts:0,paintedChineseGlyphs:100,bodyAnchor:{matches:1,lineSpacings:[25],fontSizes:[14],fontFamilies:['fangsonggb2312']},failures:[]};
    const {validateOfficialDocumentFidelity,validateOfficialOfficeFidelity,validateOfficialMergedFidelity}=require('./task12-official-document-fidelity.cjs');
    const reports={},actions={};
    for(const name of ['java','office','normalized']){
      const pdfPath='/private/tmp/qualification/'+name+'.pdf',pdf=Buffer.from('%PDF-model-'+name);put(pdfPath,pdf,undefined,0o100600);
      reports[name]={...base,pdfSha256:sha(pdf),...(name==='normalized'?{pageCount:4,pages:[...base.pages,...base.pages]}:{})};
      const physicalPath='/private/tmp/qualification/'+name+'.json',report=JSON.stringify(reports[name]);put(physicalPath,report,undefined,0o100600);
      const verdict=name==='java'?validateOfficialDocumentFidelity(reports[name],sha(pdf)):name==='office'?validateOfficialOfficeFidelity(reports[name],sha(pdf)):validateOfficialMergedFidelity(reports[name],reports.java,reports.office,sha(pdf));
      actions[name]={pdfPath,pdfSha256:sha(pdf),physicalPath,physicalSha256:sha(report),pageCount:reports[name].pageCount,verdict};
    }
    const machine={version:1,status:'MACHINE_QUALIFICATION_PASSED_PHYSICAL_REVIEW_PENDING',profile:lock.qualification.profile,runtimeAuthority:false,plan:{path:input.name,sha256:input.sha256},source:proof.source,hostBoundary:api.hostBoundary(),toolControls:{sha256:controls.sha256,files:controls.files},candidateLockSha256:proof.candidateLockSha256,buildSha256:proof.buildSha256,materialSha256:proof.materialSha256,boundaries:{foreignSnapshotRejected:true,malformedDocxRejected:true,externalRelationshipRejected:true,activeFieldRejected:true,noNegativeConverterScratchCreated:true},actions,physicalReview:{status:'PENDING',exactPageCountsReviewed:false,signatureAndPaginationReviewed:false},elapsedMs:1000};
    const machineBytes=JSON.stringify(machine),machinePath='/private/tmp/qualification/machine.json';put(machinePath,machineBytes,undefined,0o100600);
    const physical={version:1,profile:machine.profile,status:'INDEPENDENT_PHYSICAL_REVIEW_PASSED',machineReceiptSha256:sha(machineBytes),source:machine.source,toolControlsSha256:controls.sha256,pdfs:Object.fromEntries(Object.entries(actions).map(([name,row])=>[name,{sha256:row.pdfSha256,pageCount:row.pageCount}])),exactPageCountsReviewed:true,signatureAndPaginationReviewed:true,reviewer:'independent model boundary',reviewedAt:'2026-11-13T00:00:00Z'};
    const physicalBytes=JSON.stringify(physical),physicalPath='/private/tmp/qualification/review.json';put(physicalPath,physicalBytes,undefined,0o100600);
    const registry={version:1,profile:machine.profile,qualification:{machineReceipt:{path:machinePath,sha256:sha(machineBytes)},physicalReview:{path:physicalPath,sha256:sha(physicalBytes)}}};put(path.join(SOURCE,registryPath),JSON.stringify(registry));
    source.head='c'.repeat(40);source.tree='d'.repeat(40);
    const runRoot='/private/tmp/runtime-run';dirs.add(runRoot);
    const currentSource=api.sourceWitness(),runtimeInput={version:1,profile:machine.profile,purpose:'TASK12_GENERATED_LIFECYCLE_LOCAL_ONLY_V1',source:currentSource,qualificationRegistrySha256:sha(JSON.stringify(registry)),qualificationPlanSha256:input.sha256,runRoot};
    const name='/private/tmp/qualification/runtime.json',bytes=JSON.stringify(runtimeInput);put(name,bytes,undefined,0o100600);
    return {name,sha256:sha(bytes),runRoot,runtimeInput,machine,physical,registry};
  }
  return {api:module.exports,packet,files,publish,moduleView,leaseState,loaded,moduleCache:fakeRequire.cache};
}
module.exports={model};
