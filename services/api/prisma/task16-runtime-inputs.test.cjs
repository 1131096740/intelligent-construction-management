"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { runTask16RegisteredPg } = require("./run-task16-registered-pg-local.cjs");

function simulatedStages() {
  const calls = [];
  const adapters = Object.fromEntries(["startResource", "verifyOwnerTransport", "migrateBaseline", "installBaselineAccess", "installPreparedSql", "installRegisteredAccess", "connectRestrictedClients", "startApplication", "seedFixture", "runNormalCase"].map(name => [name, async () => { calls.push(name); throw new Error("Admission failure must not enter resource stages"); }]));
  return { adapters, calls };
}

test("omitting only verifySource uses actual readonly input admission and never fills a native resource adapter", async () => {
  const f = simulatedStages();
  const receipt = await runTask16RegisteredPg({ packetFile: "/private/tmp/not-present-task16-source/packet.json", expectedPacketSha256: "a".repeat(64), inputsFile: "/private/tmp/not-present-task16-source/inputs.json", expectedInputsSha256: "b".repeat(64), artifactsDir: "/private/tmp/not-present-task16-source/artifacts" }, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_RUNTIME_INPUT_FILE");
  assert.equal(receipt.nativeExecution, false);
  assert.deepEqual(f.calls, []);
});

test("an incomplete injected map never inherits the real startResource adapter", async () => {
  const f = simulatedStages(); delete f.adapters.startResource;
  const receipt = await runTask16RegisteredPg({ packetFile: "/private/tmp/not-present-task16-source/packet.json", expectedPacketSha256: "a".repeat(64), inputsFile: "/private/tmp/not-present-task16-source/inputs.json", expectedInputsSha256: "b".repeat(64), artifactsDir: "/private/tmp/not-present-task16-source/artifacts" }, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_DRIVER_CAPABILITIES_INCOMPLETE");
  assert.deepEqual(receipt.missingCapabilities, ["startResource"]);
  assert.equal(receipt.nativeExecution, false);
  assert.deepEqual(f.calls, []);
});

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const project = path.resolve(__dirname, "../../..");

function preparedRuntime(t) {
  const temporary = fs.mkdtempSync("/private/tmp/jg-task16-runtime-protocol-");
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  const root = path.join(temporary, "candidate"); fs.mkdirSync(root);
  function put(relative, data, mode = 0o600) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { mode }); return file; }
  const files = ["services/api/prisma/run-task16-registered-pg-local.cjs", "services/api/prisma/task16-runtime-inputs.cjs", "services/api/prisma/enterprise-task01-resources.cjs", "services/api/prisma/task16-registered-sql-installer.cjs", "scripts/prepare-task16-registered-pg.cjs", "scripts/ops/runtime-manifest.py"];
  for (const file of files) put(file, fs.readFileSync(path.join(project, file)));
  const gitDir = path.join(temporary, "owner-git/worktrees/candidate"); fs.mkdirSync(gitDir, { recursive: true });
  const gitFile = put(".git", `gitdir: ${gitDir}\n`);
  fs.writeFileSync(path.join(gitDir, "gitdir"), `${gitFile}\n`);
  const roots = ["node_modules", "services/api/node_modules", "packages/shared-domain/node_modules", "services/api/dist", "packages/shared-domain/dist"];
  for (const relative of roots) put(`${relative}/synthetic-marker.txt`, "synthetic runtime bytes\n");
  put("services/api/node_modules/@prisma/client/package.json", JSON.stringify({ main: "index.js" }));
  put("services/api/node_modules/@prisma/client/index.js", 'module.exports={Prisma:{prismaVersion:{client:"5.22.0",engine:"605197351a3c8bdd595af2d2a9bc3025bca48ea2"}}};\n');
  const sourceSha = "a".repeat(40);
  const packet = { schemaVersion: 1, purpose: "task16-registered-pg-source-only-packet", status: "SOURCE_ONLY_NOT_EXECUTED", executionAllowed: false, resourceExecutorImplemented: false, candidateSha: sourceSha, source: { repo: root, files: files.map(relative => ({ path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))) })) }, sealSha256: "b".repeat(64) };
  const packetFile = path.join(temporary, "packet.json"); fs.writeFileSync(packetFile, JSON.stringify(packet), { mode: 0o600 });
  const expectedPacketSha256 = hash(fs.readFileSync(packetFile));
  const toolDir = path.join(temporary, "tools"); fs.mkdirSync(toolDir);
  const tools = {};
  for (const name of ["docker", "pnpm", "openssl"]) { const file = path.join(toolDir, name); fs.writeFileSync(file, "#!/bin/sh\nexit 99\n", { mode: 0o700 }); tools[name] = { path: file, sha256: hash(fs.readFileSync(file)) }; }
  for (const [name, file] of [["node", process.execPath], ["git", "/usr/bin/git"], ["python", "/usr/bin/python3"]]) { const resolved = fs.realpathSync(file); tools[name] = { path: resolved, sha256: hash(fs.readFileSync(resolved)) }; }
  const manifestDir = path.join(temporary, "manifests"); fs.mkdirSync(manifestDir);
  const trees = roots.map((relative, index) => {
    const manifest = path.join(manifestDir, `${index}.json`);
    execFileSync(tools.python.path, [path.join(root, "scripts/ops/runtime-manifest.py"), "capture", "--root", path.join(root, relative), "--manifest", manifest], { stdio: ["ignore", "pipe", "pipe"] });
    return { root: relative, manifest, sha256: hash(fs.readFileSync(manifest)) };
  });
  const preparation = { schemaVersion: 1, purpose: "witnessed-fresh-task16-build-ownership-not-approval", sourceSha, candidateRoot: root, worktreeGitDir: gitDir, worktreeGitFileSha256: hash(fs.readFileSync(gitFile)), buildSteps: ["shared-domain:build", "api:build"], outputs: trees.filter(tree => tree.root.endsWith("/dist")).map(tree => ({ root: tree.root, originallyAbsent: true, preparedManifestSha256: tree.sha256 })) };
  const preparationFile = path.join(temporary, "preparation.json"); fs.writeFileSync(preparationFile, JSON.stringify(preparation), { mode: 0o600 });
  const inputs = { schemaVersion: 1, purpose: "task16-runtime-inputs-not-approval", sourceSha, candidateRoot: root, nodeVersion: process.version, prismaClientVersion: "5.22.0", prismaEngineVersion: "605197351a3c8bdd595af2d2a9bc3025bca48ea2", authorizationReference: "synthetic-only-not-resource-approval", tools, trees, preparationReceipt: { path: preparationFile, sha256: hash(fs.readFileSync(preparationFile)) }, docker: { endpoint: "unix:///Users/leoyang/.docker/run/docker.sock", daemonId: "synthetic-daemon-id-only", imageId: "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" } };
  const inputsFile = path.join(temporary, "inputs.json");
  const options = { packetFile, expectedPacketSha256, inputsFile, expectedInputsSha256: "", artifactsDir: path.join(temporary, "admission-artifacts") };
  function sealInputs() { fs.writeFileSync(inputsFile, JSON.stringify(inputs), { mode: 0o600 }); options.expectedInputsSha256 = hash(fs.readFileSync(inputsFile)); }
  function sealPacket() { fs.writeFileSync(packetFile, JSON.stringify(packet), { mode: 0o600 }); options.expectedPacketSha256 = hash(fs.readFileSync(packetFile)); }
  function sealPreparation() { fs.writeFileSync(preparationFile, JSON.stringify(preparation), { mode: 0o600 }); inputs.preparationReceipt.sha256 = hash(fs.readFileSync(preparationFile)); sealInputs(); }
  function recapture(relative) {
    const tree = trees.find(row => row.root === relative); fs.unlinkSync(tree.manifest);
    execFileSync(tools.python.path, [path.join(root, "scripts/ops/runtime-manifest.py"), "capture", "--root", path.join(root, relative), "--manifest", tree.manifest]);
    tree.sha256 = hash(fs.readFileSync(tree.manifest)); sealInputs();
  }
  sealInputs();
  const harness = path.join(temporary, "harness.cjs");
  fs.writeFileSync(harness, `
    const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
    const {runTask16RegisteredPg}=require(${JSON.stringify(path.join(root, "services/api/prisma/run-task16-registered-pg-local.cjs"))});
    const specification=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    let options=specification.options;
    const packet=JSON.parse(fs.readFileSync(options.packetFile,'utf8'));
    const calls=[],commands=[];
    const adapters={
      readOnlyCommand(exe,args,control){
        commands.push({exe,args,env:control.env});
        if(args[0].endsWith('/prepare-task16-registered-pg.cjs'))return JSON.stringify({status:'SOURCE_ONLY_VERIFIED_NOT_EXECUTED',candidateSha:packet.candidateSha,sealSha256:packet.sealSha256,packetSha256:options.expectedPacketSha256,executionAllowed:false});
        return execFileSync(exe,args,control);
      },
      startResource:async c=>{calls.push('resource');if(c.source.runtimeAdmission.status!=='INPUTS_AND_CODE_TREES_MATCHED')throw Error('admission missing');return {close:async()=>calls.push('close-resource'),getReceipt:()=>({status:'closed',cleanup:{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true}})};},
      verifyOwnerTransport:async()=>{},migrateBaseline:async()=>{},installBaselineAccess:async()=>{},installPreparedSql:async()=>{},installRegisteredAccess:async()=>{},
      connectRestrictedClients:async()=>({close:async()=>{}}),startApplication:async()=>({close:async()=>{}}),seedFixture:async()=>({}),runNormalCase:async()=>({caseId:'registered.null-cross-company.commit',passed:true})
    };
    async function exercise(){
      const firstReceipt=await runTask16RegisteredPg(options,adapters);
      if(!specification.reenter)return {receipt:firstReceipt,calls,commands};
      const inputs=JSON.parse(fs.readFileSync(options.inputsFile,'utf8'));
      const root=inputs.candidateRoot,client=path.join(root,'services/api/node_modules/@prisma/client');
      fs.writeFileSync(path.join(client,'package.json'),JSON.stringify({main:'bad.js'}));
      fs.writeFileSync(path.join(client,'bad.js'),'module.exports={Prisma:{prismaVersion:{client:"5.22.0",engine:"wrong-engine"}}};');
      const tree=inputs.trees.find(row=>row.root==='services/api/node_modules');
      fs.unlinkSync(tree.manifest);
      execFileSync(inputs.tools.python.path,[path.join(root,'scripts/ops/runtime-manifest.py'),'capture','--root',path.join(root,tree.root),'--manifest',tree.manifest]);
      const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      tree.sha256=hash(fs.readFileSync(tree.manifest));
      fs.writeFileSync(options.inputsFile,JSON.stringify(inputs));
      options={...options,expectedInputsSha256:hash(fs.readFileSync(options.inputsFile)),artifactsDir:path.join(path.dirname(options.artifactsDir),'admission-artifacts-second')};
      calls.length=0;commands.length=0;
      const receipt=await runTask16RegisteredPg(options,adapters);
      return {firstReceipt,receipt,calls,commands,retainedIndex:fs.existsSync(path.join(client,'index.js'))};
    }
    exercise().then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stdout.write(JSON.stringify({unexpected:error.code||error.message}));process.exitCode=1;});
  `);
  function run(timeoutMs = 30000, reenter = false) {
    const config = path.join(temporary, "options.json"); fs.writeFileSync(config, JSON.stringify({ options, reenter }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [harness, config], { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, JSON.stringify({ status: result.status, signal: result.signal, errorCode: result.error?.code, stderr: result.stderr }));
    return JSON.parse(result.stdout);
  }
  return { temporary, root, put, packet, packetFile, inputs, inputsFile, options, preparation, preparationFile, run, sealInputs, sealPacket, sealPreparation, recapture };
}

test("the public driver admits its own source/tools/worktree and compares all five actual code trees before simulated resources", t => {
  const f = preparedRuntime(t); const result = f.run();
  assert.equal(result.receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", JSON.stringify(result.receipt));
  assert.equal(result.receipt.nativeExecution, false);
  assert.equal(result.receipt.financialAcceptance, false);
  assert.deepEqual(result.calls, ["resource", "close-resource"]);
  assert.equal(result.commands.length, 14);
  for (const command of result.commands) {
    assert.deepEqual(Object.keys(command.env).sort(), ["LANG", "LC_ALL", "PATH", "TZ"]);
    assert.ok(!command.args.includes("migrate") && !command.args.includes("docker"));
  }
});

test("changed tool bytes are refused before any command or resource", t => {
  const f = preparedRuntime(t); fs.appendFileSync(f.inputs.tools.docker.path, "# changed\n");
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_TOOL_CHANGED");
  assert.deepEqual(result.commands, []); assert.deepEqual(result.calls, []);
});

test("the runtime input digest must be externally pinned", t => {
  const f = preparedRuntime(t); f.options.expectedInputsSha256 = "0".repeat(64);
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_INPUT_DIGEST");
  assert.deepEqual(result.calls, []);
});

test("another candidate root cannot attest the driver currently executing", t => {
  const f = preparedRuntime(t); f.inputs.candidateRoot = f.temporary; f.sealInputs();
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_INPUT_BINDING");
  assert.deepEqual(result.calls, []);
});

test("the executed admission module must itself be a sealed candidate member", t => {
  const f = preparedRuntime(t); f.packet.source.files.find(row => row.path.endsWith("task16-runtime-inputs.cjs")).sha256 = "0".repeat(64); f.sealPacket();
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_ADAPTER_NOT_IN_CANDIDATE");
  assert.deepEqual(result.calls, []);
});

test("a worktree pointer without the exact backlink is refused", t => {
  const f = preparedRuntime(t); fs.writeFileSync(path.join(f.preparation.worktreeGitDir, "gitdir"), "/private/tmp/foreign/.git\n");
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_WORKTREE_IDENTITY");
  assert.deepEqual(result.calls, []);
});

test("the driver cannot claim ownership of pre-existing build outputs", t => {
  const f = preparedRuntime(t); f.preparation.outputs[0].originallyAbsent = false; f.sealPreparation();
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_OUTPUT_OWNERSHIP");
  assert.deepEqual(result.calls, []);
});

test("a duplicated tree cannot hide a missing runtime root", t => {
  const f = preparedRuntime(t); f.inputs.trees[1] = f.inputs.trees[0]; f.sealInputs();
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_TREES");
  assert.deepEqual(result.calls, []);
});

test("actual dependency drift is caught by the real manifest process before resource acquisition", t => {
  const f = preparedRuntime(t); f.put("node_modules/synthetic-marker.txt", "changed after captured manifest\n");
  const result = f.run(); assert.equal(result.receipt.status, "FAILED_CLOSED");
  assert.deepEqual(result.calls, []);
  assert.equal(result.commands.filter(row => row.args.includes("compare")).length, 1);
});

test("a dependency link cannot escape the candidate even if its manifest is re-pinned", t => {
  const f = preparedRuntime(t); const outside = path.join(f.temporary, "outside.js"); fs.writeFileSync(outside, "// outside candidate\n");
  fs.symlinkSync(outside, path.join(f.root, "node_modules/outside.js")); f.recapture("node_modules");
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_LINK_ESCAPES_CANDIDATE");
  assert.deepEqual(result.calls, []);
});

test("a workspace package link is permitted when its contents are captured trees or exact tracked source", t => {
  const f = preparedRuntime(t); const file = f.put("packages/shared-domain/package.json", '{"name":"synthetic-workspace","main":"dist/index.js"}');
  f.packet.source.files.push({ path: "packages/shared-domain/package.json", sha256: hash(fs.readFileSync(file)) }); f.sealPacket();
  fs.symlinkSync(path.join(f.root, "packages/shared-domain"), path.join(f.root, "node_modules/synthetic-workspace")); f.recapture("node_modules");
  const result = f.run(); assert.equal(result.receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", JSON.stringify(result.receipt));
  assert.deepEqual(result.calls, ["resource", "close-resource"]);
});

test("Prisma metadata is inspected only after sealed trees match and must match the fixed engine", t => {
  const f = preparedRuntime(t); f.put("services/api/node_modules/@prisma/client/index.js", 'module.exports={Prisma:{prismaVersion:{client:"5.22.0",engine:"wrong-engine"}}};\n'); f.recapture("services/api/node_modules");
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_PRISMA_IDENTITY");
  assert.deepEqual(result.calls, []);
  assert.equal(result.commands.filter(row => row.args.includes("compare")).length, 5);
});

test("a package main cannot load unsealed in-candidate code without using a symlink", t => {
  const f = preparedRuntime(t);
  f.put("unsealed-main.js", fs.readFileSync(path.join(f.root, "services/api/node_modules/@prisma/client/index.js")));
  f.put("services/api/node_modules/@prisma/client/package.json", JSON.stringify({ main: "../../../../../unsealed-main.js" }));
  f.recapture("services/api/node_modules");
  const result = f.run();
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_LINK_TARGET_UNSEALED");
  assert.deepEqual(result.calls, []);
});

test("code-tree drift during metadata loading is refused before resource acquisition", t => {
  const f = preparedRuntime(t);
  const marker = path.join(f.root, "node_modules/synthetic-marker.txt");
  const original = fs.readFileSync(path.join(f.root, "services/api/node_modules/@prisma/client/index.js"), "utf8");
  f.put("services/api/node_modules/@prisma/client/index.js", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'changed during metadata load');\n${original}`);
  f.recapture("services/api/node_modules");
  const result = f.run();
  assert.equal(result.receipt.status, "FAILED_CLOSED");
  assert.deepEqual(result.calls, []);
});

test("a dependency link to unsealed code inside the candidate is rejected before that code can be loaded", t => {
  const f = preparedRuntime(t);
  const client = path.join(f.root, "services/api/node_modules/@prisma/client/index.js");
  const source = fs.readFileSync(client);
  const unsealed = f.put("unsealed-client.js", source);
  fs.unlinkSync(client); fs.symlinkSync(unsealed, client);
  const tree = f.inputs.trees.find(row => row.root === "services/api/node_modules");
  fs.unlinkSync(tree.manifest);
  execFileSync(f.inputs.tools.python.path, [path.join(f.root, "scripts/ops/runtime-manifest.py"), "capture", "--root", path.join(f.root, tree.root), "--manifest", tree.manifest]);
  tree.sha256 = hash(fs.readFileSync(tree.manifest)); f.sealInputs();
  const result = f.run();
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_LINK_TARGET_UNSEALED");
  assert.deepEqual(result.calls, []);
});

test("a task-owned FIFO manifest is rejected as a non-file before reading, under a hard child deadline", t => {
  const f = preparedRuntime(t);
  const fifo = path.join(f.temporary, "owned-manifest.fifo");
  execFileSync("/usr/bin/mkfifo", ["-m", "600", fifo], { timeout: 1000 });
  f.inputs.trees[0].manifest = fifo; f.inputs.trees[0].sha256 = "0".repeat(64); f.sealInputs();
  const result = f.run(1500);
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_INPUT_FILE");
  assert.deepEqual(result.calls, []);
});

test("a second run in the same parent module resolves the re-sealed current package main rather than the previous index", t => {
  const f = preparedRuntime(t);
  const result = f.run(30000, true);
  assert.equal(result.firstReceipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED");
  assert.equal(result.retainedIndex, true);
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_PRISMA_IDENTITY");
  assert.equal(result.receipt.status, "FAILED_CLOSED");
  assert.deepEqual(result.calls, []);
});

test("an input file replaced by an owned FIFO during metadata loading is rejected in the final digest check", t => {
  const f = preparedRuntime(t);
  const client = "services/api/node_modules/@prisma/client/index.js";
  const original = fs.readFileSync(path.join(f.root, client), "utf8");
  f.put(client, `require('node:fs').unlinkSync(${JSON.stringify(f.inputsFile)});require('node:child_process').execFileSync('/usr/bin/mkfifo',['-m','600',${JSON.stringify(f.inputsFile)}],{timeout:1000,stdio:'ignore'});\n${original}`);
  f.recapture("services/api/node_modules");
  const result = f.run(3000);
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_INPUT_FILE");
  assert.deepEqual(result.calls, []);
});

for (const kind of ["preparation witness", "fake docker tool"]) {
  test(`a ${kind} replaced by an owned FIFO is rejected by its qualified post-check`, t => {
    const f = preparedRuntime(t);
    const client = "services/api/node_modules/@prisma/client/index.js";
    const original = fs.readFileSync(path.join(f.root, client), "utf8");
    const target = kind === "preparation witness" ? f.preparationFile : f.inputs.tools.docker.path;
    f.put(client, `require('node:fs').unlinkSync(${JSON.stringify(target)});require('node:child_process').execFileSync('/usr/bin/mkfifo',['-m','600',${JSON.stringify(target)}],{timeout:1000,stdio:'ignore'});\n${original}`);
    f.recapture("services/api/node_modules");
    const result = f.run(3000);
    assert.equal(result.receipt.failureCode, kind === "preparation witness" ? "TASK16_RUNTIME_INPUT_FILE" : "TASK16_RUNTIME_TOOL_CHANGED");
    assert.deepEqual(result.calls, []);
  });
}
