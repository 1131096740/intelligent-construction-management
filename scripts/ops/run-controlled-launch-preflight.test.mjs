import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, realpath, writeFile, readFile, rm, open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const preflightRoot = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
import { runPreflight, persistPinnedArtifact } from './run-controlled-launch-preflight.mjs';
for(const replacement of [false,true])test('saved evidence rejects '+(replacement?'same-byte replacement':'equal-size modification'),async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'preflight-artifact-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=root+'/original',bytes=Buffer.from('original');const fd=await open(file,'wx+',0o600);
 try{const verify=await persistPinnedArtifact(fd,file,bytes);
 if(replacement){await writeFile(root+'/replacement',bytes,{mode:0o600});await rename(root+'/replacement',file);}else await writeFile(file,'modified');
 await assert.rejects(verify(),/changed/);
 }finally{await fd.close();}
});
for(const code of [0,1])test('readonly runner '+(code ? 'preserves failure without retry' : 'pins source and bounded ssh arguments'),async t=>{
 const root=await realpath(await mkdtemp(join(preflightRoot,'jgzg-controlled-preflight-test-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=root+'/source.py',bytes=Buffer.from('# public fixture\n');await writeFile(source,bytes);
 let calls=0;
 const execute=(command,args)=>{
  calls++;assert.equal(command,'ssh');assert(args.includes('ConnectionAttempts=1'));assert.equal(args.at(-1),'sudo -n /usr/bin/python3 -I -B -');
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin.on('finish',()=>{child.stdout.end(JSON.stringify({status:'completed-readonly-gaps',productionMutation:false,businessRowsRead:false,hba:{metadata:{}}}));child.stderr.end('fixture private diagnostic');setImmediate(()=>child.emit('close',code,null));});return child;
 };
 const output=root.toLowerCase()+'-result';t.after(()=>rm(output,{recursive:true,force:true}));
 const options={source,expectedSha256:createHash('sha256').update(bytes).digest('hex'),output,execute};
 if(code)await assert.rejects(runPreflight(options),/stopped/);else assert.equal((await runPreflight(options)).status,'completed-readonly-gaps');
 assert.equal(calls,1);assert(!(await readFile(output+'/original-output.partial','utf8')).includes('private diagnostic'));
 await assert.rejects(runPreflight(options));assert.equal(calls,1);
});

for (const output of [
 '/etc/jgzg-controlled-preflight-test',
 preflightRoot+'/unrelated-test',
 preflightRoot+'/jgzg-controlled-preflight-test/../escape',
 (process.platform === 'darwin' ? '/tmp' : '/private/tmp')+'/jgzg-controlled-preflight-test'
]) test('readonly preflight refuses output outside the fixed platform namespace: '+output, async()=>{
 let calls=0;
 await assert.rejects(runPreflight({source:'/missing-source',expectedSha256:'a'.repeat(64),output,execute:()=>{calls++;}}),/invalid bounded preflight inputs/);
 assert.equal(calls,0);
});
