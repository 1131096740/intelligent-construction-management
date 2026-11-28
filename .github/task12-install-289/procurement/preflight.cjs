'use strict';

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const scope = '.github/task12-install-289/procurement';
const acceptedManifest = '3295fc671d128e4f7ba1ea8fc08e9fd44e2fa8a29199561d1e95463d12393265';
const hash = value => createHash('sha256').update(value).digest('hex');
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const [operation, selector, output] = process.argv.slice(2);

try {
  const stage = operation === '--stage-inputs' && process.argv.length === 5;
  requireThat(selector === 'general_procurement' &&
    (stage || process.argv.length === 4 && operation === '--preflight'),
    'only the original procurement group preflight and input staging are accepted');
  const root = fs.realpathSync(path.resolve(__dirname, '../../..'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 4 * 1024 * 1024 });
  const index = new Map(git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    return [line.slice(tab + 1), line.slice(0, tab).split(' ')];
  }));
  const safePath = relative => typeof relative === 'string' && !relative.includes('\\') &&
    relative.split('/').every(part => part && part !== '..' && part !== '.');
  const read = relative => {
    const entry = index.get(relative);
    requireThat(safePath(relative) && entry && /^(100644|100755)$/.test(entry[0]) && entry[2] === '0',
      'input is not a regular indexed source');
    const file = path.join(root, relative);
    requireThat(fs.realpathSync(file) === file && fs.lstatSync(file).isFile(), 'input path is not canonical');
    const bytes = fs.readFileSync(file);
    const algorithm = entry[1].length === 40 ? 'sha1' : 'sha256';
    const blob = createHash(algorithm).update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    requireThat(blob === entry[1], 'input differs from the checked-out index');
    return bytes;
  };
  const load = name => JSON.parse(read(scope + '/' + name));
  const manifestBytes = read(scope + '/workspace-inputs.json');
  requireThat(hash(manifestBytes) === acceptedManifest, 'procurement manifest seal mismatch');
  const manifest = JSON.parse(manifestBytes);
  const verifyFiles = (name, count, expected) => {
    const rows = load(name).map(row => {
      const [source, target] = typeof row === 'string' ? [row, row] : row;
      requireThat(safePath(target), 'invalid target path');
      return { source, target, sha256: hash(read(source)) };
    });
    requireThat(rows.length === count && new Set(rows.map(row => row.target)).size === count &&
      hash(JSON.stringify(rows)) === expected, 'procurement input inventory mismatch');
    return rows;
  };
  const workspace = verifyFiles('workspace-files.json', 3504, manifest.workspaceSha256);
  const support = verifyFiles('support-files.json', 10, manifest.supportSha256);
  const dynamic = JSON.parse(read('services/api/prisma/database-dynamic-gate-manifest.json'));
  const original = dynamic.coveredGroups.find(group => group.id === selector);
  const originalCases = new Map(original?.testFiles.map(test => [test.path, test.pendingTests]));
  const planned = manifest.cases.flatMap(lane => lane.specs);
  requireThat(original?.runner.path === manifest.originalRunner && original.pendingTests === 27 &&
    originalCases.size === 3 && planned.length === 3 &&
    planned.every(([file, count]) => originalCases.get(file) === count), 'original group mapping mismatch');
  requireThat(dynamic.migrationBaseline.expectedDirectoryCount === 289 &&
    dynamic.migrationBaseline.terminalMigrationChecksum ===
      '90c194e51d72760db01145dca0678fdf4ff427c017074d1728c76e6dc876c0e4',
    'terminal migration mismatch');
  const installer = read('.github/task12-install-289/settlement-installer.cjs');
  requireThat(hash(installer) === '934ab11edad0196add74e2355b29eb1aaced623245064a590532b7befbfe44e2',
    'installer base changed');
  const delta = read(scope + '/installer-scope.patch');
  requireThat(hash(delta) === '82f169280cb7660c883fb9af8ef6dd0f8356b0305668f713499f55db97ba5225', 'installer scope changed');
  git('apply', '--check', '--unidiff-zero', scope + '/installer-scope.patch');
  if (stage) {
    const target = path.resolve(output);
    requireThat(output === target && fs.realpathSync(path.dirname(target)) === path.dirname(target) &&
      target !== root && !target.startsWith(root + path.sep), 'staging target must be outside the checkout');
    fs.mkdirSync(target, { mode: 0o700 });
    const write = (relative, bytes, mode = 0o644) => {
      const file = path.join(target, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: 'wx', mode });
    };
    const stageRows = (directory, rows) => {
      for (const { source, target: relative, sha256 } of rows) {
        const bytes = read(source);
        requireThat(hash(bytes) === sha256, 'staging input changed after admission');
        write(directory + '/' + relative, bytes, index.get(source)[0] === '100755' ? 0o755 : 0o644);
      }
    };
    stageRows('workspace', workspace);
    stageRows('procurement-support', support);
    write('.github/task12-install-289/settlement-installer.cjs', installer);
    execFileSync('git', ['apply', '--unidiff-zero', '-'], {
      cwd: target, input: delta, env: { PATH: process.env.PATH },
    });
    const derived = path.join(target, '.github/task12-install-289/settlement-installer.cjs');
    execFileSync(process.execPath, ['--check', derived]);
    write('installer.cjs', fs.readFileSync(derived));
    fs.unlinkSync(derived);
    fs.rmdirSync(path.dirname(derived));
    fs.rmdirSync(path.join(target, '.github'));
  }
  process.stdout.write(JSON.stringify({
    group: selector,
    plannedTests: original.pendingTests,
    execution: 'blocked',
    cases: manifest.cases.map(({mode, role, tests}) => ({mode, role, tests})),
  })+'\n');
} catch (error) {
  process.stderr.write('Procurement preflight rejected: ' + error.message + '\n');
  process.exitCode = 1;
}
