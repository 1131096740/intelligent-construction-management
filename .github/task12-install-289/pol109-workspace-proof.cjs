'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const verified = new WeakSet();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function verifyWorkspace(workspace='/qualification/workspace', inventory='/qualification/workspace-inputs.json') {
  const bytes=fs.readFileSync(inventory);
  if(sha(bytes)!=='a56377b010b0a945158d7d5f5dd1a3d491a21f5c66c706a0230169d1968e8088') throw new Error('POL109_WORKSPACE_MANIFEST');
  for(const row of JSON.parse(bytes)) {
    const file=path.join(workspace,row.path);
    if(!fs.lstatSync(file).isFile() || fs.realpathSync(file)!==file || sha(fs.readFileSync(file))!==row.sha256)
      throw new Error('POL109_WORKSPACE_BYTES');
  }
  const proof=Object.freeze({});
  verified.add(proof);
  return proof;
}

module.exports={verifyWorkspace,isVerifiedWorkspaceProof:proof=>verified.has(proof)};
