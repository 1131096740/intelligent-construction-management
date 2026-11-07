"use strict";

// B2: dedicated normal-case lifecycle plus runtime-input admission source. No command runs on import.
// Native execution remains disabled until every required adapter is implemented
// and independently reviewed. Source packets and approval-reference strings are
// not authority to create resources or execute SQL.
const Module = require("node:module");
const EARLY_LOADER = Object.freeze({
 freshCli: require.main===module && process.argv[1]===__filename && process.execArgv.length===0 && !process.env.NODE_OPTIONS && !process.env.NODE_PATH && !(process._preload_modules?.length) && Object.keys(require.cache).every(file=>file===__filename),
 hooks:Object.freeze({load:Module._load,resolve:Module._resolveFilename,find:Module._findPath,require:Module.prototype.require,extensions:Object.freeze(Object.fromEntries([".js",".json",".node"].map(ext=>[ext,Module._extensions[ext]])))})
});
const EARLY_DRIVER_SHA=require("./task16-runtime-inputs.cjs").readQualifiedTask16File(__filename,{maxBytes:64*1024*1024,code:"TASK16_DRIVER_SOURCE_FILE"}).sha256;
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
    }
    // Unimplemented stages are absent, never no-op functions returning success.
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
  const stages = [];
  const receipt = { status: "FAILED_CLOSED", nativeExecution: false, financialAcceptance: false, caseId: CASE_ID,
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
    if(!simulation)need(EARLY_LOADER.freshCli===true,"TASK16_DRIVER_FRESH_CLI_REQUIRED");
    context.source = await stage("verifySource");
    const clientEntryWitness=structuredClone(context.source?.runtimeAdmission?.clientEntry);
    if(clientEntryWitness?.identity)Object.freeze(clientEntryWitness.identity);
    if(clientEntryWitness)Object.freeze(clientEntryWitness);
    Object.defineProperty(context,"clientEntryWitness",{value:clientEntryWitness,writable:false,enumerable:false});
    if(!simulation)need(context.source.executionFiles?.some(row=>row.path==="services/api/prisma/run-task16-registered-pg-local.cjs"&&row.sha256===EARLY_DRIVER_SHA),"TASK16_DRIVER_RUNNING_SOURCE_CHANGED");
    need(context.source && /^[a-f0-9]{40}$/u.test(context.source.candidateSha), "TASK16_DRIVER_SOURCE_IDENTITY");
    receipt.sourceSha = context.source.candidateSha;
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
    context.application = await stage("startApplication");
    need(typeof context.application?.close === "function", "TASK16_DRIVER_APPLICATION_HANDLE");
    context.fixture = await stage("seedFixture");
    const result = await stage("runNormalCase");
    need(!controller.signal.aborted, "TASK16_DRIVER_ABORTED");
    need(result?.caseId === CASE_ID && result.passed === true, "TASK16_DRIVER_NORMAL_CASE_FAILED");
    normalCaseCompleted = true;
  } catch (error) {
    failed = error;
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
    options?.signal?.removeEventListener?.("abort", onCallerAbort);
    controller.abort();
    for (const [name, handle] of [["application", context.application], ["clients", context.clients], ["resource", context.resource]]) {
      if (!handle) continue;
      try { need(typeof handle.close === "function", "TASK16_DRIVER_CLEANUP_HANDLE"); await handle.close(); if(name==="clients")receipt.clientCleanupOutcome="CLIENT_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF"; }
      catch { receipt.cleanupFailures.push(name); if(name==="clients")receipt.clientCleanupOutcome="UNKNOWN_DO_NOT_CONTINUE"; }
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
