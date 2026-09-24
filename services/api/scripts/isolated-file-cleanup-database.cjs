"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { createHash, randomUUID } = require("node:crypto");
const { sha256, CONDITIONAL_FILE_DELETE_GUARDS } = require("./business-zeroing-core.cjs");
const { inspectDatabaseInventory } = require("./business-zeroing-database.cjs");

function retainedRowsSha256(inventory, targetIds, auditIds = new Set()) {
  return sha256(inventory.tables.map(table => ({
    name: table.name, primaryKey: table.primaryKey,
    rows: table.rows.filter(row => (table.name !== "FileObject" || !targetIds.has(row.id)) &&
      (table.name !== "AuditLog" || !auditIds.has(row.id))).map(row => ({
      primaryKey: Object.fromEntries(table.primaryKey.map(column => [column, row[column]])),
      rowSha256: row.rowSha256
    }))
  })));
}

async function inspectTargets(client, scope, source) {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return inspectTargetsInTransaction(tx, scope, source);
  }, { isolationLevel: "RepeatableRead", timeout: 45000 });
}

async function inspectTargetsInTransaction(tx, scope, source) {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
    const identity = await tx.$queryRawUnsafe(`SELECT current_database()::text AS "databaseName",
      current_schema()::text AS "schemaName", current_user::text AS "databaseUser",
      COALESCE(inet_server_addr()::text, 'local_socket') AS "serverAddress",
      inet_server_port() AS "serverPort", current_setting('session_replication_role')::text AS "sessionReplicationRole",
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`);
    if (sha256(identity[0]) !== source.databaseFingerprint) return "DATABASE_IDENTITY_MISMATCH";
    const rows = await tx.$queryRawUnsafe(
      'SELECT id, "storageStatus", to_jsonb(f)::text AS body FROM "FileObject" f WHERE id IN ($1, $2) ORDER BY id',
      ...scope.files.map(file => file.id)
    );
    if (rows.length !== 2) return "TARGET_MISSING";
    if (rows.some(row => row.storageStatus !== "quarantined")) return "TARGET_STATE_NOT_QUARANTINED";
    for (const row of rows) {
      const target = scope.files.find(file => file.id === row.id);
      if (createHash("sha256").update(row.body).digest("hex") !== target.rowSha256) return "TARGET_ROW_DRIFT";
    }
    const relations = await tx.$queryRawUnsafe(
      'SELECT id FROM "FileObject" WHERE "supersedesFileObjectId" IN ($1,$2) OR (id IN ($1,$2) AND "supersedesFileObjectId" IS NOT NULL)',
      ...scope.files.map(file => file.id)
    );
    if (relations.length !== 0) return "TARGET_REFERENCED";
    const sharedObjects = await tx.$queryRawUnsafe(`SELECT target.id FROM "FileObject" target
      JOIN "FileObject" other ON other.bucket = target.bucket AND other."objectKey" = target."objectKey"
        AND other.id <> target.id
      WHERE target.id IN ($1,$2) LIMIT 1`, ...scope.files.map(file => file.id));
    if (sharedObjects.length !== 0) return "DUPLICATE_OBJECT_SCOPE";
    const inventory = await inspectDatabaseInventory(tx, { environment: source.environment });
    if (inventory.schemaDigest !== source.schemaDigest ||
        inventory.migrationHead !== source.migrationHead ||
        inventory.migrationCount !== source.migrationCount) return "SCHEMA_IDENTITY_MISMATCH";
    const guards = inventory.deleteGuardTriggers.filter(trigger => trigger.tableName === "FileObject");
    if (guards.length !== Object.keys(CONDITIONAL_FILE_DELETE_GUARDS).length || guards.some(trigger => {
      const contract = CONDITIONAL_FILE_DELETE_GUARDS[trigger.triggerName];
      return !contract || trigger.enabledState !== "O" ||
        trigger.functionSchema !== contract.functionSchema || trigger.functionName !== contract.functionName ||
        trigger.triggerDefinitionSha256 !== contract.triggerDefinitionSha256 ||
        trigger.functionDefinitionSha256 !== contract.functionDefinitionSha256;
    })) return "DELETE_GUARD_TRIGGER";
    const ids = new Set(scope.files.map(file => file.id));
    if (inventory.fileBindings.some(binding => ids.has(binding.fileId)) ||
        inventory.foreignKeyReferences.some(reference =>
          reference.parentTable === "FileObject" && ids.has(reference.parentPrimaryKey?.id))) {
      return "TARGET_REFERENCED";
    }
    if (inventory.schemaBlockers.length !== 0 || inventory.danglingForeignKeys.length !== 0) {
      return "REFERENCE_COVERAGE_INCOMPLETE";
    }
    const audited = await tx.$queryRawUnsafe(`SELECT DISTINCT f.id FROM "FileObject" f
      JOIN "AuditLog" a ON a."businessId" = f.id AND a."actorUserId" = f."uploadedByUserId"
      WHERE f.id IN ($1,$2)
        AND a.action = 'spot_procurement.payment_archive.orphan_file'
        AND a."businessType" = 'spot_procurement_payment_archive'
        AND a.metadata->>'fileId' = f.id
        AND a.metadata->>'reason' = 'archive_association_failed'`, ...scope.files.map(file => file.id));
    if (audited.length !== 2) return "ISOLATION_AUDIT_MISSING";
    return {
      databaseLocation: identity[0],
      retainedRowsSha256: retainedRowsSha256(inventory, ids),
      databaseFingerprint: inventory.databaseFingerprint,
      schemaDigest: inventory.schemaDigest,
      migrationHead: inventory.migrationHead,
      migrationCount: inventory.migrationCount,
      // Internal only: the CLI never prints file coordinates or full rows.
      files: rows.map(row => JSON.parse(row.body))
    };
}

