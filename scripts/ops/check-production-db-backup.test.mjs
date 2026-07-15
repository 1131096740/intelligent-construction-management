import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateBackup } from "./check-production-db-backup.mjs";

const NOW = new Date("2026-07-15T19:16:00.000Z"); // 2026-07-16 03:16 Asia/Shanghai
const EXPECTED_UID = String(process.getuid?.() ?? 0);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function createFixture(uploadedAt = "2026-07-15T19:00:02.000Z") {
  const root = await mkdtemp(join(tmpdir(), "jiangkong-backup-monitor-"));
  const dump = join(root, "jiangkong-20260716-030001.dump");
  const checksum = `${dump}.sha256`;
  const receipt = `${dump}.offsite.json`;
  const dumpContent = Buffer.from("fixture dump");
  const dumpSha256 = sha256(dumpContent);

  await writeFile(dump, dumpContent, { mode: 0o600 });
  const checksumContent = `${dumpSha256}  ${basename(dump)}\n`;
  await writeFile(checksum, checksumContent, { mode: 0o600 });
  await writeFile(
    receipt,
    `${JSON.stringify(
      {
        bucket: "jiangkong-prod-db-backups-1438687719",
        region: "ap-chengdu",
        backupObjectKey: `database-backups/daily/2026/07/16/${basename(dump)}`,
        checksumObjectKey: `database-backups/daily/2026/07/16/${basename(checksum)}`,
        backupSize: dumpContent.length,
        backupSha256: dumpSha256,
        checksumSha256: sha256(checksumContent),
        uploadedAt,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  const receiptTime = new Date(uploadedAt);
  await utimes(receipt, receiptTime, receiptTime);

  return {
    root,
    dump,
    checksum,
    receipt,
    env: {
      BACKUP_DIR: root,
      DB_BACKUP_MONITOR_EXPECTED_UID: EXPECTED_UID,
      DB_BACKUP_MONITOR_TIME_ZONE: "Asia/Shanghai",
      DB_BACKUP_MONITOR_DAILY_HOUR: "3",
      DB_BACKUP_MONITOR_GRACE_MINUTES: "15",
      DB_BACKUP_MONITOR_MAX_AGE_HOURS: "26",
      DB_BACKUP_MONITOR_EXPECTED_PREFIX: "database-backups/daily/",
    },
  };
}

async function removeFixture(fixture) {
  await rm(fixture.root, { recursive: true, force: true });
}

test("accepts the current 03:00 receipt and verifies the dump structure", async () => {
  const fixture = await createFixture();
  let pgRestoreCalls = 0;
  try {
    const result = await evaluateBackup({
      env: fixture.env,
      now: NOW,
      runPgRestore: async () => {
        pgRestoreCalls += 1;
        return true;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.code, "OK");
    assert.equal(result.cached, false);
    assert.equal(pgRestoreCalls, 1);
    assert.match(result.message, /03:00 异机数据库备份有效/);
    assert.ok(result.validationSignature);
  } finally {
    await removeFixture(fixture);
  }
});

test("ignores a newer monthly receipt when evaluating the 03:00 daily backup", async () => {
  const fixture = await createFixture();
  try {
    const monthlyReceipt = join(fixture.root, "jiangkong-20260716-033001.dump.offsite.json");
    const monthlyData = JSON.parse(await readFile(fixture.receipt, "utf8"));
    monthlyData.backupObjectKey =
      "database-backups/monthly/2026/07/16/jiangkong-20260716-033001.dump";
    monthlyData.checksumObjectKey = `${monthlyData.backupObjectKey}.sha256`;
    monthlyData.uploadedAt = "2026-07-15T19:30:02.000Z";
    await writeFile(monthlyReceipt, `${JSON.stringify(monthlyData, null, 2)}\n`, { mode: 0o600 });
    const monthlyTime = new Date(monthlyData.uploadedAt);
    await utimes(monthlyReceipt, monthlyTime, monthlyTime);

    const result = await evaluateBackup({ env: fixture.env, now: NOW, runPgRestore: async () => true });

    assert.equal(result.ok, true);
    assert.match(result.message, /jiangkong-20260716-030001\.dump/);
  } finally {
    await removeFixture(fixture);
  }
});

test("rejects a receipt that points to an unapproved COS bucket or region", async () => {
  const fixture = await createFixture();
  try {
    const receiptData = JSON.parse(await readFile(fixture.receipt, "utf8"));
    receiptData.bucket = "unapproved-backup-bucket";
    await writeFile(fixture.receipt, `${JSON.stringify(receiptData, null, 2)}\n`, { mode: 0o600 });

    const wrongBucket = await evaluateBackup({
      env: fixture.env,
      now: NOW,
      runPgRestore: async () => true,
    });

    assert.equal(wrongBucket.ok, false);
    assert.equal(wrongBucket.code, "UNEXPECTED_BACKUP_TARGET");
    assert.match(wrongBucket.message, /不是获批生产备份目标/);

    receiptData.bucket = "jiangkong-prod-db-backups-1438687719";
    receiptData.region = "ap-guangzhou";
    await writeFile(fixture.receipt, `${JSON.stringify(receiptData, null, 2)}\n`, { mode: 0o600 });
    const wrongRegion = await evaluateBackup({
      env: fixture.env,
      now: NOW,
      runPgRestore: async () => true,
    });

    assert.equal(wrongRegion.ok, false);
    assert.equal(wrongRegion.code, "UNEXPECTED_BACKUP_TARGET");
  } finally {
    await removeFixture(fixture);
  }
});

test("reports a missed scheduled backup after the 03:15 grace period", async () => {
  const fixture = await createFixture("2026-07-14T19:00:02.000Z");
  try {
    const result = await evaluateBackup({ env: fixture.env, now: NOW, runPgRestore: async () => true });

    assert.equal(result.ok, false);
    assert.equal(result.code, "MISSING_TODAY_RECEIPT");
    assert.match(result.message, /不代表数据库中没有业务数据/);
    assert.match(result.message, /检查.*cron.*日志/);
  } finally {
    await removeFixture(fixture);
  }
});

test("reports a stale receipt before today's scheduled grace period", async () => {
  const fixture = await createFixture("2026-07-14T15:00:00.000Z");
  try {
    const result = await evaluateBackup({
      env: fixture.env,
      now: new Date("2026-07-15T18:00:00.000Z"), // 02:00 Asia/Shanghai
      runPgRestore: async () => true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "STALE_RECEIPT");
    assert.match(result.message, /超过 26 小时/);
  } finally {
    await removeFixture(fixture);
  }
});

test("rejects malformed receipt JSON", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.receipt, "{not-json\n", { mode: 0o600 });
    const result = await evaluateBackup({ env: fixture.env, now: NOW, runPgRestore: async () => true });

    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_RECEIPT");
  } finally {
    await removeFixture(fixture);
  }
});

test("rejects artifacts that are not private", async () => {
  const fixture = await createFixture();
  try {
    await chmod(fixture.dump, 0o644);
    const result = await evaluateBackup({ env: fixture.env, now: NOW, runPgRestore: async () => true });

    assert.equal(result.ok, false);
    assert.equal(result.code, "UNSAFE_ARTIFACT");
    assert.match(result.message, /600/);
  } finally {
    await removeFixture(fixture);
  }
});

test("rejects a dump whose content no longer matches the receipt hash", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.dump, Buffer.from("fixture xump"), { mode: 0o600 });
    const result = await evaluateBackup({ env: fixture.env, now: NOW, runPgRestore: async () => true });

    assert.equal(result.ok, false);
    assert.equal(result.code, "BACKUP_HASH_MISMATCH");
  } finally {
    await removeFixture(fixture);
  }
});

test("rejects a dump that pg_restore cannot inspect", async () => {
  const fixture = await createFixture();
  try {
    const result = await evaluateBackup({ env: fixture.env, now: NOW, runPgRestore: async () => false });

    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_DUMP_STRUCTURE");
  } finally {
    await removeFixture(fixture);
  }
});

test("uses a matching validation cache instead of rehashing a growing dump", async () => {
  const fixture = await createFixture();
  const cacheFile = join(fixture.root, "validation-cache.json");
  let pgRestoreCalls = 0;
  try {
    const first = await evaluateBackup({
      env: fixture.env,
      now: NOW,
      runPgRestore: async () => {
        pgRestoreCalls += 1;
        return true;
      },
    });
    await writeFile(
      cacheFile,
      `${JSON.stringify({ validationSignature: first.validationSignature })}\n`,
      { mode: 0o600 },
    );

    const second = await evaluateBackup({
      env: { ...fixture.env, DB_BACKUP_MONITOR_VALIDATION_CACHE_FILE: cacheFile },
      now: NOW,
      runPgRestore: async () => {
        pgRestoreCalls += 1;
        return true;
      },
    });

    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal(pgRestoreCalls, 1);
    assert.match(await readFile(cacheFile, "utf8"), /validationSignature/);
  } finally {
    await removeFixture(fixture);
  }
});

test("wrapper deduplicates an active failure and sends one recovery notification", async () => {
  const fixture = await createFixture("2026-07-14T19:00:02.000Z");
  const stateDir = join(fixture.root, "monitor-state");
  const fakeBin = join(fixture.root, "bin");
  const curlCount = join(fixture.root, "curl.count");
  const curlArgs = join(fixture.root, "curl.args");
  const wrapper = fileURLToPath(new URL("./check-production-db-backup.sh", import.meta.url));
  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "curl"),
      "#!/bin/sh\nprintf x >> \"$FAKE_CURL_COUNT\"\nprintf '%s\\n' \"$*\" >> \"$FAKE_CURL_ARGS\"\ncat >/dev/null || true\nexit 0\n",
      { mode: 0o700 },
    );
    await writeFile(join(fakeBin, "pg_restore"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const env = {
      ...process.env,
      ...fixture.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      DB_BACKUP_MONITOR_ALLOW_NON_ROOT: "true",
      DB_BACKUP_MONITOR_NOW: NOW.toISOString(),
      DB_BACKUP_MONITOR_STATE_DIR: stateDir,
      DB_BACKUP_MONITOR_PG_RESTORE_BIN: join(fakeBin, "pg_restore"),
      ALERT_WEBHOOK_URL: "https://example.invalid/backup-alert",
      FAKE_CURL_COUNT: curlCount,
      FAKE_CURL_ARGS: curlArgs,
    };

    const first = spawnSync("bash", [wrapper], { env, encoding: "utf8" });
    const duplicate = spawnSync("bash", [wrapper], { env, encoding: "utf8" });

    assert.equal(first.status, 1, first.stderr);
    assert.equal(duplicate.status, 1, duplicate.stderr);
    assert.match(duplicate.stderr, /duplicate notification suppressed/);
    assert.equal(await readFile(curlCount, "utf8"), "x");
    assert.doesNotMatch(await readFile(curlArgs, "utf8"), /example\.invalid|backup-alert/);

    const receiptData = JSON.parse(await readFile(fixture.receipt, "utf8"));
    receiptData.uploadedAt = "2026-07-15T19:00:02.000Z";
    await writeFile(fixture.receipt, `${JSON.stringify(receiptData, null, 2)}\n`, { mode: 0o600 });
    const currentReceiptTime = new Date(receiptData.uploadedAt);
    await utimes(fixture.receipt, currentReceiptTime, currentReceiptTime);

    const recovered = spawnSync("bash", [wrapper], { env, encoding: "utf8" });

    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /03:00 异机数据库备份有效/);
    assert.equal(await readFile(curlCount, "utf8"), "xx");
    await assert.rejects(access(join(stateDir, "active-alert.sha256")));
  } finally {
    await removeFixture(fixture);
  }
});

test("wrapper does not expose SMTP credentials in the curl process arguments", async () => {
  const fixture = await createFixture("2026-07-14T19:00:02.000Z");
  const stateDir = join(fixture.root, "smtp-state");
  const fakeBin = join(fixture.root, "smtp-bin");
  const curlCount = join(fixture.root, "smtp-curl.count");
  const curlArgs = join(fixture.root, "smtp-curl.args");
  const wrapper = fileURLToPath(new URL("./check-production-db-backup.sh", import.meta.url));
  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, "curl"),
      "#!/bin/sh\nprintf x >> \"$FAKE_CURL_COUNT\"\nprintf '%s\\n' \"$*\" >> \"$FAKE_CURL_ARGS\"\ncat >/dev/null || true\nexit 0\n",
      { mode: 0o700 },
    );

    const result = spawnSync("bash", [wrapper], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...fixture.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DB_BACKUP_MONITOR_ALLOW_NON_ROOT: "true",
        DB_BACKUP_MONITOR_NOW: NOW.toISOString(),
        DB_BACKUP_MONITOR_STATE_DIR: stateDir,
        ALERT_EMAIL_TO: "ops@example.com",
        SMTP_USER: "ops@example.com",
        SMTP_PASSWORD: "smtp-secret-value",
        SMTP_URL: "smtps://smtp.example.invalid:465",
        FAKE_CURL_COUNT: curlCount,
        FAKE_CURL_ARGS: curlArgs,
      },
    });

    assert.equal(result.status, 1, result.stderr);
    const smtpCurlCount = await readFile(curlCount, "utf8").catch((error) => {
      assert.fail(`${error.message}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    });
    assert.equal(smtpCurlCount, "x");
    assert.doesNotMatch(
      await readFile(curlArgs, "utf8"),
      /smtp-secret-value|smtp\.example\.invalid|ops@example\.com:smtp/,
    );
  } finally {
    await removeFixture(fixture);
  }
});

test("systemd units reuse the existing alert environment and run persistently every 15 minutes", async () => {
  const service = await readFile(
    fileURLToPath(new URL("./systemd/jiangkong-db-backup-monitor.service", import.meta.url)),
    "utf8",
  );
  const timer = await readFile(
    fileURLToPath(new URL("./systemd/jiangkong-db-backup-monitor.timer", import.meta.url)),
    "utf8",
  );

  assert.match(service, /EnvironmentFile=-\/etc\/jiangkong\/healthcheck\.env/);
  assert.match(service, /StateDirectory=jiangkong-db-backup-monitor/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadOnlyPaths=-\/srv\/jiangkong-backups\/db/);
  assert.match(service, /DB_BACKUP_MONITOR_EXPECTED_BUCKET=jiangkong-prod-db-backups-1438687719/);
  assert.match(service, /DB_BACKUP_MONITOR_EXPECTED_REGION=ap-chengdu/);
  assert.doesNotMatch(service, /ConditionPathIsDirectory/);
  assert.doesNotMatch(service, /SECRET|PASSWORD=|SMTP_USER=/);
  assert.match(timer, /OnCalendar=\*-\*-\* \*:00\/15:00/);
  assert.match(timer, /Persistent=true/);
});
