#!/usr/bin/env node
// Filesystem exchange only: no migration, service start, network or data cleanup.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readdir, readFile, readlink, realpath, rename, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCandidateRepository } from './private-object-backup.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixedDigests(input) {
  if (!input || Object.keys(input).sort().join(',') !== 'api,web-admin' || !['api', 'web-admin'].every(name => /^[a-f0-9]{64}$/.test(input[name] ?? ''))) throw Error('invalid approved digest set');
  return Object.freeze({ api: input.api, 'web-admin': input['web-admin'] });
}
async function directory(path) {
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path) throw Error('unsafe directory');
}
export async function runtimeDigest(root) {
  await directory(root);
  const rows = [];
  async function visit(relative) {
    const path = join(root, relative), s = await lstat(path);
    if (s.isSymbolicLink()) rows.push([relative, 'link', await readlink(path)]);
    else if (s.isFile()) rows.push([relative, 'file', s.mode & 0o777, hash(await readFile(path))]);
    else if (s.isDirectory()) {
      rows.push([relative, 'directory', s.mode & 0o777]);
      for (const name of (await readdir(path)).sort()) await visit(join(relative, name));
    } else throw Error('unsupported runtime entry');
  }
  await visit('');
  return hash(JSON.stringify(rows));
}

// Every retained tree is renamed, never deleted. An interrupted run requires
// inspection of this journal and the exact paths; it is never blindly rerun.
export async function exchangeRuntimes({ parent, stage, run, before, after, candidateSha }) {
  if (!/^[a-f0-9]{40}$/.test(candidateSha ?? '')) throw Error('candidate SHA required');
  before = fixedDigests(before); after = fixedDigests(after);
  for (const path of [parent, stage]) await directory(path);
  if ((await lstat(parent)).dev !== (await lstat(stage)).dev) throw Error('same filesystem required');
  if (resolve(run, '..') !== parent || !/^\.controlled-launch-[a-z0-9-]+$/.test(run.slice(parent.length + 1))) throw Error('invalid run path');
  const pairs = ['api', 'web-admin'];
  for (const name of pairs) {
    if (await runtimeDigest(join(parent, name)) !== before[name] || await runtimeDigest(join(stage, name)) !== after[name]) throw Error('runtime changed before exchange');
  }
  await mkdir(run, { mode: 0o700 }); // exclusive claim; an existing run is refused
  const journal = { schemaVersion: 1, candidateSha, parent, stage, run, before, after, steps: [], state: 'started' };
  const save = () => writeFile(join(run, 'journal.json'), JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  await save();
  for (const name of pairs) {
    // Recheck just before each move. A later mismatch leaves prior moves held
    // and recorded for an explicit rollback, without starting any service.
    if (await runtimeDigest(join(parent, name)) !== before[name] || await runtimeDigest(join(stage, name)) !== after[name]) throw Error('runtime changed during exchange');
    await rename(join(parent, name), join(run, name + '.before'));
    journal.steps.push(name + ':before-retained'); await save();
    await rename(join(stage, name), join(parent, name));
    journal.steps.push(name + ':installed'); await save();
  }
  journal.state = 'installed-api-still-stopped'; await save();
  return journal;
}

export async function restoreRuntimes(run, { journalSha256, candidateSha }) {
  if (!/^[a-f0-9]{64}$/.test(journalSha256 ?? '') || !/^[a-f0-9]{40}$/.test(candidateSha ?? '')) throw Error('fixed rollback identity required');
  await directory(run);
  const file = join(run, 'journal.json'), s = await lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077)) throw Error('unsafe journal');
  const bytes = await readFile(file);
  if (hash(bytes) !== journalSha256) throw Error('rollback journal digest mismatch');
  const journal = JSON.parse(bytes);
  if (journal.candidateSha !== candidateSha) throw Error('rollback candidate mismatch');
  journal.before = fixedDigests(journal.before); journal.after = fixedDigests(journal.after);
  if (journal.run !== run || resolve(run, '..') !== journal.parent || !/^\.controlled-launch-[a-z0-9-]+$/.test(run.slice(journal.parent.length + 1))) throw Error('journal target mismatch');
  if (journal.state !== 'installed-api-still-stopped') throw Error('partial or already restored run requires inspection');
  // Validate both original and installed trees before moving either one.
  for (const name of ['api', 'web-admin']) {
    if (await runtimeDigest(join(run, name + '.before')) !== journal.before[name] || await runtimeDigest(join(journal.parent, name)) !== journal.after[name]) throw Error('rollback snapshot or runtime drift');
    try { await lstat(join(run, name + '.rejected')); throw Error('rollback destination exists'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const current = await lstat(file);
  if (current.ino !== s.ino || current.dev !== s.dev || hash(await readFile(file)) !== journalSha256) throw Error('rollback journal changed during validation');
  journal.state = 'restoring'; await writeFile(file, JSON.stringify(journal, null, 2) + '\n');
  for (const name of ['web-admin', 'api']) {
    await rename(join(journal.parent, name), join(run, name + '.rejected'));
    await rename(join(run, name + '.before'), join(journal.parent, name));
    journal.steps.push(name + ':restored'); await writeFile(file, JSON.stringify(journal, null, 2) + '\n');
  }
  journal.state = 'restored-api-still-stopped'; await writeFile(file, JSON.stringify(journal, null, 2) + '\n');
}

async function assertProductionStopped() {
  if (process.getuid?.() !== 0) throw Error('root required');
  // Read only control keys. Never execute or print a credential configuration.
  const path = '/etc/jiangkong/api.env', s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o077)) throw Error('unsafe environment file');
  const values = new Map();
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const m = /^(OPERATIONAL_WRITE_FREEZE_MODE|OPERATIONAL_WRITE_FREEZE_MODULES)=(.*)$/.exec(line);
    if (m) { if (values.has(m[1])) throw Error('duplicate freeze key'); values.set(m[1], m[2].replace(/^("|')(.*)\1$/, '$2')); }
  }
  if (values.get('OPERATIONAL_WRITE_FREEZE_MODE') !== 'all' || (values.get('OPERATIONAL_WRITE_FREEZE_MODULES') ?? '') !== '') throw Error('all freeze required');
  for (const unit of ['jiangkong-api.service', 'jiangkong-draft-retention.service', 'jiangkong-draft-retention.timer', 'jiangkong-pristine-draft-deletion-receipt-purge.service', 'jiangkong-pristine-draft-deletion-receipt-purge.timer']) {
    const state = execFileSync('systemctl', ['show', '--property=ActiveState', '--value', unit], { encoding: 'utf8', timeout: 3000 }).trim();
    if (state !== 'inactive') throw Error('service or timer not inactive');
  }
}

async function cli() {
  const [operation, runName, candidateSha, stageDigestApi, stageDigestWeb, beforeApi, beforeWeb] = process.argv.slice(2);
  if (!/^[a-z0-9-]{1,60}$/.test(runName ?? '') || !/^[a-f0-9]{40}$/.test(candidateSha ?? '')) throw Error('invalid fixed run or SHA');
  if (process.env.CONTROLLED_LAUNCH_CONFIRM !== `${operation}:${candidateSha}:${runName}`) throw Error('explicit stage confirmation required');
  await assertProductionStopped();
  const parent = '/srv/jiangkong/apps', run = join(parent, '.controlled-launch-' + runName);
  if (operation === 'restore' && process.argv.length === 6) {
    if (!/^[a-f0-9]{64}$/.test(stageDigestApi ?? '')) throw Error('pinned journal digest required');
    await restoreRuntimes(run, { journalSha256: stageDigestApi, candidateSha }); return;
  }
  if (operation !== 'install' || process.argv.length !== 9 || ![stageDigestApi, stageDigestWeb, beforeApi, beforeWeb].every(x => /^[a-f0-9]{64}$/.test(x ?? ''))) throw Error('invalid install arguments');
  const checkout = '/srv/jiangkong/releases/' + candidateSha;
  await directory(checkout);
  await assertCandidateRepository(checkout, candidateSha, 'scripts/ops/controlled-runtime-exchange.mjs');
  await exchangeRuntimes({ parent, stage: '/srv/jiangkong/stages/' + candidateSha, run, candidateSha, before: { api: beforeApi, 'web-admin': beforeWeb }, after: { api: stageDigestApi, 'web-admin': stageDigestWeb } });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(() => { console.error('Controlled runtime exchange stopped; preserve journal and all trees. No service was started.'); process.exitCode = 1; });