// This primitive is not a public execution entrypoint. The coordinator must
// first persist intent, then record the returned committed audit fingerprint.
// It must treat a transport error around COMMIT as unknown, never as rollback.
async function deleteTargetsTransaction(client, scope, source, plan, verifyAuthority, verifyObjects) {
  if (typeof verifyAuthority !== "function" || typeof verifyObjects !== "function" ||
      plan.scopeSha256 !== sha256(scope) || plan.sourceReportSha256 !== source.reportSha256 ||
      scope.files.length !== 2 || new Set(scope.files.map(file => file.id)).size !== 2) {
    throw new Error("EXECUTION_CONTEXT_INVALID");
  }
  // Discover lock identifiers before the serializable transaction starts;
  // its first data snapshot must be taken after the table locks are acquired.
  const tables = await client.$queryRawUnsafe(`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  if (!tables.length) throw new Error("EXECUTION_SCHEMA_EMPTY");
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
    // Lock all ordinary business tables in a stable order, not only the two
    // rows: otherwise a concurrent writer can add a previously absent binding.
    const quote = value => `"${value.replaceAll('"', '""')}"`;
    await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map(table => `public.${quote(table.name)}`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await verifyAuthority();
    const current = await inspectTargetsInTransaction(tx, scope, source);
    if (typeof current === "string") throw new Error(current);
    if (current.retainedRowsSha256 !== plan.recovery.retainedRowsSha256 ||
        current.databaseFingerprint !== plan.databaseFingerprint || current.schemaDigest !== plan.schemaDigest ||
        current.migrationHead !== plan.migrationHead || current.migrationCount !== plan.migrationCount) {
      throw new Error("EXECUTION_DATABASE_DRIFT");
    }
    const prior = await tx.$queryRawUnsafe(`SELECT id FROM "AuditLog"
      WHERE "businessType" = 'isolated_orphan_file_cleanup' AND "businessId" = $1 LIMIT 1`, plan.batchId);
    if (prior.length) throw new Error("EXECUTION_BATCH_ALREADY_RECORDED");
    await verifyObjects();
    for (const file of scope.files) {
      await verifyAuthority();
      const rows = await tx.$queryRawUnsafe('SELECT to_jsonb(f)::text AS body FROM "FileObject" f WHERE id = $1 FOR UPDATE', file.id);
      if (rows.length !== 1 || createHash("sha256").update(rows[0].body).digest("hex") !== file.rowSha256) {
        throw new Error("EXECUTION_TARGET_DRIFT");
      }
      const count = await tx.$executeRawUnsafe('DELETE FROM "FileObject" WHERE id = $1', file.id);
      if (count !== 1) throw new Error("EXECUTION_DELETE_COUNT_MISMATCH");
    }
    const auditId = randomUUID();
    const metadata = { schemaVersion: 1, batchId: plan.batchId, planSha256: plan.reportSha256,
      scopeSha256: plan.scopeSha256, targets: scope.files, state: "database_deleted" };
    await tx.$executeRawUnsafe(`INSERT INTO "AuditLog" (id, action, "businessType", "businessId", metadata, "createdAt")
      VALUES ($1, 'isolated_orphan_file_cleanup.database_deleted', 'isolated_orphan_file_cleanup', $2, $3::jsonb, NOW())`,
    auditId, plan.batchId, JSON.stringify(metadata));
    const after = await inspectDatabaseInventory(tx, { environment: source.environment });
    const audit = after.tables.find(table => table.name === "AuditLog")?.rows.find(row => row.id === auditId);
    if (!audit || after.schemaDigest !== plan.schemaDigest || after.databaseFingerprint !== plan.databaseFingerprint ||
        after.tables.find(table => table.name === "FileObject")?.rows.some(row => scope.files.some(file => file.id === row.id)) ||
        after.schemaBlockers.length || after.danglingForeignKeys.length ||
        retainedRowsSha256(after, new Set(), new Set([auditId])) !== plan.recovery.retainedRowsSha256) {
      throw new Error("EXECUTION_RETAINED_ROWS_DRIFT");
    }
    await verifyAuthority();
    return { state: "database_deleted", auditId, auditRowSha256: audit.rowSha256,
      planSha256: plan.reportSha256, retainedRowsSha256: plan.recovery.retainedRowsSha256 };
  }, { isolationLevel: "Serializable", timeout: 120000, maxWait: 5000 });
}

