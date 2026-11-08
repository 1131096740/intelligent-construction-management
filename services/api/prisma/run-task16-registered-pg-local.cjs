"use strict";

// B2: dedicated normal-case lifecycle plus runtime-input admission source. No command runs on import.
// Source adapter presence is not permission to execute. The fixed native
// SOURCE_ONLY gate requires a separately authorized and reviewed source change;
// packets, options and approval-reference strings cannot open it.
const Module = require("node:module");
const EARLY_LOADER = Object.freeze({
 freshCli: require.main===module && process.argv[1]===__filename && process.execArgv.length===0 && !process.env.NODE_OPTIONS && !process.env.NODE_PATH && !(process._preload_modules?.length) && Object.keys(require.cache).every(file=>file===__filename),
 hooks:Object.freeze({load:Module._load,resolve:Module._resolveFilename,find:Module._findPath,require:Module.prototype.require,extensions:Object.freeze(Object.fromEntries([".js",".json",".node"].map(ext=>[ext,Module._extensions[ext]])))})
});
const EARLY_DRIVER_SHA=require("./task16-runtime-inputs.cjs").readQualifiedTask16File(__filename,{maxBytes:64*1024*1024,code:"TASK16_DRIVER_SOURCE_FILE"}).sha256;
// Pure controller modules only; legacy source-only fixtures may not contain the
// bridge. Failed import never becomes an available native adapter.
const NATIVE_APPLICATION_STAGE=(()=>{try{return require("./task16-application-stage.cjs").startTask16Application;}catch{return undefined;}})();
const EARLY_FETCH=Object.getOwnPropertyDescriptor(globalThis,"fetch");
const EARLY_FETCH_SOURCE=process.binding('natives')['internal/bootstrap/web/exposed-window-or-worker'];
const FETCH_BEGIN=typeof EARLY_FETCH_SOURCE==='string'?EARLY_FETCH_SOURCE.indexOf('value: function fetch('):-1;
const FETCH_END=FETCH_BEGIN<0?-1:EARLY_FETCH_SOURCE.indexOf('\n});',FETCH_BEGIN);
const EARLY_FETCH_QUALIFIED=Boolean(EARLY_FETCH&&Object.hasOwn(EARLY_FETCH,'value')&&typeof EARLY_FETCH.value==='function'&&EARLY_FETCH.writable&&EARLY_FETCH.enumerable&&EARLY_FETCH.configurable&&FETCH_BEGIN>=0&&FETCH_END>FETCH_BEGIN&&Function.prototype.toString.call(EARLY_FETCH.value)===EARLY_FETCH_SOURCE.slice(FETCH_BEGIN+7,FETCH_END-1));
const NATIVE_SEED_MODULE=(()=>{try{return require('./task16-seed-fixture.cjs');}catch{return undefined;}})();
const NATIVE_SEED_STAGE=NATIVE_SEED_MODULE?.seedTask16Fixture;
const NATIVE_SEED_ADMISSION=NATIVE_SEED_MODULE?.validateTask16SeedAdmission;
const NATIVE_SEED_RELEASE=NATIVE_SEED_MODULE?.releaseTask16SeedHandoff;
const NATIVE_CASE_MODULE=(()=>{try{return require('./task16-normal-case.cjs');}catch{return undefined;}})();
const NATIVE_CASE_STAGE=NATIVE_CASE_MODULE?.runTask16NormalCase;
const NATIVE_CASE_ADMISSION=NATIVE_CASE_MODULE?.validateTask16CaseAdmission;
let nativeAttempted=false;
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");

const CASE_ID = "registered.null-cross-company.commit";
const REQUIRED = ["verifySource", "startResource", "verifyOwnerTransport", "migrateBaseline", "installBaselineAccess", "installPreparedSql", "installRegisteredAccess", "connectRestrictedClients", "startApplication", "seedFixture", "runNormalCase"];
const fault = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fault(code); };

