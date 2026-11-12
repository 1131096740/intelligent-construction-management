'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync,execFile } = require('node:child_process');
const { validateOfficialQualificationRegistration } = require('./task12-official-document-registry.cjs');
const { createOfficialDocumentChildBudget, attachPostcheck } = require('./task12-official-document-child.cjs');
const { createDocumentContextAuthority } = require('./task12-document-context.cjs');
const PROFILE = 'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1';
const LOCK_NAME = 'runtime-lock-material-body25-v4-temurin17-official-v1.json';
const NODE = '/Users/leoyang/.nvm/versions/node/v20.20.2/bin/node';
const PNPM_ROOT = '/Users/leoyang/.local/lib/node_modules/pnpm';
const LOCK_SHA = 'cfdb0f202e91294db06aa8643be7955be6760a37b97d90c6baf9c261c76f0c45';
const context = createDocumentContextAuthority();
const inspected = new WeakMap();
const error = (part,cause) => Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_' + part), { code: 'TASK12_OFFICIAL_DOCUMENT_' + part, ...(cause===undefined?{}:{cause}) });
const need = (value, part) => { if (!value) throw error(part); };

const SOURCE_ROOT = path.resolve(__dirname, '../../..');
const ARCHIVE_SHA = '856059de21518c2ff6eba6126ffc93390affe363c3ee205b3146a3bac3be0aa5';
const REGISTRY_PATH = 'services/api/prisma/task12-official-document-qualification-registry.json';
const TREE_SHA = 'aa3d7e0b9574a8d26d9e1b7dbc46b96bc2289450d79466380a44f6c9d534cde7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const keys = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
const frozen = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};
let canonicalBroken=false;
function canonicalProfile(){
  if(require.cache?.[__filename]!==module||module.exports!==published)canonicalBroken=true;
  need(!canonicalBroken,'MODULES');
}
function capture(file, expected, part, max = 512 * 1024 * 1024) {
  need(typeof file === 'string' && path.isAbsolute(file) && path.normalize(file) === file && !/[\u0000-\u001f]/u.test(file), part);
  const stat = fs.lstatSync(file);
  need(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(file) === file && stat.size <= max &&
    [0, process.getuid()].includes(stat.uid) && (stat.mode & 0o022) === 0 && (stat.mode & 0o7000)===0, part);
  const bytes = fs.readFileSync(file), digest = sha(bytes), after = fs.lstatSync(file);
  need(bytes.length === stat.size && ['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].every(key => after[key] === stat[key]) &&
    (!expected || digest === expected), part);
  return { path: file, sha256: digest, bytes, identity: Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key => [key, stat[key]])) };
}
const metadata = item => Object.fromEntries(Object.entries(item).filter(([key])=>key!=='bytes'));
function continuity(item, contents = false) {
  const stat = fs.lstatSync(item.path);
  need(Object.entries(item.identity).every(([key,value]) => stat[key] === value), 'CONTINUITY');
  if (item.kind === 'link') need(stat.isSymbolicLink() && fs.readlinkSync(item.path) === item.target &&
    fs.realpathSync(item.path) === item.realpath, 'CONTINUITY');
  else {
    need(!stat.isSymbolicLink() && fs.realpathSync(item.path) === item.path, 'CONTINUITY');
    if (contents && item.sha256) {
      const verified=capture(item.path,item.sha256,'CONTINUITY');
      need(Object.entries(item.identity).every(([key,value])=>verified.identity[key]===value),'CONTINUITY');
    }
  }
}
function privateDirectory(file) {
  need(typeof file === 'string' && file.startsWith('/private/tmp/') && path.normalize(file) === file && fs.realpathSync(file) === file, 'DIRECTORY');
  const stat = fs.lstatSync(file);
  need(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700, 'DIRECTORY');
  return { path: file, identity: Object.fromEntries(['dev','ino','mode','uid','gid'].map(key => [key,stat[key]])) };
}
function git(args) {
  return execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false',...args],{cwd:SOURCE_ROOT,
    env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},
    timeout:10000,maxBuffer:8*1024*1024}).toString('utf8').trim();
}
const CONTROL_FILES=Object.freeze([
 'scripts/qualify-task12-official-document-runtime.cjs',
 'services/api/prisma/task12-current259-generated-document-runtime.cjs',
 ...['task16-current259-client-loader.cjs','task16-current259-build.cjs','task16-current259-business-continuity.cjs'].map(name=>'services/api/prisma/'+name),
 ...['task12-document-context.cjs','task12-official-document-child.cjs','task12-official-document-registry.cjs',
  'task12-official-document-fidelity.cjs','task12-official-document-profile.cjs','task12-official-qualification-actions.cjs'].map(name=>'services/api/prisma/'+name),
 'services/api/src/contract-document/contract-body-pdf-converter.ts','services/api/src/contract-document/libreoffice-converter.ts',
 'services/api/src/contract-document/task12-official-qualification-sample.ts',
 'services/api/test-support/task12-official-document-fidelity.py','services/api/test-support/task12-read-drawn-pdf.py',
 'services/api/assets/templates/material-purchase-real-v1.docx',
 ...['runtime-lock.json','runtime-lock-material-body25-v4.json',LOCK_NAME].map(name=>'services/api/assets/document-converter/'+name),REGISTRY_PATH
]);
function sourceSnapshot() {
  need(git(['status','--porcelain','--untracked-files=all'])==='','SOURCE');
  const head=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
  need(/^[a-f0-9]{40}$/u.test(head)&&/^[a-f0-9]{40}$/u.test(tree)&&git(['rev-parse','--show-toplevel'])===SOURCE_ROOT,'SOURCE');
  const sourceFiles=[];
  const rows=git(['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean).map(line=>{
    const [description,name]=line.split('\t'),[mode,type,oid]=description.split(' ');
    need(type==='blob'&&['100644','100755'].includes(mode)&&name&&!path.isAbsolute(name)&&!name.split('/').some(part=>!part||part==='..'||part==='.'),'SOURCE');
    const item=capture(path.join(SOURCE_ROOT,name),undefined,'SOURCE');
    need(Boolean(item.identity.mode & 0o111)===(mode==='100755')&&createHash('sha1').update('blob '+item.bytes.length+'\0').update(item.bytes).digest('hex')===oid,'SOURCE');
    sourceFiles.push(metadata(item));return [name,item.sha256,item.identity.mode & 0o7777];
  }).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  need(CONTROL_FILES.every(name=>rows.some(row=>row[0]===name))&&git(['rev-parse','HEAD'])===head&&git(['status','--porcelain','--untracked-files=all'])==='','SOURCE');
  return {source:{head,tree,sha256:sha(JSON.stringify(rows)),files:rows.length},rows,sourceFiles};
}
function hostBoundary(){need(process.platform==='darwin'&&process.arch==='arm64','HOST');return {platform:process.platform,arch:process.arch,release:os.release(),version:os.version()};}
function sourceWitness(){return JSON.parse(JSON.stringify(sourceSnapshot().source));}
function toolControlWitness(){
  const {source,rows}=sourceSnapshot();
  const controls=rows.filter(([name])=>name!==REGISTRY_PATH&&!name.endsWith('.md'));
  return {sha256:sha(JSON.stringify(controls)),files:controls.length,source};
}
function linkCapture(file) {
  const stat = fs.lstatSync(file), realpath = fs.realpathSync(file);
  need(stat.isSymbolicLink() && realpath.startsWith(SOURCE_ROOT + path.sep),'BUILD');
  return { path:file, kind:'link', target:fs.readlinkSync(file), realpath,
    identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key => [key,stat[key]])) };
}
function buildCapture(row) {
  const file=path.join(SOURCE_ROOT,row.path);
  if (row.kind === 'link') return linkCapture(file);
  if (row.kind === 'directory') {
    const stat=fs.lstatSync(file); need(stat.isDirectory() && !stat.isSymbolicLink(),'BUILD');
    return {path:file,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key=>[key,stat[key]]))};
  }
  return metadata(capture(file,row.sha256,'BUILD'));
}
function buildWitness() {
  const rows = [];
  const walk = current => {
    const directoryStat=fs.lstatSync(current);
    need(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),'BUILD');
    rows.push({path:path.relative(SOURCE_ROOT,current),kind:'directory',mode:directoryStat.mode & 0o7777});
    for (const name of fs.readdirSync(current).sort()) {
      need(!credentialPath(name),'BUILD_CREDENTIAL_PATH');
      const file = path.join(current,name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) { const item=linkCapture(file);
        rows.push({path:path.relative(SOURCE_ROOT,file),kind:'link',target:item.target,realpath:path.relative(SOURCE_ROOT,item.realpath),mode:stat.mode & 0o7777}); }
      else if (stat.isDirectory()) walk(file);
      else { need(stat.isFile(),'BUILD'); const item=capture(file,undefined,'BUILD');
        rows.push({path:path.relative(SOURCE_ROOT,file),kind:'file',sha256:item.sha256,mode:stat.mode & 0o7777}); }
    }
  };
  for (const name of ['services/api/dist','packages/shared-domain/dist','node_modules','services/api/node_modules','packages/shared-domain/node_modules']) walk(path.join(SOURCE_ROOT,name));
  need(rows.length > 0,'BUILD'); return rows;
}
function exactSource(expected,files) {
  need(keys(expected,['head','tree','sha256','files']), 'SOURCE');
  const snapshot=sourceSnapshot(),actual=JSON.parse(JSON.stringify(snapshot.source));
  need(JSON.stringify(actual) === JSON.stringify(expected), 'SOURCE');
  if(files)files.push(...snapshot.sourceFiles);
  return actual;
}
function jdkTree(home, all) {
  need(typeof home === 'string' && path.isAbsolute(home) && fs.realpathSync(home) === home && fs.lstatSync(home).isDirectory(), 'JDK');
  const rootStat=fs.lstatSync(home); need((rootStat.mode & 0o022) === 0 && [0,process.getuid()].includes(rootStat.uid),'JDK');
  all.push({path:home,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key => [key,rootStat[key]]))});
  const rows = []; let total = 0, entries = 0;
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current,name), stat = fs.lstatSync(file), relative = path.relative(home,file);
      need(++entries <= 2000, 'JDK');
      if (stat.isDirectory()) { need((stat.mode & 0o022) === 0 && [0,process.getuid()].includes(stat.uid), 'JDK');
        all.push({path:file,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key => [key,stat[key]]))}); walk(file); }
      else if (stat.isSymbolicLink()) {
        const realpath=fs.realpathSync(file); need(realpath.startsWith(home + path.sep), 'JDK');
        all.push({path:file,kind:'link',target:fs.readlinkSync(file),realpath,
          identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key => [key,stat[key]]))});
        rows.push([relative,'link',fs.readlinkSync(file)]);
      } else {
        need(stat.isFile() && (total += stat.size) <= 1024 * 1024 * 1024, 'JDK');
        const item = capture(file,undefined,'JDK'); all.push(metadata(item));
        rows.push([relative,'file',item.sha256,stat.mode & 0o7777]);
      }
    }
  };
  walk(home); need(rows.length === 456 && sha(JSON.stringify(rows)) === TREE_SHA, 'JDK');
}

