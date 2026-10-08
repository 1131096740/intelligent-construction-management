import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zeroingCore from "../../services/api/scripts/business-zeroing-core.cjs";

// A control-plane engine, not a production transport. Adapters are trusted code:
// requests cannot supply commands, verification keys, URLs, or runtime paths.
const receiptTool = fileURLToPath(new URL("./local-release-receipt.mjs", import.meta.url));
const coordinateKeys = [
  "databaseFingerprint", "migrationSetSha256", "migrationChecksumSha256",
  "schemaDigest", "runtimeRoleSha256", "objectVersionsSha256"
];
const readOnlyChecks = [
  "liveness", "readiness", "roles", "permissions", "privateFileRead", "pages",
  "writeDenied", "failurePause"
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const documentSha256 = (value) => sha256(JSON.stringify(value));
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const projectCoordinates = (value) => Object.fromEntries(coordinateKeys.map((key) => [key, value[key]]));
class ActivationError extends Error {}

function requireCondition(condition, code) {
  if (!condition) {
    const error = new ActivationError(code);
    error.code = code;
    throw error;
  }
}

function publicKey(key) {
  return key?.type === "public" ? key : createPublicKey(key);
}

function readEnvelope(envelope, key) {
  try {
    const anchor = publicKey(key);
    requireCondition(anchor.asymmetricKeyType === "ed25519", "TRUST_ANCHOR");
    const signature = typeof envelope?.signature === "string" ? Buffer.from(envelope.signature, "base64") : Buffer.alloc(0);
    requireCondition(
      envelope && Object.keys(envelope).sort().join(",") === "payload,signature" &&
      signature.length === 64 && signature.toString("base64") === envelope.signature &&
      verify(null, Buffer.from(JSON.stringify(envelope.payload)), anchor, signature),
      "EVIDENCE_SIGNATURE"
    );
    return envelope.payload;
  } catch {
    requireCondition(false, "EVIDENCE_SIGNATURE");
  }
}

function validateWindow(document, request, now) {
  for (const field of ["environment", "deploymentId", "windowId", "candidateSha"]) {
    requireCondition(typeof request[field] === "string" && request[field].length > 0 && document[field] === request[field], "WINDOW_BINDING");
  }
  const issued = Date.parse(document.issuedAt);
  const expires = Date.parse(document.expiresAt);
  requireCondition(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && now < expires && issued < expires, "WINDOW_EXPIRED");
}

function validateInputs(request, adapter) {
  const now = adapter.now().getTime();
  requireCondition(Number.isFinite(now), "WINDOW_EXPIRED");
  requireCondition(/^[a-f0-9]{40}$/u.test(request.candidateSha), "CANDIDATE_IDENTITY");
  requireCondition(adapter.identity.executionScope === "isolated-local", "PRODUCTION_TRANSPORT_UNAVAILABLE");
  for (const field of ["environment", "deploymentId"]) {
    requireCondition(request[field] === adapter.identity[field], "ENVIRONMENT_BINDING");
  }
  const authorizationAnchor = publicKey(adapter.authority.authorizationPublicKey);
  const evidenceAnchor = publicKey(adapter.authority.evidencePublicKey);
  requireCondition(
    !authorizationAnchor.export({ format: "der", type: "spki" }).equals(evidenceAnchor.export({ format: "der", type: "spki" })),
    "TRUST_ANCHOR"
  );
  const authorization = readEnvelope(request.authorization, authorizationAnchor);
  const evidence = readEnvelope(request.evidence, evidenceAnchor);
  requireCondition(
    authorization.schemaVersion === 1 && authorization.purpose === "pol25b_activation_authorization" &&
    evidence.schemaVersion === 1 && evidence.purpose === "pol25b_upstream_validation", "EVIDENCE_PROTOCOL"
  );
  validateWindow(authorization, request, now);
  validateWindow(evidence, request, now);
  requireCondition(
    Array.isArray(authorization.scope) && authorization.scope.length === 2 &&
    new Set(authorization.scope).size === 2 &&
    authorization.scope.includes("activate-api-web") && authorization.scope.includes("restore-runtime-files") &&
    isDigest(authorization.coordinatedRecoveryPlanSha256),
    "AUTHORIZATION_SCOPE"
  );
  for (const [bytesField, digestField] of [
    ["schemaReceipt", "schemaReceiptSha256"], ["zeroingReceipt", "zeroingReceiptSha256"],
    ["localReleaseReceipt", "localReleaseReceiptSha256"]
  ]) {
    requireCondition(Buffer.isBuffer(request[bytesField]) && request[bytesField].length > 0, "RECEIPT_INTEGRITY");
    const actual = sha256(request[bytesField]);
    requireCondition(authorization[digestField] === actual && evidence[digestField] === actual, "RECEIPT_INTEGRITY");
  }
  // Preserve POL-25A raw bytes; the independent verifier attests to their full
  // native validation and to a fresh, same-candidate compatibility binding.
  requireCondition(
    evidence.schemaCompatibility?.status === "passed" && evidence.schemaCompatibility.candidateSha === request.candidateSha &&
    evidence.schemaCompatibility.continuousBinding === true,
    "SCHEMA_RECEIPT"
  );
  let zeroing;
  let release;
  try {
    zeroing = JSON.parse(request.zeroingReceipt.toString("utf8"));
    release = JSON.parse(request.localReleaseReceipt.toString("utf8"));
  } catch {
    requireCondition(false, "RECEIPT_INTEGRITY");
  }
  const { receiptSha256, ...zeroingBody } = zeroing;
  requireCondition(
    zeroing.schemaVersion === 1 && zeroing.status === "completed" && zeroing.executed === true &&
    zeroing.codeSha === request.candidateSha && zeroing.environment === request.environment &&
    zeroing.postcheck?.status === "passed" && isDigest(receiptSha256) && zeroingCore.sha256(zeroingBody) === receiptSha256 &&
    Number.isFinite(Date.parse(zeroing.completedAt)) && Date.parse(zeroing.completedAt) <= Date.parse(evidence.issuedAt),
    "ZEROING_RECEIPT"
  );
  requireCondition(
    evidence.zeroing?.status === "passed" && evidence.zeroing.candidateSha === request.candidateSha &&
    evidence.zeroing.schemaReceiptSha256 === evidence.schemaReceiptSha256 &&
    evidence.zeroing.executionReceiptSha256 === receiptSha256 &&
    isDigest(evidence.zeroing.terminalCommitSha256) &&
    isDigest(zeroing.candidateSha256) && evidence.zeroing.candidateSha256 === zeroing.candidateSha256 &&
    isDigest(zeroing.objectDeletionManifestSha256) && evidence.zeroing.objectDeletionManifestSha256 === zeroing.objectDeletionManifestSha256,
    "UPSTREAM_CHAIN"
  );
  requireCondition(
    coordinateKeys.every((field) => isDigest(evidence.coordinates?.[field])), "UPSTREAM_COORDINATES"
  );
  requireCondition(
    evidence.backups?.database === "passed" && evidence.backups.privateObjects === "passed" && evidence.backups.windowId === request.windowId,
    "BACKUP_RESTORE"
  );
  requireCondition(
    evidence.ci?.candidateSha === request.candidateSha && evidence.ci.branch === "main" && evidence.ci.event === "push" &&
    evidence.ci.status === "completed" && evidence.ci.conclusion === "success" && evidence.ci.allChecksPassed === true,
    "MAIN_CI"
  );
  // Reuse the existing 17-gate validator through stdin without weakening its
  // contract or persisting a temporary release receipt in the checkout.
  const validation = spawnSync(process.execPath, [receiptTool, "--validate", "--receipt", "/dev/stdin", "--candidate-sha", request.candidateSha], {
    input: request.localReleaseReceipt, stdio: ["pipe", "pipe", "pipe"], timeout: 10000
  });
  requireCondition(validation.status === 0 && Number.isFinite(Date.parse(release.verifiedAt)) && Date.parse(release.verifiedAt) <= Date.parse(evidence.issuedAt), "LOCAL_RELEASE_GATES");
  return { authorization, evidence };
}

function validateFreeze(state) {
  requireCondition(
    state.maintenance === true && state.freezeMode === "all" && Array.isArray(state.freezeModules) && state.freezeModules.length === 0 &&
    state.databaseWritesFrozen === true && state.objectWritesFrozen === true && state.writersStopped === true &&
    state.timersStopped === true && state.workersStopped === true,
    "MAINTENANCE_FREEZE"
  );
}

/**
 * Trusted adapter contract is documented in pol25b-maintenance-activation.md.
 * There is intentionally no production default, dynamic adapter loader, remote
 * transport or CLI execute switch. Local tests supply an isolated adapter.
 */
async function executeActivation(input, adapter) {
  // Own immutable copies across asynchronous boundaries; reject changed request
  // buffers/envelopes instead of allowing a caller to swap evidence mid-window.
  const request = structuredClone(input);
  for (const field of ["schemaReceipt", "zeroingReceipt", "localReleaseReceipt"]) {
    requireCondition(Buffer.isBuffer(input[field]), "RECEIPT_INTEGRITY");
    request[field] = Buffer.from(request[field]);
  }
  const { evidence } = validateInputs(request, adapter);
  const releaseLock = await adapter.acquire(adapter.identity.deploymentId);
  requireCondition(typeof releaseLock === "function", "ACTIVATION_LOCK");
  let armed = false;
  let replacementAttempted = false;
  let publicationAttempted = false;
  let publicationDigest;
  let snapshot;
  let before;
  let artifacts;
  let installed = false;
  let completion;

  async function guard(apiRunning) {
    validateInputs(request, adapter);
    const state = await adapter.inspect();
    validateFreeze(state);
    requireCondition(state.head === request.candidateSha && state.main === request.candidateSha && state.clean === true, "CANDIDATE_IDENTITY");
    requireCondition(state.apiRunning === apiRunning, "API_STATE");
    requireCondition(isDigest(state.apiArtifactSha256) && isDigest(state.webArtifactSha256), "ARTIFACT_IDENTITY");
    if (before && !replacementAttempted) requireCondition(state.apiArtifactSha256 === before.apiArtifactSha256 && state.webArtifactSha256 === before.webArtifactSha256, "RUNTIME_SNAPSHOT");
    if (apiRunning) requireCondition(state.runtimeSha === request.candidateSha, "RUNTIME_IDENTITY");
    if (installed) requireCondition(state.apiArtifactSha256 === artifacts.apiSha256 && state.webArtifactSha256 === artifacts.webSha256, "ARTIFACT_IDENTITY");
    requireCondition(state.migrationExecutionCount === 0, "MIGRATION_EXECUTED");
    requireCondition(coordinateKeys.every((field) => state.coordinates?.[field] === evidence.coordinates[field]), "COORDINATE_DRIFT");
    requireCondition(isDigest(state.environmentSha256) && (!before || state.environmentSha256 === before.environmentSha256), "ENVIRONMENT_DRIFT");
    requireCondition(await adapter.verifyTerminal() === evidence.zeroing.terminalCommitSha256, "ZEROING_TERMINAL");
    // Inspection itself may consume the remaining window.
    validateInputs(request, adapter);
    return state;
  }

  try {
    before = await guard(false);
    armed = true;
    artifacts = structuredClone(await adapter.build(request.candidateSha));
    requireCondition(artifacts?.candidateSha === request.candidateSha && isDigest(artifacts.apiSha256) && isDigest(artifacts.webSha256), "ARTIFACT_IDENTITY");
    await guard(false);
    snapshot = await adapter.snapshot();
    requireCondition(
      isDigest(snapshot?.snapshotSha256) && snapshot.apiSha256 === before.apiArtifactSha256 && snapshot.webSha256 === before.webArtifactSha256,
      "RUNTIME_SNAPSHOT"
    );
    await guard(false);
    replacementAttempted = true;
    await adapter.replace(artifacts);
    installed = true;
    await guard(false);
    await adapter.start(request.candidateSha, before.environmentSha256);
    await guard(true);
    const checks = await adapter.verifyReadOnly();
    requireCondition(checks?.runtimeSha === request.candidateSha && checks.apiSha256 === artifacts.apiSha256 && checks.webSha256 === artifacts.webSha256, "RUNTIME_IDENTITY");
    requireCondition(readOnlyChecks.every((field) => checks[field] === true), "READONLY_VERIFICATION");
    const after = await guard(true);
    const body = {
      schemaVersion: 1, stage: "runtime_activation_receipt", status: "passed",
      executionScope: "isolated-local", productionAccessed: false,
      environment: request.environment, deploymentId: request.deploymentId, windowId: request.windowId,
      candidateSha: request.candidateSha, schemaReceiptSha256: evidence.schemaReceiptSha256,
      zeroingReceiptSha256: evidence.zeroingReceiptSha256, zeroingTerminalCommitSha256: evidence.zeroing.terminalCommitSha256,
      localReleaseReceiptSha256: evidence.localReleaseReceiptSha256,
      authorizationSha256: documentSha256(request.authorization), evidenceSha256: documentSha256(request.evidence),
      apiArtifactSha256: artifacts.apiSha256, webArtifactSha256: artifacts.webSha256,
      runtimeSnapshotSha256: snapshot.snapshotSha256, environmentSha256: before.environmentSha256,
      beforeCoordinates: projectCoordinates(evidence.coordinates), afterCoordinates: projectCoordinates(after.coordinates),
      migrationExecutionCount: 0, maintenance: true, freezeMode: "all", freezeModules: [],
      timersStopped: true, workersStopped: true,
      readOnlyChecks: Object.fromEntries(readOnlyChecks.map((field) => [field, true])),
      completedAt: adapter.now().toISOString()
    };
    const receipt = { ...body, receiptSha256: documentSha256(body) };
    publicationDigest = receipt.receiptSha256;
    publicationAttempted = true;
    await adapter.publish(receipt);
    await guard(true);
    completion = receipt;
  } catch (error) {
    const recoveryFailures = [];
    const recover = async (operation) => {
      try { await operation(); } catch { recoveryFailures.push("failed"); }
    };
    let receiptRevoked = !publicationAttempted;
    if (armed) {
      await recover(() => adapter.stop());
      let stopped = false;
      await recover(async () => {
        const state = await adapter.inspect();
        validateFreeze(state);
        requireCondition(state.apiRunning === false, "API_STATE");
        stopped = true;
      });
      if (stopped && replacementAttempted && snapshot) await recover(() => adapter.restore(snapshot));
      await recover(async () => {
        const state = await adapter.inspect();
        validateFreeze(state);
        requireCondition(state.apiRunning === false, "API_STATE");
        requireCondition(state.apiArtifactSha256 === before.apiArtifactSha256 && state.webArtifactSha256 === before.webArtifactSha256, "RUNTIME_RECOVERY");
      });
    }
    if (publicationAttempted) await recover(async () => {
      const confirmation = await adapter.revoke(publicationDigest);
      requireCondition(confirmation?.revocationConfirmed === true, "RECEIPT_REVOCATION_UNCONFIRMED");
      receiptRevoked = true;
    });
    await recover(releaseLock);
    // Adapter errors may contain credentials or command bodies: never propagate
    // arbitrary text/cause into operator output or receipts.
    const safeCode = error instanceof ActivationError ? error.code : "ADAPTER_FAILURE";
    const failure = new ActivationError(recoveryFailures.length ? "ACTIVATION_RECOVERY_FAILED" : safeCode);
    failure.code = failure.message;
    failure.recoveryFailed = recoveryFailures.length > 0;
    failure.receiptRevocationConfirmed = receiptRevoked;
    throw failure;
  }
  // Unlock is terminal cleanup, outside the rollback transaction. It might
  // release ownership before reporting an error; never mutate a new owner's
  // runtime or evidence after this point, and never attempt a second unlock.
  try {
    await releaseLock();
  } catch {
    const failure = new ActivationError("ACTIVATION_LOCK_RELEASE_UNCERTAIN");
    failure.activationCompleted = true;
    failure.receiptRevocationConfirmed = false;
    throw failure;
  }
  return completion;
}

export async function activateMaintenanceRuntime(input, adapter) {
  try {
    return await executeActivation(input, adapter);
  } catch (error) {
    if (error instanceof ActivationError) throw error;
    // Includes failures before lock acquisition and malformed trust material.
    throw new ActivationError("ADAPTER_FAILURE");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error("POL25B_PRODUCTION_TRANSPORT_UNAVAILABLE: use the isolated local tests; production activation remains disabled.");
  process.exitCode = 1;
}