async function verifyRestoredDatabase(client, scope, inspected, backup) {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
    const rows = await tx.$queryRawUnsafe(`SELECT current_database()::text AS "databaseName",
      current_schema()::text AS "schemaName", current_user::text AS "databaseUser",
      COALESCE(inet_server_addr()::text, 'local_socket') AS "serverAddress",
      inet_server_port() AS "serverPort", current_setting('session_replication_role')::text AS "sessionReplicationRole",
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`);
    const identity = rows[0];
    if (identity.systemIdentifier === inspected.databaseLocation.systemIdentifier &&
        identity.databaseName === inspected.databaseLocation.databaseName) return "RESTORE_DATABASE_NOT_ISOLATED";
    if (identity.databaseName !== backup.databaseBackup.restoreTarget ||
        identity.schemaName !== inspected.databaseLocation.schemaName || identity.sessionReplicationRole !== "origin") {
      return "RESTORE_TARGET_MISMATCH";
    }
    const inventory = await inspectDatabaseInventory(tx, { environment: backup.environment });
    if (inventory.schemaDigest !== inspected.schemaDigest || inventory.migrationCount !== inspected.migrationCount ||
        inventory.migrationHead !== inspected.migrationHead) return "RESTORE_SCHEMA_MISMATCH";
    const restoredFiles = inventory.tables.find(table => table.name === "FileObject")?.rows ?? [];
    const targets = scope.files.map(file => restoredFiles.find(row => row.id === file.id));
    if (targets.some((row, index) => !row || row.rowSha256 !== scope.files[index].rowSha256)) return "RESTORE_TARGET_ROW_MISMATCH";
    const retained = retainedRowsSha256(inventory, new Set(scope.files.map(file => file.id)));
    if (retained !== inspected.retainedRowsSha256) return "RESTORE_RETAINED_ROWS_MISMATCH";
    return { status: "passed", verifiedAt: new Date().toISOString(), backupReceiptSha256: backup.receiptSha256,
      restoredDatabaseFingerprint: sha256(identity), targetRowsSha256: sha256(scope.files), retainedRowsSha256: retained };
  }, { isolationLevel: "RepeatableRead", timeout: 45000 });
}

