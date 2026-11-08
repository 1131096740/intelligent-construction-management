"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../../..");
const TREE_ROOTS = ["node_modules", "services/api/node_modules", "packages/shared-domain/node_modules", "services/api/dist", "packages/shared-domain/dist"];
const TOOL_NAMES = ["docker", "git", "node", "openssl", "pnpm", "python"];
const ENGINE = "605197351a3c8bdd595af2d2a9bc3025bca48ea2";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const need = (condition, code) => { if (!condition) fail(code); };

// Every filesystem content read uses the same qualified descriptor strategy.
// O_NONBLOCK prevents a raced-in FIFO from blocking open; fstat rejects it
// before read. Fixed-position reads stop at the witnessed size plus one byte.
function qualifiedFile(file, { maxBytes, privateFile = false, executable = false, collect = false, expectedIdentity, code }) {
  let fd;
  try {
    need(typeof file === "string" && path.isAbsolute(file) && path.normalize(file) === file && fs.realpathSync(file) === file, code);
    if (privateFile) need(file.startsWith("/private/tmp/"), code);
    let current = path.parse(file).root;
    for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part); need(!fs.lstatSync(current).isSymbolicLink(), code);
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    need(before.isFile() && Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maxBytes, code);
    need(privateFile ? before.uid === process.getuid() && (before.mode & 0o077) === 0 : [0, process.getuid()].includes(before.uid) && (before.mode & 0o022) === 0, code);
    if (executable) { need((before.mode & 0o111) !== 0, code); fs.accessSync(file, fs.constants.X_OK); }
    const fields = ["dev", "ino", "size", "mode", "uid", "gid", "mtimeMs", "ctimeMs"];
    if (expectedIdentity) need(fields.every(key => before[key] === expectedIdentity[key]), code);
    const digest = createHash("sha256"), chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024); let total = 0;
    while (total < before.size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, before.size - total), total);
      need(count > 0, code); digest.update(buffer.subarray(0, count));
      if (collect) chunks.push(Buffer.from(buffer.subarray(0, count)));
      total += count;
    }
    need(fs.readSync(fd, buffer, 0, 1, total) === 0, code);
    const after = fs.fstatSync(fd), named = fs.lstatSync(file);
    need(fields.every(key => before[key] === after[key]) && named.isFile() && !named.isSymbolicLink() && named.dev === before.dev && named.ino === before.ino && fs.realpathSync(file) === file, code);
    return { sha256: digest.digest("hex"), bytes: collect ? Buffer.concat(chunks, total) : undefined,
      identity: Object.fromEntries(fields.map(key => [key, before[key]])) };
  } catch { fail(code); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function privateBytes(file, maxBytes = 16 * 1024 * 1024) {
  return qualifiedFile(file, { maxBytes, privateFile: true, collect: true, code: "TASK16_RUNTIME_INPUT_FILE" }).bytes;
}
function privateJson(file, maxBytes) { return JSON.parse(privateBytes(file, maxBytes).toString("utf8")); }
function privateHash(file, maxBytes = 16 * 1024 * 1024) {
  return qualifiedFile(file, { maxBytes, privateFile: true, code: "TASK16_RUNTIME_INPUT_FILE" }).sha256;
}
function sourceBytes(file, maxBytes = 16384) {
  return qualifiedFile(file, { maxBytes, collect: true, code: "TASK16_RUNTIME_SOURCE_FILE" }).bytes;
}
function sourceHash(file) {
  return qualifiedFile(file, { maxBytes: 64 * 1024 * 1024, code: "TASK16_RUNTIME_SOURCE_FILE" }).sha256;
}
function toolFile(file, expectedIdentity) {
  return qualifiedFile(file, { maxBytes: 512 * 1024 * 1024, executable: true, expectedIdentity, code: "TASK16_RUNTIME_TOOL_CHANGED" });
}
function inside(root, target) { const rel = path.relative(root, target); return rel === "" || !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`); }

function normalizeTask16FixtureDates(value) {
  need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='openingDate,paidAt','TASK16_RUNTIME_FIXTURE_DATES');
  for(const name of ['paidAt','openingDate']){const date=value[name];need(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(date)&&date.slice(0,4)!=='0000','TASK16_RUNTIME_FIXTURE_DATES');const parsed=new Date(date+'T00:00:00.000Z');need(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date,'TASK16_RUNTIME_FIXTURE_DATES');}
  need(value.paidAt>=value.openingDate,'TASK16_RUNTIME_FIXTURE_DATES');return {paidAt:value.paidAt,openingDate:value.openingDate};
}
function verifyTask16RuntimeInputs(options, injectedCommand) {
  const inputCapture=qualifiedFile(options.inputsFile,{maxBytes:16*1024*1024,privateFile:true,collect:true,code:'TASK16_RUNTIME_INPUT_FILE'});
  const bytes=inputCapture.bytes;
  need(sha(bytes) === options.expectedInputsSha256, "TASK16_RUNTIME_INPUT_DIGEST");
  const inputs = JSON.parse(bytes.toString("utf8"));
  const fixtureDates=inputs.fixtureDates===undefined?undefined:normalizeTask16FixtureDates(inputs.fixtureDates);
  need(inputs.schemaVersion === 1 && inputs.purpose === "task16-runtime-inputs-not-approval" && inputs.candidateRoot === ROOT && fs.realpathSync(ROOT) === ROOT && inputs.nodeVersion === process.version && inputs.prismaClientVersion === "5.22.0" && inputs.prismaEngineVersion === ENGINE, "TASK16_RUNTIME_INPUT_BINDING");
  need(typeof inputs.authorizationReference === "string" && inputs.authorizationReference.trim().length > 0 && inputs.authorizationReference.length <= 1024, "TASK16_RUNTIME_REFERENCE_REQUIRED");
  need(inputs.tools && Object.keys(inputs.tools).sort().join(",") === TOOL_NAMES.join(","), "TASK16_RUNTIME_TOOLS");
  const tools = {}, toolIdentities = {};
  for (const name of TOOL_NAMES) {
    const tool = inputs.tools[name];
    need(tool && typeof tool.path === "string" && /^[a-f0-9]{64}$/u.test(tool.sha256), "TASK16_RUNTIME_TOOL_CHANGED");
    const captured = toolFile(tool.path);
    need(captured.sha256 === tool.sha256, "TASK16_RUNTIME_TOOL_CHANGED");
    toolIdentities[name] = captured.identity; tools[name] = tool.path;
  }
  need(tools.node === fs.realpathSync(process.execPath) && tools.git === fs.realpathSync("/usr/bin/git") && path.basename(tools.docker) === "docker" && path.basename(tools.openssl) === "openssl", "TASK16_RUNTIME_TOOL_IDENTITY");
  const command = injectedCommand ?? ((exe, args, control) => execFileSync(exe, args, control));
  need(typeof command === "function", "TASK16_RUNTIME_COMMAND_ADAPTER");
  const deadline = Date.now() + 300000;
  const execute = (exe, args) => {
    const remaining = deadline - Date.now(); need(remaining > 0, "TASK16_RUNTIME_DEADLINE");
    return command(exe, args, { cwd: ROOT, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: Math.min(120000, remaining), maxBuffer: 1024 * 1024 });
  };
  const verified = JSON.parse(execute(tools.node, [path.join(ROOT, "scripts/prepare-task16-registered-pg.cjs"), "--verify", "--packet", options.packetFile, "--expected-sha256", options.expectedPacketSha256]));
  need(verified.status === "SOURCE_ONLY_VERIFIED_NOT_EXECUTED" && verified.packetSha256 === options.expectedPacketSha256 && verified.executionAllowed === false, "TASK16_RUNTIME_SOURCE_NOT_VERIFIED");
  const packetBytes = privateBytes(options.packetFile);
  need(sha(packetBytes) === options.expectedPacketSha256, "TASK16_RUNTIME_PACKET_CHANGED");
  const packet = JSON.parse(packetBytes.toString("utf8"));
  need(packet.source?.repo === ROOT && packet.candidateSha === inputs.sourceSha && packet.candidateSha === verified.candidateSha && packet.sealSha256 === verified.sealSha256, "TASK16_RUNTIME_SOURCE_ROOT_MISMATCH");
  for (const relative of ["services/api/prisma/run-task16-registered-pg-local.cjs", "services/api/prisma/task16-runtime-inputs.cjs", "services/api/prisma/task16-baseline-migrations.cjs", "services/api/prisma/task16-baseline-access.cjs", "services/api/prisma/task16-baseline-access.json", "services/api/prisma/task16-baseline-access.sql", "services/api/prisma/task16-bounded-command.cjs", "services/api/prisma/task16-owner-tls.cjs", "services/api/prisma/task16-owner-probe.cjs", "services/api/prisma/enterprise-task01-resources.cjs", "services/api/prisma/task16-registered-sql-installer.cjs", "services/api/prisma/task16-prepared-install-stage.cjs", "services/api/prisma/task16-registered-object-witness.cjs", "services/api/prisma/task16-registered-access.cjs", "services/api/prisma/task16-registered-access.json", "services/api/prisma/task16-registered-access.sql", "services/api/prisma/task16-registered-access-check.cjs", "services/api/prisma/task16-registered-access-check.sql", "services/api/prisma/task16-client-loader.cjs", "services/api/prisma/task16-restricted-clients.cjs", "scripts/prepare-task16-registered-pg.cjs", "scripts/ops/runtime-manifest.py"]) {
    const member = packet.source.files.find(row => row.path === relative);
    need(member && member.sha256 === sourceHash(path.join(ROOT, relative)), "TASK16_RUNTIME_ADAPTER_NOT_IN_CANDIDATE");
  }
  const gitFile = path.join(ROOT, ".git");
  need(fs.lstatSync(gitFile).isFile() && !fs.lstatSync(gitFile).isSymbolicLink(), "TASK16_RUNTIME_WORKTREE_REQUIRED");
  const gitFileBytes = sourceBytes(gitFile);
  const pointer = /^gitdir: (.+)\n?$/u.exec(gitFileBytes.toString("utf8")); need(pointer, "TASK16_RUNTIME_WORKTREE_IDENTITY");
  const gitDir = fs.realpathSync(path.resolve(ROOT, pointer[1].trim()));
  need(sourceBytes(path.join(gitDir, "gitdir")).toString("utf8").trim() === gitFile, "TASK16_RUNTIME_WORKTREE_IDENTITY");
  const preparationBytes = privateBytes(inputs.preparationReceipt?.path);
  const preparation = JSON.parse(preparationBytes.toString("utf8"));
  need(sha(preparationBytes) === inputs.preparationReceipt.sha256 && preparation.schemaVersion === 1 && preparation.purpose === "witnessed-fresh-task16-build-ownership-not-approval" && preparation.sourceSha === packet.candidateSha && preparation.candidateRoot === ROOT && preparation.worktreeGitDir === gitDir && preparation.worktreeGitFileSha256 === sha(gitFileBytes) && JSON.stringify(preparation.buildSteps) === JSON.stringify(["shared-domain:build", "api:build"]), "TASK16_RUNTIME_OUTPUT_OWNERSHIP");
  need(Array.isArray(inputs.trees) && inputs.trees.length === TREE_ROOTS.length && new Set(inputs.trees.map(tree => tree.root)).size === TREE_ROOTS.length && inputs.trees.every(tree => TREE_ROOTS.includes(tree.root)), "TASK16_RUNTIME_TREES");
  const sourceMembers = new Map(packet.source.files.map(row => [row.path, row]));
  const sealedDirectories = new Set();
  let visitedTargets = 0;
  function requireSealedTarget(target) {
    need(inside(ROOT, target), "TASK16_RUNTIME_LINK_ESCAPES_CANDIDATE");
    if (TREE_ROOTS.some(relative => inside(path.join(ROOT, relative), target))) return;
    need(++visitedTargets <= 20000, "TASK16_RUNTIME_LINK_TARGET_BUDGET");
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return requireSealedTarget(fs.realpathSync(target));
    if (stat.isDirectory()) {
      if (sealedDirectories.has(target)) return;
      sealedDirectories.add(target);
      for (const name of fs.readdirSync(target)) requireSealedTarget(path.join(target, name));
      return;
    }
    const member = sourceMembers.get(path.relative(ROOT, target).split(path.sep).join("/"));
    need(stat.isFile() && member && member.sha256 === sourceHash(target), "TASK16_RUNTIME_LINK_TARGET_UNSEALED");
  }
  const manifests = [];
  for (const relative of TREE_ROOTS) {
    const tree = inputs.trees.find(item => item.root === relative);
    need(tree, "TASK16_RUNTIME_MANIFEST_CHANGED");
    const manifestBytes = privateBytes(tree.manifest, 64 * 1024 * 1024);
    need(sha(manifestBytes) === tree.sha256, "TASK16_RUNTIME_MANIFEST_CHANGED");
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const actualRoot = path.join(ROOT, relative);
    need(manifest.schemaVersion === 1 && manifest.status === "captured" && manifest.root === actualRoot && fs.realpathSync(actualRoot) === actualRoot && fs.lstatSync(actualRoot).isDirectory(), "TASK16_RUNTIME_TREE_ROOT");
    for (const [entryPath, entry] of Object.entries(manifest.entries ?? {})) {
      need(entryPath === "." || !path.isAbsolute(entryPath) && entryPath.split(path.sep).every(part => part && part !== "." && part !== ".."), "TASK16_RUNTIME_ENTRY_PATH");
      if (entry.kind !== "link") continue;
      requireSealedTarget(fs.realpathSync(path.join(actualRoot, entryPath)));
    }
    if (relative.endsWith("/dist")) {
      const owned = preparation.outputs?.find(row => row.root === relative);
      need(owned?.originallyAbsent === true && owned.preparedManifestSha256 === tree.sha256, "TASK16_RUNTIME_OUTPUT_OWNERSHIP");
    }
    manifests.push({ tree, actualRoot });
  }
  need(preparation.outputs?.length === 2, "TASK16_RUNTIME_OUTPUT_OWNERSHIP");
  const parent = path.dirname(options.artifactsDir);
  need(fs.realpathSync(parent) === parent && fs.lstatSync(parent).uid === process.getuid() && (fs.statSync(parent).mode & 0o077) === 0 && !fs.existsSync(options.artifactsDir) && !inside(ROOT, options.artifactsDir), "TASK16_RUNTIME_ARTIFACTS");
  fs.mkdirSync(options.artifactsDir, { mode: 0o700 });
  function compareTrees(phase) {
    for (let index = 0; index < manifests.length; index++) {
      const { tree, actualRoot } = manifests[index];
      const actualManifest = path.join(options.artifactsDir, `runtime-${phase}-${index}.actual.json`);
      const receiptFile = path.join(options.artifactsDir, `runtime-${phase}-${index}.comparison.json`);
      const result = JSON.parse(execute(tools.python, [path.join(ROOT, "scripts/ops/runtime-manifest.py"), "compare", "--expected", tree.manifest, "--root", actualRoot, "--actual-manifest", actualManifest, "--receipt", receiptFile]));
      const receipt = privateJson(receiptFile);
      need(result.status === "passed" && receipt.status === "passed" && Array.isArray(receipt.differences) && receipt.differences.length === 0 && receipt.expectedManifest === tree.manifest && receipt.actualManifest === actualManifest && receipt.root === actualRoot && privateHash(tree.manifest, 64 * 1024 * 1024) === tree.sha256, "TASK16_RUNTIME_TREE_CHANGED");
    }
  }
  compareTrees("before-load");
  // Only after all code trees are matched may version metadata be loaded. No
  // PrismaClient is constructed; no engine or database connection is started.
  // Resolve in a new process as well: the long-lived controller's loader has a
  // separate package-main/path cache, unaffected by clearing require.cache.
  const resolved = JSON.parse(execute(tools.node, ["--eval", "process.stdout.write(JSON.stringify({entry:require.resolve('@prisma/client',{paths:[process.argv[1]]})}));", path.join(ROOT, "services/api")]));
  need(typeof resolved.entry === "string", "TASK16_RUNTIME_PRISMA_IDENTITY");
  const clientPath = fs.realpathSync(resolved.entry);
  need(inside(ROOT, clientPath), "TASK16_RUNTIME_CLIENT_ESCAPES_CANDIDATE");
  requireSealedTarget(clientPath);
  const clientEntryCapture=qualifiedFile(clientPath,{maxBytes:64*1024*1024,code:"TASK16_RUNTIME_PRISMA_IDENTITY"});
  // A fresh metadata process avoids reusing an earlier invocation's require
  // cache. The fixed script never constructs PrismaClient or opens a database.
  const version = JSON.parse(execute(tools.node, ["--eval", "const p=require(process.argv[1]).Prisma?.prismaVersion;process.stdout.write(JSON.stringify({client:p?.client,engine:p?.engine}));", clientPath]));
  need(version.client === inputs.prismaClientVersion && version.engine === ENGINE, "TASK16_RUNTIME_PRISMA_IDENTITY");
  let applicationEntries;
  const appRelative=["database/task16-registered-application.module.js","database/prisma.service.js","api-security.js","operating-projection/projection-export-json.js","api-json-replacer.js","validation/api-validation.js","api-listen.js"];
  // Legacy source-only fixtures can omit App output while native capability is
  // absent. A bridge invocation requires the immutable eight-entry witness.
  if(fs.existsSync(path.join(ROOT,"services/api/dist",appRelative[0]))) {
    for(const relative of ["services/api/prisma/task16-application-stage.cjs","services/api/prisma/task16-application-factory.cjs","services/api/src/database/task16-registered-application.module.ts"]) {
      need(sourceMembers.get(relative)?.sha256===sourceHash(path.join(ROOT,relative)),"TASK16_RUNTIME_APP_SOURCE");
    }
    const resolved=JSON.parse(execute(tools.node,["--eval","process.stdout.write(JSON.stringify({entry:require.resolve('@nestjs/testing/test',{paths:[process.argv[1]]})}));",path.join(ROOT,"services/api")]));
    const sdk=fs.realpathSync(resolved.entry);need(inside(ROOT,sdk)&&/\/node_modules\/@nestjs\/testing\/test\.js$/u.test(sdk),"TASK16_RUNTIME_APP_ENTRY");requireSealedTarget(sdk);
    applicationEntries=[...appRelative.map(relative=>path.join(ROOT,"services/api/dist",relative)),sdk].map(file=>{const row=qualifiedFile(file,{maxBytes:64*1024*1024,code:"TASK16_RUNTIME_APP_ENTRY"});return{path:file,sha256:row.sha256,identity:row.identity};});
  }
  let fixture;
  const fixturePath=path.join(ROOT,'services/api/dist/database/registered-payment-postgres.fixture.js');
  if(fs.existsSync(fixturePath)){
    for(const relative of ['services/api/prisma/task16-seed-fixture.cjs','services/api/src/database/registered-payment-postgres.fixture.ts'])need(sourceMembers.get(relative)?.sha256===sourceHash(path.join(ROOT,relative)),'TASK16_RUNTIME_FIXTURE_SOURCE');
    const expected=['funding','history-revision','write-authority','canonical-proof','intercompany','canonical-adapter','voucher'].map(n=>'services/api/prisma/prepared/task16/registered-'+n+'.sql');
    need(packet.installation?.fragments?.length===7&&packet.installation.fragments.every((row,i)=>row.path===expected[i]&&row.sha256===sourceMembers.get(row.path)?.sha256),'TASK16_RUNTIME_FIXTURE_FRAGMENTS');
    const fragments=packet.installation.fragments.map(row=>{const file=path.join(ROOT,row.path),captured=qualifiedFile(file,{maxBytes:64*1024*1024,code:'TASK16_RUNTIME_FIXTURE_FRAGMENT'});need(captured.sha256===row.sha256,'TASK16_RUNTIME_FIXTURE_FRAGMENT');return{path:row.path,sha256:row.sha256,identity:captured.identity};});
    const captured=qualifiedFile(fixturePath,{maxBytes:64*1024*1024,code:'TASK16_RUNTIME_FIXTURE_ENTRY'});
    const sources=['services/api/prisma/task16-seed-fixture.cjs','services/api/prisma/run-task16-registered-pg-local.cjs','services/api/prisma/task16-runtime-inputs.cjs','services/api/prisma/task16-client-loader.cjs','services/api/prisma/task16-restricted-clients.cjs','services/api/src/database/registered-payment-postgres.fixture.ts','services/api/src/company-entity/unified-social-credit-code.ts'].map(relative=>{const captured=qualifiedFile(path.join(ROOT,relative),{maxBytes:64*1024*1024,code:'TASK16_RUNTIME_FIXTURE_SOURCE'});need(sourceMembers.get(relative)?.sha256===captured.sha256,'TASK16_RUNTIME_FIXTURE_SOURCE');return{path:relative,sha256:captured.sha256,identity:captured.identity};});
    fixture={sources,dates:fixtureDates,input:{path:options.inputsFile,sha256:inputCapture.sha256,identity:inputCapture.identity},entry:{path:fixturePath,sha256:captured.sha256,identity:captured.identity},fragments,build:{candidateRoot:ROOT,sourceSha:packet.candidateSha,sourceSealSha256:packet.sealSha256,preparationReceiptSha256:inputs.preparationReceipt.sha256,apiDistManifestSha256:inputs.trees.find(row=>row.root==='services/api/dist').sha256}};
  }
  compareTrees("after-load");
  const finalSource = JSON.parse(execute(tools.node, [path.join(ROOT, "scripts/prepare-task16-registered-pg.cjs"), "--verify", "--packet", options.packetFile, "--expected-sha256", options.expectedPacketSha256]));
  need(JSON.stringify(finalSource) === JSON.stringify(verified), "TASK16_RUNTIME_SOURCE_CHANGED");
  need(qualifiedFile(options.inputsFile,{maxBytes:16*1024*1024,privateFile:true,expectedIdentity:inputCapture.identity,code:'TASK16_RUNTIME_INPUT_FILE'}).sha256 === options.expectedInputsSha256 && privateHash(options.packetFile) === options.expectedPacketSha256 && privateHash(inputs.preparationReceipt.path) === inputs.preparationReceipt.sha256, "TASK16_RUNTIME_INPUT_CHANGED");
  for (const name of TOOL_NAMES) need(toolFile(tools[name], toolIdentities[name]).sha256 === inputs.tools[name].sha256, "TASK16_RUNTIME_TOOL_CHANGED");
  need(qualifiedFile(clientPath,{maxBytes:64*1024*1024,expectedIdentity:clientEntryCapture.identity,code:"TASK16_RUNTIME_PRISMA_IDENTITY"}).sha256===clientEntryCapture.sha256,"TASK16_RUNTIME_PRISMA_IDENTITY");
  for(const row of applicationEntries??[])need(qualifiedFile(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:"TASK16_RUNTIME_APP_ENTRY_CHANGED"}).sha256===row.sha256,"TASK16_RUNTIME_APP_ENTRY_CHANGED");
  const docker = inputs.docker;
  need(docker?.endpoint === "unix:///Users/leoyang/.docker/run/docker.sock" && docker.imageId === "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" && typeof docker.daemonId === "string" && /^[A-Za-z0-9:-]{16,128}$/u.test(docker.daemonId), "TASK16_RUNTIME_RESOURCE_DESCRIPTOR");
  return { candidateSha: packet.candidateSha, candidateRoot: ROOT, sealSha256: packet.sealSha256, schema: packet.schema, migrations: packet.migrations,
    executionFiles: packet.source.files,
    runtimeAdmission: { fixture, applicationBuild:applicationEntries?{candidateRoot:ROOT,sourceSha:packet.candidateSha,sourceSealSha256:packet.sealSha256,preparationReceiptSha256:inputs.preparationReceipt.sha256,apiDistManifestSha256:inputs.trees.find(row=>row.root==="services/api/dist").sha256}:undefined, applicationEntries, status: "INPUTS_AND_CODE_TREES_MATCHED", clientEntry:{path:clientPath,sha256:clientEntryCapture.sha256,identity:clientEntryCapture.identity}, treeCount: TREE_ROOTS.length, tools: TOOL_NAMES, resourceExecutionAllowed: false, preparationReceiptIsWitnessNotCryptographicAttestation: true },
    inputs: { ...inputs, resourceOptions: { ...docker, tools: { docker: tools.docker, openssl: tools.openssl }, deadlineMs: 900000 } } };
}
// Internal production reuse; tests stay at runTask16RegisteredPg, not this reader.
module.exports = { verifyTask16RuntimeInputs, readQualifiedTask16File: qualifiedFile, normalizeTask16FixtureDates };
