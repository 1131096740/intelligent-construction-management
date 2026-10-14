#!/usr/bin/env node
import {parseCosXml,children,singleText} from './restricted-cos-xml.mjs';
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  open,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";

const REQUIRED_ENV_KEYS = [
  "FILE_STORAGE_DRIVER",
  "COS_BUCKET",
  "COS_REGION",
  "COS_SECRET_ID",
  "COS_SECRET_KEY"
];
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "../..");
const SCRIPT_RELATIVE_PATH = "scripts/ops/private-object-backup.mjs";

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function parseArgs(argv) {
  if (argv[0] !== "capture-and-verify") {
    fail("usage: private-object-backup.mjs capture-and-verify --inventory <file> --storage-env-file <file> --backup-root <dir> --restore-root <dir> --candidate-sha <sha> --confirm <confirmation>");
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail("private-object backup arguments must be flag/value pairs");
    const key = flag.slice(2);
    if (Object.hasOwn(values, key)) fail(`duplicate argument: ${flag}`);
    values[key] = value;
  }
  const expected = [
    "inventory",
    "storage-env-file",
    "backup-root",
    "restore-root",
    "candidate-sha",
    "confirm"
  ];
  if(values.scope!==undefined)expected.push("scope");
  if(values['storage-profile']!==undefined)expected.push('storage-profile','storage-env-sha256');
  if (Object.keys(values).sort().join("|") !== expected.sort().join("|")) {
    fail("capture-and-verify requires exactly the documented arguments");
  }
  return values;
}

async function assertSafeInputFile(path, label) {
  if (!isAbsolute(path)) fail(`${label} must be an absolute path`);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  if ((metadata.mode & 0o077) !== 0) fail(`${label} must not be accessible by group or others`);
  if (metadata.uid !== 0) fail(`${label} must be owned by root`);
}

function gitOutput(repositoryRoot, args) {
  try {
    return execFileSync("git", ["--no-optional-locks","-c","safe.directory="+repositoryRoot,"-c","core.fsmonitor=false","-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    fail("candidate repository identity could not be verified");
  }
}

export async function assertCandidateRepository(repositoryRoot, candidateSha, scriptRelativePath) {
  const canonicalRoot = await realpath(repositoryRoot).catch(() => null);
  if (!canonicalRoot || canonicalRoot !== repositoryRoot) fail("candidate repository root must be canonical");
  const topLevel = gitOutput(canonicalRoot, ["rev-parse", "--show-toplevel"]);
  if ((await realpath(topLevel).catch(() => null)) !== canonicalRoot) fail("candidate script is not inside the verified repository root");
  if (gitOutput(canonicalRoot, ["rev-parse", "HEAD"]) !== candidateSha) fail("candidate repository HEAD does not match the approved SHA");
  gitOutput(canonicalRoot, ["ls-files", "--error-unmatch", scriptRelativePath]);
  if (gitOutput(canonicalRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("candidate repository must be clean before private-object backup");
  }
}

async function prepareEmptyDirectory(path, label) {
  if (!isAbsolute(path)) fail(`${label} must be an absolute path`);
  const parent = dirname(path);
  const canonicalParent = await realpath(parent).catch(() => null);
  if (!canonicalParent) fail(`${label} parent must be an existing directory`);
  const canonicalTarget = join(canonicalParent, basename(path));
  const metadata = await lstat(canonicalTarget).catch(() => null);
  if (metadata) fail(`${label} must not already exist`);
  await mkdir(canonicalTarget, { mode: 0o700 });
  const canonicalPath = await realpath(canonicalTarget);
  if (canonicalPath !== canonicalTarget || !canonicalPath.startsWith(`${canonicalParent}${sep}`)) {
    fail(`${label} resolved outside its parent`);
  }
  return canonicalPath;
}

function parseEnvFile(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!REQUIRED_ENV_KEYS.includes(key)) continue;
    if (values.has(key)) fail(`environment file contains duplicate ${key}`);
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!value || /[\r\n]/u.test(value)) fail(`environment file contains invalid ${key}`);
    values.set(key, value);
  }
  for (const key of REQUIRED_ENV_KEYS) {
    if (!values.has(key)) fail(`environment file is missing ${key}`);
  }
  if (values.get("FILE_STORAGE_DRIVER") !== "cos") fail("private-object backup requires FILE_STORAGE_DRIVER=cos");
  return Object.fromEntries(values);
}