async function verifyDeletedDatabase(client, scope, source, plan, audits) {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return verifyDeletedInTransaction(tx, scope, source, plan, audits);
  }, { isolationLevel: "RepeatableRead", timeout: 45000 });
}

async function verifyDeletedInTransaction(tx, scope, source, plan, audits) {
  if (!Array.isArray(audits) || audits.length < 1 || audits.length > 2 ||
      new Set(audits.map(audit => audit.auditId)).size !== audits.length ||
      audits.some(audit => !/^[0-9a-f-]{36}$/u.test(audit.auditId) || !/^[0-9a-f]{64}$/u.test(audit.auditRowSha256))) {
    throw new Error("POSTCHECK_AUDIT_PROOF_INVALID");
  }
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
    const inventory = await inspectDatabaseInventory(tx, { environment: source.environment });
    const targetIds = new Set(scope.files.map(file => file.id));
    if (inventory.databaseFingerprint !== plan.databaseFingerprint || inventory.schemaDigest !== plan.schemaDigest ||
        inventory.migrationHead !== plan.migrationHead || inventory.migrationCount !== plan.migrationCount ||
        inventory.schemaBlockers.length || inventory.danglingForeignKeys.length ||
        inventory.tables.find(table => table.name === "FileObject")?.rows.some(row => targetIds.has(row.id)) ||
        inventory.fileBindings.some(binding => targetIds.has(binding.fileId))) throw new Error("POSTCHECK_DATABASE_DRIFT");
    const auditRows = inventory.tables.find(table => table.name === "AuditLog")?.rows ?? [];
    for (const [index, audit] of audits.entries()) {
      const row = auditRows.find(item => item.id === audit.auditId);
      // Inventory intentionally exposes fingerprints, not audit payloads.
      // Read only the bound audit in the same transaction snapshot.
      const [details] = await tx.$queryRawUnsafe(`SELECT action, "businessType", "businessId", metadata
        FROM "AuditLog" WHERE id = $1`, audit.auditId);
      const state = index === 0 ? "database_deleted" : "completed";
      if (!row || !details || row.rowSha256 !== audit.auditRowSha256 || details.businessType !== "isolated_orphan_file_cleanup" ||
          details.businessId !== plan.batchId || details.metadata?.planSha256 !== plan.reportSha256 ||
          details.metadata?.scopeSha256 !== plan.scopeSha256 || details.metadata?.state !== state ||
          details.action !== `isolated_orphan_file_cleanup.${state}`) throw new Error("POSTCHECK_AUDIT_MISMATCH");
    }
    if (retainedRowsSha256(inventory, new Set(), new Set(audits.map(audit => audit.auditId))) !== plan.recovery.retainedRowsSha256) {
      throw new Error("POSTCHECK_RETAINED_ROWS_DRIFT");
    }
    return { databaseFingerprint: inventory.databaseFingerprint, retainedRowsSha256: plan.recovery.retainedRowsSha256,
      targetsAbsent: true, auditCount: audits.length };
}

