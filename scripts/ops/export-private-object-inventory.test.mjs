import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, access, mkdtemp, rm, writeFile, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { exportInventory, writeInventoryFile, readPinnedConfiguration } from './export-private-object-inventory.mjs';
const rows = [{ id: 'fixture-active', bucket: 'fixture-bucket', objectKey: 'fixture/a', sizeBytes: 3, contentSha256: 'a'.repeat(64), storageStatus: 'active' },
  { id: 'fixture-superseded', bucket: 'fixture-bucket', objectKey: 'fixture/b', sizeBytes: 4, contentSha256: 'b'.repeat(64), storageStatus: 'superseded' }];
const metadata = { database: 'fixture_db', user: 'fixture_reader', serverVersion: 160014, readOnly: 'on', recordCount: 2, estimatedBytes: 400, rows };
test('private configuration rejects identical-byte replacement and symlink drift', async t => {
  const root=await mkdtemp(join(tmpdir(),'inventory-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'config'), replacement=join(root,'replacement'), raw=Buffer.from('fixture-private');
  const digest=createHash('sha256').update(raw).digest('hex');
  await writeFile(file,raw,{mode:0o600});
  const pinned=await readPinnedConfiguration(file,digest,process.getuid());
  try {
    await pinned.verify();await writeFile(replacement,raw,{mode:0o600});await rename(replacement,file);
    await assert.rejects(pinned.verify(),/identity changed/);
  } finally {await pinned.close();}
  const link=join(root,'link');await symlink(file,link);
  await assert.rejects(readPinnedConfiguration(link,digest,process.getuid()));
});
function options(query) { return { databaseUrl: 'postgresql://fixture_reader:fixture-only-private@127.0.0.1:5432/fixture_db', expectedUser: 'fixture_reader', bucket: 'fixture-bucket', query }; }
test('complete all-status inventory uses private connection and returns no row stdout', async () => {
  let directory;
  const result = await exportInventory(options(async (sql, args, { env }) => {
    assert(sql.includes('READ ONLY') && sql.includes('REPEATABLE READ'));
    assert(!args.some(a => a.includes('fixture-only-private')));
    assert.equal(env.PGPASSWORD, undefined);
    assert.equal(env.PGDATABASE, undefined);
    directory = env.PGSERVICEFILE.replace(/\/service.conf$/, '');
    assert.equal((await lstat(env.PGSERVICEFILE)).mode & 0o077, 0);
    assert((await readFile(env.PGSERVICEFILE, 'utf8')).includes('passfile='));
    return JSON.stringify(metadata);
  }));
  assert.deepEqual(JSON.parse(result.bytes), rows);
  assert.equal(result.recordCount, 2);
  await assert.rejects(access(directory), { code: 'ENOENT' });
});
for (const [name, mutation] of [
  ['wrong database', d => { d.database='other'; }],
  ['wrong role', d => { d.user='other'; }],
  ['not PG16', d => { d.serverVersion=150000; }],
  ['non-readonly transaction', d => { d.readOnly='off'; }],
  ['truncated records', d => { d.rows=d.rows.slice(0,1); }],
  ['capacity overflow', d => { d.estimatedBytes=33554433; }],
  ['missing metadata hash', d => { d.rows[1].contentSha256=null; }],
  ['unexpected bucket', d => { d.rows[1].bucket='other'; }],
  ['empty unverified attachment set', d => { d.rows=[]; d.recordCount=0; }]
]) test(`${name} stops without generating a partial inventory`, async () => {
  const d=structuredClone(metadata); mutation(d);
  await assert.rejects(exportInventory(options(async () => JSON.stringify(d))), /stopped/);
});
test('query failure suppresses credential-bearing backend errors and cleans connection', async () => {
  let directory;
  await assert.rejects(exportInventory(options(async (_sql, _args, { env }) => {
    directory=env.PGSERVICEFILE.replace(/\/service.conf$/, '');
    throw Error('fake private fixture-only-private backend diagnostic');
  })), e => e.message === 'Complete private-object inventory export stopped');
  await assert.rejects(access(directory), { code: 'ENOENT' });
});
test('actual saved inventory is private, read back and not overwritten', async t => {
  const root=await mkdtemp(join(tmpdir(),'inventory-write-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const bytes=Buffer.from(JSON.stringify(rows)+'\n'),output=join(root,'inventory.json');
  const result={bytes,recordCount:2,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.equal((await writeInventoryFile(result,output)).inventorySha256,result.sha256);
  assert.deepEqual(await readFile(output),bytes);assert.equal((await lstat(output)).mode&0o077,0);
  await assert.rejects(writeInventoryFile(result,output),{code:'EEXIST'});
  assert.deepEqual(await readFile(output),bytes);
});
test('wrong caller digest cannot report a successful persisted artifact', async t => {
  const root=await mkdtemp(join(tmpdir(),'inventory-bad-digest-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await assert.rejects(writeInventoryFile({bytes:Buffer.from('[]'),recordCount:0,sha256:'0'.repeat(64)},join(root,'partial.json')),/changed/);
});
