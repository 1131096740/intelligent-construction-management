'use strict';

// Local offline tool qualification only. This command cannot start native,
// PostgreSQL, migrations, COS or issue an application runtime capability.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync,execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');
const exec=promisify(execFile);
const { createOfficialDocumentChildBudget,attachPostcheck } = require('../services/api/prisma/task12-official-document-child.cjs');
const { runOfficialQualificationActions } = require('../services/api/prisma/task12-official-qualification-actions.cjs');
const { validateOfficialDocumentFidelity,validateOfficialOfficeFidelity,validateOfficialMergedFidelity } = require('../services/api/prisma/task12-official-document-fidelity.cjs');
const {
  PROFILE, LOCK_SHA, sourceWitness, buildWitness, buildToolWitness, toolControlWitness, inspectOfficialDocumentQualification, withOfficialDocumentQualification, hostBoundary
} = require('../services/api/prisma/task12-official-document-profile.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = value => { if (!value) throw new Error('TASK12_OFFICIAL_QUALIFICATION_ARGUMENTS'); };
const sameKeys = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function read(file, expected, maxBytes=128*1024) {
  need(typeof file === 'string' && path.isAbsolute(file) && fs.realpathSync(file) === file);
  const stat = fs.lstatSync(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  const bytes = fs.readFileSync(file); need(sha(bytes) === expected);
  return JSON.parse(bytes.toString('utf8'));
}

function privateOutputParent(file) {
  need(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&!/[\u0000-\u001f]/u.test(file)&&!fs.existsSync(file));
  const parent=path.dirname(file);need(parent.startsWith('/private/tmp/')&&fs.realpathSync(parent)===parent);
  const stat=fs.lstatSync(parent);need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode & 0o077)===0);
  return parent;
}
function describeOfficialBuildCommand(root) {
  need(typeof root==='string'&&root.startsWith('/private/tmp/')&&path.normalize(root)===root);
  const executable='/Users/leoyang/.nvm/versions/node/v20.20.2/bin/node';
  const cli='/Users/leoyang/.local/lib/node_modules/pnpm/bin/pnpm.cjs';
  return {executable,argv:[cli,'--filter','@jiangkong/api','build'],env:{
    PATH:path.dirname(executable)+':/usr/bin:/bin',HOME:path.join(root,'home'),TMPDIR:path.join(root,'temp'),
    XDG_CONFIG_HOME:path.join(root,'config'),V8_COMPILE_CACHE_CACHE_DIR:path.join(root,'cache'),
    npm_execpath:cli,npm_config_userconfig:'/dev/null',npm_config_globalconfig:'/dev/null',
    npm_config_offline:'true',COREPACK_ENABLE_NETWORK:'0',PYTHONDONTWRITEBYTECODE:'1',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'
  }};
}

function build(outputPath) {
  privateOutputParent(outputPath);
  const source = sourceWitness();
  need(typeof outputPath === 'string' && path.isAbsolute(outputPath) && !fs.existsSync(outputPath));
  const parent = fs.lstatSync(path.dirname(outputPath));
  need(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o077) === 0);
  const toolchain=buildToolWitness();
  const own=fs.mkdtempSync(path.join(path.dirname(outputPath),'build-'));fs.chmodSync(own,0o700);
  for(const name of ['home','temp','config','cache'])fs.mkdirSync(path.join(own,name),{mode:0o700});
  const command=describeOfficialBuildCommand(own);
  fs.writeFileSync(path.join(own,'COMMAND.json'),JSON.stringify(command,null,2),{mode:0o600,flag:'wx'});
  // Source-only compilation. All child output and the first error are retained.
  const stdout=fs.openSync(path.join(own,'STDOUT.log'),'wx',0o600),stderr=fs.openSync(path.join(own,'STDERR.log'),'wx',0o600);
  try { execFileSync(command.executable,command.argv,{cwd:path.resolve(__dirname,'..'),env:command.env,
    timeout:120_000,maxBuffer:8*1024*1024,stdio:['ignore',stdout,stderr]}); }
  finally { fs.closeSync(stdout);fs.closeSync(stderr); }
  need(JSON.stringify(buildToolWitness())===JSON.stringify(toolchain));
  need(JSON.stringify(sourceWitness()) === JSON.stringify(source));
  const record = { status:'SOURCE_BOUND_BUILD_NOT_QUALIFICATION', source, files:buildWitness(),toolchain };
  const bytes = Buffer.from(JSON.stringify(record,null,2) + '\n');
  fs.writeFileSync(outputPath,bytes,{mode:0o600,flag:'wx'});
  return { status:record.status, path:outputPath, sha256:sha(bytes), files:record.files.length };
}

