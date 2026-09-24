"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
const { sha256 } = require("./business-zeroing-core.cjs");
const { readJournal, appendJournal } = require("./isolated-file-cleanup-journal.cjs");
const { deleteTargetsTransaction, verifyDeletedDatabase } = require("./isolated-file-cleanup-database.cjs");

// Ignore only IsLatest when comparing the remainder: deleting a latest version
// can legitimately promote an older version. Identity, marker, size and time
// must still be exactly those in the approved immutable version set.
function stableVersions(versions) {
  return versions.map(version => ({ versionId: version.versionId, isDeleteMarker: version.isDeleteMarker === true,
    lastModified: new Date(version.lastModified).toISOString(),
    ...(!version.isDeleteMarker ? { sizeBytes: version.sizeBytes } : {}) }))
    .sort((left, right) => left.versionId.localeCompare(right.versionId));
}

async function executeCleanup({ client, scope, source, plan, root, readInput, verifyAuthority,
  listVersions, deleteVersion, completeDatabase, recordFailureAudit }) {
  const journal = readJournal(root, plan.batchId, readInput);
  if (sha256(journal.plan) !== sha256(plan) || journal.events.length !== 1 || journal.events[0].state !== "prepared" ||
      !Array.isArray(plan.operations) || plan.operations.length !== 2 ||
      plan.operations.some(operation => operation.object.kind !== "cos_versions") ||
      [verifyAuthority, listVersions, deleteVersion, completeDatabase, recordFailureAudit].some(value => typeof value !== "function")) {
    throw new Error("EXECUTION_COORDINATOR_CONTEXT_INVALID");
  }
  const append = (state, details) => appendJournal(root, plan.batchId, readInput, state, details);
  const assertVersions = async (object, expected) => {
    const actual = await listVersions(object);
    if (sha256(stableVersions(actual)) !== sha256(stableVersions(expected))) throw new Error("EXECUTION_OBJECT_DRIFT");
  };
  let databaseOutcome = "not_started";
  let databaseAudit;
  let completionAudit;
  let failurePhase = "preflight";
  const completedVersions = [];
  try {
    await verifyAuthority();
    // No database mutation before all object sets have been rechecked.
    for (const operation of plan.operations) await assertVersions(operation.object, operation.object.versions);
    append("database_intent", { targets: scope.files });
    databaseOutcome = "unknown";
    failurePhase = "database_transaction";
    databaseAudit = await deleteTargetsTransaction(client, scope, source, plan, verifyAuthority, async () => {
      for (const operation of plan.operations) await assertVersions(operation.object, operation.object.versions);
    });
    databaseOutcome = "committed";
    failurePhase = "database_journal";
    append("database_deleted", databaseAudit);
    for (const operation of plan.operations) {
      const object = operation.object;
      let remaining = [...object.versions];
      for (const version of object.versions) {
        await verifyAuthority();
        await verifyDeletedDatabase(client, scope, source, plan, [databaseAudit]);
        await assertVersions(object, remaining);
        const disposition = { fileId: operation.database.primaryKey.id, bucket: object.bucket,
          objectKey: object.objectKey, versionId: version.versionId, isDeleteMarker: version.isDeleteMarker === true };
        // Durable intent precedes the one and only DELETE request. A transport
        // error leaves an unresolved intent; it never causes an automatic retry.
        append("object_intent", disposition);
        failurePhase = "object_version_delete";
        await verifyAuthority();
        await deleteVersion(object, version.versionId);
        remaining = remaining.filter(item => item.versionId !== version.versionId);
        await assertVersions(object, remaining);
        completedVersions.push(disposition);
        append("object_deleted", disposition);
        failurePhase = "object_version_check";
      }
    }
    await verifyAuthority();
    for (const operation of plan.operations) await assertVersions(operation.object, []);
    const proof = await verifyDeletedDatabase(client, scope, source, plan, [databaseAudit]);
    failurePhase = "postcheck_required_journal";
    append("postcheck_required", { databaseAudit, completedVersions, proof });
    return { databaseAudit, completedVersions, proof };
  } catch (error) {
    let failureAudit = null;
    if (databaseOutcome === "committed") {
      try { failureAudit = await recordFailureAudit(databaseAudit, completionAudit, completedVersions); }
      catch { /* The private journal still records the unresolved outcome. */ }
    }
    // Keep exact operational coordinates inside the private journal only.
    // Failure to append must not hide the preceding durable intent.
    try { append("failed", { databaseOutcome, databaseAudit: databaseAudit ?? null,
      completionAudit: completionAudit ?? null, failureAudit, failurePhase, completedVersions }); }
    catch { /* Existing journal remains the recovery authority. */ }
    const failure = new Error("EXECUTION_STOPPED_RECONCILIATION_REQUIRED");
    failure.databaseOutcome = databaseOutcome;
    failure.completedVersionCount = completedVersions.length;
    failure.cause = error;
    throw failure;
  }
}

async function postcheckCleanup({ client, scope, source, plan, root, readInput, verifyAuthority,
  listVersions, completeDatabase, recordFailureAudit }) {
  const journal = readJournal(root, plan.batchId, readInput);
  const last = journal.events.at(-1);
  if (sha256(journal.plan) !== sha256(plan) || last.state !== "postcheck_required" ||
      typeof completeDatabase !== "function" || typeof recordFailureAudit !== "function") {
    throw new Error("POSTCHECK_INCOMPLETE_JOURNAL");
  }
  const expected = plan.operations.flatMap(operation => operation.object.versions.map(version => ({
    fileId: operation.database.primaryKey.id, bucket: operation.object.bucket, objectKey: operation.object.objectKey,
    versionId: version.versionId, isDeleteMarker: version.isDeleteMarker === true
  })));
  const intents = journal.events.filter(event => event.state === "object_intent").map(event => event.details);
  const deleted = journal.events.filter(event => event.state === "object_deleted").map(event => event.details);
  let completionAudit;
  try {
    if (sha256(intents) !== sha256(expected) || sha256(deleted) !== sha256(expected) ||
        sha256(last.details.completedVersions) !== sha256(expected)) throw new Error("POSTCHECK_VERSION_DISPOSITIONS_INVALID");
    await verifyAuthority();
    await verifyDeletedDatabase(client, scope, source, plan, [last.details.databaseAudit]);
    for (const operation of plan.operations) {
      if ((await listVersions(operation.object)).length !== 0) throw new Error("POSTCHECK_OBJECT_REAPPEARED");
    }
    await verifyAuthority();
    completionAudit = await completeDatabase(last.details.databaseAudit, expected);
    await verifyAuthority();
    const proof = await verifyDeletedDatabase(client, scope, source, plan,
      [last.details.databaseAudit, completionAudit]);
    appendJournal(root, plan.batchId, readInput, "completed", {
      databaseAudit: last.details.databaseAudit, completionAudit, completedVersions: expected, proof
    });
    return proof;
  } catch (error) {
    let failureAudit = null;
    try { failureAudit = await recordFailureAudit(last.details.databaseAudit, completionAudit, expected); }
    catch { /* The private journal still records the unresolved outcome. */ }
    try { appendJournal(root, plan.batchId, readInput, "failed", {
      databaseOutcome: "committed", databaseAudit: last.details.databaseAudit,
      completionAudit: completionAudit ?? null, failureAudit, failurePhase: "postcheck",
      completedVersions: expected
    }); }
    catch { /* Existing journal remains the recovery authority. */ }
    error.databaseOutcome = "committed";
    throw error;
  }
}

module.exports = { executeCleanup, postcheckCleanup };