/** Full loadable installation, not merely the launcher executable. Paths are
 * derived from fixed verified launchers; no extra caller-selected tree is read. */
function installedToolTree(root,expected,all){
  need(typeof root==='string'&&path.isAbsolute(root)&&fs.realpathSync(root)===root,'INSTALLED_TREE');
  const rows=[];let total=0;
  const walk=current=>{
    const stat=fs.lstatSync(current),relative=path.relative(root,current)||'.',mode=stat.mode & 0o7777;
    need(rows.length<10000&&[0,process.getuid()].includes(stat.uid)&&(mode & 0o022)===0,'INSTALLED_TREE');
    const identity=Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key=>[key,stat[key]]));
    if(stat.isDirectory()){
      need(!stat.isSymbolicLink(),'INSTALLED_TREE');all.push({path:current,identity});rows.push([relative,'directory',mode]);
      for(const name of fs.readdirSync(current).sort()){need(!credentialPath(name),'BUILD_CREDENTIAL_PATH');walk(path.join(current,name));}
    }else if(stat.isSymbolicLink()){
      const realpath=fs.realpathSync(current),target=fs.readlinkSync(current);need(realpath.startsWith(root+path.sep),'INSTALLED_TREE');
      all.push({path:current,kind:'link',target,realpath,identity});rows.push([relative,'link',target,mode]);
    }else{
      need(stat.isFile()&&(total+=stat.size)<=1024*1024*1024,'INSTALLED_TREE');
      const item=capture(current,undefined,'INSTALLED_TREE');all.push(metadata(item));rows.push([relative,'file',item.sha256,mode]);
    }
  };
  walk(root);need(keys(expected,['entries','sha256'])&&rows.length===expected.entries&&sha(JSON.stringify(rows))===expected.sha256,'INSTALLED_TREE');
}

