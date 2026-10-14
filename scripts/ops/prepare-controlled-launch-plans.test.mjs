import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlans, persistPlanBundle } from './prepare-controlled-launch-plans.mjs';
import {mkdtemp,realpath,rm,open,writeFile,readFile,rename}from'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const units=['jiangkong-api.service','jiangkong-draft-retention.service','jiangkong-draft-retention.timer','jiangkong-pristine-draft-deletion-receipt-purge.service','jiangkong-pristine-draft-deletion-receipt-purge.timer'];
const observation={status:'completed-readonly-gaps',productionMutation:false,businessRowsRead:false,machineIdentitySha256:'a'.repeat(64),databaseIdentitySha256:'b'.repeat(64),target:{database:'fixture',version:160014,hba:'/etc/postgresql/16/main/pg_hba.conf'},hba:{metadata:{path:'/etc/postgresql/16/main/pg_hba.conf'}},units:Object.fromEntries(units.map(u=>[u,{Id:u,ActiveState:'inactive'}])),cronBindings:[{file:{path:'/var/spool/cron/crontabs/root',sha256:'c'.repeat(64)},entries:[{commandSha256:'d'.repeat(64)}]},{file:{path:'/etc/cron.d/jiangkong-offsite-db-backup',sha256:'e'.repeat(64)},entries:[{commandSha256:'f'.repeat(64)},{commandSha256:'0'.repeat(64)}]}],permissions:{helper:null,creators:[]},migrations:[]};
const options={candidateSha:'1'.repeat(40),runId:'first-launch',osPlanPath:'/var/lib/jiangkong-controlled-launch/first-launch-os-plan.json'};
test('successful original produces linked OS/DB plans without claiming installed freeze',()=>{
 const packet=buildPlans(observation,options);assert.equal(packet.osPlan.cronBindings['/var/spool/cron/crontabs/root'].fileSha256,'c'.repeat(64));assert.equal(packet.dbPlan.osPlanPath,options.osPlanPath);assert.match(packet.dbPlan.osPlanSha256,/^[a-f0-9]{64}$/);assert.equal(packet.productionApplied,false);
});
for(const [name,change]of[['failed observation',x=>x.status='stopped-readonly-gaps'],['missing cron',x=>x.cronBindings.pop()],['wrong target PG',x=>x.target.version=150000],['unknown service',x=>x.units['other.service']={}],['duplicate commands',x=>x.cronBindings[1].entries[1].commandSha256='f'.repeat(64)]])test(name+' cannot create runnable plans',()=>{const x=structuredClone(observation);change(x);assert.throws(()=>buildPlans(x,options));});
for(const replace of [false,true])test('first plan '+(replace?'replacement':'modification')+' during second save is refused',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'local-plan-bundle-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const output=root+'/bundle',packet=buildPlans(observation,options);
 await assert.rejects(persistPlanBundle(packet,output,{openFile:async(path,...args)=>{
  if(path.endsWith('/db-plan.json')){
   const first=output+'/os-plan.json';
   if(replace){await writeFile(root+'/replacement',await readFile(first),{mode:0o600});await rename(root+'/replacement',first);}else{const raw=await readFile(first);raw[0]=32;await writeFile(first,raw);}
  }return open(path,...args);
 }}),/changed/);
});
