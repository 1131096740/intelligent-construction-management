import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeDigest, exchangeRuntimes, restoreRuntimes } from './controlled-runtime-exchange.mjs';
import { createHash } from 'node:crypto';
async function rollbackIdentity(f) {
  return { candidateSha: f.candidateSha, journalSha256: createHash('sha256').update(await readFile(join(f.run, 'journal.json'))).digest('hex') };
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'controlled-launch-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, 'apps'), stage = join(root, 'stage');
  await mkdir(parent); await mkdir(stage);
  const before = {}, after = {};
  for (const name of ['api', 'web-admin']) {
    await mkdir(join(parent, name)); await mkdir(join(stage, name));
    await writeFile(join(parent, name, 'version'), 'old-' + name);
    await writeFile(join(stage, name, 'version'), 'new-' + name);
    before[name] = await runtimeDigest(join(parent, name));
    after[name] = await runtimeDigest(join(stage, name));
  }
  return { parent, stage, run: join(parent, '.controlled-launch-test'), before, after, candidateSha: 'a'.repeat(40) };
}
test('real filesystem exchange retains old runtime and explicit restore retains rejected runtime', async t => {
  const f = await fixture(t);
  await exchangeRuntimes(f);
  assert.equal(await readFile(join(f.parent, 'api/version'), 'utf8'), 'new-api');
  assert.equal(await readFile(join(f.run, 'api.before/version'), 'utf8'), 'old-api');
  await restoreRuntimes(f.run, await rollbackIdentity(f));
  assert.equal(await readFile(join(f.parent, 'api/version'), 'utf8'), 'old-api');
  assert.equal(await readFile(join(f.run, 'api.rejected/version'), 'utf8'), 'new-api');
  assert.equal(JSON.parse(await readFile(join(f.run, 'journal.json'))).state, 'restored-api-still-stopped');
  await assert.rejects(restoreRuntimes(f.run, await rollbackIdentity(f)), /inspection/);
});
test('wrong approved before digest refuses before creating any run', async t => {
  const f = await fixture(t); f.before.api = '0'.repeat(64);
  await assert.rejects(exchangeRuntimes(f), /changed/);
  await assert.rejects(access(f.run), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.parent, 'api/version'), 'utf8'), 'old-api');
});
test('runtime drift refuses rollback without moving either current tree', async t => {
  const f = await fixture(t); await exchangeRuntimes(f);
  await writeFile(join(f.parent, 'web-admin/version'), 'unknown-change');
  await assert.rejects(restoreRuntimes(f.run, await rollbackIdentity(f)), /drift/);
  assert.equal(await readFile(join(f.parent, 'api/version'), 'utf8'), 'new-api');
  assert.equal(await readFile(join(f.run, 'api.before/version'), 'utf8'), 'old-api');
});
test('approval digests are copied before any awaited work', async t => {
  const f = await fixture(t), original = f.before.api;
  const pending = exchangeRuntimes(f);
  f.before.api = '0'.repeat(64); f.after.api = '0'.repeat(64);
  const journal = await pending;
  assert.equal(journal.before.api, original);
  assert.equal(await readFile(join(f.parent, 'api/version'), 'utf8'), 'new-api');
});
test('changed or wrong-candidate journal refuses all rollback moves', async t => {
  const f = await fixture(t); await exchangeRuntimes(f);
  const pin = await rollbackIdentity(f);
  await assert.rejects(restoreRuntimes(f.run, { ...pin, candidateSha: 'b'.repeat(40) }), /candidate/);
  await writeFile(join(f.run, 'journal.json'), '{}');
  await assert.rejects(restoreRuntimes(f.run, pin), /digest/);
  assert.equal(await readFile(join(f.parent, 'api/version'), 'utf8'), 'new-api');
});
test('an existing run is never overwritten or reused', async t => {
  const f = await fixture(t); await mkdir(f.run); await writeFile(join(f.run, 'evidence'), 'keep');
  await assert.rejects(exchangeRuntimes(f), { code: 'EEXIST' });
  assert.equal(await readFile(join(f.run, 'evidence'), 'utf8'), 'keep');
});

test('root CLI verifies the Ubuntu candidate through the shared canonical Git guard before runtime moves', async () => {
  const {execFileSync}=await import('node:child_process');
  const script=new URL('./controlled-runtime-exchange.mjs',import.meta.url).pathname;
  const probe=String.raw`
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';import * as url from 'node:url';import * as crypto from 'node:crypto';
const sha='a'.repeat(40),calls={guard:[],rawGit:[],moves:0};
const processFixture={getuid:()=>0,argv:['node','/fixture/runtime.mjs','install','fixture',sha,'b'.repeat(64),'b'.repeat(64),'c'.repeat(64),'c'.repeat(64)],env:{CONTROLLED_LAUNCH_CONFIRM:'install:'+sha+':fixture'}};
const context=createContext({process:processFixture,console:{error:()=>{}},Buffer});
const fs={lstat:async p=>({isFile:()=>p==='/etc/jiangkong/api.env',isDirectory:()=>p!=='/etc/jiangkong/api.env',isSymbolicLink:()=>false,uid:0,mode:0o600,dev:1}),realpath:async p=>p,readFile:async()=> 'OPERATIONAL_WRITE_FREEZE_MODE=all\nOPERATIONAL_WRITE_FREEZE_MODULES=\n',rename:async()=>{calls.moves++;throw Error('unexpected move');},mkdir:async()=>{throw Error('unexpected mutation');},writeFile:async()=>{throw Error('unexpected mutation');},readdir:async()=>{throw Error('unexpected runtime walk');},readlink:async()=>{throw Error('unexpected link');}};
const child={execFileSync:(program,args)=>{if(program==='systemctl')return 'inactive';if(program==='git'){calls.rawGit.push(args);throw Error('detected dubious ownership');}throw Error('unexpected command');}};
const checker={assertCandidateRepository:async(...args)=>{calls.guard.push(args);throw Error('probe stops after verified guard call');}};
const modules={'node:crypto':crypto,'node:child_process':child,'node:fs/promises':fs,'node:path':path,'node:url':url,'./private-object-backup.mjs':checker};
const mod=new SourceTextModule(readFileSync(process.argv[1],'utf8'),{context,initializeImportMeta:m=>{m.url='file:///fixture/runtime.mjs';}});
await mod.link(name=>{const object=modules[name];if(!object)throw Error('unexpected import');return new SyntheticModule(Object.keys(object),function(){for(const [key,value]of Object.entries(object))this.setExport(key,value);},{context});});
await mod.evaluate();await new Promise(resolve=>setImmediate(resolve));console.log(JSON.stringify(calls));`;
  const output=execFileSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',probe,script],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']});
  const calls=JSON.parse(output);assert.deepEqual(calls.guard,[['/srv/jiangkong/releases/'+'a'.repeat(40),'a'.repeat(40),'scripts/ops/controlled-runtime-exchange.mjs']]);assert.deepEqual(calls.rawGit,[]);assert.equal(calls.moves,0);
});
