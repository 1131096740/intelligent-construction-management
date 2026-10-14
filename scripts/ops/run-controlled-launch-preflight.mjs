#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';

// This runner is a production read. Merely preparing/testing it never authorizes
// invocation. Require the precise current script digest as an approval token.
const digest = b => createHash('sha256').update(b).digest('hex');
const identity = s => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,s.uid,s.nlink].join(':');
const boundedOutputPattern = process.platform === 'darwin'
  ? /^\/private\/tmp\/jgzg-controlled-preflight-[a-z0-9-]+$/
  : process.platform === 'linux' ? /^\/tmp\/jgzg-controlled-preflight-[a-z0-9-]+$/ : null;
export async function persistPinnedArtifact(handle,path,bytes) {
  await handle.writeFile(bytes);await handle.sync();const pin=await handle.stat();
  const verify=async()=>{
    const actual=Buffer.alloc(bytes.length+1),result=await handle.read(actual,0,actual.length,0);
    const current=await handle.stat(),named=await lstat(path);
    if(!named.isFile() || named.nlink!==1 || named.uid!==process.getuid?.() || (named.mode&0o077) || identity(pin)!==identity(current) || identity(pin)!==identity(named) || result.bytesRead!==bytes.length || digest(actual.subarray(0,result.bytesRead))!==digest(bytes))throw Error('saved preflight evidence changed');
  };await verify();return verify;
}
export async function runPreflight({ source, expectedSha256, output, execute = spawn }) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') || !boundedOutputPattern?.test(output ?? '')) throw Error('invalid bounded preflight inputs');
  const fd = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const before = await fd.stat();bytes = await fd.readFile();
    const after = await fd.stat(), path = await lstat(source);
    const identity = s => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
    if (!before.isFile() || before.nlink !== 1 || before.size > 65536 || identity(before) !== identity(after) || identity(before) !== identity(path) || digest(bytes) !== expectedSha256) throw Error('preflight source changed');
  } finally { await fd.close(); }
  await mkdir(output, { mode: 0o700 });
  const directoryPin=await lstat(output);
  const verifyDirectory=async()=>{const now=await lstat(output);if(!now.isDirectory() || now.dev!==directoryPin.dev || now.ino!==directoryPin.ino || now.uid!==directoryPin.uid || now.mode!==directoryPin.mode || (now.mode&0o077))throw Error('evidence directory changed');};
  const original = await open(output + '/original-output.partial', 'wx+', 0o600);
  let size = 0, exceeded = false, timedOut = false, child;
  try {
    child = execute('ssh', ['-T','-o','BatchMode=yes','-o','ConnectionAttempts=1','-o','ConnectTimeout=10','jgzg-prod','sudo -n /usr/bin/python3 -I -B -'], { stdio: ['pipe','pipe','pipe'] });
    let forceTimer;
    const stop = () => { child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),2000); };
    const timer = setTimeout(() => { timedOut = true;stop(); }, 78000);
    const chunks=[];
    child.stdout.on('data',chunk => {size += chunk.length;if(size > 262144){if(!exceeded)stop();exceeded=true;}else chunks.push(chunk);});
    // Do not persist unknown diagnostics, which may contain authentication data.
    child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.end(bytes);
    let result;
    try {result=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});}
    finally {clearTimeout(timer);clearTimeout(forceTimer);}
    const raw = Buffer.concat(chunks);const verifyOriginal=await persistPinnedArtifact(original,output+'/original-output.partial',raw);
    if(timedOut || exceeded || result.code !== 0) throw Error('bounded readonly preflight stopped; preserve partial');
    const data=JSON.parse(raw);
    if(data.status !== 'completed-readonly-gaps' || data.productionMutation !== false || data.businessRowsRead !== false || Object.keys(data.hba ?? {}).join(',') !== 'metadata') throw Error('readonly preflight output contract mismatch');
    const receipt=await open(output + '/receipt.json','wx+',0o600);
    try {
      const verifyReceipt=await persistPinnedArtifact(receipt,output+'/receipt.json',Buffer.from(JSON.stringify({status:'completed-readonly-gaps',scriptSha256:expectedSha256,originalSha256:digest(raw),productionMutation:false,productionAccessed:true})+'\n'));
      const directory=await open(output,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{await directory.sync();}finally{await directory.close();}
      await verifyOriginal();await verifyReceipt();await verifyDirectory();
    }finally{await receipt.close();}
    return {status:'completed-readonly-gaps',evidenceDirectory:output};
  } finally {await original.close();}
}
async function cli(){
  const [pin,output]=process.argv.slice(2);
  if(process.argv.length !== 4 || process.env.CONTROLLED_PREFLIGHT_CONFIRM !== 'readonly:'+pin) throw Error('explicit precise production approval required');
  return runPreflight({source:resolve(dirname(fileURLToPath(import.meta.url)),'controlled-launch-preflight.py'),expectedSha256:pin,output});
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Controlled readonly preflight stopped; retain partial evidence, no retry.');process.exitCode=1;});
