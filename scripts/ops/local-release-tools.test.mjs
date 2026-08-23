import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const localGate = join(root, "scripts", "ops", "run-local-release-gate.sh");
const localDeploy = join(root, "scripts", "ops", "deploy-from-mac.sh");
const localDispatch = join(root, "scripts", "ops", "request-github-deploy.sh");
const localReceipt = join(root, "scripts", "ops", "local-release-receipt.mjs");
const candidateSha = "a".repeat(40);
const requiredChecks = [
  "ci-orchestration",
  "frozen-dependency-install",
  "prisma-client-generation",
  "migration-baseline",
  "production-dependency-audit",
  "workspace-typecheck",
  "web-e2e-typecheck",
  "workspace-lint",
  "business-errors-and-operations-safety",
  "workspace-test",
  "api-and-web-production-build",
  "web-ui-governance",
  "release-manifests",
  "exact-sha-postgresql-16",
  "playwright-p0",
  "playwright-rc06-mock"
];

function runScript(script, args, options = {}) {
  return spawnSync("bash", [script, ...args], {
    cwd: root,
    encoding: "utf8",
    ...options
  });
}

async function writeExecutable(path, source) {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o700);
}

async function writeDeploymentInputs(testRoot, receiptCandidateSha, { complete = true } = {}) {
  const receipt = join(testRoot, "receipt.json");
  const identityFile = join(testRoot, "id_deploy");
  const knownHosts = join(testRoot, "known_hosts");
  const sshLog = join(testRoot, "ssh.log");
  const fakeSsh = join(testRoot, "ssh");

  await writeFile(
    receipt,
    JSON.stringify(
      complete
        ? {
            schemaVersion: 2,
            status: "passed",
            candidateSha: receiptCandidateSha,
            verifiedAt: "2026-08-09T00:00:00Z",
            nodeVersion: "20.19.0",
            pnpmVersion: "9.15.9",
            checks: requiredChecks,
            durationsMs: Object.fromEntries(
              requiredChecks.map((check, index) => [check, 1000 + index])
            )
          }
        : { status: "passed", candidateSha: receiptCandidateSha }
    ),
    "utf8"
  );
  await writeFile(identityFile, "test key\n", "utf8");
  await chmod(identityFile, 0o600);
  await writeFile(knownHosts, "example.test ssh-ed25519 AAAA\n", "utf8");
  await writeExecutable(
    fakeSsh,
    [
      "#!/usr/bin/env bash",
      `printf 'ssh invoked\\n' >> ${JSON.stringify(sshLog)}`,
      "exit 0"
    ].join("\n")
  );

  return { receipt, identityFile, knownHosts, sshLog, fakeSsh };
}

async function writeFakeGit(
  testRoot,
  { head = candidateSha, main = candidateSha, dirty = false } = {}
) {
  const fakeGit = join(testRoot, "git");
  await writeExecutable(
    fakeGit,
    [
      "#!/usr/bin/env bash",
      "case \"$*\" in",
      `  \"rev-parse HEAD\") printf '${head}\\n' ;;`,
      `  \"rev-parse refs/remotes/origin/main\") printf '${main}\\n' ;;`,
      dirty
        ? "  \"status --porcelain=v1 --untracked-files=all\") printf ' M uncommitted.txt\\n' ;;"
        : "  \"status --porcelain=v1 --untracked-files=all\") ;;",
      "  \"fetch --no-tags origin main:refs/remotes/origin/main\") ;;",
      "  cat-file\\ -e\\ *) ;;",
      "  merge-base\\ --is-ancestor\\ *) ;;",
      "  *) printf 'unexpected git arguments: %s\\n' \"$*\" >&2; exit 1 ;;",
      "esac"
    ].join("\n")
  );
  return fakeGit;
}

async function writeFakeGh(testRoot) {
  const ghLog = join(testRoot, "gh.log");
  const fakeGh = join(testRoot, "gh");
  await writeExecutable(
    fakeGh,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\n' \"$@\" >> " + JSON.stringify(ghLog),
      "exit 0"
    ].join("\n")
  );
  return { fakeGh, ghLog };
}

