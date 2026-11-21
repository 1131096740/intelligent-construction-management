'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const profile = require('./profile.json');

const historicalCommit = '9674881d5fb328561b348ba8c5823b3fbc680980';
const assets = /^services\/api\/prisma\/(?:schema\.prisma|migrations\/(?:migration_lock\.toml|[0-9]{14}_[a-z0-9_]+\/migration\.sql))$/u;
const tail = 'services/api/prisma/migrations/' + profile.terminal.name + '/migration.sql';
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
function need(ok, code) { if (!ok) throw new Error(code); }

function verifyIndex(rows) {
  const original = rows.toString('utf8').split('\0').filter(Boolean).filter(record => {
    const match = /^(100644|100755|120000|160000) ([0-9a-f]{40}) 0\t(.+)$/su.exec(record);
    need(match && !match[3].startsWith('/') && !match[3].split('/').some(part => ['','.','..'].includes(part)),
      'EXACT_290_INDEX_RECORD');
    return !profile.originals.includes(match[3]);
  });
  need(original.length === profile.indexRows && digest(original.join('\0')+'\0') === profile.indexSha256,
    'EXACT_290_INDEX');
  return original.map(record=>({mode:record.slice(0,6),oid:record.slice(7,47),file:record.slice(record.indexOf('\t')+1)}));
}

function materialize(root, target, candidateSha) {
  root = fs.realpathSync(root);
  target = fs.realpathSync(target);
  need(fs.readdirSync(target).length===0,'EXACT_290_TARGET');
  const git = (...args) => execFileSync('git',['-C',root,...args],{maxBuffer:8*1024*1024});
  need(/^[0-9a-f]{40}$/u.test(candidateSha) &&
    git('rev-parse','HEAD').toString().trim()===candidateSha, 'EXACT_290_CANDIDATE_COMMIT');
  need(git('diff','--name-only','-z','HEAD','--').length===0 &&
    git('ls-files','--others','--exclude-standard','-z').length===0 &&
    git('ls-files','-v','-z').toString().split('\0').filter(Boolean).every(row=>row.startsWith('H ')),
  'EXACT_290_DIRTY');
  git('merge-base','--is-ancestor',historicalCommit,candidateSha);
  // Keep the frozen installer index and verify its selected files against the current checkout.
  const historicalTree = git('ls-tree','-r','-z','--full-tree',historicalCommit).toString('utf8');
  const historicalIndex = historicalTree.replace(/(?:^|\x00)([0-7]{6}) (?:blob|commit) ([0-9a-f]{40})\t/gu,
    (record,mode,oid) => (record.startsWith('\0') ? '\0' : '') + `${mode} ${oid} 0\t`);
  return {...materializeFiles(root,target,Buffer.from(historicalIndex)),candidateSha};
}

function materializeFiles(root,target,index) {
  const entries=verifyIndex(index).filter(({file})=>assets.test(file));
  need(entries.length===292 && entries.some(({file})=>file===tail),'EXACT_290_MATERIAL_COUNT');
  const rows=[];
  let successor;
  for(const {file,mode,oid} of entries){
    const source=path.join(root,file);
    need(fs.lstatSync(source).isFile()&&fs.realpathSync(source)===source&&mode==='100644','EXACT_290_FILE_TYPE');
    const bytes=fs.readFileSync(source);
    const object=digest(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),'sha1');
    need(object===oid,'EXACT_290_FILE_BYTES');
    if(file===tail){
      need(digest(bytes)===profile.terminal.sha256,'EXACT_290_TERMINAL');
      successor=bytes;
    } else rows.push({row:{path:file,mode,oid,sha256:digest(bytes)},bytes});
  }
  rows.sort((a,b)=>Buffer.compare(Buffer.from(a.row.path),Buffer.from(b.row.path)));
  const predecessor=profile.predecessorAttestation;
  need(rows.length===predecessor.materializedFiles&&digest(JSON.stringify(rows.map(x=>x.row)))===predecessor.materializedSha256,
    'EXACT_290_PREDECESSOR');
  const folder=path.join(target,'predecessor');
  fs.mkdirSync(folder,{mode:0o755});
  for(const {row,bytes} of rows){
    const dest=path.join(folder,row.path);
    fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o755});
    fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o644});
  }
  fs.writeFileSync(path.join(folder,'checkout-source.json'),JSON.stringify(predecessor)+'\n',{flag:'wx',mode:0o644});
  fs.writeFileSync(path.join(target,'successor.sql'),successor,{flag:'wx',mode:0o644});
  return {mode:profile.mode,tree:profile.tree,files:entries.length,expectedLedgerSha256:profile.expectedLedgerSha256};
}

if(require.main===module){
  const [command,root,target,sha]=process.argv.slice(2);
  need(command==='--materialize'&&process.argv.length===6,'EXACT_290_ARGUMENTS');
  console.log(JSON.stringify(materialize(root,target,sha)));
}
module.exports={materialize,materializeFiles,verifyIndex};
