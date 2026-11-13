import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fastCheck = join(root, "scripts", "ops", "run-fast-local-check.mjs");
const baseSha = "a".repeat(40);

async function writeExecutable(path, source) {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o700);
}

async function writeFakeGit(
  testRoot,
  { tracked = [], typeChanged = [], untracked = [] } = {}
) {
  const fakeGit = join(testRoot, "git");
  await writeExecutable(
    fakeGit,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      `const tracked = ${JSON.stringify(tracked)};`,
      `const typeChanged = ${JSON.stringify(typeChanged)};`,
      `const untracked = ${JSON.stringify(untracked)};`,
      `const baseSha = ${JSON.stringify(baseSha)};`,
      "const key = args.join(' ');",
      "if (key === 'merge-base origin/main HEAD') process.stdout.write(`${baseSha}\\n`);",
      "else if (key === 'rev-parse HEAD') process.stdout.write('b'.repeat(40));",
      "else if (key === `diff --name-only -z --no-renames ${baseSha} HEAD --`) process.stdout.write([...tracked, ...typeChanged].join('\\0') + (tracked.length || typeChanged.length ? '\\0' : ''));",
      "else if (key === 'diff --name-only -z --no-renames --cached HEAD --' || key === 'diff --name-only -z --no-renames --') {}",
      "else if (key === 'ls-files -z --others --exclude-standard') process.stdout.write(untracked.join('\\0') + (untracked.length ? '\\0' : ''));",
      "else if (key === `diff --check ${baseSha} --`) process.exit(0);",
      "else { console.error(`unexpected git arguments: ${key}`); process.exit(1); }"
    ].join("\n")
  );
  return fakeGit;
}

