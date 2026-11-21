'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const verified = new WeakSet();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function verifyWorkspace(workspace='/qualification/workspace', inventory='/qualification/workspace-inputs.json') {
  const bytes=fs.readFileSync(inventory);
  if(sha(bytes)!=='a9214ab07931a9be3cc5ca94b802e395e01f3bc21cb3efed2a759365caf1caf6') throw new Error('POL109_WORKSPACE_MANIFEST');
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
