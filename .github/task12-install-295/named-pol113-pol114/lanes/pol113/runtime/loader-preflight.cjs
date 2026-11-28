'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');

const root=__dirname;
const pinned=(relative,type)=>{
  const file=path.join(root,relative);
  const stat=fs.lstatSync(file);
  assert.equal(stat.isSymbolicLink(),false,relative);
  assert.equal(type==='dir'?stat.isDirectory():stat.isFile(),true,relative);
  assert.equal(stat.mode&0o777,type==='dir'?0o755:0o644,relative);
  fs.accessSync(file,fs.constants.R_OK|(type==='dir'?fs.constants.X_OK:0));
  return file;
};
function main(){
  const mode=process.argv[2];
  assert.ok(mode==='--modules-only'||mode==='--materials', 'NAMED_292_LOADER_MODE');
  assert.notEqual(process.getuid(),0);
  // Load the same module closure as the business entry without starting it.
  pinned('named292','dir');
  for(const name of ['successor.cjs','scope.json','tree-proof.json','successor.sql'])pinned('named292/'+name,'file');
  const admission=require('./candidate-admission.json');
  const {scope,verifySql}=require('./named292/successor.cjs');
  const stage=require('./named292/tree-proof.json');
  const {verifyNamed292Inputs,withNamedPol113Pol114292}=require('./installer.cjs');
  assert.equal(typeof withNamedPol113Pol114292,'function');
  assert.equal(typeof require('./stage-named-browser.cjs').stageBrowser,'function');
  assert.equal(typeof require('./browser-evidence.cjs').collectBrowserEvidence,'function');
  assert.equal(admission.tree,scope.tree);
  assert.equal(stage.tree,scope.tree);
  assert.match(admission.candidateSha,/^[a-f0-9]{40}$/u);
  assert.equal(admission.candidateSha,process.env.JG_NAMED_CANDIDATE_SHA);
  verifySql(path.join(root,'named292','successor.sql'));
  if(mode==='--materials'){
    for(const name of ['DATABASE_URL','PGHOST','PGUSER'])assert.equal(process.env[name],undefined,name);
    const inputs=verifyNamed292Inputs(path.join(root,'product/services/api/prisma'),
      path.join(root,'product291/services/api/prisma'),path.join(root,'named292/successor.sql'));
    assert.equal(inputs.through291.length,291);
    assert.equal(inputs.final.length,292);
    assert.equal(createHash('sha256').update(JSON.stringify(inputs.final)).digest('hex'),scope.expectedLedgerSha256);
  }
  console.log(JSON.stringify({status:'NAMED_292_READONLY_LOADER_PREFLIGHT_PASSED',mode,candidate:admission.candidateSha,postgresStarted:false}));
}
main();
