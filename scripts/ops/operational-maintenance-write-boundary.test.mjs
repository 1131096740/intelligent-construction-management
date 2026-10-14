import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const apiRoot=fileURLToPath(new URL('../../services/api/',import.meta.url));
for(const tool of ['retention','receipt-purge'])for(const [mode,modules,code] of [
  ['all','','OPERATIONAL_WRITE_FREEZE_ACTIVE'],
  ['modules','operations','OPERATIONAL_WRITE_FREEZE_ACTIVE'],
  ['modules','','OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID']
])test(`cold ${tool} rejects ${mode}/${modules} without any API dist`,async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'maintenance-cold-')));await chmod(root,0o700);
  const beforeMode=process.env.OPERATIONAL_WRITE_FREEZE_MODE,beforeModules=process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
  t.after(async()=>{
    if(beforeMode===undefined)delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;else process.env.OPERATIONAL_WRITE_FREEZE_MODE=beforeMode;
    if(beforeModules===undefined)delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;else process.env.OPERATIONAL_WRITE_FREEZE_MODULES=beforeModules;
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(join(root,'scripts'),{mode:0o700});
  for(const name of ['operational-write-freeze-policy.cjs','operational-maintenance-write-boundary.cjs','execute-contract-draft-retention.cjs','purge-pristine-draft-deletion-receipts.cjs']) {
    await copyFile(join(apiRoot,'scripts',name),join(root,'scripts',name));
  }
  await symlink(join(apiRoot,'node_modules'),join(root,'node_modules'),'dir');
  await assert.rejects(stat(join(root,'dist')),error=>error.code==='ENOENT');
  process.env.OPERATIONAL_WRITE_FREEZE_MODE=mode;process.env.OPERATIONAL_WRITE_FREEZE_MODULES=modules;
  const require=createRequire(join(root,'probe.cjs'));
  const boundary=new Proxy({}, {get(){throw Error('cold fixture reached a write dependency');}});
  const run=tool==='receipt-purge'
    ? ()=>require('./scripts/purge-pristine-draft-deletion-receipts.cjs').purgeExpiredPristineDraftDeletionReceipts(boundary)
    : ()=>{
      const script=require('./scripts/execute-contract-draft-retention.cjs');
      const report=script.createReport({databaseFingerprint:'a'.repeat(64),generatedAt:new Date().toISOString(),scanTruncated:false,candidates:[]});
      return script.executeRetention({store:boundary,storage:boundary,report,options:{tempEnabled:true,businessPurgeEnabled:false,now:new Date()}});
    };
  await assert.rejects(run(),error=>error.response?.code===code&&error.getStatus()===503);
});