function buildToolWitness(all = []) {
  need(process.execPath === NODE && process.version === 'v20.20.2' && process.execArgv.length===0 && !(process._preload_modules?.length),'BUILD_NODE');
  const node=capture(NODE,'38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6','BUILD_NODE');
  all.push(metadata(node));
  const rows=[];
  const walk=current=>{
    const directory=fs.lstatSync(current); need(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o022)===0 && [0,process.getuid()].includes(directory.uid),'BUILD_PNPM');
    all.push({path:current,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key=>[key,directory[key]]))});
    for(const name of fs.readdirSync(current).sort()) {
      need(!credentialPath(name),'BUILD_CREDENTIAL_PATH');
      const file=path.join(current,name),stat=fs.lstatSync(file);need(!stat.isSymbolicLink(),'BUILD_PNPM');
      if(stat.isDirectory())walk(file);
      else {const item=capture(file,undefined,'BUILD_PNPM');all.push(metadata(item));rows.push([path.relative(PNPM_ROOT,file),'file',item.sha256,stat.mode & 0o7777]);}
    }
  };
  walk(PNPM_ROOT);
  const digest=sha(JSON.stringify(rows));need(rows.length===902&&digest==='a5349873e73f589c36d576e719d52581505aa6b84ec8ffb7ca8982f01d85aaca','BUILD_PNPM');
  return {node:{path:NODE,sha256:node.sha256,version:process.version},pnpm:{root:PNPM_ROOT,files:902,sha256:digest}};
}
function credentialPath(name) {
  return ['.env','.npmrc','.netrc','.pypirc','id_rsa','id_ed25519'].includes(name) || name.startsWith('.env.') || /\.(?:key|p12|pfx)$/u.test(name);
}
function fontToolsTree(root, all) {
  need(typeof root === 'string' && path.isAbsolute(root) && fs.realpathSync(root) === root,'FONTTOOLS');
  const rows = [];
  const walk = current => {
    const directory=fs.lstatSync(current);
    need(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o022) === 0,'FONTTOOLS');
    all.push({path:current,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key=>[key,directory[key]]))});
    for (const name of fs.readdirSync(current).sort()) {
      const file=path.join(current,name),stat=fs.lstatSync(file); need(!stat.isSymbolicLink(),'FONTTOOLS');
      if (stat.isDirectory()) walk(file);
      else { const item=capture(file,undefined,'FONTTOOLS'); all.push(metadata(item));
        rows.push([path.relative(root,file),'file',item.sha256,stat.mode & 0o7777]); }
    }
  };
  walk(root); need(rows.length === 676 && sha(JSON.stringify(rows)) === '263ec27ba75f927b8e65c12f6697a7edb5ae930a34244ddda367119a5c0d7b1f','FONTTOOLS');
}

/** Read-only candidate inspection. This proof is qualification-only, never a
 * current259/native/application runtime proof. The external digest is required. */
