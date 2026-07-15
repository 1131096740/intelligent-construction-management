#!/usr/bin/env node

import { createHash, createHmac, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BUCKET_PATTERN = /^([a-z0-9]|[a-z0-9][a-z0-9-]{0,48}[a-z0-9])-([1-9]\d*)$/;
const REGION_PATTERN = /^[a-z]{2,}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;
const COS_SIMPLE_PUT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const COS_REQUEST_TIMEOUT_MS = 120_000;

export function validateCosConfig(input) {
  const config = {
    bucket: input?.bucket,
    region: input?.region,
    secretId: input?.secretId,
    secretKey: input?.secretKey
  };
  if (typeof config.bucket !== "string" || !BUCKET_PATTERN.test(config.bucket)) {
    throw new Error("invalid COS bucket format");
  }
  if (typeof config.region !== "string" || !REGION_PATTERN.test(config.region)) {
    throw new Error("invalid COS region format");
  }
  if (typeof config.secretId !== "string" || config.secretId.length < 16) {
    throw new Error("COS secret id is missing or too short");
  }
  if (typeof config.secretKey !== "string" || config.secretKey.length < 16) {
    throw new Error("COS secret key is missing or too short");
  }
  return config;
}

export function validateObjectKey(objectKey) {
  if (typeof objectKey !== "string" || !OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new Error("invalid COS object key format");
  }
  const segments = objectKey.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("invalid COS object key path");
  }
  return objectKey;
}