export function parseExistingBackupReaderEnv(text) {
  const required=['DB_BACKUP_COS_BUCKET','DB_BACKUP_COS_REGION','DB_BACKUP_COS_SECRET_ID','DB_BACKUP_COS_SECRET_KEY'];
  const allowed=new Set([...required,'DB_BACKUP_COS_PREFIX','DB_BACKUP_LOCAL_RETENTION_DAYS']);
  const values={};
  for(const raw of text.split(/\r?\n/u)){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;
    const match=line.match(/^(?:export\s+)?([A-Z_]+)=(.*)$/u);
    if(!match||!allowed.has(match[1])||Object.hasOwn(values,match[1]))fail('invalid backup reader configuration');
    let value=match[2];if(value.length>=2&&["'",'"'].includes(value[0])&&value.at(-1)===value[0])value=value.slice(1,-1);
    if(!value||/[\x00\r\n]/u.test(value))fail('invalid backup reader configuration');values[match[1]]=value;
  }
  if(required.some(key=>!values[key])||values.DB_BACKUP_COS_BUCKET!=='jiangkong-prod-db-backups-1438687719'||values.DB_BACKUP_COS_REGION!=='ap-chengdu')fail('invalid backup reader configuration');
  return {FILE_STORAGE_DRIVER:'cos',COS_BUCKET:'jiangkong-prod-files-1438687719',COS_REGION:'ap-chengdu',COS_SECRET_ID:values.DB_BACKUP_COS_SECRET_ID,COS_SECRET_KEY:values.DB_BACKUP_COS_SECRET_KEY};
}

async function readPinnedBackupReaderFile(path,expectedSha256) {
  if(path!=='/etc/jiangkong/db-backup.env'||!SHA256_PATTERN.test(expectedSha256??''))fail('exact existing backup reader source and digest required');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const pin=s=>[s.dev,s.ino,s.size,s.mode,s.uid,s.gid,s.nlink,s.mtimeMs,s.ctimeMs].join(':');
  try{
    const before=await fd.stat();
    if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&0o077)||before.size>65536)fail('private backup reader source required');
    const bytes=Buffer.alloc(before.size+1),read=await fd.read(bytes,0,bytes.length,0);
    const after=await fd.stat(),named=await lstat(path);
    if(read.bytesRead!==before.size||pin(before)!==pin(after)||pin(before)!==pin(named)||sha256(bytes.subarray(0,read.bytesRead))!==expectedSha256)fail('backup reader source changed');
    return {text:bytes.subarray(0,read.bytesRead).toString('utf8'),pin:pin(before)};
  }finally{await fd.close();}
}

export function validateInventory(value, configuredBucket) {
  if (!Array.isArray(value) || value.length === 0) fail("private-object inventory must be a non-empty JSON array");
  const identities = new Set();
  return value
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail("private-object inventory row must be an object");
      const keys = Object.keys(row).sort();
      const expected = ["bucket", "contentSha256", "id", "objectKey", "sizeBytes", "storageStatus"].sort();
      if (keys.join("|") !== expected.join("|")) fail("private-object inventory row fields are invalid");
      if (typeof row.id !== "string" || !row.id || identities.has(row.id)) fail("private-object inventory ids must be unique non-empty strings");
      identities.add(row.id);
      if (row.bucket !== configuredBucket) fail("private-object inventory bucket does not match the configured bucket");
      if (
        typeof row.objectKey !== "string" ||
        !row.objectKey ||
        /[\u0000-\u001f\u007f]/u.test(row.objectKey) ||
        row.objectKey.includes("\\") ||
        Buffer.byteLength(row.objectKey, "utf8") > 850 ||
        row.objectKey.split("/").some((segment) => !segment || segment === "." || segment === "..")
      ) {
        fail("private-object inventory contains an unsafe object key");
      }
      if (!Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0) fail("private-object inventory sizeBytes is invalid");
      if (!SHA256_PATTERN.test(row.contentSha256 ?? "")) fail("private-object inventory requires a lowercase SHA-256 for every row");
      if (typeof row.storageStatus !== "string" || !row.storageStatus) fail("private-object inventory storageStatus is invalid");
      return { ...row };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function xmlDecode(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "iu"));
  return match ? xmlDecode(match[1].trim()) : undefined;
}

function tagBlocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "giu"))].map((match) => match[1]);
}