function inspectOfficialDocumentQualification(file,expectedSha256) {
  need(arguments.length===2,'INPUT');canonicalProfile();return inspectMaterials(file,expectedSha256);
}
function inspectMaterials(file, expectedSha256, activation) {
  const started=performance.now();
  try {
    need(hash(expectedSha256), 'INPUT');
    need(process.env.NODE_ENV!=='production'&&!['NODE_OPTIONS','NODE_PATH','DATABASE_URL','JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS','CLASSPATH','DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH'].some(key=>Object.hasOwn(process.env,key)),'ENVIRONMENT');
    const input = capture(file,expectedSha256,'INPUT',128 * 1024);
    need((input.identity.mode & 0o077) === 0, 'INPUT');
    const plan = JSON.parse(input.bytes.toString('utf8'));
    need(keys(plan,['version','profile','source','build','archive','runtime','document','runRoot']) && plan.version === 1 && plan.profile === PROFILE, 'INPUT');
    const sourceFiles=[];
    const source = exactSource(activation?activation.runtimeInput.source:plan.source,sourceFiles);
    need(keys(plan.build,['path','sha256']) && hash(plan.build.sha256),'BUILD');
    const buildFile = capture(plan.build.path,plan.build.sha256,'BUILD',32 * 1024 * 1024);
    const build = JSON.parse(buildFile.bytes.toString('utf8'));
    need(keys(build,['status','source','files','toolchain']) && build.status === 'SOURCE_BOUND_BUILD_NOT_QUALIFICATION' &&
      JSON.stringify(build.source) === JSON.stringify(plan.source),'BUILD');
    const toolFiles=[]; need(JSON.stringify(build.toolchain)===JSON.stringify(buildToolWitness(toolFiles)),'BUILD');
    const compiled = buildWitness();
    need(JSON.stringify(compiled) === JSON.stringify(build.files),'BUILD');
    const lockFile = capture(path.join(SOURCE_ROOT,'services/api/assets/document-converter',LOCK_NAME),LOCK_SHA,'LOCK',128 * 1024);
    const lock = JSON.parse(lockFile.bytes.toString('utf8'));
    need(lock.qualification.status === 'PENDING_NOT_RUNTIME_AUTHORITY' && lock.qualification.profile === PROFILE && lock.qualification.archiveSha256 === ARCHIVE_SHA, 'LOCK');
    const all = [input,lockFile,buildFile,...toolFiles,...compiled.map(buildCapture)];
    const archive = capture(plan.archive,ARCHIVE_SHA,'ARCHIVE'); need(archive.identity.size === 185617580,'ARCHIVE'); all.push(metadata(archive));
    const runtime = plan.runtime;
    need(keys(runtime,['libreOffice','python','body25']) && keys(runtime.libreOffice,['wrapper','native']) && keys(runtime.python,['executable','package','fontToolsPackage']) && keys(runtime.body25,['jdkHome','jars','classes','fonts']), 'INPUT');
    for (const [name,expected] of [['wrapper','81c7db1c6dbcdd606d95abef337b4529aeda6a4fa1cf23a5a567f9c5655c8b66'],['native','0602181a6c26c8e46aa166db18412cef1b31b6d95eb9d7033ffc4cc0ce2e66f2']]) {
      const item = capture(runtime.libreOffice[name],expected,'LIBREOFFICE',64 * 1024 * 1024);
      need((item.identity.mode & 0o111) !== 0,'LIBREOFFICE'); all.push(metadata(item));
    }
    need(path.resolve(path.dirname(runtime.libreOffice.wrapper),'../../native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice') === runtime.libreOffice.native,'LIBREOFFICE');
    const loRoot=path.resolve(path.dirname(runtime.libreOffice.native),'../..');
    installedToolTree(loRoot,lock.officialInstalledTrees.libreOffice,all);
    need(runtime.python.executable.endsWith('/bin/python3.11'),'PYTHON');
    installedToolTree(path.resolve(path.dirname(runtime.python.executable),'..'),lock.officialInstalledTrees.python,all);
    const python = capture(runtime.python.executable,'7e470bc0e4889177f9acb5f62208fae2825aba9ccd6a67b7c3378f522aa8f148','PYTHON'); all.push(metadata(python));
    const names = ['__init__.py','__main__.py','_apply_pages.py','_build.py','_extra.so','_mupdf.so','_wxcolors.py','extra.py','libmupdf.dylib','libmupdfcpp.so','mupdf.py','pymupdf.py','table.py','utils.py'];
    const pythonFiles = names.map(name => { const item = capture(path.join(runtime.python.package,name),undefined,'PYTHON',64 * 1024 * 1024); all.push(metadata(item)); return [name,item.sha256]; });
    need(sha(JSON.stringify(pythonFiles)) === '1a72fa8292254ce92d0030b1adcddd1bbceeacaaf602c84e9a8afebe23566f39','PYTHON');
    fontToolsTree(runtime.python.fontToolsPackage,all);
    const inspector=capture(path.join(SOURCE_ROOT,'services/api/test-support/task12-official-document-fidelity.py'),undefined,'INSPECTOR',128 * 1024);
    all.push(metadata(inspector),metadata(capture(path.join(SOURCE_ROOT,'services/api/test-support/task12-read-drawn-pdf.py'),undefined,'INSPECTOR',128*1024)));
    jdkTree(runtime.body25.jdkHome,all);
    for (const group of ['jars','classes','fonts']) {
      const listed = runtime.body25[group];
      need(Array.isArray(listed) && listed.length === lock[group].length,'FILES');
      for (const expected of lock[group]) {
        const matches = listed.filter(row => keys(row,['name','path']) && row.name === expected.name);
        need(matches.length === 1,'FILES'); all.push(metadata(capture(matches[0].path,expected.sha256,'FILES')));
      }
    }
    const document = capture(plan.document.path,plan.document.sha256,'DOCUMENT',20_000_000);
    need(keys(plan.document,['path','sha256','scopePath','scopeSha256','expectationsPath','expectationsSha256','officePath','officeSha256']) && hash(plan.document.sha256) && hash(plan.document.scopeSha256),'DOCUMENT');
    const scope = capture(plan.document.scopePath,plan.document.scopeSha256,'DOCUMENT',256_000); all.push(metadata(document),metadata(scope));
    const office=capture(plan.document.officePath,plan.document.officeSha256,'DOCUMENT',20000000);all.push(metadata(office));
    const expectations=capture(plan.document.expectationsPath,plan.document.expectationsSha256,'DOCUMENT',128*1024);all.push(metadata(expectations));
    // Reproduce the public source renderer from the already sealed build. ZIP
    // transport timestamps may vary; every uncompressed package part must match.
    const template=capture(path.join(SOURCE_ROOT,'services/api/assets/templates/material-purchase-real-v1.docx'),
      '44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd','DOCUMENT');all.push(metadata(template));
    if(!activation?.publicationOnly){
      const renderer=activation?.lease??require(path.join(SOURCE_ROOT,'services/api/dist/contract-document/task12-official-qualification-sample.js'));
      const canonical=activation?.lease?.canonicalDocx??renderer.canonicalOfficialQualificationDocx;
      need(typeof renderer.createOfficialQualificationSample==='function'&&typeof canonical==='function','DOCUMENT_RENDERER');
      activation?.lease.verifyFull();
      const sample=renderer.createOfficialQualificationSample(template.bytes);
      need(canonical(document.bytes)===canonical(sample.docx)&&canonical(office.bytes)===canonical(sample.officeDocx),'DOCUMENT_RENDERER');
      const {isDeepStrictEqual}=require('node:util');
      need(isDeepStrictEqual(JSON.parse(scope.bytes.toString('utf8')),JSON.parse(JSON.stringify({...sample.scope,docxSha256:document.sha256})))&&
        isDeepStrictEqual(JSON.parse(expectations.bytes.toString('utf8')),JSON.parse(JSON.stringify(sample.expectations))),'DOCUMENT_RENDERER');
      activation?.lease.verifyFull();
    }
    const runRoot = privateDirectory(activation?activation.runtimeInput.runRoot:plan.runRoot);if(!activation)need(fs.readdirSync(runRoot.path).length===0,'DIRECTORY');
    const materialSha256=sha(JSON.stringify(all.map(({path,sha256,kind,target,realpath,identity})=>({path,sha256,kind,target,realpath,mode:identity.mode}))));
    if(activation){
      const currentControls=toolControlWitness();
      validateOfficialQualificationRegistration({...activation,currentSource:JSON.parse(JSON.stringify(source)),currentControls:JSON.parse(JSON.stringify(currentControls)),
        qualifiedPlan:plan,qualifiedPlanSha256:expectedSha256,buildSha256:plan.build.sha256,materialSha256,currentHost:JSON.parse(JSON.stringify(hostBoundary()))});
      all.push(...activation.files);
    }
    if(activation?.publicationOnly)return frozen({status:'PUBLICATION_OBSERVED_NOT_RUNTIME_AUTHORITY',profile:PROFILE,source,inputSha256:activation.input.sha256,buildSha256:plan.build.sha256,materialSha256,nativeAdmission:false,executionAllowed:false});
    const proof=frozen({profile:PROFILE,kind:activation?'OFFICIAL_TOOL_RUNTIME':'QUALIFICATION_ONLY',inputSha256:activation?activation.input.sha256:expectedSha256,
      source,hostBoundary:hostBoundary(),candidateLockSha256:LOCK_SHA,buildSha256:plan.build.sha256,materialSha256,
      ...(activation?{machineReceiptSha256:activation.machineSha256,physicalReviewSha256:activation.physicalSha256}:{}),nativeAdmission:false,executionAllowed:false});
    inspected.set(proof,{plan:frozen(plan),source,kind:proof.kind,lock:frozen(lock),all,runRoot,started,
      check: () => { canonicalProfile();activation?.lease?.check();sourceFiles.forEach(item=>continuity(item));all.forEach(item=>continuity(item)); continuity(runRoot); },
      checkMaterials: () => { canonicalProfile();activation?.lease?.verifyFull();sourceFiles.forEach(item=>continuity(item,true));all.forEach(item=>continuity(item,true)); continuity(runRoot);activation?.lease?.verifyFull(); }, proof });
    return proof;
  } catch (cause) {
    if (cause?.code?.startsWith('TASK12_OFFICIAL_DOCUMENT_')) throw cause;
    throw error('INPUT',cause);
  }
}