export async function loadBackupEnvFile(envFile) {
  if (typeof envFile !== "string" || !isAbsolute(envFile)) {
    throw new Error("backup environment file must use an absolute path");
  }
  const info = await lstat(envFile);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("backup environment file must be a regular non-symlink file");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error("backup environment file must not grant group or other permissions");
  }
  if (typeof process.geteuid === "function" && info.uid !== process.geteuid()) {
    throw new Error("backup environment file must be owned by the current process user");
  }

  const allowedKeys = new Set([
    "DB_BACKUP_COS_SECRET_ID",
    "DB_BACKUP_COS_SECRET_KEY",
    "DB_BACKUP_COS_BUCKET",
    "DB_BACKUP_COS_REGION",
    "DB_BACKUP_COS_PREFIX",
    "DB_BACKUP_LOCAL_RETENTION_DAYS"
  ]);
  const values = {};
  const lines = (await readFile(envFile, "utf8")).split(/\r?\n/);
  for (const rawLine of lines) {
    if (rawLine === "" || rawLine.startsWith("#")) continue;
    const line = rawLine.startsWith("export ") ? rawLine.slice(7) : rawLine;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("backup environment file contains an invalid line");
    const key = line.slice(0, separator);
    if (!allowedKeys.has(key)) {
      throw new Error(`backup environment file contains unsupported key: ${key}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`backup environment file contains duplicate key: ${key}`);
    }
    let value = line.slice(separator + 1);
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || value.at(-1) !== quote) {
        throw new Error(`backup environment file contains invalid quotes for ${key}`);
      }
      value = value.slice(1, -1);
    }
    if (!value) throw new Error(`backup environment file contains an empty value for ${key}`);
    values[key] = value;
  }
  return values;
}

export function createCosAuthorization({
  method,
  canonicalPath,
  host,
  secretId,
  secretKey,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  const keyTime = `${nowSeconds};${nowSeconds + 600}`;
  const headerList = "host";
  const httpString = [
    method.toLowerCase(),
    canonicalPath,
    "",
    `host=${encodeURIComponent(host)}`,
    ""
  ].join("\n");
  const stringToSign = [
    "sha1",
    keyTime,
    createHash("sha1").update(httpString).digest("hex"),
    ""
  ].join("\n");
  const signKey = createHmac("sha1", secretKey).update(keyTime).digest("hex");
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`
  ].join("&");
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileDigests(file) {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  for await (const chunk of createReadStream(file)) {
    sha256.update(chunk);
    md5.update(chunk);
  }
  return {
    sha256: sha256.digest("hex"),
    md5: md5.digest("base64")
  };
}

function requestTarget(config, objectKey) {
  const validated = validateCosConfig(config);
  const safeObjectKey = validateObjectKey(objectKey);
  const host = `${validated.bucket}.cos.${validated.region}.myqcloud.com`;
  const canonicalPath = `/${safeObjectKey}`;
  return {
    config: validated,
    host,
    canonicalPath,
    url: `https://${host}${encodeURI(canonicalPath)}`
  };
}

function authorizationHeaders(target, method, nowSeconds) {
  return {
    Authorization: createCosAuthorization({
      method,
      canonicalPath: target.canonicalPath,
      host: target.host,
      secretId: target.config.secretId,
      secretKey: target.config.secretKey,
      nowSeconds
    }),
    Host: target.host
  };
}

async function checkedFetch({ target, method, headers = {}, body, fetchImpl, nowSeconds }) {
  let response;
  try {
    response = await fetchImpl(target.url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(COS_REQUEST_TIMEOUT_MS),
      headers: {
        ...authorizationHeaders(target, method, nowSeconds),
        ...headers
      },
      body,
      ...(body ? { duplex: "half" } : {})
    });
  } catch {
    throw new Error(`COS ${method} request failed during transport`);
  }
  if (!response.ok) {
    const requestId = response.headers.get("x-cos-request-id") || "unavailable";
    throw new Error(`COS ${method} request failed with status ${response.status}, request ${requestId}`);
  }
  return response;
}

async function hashResponse(response) {
  if (!response.body) throw new Error("COS response body is missing");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

export async function uploadAndVerify({
  config,
  file,
  objectKey,
  expectedSha256,
  fetchImpl = fetch,
  nowSeconds
}) {
  if (!SHA256_PATTERN.test(expectedSha256)) throw new Error("expected SHA-256 is invalid");
  const target = requestTarget(config, objectKey);
  const before = await stat(file);
  if (!before.isFile() || before.size <= 0) throw new Error("backup file is missing or empty");
  if (before.size > COS_SIMPLE_PUT_MAX_BYTES) {
    throw new Error("backup file exceeds the COS simple PUT limit of 5 GiB");
  }
  const localDigests = await fileDigests(file);
  if (localDigests.sha256 !== expectedSha256) {
    throw new Error("local backup SHA-256 does not match");
  }

  await checkedFetch({
    target,
    method: "PUT",
    headers: {
      "content-length": String(before.size),
      "content-md5": localDigests.md5,
      "content-type": "application/octet-stream",
      "x-cos-meta-sha256": expectedSha256,
      "x-cos-server-side-encryption": "AES256"
    },
    body: createReadStream(file),
    fetchImpl,
    nowSeconds
  });

  const after = await stat(file);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error("local backup changed while it was being uploaded");
  }

  const head = await checkedFetch({
    target,
    method: "HEAD",
    fetchImpl,
    nowSeconds
  });
  const remoteLength = Number(head.headers.get("content-length"));
  const remoteSha256 = head.headers.get("x-cos-meta-sha256");
  const remoteEncryption = head.headers.get("x-cos-server-side-encryption");
  if (
    remoteLength !== before.size ||
    remoteSha256 !== expectedSha256 ||
    remoteEncryption !== "AES256"
  ) {
    throw new Error("remote object verification failed: size, SHA metadata, or encryption mismatch");
  }

  const remoteCopy = await checkedFetch({
    target,
    method: "GET",
    fetchImpl,
    nowSeconds
  });
  const downloaded = await hashResponse(remoteCopy);
  if (downloaded.size !== before.size || downloaded.sha256 !== expectedSha256) {
    throw new Error("remote object verification failed: downloaded content mismatch");
  }

  return {
    bucket: target.config.bucket,
    region: target.config.region,
    objectKey: validateObjectKey(objectKey),
    size: before.size,
    sha256: expectedSha256,
    requestId: head.headers.get("x-cos-request-id") || "unavailable"
  };
}

export async function downloadAndVerify({
  config,
  destination,
  objectKey,
  expectedSha256,
  fetchImpl = fetch,
  nowSeconds
}) {
  if (!SHA256_PATTERN.test(expectedSha256)) throw new Error("expected SHA-256 is invalid");
  const parent = await stat(dirname(destination));
  if (!parent.isDirectory()) throw new Error("download destination directory does not exist");
  try {
    await lstat(destination);
    throw new Error("download destination already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const target = requestTarget(config, objectKey);
  const response = await checkedFetch({
    target,
    method: "GET",
    fetchImpl,
    nowSeconds
  });
  if (!response.body) throw new Error("COS response body is missing");

  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.partial`);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 })
    );
    const downloaded = await stat(temporary);
    const downloadedSha256 = await sha256File(temporary);
    if (downloaded.size <= 0 || downloadedSha256 !== expectedSha256) {
      throw new Error("downloaded backup SHA-256 does not match");
    }
    await link(temporary, destination);
    await unlink(temporary);
    return {
      bucket: target.config.bucket,
      region: target.config.region,
      objectKey: validateObjectKey(objectKey),
      destination,
      size: downloaded.size,
      sha256: downloadedSha256
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  if (action !== "upload" && action !== "download") {
    throw new Error("usage: cos-backup-transfer.mjs <upload|download> --file PATH --object-key KEY --sha256 HASH [--env-file PATH]");
  }
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("invalid command arguments");
    if (
      flag !== "--file" &&
      flag !== "--object-key" &&
      flag !== "--sha256" &&
      flag !== "--env-file"
    ) {
      throw new Error(`unsupported argument ${flag}`);
    }
    if (values[flag]) throw new Error(`duplicate argument ${flag}`);
    values[flag] = value;
  }
  for (const required of ["--file", "--object-key", "--sha256"]) {
    if (!values[required]) throw new Error(`missing argument ${required}`);
  }
  return {
    action,
    file: values["--file"],
    objectKey: values["--object-key"],
    expectedSha256: values["--sha256"],
    envFile: values["--env-file"]
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const fileEnvironment = args.envFile ? await loadBackupEnvFile(args.envFile) : {};
  const environment = { ...process.env, ...fileEnvironment };
  const config = validateCosConfig({
    bucket: environment.DB_BACKUP_COS_BUCKET,
    region: environment.DB_BACKUP_COS_REGION,
    secretId: environment.DB_BACKUP_COS_SECRET_ID,
    secretKey: environment.DB_BACKUP_COS_SECRET_KEY
  });
  const result =
    args.action === "upload"
      ? await uploadAndVerify({
          config,
          file: args.file,
          objectKey: args.objectKey,
          expectedSha256: args.expectedSha256
        })
      : await downloadAndVerify({
          config,
          destination: args.file,
          objectKey: args.objectKey,
          expectedSha256: args.expectedSha256
        });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`COS backup transfer failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