async function writeFakePnpm(
  testRoot,
  { webRelatedTests = true, apiRelatedTests = [], failPattern = null } = {}
) {
  const fakePnpm = join(testRoot, "pnpm");
  const pnpmLog = join(testRoot, "pnpm.log");
  await writeExecutable(
    fakePnpm,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(pnpmLog)}, args.join(' ') + '\\n');`,
      `const webRelatedTests = ${JSON.stringify(webRelatedTests)};`,
      `const apiRelatedTests = ${JSON.stringify(apiRelatedTests)};`,
      `const failPattern = ${JSON.stringify(failPattern)};`,
      "if (failPattern && args.join(' ').includes(failPattern)) process.exit(7);",
      "if (args.includes('vitest') && args.includes('related') && !webRelatedTests) {",
      "  process.stdout.write('No test files found, exiting with code 0\\n');",
      "}",
      "if (args.includes('vitest') && args.includes('related') && webRelatedTests) {",
      "  process.stdout.write('1 test file passed\\n');",
      "}",
      "if (args.includes('jest') && args.includes('--listTests')) {",
      "  process.stdout.write(apiRelatedTests.join('\\n') + (apiRelatedTests.length ? '\\n' : ''));",
      "}"
    ].join("\n")
  );
  return { fakePnpm, pnpmLog };
}

function runFastCheck({ fakeGit, fakePnpm }) {
  return spawnSync(process.execPath, [fastCheck], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_BIN: fakeGit, PNPM_BIN: fakePnpm }
  });
}

test("fast check exits successfully without invoking pnpm when there are no changes", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot);
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no changes/u);
    await assert.rejects(readFile(pnpmLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check accepts documentation-only changes without invoking pnpm", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["docs/runbooks/development.md", "PROGRESS.md"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope: docs/u);
    assert.match(result.stdout, /docs:diff-check.*passed/u);
    await assert.rejects(readFile(pnpmLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check escalates release-sensitive changes before invoking pnpm", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["pnpm-lock.yaml", "services/api/prisma/schema.prisma"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /pnpm release:local/u);
    assert.match(result.stderr, /pnpm-lock\.yaml/u);
    await assert.rejects(readFile(pnpmLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check includes Git type changes and escalates a release script", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      typeChanged: ["scripts/ops/deploy-from-mac.sh"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /deploy-from-mac\.sh/u);
    assert.match(result.stderr, /pnpm release:local/u);
    await assert.rejects(readFile(pnpmLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check runs Web type, lint, UI, and related-test checks", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["apps/web-admin/src/pages/contracts/ContractDetail.vue"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope: web/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/web-admin typecheck/u);
    assert.match(calls, /--filter @jiangkong\/web-admin lint/u);
    assert.match(calls, /--filter @jiangkong\/web-admin check:ui/u);
    assert.match(calls, /--filter @jiangkong\/web-admin exec vitest related .*ContractDetail\.vue/u);
    assert.doesNotMatch(calls, /--filter @jiangkong\/web-admin test\n/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check falls back to the full Web suite when no related test is found", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["apps/web-admin/src/lib/new-helper.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot, {
      webRelatedTests: false
    });

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fallback: full web test/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/web-admin test\n/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check falls back to the full Web suite when a test file was deleted", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["apps/web-admin/src/lib/deleted-helper.spec.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /deleted test fallback: full web test/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/web-admin test\n/u);
    assert.doesNotMatch(calls, /deleted-helper\.spec\.ts/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check runs API type, lint, business-error, and related tests in band", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["services/api/src/contract/contract.service.ts"]
    });
    const relatedTest = join(root, "services/api/src/contract/contract.service.spec.ts");
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot, {
      apiRelatedTests: [relatedTest]
    });

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope: api/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/api typecheck/u);
    assert.match(calls, /--filter @jiangkong\/api lint/u);
    assert.match(calls, /--filter @jiangkong\/api check:business-errors/u);
    assert.match(calls, /exec jest --listTests --findRelatedTests .*contract\.service\.ts/u);
    assert.match(
      calls,
      /--filter @jiangkong\/api test -- --runInBand --runTestsByPath .*contract\.service\.spec\.ts/u
    );
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check covers both changed and source-related API tests", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: [
        "services/api/src/contract/contract.service.ts",
        "services/api/src/money/decimal-money.spec.ts"
      ]
    });
    const relatedTest = join(root, "services/api/src/contract/contract.service.spec.ts");
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot, {
      apiRelatedTests: [relatedTest]
    });

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    const testCall = (await readFile(pnpmLog, "utf8"))
      .split("\n")
      .find((call) => call.includes("--runTestsByPath"));
    assert.match(testCall, /contract\.service\.spec\.ts/u);
    assert.match(testCall, /decimal-money\.spec\.ts/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check covers changed Web tests and source-related Web tests", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: [
        "apps/web-admin/src/pages/contracts/ContractDetail.vue",
        "apps/web-admin/src/lib/money.test.ts"
      ]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /exec vitest related .*ContractDetail\.vue/u);
    assert.match(calls, /test -- .*money\.test\.ts/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check falls back to the full API suite when no related test is found", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["services/api/src/new-domain/new-helper.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fallback: full api test/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/api test -- --runInBand\n/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check falls back to the full API suite when a test file was deleted", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["services/api/src/new-domain/deleted-helper.spec.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /deleted test fallback: full api test/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/api test -- --runInBand\n/u);
    assert.doesNotMatch(calls, /deleted-helper\.spec\.ts/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check reports the failed stage duration and exits nonzero", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["apps/web-admin/src/lib/new-helper.ts"]
    });
    const { fakePnpm } = await writeFakePnpm(testRoot, {
      failPattern: "@jiangkong/web-admin lint"
    });

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /web:lint failed \(\d+ ms\)/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check includes an untracked Web test in the selected test command", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      untracked: ["apps/web-admin/src/lib/money.test.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/web-admin test -- .*money\.test\.ts/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check runs shared-domain checks and both consumer typechecks for shared tests", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["packages/shared-domain/src/contract-status.spec.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope: shared-domain/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/shared-domain typecheck/u);
    assert.match(calls, /--filter @jiangkong\/shared-domain lint/u);
    assert.match(calls, /--filter @jiangkong\/shared-domain test/u);
    assert.match(calls, /--filter @jiangkong\/api typecheck/u);
    assert.match(calls, /--filter @jiangkong\/web-admin typecheck/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check classifies combined Web and API changes as mixed and checks both", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: [
        "apps/web-admin/src/pages/contracts/ContractDetail.vue",
        "services/api/src/contract/contract.service.ts"
      ]
    });
    const relatedTest = join(root, "services/api/src/contract/contract.service.spec.ts");
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot, {
      apiRelatedTests: [relatedTest]
    });

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scope: mixed/u);
    const calls = await readFile(pnpmLog, "utf8");
    assert.match(calls, /--filter @jiangkong\/web-admin check:ui/u);
    assert.match(calls, /--filter @jiangkong\/api check:business-errors/u);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("fast check rejects an unsafe path returned by Git before invoking pnpm", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-fast-check-test-"));
  try {
    const fakeGit = await writeFakeGit(testRoot, {
      tracked: ["../outside.ts"]
    });
    const { fakePnpm, pnpmLog } = await writeFakePnpm(testRoot);

    const result = runFastCheck({ fakeGit, fakePnpm });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /不安全的路径/u);
    await assert.rejects(readFile(pnpmLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});


async function realRepositoryFixture() {
  const dir = await mkdtemp(join(tmpdir(), "fast-real-git-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  await writeFile(join(dir, ".git/info/exclude"), "/pnpm\n/pnpm.log\n");
  await mkdir(join(dir, "scripts/ops"), { recursive: true });
  await copyFile(fastCheck, join(dir, "scripts/ops/run-fast-local-check.mjs"));
  await writeFile(join(dir, "deleted.md"), "initial\n");
  await writeFile(join(dir, "renamed.md"), "initial\n");
  git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);
  const { fakePnpm, pnpmLog } = await writeFakePnpm(dir);
  const run = (...args) => spawnSync(process.execPath,
    [join(dir, "scripts/ops/run-fast-local-check.mjs"), ...args],
    { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_BIN: "git", PNPM_BIN: fakePnpm } });
  return { dir, git, base, run, pnpmLog };
}

test("development baseline covers committed, staged, unstaged, untracked, deletions and rename ends", async () => {
  const f = await realRepositoryFixture();
  try {
    await writeFile(join(f.dir, "committed.md"), "committed\n");
    f.git("add", "committed.md"); f.git("commit", "-qm", "iteration");
    await writeFile(join(f.dir, "staged.md"), "staged\n"); f.git("add", "staged.md");
    // The worktree reverses the index deletion: neither side may disappear from coverage.
    f.git("rm", "deleted.md"); await writeFile(join(f.dir, "deleted.md"), "initial\n");
    f.git("mv", "renamed.md", "destination.md");
    await writeFile(join(f.dir, "committed.md"), "dirty\n");
    await writeFile(join(f.dir, "new\nname.md"), "untracked\n");
    const r = f.run("--dev-base", f.base);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout.split("\n").find(x => x.startsWith("[check:fast] report: ")).slice(21));
    assert.equal(report.mode, "development-delta");
    assert.equal(report.base, f.base);
    assert.equal(report.head, f.git("rev-parse", "HEAD"));
    for (const path of ["committed.md", "staged.md", "deleted.md", "renamed.md", "destination.md", "new\nname.md"])
      assert.ok(report.paths.includes(path), path);
    assert.deepEqual(report.coverage.staged.sort(), ["deleted.md", "destination.md", "renamed.md", "staged.md"]);
    assert.ok(report.coverage.unstaged.includes("committed.md"));
    assert.ok(report.commands.some(c => c.label === "docs:diff-check"));
    assert.equal(typeof report.timings["collect"], "number");
    assert.match(r.stdout, /delta only/u);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("development base rejects invalid, missing and non-ancestor commits before checks", async () => {
  const f = await realRepositoryFixture();
  try {
    const tree = f.git("rev-parse", "HEAD^{tree}");
    const unrelated = f.git("commit-tree", tree, "-m", "unrelated");
    for (const base of ["--help", "HEAD", "$(touch injected)", "f".repeat(40), unrelated]) {
      const r = f.run("--dev-base", base);
      assert.notEqual(r.status, 0, base);
      await assert.rejects(readFile(f.pnpmLog, "utf8"));
    }
    await assert.rejects(readFile(join(f.dir, "injected"), "utf8"));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("explicit development checkpoint excludes old cumulative changes while default still escalates", async () => {
  const f = await realRepositoryFixture();
  try {
    await mkdir(join(f.dir, "services/api/prisma"), { recursive: true });
    await writeFile(join(f.dir, "services/api/prisma/schema.prisma"), "historical fixture\n");
    f.git("add", "."); f.git("commit", "-qm", "already checked checkpoint");
    const checkpoint = f.git("rev-parse", "HEAD");
    await writeFile(join(f.dir, "iteration.md"), "new iteration\n");
    assert.equal(f.run().status, 2);
    const r = f.run("--dev-base", checkpoint);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /development-delta/u);
    assert.doesNotMatch(r.stdout, /schema.prisma/u);
    await writeFile(join(f.dir, "services/api/prisma/schema.prisma"), "current schema edit\n");
    assert.equal(f.run("--dev-base", checkpoint).status, 2);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("development baseline preserves refusal for shared contracts, permissions and unknown scope", async () => {
  for (const path of ["packages/shared-domain/src/contract.ts", "services/api/src/auth/role.guard.ts", "unknown.bin"]) {
    const f = await realRepositoryFixture();
    try {
      await mkdir(dirname(join(f.dir, path)), { recursive: true });
      await writeFile(join(f.dir, path), "fixture\n");
      const r = f.run("--dev-base", f.base);
      assert.equal(r.status, 2, path);
      await assert.rejects(readFile(f.pnpmLog, "utf8"));
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  }
});

test("development paths containing shell syntax remain literal command arguments", async () => {
  const f = await realRepositoryFixture();
  try {
    const path = "apps/web-admin/src/$(touch injected).vue";
    await mkdir(dirname(join(f.dir, path)), { recursive: true });
    await writeFile(join(f.dir, path), "fixture\n");
    const r = f.run("--dev-base", f.base);
    assert.equal(r.status, 0, r.stderr);
    const prefix = "[check:fast] report: ";
    const report = JSON.parse(r.stdout.split("\n").find(x => x.startsWith(prefix)).slice(prefix.length));
    assert.ok(report.commands.find(c => c.label === "web:related-tests").args.some(arg => arg.endsWith(`/${path}`)));
    await assert.rejects(readFile(join(f.dir, "injected"), "utf8"));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