/** Only a verified one-use qualification packet enters this scope. It never
 * grants native/application runtime authority while the candidate is PENDING. */
async function withOfficialDocumentQualification(proof,use) {
  need(arguments.length===2,'SCOPE');return enterScope(proof,undefined,use,'QUALIFICATION_ONLY');
}
async function enterScope(proof,runRoot,use,kind) {
  canonicalProfile();
  const captured=inspected.get(proof);
  need(captured&&captured.kind===kind&&typeof use==='function'&&!context.current()&&(runRoot===undefined||runRoot===captured.runRoot.path),'SCOPE');
  inspected.delete(proof);
  // Three independent physical inspections (25s each), one Java and one LO
  // child (120s each). Source/material checks consume this same total envelope.
  const entered=performance.now();
  const remainingTotalMilliseconds=()=>{const value=(kind==='OFFICIAL_TOOL_RUNTIME'?900000:315000)-(performance.now()-(kind==='OFFICIAL_TOOL_RUNTIME'?entered:captured.started));need(value>0,'DEADLINE');return value;};
  remainingTotalMilliseconds();captured.checkMaterials();remainingTotalMilliseconds();exactSource(captured.source);
  // This is deliberately an exclusive attempt marker, never an activation flag.
  fs.writeFileSync(path.join(captured.runRoot.path,kind==='OFFICIAL_TOOL_RUNTIME'?'official-runtime-attempt.json':'qualification-attempt.json'), JSON.stringify(proof), { mode: 0o600, flag: 'wx' });
  const root = fs.mkdtempSync(path.join(captured.runRoot.path,'official-document-'));
  fs.chmodSync(root,0o700);
  const locations = Object.fromEntries(['java-scratch','temp','home','cache','fonts','python-site'].map(name => {
    const file = path.join(root,name); fs.mkdirSync(file,{mode:0o700}); return [name,file];
  }));
  const state = { ...captured, active: true };
  const xml = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const approved=new Map(captured.all.map(item=>[item.path,item]));
  for(const [packageName,packageRoot] of [['pymupdf',captured.plan.runtime.python.package],['fontTools',captured.plan.runtime.python.fontToolsPackage]]) {
    const destination=path.join(locations['python-site'],packageName);fs.mkdirSync(destination,{mode:0o700});
    const items=captured.all.filter(item=>item.sha256&&item.path.startsWith(packageRoot+path.sep));
    for(const item of items) {
      need(approved.get(item.path)===item,'PYTHON');
      const relative=path.relative(packageRoot,item.path);need(relative&&!relative.split(path.sep).includes('..'),'PYTHON');
      const target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{mode:0o700,recursive:true});
      const source=capture(item.path,item.sha256,'PYTHON');fs.writeFileSync(target,source.bytes,{mode:0o600,flag:'wx'});
      state.all.push(metadata(capture(target,item.sha256,'PYTHON')));
    }
  }

  const bindPythonDirectories=current=>{
    const stat=fs.lstatSync(current);
    need(stat.isDirectory()&&!stat.isSymbolicLink(),'PYTHON');
    state.all.push({path:current,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'].map(key=>[key,stat[key]]))});
    for(const name of fs.readdirSync(current)) {
      const file=path.join(current,name),entry=fs.lstatSync(file);need(!entry.isSymbolicLink(),'PYTHON');
      if(entry.isDirectory())bindPythonDirectories(file);
    }
  };
  bindPythonDirectories(locations['python-site']);
  for (const font of captured.plan.runtime.body25.fonts) {
    const approved=captured.lock.fonts.find(item=>item.name === font.name);
    const source=capture(font.path,approved.sha256,'FONTS');
    const destination=path.join(locations.fonts,font.name + '.ttf');
    fs.writeFileSync(destination,source.bytes,{mode:0o600,flag:'wx'});
    state.all.push(capture(destination,approved.sha256,'FONTS'));
  }
  const fontConfig=path.join(root,'fonts.conf');
  fs.writeFileSync(fontConfig,'<?xml version="1.0"?><fontconfig><reset-dirs/><dir>' + xml(locations.fonts) +
    '</dir><cachedir>' + xml(locations.cache) + '</cachedir></fontconfig>',{mode:0o600,flag:'wx'});
  state.all.push(capture(fontConfig,undefined,'FONTS'));
  const manifest = path.join(root,'runtime-manifest.json');
  fs.writeFileSync(manifest,JSON.stringify({ schemaVersion:1, engine:captured.lock.engine,
    jdkHome:captured.plan.runtime.body25.jdkHome, scratchDirectory:locations['java-scratch'],
    jars:captured.plan.runtime.body25.jars, classes:captured.plan.runtime.body25.classes, fonts:captured.plan.runtime.body25.fonts }),{mode:0o600,flag:'wx'});
  const manifestFile = capture(manifest,undefined,'MANIFEST'); state.all.push(manifestFile);
  const directories = [privateDirectory(root),...Object.values(locations).map(privateDirectory)];
  const check = () => { need(state.active,'CONTINUITY'); remainingTotalMilliseconds();state.check(); directories.forEach(item=>continuity(item)); };
  const checkMaterials = () => { need(context.current()===state.live,'CONTINUITY');check();state.checkMaterials(); };
  let readStarted=false;
  const readPdfDrawnText=async(bytes,signal)=>{
    check();need(kind==='OFFICIAL_TOOL_RUNTIME'&&context.current()===state.live&&!readStarted&&Buffer.isBuffer(bytes)&&bytes.length>4&&bytes.length<=100000000&&bytes.subarray(0,5).equals(Buffer.from('%PDF-'))&&signal instanceof AbortSignal&&!signal.aborted,'READER');
    readStarted=true;const budget=createOfficialDocumentChildBudget(state.live,25000);
    const output=await budget.run(timeout=>new Promise((resolve,reject)=>{
      const child=execFile(captured.plan.runtime.python.executable,['-I','-S','-B',path.join(SOURCE_ROOT,'services/api/test-support/task12-read-drawn-pdf.py'),locations['python-site']],{
        cwd:locations.temp,env:{PATH:'/usr/bin:/bin',HOME:locations.home,TMPDIR:locations.temp,PYTHONDONTWRITEBYTECODE:'1',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'},
        timeout,maxBuffer:4*1024*1024,killSignal:'SIGKILL',encoding:'utf8',signal},(error,stdout,stderr)=>{
          if(error){reject(error);return;}if(stderr.length){reject(Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_READER'),{code:'TASK12_OFFICIAL_DOCUMENT_READER'}));return;}
          resolve(stdout);
        });
      child.stdin.on('error',()=>{});child.stdin.end(bytes);
    }));
    const pages=JSON.parse(output);need(Array.isArray(pages)&&pages.length>0&&pages.length<=100&&pages.every(page=>typeof page==='string')&&pages.join('').length<=500000,'READER');
    return pages;
  };
  state.scope = frozen({ profile:PROFILE, kind, evidence:proof,readPdfDrawnText,lockName:LOCK_NAME, lockSha256:LOCK_SHA,
    source:proof.source, materialSha256:proof.materialSha256,checkMaterials,remainingTotalMilliseconds,
    pythonExecutable:captured.plan.runtime.python.executable,pythonSite:locations['python-site'],pythonPackage:captured.plan.runtime.python.package,
    fontToolsPackage:captured.plan.runtime.python.fontToolsPackage,inspectionFonts:captured.lock.fonts.map(item=>({name:item.name,path:path.join(locations.fonts,item.name+'.ttf'),sha256:item.sha256})),
    inspectorPath:path.join(SOURCE_ROOT,'services/api/test-support/task12-official-document-fidelity.py'), manifestPath:manifest, manifestSha256:manifestFile.sha256,
    temporaryDirectory:locations.temp, libreOfficeCommand:captured.plan.runtime.libreOffice.wrapper,javaScratchDirectory:locations['java-scratch'],
    libreOfficeEnv: { PATH:'/usr/bin:/bin', HOME:locations.home, TMPDIR:locations.temp,
      PYTHONDONTWRITEBYTECODE:'1', XDG_CACHE_HOME:locations.cache, FONTCONFIG_FILE:fontConfig, LANG:'en_US.UTF-8', LC_ALL:'en_US.UTF-8' } });
  const capability = context.issue(state.scope,check);
  try {
    return await context.run(capability,async scope => {
      state.live=scope;
      let failed=false,first,result;
      try { result=await use(scope); }catch(error){failed=true;first=error;}
      try {checkMaterials();exactSource(captured.source);}catch(error){first=failed?attachPostcheck(first,error):error;failed=true;}
      if(failed)throw first;return result;
    });
  } finally {
    state.active = false;
    // Qualification outputs and failures are evidence. Do not delete or repair
    // any path here, especially after uncertain ownership or background work.
  }
}

function privateJson(file,expected,part,max=128*1024) {
  const item=capture(file,expected,part,max);
  need(item.identity.uid===process.getuid()&&(item.identity.mode & 0o077)===0,part);
  privateDirectory(path.dirname(file));
  return {item:metadata(item),data:JSON.parse(item.bytes.toString('utf8'))};
}
function registryMaterial(){
  try{
    const file=capture(path.join(SOURCE_ROOT,REGISTRY_PATH),undefined,'REGISTRY',128*1024),registry=JSON.parse(file.bytes.toString('utf8'));
    need(keys(registry,['version','profile','qualification'])&&registry.version===1&&registry.profile===PROFILE,'REGISTRY');
    if(registry.qualification===null)throw error('QUALIFICATION_PENDING');
    need(keys(registry.qualification,['machineReceipt','physicalReview']),'REGISTRY');
    return {registry,file:metadata(file)};
  }catch(cause){if(cause?.code?.startsWith('TASK12_OFFICIAL_DOCUMENT_'))throw cause;throw error('REGISTRY',cause);}
}
/** Registry is immutable reviewed source metadata, not a caller flag. A new
 * source witness includes it; unchanged controls/build/material are rechecked. */
function inspectPublishedRuntime(file,expectedSha256,moduleView,publicationOnly){
  const registration=registryMaterial();
  try {
    need(hash(expectedSha256),'INPUT');
    const input=privateJson(file,expectedSha256,'INPUT'),runtimeInput=input.data;
    need(keys(runtimeInput,['version','profile','purpose','source','qualificationRegistrySha256','qualificationPlanSha256','runRoot'])&&runtimeInput.version===1&&runtimeInput.profile===PROFILE&&runtimeInput.purpose==='TASK12_GENERATED_LIFECYCLE_LOCAL_ONLY_V1'&&runtimeInput.qualificationRegistrySha256===registration.file.sha256,'REGISTRY');
    exactSource(runtimeInput.source);
    let lease;
    if(!publicationOnly){
      canonicalProfile();
      lease=require('./task16-current259-client-loader.cjs').claimCurrent261OfficialDocumentModules(moduleView);
      need(lease.root===SOURCE_ROOT&&lease.source.candidateSha===runtimeInput.source.head&&lease.source.tree===runtimeInput.source.tree,'MODULES');
      lease.verifyFull();
    }
    const registered=registration.registry.qualification;
    need(keys(registered.machineReceipt,['path','sha256'])&&keys(registered.physicalReview,['path','sha256'])&&hash(registered.machineReceipt.sha256)&&hash(registered.physicalReview.sha256),'REGISTRY');
    const machine=privateJson(registered.machineReceipt.path,registered.machineReceipt.sha256,'REGISTRY',2*1024*1024),physical=privateJson(registered.physicalReview.path,registered.physicalReview.sha256,'REGISTRY');
    need(machine.data.profile===PROFILE&&machine.data.status==='MACHINE_QUALIFICATION_PASSED_PHYSICAL_REVIEW_PENDING'&&keys(machine.data.plan,['path','sha256'])&&machine.data.plan.sha256===runtimeInput.qualificationPlanSha256&&hash(machine.data.plan.sha256),'REGISTRY');
    const files=[input.item,registration.file,machine.item,physical.item],reports={};
    need(keys(machine.data.actions,['java','office','normalized']),'REGISTRY');
    for(const name of ['java','office','normalized']) {
      const action=machine.data.actions[name];need(action&&hash(action.pdfSha256)&&hash(action.physicalSha256),'REGISTRY');
      const pdf=capture(action.pdfPath,action.pdfSha256,'REGISTRY',100000000);need(pdf.bytes.subarray(0,5).equals(Buffer.from('%PDF-')),'REGISTRY');files.push(metadata(pdf));
      const report=privateJson(action.physicalPath,action.physicalSha256,'REGISTRY',4*1024*1024);files.push(report.item);reports[name]=report.data;
    }
    return inspectMaterials(machine.data.plan.path,machine.data.plan.sha256,{registry:registration.registry,registrySha256:registration.file.sha256,
      publicationOnly,lease,input:input.item,runtimeInput,machine:machine.data,physical:physical.data,machineSha256:machine.item.sha256,physicalSha256:physical.item.sha256,reports,files});
  } catch(cause) {if(cause?.code?.startsWith('TASK12_OFFICIAL_DOCUMENT_'))throw cause;throw error('REGISTRY',cause);}
}
/** Pure filesystem publication observation. It loads no dist/dependency modules,
 * emits no brand and cannot be passed to withOfficialTask12DocumentRuntime. */
function observeOfficialTask12DocumentPublication(file,expectedSha256){
  need(arguments.length===2,'INPUT');return inspectPublishedRuntime(file,expectedSha256,undefined,true);
}
function verifyOfficialTask12DocumentRuntime(file,expectedSha256,moduleView){
  need(arguments.length===3,'INPUT');return inspectPublishedRuntime(file,expectedSha256,moduleView,false);
}
async function withOfficialTask12DocumentRuntime(proof,runRoot,use){
  registryMaterial();need(arguments.length===3,'SCOPE');return enterScope(proof,runRoot,use,'OFFICIAL_TOOL_RUNTIME');
}

function prepareOfficialTask12DocumentRuntimeInput(outputPath,runRoot){
  const registration=registryMaterial();
  need(arguments.length===2&&typeof outputPath==='string'&&path.isAbsolute(outputPath)&&path.normalize(outputPath)===outputPath,'INPUT');
  privateDirectory(path.dirname(outputPath));privateDirectory(runRoot);
  const machine=privateJson(registration.registry.qualification.machineReceipt.path,registration.registry.qualification.machineReceipt.sha256,'REGISTRY',2*1024*1024);
  need(machine.data.profile===PROFILE&&keys(machine.data.plan,['path','sha256'])&&hash(machine.data.plan.sha256),'REGISTRY');
  const input={version:1,profile:PROFILE,purpose:'TASK12_GENERATED_LIFECYCLE_LOCAL_ONLY_V1',source:sourceWitness(),
    qualificationRegistrySha256:registration.file.sha256,qualificationPlanSha256:machine.data.plan.sha256,runRoot};
  const bytes=Buffer.from(JSON.stringify(input,null,2)+'\n');fs.writeFileSync(outputPath,bytes,{mode:0o600,flag:'wx'});
  observeOfficialTask12DocumentPublication(outputPath,sha(bytes));
  return Object.freeze({status:'SOURCE_ONLY_RUNTIME_INPUT_PREPARED_NOT_EXECUTED',path:outputPath,sha256:sha(bytes),source:input.source,profile:PROFILE,executionAllowed:false,nativeAdmission:false});
}

function currentOfficialDocumentScope() { return context.current(); }

const published = Object.freeze({ PROFILE, LOCK_NAME, LOCK_SHA, currentOfficialDocumentScope, withOfficialDocumentQualification, inspectOfficialDocumentQualification, observeOfficialTask12DocumentPublication, verifyOfficialTask12DocumentRuntime, withOfficialTask12DocumentRuntime, prepareOfficialTask12DocumentRuntimeInput, sourceWitness, buildWitness, buildToolWitness, toolControlWitness, hostBoundary });

module.exports=published;
