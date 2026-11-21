'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');

function verify(root) {
  const api=path.join(path.resolve(root),'services/api');
  const seed=path.join(api,'prisma/seed-layout-preview.cjs');
  assert.equal(createHash('sha256').update(readFileSync(seed)).digest('hex'), seedPin);
  const relative=[
    'seed-layout-docx-source','layout-preview-docx','libreoffice-converter',
    'layout-preview-values','contract-document.service',
  ];
  const fromSeed=createRequire(seed);
  for(const name of relative) {
    assert.equal(fromSeed.resolve('../dist/contract-document/'+name),
      path.join(api,'dist/contract-document',name+'.js'),'POL114_DIST_RESOLUTION');
  }
  const {initializeSeedLayout}=fromSeed(seed);
  assert.equal(typeof initializeSeedLayout,'function','POL114_ORIGINAL_SEED_EXPORT');
  return {sourcePin:seedPin, compiledModules:relative.length, namedExport:true};
}

const seedPin='07b935420979f9c9c85f89e074f45b9d5fb685aa972ca62471764da85510632b';
if(require.main===module) {
  try{process.stdout.write(JSON.stringify(verify(process.argv[2]))+'\n');}
  catch(error){process.stderr.write(JSON.stringify({code:error.code==='MODULE_NOT_FOUND'?'MODULE_NOT_FOUND':'POL114_LAYOUT_DIST_PREFLIGHT'})+'\n');process.exitCode=1;}
}
module.exports={verify};
