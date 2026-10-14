// Local-only cold installed-layout probe. Requires a real API build; never
// starts an application, connects to a database or accesses production paths.
import { mkdtemp, cp, mkdir, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = await mkdtemp(join(tmpdir(), 'controlled-runtime-cold-'));
try {
  const api = join(root, 'api'); await mkdir(api);
  await cp(resolve('services/api/dist'), join(api, 'dist'), { recursive: true });
  await cp(resolve('services/api/scripts'), join(api, 'scripts'), { recursive: true });
  await symlink(resolve('services/api/node_modules'), join(api, 'node_modules'));
  const probe = spawnSync(process.execPath, ['-e', `
    const { OperationalWriteFreezeService } = require('./dist/operational-write-freeze/operational-write-freeze.service.js');
    try { new OperationalWriteFreezeService().assertCanWrite('contract'); process.exit(71); }
    catch(e) { if(e.getStatus?.() !== 503 || e.response?.code !== 'OPERATIONAL_WRITE_FREEZE_ACTIVE') throw e; }
    const { configureApiShutdown } = require('./dist/api-shutdown.js');
    const hooks=[]; configureApiShutdown({enableShutdownHooks: x => hooks.push(...x)});
    if(hooks.join(',') !== 'SIGINT,SIGTERM') process.exit(72);
  `], { cwd: api, encoding: 'utf8', env: { ...process.env, OPERATIONAL_WRITE_FREEZE_MODE: 'all', OPERATIONAL_WRITE_FREEZE_MODULES: '' }, timeout: 10000 });
  assert.equal(probe.status, 0, probe.stderr);
  console.log('Cold installed API wiring verified locally; no application or database started.');
} finally { await rm(root, { recursive: true, force: true }); }