function nativeAdapters() {
  return {
    async verifySource(context) {
      const { verifyTask16RuntimeInputs } = require("./task16-runtime-inputs.cjs");
      return verifyTask16RuntimeInputs(context.options, context.readOnlyCommand);
    },
    async startResource(context) {
      const { startTask01Postgres } = require("./enterprise-task01-resources.cjs");
      const { resourceOptions } = context.source.inputs;
      return startTask01Postgres({ ...resourceOptions, runId: context.runId, sourceSha: context.source.candidateSha,
        artifactsDir: path.join(context.options.artifactsDir, "resource-private"), ownerPassword: context.credentials.owner, signal: context.signal });
    },
    async verifyOwnerTransport(context, command) {
      const { verifyTask16OwnerTls } = require("./task16-owner-tls.cjs");
      return verifyTask16OwnerTls(context, command);
    },
    async migrateBaseline(context, command, processBoundary) {
      const { migrateTask16Baseline } = require("./task16-baseline-migrations.cjs");
      return migrateTask16Baseline(context, command, processBoundary);
    },
    async installBaselineAccess(context) {
      const { installTask16BaselineAccess } = require("./task16-baseline-access.cjs");
      return installTask16BaselineAccess(context);
    },
    async installPreparedSql(context) {
      const {installTask16PreparedStage}=require("./task16-prepared-install-stage.cjs");
      return installTask16PreparedStage(context);
    },
    async installRegisteredAccess(context) {
      const {installTask16RegisteredAccess}=require("./task16-registered-access.cjs");
      return installTask16RegisteredAccess(context);
    },
    async connectRestrictedClients(context,boundary) {
      const {connectTask16RestrictedClients}=require("./task16-restricted-clients.cjs");
      return connectTask16RestrictedClients(context,boundary);
    },
    startApplication: NATIVE_APPLICATION_STAGE,
    seedFixture: NATIVE_SEED_STAGE,
    runNormalCase: NATIVE_CASE_STAGE
  };
}

function validateOptions(options) {
  need(options && typeof options === "object", "TASK16_DRIVER_ARGUMENTS");
  for (const key of ["packetFile", "inputsFile", "artifactsDir"]) need(typeof options[key] === "string" && options[key].startsWith("/private/tmp/") && path.normalize(options[key]) === options[key], "TASK16_DRIVER_PATH");
  for (const key of ["expectedPacketSha256", "expectedInputsSha256"]) need(typeof options[key] === "string" && /^[a-f0-9]{64}$/u.test(options[key]), "TASK16_DRIVER_DIGEST");
}

function resourceReceipt(resource, failure) {
  let receipt;
  try { receipt = resource?.getReceipt?.() ?? failure?.resourceReceipt; } catch { return { status: "receipt-unavailable", cleanup: { status: "unknown" } }; }
  if (!receipt) return { status: "not-created", cleanup: { status: "not-needed" } };
  return { status: receipt.status, runId: receipt.runId, containerId: receipt.containerId, networkId: receipt.networkId,
    cleanup: { status: receipt.cleanup?.status, containerAbsent: receipt.cleanup?.containerAbsent === true,
      volumesAbsent: receipt.cleanup?.volumesAbsent === true, networkAbsent: receipt.cleanup?.networkAbsent === true } };
}

/** Public seam for approved protocol simulations. Injected adapters can never
 * produce native acceptance. A live call still requires separate authorization,
 * sealed source/dependencies and complete real adapters; missing native stages
 * still reject before source reads or resource acquisition. */
