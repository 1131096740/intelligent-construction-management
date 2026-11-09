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
const { readTask16FixtureSchema, schemaPath } = require("./testdata/task16-schema-fixture.cjs");

function preparedRuntime(t, sourceVersion = 204) {
  const temporary = fs.mkdtempSync("/private/tmp/jg-task16-runtime-protocol-");
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  const root = path.join(temporary, "candidate"); fs.mkdirSync(root);
  function put(relative, data, mode = 0o600) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { mode }); return file; }
  const files = ["services/api/prisma/run-task16-registered-pg-local.cjs", "services/api/prisma/task16-runtime-inputs.cjs", "services/api/prisma/task16-baseline-migrations.cjs", "services/api/prisma/task16-migration-history.cjs", "services/api/prisma/task16-schema205-scope.cjs", "services/api/prisma/task16-baseline-access.cjs", "services/api/prisma/task16-baseline-access.json", "services/api/prisma/task16-baseline-access.sql", "services/api/prisma/task16-bounded-command.cjs", "services/api/prisma/task16-owner-tls.cjs", "services/api/prisma/task16-owner-probe.cjs", "services/api/prisma/enterprise-task01-resources.cjs", "services/api/prisma/task16-registered-sql-installer.cjs", "services/api/prisma/task16-prepared-install-stage.cjs", "services/api/prisma/task16-registered-object-witness.cjs", "services/api/prisma/task16-registered-access.cjs", "services/api/prisma/task16-registered-access.json", "services/api/prisma/task16-registered-access.sql", "services/api/prisma/task16-registered-access-check.cjs", "services/api/prisma/task16-registered-access-check.sql", "services/api/prisma/task16-restricted-clients.cjs", "services/api/prisma/task16-client-loader.cjs", "scripts/prepare-task16-registered-pg.cjs", "scripts/ops/runtime-manifest.py"];
  for (const extra of ["services/api/prisma/task16-sdk-schema-proof.json", "services/api/prisma/task16-sdk-schema.cjs"]) if (fs.existsSync(path.join(project, extra))) files.push(extra);
  files.push(schemaPath);
  for (const file of files) {
    const bytes = file === schemaPath ? readTask16FixtureSchema(project, sourceVersion) : fs.readFileSync(path.join(project, file));
    put(file, bytes);
  }
  const gitDir = path.join(temporary, "owner-git/worktrees/candidate"); fs.mkdirSync(gitDir, { recursive: true });
  const gitFile = put(".git", `gitdir: ${gitDir}\n`);
  fs.writeFileSync(path.join(gitDir, "gitdir"), `${gitFile}\n`);
  const roots = ["node_modules", "services/api/node_modules", "packages/shared-domain/node_modules", "services/api/dist", "packages/shared-domain/dist"];
  for (const relative of roots) put(`${relative}/synthetic-marker.txt`, "synthetic runtime bytes\n");
  put("services/api/node_modules/@prisma/client/package.json", JSON.stringify({ main: "index.js" }));
  const sdkMetadata = JSON.parse(fs.readFileSync(path.join(project,"services/api/prisma/testdata/task16-schema204-sdk-metadata.json"),"utf8"));
  const config = {clientVersion:"5.22.0",engineVersion:"605197351a3c8bdd595af2d2a9bc3025bca48ea2",copyEngine:false,inlineSchema:sdkMetadata.generatedSchema};
  put("services/api/node_modules/@prisma/client/index.js", `const config=${JSON.stringify(config)};\nconfig.runtimeDataModel=JSON.parse(${JSON.stringify(sdkMetadata.runtimeDataModelText)});\nthrow new Error('TASK_OWNED_FAKE_SDK_MUST_NOT_BE_IMPORTED');\n`);
  put("services/api/node_modules/.prisma/client/schema.prisma",sdkMetadata.generatedSchema);
  put("services/api/node_modules/.prisma/client/index.js",fs.readFileSync(path.join(root,"services/api/node_modules/@prisma/client/index.js")));
  // Existing AST tool bytes only; this is not a Prisma SDK or engine copy.
  fs.cpSync(path.join(project,"services/api/node_modules/typescript"),path.join(root,"services/api/node_modules/typescript"),{recursive:true,dereference:true});
  const sourceSha = "a".repeat(40);
  const packet = { schemaVersion: 1, purpose: "task16-registered-pg-source-only-packet", status: "SOURCE_ONLY_NOT_EXECUTED", executionAllowed: false, resourceExecutorImplemented: false, candidateSha: sourceSha, schema:{path:"services/api/prisma/schema.prisma",sha256:hash(fs.readFileSync(path.join(root,"services/api/prisma/schema.prisma")))}, source: { repo: root, files: files.map(relative => ({ path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))) })) }, sealSha256: "b".repeat(64) };
  if (sourceVersion === 206) packet.sourceProfile = "SCHEMA206_SOURCE_ONLY";
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
  const scopeFixtureFile=path.join(temporary,"scope-fixture.cjs");
  fs.copyFileSync(path.join(project,"services/api/prisma/testdata/task16-schema205-scope-fixture.cjs"),scopeFixtureFile);
  const harness = path.join(temporary, "harness.cjs");
  fs.writeFileSync(harness, `
    const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
    const {runTask16RegisteredPg}=require(${JSON.stringify(path.join(root, "services/api/prisma/run-task16-registered-pg-local.cjs"))});
    const scopeFixture=require(${JSON.stringify(scopeFixtureFile)});
    const specification=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    let options=specification.options;
    const packet=JSON.parse(fs.readFileSync(options.packetFile,'utf8'));
    const calls=[],commands=[];let observedApplicationEntries,observedFixtureAdmission,observedCaseAdmission,observedSdkSchema;
    const adapters={
      readOnlyCommand(exe,args,control){
        commands.push({exe,args,env:control.env});
        if(args[0].endsWith('/prepare-task16-registered-pg.cjs'))return JSON.stringify({status:'SOURCE_ONLY_VERIFIED_NOT_EXECUTED',candidateSha:packet.candidateSha,sealSha256:packet.sealSha256,packetSha256:options.expectedPacketSha256,executionAllowed:false,sourceProfile:packet.sourceProfile});
        const output=execFileSync(exe,args,control);
        if(specification.metadataMutation&&args[0]==='--eval'&&args[1].includes('inspectTask16SdkSource')){
          const mutation=specification.metadataMutation;
          if(mutation.kind==='write')fs.writeFileSync(mutation.target,'changed after static inspection');
          else{fs.unlinkSync(mutation.target);execFileSync('/usr/bin/mkfifo',['-m','600',mutation.target],{timeout:1000,stdio:'ignore'});}
        }
        return output;
      },
      startResource:async c=>{observedSdkSchema=c.source.runtimeAdmission.sdkSchema;observedApplicationEntries=c.applicationEntriesWitness;observedFixtureAdmission=c.seedAdmissionWitness;observedCaseAdmission=c.normalCaseAdmissionWitness;calls.push('resource');if(c.source.runtimeAdmission.status!=='INPUTS_AND_CODE_TREES_MATCHED')throw Error('admission missing');return {close:async()=>calls.push('close-resource'),getReceipt:()=>({status:'closed',cleanup:{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true}})};},
      verifyOwnerTransport:async()=>{},migrateBaseline:async()=>{},installBaselineAccess:async()=>{},installPreparedSql:async()=>{},installRegisteredAccess:async()=>{},
      connectRestrictedClients:async()=>({close:async()=>{}}),startApplication:async()=>({close:async()=>{}}),seedFixture:async()=>({}),runNormalCase:async()=>({caseId:'registered.null-cross-company.commit',passed:true})
    };

    if(specification.clientsProtocol){
      const crypto=require('node:crypto'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
      const root=packet.source.repo,roles=['jg_task01_owner','jg_task01_runtime','jg_task01_observer'],oids=['10000','20001','20002'];
      const typeAcl=[{type:'public."OperatingLedgerFactWritePayloadV2"',typeOid:'41001',ownerOid:'10000',grantor:'10000',grantee:'10000',privilege:'USAGE',grantable:false},{type:'public."OperatingLedgerImpactWritePayloadV2"',typeOid:'41002',ownerOid:'10000',grantor:'10000',grantee:'10000',privilege:'USAGE',grantable:false}];
      const plan=JSON.parse(fs.readFileSync(path.join(root,'services/api/prisma/task16-registered-access.json'))),basePlan=JSON.parse(fs.readFileSync(path.join(root,'services/api/prisma/task16-baseline-access.json')));
      const identity={ownerOid:oids[0],runtimeOid:oids[1],observerOid:oids[2],databaseOid:'16384',systemIdentifier:'7234567890123456789'},objects={relations:[],indexes:[],columns:[],constraints:[],triggers:[]};
      const codeHash=n=>hash(fs.readFileSync(path.join(root,'services/api/prisma/'+n))),ca=path.join(path.dirname(options.inputsFile),'owned-ca.crt');fs.writeFileSync(ca,'synthetic CA only',{mode:0o600});
      const tls={caSha256:hash(fs.readFileSync(ca)),correctCertificateDerSha256:'1'.repeat(64)};let source,resourceReceipt,pendingSdkDrift=false;
      adapters.startResource=async c=>{source=c.source;calls.push('resource');resourceReceipt={...source.inputs.docker,runId:c.runId,sourceSha:source.candidateSha,containerId:'d'.repeat(64),networkId:'e'.repeat(64),databaseName:'jg_task01_'+c.runId.replaceAll('-',''),port:15432,status:'started-awaiting-driver-verification',cleanup:{status:'pending'},requestedCertificateMode:'correct',reloadState:'OBSERVED_PEER_CERTIFICATE_MATCHED',presentedCertificate:{mode:'correct',derSha256:tls.correctCertificateDerSha256},tls};
        return{containerId:resourceReceipt.containerId,networkId:resourceReceipt.networkId,databaseName:resourceReceipt.databaseName,port:resourceReceipt.port,caPath:ca,serverCertHashes:tls,getReceipt:()=>structuredClone(resourceReceipt),close:async()=>{calls.push('close-resource');resourceReceipt.status='closed';resourceReceipt.cleanup={status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true};},execOwnerSql:async sql=>({stdout:JSON.stringify({...identity,phase:'clients-check',nonce:/'([a-f0-9]{64})' AS nonce/u.exec(sql)[1],database:resourceReceipt.databaseName,ownerRole:roles[0],loginRole:roles[0],ownerIsDatabaseOwner:true,runtimeRole:roles[1],observerRole:roles[2],tls:true,version:160004,replication:'origin',readOnly:'off',schema204PhysicalVerified:true,schema205PhysicalVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("seven"),schema205Registry:scopeFixture.registry("seven"),schema203Verified:true,schema203TypeAclWitness:typeAcl,functionsVerified:true,baselineGuardsVerified:true,matrixVerified:true,guardVerified:true,installedObjectWitness:objects,otherGranteeAclWitness:[],migrationLedger:source.migrations.map(row=>({name:row.path.split('/').at(-2),sha256:row.sha256,finished:true,rolledBack:false}))})})};};
      adapters.verifyOwnerTransport=async()=>({status:'OWNER_TLS_CONTROLS_VERIFIED',...identity,caSha256:tls.caSha256,tlsWitness:tls});
      adapters.migrateBaseline=async()=>({migrationCount:205});
      adapters.installBaselineAccess=async c=>({status:'BASELINE_ROLE_ACL_COMMIT_OBSERVED',schema204PhysicalVerified:true,schema205PhysicalVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("baseline"),schema205Registry:scopeFixture.registry("baseline"),...identity,runtimeRole:roles[1],observerRole:roles[2],sourceSha:source.candidateSha,manifestSha256:codeHash('task16-baseline-access.json'),expectedMatrixSha256:hash(JSON.stringify([basePlan.runtime,basePlan.observer])),resourceWitness:structuredClone(c.resourceWitness),schema203TypeAclWitness:typeAcl});
      adapters.installPreparedSql=async c=>({status:'SQL_INSTALLATION_COMMIT_OBSERVED',...identity,candidateSha:source.candidateSha,sourceSealSha256:source.sealSha256,packetSha256:options.expectedPacketSha256,baselineContinuityVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("seven"),schema205Registry:scopeFixture.registry("seven"),schema205ScopeDelta:scopeFixture.delta("seven"),baselineManifestSha256:c.baselineAccess.manifestSha256,fragmentCount:7,installedObjectWitness:objects});
      adapters.installRegisteredAccess=async c=>{if(specification.clientsProtocol==='model-drift')source.runtimeAdmission.sdkSchema.runtimeDataModelTextSha256='0'.repeat(64);if(specification.clientsProtocol==='lost-proof')delete source.runtimeAdmission.sdkSchema;if(specification.clientsProtocol==='fd-drift')pendingSdkDrift=true;return{status:'REGISTERED_ACL_COMMIT_OBSERVED',schema204PhysicalVerified:true,schema205PhysicalVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("seven"),schema205Registry:scopeFixture.registry("seven"),...identity,sourceSha:source.candidateSha,sourceSealSha256:source.sealSha256,manifestSha256:codeHash('task16-registered-access.json'),baselineManifestSha256:c.baselineAccess.manifestSha256,expectedMatrixSha256:hash(JSON.stringify([plan.runtime,plan.observer])),installedObjectWitness:objects,otherGranteeAclWitness:[],schema203TypeAclWitness:typeAcl};};
      adapters.connectRestrictedClients={command:async(exe,args,control)=>{const stdout=adapters.readOnlyCommand(exe,args,control).toString();if(pendingSdkDrift&&args.includes('compare')&&args[args.indexOf('--root')+1]===path.join(root,'packages/shared-domain/dist')){pendingSdkDrift=false;fs.appendFileSync(path.join(root,'services/api/node_modules/.prisma/client/index.js'),'\\n// changed after B2\\n');}return{actualSettled:true,code:0,timedOut:false,stdout,stderr:''};},createClient:(configuration,Class)=>{const client=new Class();calls.push('construct-'+configuration.role);const i=roles.indexOf(configuration.role);client.$connect=async()=>{calls.push('connect-'+configuration.role);if(specification.clientsProtocol==='connect-fd-drift'&&i===0)fs.appendFileSync(path.join(root,'services/api/node_modules/.prisma/client/index.js'),'\\n// changed after connect await\\n');};client.$disconnect=async()=>calls.push('disconnect-'+configuration.role);client.$transaction=async action=>action(client);client.$queryRawUnsafe=async(sql,nonce)=>[{nonce,database:resourceReceipt.databaseName,...identity,effectiveRole:roles[i],loginRole:roles[i],effectiveOid:oids[i],loginOid:oids[i],pid:12001+i,version:160004,tls:true,replication:'origin',readOnly:i===2?'on':'off',defaultReadOnly:i===2?'on':'off'}];return client;}};
      adapters.startApplication=async()=>{calls.push('app');return{close:async()=>calls.push('close-app')};};
    }
    async function exercise(){
      const firstReceipt=await runTask16RegisteredPg(options,adapters);
      if(!specification.reenter)return {receipt:firstReceipt,calls,commands,sdkSchema:observedSdkSchema,applicationEntries:observedApplicationEntries,fixtureAdmission:observedFixtureAdmission,caseAdmission:observedCaseAdmission};
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
  const hooks={};
  function run(timeoutMs = 30000, reenter = false) {
    const config = path.join(temporary, "options.json"); fs.writeFileSync(config, JSON.stringify({ options, reenter, metadataMutation:hooks.metadataMutation,clientsProtocol:hooks.clientsProtocol }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [harness, config], { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, JSON.stringify({ status: result.status, signal: result.signal, errorCode: result.error?.code, stderr: result.stderr }));
    return JSON.parse(result.stdout);
  }
  return { hooks, temporary, root, put, packet, packetFile, inputs, inputsFile, options, preparation, preparationFile, run, sealInputs, sealPacket, sealPreparation, recapture };
}

test("a verified Schema206 source-only packet cannot enter runtime admission", t => {
  const f = preparedRuntime(t, 206);
  const result = f.run();
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_SOURCE_PROFILE_NOT_ADMITTED");
  assert.equal(result.receipt.nativeExecution, false);
  assert.deepEqual(result.calls, []);
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].args[1], "--verify");
});

test("the public driver admits its own source/tools/worktree and compares all five actual code trees before simulated resources", t => {
  const f = preparedRuntime(t); const result = f.run();
  assert.equal(result.receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", JSON.stringify(result.receipt));
  assert.equal(result.receipt.nativeExecution, false);
  assert.equal(result.receipt.financialAcceptance, false);
  assert.equal(result.sdkSchema.contentBound,true);
  assert.equal(result.sdkSchema.sourceSchemaSha256,"3f41995f48430e7adfeefb8ec605203d8ce501bb7214c66619a9142bfcf7a3f1");
  assert.equal(result.sdkSchema.generatedSchemaSha256,"b1680aab44e174477ae5394e0dd7d629f8f4331dd4fd2533575e8f36cfc73552");
  assert.equal(result.sdkSchema.runtimeDataModelTextSha256,"f661dc0fd9db3d641ae09c4a514ac981078de5d26f63936e1ae8ef61ff2e6695");
  assert.equal(result.sdkSchema.rawSchemaEqual,false);
  assert.equal(result.sdkSchema.nativeRuntimeQualification,false);
  assert.equal(result.sdkSchema.reviewedGeneratedBundleMatched,false);
  assert.deepEqual(result.calls, ["resource", "close-resource"]);
  assert.equal(result.commands.length, 14);
  for (const command of result.commands) {
    assert.deepEqual(Object.keys(command.env).sort(), ["LANG", "LC_ALL", "PATH", "TZ"]);
    assert.ok(!command.args.includes("migrate") && !command.args.includes("docker"));
  }
});
test("a version-labelled client without source Schema cannot reach even the simulated resource boundary", t => {
  const f = preparedRuntime(t);
  delete f.packet.schema; f.sealPacket();
  const result = f.run();
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_SDK_SCHEMA_MISSING");
  assert.deepEqual(result.calls, []);
  assert.equal(result.receipt.nativeExecution, false);
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

test("static Prisma config is inspected only after sealed trees match and must match the fixed engine", t => {
  const f = preparedRuntime(t),file='services/api/node_modules/.prisma/client/index.js';
  f.put(file,fs.readFileSync(path.join(f.root,file),'utf8').replace('605197351a3c8bdd595af2d2a9bc3025bca48ea2','wrong-engine'));f.recapture('services/api/node_modules');
  const result = f.run(); assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_SDK_SCHEMA");
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

test("code-tree drift at the readOnlyCommand return boundary is refused before resource acquisition", t => {
  const f = preparedRuntime(t);
  f.hooks.metadataMutation={kind:'write',target:path.join(f.root,'node_modules/synthetic-marker.txt')};
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

test("an input file replaced by an owned FIFO after the static tool returns is rejected in the final digest check", t => {
  const f = preparedRuntime(t);f.hooks.metadataMutation={kind:'fifo',target:f.inputsFile};
  const result = f.run(5000);
  assert.equal(result.receipt.failureCode, "TASK16_RUNTIME_INPUT_FILE");
  assert.deepEqual(result.calls, []);
});

for (const kind of ["preparation witness", "fake docker tool"]) {
  test(`a ${kind} replaced by an owned FIFO after the static tool returns is rejected by its qualified post-check`, t => {
    const f = preparedRuntime(t);
    f.hooks.metadataMutation={kind:'fifo',target:kind==='preparation witness'?f.preparationFile:f.inputs.tools.docker.path};
    const result = f.run(5000);
    assert.equal(result.receipt.failureCode, kind === "preparation witness" ? "TASK16_RUNTIME_INPUT_FILE" : "TASK16_RUNTIME_TOOL_CHANGED");
    assert.deepEqual(result.calls, []);
  });
}


test('B2 captures fixed App entry identities before resource acquisition without importing Nest',t=>{
 const f=preparedRuntime(t);const relative=['database/task16-registered-application.module.js','database/prisma.service.js','api-security.js','operating-projection/projection-export-json.js','api-json-replacer.js','validation/api-validation.js','api-listen.js'];for(const name of relative)f.put('services/api/dist/'+name,'module.exports={};\n');
 const sdk=f.put('services/api/node_modules/@nestjs/testing/test.js',"throw new Error('UNEXPECTED_NEST_IMPORT');\n");
 for(const file of ['services/api/prisma/task16-application-stage.cjs','services/api/prisma/task16-application-factory.cjs','services/api/src/database/task16-registered-application.module.ts']){const bytes=fs.readFileSync(path.join(project,file));f.put(file,bytes);f.packet.source.files.push({path:file,sha256:hash(bytes)});}f.sealPacket();
 f.recapture('services/api/dist');f.recapture('services/api/node_modules');for(const out of f.preparation.outputs)out.preparedManifestSha256=f.inputs.trees.find(row=>row.root===out.root).sha256;f.sealPreparation();const result=f.run();assert.equal(result.receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',result.receipt.failureCode);assert.equal(result.applicationEntries?.length,8);assert.equal(result.applicationEntries[7].path,sdk);for(const row of result.applicationEntries){assert.equal(row.sha256,hash(fs.readFileSync(row.path)));assert.equal(row.identity.ino,fs.statSync(row.path).ino);}assert.ok(result.commands.some(row=>row.args[0]==='--eval'&&row.args[1].includes("require.resolve('@nestjs/testing/test'")));assert.equal(result.receipt.nativeExecution,false);
});

for(const [label,value]of [['calendar',{paidAt:'2026-02-30',openingDate:'2026-01-01'}],['order',{paidAt:'2026-01-01',openingDate:'2026-01-02'}],['extra field',{paidAt:'2026-01-02',openingDate:'2026-01-01',origin:'forbidden'}]])test('readonly admission rejects explicit invalid fixture dates: '+label,t=>{const f=preparedRuntime(t);f.inputs.fixtureDates=value;f.sealInputs();const result=f.run();assert.equal(result.receipt.failureCode,'TASK16_RUNTIME_FIXTURE_DATES');assert.deepEqual(result.calls,[]);});
test('readonly admission accepts explicit dates with either JSON key order without requiring seed output',t=>{const f=preparedRuntime(t);f.inputs.fixtureDates={openingDate:'2026-11-01',paidAt:'2026-11-07'};f.sealInputs();const result=f.run();assert.equal(result.receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',result.receipt.failureCode);assert.equal(result.receipt.nativeExecution,false);});

test('readonly admission captures dates, input identity, seven fragments and fixed fixture FD without importing it',t=>{
 const f=preparedRuntime(t);f.inputs.fixtureDates={paidAt:'2026-11-07',openingDate:'2026-11-01'};
 const extra=['services/api/prisma/task16-seed-fixture.cjs','services/api/src/database/registered-payment-postgres.fixture.ts','services/api/src/company-entity/unified-social-credit-code.ts'];
 const fragments=['funding','history-revision','write-authority','canonical-proof','intercompany','canonical-adapter','voucher'].map(n=>'services/api/prisma/prepared/task16/registered-'+n+'.sql');
 for(const file of [...extra,...fragments]){const bytes=fs.readFileSync(path.join(project,file));f.put(file,bytes);f.packet.source.files.push({path:file,sha256:hash(bytes)});}
 f.packet.installation={fragments:fragments.map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(f.root,file)))}))};const entry=f.put('services/api/dist/database/registered-payment-postgres.fixture.js',"throw new Error('UNEXPECTED_FIXTURE_IMPORT');\n");
 f.sealPacket();f.recapture('services/api/dist');for(const output of f.preparation.outputs)output.preparedManifestSha256=f.inputs.trees.find(row=>row.root===output.root).sha256;f.sealPreparation();f.sealInputs();const result=f.run();assert.equal(result.receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',result.receipt.failureCode);const witness=result.fixtureAdmission;assert.deepEqual(witness.dates,f.inputs.fixtureDates);assert.equal(witness.input.path,f.inputsFile);assert.equal(witness.input.sha256,f.options.expectedInputsSha256);assert.equal(witness.input.identity.ino,fs.statSync(f.inputsFile).ino);assert.equal(witness.entry.path,entry);assert.equal(witness.entry.identity.ino,fs.statSync(entry).ino);assert.equal(witness.fragments.length,7);assert.deepEqual(witness.fragments.map(row=>row.path),fragments);assert.equal(witness.sources.length,7);
});

test('readonly admission captures the fixed normal-case FD and source closure without importing its body',t=>{
 const f=preparedRuntime(t),extra=['services/api/prisma/task16-normal-case.cjs','services/api/prisma/task16-seed-fixture.cjs','services/api/src/database/registered-payment-postgres.cases.ts','services/api/src/database/registered-payment-postgres.fixture.ts'];for(const file of extra){const bytes=fs.readFileSync(path.join(project,file));f.put(file,bytes);f.packet.source.files.push({path:file,sha256:hash(bytes)});}const entry=f.put('services/api/dist/database/registered-payment-postgres.cases.js',"throw new Error('UNEXPECTED_NORMAL_CASE_IMPORT');\n");f.sealPacket();f.recapture('services/api/dist');for(const output of f.preparation.outputs)output.preparedManifestSha256=f.inputs.trees.find(row=>row.root===output.root).sha256;f.sealPreparation();const result=f.run();assert.equal(result.receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',result.receipt.failureCode);const witness=result.caseAdmission;assert.equal(witness.entry.path,entry);assert.equal(witness.entry.sha256,hash(fs.readFileSync(entry)));assert.equal(witness.entry.identity.ino,fs.statSync(entry).ino);assert.equal(witness.sources.length,8);assert.equal(witness.build.sourceSha,f.packet.candidateSha);assert.equal(witness.build.preparationReceiptSha256,f.inputs.preparationReceipt.sha256);
});

test('static SDK metadata refuses later compound mutation without evaluating SDK JavaScript',t=>{
 const f=preparedRuntime(t),file='services/api/node_modules/.prisma/client/index.js';
 fs.appendFileSync(path.join(f.root,file),'\nconfig.inlineSchema += "synthetic-invalid-schema";\n');f.recapture('services/api/node_modules');
 const result=f.run();assert.equal(result.receipt.status,'FAILED_CLOSED');assert.deepEqual(result.calls,[]);
 assert.equal(result.commands.filter(row=>row.args.includes('compare')).length,5);
});

test("the actual Schema205 source refuses the historical SDK204 pair before simulated resource acquisition", t => {
 const f=preparedRuntime(t,205);
 const result=f.run();
 assert.equal(result.receipt.failureCode,"TASK16_RUNTIME_SDK_SCHEMA");
 assert.deepEqual(result.calls,[]);
});

for(const mode of ['normal','model-drift','fd-drift','lost-proof','connect-fd-drift'])test(`historical inert SDK204 source witness exercises the B2/B7 protocol: ${mode}`,t=>{
 const f=preparedRuntime(t);f.hooks.clientsProtocol=mode;
 const profilePath='services/api/prisma/task16-registered-access.json';
 const plan=JSON.parse(fs.readFileSync(path.join(project,profilePath),'utf8'));
 // This private mock tree keeps the historical source/SDK pair. B5/B6 are fake
 // adapters, so this case tests the loader's FD continuity without qualifying 205.
 const historicalSchema=f.packet.source.files.find(row=>row.path===f.packet.schema.path);
 plan.sources.find(row=>row.path===historicalSchema.path).sha256=historicalSchema.sha256;
 const profileBytes=Buffer.from(JSON.stringify(plan));
 f.put(profilePath,profileBytes);
 f.packet.source.files.find(row=>row.path===profilePath).sha256=hash(profileBytes);
 for(const row of plan.sources)if(!f.packet.source.files.some(file=>file.path===row.path)){
  f.put(row.path,fs.readFileSync(path.join(project,row.path)));
  f.packet.source.files.push({path:row.path,sha256:row.sha256});
 }
 f.put('services/api/node_modules/@prisma/client/index.js',"module.exports={PrismaClient:class OwnedFakeClient{},Prisma:{prismaVersion:{client:'5.22.0',engine:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'}}};\n");
 f.packet.migrations=Array.from({length:205},(_,i)=>({path:`services/api/prisma/migrations/${String(20260101000000+i)}_synthetic/migration.sql`,sha256:'c'.repeat(64)}));f.sealPacket();f.recapture('services/api/node_modules');
 const result=f.run();assert.equal(result.receipt.nativeExecution,false);
 if(mode==='normal'){assert.equal(result.receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',JSON.stringify(result.receipt));assert.equal(result.calls.filter(x=>x.startsWith('construct-')).length,3);assert.equal(result.calls.filter(x=>x.startsWith('disconnect-')).length,3);}
 else{assert.equal(result.receipt.failureCode,'TASK16_CLIENT_SDK_SCHEMA',JSON.stringify(result.receipt));assert.equal(result.calls.filter(x=>x.startsWith('construct-')).length,mode==='connect-fd-drift'?1:0);assert.equal(result.calls.filter(x=>x.startsWith('disconnect-')).length,mode==='connect-fd-drift'?1:0);assert.equal(result.calls.includes('app'),false);}
 assert.equal(result.calls.at(-1),'close-resource');
});

for(const kind of ['inline-schema','runtime-model','generated-schema','computed-config','archive-nullability','archive-unique','evidence-model','seal-unique','approval-unique','old203-pair'])test(`whole SDK schema/model source binding rejects ${kind} drift without executing SDK`,t=>{
 const f=preparedRuntime(t),file='services/api/node_modules/.prisma/client/index.js',metadata=JSON.parse(fs.readFileSync(path.join(project,'services/api/prisma/testdata/task16-schema204-sdk-metadata.json'),'utf8'));
 const config={clientVersion:'5.22.0',engineVersion:'605197351a3c8bdd595af2d2a9bc3025bca48ea2',copyEngine:false,inlineSchema:metadata.generatedSchema};
 if(kind==='inline-schema')config.inlineSchema+='\n// second unapproved difference';
 let model=metadata.runtimeDataModelText;
 if(['runtime-model','archive-nullability','archive-unique','evidence-model','seal-unique','approval-unique'].includes(kind)){
  const value=JSON.parse(model);
  if(kind==='runtime-model')value.models.AuthRateLimit.fields[0].isRequired=!value.models.AuthRateLimit.fields[0].isRequired;
  if(kind==='archive-nullability')value.models.ContractArchiveFile.fields.find(field=>field.name==='fileId').isRequired=true;
  if(kind==='archive-unique')value.models.ContractArchiveFile.fields.find(field=>field.name==='idempotencyKey').isUnique=false;
  if(kind==='evidence-model')delete value.models.ContractArchiveEvidenceFile;
  if(kind==='seal-unique')value.models.ContractSealTask.uniqueFields=[];
  if(kind==='approval-unique')value.models.ApprovalInstance.uniqueFields=[];
  model=JSON.stringify(value);
 }
 if(kind==='old203-pair'){
  const old=JSON.parse(fs.readFileSync(path.join(project,'services/api/prisma/testdata/task16-schema203-sdk-metadata.json'),'utf8'));
  config.inlineSchema=old.generatedSchema;model=old.runtimeDataModelText;f.put('services/api/node_modules/.prisma/client/schema.prisma',old.generatedSchema);
 }
 if(kind==='generated-schema')f.put('services/api/node_modules/.prisma/client/schema.prisma',metadata.generatedSchema+'\n// unapproved generated member');
 const literal=kind==='computed-config'?JSON.stringify(config).replace('"copyEngine":false','"copyEngine":Boolean(0)'):JSON.stringify(config);
 f.put(file,`const config=${literal};\nconfig.runtimeDataModel=JSON.parse(${JSON.stringify(model)});\nthrow Error('SDK_SOURCE_MUST_NOT_EXECUTE');\n`);f.recapture('services/api/node_modules');
 const result=f.run();assert.equal(result.receipt.failureCode,'TASK16_RUNTIME_SDK_SCHEMA');assert.deepEqual(result.calls,[]);assert.equal(result.commands.filter(row=>row.args.includes('compare')).length,5);
});

for(const [name,mutation] of [
 ['nested assignment','config.runtimeDataModel.models.OperatingFact.fields[0].isRequired=false;'],
 ['alias escape','const model=config.runtimeDataModel;model.models.OperatingFact.fields[0].isRequired=false;'],
 ['reflective mutation',"Object.defineProperty(config.runtimeDataModel.models.OperatingFact.fields[0],'isRequired',{value:false});"]
])test(`SDK full-tree data shape rejects ${name} before resource acquisition`,t=>{
 const f=preparedRuntime(t),file='services/api/node_modules/.prisma/client/index.js',original=fs.readFileSync(path.join(f.root,file),'utf8');
 assert.ok(original.includes('\nthrow new Error('));f.put(file,original.replace('\nthrow new Error(',`\n${mutation}\nthrow new Error(`));f.recapture('services/api/node_modules');
 const result=f.run();assert.equal(result.receipt.failureCode,'TASK16_RUNTIME_SDK_SCHEMA');assert.deepEqual(result.calls,[]);assert.equal(result.commands.filter(row=>row.args.includes('compare')).length,5);
});

for(const kind of ['missing-relocation','wrong-model','wrong-position','comment-change','old-bridge'])test(`Schema204 exact four relocations reject ${kind} despite caller resealing source metadata`,t=>{
 const f=preparedRuntime(t),relative='services/api/prisma/task16-sdk-schema-proof.json';
 const proof=JSON.parse(fs.readFileSync(path.join(f.root,relative),'utf8')),bridge=proof.acceptedFormattingBridge;
 if(kind==='missing-relocation')bridge.relocations.pop();
 if(kind==='wrong-model')bridge.relocations[1].model='Contract';
 if(kind==='wrong-position')bridge.relocations[3].sourceIndexAfterPriorRemovals++;
 if(kind==='comment-change')bridge.relocations[1].exactTokenSequence[0][1]+=' changed';
 if(kind==='old-bridge')bridge.kind='exact-single-ExpenseClaim-index-relocation';
 const bytes=JSON.stringify(proof);f.put(relative,bytes);f.packet.source.files.find(row=>row.path===relative).sha256=hash(bytes);f.sealPacket();
 const result=f.run();assert.equal(result.receipt.failureCode,'TASK16_RUNTIME_SDK_SCHEMA');assert.deepEqual(result.calls,[]);
});