async function completeCleanupDatabase(client, scope, source, plan, databaseAudit, completedVersions, verifyAuthority) {
  const tables = await client.$queryRawUnsafe(`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  if (!tables.length || typeof verifyAuthority !== "function") throw new Error("COMPLETION_CONTEXT_INVALID");
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
    const quote = value => `"${value.replaceAll('"', '""')}"`;
    await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map(table => `public.${quote(table.name)}`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await verifyAuthority();
    await verifyDeletedInTransaction(tx, scope, source, plan, [databaseAudit]);
    const auditId = randomUUID();
    const metadata = { schemaVersion: 1, state: "completed", planSha256: plan.reportSha256,
      scopeSha256: plan.scopeSha256, databaseAuditId: databaseAudit.auditId, completedVersionsSha256: sha256(completedVersions) };
    await tx.$executeRawUnsafe(`INSERT INTO "AuditLog" (id, action, "businessType", "businessId", metadata, "createdAt")
      VALUES ($1, 'isolated_orphan_file_cleanup.completed', 'isolated_orphan_file_cleanup', $2, $3::jsonb, NOW())`,
    auditId, plan.batchId, JSON.stringify(metadata));
    const inventory = await inspectDatabaseInventory(tx, { environment: source.environment });
    const row = inventory.tables.find(table => table.name === "AuditLog")?.rows.find(item => item.id === auditId);
    if (!row) throw new Error("COMPLETION_AUDIT_MISSING");
    const completionAudit = { auditId, auditRowSha256: row.rowSha256 };
    await verifyDeletedInTransaction(tx, scope, source, plan, [databaseAudit, completionAudit]);
    await verifyAuthority();
    return completionAudit;
  }, { isolationLevel: "Serializable", timeout: 45000, maxWait: 5000 });
}

async function recordFailedAfterCommit(client, scope, source, plan, databaseAudit, completionAudit, completedVersions, verifyAuthority) {
  if (!databaseAudit || typeof verifyAuthority !== "function" || !Array.isArray(completedVersions)) {
    throw new Error("FAILURE_AUDIT_CONTEXT_INVALID");
  }
  const tables = await client.$queryRawUnsafe(`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  if (!tables.length) throw new Error("FAILURE_AUDIT_SCHEMA_EMPTY");
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
    const quote = value => `"${value.replaceAll('"', '""')}"`;
    await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map(table => `public.${quote(table.name)}`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await verifyAuthority();
    const audits = completionAudit ? [databaseAudit, completionAudit] : [databaseAudit];
    await verifyDeletedInTransaction(tx, scope, source, plan, audits);
    const prior = await tx.$queryRawUnsafe(`SELECT id FROM "AuditLog"
      WHERE "businessType" = 'isolated_orphan_file_cleanup' AND "businessId" = $1
        AND action = 'isolated_orphan_file_cleanup.failed_after_database_commit' LIMIT 1`, plan.batchId);
    if (prior.length) throw new Error("FAILURE_AUDIT_ALREADY_RECORDED");
    const auditId = randomUUID();
    const metadata = { schemaVersion: 1, state: "failed_after_database_commit", planSha256: plan.reportSha256,
      scopeSha256: plan.scopeSha256, databaseAuditId: databaseAudit.auditId,
      completionAuditId: completionAudit?.auditId ?? null, completedVersionsSha256: sha256(completedVersions) };
    await tx.$executeRawUnsafe(`INSERT INTO "AuditLog" (id, action, "businessType", "businessId", metadata, "createdAt")
      VALUES ($1, 'isolated_orphan_file_cleanup.failed_after_database_commit', 'isolated_orphan_file_cleanup', $2, $3::jsonb, NOW())`,
    auditId, plan.batchId, JSON.stringify(metadata));
    const inventory = await inspectDatabaseInventory(tx, { environment: source.environment });
    const row = inventory.tables.find(table => table.name === "AuditLog")?.rows.find(item => item.id === auditId);
    if (!row || retainedRowsSha256(inventory, new Set(), new Set([...audits.map(audit => audit.auditId), auditId])) !==
        plan.recovery.retainedRowsSha256) throw new Error("FAILURE_AUDIT_RETAINED_ROWS_DRIFT");
    await verifyAuthority();
    return { auditId, auditRowSha256: row.rowSha256 };
  }, { isolationLevel: "Serializable", timeout: 45000, maxWait: 5000 });
}

module.exports = { inspectTargets, verifyRestoredDatabase, deleteTargetsTransaction, verifyDeletedDatabase,
  completeCleanupDatabase, recordFailedAfterCommit };