async function runTask16RegisteredPg(options, injectedAdapters) {
  const simulation = injectedAdapters !== undefined;
  const fetchDescriptor=simulation?Object.getOwnPropertyDescriptor(globalThis,"fetch"):EARLY_FETCH;
  const seedTransport=fetchDescriptor&&Object.hasOwn(fetchDescriptor,"value")?fetchDescriptor.value:undefined;
  const seedTransportIsBuiltin=typeof seedTransport==='function'&&((EARLY_FETCH_QUALIFIED&&seedTransport===EARLY_FETCH.value)||(typeof EARLY_FETCH_SOURCE==='string'&&EARLY_FETCH_SOURCE.includes(Function.prototype.toString.call(seedTransport))));
  const adapters = injectedAdapters === undefined ? nativeAdapters() : { ...injectedAdapters, verifySource: injectedAdapters.verifySource ?? nativeAdapters().verifySource };
  if (injectedAdapters?.migrateBaseline && typeof injectedAdapters.migrateBaseline === "object" && Object.keys(injectedAdapters.migrateBaseline).join(",") === "command" && typeof injectedAdapters.migrateBaseline.command === "function") {
    const command = injectedAdapters.migrateBaseline.command;
    adapters.migrateBaseline = context => nativeAdapters().migrateBaseline(context, command);
  }
  if (injectedAdapters?.migrateBaseline && typeof injectedAdapters.migrateBaseline === "object" && Object.keys(injectedAdapters.migrateBaseline).join(",") === "process") {
    const boundary = injectedAdapters.migrateBaseline.process;
    const keys = ["spawn", "groupSignal", "groupExists", "setTimer", "clearTimer"];
    if (boundary && Object.keys(boundary).length === keys.length && keys.every(key => typeof boundary[key] === "function")) {
      const fixed = Object.fromEntries(keys.map(key => [key, boundary[key]]));
      adapters.migrateBaseline = context => nativeAdapters().migrateBaseline(context, undefined, fixed);
    }
  }

  if (injectedAdapters?.verifyOwnerTransport && typeof injectedAdapters.verifyOwnerTransport === "object" && Object.keys(injectedAdapters.verifyOwnerTransport).join(",") === "command" && typeof injectedAdapters.verifyOwnerTransport.command === "function") {
    const command = injectedAdapters.verifyOwnerTransport.command;
    adapters.verifyOwnerTransport = context => nativeAdapters().verifyOwnerTransport(context, command);
  }

  if(injectedAdapters?.connectRestrictedClients && typeof injectedAdapters.connectRestrictedClients==="object") {
    const boundary=injectedAdapters.connectRestrictedClients;
    if(Object.keys(boundary).sort().join(",")==="command,createClient"&&[boundary.command,boundary.createClient].every(fn=>typeof fn==="function")) {
      const fixed={command:boundary.command,createClient:boundary.createClient};
      adapters.connectRestrictedClients=context=>nativeAdapters().connectRestrictedClients(context,fixed);
    }
  }
  // The original spread above already captured the outer adapter value. This
  // new boundary must not read that caller property a second time.
  const applicationBoundary=adapters.startApplication;
  if(applicationBoundary && typeof applicationBoundary==="object") {
    try {
      const descriptors=Object.getOwnPropertyDescriptors(applicationBoundary),keys=Reflect.ownKeys(descriptors);
      if(keys.length===2&&keys.every(key=>typeof key==="string")&&keys.sort().join(",")==="createTestingModule,loadModules"&&keys.every(key=>Object.hasOwn(descriptors[key],"value")&&typeof descriptors[key].value==="function")) {
        const fixed=Object.freeze(Object.fromEntries(keys.map(key=>[key,descriptors[key].value])));
        adapters.startApplication=context=>require("./task16-application-factory.cjs").createTask16Application(context,fixed);
      }
    } catch { /* Invalid factory metadata stays non-callable: safe missing capability, no fallback. */ }
  }
  const nativeCaseSelected=typeof NATIVE_CASE_STAGE==='function'&&adapters.runNormalCase===NATIVE_CASE_STAGE;
  const nativeSeedSelected=typeof NATIVE_SEED_STAGE==='function'&&adapters.seedFixture===NATIVE_SEED_STAGE;
  const nativeApplicationSelected=typeof NATIVE_APPLICATION_STAGE==="function"&&adapters.startApplication===NATIVE_APPLICATION_STAGE;
  const stages = [];
  const receipt = { status: "FAILED_CLOSED", nativeExecution: false, financialAcceptance: false, caseId: CASE_ID,
    appStartupOutcome:"NOT_ATTEMPTED",appCleanupOutcome:"NOT_NEEDED",
    sourceSha: null, stages, cleanupFailures: [], missingCapabilities: [], failureCode: null, migrationOutcome: "NOT_ATTEMPTED", installationOutcome: "NOT_ATTEMPTED", ownerRestorationOutcome: "NOT_NEEDED", ownerPrivateErasureOutcome: "NOT_NEEDED", baselineAccessOutcome: "NOT_ATTEMPTED", registeredAccessOutcome: "NOT_ATTEMPTED", clientConnectionOutcome:"NOT_ATTEMPTED", clientCleanupOutcome:"NOT_NEEDED" };
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  const context = { options, runId: randomUUID(), signal: controller.signal, readOnlyCommand: simulation ? injectedAdapters.readOnlyCommand : undefined,
    credentials: { owner: randomBytes(48).toString("hex"), runtime: randomBytes(48).toString("hex"), observer: randomBytes(48).toString("hex") } };
  Object.defineProperties(context,{nativeLoaderFacts:{value:EARLY_LOADER,writable:false},simulation:{value:simulation,writable:false}});
  const nativeReentry=!simulation&&nativeAttempted;
  if(!simulation)nativeAttempted=true;
  let failed;
  let normalCaseCompleted = false;
  async function stage(name) {
    need(!controller.signal.aborted, "TASK16_DRIVER_ABORTED");
    const record = { name, status: "running" }; stages.push(record);
    try { const result = await adapters[name](context); record.status = "completed"; return result; }
    catch (error) { record.status = "failed"; throw error; }
  }
  try {
    validateOptions(options);
    need(!nativeReentry,"TASK16_DRIVER_NATIVE_REENTRY");
    if (options.signal !== undefined) {
      need(options.signal instanceof AbortSignal, "TASK16_DRIVER_SIGNAL");
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
      if (options.signal.aborted) onCallerAbort();
    }
    receipt.missingCapabilities = REQUIRED.filter(name => typeof adapters[name] !== "function");
    need(receipt.missingCapabilities.length === 0, "TASK16_DRIVER_CAPABILITIES_INCOMPLETE");
    // Fixed source-only boundary: no input can authorize native execution.
    // Explicit adapters remain simulated and cannot produce financial acceptance.
    need(simulation, "TASK16_DRIVER_SOURCE_ONLY");
    if(!simulation)need(EARLY_LOADER.freshCli===true,"TASK16_DRIVER_FRESH_CLI_REQUIRED");
    context.source = await stage("verifySource");
    const clientEntryWitness=structuredClone(context.source?.runtimeAdmission?.clientEntry);
    if(clientEntryWitness?.identity)Object.freeze(clientEntryWitness.identity);
    if(clientEntryWitness)Object.freeze(clientEntryWitness);
    Object.defineProperty(context,"clientEntryWitness",{value:clientEntryWitness,writable:false,enumerable:false});
    const applicationEntries=structuredClone(context.source?.runtimeAdmission?.applicationEntries);
    if(applicationEntries){for(const row of applicationEntries){if(row.identity)Object.freeze(row.identity);Object.freeze(row);}Object.freeze(applicationEntries);}
    Object.defineProperty(context,"applicationEntriesWitness",{value:applicationEntries,writable:false,configurable:false});
    const applicationBuild=structuredClone(context.source?.runtimeAdmission?.applicationBuild);
    if(applicationBuild)Object.freeze(applicationBuild);
    Object.defineProperty(context,"applicationBuildWitness",{value:applicationBuild,writable:false,configurable:false});
    if(nativeApplicationSelected) {
      need(applicationEntries?.length===8&&applicationBuild&&context.source.candidateRoot===path.resolve(__dirname,"../../..")
        &&applicationBuild.candidateRoot===context.source.candidateRoot&&applicationBuild.sourceSha===context.source.candidateSha&&applicationBuild.sourceSealSha256===context.source.sealSha256
        &&applicationBuild.preparationReceiptSha256===context.source.inputs?.preparationReceipt?.sha256
        &&applicationBuild.apiDistManifestSha256===context.source.inputs?.trees?.find(row=>row.root==="services/api/dist")?.sha256,"TASK16_DRIVER_APP_ADMISSION");
      const read=require("./task16-runtime-inputs.cjs").readQualifiedTask16File;
      const relative=["database/task16-registered-application.module.js","database/prisma.service.js","api-security.js","operating-projection/projection-export-json.js","api-json-replacer.js","validation/api-validation.js","api-listen.js"];
      for(let i=0;i<8;i++){const row=applicationEntries[i];need(row&&typeof row.path==="string"&&row.identity&&/^[a-f0-9]{64}$/u.test(row.sha256)&&(i===7?row.path.startsWith(context.source.candidateRoot+path.sep)&&/\/node_modules\/@nestjs\/testing\/test\.js$/u.test(row.path):row.path===path.join(context.source.candidateRoot,'services/api/dist',relative[i])),"TASK16_DRIVER_APP_ADMISSION");need(read(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:"TASK16_DRIVER_APP_ADMISSION"}).sha256===row.sha256,"TASK16_DRIVER_APP_ADMISSION");}
      need(read(context.source.inputs.preparationReceipt.path,{maxBytes:16*1024*1024,privateFile:true,code:"TASK16_DRIVER_APP_ADMISSION"}).sha256===applicationBuild.preparationReceiptSha256,"TASK16_DRIVER_APP_ADMISSION");
    }

    if(!simulation)need(context.source.executionFiles?.some(row=>row.path==="services/api/prisma/run-task16-registered-pg-local.cjs"&&row.sha256===EARLY_DRIVER_SHA),"TASK16_DRIVER_RUNNING_SOURCE_CHANGED");
    need(context.source && /^[a-f0-9]{40}$/u.test(context.source.candidateSha), "TASK16_DRIVER_SOURCE_IDENTITY");
    receipt.sourceSha = context.source.candidateSha;
    const fixtureAdmission=structuredClone(context.source?.runtimeAdmission?.fixture);
    const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
    Object.defineProperty(context,'seedAdmissionWitness',{value:freeze(fixtureAdmission),writable:false,configurable:false});
    Object.defineProperty(context,'normalCaseAdmissionWitness',{value:freeze(structuredClone(context.source?.runtimeAdmission?.normalCase)),writable:false,configurable:false});
    Object.defineProperty(context,'seedTransportWitness',{value:Object.freeze({fetch:seedTransport,simulation,qualified:simulation?typeof seedTransport==='function'&&!seedTransportIsBuiltin:EARLY_FETCH_QUALIFIED}),writable:false,configurable:false});
    if(nativeSeedSelected)NATIVE_SEED_ADMISSION(context);
    if(nativeCaseSelected){need(nativeSeedSelected&&nativeApplicationSelected,'TASK16_DRIVER_CASE_STAGE_LINEAGE');NATIVE_CASE_ADMISSION(context);}
    context.resource = await stage("startResource");
    need(typeof context.resource?.close === "function" && typeof context.resource?.getReceipt === "function", "TASK16_DRIVER_RESOURCE_HANDLE");
    const initialReceipt=structuredClone(context.resource.getReceipt());
    const witness=Object.freeze(Object.fromEntries(["runId","sourceSha","containerId","networkId","daemonId","endpoint","imageId","databaseName","port"].map(key=>[key,initialReceipt[key]])));
    Object.defineProperty(context,"resourceWitness",{value:witness,writable:false,configurable:false,enumerable:true});
    context.ownerTransport = await stage("verifyOwnerTransport");
    if (context.ownerTransport?.ownerPrivateErasureOutcome === "ERASED") receipt.ownerPrivateErasureOutcome = "ERASED";
    if (context.ownerTransport?.ownerRestorationOutcome === "CORRECT_PRESENTATION_RESTORED") receipt.ownerRestorationOutcome = "CORRECT_PRESENTATION_RESTORED";
    receipt.migrationOutcome = "UNKNOWN_DO_NOT_RETRY";
    context.migrations = await stage("migrateBaseline");
    receipt.migrationOutcome = "MIGRATION_STAGE_RETURNED_NOT_FULL_ACCEPTANCE";
    receipt.baselineAccessOutcome = "UNKNOWN_DO_NOT_RETRY";
    context.baselineAccess = await stage("installBaselineAccess");
    receipt.baselineAccessOutcome = "BASELINE_STAGE_RETURNED_NOT_FULL_ACCEPTANCE";
    receipt.installationOutcome = "UNKNOWN_DO_NOT_RETRY";
    context.installation = await stage("installPreparedSql");
    receipt.installationOutcome = "INSTALLATION_STAGE_RETURNED_NOT_FULL_ACCEPTANCE";
    receipt.registeredAccessOutcome = "UNKNOWN_DO_NOT_RETRY";
    context.registeredAccess = await stage("installRegisteredAccess");
    receipt.registeredAccessOutcome = "REGISTERED_STAGE_RETURNED_NOT_FULL_ACCEPTANCE";
    receipt.clientConnectionOutcome="UNKNOWN_DO_NOT_RETRY";
    context.clients = await stage("connectRestrictedClients");
    receipt.clientConnectionOutcome="CLIENT_STAGE_RETURNED_NOT_FULL_ACCEPTANCE";
    need(typeof context.clients?.close === "function", "TASK16_DRIVER_CLIENT_HANDLES");
    const lifecycleDescriptors=Object.getOwnPropertyDescriptors(context.clients),lifecycleMethods=["checkLight","verifyFull","loadApplicationModules"];
    if(lifecycleMethods.every(key=>Object.hasOwn(lifecycleDescriptors[key]??{},"value")&&typeof lifecycleDescriptors[key].value==="function")) {
      need(["owner","runtime","observer"].every(key=>Object.hasOwn(lifecycleDescriptors[key]??{},"value")),"TASK16_DRIVER_CLIENT_WITNESS");
      const binding=lifecycleDescriptors.sourceBinding;need(binding&&Object.hasOwn(binding,"value"),"TASK16_DRIVER_CLIENT_WITNESS");
      const bindingDescriptors=Object.getOwnPropertyDescriptors(binding.value),bindingKeys=["sourceSha","sourceSealSha256","registeredManifestSha256"];
      need(bindingKeys.every(key=>Object.hasOwn(bindingDescriptors[key]??{},"value")&&typeof bindingDescriptors[key].value==="string"),"TASK16_DRIVER_CLIENT_WITNESS");
      const sourceBinding=Object.freeze(Object.fromEntries(bindingKeys.map(key=>[key,bindingDescriptors[key].value])));
      Object.defineProperty(context,"clientLifecycleWitness",{value:Object.freeze({handle:context.clients,bindingObject:binding.value,sourceBinding,

        ...Object.fromEntries([...lifecycleMethods,"owner","runtime","observer"].map(key=>[key,lifecycleDescriptors[key].value])),
        loadNormalCaseModules:lifecycleDescriptors.loadNormalCaseModules?.value,
        loadFixtureModules:lifecycleDescriptors.loadFixtureModules?.value}),writable:false,configurable:false});
    }
    receipt.appStartupOutcome="UNKNOWN_DO_NOT_RETRY";
    context.application = await stage("startApplication");
    receipt.appStartupOutcome="APP_STAGE_RETURNED_NOT_FULL_PROOF";
    need(typeof context.application?.close === "function", "TASK16_DRIVER_APPLICATION_HANDLE");
    if(nativeApplicationSelected){
      const descriptors=Object.getOwnPropertyDescriptors(context.application),keys=['inspect','close','origin','runtime','sourceBinding'];
      need(keys.every(key=>Object.hasOwn(descriptors[key]??{},'value'))&&typeof descriptors.inspect.value==='function','TASK16_DRIVER_APP_WITNESS');
      Object.defineProperty(context,'applicationLifecycleWitness',{value:Object.freeze({handle:context.application,...Object.fromEntries(keys.map(key=>[key,descriptors[key].value])),sourceHeader:Object.freeze({...descriptors.sourceBinding.value})}),writable:false,configurable:false});
    }
    context.fixture = await stage("seedFixture");
    const result = await stage("runNormalCase");
    need(!controller.signal.aborted, "TASK16_DRIVER_ABORTED");
    need(result?.caseId === CASE_ID && result.passed === true, "TASK16_DRIVER_NORMAL_CASE_FAILED");
    normalCaseCompleted = true;
  } catch (error) {
    failed = error;
    for(const [field,allowed]of [["appStartupOutcome",["NOT_ATTEMPTED","UNKNOWN_DO_NOT_RETRY"]],["appCleanupOutcome",["NOT_NEEDED","APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF","UNKNOWN_DO_NOT_CONTINUE"]]]) {
      let value;try { value=error?.[field]; } catch { /* Never relay getter exceptions. */ }
      if(allowed.includes(value))receipt[field]=value;
    }
    if(receipt.appCleanupOutcome==="UNKNOWN_DO_NOT_CONTINUE")receipt.cleanupFailures.push("application");
    let normalCaseOutcome;try{normalCaseOutcome=error?.normalCaseOutcome;}catch{ /* Discard untrusted getter exceptions. */ }
    if(['NOT_ATTEMPTED','UNKNOWN_DO_NOT_RETRY'].includes(normalCaseOutcome))receipt.normalCaseOutcome=normalCaseOutcome;
    let fixtureOutcome;
    try { fixtureOutcome = error?.fixtureOutcome; } catch { /* Discard untrusted getter exceptions. */ }
    if (["NOT_ATTEMPTED", "UNKNOWN_DO_NOT_RETRY"].includes(fixtureOutcome)) receipt.fixtureOutcome = fixtureOutcome;
    if(["NOT_ATTEMPTED","UNKNOWN_DO_NOT_RETRY"].includes(error?.clientConnectionOutcome))receipt.clientConnectionOutcome=error.clientConnectionOutcome;
    if(["NOT_NEEDED","DISCONNECTED","UNKNOWN_DO_NOT_CONTINUE"].includes(error?.clientCleanupOutcome))receipt.clientCleanupOutcome=error.clientCleanupOutcome;
    if(error?.clientCleanupOutcome==="UNKNOWN_DO_NOT_CONTINUE")receipt.cleanupFailures.push("clients");
    if (["NOT_ATTEMPTED", "UNKNOWN_DO_NOT_RETRY"].includes(error?.installationOutcome)) receipt.installationOutcome = error.installationOutcome;
    if (["NOT_ATTEMPTED", "UNKNOWN_DO_NOT_RETRY"].includes(error?.registeredAccessOutcome)) receipt.registeredAccessOutcome = error.registeredAccessOutcome;
    if (["NOT_ATTEMPTED", "UNKNOWN_DO_NOT_RETRY"].includes(error?.baselineAccessOutcome)) receipt.baselineAccessOutcome = error.baselineAccessOutcome;
    if (["NOT_NEEDED", "PENDING", "ERASED", "UNKNOWN_DO_NOT_CONTINUE"].includes(error?.ownerPrivateErasureOutcome)) receipt.ownerPrivateErasureOutcome = error.ownerPrivateErasureOutcome;
    if (["NOT_NEEDED", "RESTORE_REQUIRED", "CORRECT_PRESENTATION_RESTORED", "UNKNOWN_DO_NOT_CONTINUE"].includes(error?.ownerRestorationOutcome)) receipt.ownerRestorationOutcome = error.ownerRestorationOutcome;
    if (["NOT_ATTEMPTED", "UNKNOWN_DO_NOT_RETRY"].includes(error?.migrationOutcome)) receipt.migrationOutcome = error.migrationOutcome;
    receipt.failureCode = typeof error?.code === "string" && /^(?:TASK16|TASK01)_[A-Z0-9_]+$/u.test(error.code) ? error.code : "TASK16_DRIVER_STAGE_FAILED";
  } finally {
    if(typeof NATIVE_SEED_RELEASE==='function'){try{NATIVE_SEED_RELEASE(context);}catch{receipt.cleanupFailures.push('fixture-private-handoff');}}
    options?.signal?.removeEventListener?.("abort", onCallerAbort);
    controller.abort();
    for (const [name, handle] of [["application", context.application], ["clients", context.clients], ["resource", context.resource]]) {
      if (!handle) continue;
      try { need(typeof handle.close === "function", "TASK16_DRIVER_CLEANUP_HANDLE"); await handle.close(); if(name==="application"&&receipt.appCleanupOutcome!=="UNKNOWN_DO_NOT_CONTINUE")receipt.appCleanupOutcome="APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF"; if(name==="clients")receipt.clientCleanupOutcome="CLIENT_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF"; }
      catch { receipt.cleanupFailures.push(name); if(name==="application")receipt.appCleanupOutcome="UNKNOWN_DO_NOT_CONTINUE"; if(name==="clients")receipt.clientCleanupOutcome="UNKNOWN_DO_NOT_CONTINUE"; }
    }
    receipt.resource = resourceReceipt(context.resource, failed);
    if (context.resource || failed?.resourceReceipt) {
      const final = receipt.resource;
      if (final.status !== "closed" || final.cleanup.status !== "completed" || !["containerAbsent", "volumesAbsent", "networkAbsent"].every(key => final.cleanup[key] === true)) receipt.cleanupFailures.push("resource-proof");
    }
    for (const key of Object.keys(context.credentials)) context.credentials[key] = undefined;
  }
  if (receipt.cleanupFailures.length) receipt.failureCode ||= "TASK16_DRIVER_CLEANUP_FAILED";
  if (normalCaseCompleted && !receipt.failureCode) receipt.status = simulation ? "SIMULATED_CASE_PROTOCOL_COMPLETED" : "NORMAL_CASE_COMPLETED_NOT_FULL_ACCEPTANCE";
  receipt.nativeExecution = !simulation && normalCaseCompleted && !receipt.failureCode;
  return receipt;
}

function parse(args) {
  need(args.length === 10 && args[0] === "--packet" && args[2] === "--packet-sha256" && args[4] === "--inputs" && args[6] === "--inputs-sha256" && args[8] === "--artifacts", "TASK16_DRIVER_ARGUMENTS");
  return { packetFile: args[1], expectedPacketSha256: args[3], inputsFile: args[5], expectedInputsSha256: args[7], artifactsDir: args[9] };
}

if (require.main === module) {
  Promise.resolve().then(() => runTask16RegisteredPg(parse(process.argv.slice(2)))).then(receipt => {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.status !== "NORMAL_CASE_COMPLETED_NOT_FULL_ACCEPTANCE") process.exitCode = 1;
  }).catch(() => { process.stdout.write(`${JSON.stringify({ status: "FAILED_CLOSED", failureCode: "TASK16_DRIVER_ARGUMENTS", nativeExecution: false, financialAcceptance: false })}\n`); process.exitCode = 1; });
}
module.exports = { runTask16RegisteredPg };