function prepare(requestPath, expected, outputPath) {
  privateOutputParent(outputPath);
  const request = read(requestPath,expected);
  need(sameKeys(request,['build','archive','runtime','runRoot'])&&typeof request.runRoot==='string'&&!outputPath.startsWith(request.runRoot+path.sep));
  const source=sourceWitness(),buildRecord=read(request.build.path,request.build.sha256,32*1024*1024);
  need(JSON.stringify(buildRecord.source)===JSON.stringify(source)&&JSON.stringify(buildRecord.files)===JSON.stringify(buildWitness())&&
    JSON.stringify(buildRecord.toolchain)===JSON.stringify(buildToolWitness()));
  const sampleDirectory=fs.mkdtempSync(path.join(path.dirname(outputPath),'formal-sample-'));fs.chmodSync(sampleDirectory,0o700);
  const producer=require('../services/api/dist/contract-document/task12-official-qualification-sample.js');
  const sample=producer.createOfficialQualificationSample(fs.readFileSync(path.resolve(__dirname,'../services/api/assets/templates/material-purchase-real-v1.docx')));
  const office=path.join(sampleDirectory,'office-preview.docx'),docx=path.join(sampleDirectory,'material.docx'),scope=path.join(sampleDirectory,'line-box-scope.json'),expectations=path.join(sampleDirectory,'EXPECTED.json');
  const scopeBytes=Buffer.from(JSON.stringify(sample.scope,null,2)+'\n'),expectationBytes=Buffer.from(JSON.stringify(sample.expectations,null,2)+'\n');
  for(const [name,bytes] of [[docx,sample.docx],[office,sample.officeDocx],[scope,scopeBytes],[expectations,expectationBytes]])fs.writeFileSync(name,bytes,{mode:0o600,flag:'wx'});
  const document={path:docx,sha256:sha(sample.docx),scopePath:scope,scopeSha256:sha(scopeBytes),expectationsPath:expectations,expectationsSha256:sha(expectationBytes),officePath:office,officeSha256:sha(sample.officeDocx)};
  const plan = { version:1, profile:PROFILE, source, ...request,document };
  need(path.isAbsolute(outputPath) && fs.realpathSync(path.dirname(outputPath)) === path.dirname(outputPath));
  const parent = fs.lstatSync(path.dirname(outputPath));
  need(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o077) === 0);
  const bytes = Buffer.from(JSON.stringify(plan,null,2) + '\n');
  fs.writeFileSync(outputPath,bytes,{mode:0o600,flag:'wx'});
  const proof = inspectOfficialDocumentQualification(outputPath,sha(bytes));
  return { status:'QUALIFICATION_ONLY_PREPARED_NOT_EXECUTED', planPath:outputPath, planSha256:sha(bytes), proof };
}