async function writeFakeLocalGateTools(testRoot) {
  const fakeNode = join(testRoot, "node");
  const fakePnpm = join(testRoot, "pnpm");
  const fakeDocker = join(testRoot, "docker");
  const fakeGit = join(testRoot, "git-gate");
  const fakeBash = join(testRoot, "bash");
  await writeExecutable(
    fakeNode,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [[ \"${1:-}\" == \"-p\" && \"${2:-}\" == \"process.versions.node\" ]]; then printf '20.19.0\\n'; exit 0; fi",
      `if [[ "\${1:-}" == "-p" && "\${2:-}" == "Date.now()" ]]; then exec ${JSON.stringify(process.execPath)} "$@"; fi`,
      `if [[ "\${1:-}" == */local-release-receipt.mjs ]]; then exec ${JSON.stringify(process.execPath)} "$@"; fi`,
      "exit 0"
    ].join("\n")
  );
  await writeExecutable(
    fakePnpm,
    "#!/usr/bin/env bash\nif [[ \"${1:-}\" == \"--version\" ]]; then printf '9.15.9\\n'; fi\nexit 0\n"
  );
  await writeExecutable(
    fakeDocker,
    [
      "#!/usr/bin/env bash",
      "if [[ \"$*\" == \"context inspect --format {{.Endpoints.docker.Host}}\" ]]; then printf 'unix:///var/run/docker.sock\\n'; fi",
      "exit 0"
    ].join("\n")
  );
  await writeExecutable(
    fakeGit,
    [
      "#!/usr/bin/env bash",
      `if [[ "$*" == "rev-parse HEAD" ]]; then printf '${candidateSha}\\n'; exit 0; fi`,
      "if [[ \"$*\" == \"status --porcelain=v1 --untracked-files=all\" ]]; then exit 0; fi",
      "exit 1"
    ].join("\n")
  );
  await writeExecutable(fakeBash, "#!/usr/bin/env bash\nexit 0\n");
  return { fakeNode, fakePnpm, fakeDocker, fakeGit, fakeBash };
}

test("local release gate refuses a non-Node-20 host before writing a receipt", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-gate-test-"));
  try {
    const fakeNode = join(testRoot, "node");
    const receipt = join(testRoot, "receipt.json");
    await writeExecutable(
      fakeNode,
      "#!/usr/bin/env bash\nif [[ \"$1\" == \"-p\" ]]; then printf '22.0.0\\n'; exit 0; fi\nexit 0\n"
    );

    const result = runScript(localGate, ["--preflight", "--receipt", receipt], {
      env: { ...process.env, NODE_BIN: fakeNode }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Node\.js 20 is required/u);
    await assert.rejects(readFile(receipt, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("pnpm forwards local release options without a separator argument", () => {
  const result = spawnSync("pnpm", ["release:local", "--list-checks"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /playwright-rc06-mock/u);
});

test("normal deployment dispatch and direct-Mac fallback have distinct package commands", async () => {
  const [packageJsonSource, directMacSource] = await Promise.all([
    readFile(join(root, "package.json"), "utf8"),
    readFile(localDeploy, "utf8")
  ]);
  const packageJson = JSON.parse(packageJsonSource);

  assert.equal(
    packageJson.scripts["deploy:local"],
    "bash scripts/ops/request-github-deploy.sh"
  );
  assert.equal(
    packageJson.scripts["deploy:mac-direct"],
    "bash scripts/ops/deploy-from-mac.sh"
  );
  assert.match(directMacSource, /Usage: pnpm deploy:mac-direct --target-sha/u);
});

test("local release gate runs the API suite in band", async () => {
  const source = await readFile(localGate, "utf8");

  assert.match(source, /run_workspace_tests\(\) \{/u);
  assert.match(
    source,
    /--filter @jiangkong\/api test -- --runInBand/u
  );
  assert.match(source, /run_check workspace-test run_workspace_tests/u);
});

test("release receipt tool serializes an exact per-phase duration ledger", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-receipt-test-"));
  try {
    const durationFile = join(testRoot, "durations.tsv");
    await writeFile(
      durationFile,
      `${requiredChecks.map((check, index) => `${check}\t${index + 1}`).join("\n")}\n`,
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [localReceipt, "--durations-json", "--file", durationFile],
      { cwd: root, encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout),
      Object.fromEntries(requiredChecks.map((check, index) => [check, index + 1]))
    );
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("full local gate writes schema v2 with all per-phase durations", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-gate-test-"));
  try {
    const receipt = join(testRoot, "receipt.json");
    const tools = await writeFakeLocalGateTools(testRoot);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL" && !key.endsWith("_DATABASE_URL"))
    );

    const result = runScript(localGate, ["--receipt", receipt], {
      env: {
        ...env,
        NODE_BIN: tools.fakeNode,
        PNPM_BIN: tools.fakePnpm,
        DOCKER_BIN: tools.fakeDocker,
        GIT_BIN: tools.fakeGit,
        BASH_BIN: tools.fakeBash
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(await readFile(receipt, "utf8"));
    assert.equal(parsed.schemaVersion, 2);
    assert.deepEqual(Object.keys(parsed.durationsMs), requiredChecks);
    for (const duration of Object.values(parsed.durationsMs)) {
      assert.equal(Number.isInteger(duration) && duration >= 0, true);
    }
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("local release gate refuses a non-pnpm-9 host before writing a receipt", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-gate-test-"));
  try {
    const fakeNode = join(testRoot, "node");
    const fakePnpm = join(testRoot, "pnpm");
    const receipt = join(testRoot, "receipt.json");
    await writeExecutable(
      fakeNode,
      "#!/usr/bin/env bash\nif [[ \"$1\" == \"-p\" ]]; then printf '20.19.0\\n'; exit 0; fi\nexit 0\n"
    );
    await writeExecutable(fakePnpm, "#!/usr/bin/env bash\nprintf '10.0.0\\n'\n");

    const result = runScript(localGate, ["--preflight", "--receipt", receipt], {
      env: { ...process.env, NODE_BIN: fakeNode, PNPM_BIN: fakePnpm }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pnpm 9 is required/u);
    await assert.rejects(readFile(receipt, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Mac deployment dry run refuses a receipt for another candidate without invoking SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, "b".repeat(40));
    const result = runScript(
      localDeploy,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          JGZG_DEPLOY_HOST: "example.test",
          JGZG_DEPLOY_USER: "ubuntu",
          JGZG_DEPLOY_IDENTITY_FILE: inputs.identityFile,
          JGZG_DEPLOY_KNOWN_HOSTS: inputs.knownHosts,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match target SHA/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Mac deployment dry run refuses an incomplete local release receipt", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha, {
      complete: false
    });
    const result = runScript(
      localDeploy,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          JGZG_DEPLOY_HOST: "example.test",
          JGZG_DEPLOY_USER: "ubuntu",
          JGZG_DEPLOY_IDENTITY_FILE: inputs.identityFile,
          JGZG_DEPLOY_KNOWN_HOSTS: inputs.knownHosts,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release receipt is incomplete/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Mac deployment dry run refuses a receipt without per-phase durations", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const receipt = JSON.parse(await readFile(inputs.receipt, "utf8"));
    delete receipt.durationsMs;
    await writeFile(inputs.receipt, JSON.stringify(receipt), "utf8");
    const result = runScript(
      localDeploy,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          JGZG_DEPLOY_HOST: "example.test",
          JGZG_DEPLOY_USER: "ubuntu",
          JGZG_DEPLOY_IDENTITY_FILE: inputs.identityFile,
          JGZG_DEPLOY_KNOWN_HOSTS: inputs.knownHosts,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release receipt is incomplete/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Mac deployment dry run refuses a malformed local release receipt", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    await writeFile(inputs.receipt, "not JSON", "utf8");
    const result = runScript(
      localDeploy,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          JGZG_DEPLOY_HOST: "example.test",
          JGZG_DEPLOY_USER: "ubuntu",
          JGZG_DEPLOY_IDENTITY_FILE: inputs.identityFile,
          JGZG_DEPLOY_KNOWN_HOSTS: inputs.knownHosts,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release receipt is incomplete/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("full Mac deployment requires a manual post-health confirmation window", () => {
  const result = runScript(localDeploy, [
    "--dry-run",
    "--target-sha",
    candidateSha,
    "--receipt",
    "/tmp/receipt.json",
    "--confirm",
    "DEPLOY JGZG PRODUCTION",
    "--confirmation-mode",
    "immediate"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full deployments require manual confirmation mode/u);
});

test("direct Mac deployment refuses a confirmation window beyond the server recovery bound", () => {
  const result = runScript(localDeploy, [
    "--dry-run",
    "--target-sha",
    candidateSha,
    "--receipt",
    "/tmp/receipt.json",
    "--confirm",
    "DEPLOY JGZG PRODUCTION",
    "--confirmation-timeout-seconds",
    "3601"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /between 1 and 3600 seconds/u);
});

test("Mac deployment dry run refuses a target that is no longer origin/main", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const fakeGit = await writeFakeGit(testRoot, { main: "b".repeat(40) });
    const result = runScript(
      localDeploy,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          JGZG_DEPLOY_HOST: "example.test",
          JGZG_DEPLOY_USER: "ubuntu",
          JGZG_DEPLOY_IDENTITY_FILE: inputs.identityFile,
          JGZG_DEPLOY_KNOWN_HOSTS: inputs.knownHosts,
          SSH_BIN: inputs.fakeSsh,
          GIT_BIN: fakeGit
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match origin\/main/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Mac deployment dry run validates a matching receipt without invoking SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const fakeGit = await writeFakeGit(testRoot);

    const result = runScript(
      localDeploy,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          JGZG_DEPLOY_HOST: "example.test",
          JGZG_DEPLOY_USER: "ubuntu",
          JGZG_DEPLOY_IDENTITY_FILE: inputs.identityFile,
          JGZG_DEPLOY_KNOWN_HOSTS: inputs.knownHosts,
          SSH_BIN: inputs.fakeSsh,
          GIT_BIN: fakeGit
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run passed/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch refuses an incorrect production confirmation before invoking GitHub or SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot);
    const result = runScript(
      localDispatch,
      [
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY SOMETHING ELSE"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /production confirmation must exactly match/u);
    await assert.rejects(readFile(ghLog, "utf8"));
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch refuses a receipt for another candidate before invoking GitHub or SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, "b".repeat(40));
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot);
    const result = runScript(
      localDispatch,
      [
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match target SHA/u);
    await assert.rejects(readFile(ghLog, "utf8"));
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch refuses a dirty checkout before invoking GitHub or SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot, { dirty: true });
    const result = runScript(
      localDispatch,
      [
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /local candidate worktree must be clean/u);
    await assert.rejects(readFile(ghLog, "utf8"));
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch refuses a target that is no longer origin/main before invoking GitHub or SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot, { main: "b".repeat(40) });
    const result = runScript(
      localDispatch,
      [
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match origin\/main/u);
    await assert.rejects(readFile(ghLog, "utf8"));
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch dry run validates a matching request without invoking GitHub or SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot);
    const result = runScript(
      localDispatch,
      [
        "--dry-run",
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run passed/u);
    await assert.rejects(readFile(ghLog, "utf8"));
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch sends only the validated receipt summary after local checks pass", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot);
    const result = runScript(
      localDispatch,
      [
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GitHub deployment workflow requested/u);
    const args = await readFile(ghLog, "utf8");
    assert.match(args, /^workflow$/mu);
    assert.match(args, /^run$/mu);
    assert.match(args, /^deploy-production\.yml$/mu);
    assert.match(args, /^--ref$/mu);
    assert.match(args, /^main$/mu);
    assert.match(args, new RegExp("^target_sha=" + candidateSha + "$", "mu"));
    assert.match(args, /^production_confirmation=DEPLOY JGZG PRODUCTION$/mu);
    assert.match(args, /release_receipt_json=.*"candidateSha":"a{40}"/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("GitHub dispatch strips receipt fields that are outside the non-sensitive summary", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-github-dispatch-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const receipt = JSON.parse(await readFile(inputs.receipt, "utf8"));
    receipt.localOperatorNote = "do-not-send";
    await writeFile(inputs.receipt, JSON.stringify(receipt), "utf8");
    const { fakeGh, ghLog } = await writeFakeGh(testRoot);
    const fakeGit = await writeFakeGit(testRoot);
    const result = runScript(
      localDispatch,
      [
        "--target-sha",
        candidateSha,
        "--receipt",
        inputs.receipt,
        "--confirm",
        "DEPLOY JGZG PRODUCTION"
      ],
      {
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GIT_BIN: fakeGit,
          SSH_BIN: inputs.fakeSsh
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    const args = await readFile(ghLog, "utf8");
    assert.doesNotMatch(args, /do-not-send/u);
    await assert.rejects(readFile(inputs.sshLog, "utf8"));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
