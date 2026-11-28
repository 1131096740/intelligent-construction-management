'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const pins=require('./pins.json');
const review=require('./tree-proof.json');
const scope=require('./scope.json');

const laneFiles=Object.freeze([
  'checkout.cjs.patch.gz','install-only292.cjs','installer.cjs.patch.gz','materialize.cjs','pins.json',
  'prepare.sh','run.sh','scope.json','stage.py','tree-proof.json',
]);
const laneFolder='.github/task12-install-292/';
const additions=[pins.loanCheck,pins.loanApproval];
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const blobOid=bytes=>hash(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),'sha1');

function projectIndex(index) {
  const selected=new Map();
  const prior=[];
  const lanePaths=laneFiles.map(file=>laneFolder+file);
  const fixed=new Set([...lanePaths,...additions.map(row=>row.path)]);
  for(const row of index.toString('utf8').split('\0').filter(Boolean)){
    const match=/^(100644|100755|120000|160000) ([a-f0-9]{40}) 0\t(.+)$/su.exec(row);
    assert.ok(match,'EXACT_292_INDEX_ROW');
    const [,mode,oid,file]=match;
    if (file === pins.canonicalBaseline.path) {
      assert.equal(mode, '100644', 'EXACT_292_CANONICAL_MODE');
      assert.equal(oid, pins.canonicalBaseline.oid, 'EXACT_292_CANONICAL_INDEX');
      assert.ok(!selected.has(file), 'EXACT_292_INDEX_DUPLICATE');
      selected.set(file, oid);
      prior.push(`100644 ${pins.canonicalBaseline.priorOid} 0	${file}`);
    } else if(fixed.has(file)){
      assert.equal(mode,'100644','EXACT_292_TRACKED_MODE');
      assert.ok(!selected.has(file),'EXACT_292_INDEX_DUPLICATE');
      selected.set(file,oid);
    }else{
      assert.ok(!file.startsWith(laneFolder),'EXACT_292_UNREVIEWED_HELPER');
      prior.push(row);
    }
  }
  for(const prefix of additions){
    assert.equal(selected.get(prefix.path),prefix.oid,'EXACT_292_ORDINARY_TAIL_INDEX');
  }
  assert.ok(selected.has(pins.canonicalBaseline.path), 'EXACT_292_CANONICAL_MISSING');
  assert.ok(lanePaths.every(file=>selected.has(file)),'EXACT_292_HELPER_CLOSURE');
  return {priorIndex:Buffer.from(prior.join('\0')+'\0'),selected};
}

function materializeFiles(root,target,index,input) {
  const prior=require(input);
  const priorProfile=require(path.join(path.dirname(input),'profile.json'));
  assert.equal(priorProfile.tree,review.base,'EXACT_292_290_REFERENCE_TREE');
  assert.equal(priorProfile.predecessorAttestation.tree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(scope.tree,review.tree);
  assert.equal(scope.prefixCount,291);
  assert.equal(scope.prefixLedgerSha256,review.intermediate291);
  assert.equal(scope.expectedLedgerSha256,review.combined292);
  assert.equal(scope.terminal.sha256,priorProfile.terminal.sha256,'EXACT_292_BALANCE_BYTES');
  const {priorIndex,selected}=projectIndex(index);
  for(const [file,oid] of selected){
    const source=path.join(root,file);
    assert.ok(fs.lstatSync(source).isFile()&&fs.realpathSync(source)===source,'EXACT_292_FILE_TYPE');
    assert.equal(blobOid(fs.readFileSync(source)),oid,'EXACT_292_FILE_BYTES');
  }
  assert.equal(hash(fs.readFileSync(path.join(root, pins.canonicalBaseline.path))),
    pins.canonicalBaseline.sha256, 'EXACT_292_CANONICAL_SHA256');
  prior.materializeFiles(root,target,priorIndex);
  const predecessor=path.join(target,'predecessor');
  const intermediate=path.join(target,'intermediate');
  fs.cpSync(path.join(predecessor,'services'),path.join(intermediate,'services'),{recursive:true,errorOnExist:true});
  for(const migration of additions){
    const bytes=fs.readFileSync(path.join(root,migration.path));
    assert.equal(hash(bytes),migration.sha256,'EXACT_292_ORDINARY_TAIL_SHA256');
    const destination=path.join(intermediate,migration.path);
    fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o755});
    fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o644});
  }
  assert.equal(hash(fs.readFileSync(path.join(target,'successor.sql'))),scope.terminal.sha256,'EXACT_292_BALANCE_SHA256');
  return {mode:'EXACT_292_INSTALL_ONLY_PRODUCT_INPUTS',tree:scope.tree,prefix289:review.prefix289,
    intermediate291:scope.prefixLedgerSha256,ledger292:scope.expectedLedgerSha256,files:294};
}

function materialize(root,target,sha) {
  root=fs.realpathSync(root);
  target=fs.realpathSync(target);
  const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:8*1024*1024});
  assert.ok(/^[a-f0-9]{40}$/u.test(sha)&&git('rev-parse','HEAD').toString().trim()===sha,'EXACT_292_CANDIDATE_COMMIT');
  assert.ok(git('diff','--name-only','-z','HEAD','--').length===0&&git('ls-files','--others','--exclude-standard','-z').length===0&&
    git('ls-files','-v','-z').toString().split('\0').filter(Boolean).every(row=>row.startsWith('H ')),'EXACT_292_DIRTY');
  assert.equal(fs.readdirSync(target).length,0,'EXACT_292_TARGET');
  const input=path.join(root,'.github/task12-install-290/materialize.cjs');
  return {...materializeFiles(root,target,git('ls-files','--stage','-z'),input),candidateSha:sha};
}

if(require.main===module){
  assert.equal(process.argv.length,5,'EXACT_292_ARGUMENTS');
  console.log(JSON.stringify(materialize(...process.argv.slice(2))));
}
module.exports={materialize,materializeFiles,projectIndex,laneFiles};
