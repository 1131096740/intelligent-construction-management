#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { lstat, open, rm, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareService, connectionParameters } from './private-libpq-service.mjs';
import { validateInventory, assertCandidateRepository } from './private-object-backup.mjs';

export const INVENTORY_SQL = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '2s';
WITH rows AS NOT MATERIALIZED (
 SELECT id,bucket,"objectKey","sizeBytes","contentSha256","storageStatus" FROM public."FileObject"
), capacity AS (
 SELECT count(*) AS n,coalesce(sum(octet_length(row_to_json(rows)::text)),0) AS bytes FROM rows
), payload AS (
 SELECT coalesce(json_agg(rows ORDER BY id),'[]'::json) AS data FROM rows
 WHERE (SELECT n <= 100000 AND bytes <= 33554432 FROM capacity)
)
SELECT json_build_object('database',current_database(),'user',current_user,
 'serverVersion',current_setting('server_version_num')::int,'readOnly',current_setting('transaction_read_only'),
 'recordCount',n,'estimatedBytes',bytes,'rows',CASE WHEN n<=100000 AND bytes<=33554432 THEN data ELSE NULL END)
 FROM capacity,payload;
COMMIT;`;

export async function exportInventory({ databaseUrl, bucket, expectedUser, query }) {
  const parameters = connectionParameters(databaseUrl);
  if (!parameters.get('dbname') || parameters.get('user') !== expectedUser) throw Error('inventory connection identity mismatch');
  let connection;
  try {
    connection = await prepareService(databaseUrl);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !/(?:PASSWORD|SECRET|TOKEN|DATABASE_URL)/.test(key)));
    env.PGSERVICEFILE = join(connection, 'service.conf');
    const execute = query ?? ((sql, args, options) => execFileSync('psql', args, { ...options, input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 36 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }));
    const raw = await execute(INVENTORY_SQL, ['-X', '-q', '-t', '-A', '--no-password', '--set=ON_ERROR_STOP=1', '--dbname=service=jgzg_backup'], { env });
    const data = JSON.parse(raw);
    if (data.database !== parameters.get('dbname') || data.user !== expectedUser || data.readOnly !== 'on' || data.serverVersion < 160000 || data.serverVersion >= 170000) throw Error('inventory database identity mismatch');
    if (!Number.isSafeInteger(data.recordCount) || data.recordCount < 1 || data.recordCount > 100000 || !Number.isSafeInteger(data.estimatedBytes) || data.estimatedBytes < 1 || data.estimatedBytes > 33554432 || !Array.isArray(data.rows) || data.rows.length !== data.recordCount) throw Error('inventory size or completeness invalid');
    const rows = validateInventory(data.rows, bucket);
    const bytes = Buffer.from(JSON.stringify(rows) + '\n');
    if (bytes.length > 33554432) throw Error('inventory output limit');
    return { bytes, recordCount: rows.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    throw Error('Complete private-object inventory export stopped');
  } finally {
    if (connection) await rm(connection, { recursive: true, force: true });
  }
}

export async function writeInventoryFile(result, output) {
  const handle = await open(output, 'wx+', 0o600);
  try {
    await handle.writeFile(result.bytes);
    await handle.sync();
    const original = await handle.stat();
    // Read at an explicit offset; the descriptor is at EOF after writeFile.
    const actual = Buffer.alloc(result.bytes.length + 1);
    const { bytesRead } = await handle.read(actual, 0, actual.length, 0);
    const pin = await lstat(output), current = await handle.stat();
    if (original.ino !== pin.ino || original.dev !== pin.dev || current.ino !== original.ino || current.size !== original.size || current.mtimeMs !== original.mtimeMs || current.ctimeMs !== original.ctimeMs || pin.mtimeMs !== original.mtimeMs || pin.ctimeMs !== original.ctimeMs || pin.nlink !== 1 || !pin.isFile() || (pin.mode & 0o077) || pin.uid !== process.getuid?.() || bytesRead !== result.bytes.length || createHash('sha256').update(actual.subarray(0, bytesRead)).digest('hex') !== result.sha256) throw Error('persisted inventory changed');
    const directory = await open(dirname(output), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return { recordCount: result.recordCount, inventorySha256: result.sha256 };
  } finally { await handle.close(); }
}

export async function readPinnedConfiguration(file, expectedSha256, expectedUid = 0) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  const identity = s => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,s.uid,s.gid,s.nlink].join(':');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== expectedUid || (before.mode & 0o077) || before.size > 65536) throw Error('unsafe backup configuration');
    const raw = await handle.readFile();
    const verify = async () => {
      const current = await lstat(file), fd = await handle.stat();
      if (!current.isFile() || identity(current) !== identity(before) || identity(fd) !== identity(before)) throw Error('backup configuration identity changed');
    };
    await verify();
    if (createHash('sha256').update(raw).digest('hex') !== expectedSha256) throw Error('backup configuration changed');
    return { raw, verify, close: () => handle.close() };
  } catch (error) { await handle.close(); throw error; }
}

async function cli() {
  const [candidateSha, expectedEnvSha256, output] = process.argv.slice(2);
  if (process.getuid?.() !== 0 || process.argv.length !== 5 || !/^[a-f0-9]{40}$/.test(candidateSha ?? '') || !/^[a-f0-9]{64}$/.test(expectedEnvSha256 ?? '') || !output?.startsWith('/var/lib/jiangkong-controlled-launch/')) throw Error('invalid approved export parameters');
  if (process.env.CONTROLLED_INVENTORY_CONFIRM !== candidateSha + ':' + expectedEnvSha256) throw Error('explicit inventory approval required');
  const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '../..');
  await assertCandidateRepository(root, candidateSha, 'scripts/ops/export-private-object-inventory.mjs');
  const file = '/etc/jiangkong/db-backup-database.env';
  const pinned = await readPinnedConfiguration(file, expectedEnvSha256);
  try {
  const raw = pinned.raw;
  const lines = raw.toString('utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  if (lines.length !== 1 || !lines[0].startsWith('DATABASE_URL=')) throw Error('invalid private backup configuration');
  let url = lines[0].slice('DATABASE_URL='.length);
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) url = url.slice(1, -1);
  const params = connectionParameters(url);
  if (params.get('host') !== '127.0.0.1' || (params.get('port') ?? '5432') !== '5432' || params.has('hostaddr') || params.has('options')) throw Error('local fixed PostgreSQL endpoint required');
  const parent = dirname(output), meta = await lstat(parent);
  if (await realpath(parent) !== parent || !meta.isDirectory() || meta.uid !== 0 || (meta.mode & 0o077)) throw Error('unsafe inventory output directory');
  // The approved environment digest fixes the user and database. Peer metadata
  // identity is a separate phase input; this export does not prove full freeze.
  const result = await exportInventory({ databaseUrl: url, expectedUser: params.get('user'), bucket: 'jiangkong-prod-files-1438687719' });
  await pinned.verify();
  const saved = await writeInventoryFile(result, output);
  console.log(JSON.stringify({ ...saved, freezeVerified: false }));
  } finally { await pinned.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(() => { console.error('Private-object inventory export stopped; retain partial evidence. No credential or row output.'); process.exitCode = 1; });
