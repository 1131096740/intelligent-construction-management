import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("./set-operational-write-freeze.sh", import.meta.url)
);
const TARGET_SHA = "0123456789abcdef0123456789abcdef01234567";

async function executable(path, content) {
  await writeFile(path, content, { mode: 0o700 });
  await chmod(path, 0o700);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jiangkong-write-freeze-"));
  const bin = join(root, "bin");
  const repo = join(root, "repo");
  const receipts = join(root, "receipts");
  const envFile = join(root, "api.env");
  const log = join(root, "commands.log");
  const original = [
    "DATABASE_URL=postgresql://user:do-not-print@localhost/db",
    "JWT_ACCESS_SECRET=also-do-not-print",
    "OPERATIONAL_WRITE_FREEZE_MODE=off",
    "OPERATIONAL_WRITE_FREEZE_MODULES=",
    ""
  ].join("\n");
  await mkdir(bin);
  await mkdir(repo);
  await writeFile(envFile, original, { mode: 0o600 });
  await writeFile(log, "");
  await executable(
    join(bin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "\${FAKE_LOG:?}"
case "$*" in
  "-C "*" rev-parse HEAD") printf '%s\n' "\${FAKE_GIT_HEAD:?}" ;;
  "-C "*" status --porcelain --untracked-files=normal") ;;
  *) exit 1 ;;
esac
`
  );
  await executable(
    join(bin, "systemctl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >> "\${FAKE_LOG:?}"
if [[ "\${FAKE_SYSTEMCTL_FAIL:-false}" == true ]]; then exit 1; fi
`
  );
  await executable(
    join(bin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "\${FAKE_LOG:?}"
if [[ "\${FAKE_HEALTH_FAIL:-false}" == true ]]; then exit 1; fi
`
  );
  await executable(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  return { root, bin, repo, receipts, envFile, log, original };
}

function run(input, extraEnv = {}) {
  const confirmation = `APPLY_OPERATIONAL_WRITE_FREEZE_${TARGET_SHA}_${input.mode}_${
    input.modules || "none"
  }`;
  const arguments_ = [
    SCRIPT,
    "--mode",
    input.mode,
    "--target-sha",
    TARGET_SHA,
    "--env-file",
    input.envFile,
    ...(input.modules ? ["--modules", input.modules] : []),
    ...(input.apply
      ? ["--apply", "--confirm", input.confirmation ?? confirmation]
      : [])
  ];
  return spawnSync("bash", arguments_, {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${input.bin}:${process.env.PATH}`,
      REPO_ROOT_OVERRIDE: input.repo,
      WRITE_FREEZE_RECEIPT_DIR: input.receipts,
      WRITE_FREEZE_LOCK_DIR: join(input.root, "lock"),
      OPERATIONAL_WRITE_FREEZE_ALLOW_NON_ROOT: "true",
      WRITE_FREEZE_HEALTH_ATTEMPTS: "2",
      FAKE_GIT_HEAD: TARGET_SHA,
      FAKE_LOG: input.log,
      ...extraEnv
    }
  });
}

test("dry-run validates and prints the exact confirmation without changing the environment", async () => {
  const item = await fixture();
  try {
    const result = run({ ...item, mode: "modules", modules: "payment,settlement" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(
        `APPLY_OPERATIONAL_WRITE_FREEZE_${TARGET_SHA}_modules_payment,settlement`
      )
    );
    assert.equal(await readFile(item.envFile, "utf8"), item.original);
    await assert.rejects(readdir(item.receipts));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("applies a canonical module freeze atomically and writes a secret-free receipt", async () => {
  const item = await fixture();
  try {
    const result = run({
      ...item,
      mode: "modules",
      modules: "payment,settlement",
      apply: true
    });
    assert.equal(result.status, 0, result.stderr);
    const updated = await readFile(item.envFile, "utf8");
    assert.match(updated, /^OPERATIONAL_WRITE_FREEZE_MODE=modules$/m);
    assert.match(
      updated,
      /^OPERATIONAL_WRITE_FREEZE_MODULES=payment,settlement$/m
    );
    assert.match(updated, /^DATABASE_URL=postgresql:\/\/user:do-not-print@localhost\/db$/m);
    assert.doesNotMatch(result.stdout + result.stderr, /do-not-print/);
    const receiptNames = await readdir(item.receipts);
    assert.equal(receiptNames.length, 1);
    const receipt = JSON.parse(
      await readFile(join(item.receipts, receiptNames[0]), "utf8")
    );
    assert.deepEqual(
      {
        status: receipt.status,
        candidateSha: receipt.candidateSha,
        mode: receipt.mode,
        modules: receipt.modules
      },
      {
        status: "applied",
        candidateSha: TARGET_SHA,
        mode: "modules",
        modules: ["payment", "settlement"]
      }
    );
    assert.doesNotMatch(JSON.stringify(receipt), /DATABASE_URL|JWT_ACCESS_SECRET|do-not-print/);
    assert.match(await readFile(item.log, "utf8"), /systemctl restart jiangkong-api/);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rejects a wrong confirmation before changing the environment or restarting", async () => {
  const item = await fixture();
  try {
    const result = run({
      ...item,
      mode: "all",
      apply: true,
      confirmation: "WRONG"
    });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(item.envFile, "utf8"), item.original);
    assert.doesNotMatch(await readFile(item.log, "utf8"), /systemctl/);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("restores the exact previous environment when post-restart health does not recover", async () => {
  const item = await fixture();
  try {
    const result = run(
      { ...item, mode: "all", apply: true },
      { FAKE_HEALTH_FAIL: "true" }
    );
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(item.envFile, "utf8"), item.original);
    const commandLog = await readFile(item.log, "utf8");
    assert.equal(
      commandLog.match(/systemctl restart jiangkong-api/g)?.length,
      2
    );
    await assert.rejects(readdir(item.receipts));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rejects a symbolic-link environment target", async () => {
  const item = await fixture();
  const link = join(item.root, "api-link.env");
  try {
    await symlink(item.envFile, link);
    const result = run({ ...item, envFile: link, mode: "off", apply: true });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(item.envFile, "utf8"), item.original);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
