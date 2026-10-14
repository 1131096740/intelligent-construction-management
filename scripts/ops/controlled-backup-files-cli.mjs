#!/usr/bin/env node
import {readFile,lstat,mkdir,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installBackupFiles,withdrawBackupFiles,FILES} from './controlled-backup-files.mjs';
import {readPinnedConfiguration} from './export-private-object-inventory.mjs';
import {assertCandidateRepository} from './private-object-backup.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 const [operation,path,pin,journalPin]=process.argv.slice(2);
 if(process.getuid()!==0||!['install','withdraw'].includes(operation)||!/^[a-f0-9]{64}$/.test(pin??'')||process.argv.length!==(operation==='install'?5:6)||operation==='withdraw'&&!/^[a-f0-9]{64}$/.test(journalPin??''))throw Error('invalid exact operation');
 if(process.env.CONTROLLED_BACKUP_FILES_CONFIRM!==operation+':'+pin+(journalPin?':'+journalPin:''))throw Error('exact approval required');
 const plan=await readPinnedConfiguration(path,pin);try{
 const p=JSON.parse(plan.raw);if(Object.keys(p).sort().join()!==['candidateSha','runId','machineIdentitySha256','osPlanSha256','before'].sort().join()||!/^[a-f0-9]{40}$/.test(p.candidateSha??'')||!/^[a-z0-9-]{1,60}$/.test(p.runId??'')||!/^[a-f0-9]{64}$/.test(p.osPlanSha256??''))throw Error('invalid exact plan');
 if(sha((await readFile('/etc/machine-id')).toString().trim())!==p.machineIdentitySha256)throw Error('wrong machine');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');if(root!=='/srv/jiangkong/releases/'+p.candidateSha)throw Error('wrong fixed release path');
 await assertCandidateRepository(root,p.candidateSha,'scripts/ops/controlled-backup-files-cli.mjs');
 const started=Date.now(),safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')&&!/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(k)));
 const command=(program,args,env=safeEnv)=>{const remaining=60000-(Date.now()-started);if(remaining<=0)throw Error('deadline');try{return execFileSync(program,args,{env,timeout:Math.min(remaining,15000),maxBuffer:262144,stdio:['ignore','pipe','pipe']});}catch{throw Error('controlled command stopped');}};
 const sourceUid=Number(command('/usr/bin/id',['-u','ubuntu']).toString().trim());if(!Number.isSafeInteger(sourceUid)||sourceUid<=0)throw Error('source owner unconfirmed');
 const osPath='/var/lib/jiangkong-controlled-launch/'+p.runId+'-os-plan.json',osPlan=await readPinnedConfiguration(osPath,p.osPlanSha256);
 try{const op=JSON.parse(osPlan.raw);for(const key of ['candidateSha','runId','machineIdentitySha256'])if(op[key]!==p[key])throw Error('OS lineage mismatch');
 const observe=async()=>{await plan.verify();await osPlan.verify();await assertCandidateRepository(root,p.candidateSha,'scripts/ops/controlled-backup-files-cli.mjs');command('/usr/bin/python3',['-I','-B',join(root,'scripts/ops/controlled-maintenance-window.py'),'observe',osPath,p.osPlanSha256],{...safeEnv,CONTROLLED_WINDOW_CONFIRM:'observe:'+p.osPlanSha256});};
 const parent='/var/lib/jiangkong-controlled-launch',parentPin=await lstat(parent);if(await realpath(parent)!==parent||!parentPin.isDirectory()||parentPin.uid!==0||(parentPin.mode&0o077))throw Error('unsafe journal parent');
 const state=parent+'/'+p.runId+'-backup-files',options={source:join(root,'scripts/ops'),target:'/usr/local/lib/jiangkong-offsite-backup',state,candidateSha:p.candidateSha,before:p.before,observe,sourceUid};
 await observe();
 if(operation==='install'){await mkdir(state,{mode:0o700});const j=await installBackupFiles(options);console.log(JSON.stringify({status:'installed-five-backup-files',files:Object.keys(FILES),journalSha256:sha(Buffer.from(JSON.stringify(j)+'\n')),credentialsChanged:false,businessUnfrozen:false}));}
 else{const saved=await readPinnedConfiguration(state+'/journal.json',journalPin);try{const j=JSON.parse(saved.raw);await saved.verify();await withdrawBackupFiles({...options,journal:j});console.log(JSON.stringify({status:'restored-five-backup-files',credentialsChanged:false,businessUnfrozen:false}));}finally{await saved.close();}}
 }finally{await osPlan.close();}
 }finally{await plan.close();}
}
main().catch(()=>{console.error('Controlled backup files stopped; keep maintenance and before bytes/journal. No retry, cleanup of unknown files, restart or business unfreeze.');process.exitCode=1;});
