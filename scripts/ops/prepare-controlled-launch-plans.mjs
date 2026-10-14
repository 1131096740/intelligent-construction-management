#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, open, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPinnedConfiguration } from './export-private-object-inventory.mjs';
import { persistPinnedArtifact } from './run-controlled-launch-preflight.mjs';
import { assertCandidateRepository } from './private-object-backup.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const hash=/^[a-f0-9]{64}$/;
const units=['jiangkong-api.service','jiangkong-draft-retention.service','jiangkong-draft-retention.timer','jiangkong-pristine-draft-deletion-receipt-purge.service','jiangkong-pristine-draft-deletion-receipt-purge.timer'];
const cron=['/var/spool/cron/crontabs/root','/etc/cron.d/jiangkong-offsite-db-backup'];
export function buildPlans(observation,{candidateSha,runId,osPlanPath}){
 if(!/^[a-f0-9]{40}$/.test(candidateSha??'') || !/^[a-z0-9-]{1,60}$/.test(runId??'') || osPlanPath!==`/var/lib/jiangkong-controlled-launch/${runId}-os-plan.json`)throw Error('invalid fixed candidate or plan path');
 if(observation.status!=='completed-readonly-gaps'||observation.productionMutation!==false||observation.businessRowsRead!==false||!hash.test(observation.machineIdentitySha256??'')||!hash.test(observation.databaseIdentitySha256??''))throw Error('only completed readonly originals are accepted');
 if(observation.target?.version<160000||observation.target?.version>=170000||!Number.isInteger(observation.target?.version)||observation.target?.hba!=='/etc/postgresql/16/main/pg_hba.conf'||!observation.target?.database)throw Error('invalid database observation');
 if(Object.keys(observation.units??{}).sort().join(',')!==[...units].sort().join(','))throw Error('unknown or incomplete service scope');
 const bindings=observation.cronBindings;
 if(!Array.isArray(bindings)||bindings.length!==2||bindings.map(x=>x.file?.path).sort().join(',')!==[...cron].sort().join(','))throw Error('exact cron sources required');
 const commandPins=bindings.flatMap(x=>x.entries?.map(e=>e.commandSha256)??[]);
 if(commandPins.length!==3||new Set(commandPins).size!==3||!commandPins.every(x=>hash.test(x)))throw Error('exact three distinct command pins required');
 const cronBindings={};for(const x of bindings){if(!hash.test(x.file.sha256))throw Error('original file digest missing');cronBindings[x.file.path]={fileSha256:x.file.sha256,commandSha256:x.entries.map(e=>e.commandSha256)};}
 const osPlan={candidateSha,runId,machineIdentitySha256:observation.machineIdentitySha256,cronBindings};
 const dbPlan={candidateSha,runId,machineIdentitySha256:observation.machineIdentitySha256,databaseIdentitySha256:observation.databaseIdentitySha256,osPlanPath,osPlanSha256:digest(encode(osPlan))};
 return {osPlan,dbPlan,productionApplied:false,freezeVerified:false};
}
export async function persistPlanBundle(packet,output,{openFile=open}={}){
 await mkdir(output,{mode:0o700});const original=await lstat(output),handles=[],checks=[];
 try{
  for(const [name,data]of [['os-plan.json',packet.osPlan],['db-plan.json',packet.dbPlan]]){
   const fd=await openFile(output+'/'+name,'wx+',0o600);handles.push(fd);checks.push(await persistPinnedArtifact(fd,output+'/'+name,encode(data)));
  }
  const dir=await open(output,'r');try{await dir.sync();}finally{await dir.close();}
  for(const check of checks)await check();
  const now=await lstat(output);
  if(!now.isDirectory()||now.dev!==original.dev||now.ino!==original.ino||now.mode!==original.mode||now.uid!==original.uid||(now.mode&0o077))throw Error('local plan directory changed');
 }finally{for(const handle of handles)await handle.close();}
}
async function cli(){
 const [candidateSha,runId,original,pin,output]=process.argv.slice(2);
 if(process.argv.length!==7||!/^\/private\/tmp\/jgzg-controlled-plans-[a-z0-9-]+$/.test(output??''))throw Error('new private local output required');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');await assertCandidateRepository(root,candidateSha,'scripts/ops/prepare-controlled-launch-plans.mjs');
 const input=await readPinnedConfiguration(original,pin,process.getuid());
 try{
 const packet=buildPlans(JSON.parse(input.raw),{candidateSha,runId,osPlanPath:`/var/lib/jiangkong-controlled-launch/${runId}-os-plan.json`});
 await persistPlanBundle(packet,output);await input.verify();
 console.log(JSON.stringify({status:'local-plans-prepared',productionApplied:false,freezeVerified:false}));
 }finally{await input.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(()=>{console.error('Local maintenance plan preparation stopped; retain partial output.');process.exitCode=1;});
