import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  stat,
  symlink,
  truncate,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCosAuthorization,
  downloadAndVerify,
  loadBackupEnvFile,
  uploadAndVerify,
  validateCosConfig
} from "./cos-backup-transfer.mjs";

const config = {
  bucket: "jiangkong-prod-db-backups-1438687719",
  region: "ap-chengdu",
  secretId: "test-database-backup-secret-id",
  secretKey: "database-backup-secret-for-tests-only"
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("validates a dedicated COS configuration without exposing credentials", () => {
  assert.deepEqual(validateCosConfig(config), config);
  assert.throws(
    () => validateCosConfig({ ...config, bucket: "business-bucket" }),
    /bucket format/
  );
  assert.throws(
    () => validateCosConfig({ ...config, region: "https:\/\/example.com" }),
    /region format/
  );
});

test("loads only backup COS keys from a private non-symlink environment file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jiangkong-cos-env-"));
  const envFile = join(directory, "db-backup.env");
  await writeFile(
    envFile,
    [
      `DB_BACKUP_COS_SECRET_ID=${config.secretId}`,
      `DB_BACKUP_COS_SECRET_KEY='${config.secretKey}'`,
      `DB_BACKUP_COS_BUCKET=${config.bucket}`,
      `DB_BACKUP_COS_REGION=${config.region}`,
      "DB_BACKUP_COS_PREFIX=database-backups",
      "DB_BACKUP_LOCAL_RETENTION_DAYS=7"
    ].join("\n"),
    { mode: 0o600 }
  );

  const loaded = await loadBackupEnvFile(envFile);
  assert.equal(loaded.DB_BACKUP_COS_SECRET_ID, config.secretId);
  assert.equal(loaded.DB_BACKUP_COS_SECRET_KEY, config.secretKey);
  assert.equal(loaded.DB_BACKUP_COS_BUCKET, config.bucket);

  const marker = join(directory, "should-not-run");
  await writeFile(envFile, `UNSUPPORTED_COMMAND=$(touch ${marker})\n`, { mode: 0o600 });
  await assert.rejects(loadBackupEnvFile(envFile), /unsupported key/);
  await assert.rejects(access(marker));

  await chmod(envFile, 0o644);
  await assert.rejects(loadBackupEnvFile(envFile), /group or other permissions/);

  const link = join(directory, "db-backup-link.env");
  await symlink(envFile, link);
  await assert.rejects(loadBackupEnvFile(link), /regular non-symlink/);
});

test("creates a deterministic host-only COS authorization", () => {
  const authorization = createCosAuthorization({
    method: "PUT",
    canonicalPath: "/database-backups/2026/07/15/jiangkong.dump",
    host: "jiangkong-prod-db-backups-1438687719.cos.ap-chengdu.myqcloud.com",
    secretId: config.secretId,
    secretKey: config.secretKey,
    nowSeconds: 1_700_000_000
  });

  assert.match(authorization, /^q-sign-algorithm=sha1&q-ak=test-database-backup/);
  assert.match(authorization, /q-header-list=host/);
  assert.match(authorization, /q-signature=[0-9a-f]{40}$/);
  assert.equal(authorization.includes(config.secretKey), false);
});

test("uploads a backup and verifies remote length and SHA metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jiangkong-cos-upload-"));
  const file = join(directory, "jiangkong.dump");
  const contents = Buffer.from("verified-custom-dump");
  await writeFile(file, contents, { mode: 0o600 });
  const digest = sha256(contents);
  const calls = [];

  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === "PUT") return new Response(null, { status: 200 });
    if (init.method === "GET") return new Response(contents, { status: 200 });
    return new Response(null, {
      status: 200,
      headers: {
        "content-length": String(contents.length),
        "x-cos-meta-sha256": digest,
        "x-cos-server-side-encryption": "AES256",
        "x-cos-request-id": "request-head-1"
      }
    });
  };

  const result = await uploadAndVerify({
    config,
    file,
    objectKey: "database-backups/2026/07/15/jiangkong.dump",
    expectedSha256: digest,
    fetchImpl,
    nowSeconds: 1_700_000_000
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ init }) => init.method), ["PUT", "HEAD", "GET"]);
  assert.equal(calls[0].init.headers["x-cos-meta-sha256"], digest);
  assert.equal(calls[0].init.headers["content-length"], String(contents.length));
  assert.equal(
    calls[0].init.headers["content-md5"],
    createHash("md5").update(contents).digest("base64")
  );
  assert.equal(calls[0].init.headers["x-cos-server-side-encryption"], "AES256");
  assert.equal(calls.every(({ init }) => init.redirect === "error"), true);
  assert.equal(calls.every(({ init }) => init.signal instanceof AbortSignal), true);
  assert.equal(calls[0].init.headers.Authorization.includes(config.secretKey), false);
  assert.deepEqual(result, {
    bucket: config.bucket,
    region: config.region,
    objectKey: "database-backups/2026/07/15/jiangkong.dump",
    size: contents.length,
    sha256: digest,
    requestId: "request-head-1"
  });
});

test("fails closed when COS HEAD metadata does not match the local backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jiangkong-cos-mismatch-"));
  const file = join(directory, "jiangkong.dump");
  const contents = Buffer.from("verified-custom-dump");
  await writeFile(file, contents, { mode: 0o600 });
  const digest = sha256(contents);

  await assert.rejects(
    uploadAndVerify({
      config,
      file,
      objectKey: "database-backups/2026/07/15/jiangkong.dump",
      expectedSha256: digest,
      fetchImpl: async (_url, init) =>
        init.method === "PUT"
          ? new Response(null, { status: 200 })
          : new Response(null, {
              status: 200,
              headers: {
                "content-length": String(contents.length + 1),
                "x-cos-meta-sha256": digest
              }
            }),
      nowSeconds: 1_700_000_000
    }),
    /remote object verification failed/
  );
});

test("rejects files larger than the COS simple PUT limit before reading or uploading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jiangkong-cos-too-large-"));
  const file = join(directory, "too-large.dump");
  await writeFile(file, "x", { mode: 0o600 });
  await truncate(file, 5 * 1024 * 1024 * 1024 + 1);
  let requested = false;

  await assert.rejects(
    uploadAndVerify({
      config,
      file,
      objectKey: "database-backups/2026/07/15/too-large.dump",
      expectedSha256: "0".repeat(64),
      fetchImpl: async () => {
        requested = true;
        return new Response(null, { status: 200 });
      }
    }),
    /5 GiB/
  );
  assert.equal(requested, false);
  await unlink(file);
});

test("downloads a remote backup atomically and verifies SHA-256", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jiangkong-cos-download-"));
  const destination = join(directory, "restored.dump");
  const contents = Buffer.from("downloaded-custom-dump");
  const digest = sha256(contents);

  const result = await downloadAndVerify({
    config,
    destination,
    objectKey: "database-backups/2026/07/15/jiangkong.dump",
    expectedSha256: digest,
    fetchImpl: async () => new Response(contents, { status: 200 }),
    nowSeconds: 1_700_000_000
  });

  assert.equal((await readFile(destination)).toString(), contents.toString());
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.equal(result.sha256, digest);
  assert.equal(result.size, contents.length);

  await assert.rejects(
    downloadAndVerify({
      config,
      destination,
      objectKey: "database-backups/2026/07/15/jiangkong.dump",
      expectedSha256: digest,
      fetchImpl: async () => new Response(contents, { status: 200 })
    }),
    /destination already exists/
  );
});