function fixedWrite(file,bytes) { fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'}); }
function firstFailure(error) {
  const chain=[];let current=error;
  for(let n=0;n<8&&current;n++,current=current.cause)chain.push(current);
  const original=chain[chain.length-1]??error;
  return {name:original?.name??'Error',code:original?.code??null,signal:original?.signal??null,killed:original?.killed===true,
    message:typeof original?.message==='string'?original.message.slice(0,2000):'UNKNOWN',
    postcheckFailed:chain.some(item=>Object.hasOwn(item,'postcheckFailure'))};
}
function errorLogs(error,root,label) {
  let value=error;
  for(let n=0;n<8&&value;n++,value=value.cause)for(const name of ['stdout','stderr']) {
    if((typeof value[name]==='string'||Buffer.isBuffer(value[name]))&&Buffer.byteLength(value[name])<=4*1024*1024) {
      const file=path.join(root,label+'-'+n+'-'+name+'.log');fixedWrite(file,value[name]);
    }
  }
}
async function inspectPdf(scope,plan,label,pdfPath,docxPath,docxSha256) {
  const started=performance.now(),budget=createOfficialDocumentChildBudget(scope,25000,started);
  const root=fs.mkdtempSync(path.join(plan.runRoot,label+'-physical-'));fs.chmodSync(root,0o700);
  const pdfSha256=sha(fs.readFileSync(pdfPath));
  const request={version:1,profile:PROFILE,pythonSite:scope.pythonSite,pdfPath,pdfSha256,docxPath,docxSha256,
    outputDirectory:root,fonts:scope.inspectionFonts};
  const file=path.join(root,'REQUEST.json'),bytes=Buffer.from(JSON.stringify(request,null,2)+'\n');fixedWrite(file,bytes);
  const result=await budget.run(timeout=>exec(scope.pythonExecutable,['-I','-S','-B',scope.inspectorPath,file,sha(bytes)],{
    cwd:root,env:{PATH:'/usr/bin:/bin',HOME:scope.libreOfficeEnv.HOME,TMPDIR:scope.libreOfficeEnv.TMPDIR,
      PYTHONDONTWRITEBYTECODE:'1',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'},timeout,maxBuffer:4*1024*1024}));
  fixedWrite(path.join(root,'STDOUT.log'),result.stdout);fixedWrite(path.join(root,'STDERR.log'),result.stderr);
  need(result.stderr.length===0);const report=JSON.parse(result.stdout);need(report.pdfSha256===pdfSha256);
  const reportPath=path.join(root,'REPORT.json');fixedWrite(reportPath,JSON.stringify(report,null,2)+'\n');
  budget.remaining();return {report,path:reportPath,sha256:sha(fs.readFileSync(reportPath))};
}
async function rejectionBoundaries(converter,scope,bytes,lineBoxScope) {
  const before=fs.readdirSync(scope.javaScratchDirectory).sort();
  const unchanged=()=>need(JSON.stringify(fs.readdirSync(scope.javaScratchDirectory).sort())===JSON.stringify(before));
  const reject=async(operation,message)=>{let rejected=false;try{await operation();}catch(error){need(error.message===message);rejected=true;}need(rejected);unchanged();};
  const typographyVersion='reviewed-material-primary-secondary-body25-v4';
  await reject(()=>converter.assertContractBodyPdfRuntimeLock('0'.repeat(64),typographyVersion),'合同正文转换运行环境未就绪，请联系管理员');
  const options={typographyVersion,lineBoxScope};
  await reject(()=>converter.convertContractBodyDocxToPdf(Buffer.from('not a DOCX'),LOCK_SHA,options),'合同正文文件无法安全转换，请核对文件内容');
  const PizZip=require('../services/api/node_modules/pizzip');
  const external=new PizZip(bytes),relations='word/_rels/document.xml.rels';
  const relationXml=external.file(relations).asText();
  external.file(relations,relationXml.replace('</Relationships>','<Relationship Id="qualification-external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://qualification.invalid/" TargetMode="External"/></Relationships>'));
  await reject(()=>converter.convertContractBodyDocxToPdf(external.generate({type:'nodebuffer'}),LOCK_SHA,options),'合同正文文件无法安全转换，请核对文件内容');
  const active=new PizZip(bytes),document=active.file('word/document.xml').asText();
  active.file('word/document.xml',document.replace('</w:body>','<w:p><w:fldSimple w:instr="HYPERLINK https://qualification.invalid/"><w:r><w:t>blocked</w:t></w:r></w:fldSimple></w:p></w:body>'));
  await reject(()=>converter.convertContractBodyDocxToPdf(active.generate({type:'nodebuffer'}),LOCK_SHA,options),'合同正文文件无法安全转换，请核对文件内容');
  return {foreignSnapshotRejected:true,malformedDocxRejected:true,externalRelationshipRejected:true,activeFieldRejected:true,noNegativeConverterScratchCreated:true};
}
async function once(planPath,expected) {
  const started=performance.now(),proof=inspectOfficialDocumentQualification(planPath,expected),plan=read(planPath,expected);
  let active='SCOPE';const rootIdentity=fs.lstatSync(plan.runRoot);
  const owned=()=>{const current=fs.lstatSync(plan.runRoot);need(!current.isSymbolicLink()&&current.isDirectory()&&fs.realpathSync(plan.runRoot)===plan.runRoot&&
    current.dev===rootIdentity.dev&&current.ino===rootIdentity.ino&&current.uid===rootIdentity.uid&&current.mode===rootIdentity.mode);};
  const stage=async(name,operation)=>{
    active=name;owned();const tick=performance.now();fixedWrite(path.join(plan.runRoot,name+'-STARTED.json'),JSON.stringify({name,startedAt:new Date().toISOString()}));
    try {const result=await operation();owned();fixedWrite(path.join(plan.runRoot,name+'-COMPLETED.json'),JSON.stringify({name,status:'COMPLETED',exitCode:0,elapsedMs:performance.now()-tick}));return result;}
    catch(error){try{owned();errorLogs(error,plan.runRoot,name);fixedWrite(path.join(plan.runRoot,name+'-FAILED.json'),JSON.stringify({name,status:'STOPPED',elapsedMs:performance.now()-tick,firstFailure:firstFailure(error)}));}catch(logError){throw attachPostcheck(error,logError);}throw error;}
  };
  try {
    const result=await withOfficialDocumentQualification(proof,async scope=>{
      scope.checkMaterials();
      const converter=require('../services/api/dist/contract-document/contract-body-pdf-converter.js');
      const officeConverter=require('../services/api/dist/contract-document/libreoffice-converter.js');
      const normalizer=require('../services/api/dist/contract-document/pdf-normalizer.js');
      scope.checkMaterials();
      const bytes=fs.readFileSync(plan.document.path),officeBytes=fs.readFileSync(plan.document.officePath),lineBoxScope=JSON.parse(fs.readFileSync(plan.document.scopePath,'utf8'));
      const savePdf=(label,pdf)=>{need(Buffer.isBuffer(pdf)&&pdf.subarray(0,5).equals(Buffer.from('%PDF-'))&&pdf.length<=100000000);const file=path.join(plan.runRoot,label+'.pdf');fixedWrite(file,pdf);return {bytes:pdf,path:file,sha256:sha(pdf)};};
      return runOfficialQualificationActions({
        negative:()=>stage('01-NEGATIVE',()=>rejectionBoundaries(converter,scope,bytes,lineBoxScope)),
        java:()=>stage('02-JAVA',async()=>{
          const typographyVersion='reviewed-material-primary-secondary-body25-v4',fingerprint=await converter.contractBodyPdfRuntimeLockFingerprint(typographyVersion);need(fingerprint===LOCK_SHA);
          const output=await converter.convertContractBodyDocxToPdf(bytes,fingerprint,{typographyVersion,lineBoxScope});
          need(output.provenance.conversionCalls===1&&output.provenance.boundaryDenials===3);return {...savePdf('java',output.pdf),provenance:output.provenance};
        }),
        inspectJava:java=>stage('03-JAVA-INSPECT',async()=>{
          const report=await inspectPdf(scope,plan,'java',java.path,plan.document.path,plan.document.sha256);
          return {...report,verdict:validateOfficialDocumentFidelity(report.report,java.sha256)};
        }),
        office:()=>stage('04-OFFICE',async()=>{
          const runner=async(command,args,options)=>{
            need(command===scope.libreOfficeCommand&&options.cwd.startsWith(scope.temporaryDirectory+path.sep)&&
              JSON.stringify(options.env)===JSON.stringify(scope.libreOfficeEnv)&&options.timeout>0&&options.timeout<=120000);
            need(args.length===7&&args[0]==='-env:UserInstallation='+pathToFileURL(path.join(options.cwd,'profile')).href&&
              JSON.stringify(args.slice(1,5))===JSON.stringify(['--headless','--convert-to','pdf','--outdir'])&&args[5]===options.cwd&&args[6]===path.join(options.cwd,'input.docx'));
            const output=await exec(command,args,{...options,maxBuffer:4*1024*1024});
            fixedWrite(path.join(plan.runRoot,'OFFICE-STDOUT.log'),output.stdout);fixedWrite(path.join(plan.runRoot,'OFFICE-STDERR.log'),output.stderr);return output;
          };
          return savePdf('office',await officeConverter.convertDocxToPdf(officeBytes,[],{runner}));
        }),
        inspectOffice:office=>stage('05-OFFICE-INSPECT',async()=>{
          const report=await inspectPdf(scope,plan,'office',office.path,plan.document.officePath,plan.document.officeSha256);
          return {...report,verdict:validateOfficialOfficeFidelity(report.report,office.sha256)};
        }),
        normalize:(java,office)=>stage('06-NORMALIZE',async()=>{
          // Existing public PDF adapter only, not an LO merge or a business write.
          const normalized=await normalizer.normalizeContractPdf(java.bytes,[{name:'fixed-office-preview.pdf',buffer:office.bytes,type:'pdf'}]);
          need(normalized.warnings.length===0);return savePdf('normalized',normalized.buffer);
        }),
        inspectNormalized:(normalized,javaPhysical,officePhysical)=>stage('07-NORMALIZED-INSPECT',async()=>{
          const report=await inspectPdf(scope,plan,'normalized',normalized.path,plan.document.path,plan.document.sha256);
          return {...report,verdict:validateOfficialMergedFidelity(report.report,javaPhysical.report,officePhysical.report,normalized.sha256)};
        })
      });
    });
    const controls=toolControlWitness();need(JSON.stringify(controls.source)===JSON.stringify(proof.source));
    const action=(pdf,physical)=>({pdfPath:pdf.path,pdfSha256:pdf.sha256,physicalPath:physical.path,physicalSha256:physical.sha256,pageCount:physical.report.pageCount,verdict:physical.verdict});
    const receipt={version:1,status:result.status,profile:PROFILE,runtimeAuthority:false,plan:{path:planPath,sha256:expected},source:proof.source,hostBoundary:hostBoundary(),
      toolControls:{sha256:controls.sha256,files:controls.files},candidateLockSha256:LOCK_SHA,buildSha256:proof.buildSha256,materialSha256:proof.materialSha256,
      boundaries:result.negative,actions:{java:action(result.java,result.javaPhysical),office:action(result.office,result.officePhysical),normalized:action(result.normalized,result.normalizedPhysical)},
      physicalReview:{status:'PENDING',exactPageCountsReviewed:false,signatureAndPaginationReviewed:false},elapsedMs:performance.now()-started};
    need(receipt.elapsedMs<=315000);owned();fixedWrite(path.join(plan.runRoot,'MACHINE-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
  } catch(error) {
    try {owned();fixedWrite(path.join(plan.runRoot,'STOPPED.json'),JSON.stringify({status:'STOPPED',stage:active,firstFailure:firstFailure(error),elapsedMs:performance.now()-started,runtimeAuthority:false},null,2)+'\n');}
    catch(logError){throw attachPostcheck(error,logError);}throw error;
  }
}

async function main(argv) {
  if (argv.length === 3 && argv[0] === '--build' && argv[1] === '--output') return build(argv[2]);
  if (argv.length === 6 && argv[0] === '--prepare' && argv[2] === '--expected-request-sha256' && argv[4] === '--output') {
    return prepare(argv[1],argv[3],argv[5]);
  }
  need(argv.length === 4 && ['--verify','--once'].includes(argv[0]) && argv[2] === '--expected-plan-sha256');
  if (argv[0] === '--verify') return { status:'QUALIFICATION_ONLY_VERIFIED_NOT_EXECUTED', proof:inspectOfficialDocumentQualification(argv[1],argv[3]) };
  return once(argv[1],argv[3]);
}
if (require.main === module) main(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value,null,2) + '\n'),
  error => { process.stderr.write((error.code || error.message) + '\n'); process.exitCode = 1; });
module.exports = Object.freeze({ build, prepare, once, main, describeOfficialBuildCommand });