function parseVersionListing(xml) {
  const document = xml.trim();
  let tree;try{tree=parseCosXml(document,"ListVersionsResult");}catch{fail("COS version listing is not a complete ListVersionsResult document or contains unsupported XML");}
  const root = document.match(
    /^(?:<\?xml\s+[\s\S]*?\?>\s*)?<ListVersionsResult(?:\s+[^>]*)?>([\s\S]*)<\/ListVersionsResult>$/iu
  );
  if (!root) fail("COS version listing is not a complete ListVersionsResult document");
  const truncatedValues = tagBlocks(root[1], "IsTruncated").map((value) => xmlDecode(value.trim()));
  if (truncatedValues.length !== 1 || !["true", "false"].includes(truncatedValues[0])) {
    fail("COS version listing requires exactly one true/false IsTruncated value");
  }
  return { body: root[1], tree, truncated: truncatedValues[0] === "true" };
}

function queryEntries(query) {
  return Object.entries(query)
    .map(([rawKey, rawValue]) => ({
      rawKey,
      encodedKey: encodeRfc3986(rawKey.toLowerCase()),
      encodedValue: rawValue === undefined ? "" : encodeRfc3986(rawValue)
    }))
    .sort((left, right) => left.encodedKey.localeCompare(right.encodedKey));
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeObjectPath(pathname) {
  if (pathname === "/") return "/";
  return pathname
    .split("/")
    .map(encodeRfc3986)
    .join("/");
}

export function requestUrl(endpoint, pathname, query) {
  const base = `${endpoint}${encodeObjectPath(pathname)}`;
  const parts = queryEntries(query).map(({ rawKey, encodedValue }) =>
    encodedValue === "" ? encodeRfc3986(rawKey) : `${encodeRfc3986(rawKey)}=${encodedValue}`
  );
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

export function authorization(method, pathname, host, query, secretId, secretKey, nowSeconds) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const keyTime = `${now};${now + 600}`;
  const entries = queryEntries(query);
  const urlParamList = entries.map((entry) => entry.encodedKey).join(";");
  const httpParameters = entries
    .map((entry) => `${entry.encodedKey}=${entry.encodedValue}`)
    .join("&");
  const httpString = [
    method.toLowerCase(),
    pathname,
    httpParameters,
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
    "q-header-list=host",
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`
  ].join("&");
}

function objectEndpoint(config) {
  return `https://${config.COS_BUCKET}.cos.${config.COS_REGION}.myqcloud.com`;
}

async function cosGet(config, pathname, query = {}, options={}) {
  const endpoint = objectEndpoint(config);
  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.host;
  let response;
  try {
    response = await fetch(requestUrl(endpoint, pathname, query), {
      method: "GET",
      headers: {
        Authorization: authorization("GET", pathname, host, query, config.COS_SECRET_ID, config.COS_SECRET_KEY),
        Host: host
      },
      signal: AbortSignal.timeout(options.timeoutMs??120_000)
    });
  } catch {
    fail("private-object read failed before an HTTP response was received");
  }
  if (!response.ok) fail(`private-object read failed with HTTP ${response.status}`);
  return response;
}

function optionalText(node,name){return children(node,name).length?singleText(node,name):undefined;}

export async function listVersions(config, objectKey, requester = cosGet) {
  const versions = [];
  const versionIdentities = new Set();
  const markerPairs = new Set();
  let keyMarker = "";
  let versionIdMarker = "";
  let hasPreviousPage = false;
  let truncated,pages=0;
  do {
    if(++pages>100)fail("COS version page limit");
    const query = { versions: undefined, "max-keys": "1000" };
    if(objectKey!==null)query.prefix=objectKey;
    if (hasPreviousPage) {
      query["key-marker"] = keyMarker;
      query["version-id-marker"] = versionIdMarker;
    }
    const xml = await (await requester(config, "/", query)).text();
    const listing = parseVersionListing(xml);
    const nested=(node)=>node.children.flatMap(child=>[child,...nested(child)]);
    const generations=nested(listing.tree).filter(n=>['Version','DeleteMarker'].includes(n.name));
    if(generations.some(n=>!listing.tree.children.includes(n)))fail("unexpected nested COS generation");
    for (const block of children(listing.tree, "Version")) {
      const key=singleText(block,"Key",false);
      if(objectKey!==null && key!==objectKey)continue;
      if(!key||/[\u0000-\u001f\u007f]/u.test(key)||key.includes("\\")||Buffer.byteLength(key)>850||key.split("/").some(part=>part==="."||part===".."))fail("COS version key invalid");
      const versionId = singleText(block, "VersionId");
      if (!versionId) fail("COS version listing omitted VersionId");
      if (versionIdentities.has(`version\0${key}\0${versionId}`)) fail("COS version listing repeated a generation");
      versionIdentities.add(`version\0${key}\0${versionId}`);
      versions.push({
        ...(objectKey===null?{objectKey:key}:{}),
        versionId,
        isDeleteMarker: false,
        isLatest: singleText(block, "IsLatest") === "true",
        lastModified: optionalText(block, "LastModified"),
        etag: optionalText(block, "ETag"),
        sizeBytes: Number(singleText(block, "Size"))
      });
    }
    for (const block of children(listing.tree, "DeleteMarker")) {
      const key=singleText(block,"Key",false);
      if(objectKey!==null && key!==objectKey)continue;
      if(!key||/[\u0000-\u001f\u007f]/u.test(key)||key.includes("\\")||Buffer.byteLength(key)>850||key.split("/").some(part=>part==="."||part===".."))fail("COS version key invalid");
      const versionId = singleText(block, "VersionId");
      if (!versionId) fail("COS delete-marker listing omitted VersionId");
      if (versionIdentities.has(`delete\0${key}\0${versionId}`)) fail("COS version listing repeated a generation");
      versionIdentities.add(`delete\0${key}\0${versionId}`);
      versions.push({
        ...(objectKey===null?{objectKey:key}:{}),
        versionId,
        isDeleteMarker: true,
        isLatest: singleText(block, "IsLatest") === "true",
        lastModified: optionalText(block, "LastModified")
      });
    }
    truncated = listing.truncated;
    if (truncated) {
      const nextKeyMarker = singleText(listing.tree, "NextKeyMarker",false);
      const nextVersionIdMarker = optionalText(listing.tree, "NextVersionIdMarker") ?? "";
      if (!nextKeyMarker) fail("truncated COS version listing omitted NextKeyMarker");
      const markerIdentity = `${nextKeyMarker}\0${nextVersionIdMarker}`;
      if (markerPairs.has(markerIdentity)) fail("COS version pagination did not advance");
      markerPairs.add(markerIdentity);
      keyMarker = nextKeyMarker;
      versionIdMarker = nextVersionIdMarker;
      hasPreviousPage = true;
    }
  } while (truncated);
  if(versions.length>100000)fail("COS generation limit");
  if (objectKey!==null && versions.length === 0) fail("private-object inventory key has no recoverable COS versions");
  if (objectKey!==null && versions.filter((version) => version.isLatest).length !== 1) fail("private-object key must have exactly one latest COS generation");
  return versions.sort((left, right) => left.versionId.localeCompare(right.versionId));
}

async function writeAtomic(path, body) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function capture(config, inventory, backupRoot, requester = cosGet, completeCatalogue=null) {
  const blobRoot = join(backupRoot, "blobs");
  await mkdir(blobRoot, { mode: 0o700 });
  const uniqueObjects = new Map();
  for (const row of inventory) {
    const identity = `${row.bucket}\0${row.objectKey}`;
    const existing = uniqueObjects.get(identity);
    if (existing && (existing.sizeBytes !== row.sizeBytes || existing.contentSha256 !== row.contentSha256)) {
      fail("duplicate private-object key has conflicting database metadata");
    }
    uniqueObjects.set(identity, row);
  }

  if(completeCatalogue){
    for(const version of completeCatalogue){
      if(!uniqueObjects.has(`${config.COS_BUCKET}\0${version.objectKey}`))uniqueObjects.set(`${config.COS_BUCKET}\0${version.objectKey}`,{bucket:config.COS_BUCKET,objectKey:version.objectKey});
    }
  }
  const objects = [];
  for (const row of [...uniqueObjects.values()].sort((left, right) => left.objectKey.localeCompare(right.objectKey))) {
    const versions = completeCatalogue?completeCatalogue.filter(v=>v.objectKey===row.objectKey).map(({objectKey,...v})=>v):await listVersions(config, row.objectKey, requester);
    if(!versions.length||versions.filter(v=>v.isLatest).length!==1)fail("Object latest generation incomplete");
    const capturedVersions = [];
    for (const version of versions) {
      if (version.isDeleteMarker) {
        capturedVersions.push(version);
        continue;
      }
      const response = await requester(config, `/${row.objectKey}`, { versionId: version.versionId });
      const bytes = Buffer.from(await response.arrayBuffer());
      if(!Number.isSafeInteger(version.sizeBytes)||version.sizeBytes<0||bytes.length!==version.sizeBytes)fail("COS generation size mismatch");
      const contentSha256 = sha256(bytes);
      const blobName = `${contentSha256}.blob`;
      const blobPath = join(blobRoot, blobName);
      const existingBlob = await lstat(blobPath).catch(() => null);
      if (existingBlob) {
        if (!existingBlob.isFile() || (await stat(blobPath)).size !== bytes.length) fail("content-addressed backup blob collision");
        const existingBytes = await readFile(blobPath);
        if (sha256(existingBytes) !== contentSha256) fail("content-addressed backup blob verification failed");
      } else {
        await writeAtomic(blobPath, bytes);
      }
      capturedVersions.push({ ...version, sizeBytes: bytes.length, contentSha256, blobName });
    }
    const verifiedVersions = completeCatalogue?versions:await listVersions(config, row.objectKey, requester);
    if (canonicalJson(verifiedVersions) !== canonicalJson(versions)) {
      fail("private-object version set changed during backup capture");
    }
    const latest = capturedVersions.find((version) => version.isLatest);
    if (!latest || (row.id!==undefined && latest.isDeleteMarker)) fail("active database FileObject points to a deleted latest COS generation");
    if (row.id!==undefined && (latest.sizeBytes !== row.sizeBytes || latest.contentSha256 !== row.contentSha256)) {
      fail("latest COS bytes do not match database size/hash metadata");
    }
    objects.push({
      bucket: row.bucket,
      objectKey: row.objectKey,
      databaseFileIds: inventory.filter((item) => item.bucket === row.bucket && item.objectKey === row.objectKey).map((item) => item.id).sort(),
      databaseStorageStatuses: [...new Set(inventory.filter((item) => item.bucket === row.bucket && item.objectKey === row.objectKey).map((item) => item.storageStatus))].sort(),
      versions: capturedVersions
    });
  }
  return objects;
}

// Full-bucket capture adds orphaned objects without fabricating FileObject rows.
// The isolated restore retains the complete generation/delete-marker manifest.
export async function captureCompleteBucket(config,inventory,backupRoot,requester=cosGet){
  config=structuredClone(config);inventory=validateInventory(inventory,config.COS_BUCKET);
  let requests=0,total=0;const start=Date.now();
  const bounded=async(c,path,query)=>{
    if(++requests>500||Date.now()-start>600000)fail("complete bucket capture limit");
    const response=await requester(c,path,query,{timeoutMs:Math.min(120000,600000-(Date.now()-start))});
    if(!response.ok)fail("complete bucket request refused");
    const listing=Object.hasOwn(query,'versions'),chunks=[];let size=0;
    for await(const chunk of response.body){
      size+=chunk.length;
      if(Date.now()-start>600000||size>(listing?4194304:134217728)||(!listing&&total+size>2147483648))fail("complete bucket byte/time limit");
      chunks.push(Buffer.from(chunk));
    }
    if(!listing)total+=size;
    return new Response(Buffer.concat(chunks));
  };
  const before=await listVersions(config,null,bounded);
  const objects=await capture(config,inventory,backupRoot,bounded,before);
  const after=await listVersions(config,null,bounded);
  if(canonicalJson(before)!==canonicalJson(after))fail("complete bucket generation set changed during capture");
  return objects;
}

export async function restoreAndVerify(manifest, backupRoot, restoreRoot) {
  const restoredBlobRoot = join(restoreRoot, "blobs");
  await mkdir(restoredBlobRoot, { mode: 0o700 });
  let restoredVersions = 0;
  for (const object of manifest.objects) {
    for (const version of object.versions) {
      if (version.isDeleteMarker) continue;
      const source = join(backupRoot, "blobs", version.blobName);
      const target = join(restoredBlobRoot, version.blobName);
      if (basename(source) !== version.blobName || basename(target) !== version.blobName) fail("backup manifest contains an unsafe blob name");
      const sourceMeta=await lstat(source);if(!sourceMeta.isFile()||sourceMeta.isSymbolicLink()||sourceMeta.nlink!==1)fail("unsafe backup blob");
      const bytes = await readFile(source);
      if (bytes.length !== version.sizeBytes || sha256(bytes) !== version.contentSha256) fail("backup blob verification failed before restore");
      const existing = await lstat(target).catch(() => null);
      if(existing&&(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1))fail("unsafe isolated restore target");
      if (!existing) await copyFile(source, target, 1);
      await chmod(target, 0o600);
      const restoredBytes = await readFile(target);
      if (restoredBytes.length !== version.sizeBytes || sha256(restoredBytes) !== version.contentSha256) fail("isolated private-object restore verification failed");
      restoredVersions += 1;
    }
  }
  await writeAtomic(join(restoreRoot,"private-object-backup-manifest.json"),`${canonicalJson(manifest)}\n`);
  return restoredVersions;
}

async function main() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    fail("private-object backup must run as root");
  }
  const args = parseArgs(process.argv.slice(2));
  const candidateSha = args["candidate-sha"];
  if (!SHA_PATTERN.test(candidateSha)) fail("candidate SHA must be a 40-character lowercase SHA");
  const requiredConfirmation = `CAPTURE_AND_VERIFY_PRIVATE_OBJECT_BACKUP_${candidateSha}`;
  if (args.confirm !== requiredConfirmation) fail("private-object backup confirmation does not match the exact candidate SHA");
  await assertCandidateRepository(REPOSITORY_ROOT, candidateSha, SCRIPT_RELATIVE_PATH);
  await assertSafeInputFile(args.inventory, "inventory file");
  await assertSafeInputFile(args["storage-env-file"], "environment file");
  if(args['storage-profile']!==undefined&&(args['storage-profile']!=='existing-backup-reader'||args.scope!=='complete-bucket'))fail('backup reader profile requires complete fixed business bucket capture');
  const readerSource=args['storage-profile']===undefined?null:await readPinnedBackupReaderFile(args['storage-env-file'],args['storage-env-sha256']);
  const config = readerSource?parseExistingBackupReaderEnv(readerSource.text):parseEnvFile(await readFile(args["storage-env-file"], "utf8"));
  const inventory = validateInventory(JSON.parse(await readFile(args.inventory, "utf8")), config.COS_BUCKET);
  const requestedBackupRoot = resolve(args["backup-root"]);
  const requestedRestoreRoot = resolve(args["restore-root"]);
  if (requestedBackupRoot === requestedRestoreRoot) fail("backup and restore roots must differ");
  for (const [path, label] of [
    [resolve(args.inventory), "inventory file"],
    [resolve(args["storage-env-file"]), "environment file"],
    [requestedBackupRoot, "backup root"],
    [requestedRestoreRoot, "restore root"]
  ]) {
    if (path === REPOSITORY_ROOT || path.startsWith(`${REPOSITORY_ROOT}${sep}`)) {
      fail(`${label} must be outside the candidate repository`);
    }
  }
  const backupRoot = await prepareEmptyDirectory(requestedBackupRoot, "backup root");
  const restoreRoot = await prepareEmptyDirectory(requestedRestoreRoot, "restore root");

  const capturedAt = new Date().toISOString();
  if(args.scope!==undefined&&args.scope!=="complete-bucket")fail("unsupported capture scope");
  const objects = args.scope==="complete-bucket"?await captureCompleteBucket(config,inventory,backupRoot):await capture(config, inventory, backupRoot);
  const manifest = {
    schemaVersion: 1,
    candidateSha,
    capturedAt,
    inventorySha256: sha256(canonicalJson(inventory)),
    captureScope:args.scope??"registered-objects",
    objects
  };
  const manifestBody = `${canonicalJson(manifest)}\n`;
  const manifestSha256 = sha256(manifestBody);
  await writeAtomic(join(backupRoot, "private-object-backup-manifest.json"), manifestBody);
  const restoredVersionCount = await restoreAndVerify(manifest, backupRoot, restoreRoot);
  if(readerSource&&(await readPinnedBackupReaderFile(args['storage-env-file'],args['storage-env-sha256'])).pin!==readerSource.pin)fail('backup reader source changed');
  const verifiedAt = new Date().toISOString();
  const receiptBody = {
    schemaVersion: 1,
    status: "passed",
    mode: "capture-and-verify",
    candidateSha,
    capturedAt,
    verifiedAt,
    sourceRecordCount: inventory.length,
    captureScope: args.scope??"registered-objects",
    uniqueObjectCount: objects.length,
    versionCount: objects.reduce((sum, object) => sum + object.versions.filter((version) => !version.isDeleteMarker).length, 0),
    deleteMarkerCount: objects.reduce((sum, object) => sum + object.versions.filter((version) => version.isDeleteMarker).length, 0),
    restoredVersionCount,
    restoreStatus: "passed",
    inventorySha256: manifest.inventorySha256,
    manifestSha256,
    productionWriteExecuted: false
  };
  const receiptSha256 = sha256(canonicalJson(receiptBody));
  const receipt = { ...receiptBody, receiptSha256 };
  await writeAtomic(
    join(backupRoot, "private-object-backup-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`Private-object backup failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
