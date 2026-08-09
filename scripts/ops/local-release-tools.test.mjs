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
const candidateSha = "a".repeat(40);

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

async function writeDeploymentInputs(testRoot, receiptCandidateSha) {
  const receipt = join(testRoot, "receipt.json");
  const identityFile = join(testRoot, "id_deploy");
  const knownHosts = join(testRoot, "known_hosts");
  const sshLog = join(testRoot, "ssh.log");
  const fakeSsh = join(testRoot, "ssh");

  await writeFile(
    receipt,
    JSON.stringify({ status: "passed", candidateSha: receiptCandidateSha }),
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

test("local release gate publishes its complete local verification plan", () => {
  const result = runScript(localGate, ["--list-checks"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /frozen-dependency-install/u);
  assert.match(result.stdout, /prisma-client-generation/u);
  assert.match(result.stdout, /workspace-test/u);
  assert.match(result.stdout, /exact-sha-postgresql-16/u);
  assert.match(result.stdout, /playwright-p0/u);
  assert.match(result.stdout, /playwright-rc06-mock/u);
});

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

test("Mac deployment dry run validates a matching receipt without invoking SSH", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "jiangkong-local-deploy-test-"));
  try {
    const inputs = await writeDeploymentInputs(testRoot, candidateSha);
    const fakeGit = join(testRoot, "git");
    await writeExecutable(
      fakeGit,
      [
        "#!/usr/bin/env bash",
        "case \"$*\" in",
        `  \"rev-parse HEAD\") printf '${candidateSha}\\n' ;;`,
        "  \"status --porcelain=v1 --untracked-files=all\") ;;",
        "  \"fetch --no-tags origin main:refs/remotes/origin/main\") ;;",
        "  cat-file\\ -e\\ *) ;;",
        "  merge-base\\ --is-ancestor\\ *) ;;",
        "  *) printf 'unexpected git arguments: %s\\n' \"$*\" >&2; exit 1 ;;",
        "esac"
      ].join("\n")
    );

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
