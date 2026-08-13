#!/usr/bin/env node
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  selectFormalObservationFields,
  sha256
} = require("./business-zeroing-core.cjs");
const {
  BUSINESS_ZEROING_LOGICAL_RELATIONS
} = require("./business-zeroing-policy.cjs");

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const EXECUTION_LOCK_ID = 220026;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function quoteIdentifier(identifier) {
  invariant(IDENTIFIER.test(identifier ?? ""), "数据库标识符不安全");
  return `"${identifier}"`;
}

function jsonObjectExpression(alias, columns) {
  invariant(Array.isArray(columns) && columns.length > 0, "逐主键表达式不能为空");
  return `jsonb_build_object(${columns
    .flatMap((column) => [
      `'${column}'`,
      `${alias}.${quoteIdentifier(column)}`
    ])
    .join(", ")})`;
}

function buildExactDeleteStatement(candidate, primaryKeysByTable, allowedTables) {
  invariant(allowedTables.has(candidate.table), `表不在显式归零策略中：${candidate.table}`);
  const primaryKeyColumns = primaryKeysByTable.get(candidate.table);
  invariant(primaryKeyColumns?.length > 0, `${candidate.table} 缺少主键定义`);
  const actualColumns = Object.keys(candidate.primaryKey ?? {}).sort();
  const expectedColumns = [...primaryKeyColumns].sort();
  invariant(
    JSON.stringify(actualColumns) === JSON.stringify(expectedColumns),
    `${candidate.table} 候选主键与 Schema 不一致`
  );
  const values = primaryKeyColumns.map((column) => candidate.primaryKey[column]);
  invariant(values.every((value) => String(value).length > 0), "候选主键值不能为空");
  const predicates = primaryKeyColumns
    .map((column, index) => `${quoteIdentifier(column)}::text = $${index + 1}`)
    .join(" AND ");
  return {
    sql: `DELETE FROM ${quoteIdentifier(candidate.table)} WHERE ${predicates}`,
    values: values.map(String)
  };
}

function buildExactRowSnapshotStatement(candidate, primaryKeysByTable, allowedTables) {
  invariant(allowedTables.has(candidate.table), `表不在显式归零策略中：${candidate.table}`);
  const primaryKeyColumns = primaryKeysByTable.get(candidate.table);
  invariant(primaryKeyColumns?.length > 0, `${candidate.table} 缺少主键定义`);
  const actualColumns = Object.keys(candidate.primaryKey ?? {}).sort();
  const expectedColumns = [...primaryKeyColumns].sort();
  invariant(
    JSON.stringify(actualColumns) === JSON.stringify(expectedColumns),
    `${candidate.table} 候选主键与 Schema 不一致`
  );
  invariant(/^[0-9a-f]{64}$/u.test(candidate.rowSha256 ?? ""), "候选完整行指纹无效");
  const values = primaryKeyColumns.map((column) => candidate.primaryKey[column]);
  invariant(values.every((value) => String(value).length > 0), "候选主键值不能为空");
  const predicates = primaryKeyColumns
    .map((column, index) => `source.${quoteIdentifier(column)}::text = $${index + 1}`)
    .join(" AND ");
  return {
    sql:
      `SELECT to_jsonb(source)::text AS "rowCanonicalJson" ` +
      `FROM ${quoteIdentifier(candidate.table)} source WHERE ${predicates} FOR UPDATE`,
    values: values.map(String)
  };
}

function assertCandidateRowFingerprint(candidate, rowCanonicalJson) {
  invariant(typeof rowCanonicalJson === "string", `${candidate.table} 候选记录不存在`);
  invariant(
    createHash("sha256").update(rowCanonicalJson).digest("hex") === candidate.rowSha256,
    `${candidate.table} 候选完整行指纹已漂移，事务必须回滚`
  );
}

function buildExactSequenceResetStatement(reset, primaryKeysByTable) {
  invariant(
    reset.table === "ContractNumberRule" && reset.field === "nextSequence",
    "只允许复位合同编号规则序号"
  );
  const primaryKeyColumns = primaryKeysByTable.get(reset.table);
  invariant(
    JSON.stringify(primaryKeyColumns) === JSON.stringify(["id"]) &&
      Object.keys(reset.primaryKey ?? {}).length === 1 &&
      typeof reset.primaryKey.id === "string" &&
      reset.primaryKey.id,
    "合同编号规则复位必须绑定完整主键"
  );
  invariant(
    Number.isInteger(reset.expectedValue) &&
      reset.expectedValue >= 1 &&
      reset.targetValue === 1,
    "合同编号规则复位值无效"
  );
  return {
    sql:
      'UPDATE "ContractNumberRule" SET "nextSequence" = $1, "updatedAt" = NOW() ' +
      'WHERE "id" = $2 AND "nextSequence" = $3',
    values: [reset.targetValue, reset.primaryKey.id, reset.expectedValue]
  };
}

function computeDeletionOrder(tableNames, foreignKeys) {
  const nodes = new Set(tableNames);
  const outgoing = new Map([...nodes].map((name) => [name, new Set()]));
  const indegree = new Map([...nodes].map((name) => [name, 0]));
  for (const foreignKey of foreignKeys) {
    const child = foreignKey.childTable;
    const parent = foreignKey.parentTable;
    if (child === parent || !nodes.has(child) || !nodes.has(parent)) continue;
    if (!outgoing.get(child).has(parent)) {
      outgoing.get(child).add(parent);
      indegree.set(parent, indegree.get(parent) + 1);
    }
  }
  const ready = [...nodes].filter((name) => indegree.get(name) === 0).sort();
  const result = [];
  while (ready.length > 0) {
    const current = ready.shift();
    result.push(current);
    for (const parent of [...outgoing.get(current)].sort()) {
      indegree.set(parent, indegree.get(parent) - 1);
      if (indegree.get(parent) === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }
  return {
    order: result,
    cycles: [...nodes].filter((name) => !result.includes(name)).sort()
  };
}

async function query(client, sql, ...values) {
  return client.$queryRawUnsafe(sql, ...values);
}

async function loadSchema(client) {
  const [
    identityRows,
    tableRows,
    columnRows,
    primaryKeyRows,
    foreignKeyRows,
    triggerRows,
    functionRows,
    migrationRows
  ] =
    await Promise.all([
      query(
        client,
        `SELECT current_database()::text AS "databaseName",
                current_schema()::text AS "schemaName",
                current_user::text AS "databaseUser",
                COALESCE(inet_server_addr()::text, 'local_socket') AS "serverAddress",
                inet_server_port() AS "serverPort",
                current_setting('session_replication_role')::text AS "sessionReplicationRole",
                (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`
      ),
      query(
        client,
        `SELECT relation.relname::text AS "name"
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = current_schema()
           AND relation.relkind = 'r'
         ORDER BY relation.relname`
      ),
      query(
        client,
        `SELECT table_name::text AS "tableName", column_name::text AS "columnName",
                data_type::text AS "dataType", udt_name::text AS "databaseType",
                is_nullable::text AS "isNullable"
         FROM information_schema.columns
         WHERE table_schema = current_schema()
         ORDER BY table_name, ordinal_position`
      ),
      query(
        client,
        `SELECT constraint_info.table_name::text AS "tableName",
                array_agg(key_info.column_name::text ORDER BY key_info.ordinal_position) AS "columns"
         FROM information_schema.table_constraints constraint_info
         JOIN information_schema.key_column_usage key_info
           ON key_info.constraint_schema = constraint_info.constraint_schema
          AND key_info.constraint_name = constraint_info.constraint_name
          AND key_info.table_name = constraint_info.table_name
         WHERE constraint_info.table_schema = current_schema()
           AND constraint_info.constraint_type = 'PRIMARY KEY'
         GROUP BY constraint_info.table_name
         ORDER BY constraint_info.table_name`
      ),
      query(
        client,
        `SELECT constraint_info.conname::text AS "name",
                child.relname::text AS "childTable",
                parent.relname::text AS "parentTable",
                array_agg(child_column.attname::text ORDER BY key_pair.ordinality) AS "childColumns",
                array_agg(parent_column.attname::text ORDER BY key_pair.ordinality) AS "parentColumns"
         FROM pg_constraint constraint_info
         JOIN pg_class child ON child.oid = constraint_info.conrelid
         JOIN pg_class parent ON parent.oid = constraint_info.confrelid
         JOIN pg_namespace namespace ON namespace.oid = child.relnamespace
         JOIN LATERAL unnest(constraint_info.conkey, constraint_info.confkey)
           WITH ORDINALITY AS key_pair(child_number, parent_number, ordinality) ON TRUE
         JOIN pg_attribute child_column
           ON child_column.attrelid = child.oid AND child_column.attnum = key_pair.child_number
         JOIN pg_attribute parent_column
           ON parent_column.attrelid = parent.oid AND parent_column.attnum = key_pair.parent_number
         WHERE constraint_info.contype = 'f'
           AND namespace.nspname = current_schema()
         GROUP BY constraint_info.conname, child.relname, parent.relname
         ORDER BY child.relname, constraint_info.conname`
      ),
      query(
        client,
        `SELECT table_info.relname::text AS "tableName",
                trigger_info.tgname::text AS "triggerName",
                trigger_info.tgenabled::text AS "enabledState",
                pg_get_triggerdef(trigger_info.oid, true)::text AS "triggerDefinition",
                function_namespace.nspname::text AS "functionSchema",
                function_info.proname::text AS "functionName",
                pg_get_functiondef(function_info.oid)::text AS "functionDefinition"
         FROM pg_trigger trigger_info
         JOIN pg_class table_info ON table_info.oid = trigger_info.tgrelid
         JOIN pg_namespace table_namespace ON table_namespace.oid = table_info.relnamespace
         JOIN pg_proc function_info ON function_info.oid = trigger_info.tgfoid
         JOIN pg_namespace function_namespace ON function_namespace.oid = function_info.pronamespace
         WHERE table_namespace.nspname = current_schema()
           AND NOT trigger_info.tgisinternal
         ORDER BY table_info.relname, trigger_info.tgname`
      ),
      query(
        client,
        `SELECT function_namespace.nspname::text AS "functionSchema",
                function_info.proname::text AS "functionName",
                pg_get_function_identity_arguments(function_info.oid)::text AS "identityArguments",
                function_info.prokind::text AS "functionKind",
                pg_get_functiondef(function_info.oid)::text AS "functionDefinition"
         FROM pg_proc function_info
         JOIN pg_namespace function_namespace ON function_namespace.oid = function_info.pronamespace
         WHERE function_namespace.nspname = current_schema()
           AND function_info.prokind IN ('f', 'p')
         ORDER BY function_info.proname, pg_get_function_identity_arguments(function_info.oid)`
      ),
      query(
        client,
        `SELECT migration_name AS "migrationName", finished_at AS "finishedAt"
         FROM "_prisma_migrations"
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         ORDER BY finished_at, migration_name`
      )
    ]);

  const tables = tableRows.map((row) => row.name);
  const primaryKeys = new Map(primaryKeyRows.map((row) => [row.tableName, row.columns]));
  return {
    identity: identityRows[0],
    tables,
    columns: columnRows,
    primaryKeys,
    foreignKeys: foreignKeyRows,
    triggers: triggerRows,
    functions: functionRows,
    migrations: migrationRows
  };
}

function computeSchemaDigest(schema) {
  return sha256({
    tables: schema.tables,
    columns: schema.columns,
    primaryKeys: [...schema.primaryKeys.entries()],
    foreignKeys: schema.foreignKeys,
    triggers: schema.triggers,
    functions: schema.functions,
    logicalRelations: BUSINESS_ZEROING_LOGICAL_RELATIONS
  });
}

async function lockAllTables(client, tableNames) {
  await query(
    client,
    `SELECT pg_advisory_xact_lock(${EXECUTION_LOCK_ID}) IS NULL AS "locked"`
  );
  for (const tableName of [...tableNames].sort()) {
    await client.$executeRawUnsafe(
      `LOCK TABLE ${quoteIdentifier(tableName)} IN SHARE ROW EXCLUSIVE MODE`
    );
  }
}

async function loadPrimaryKeyRows(client, tableName, primaryKeyColumns) {
  const order = primaryKeyColumns.map(quoteIdentifier).join(", ");
  const extra = {
    FileObject: `, "bucket", "objectKey"`,
    ContractNumberRule: `, "nextSequence"`,
    ContractNumberTombstone: `, "formalCode"`,
    BusinessDailySequence: `, "nextSequence"`,
    CompanyEntity: `, "currentVersionNo"`
  }[tableName] ?? "";
  const preservationJson =
    tableName === "ContractNumberRule"
      ? `(to_jsonb(source) - 'nextSequence' - 'updatedAt')::text`
      : `to_jsonb(source)::text`;
  const rows = await query(
    client,
    `SELECT ${jsonObjectExpression("source", primaryKeyColumns)} AS "primaryKey",
            to_jsonb(source)::text AS "rowCanonicalJson",
            ${preservationJson} AS "preservationCanonicalJson"${extra}
     FROM ${quoteIdentifier(tableName)} source
     ORDER BY ${order}`
  );
  return rows.map((row) => {
    const canonicalRow = JSON.parse(row.rowCanonicalJson);
    return {
      ...row.primaryKey,
      ...selectFormalObservationFields(canonicalRow, tableName),
      rowSha256: createHash("sha256").update(row.rowCanonicalJson).digest("hex"),
      preservationSha256: createHash("sha256")
        .update(row.preservationCanonicalJson)
        .digest("hex"),
      ...(tableName === "FileObject"
        ? { bucket: row.bucket, objectKey: row.objectKey }
        : {}),
      ...(tableName === "ContractNumberRule"
        ? { nextSequence: row.nextSequence }
        : {}),
      ...(tableName === "BusinessDailySequence"
        ? { nextSequence: row.nextSequence }
        : {}),
      ...(tableName === "CompanyEntity"
        ? { currentVersionNo: row.currentVersionNo }
        : {})
    };
  });
}

async function loadFileBindings(client, primaryKeys) {
  const manifestRows = await query(
    client,
    `SELECT "tableName", "columnName", "exclusive"
     FROM jg_file_business_binding_columns()
     ORDER BY "tableName", "columnName"`
  );
  const bindings = [];
  for (const manifest of manifestRows) {
    const columns = primaryKeys.get(manifest.tableName);
    invariant(columns?.length > 0, `文件绑定表缺少主键：${manifest.tableName}`);
    const rows = await query(
      client,
      `SELECT ${quoteIdentifier(manifest.columnName)}::text AS "fileId",
              ${jsonObjectExpression("owner", columns)} AS "ownerPrimaryKey"
       FROM ${quoteIdentifier(manifest.tableName)} owner
       WHERE ${quoteIdentifier(manifest.columnName)} IS NOT NULL
       ORDER BY ${quoteIdentifier(manifest.columnName)}, ${columns
         .map(quoteIdentifier)
         .join(", ")}`
    );
    for (const row of rows) {
      bindings.push({
        fileId: row.fileId,
        ownerTable: manifest.tableName,
        ownerPrimaryKey: row.ownerPrimaryKey,
        ownerColumn: manifest.columnName,
        exclusive: manifest.exclusive
      });
    }
  }
  return { bindings, manifest: manifestRows };
}

async function loadFileRelations(client) {
  return query(
    client,
    `SELECT "id" AS "fileId", "supersedesFileObjectId" AS "relatedFileId"
     FROM "FileObject"
     WHERE "supersedesFileObjectId" IS NOT NULL
     ORDER BY "id"`
  );
}

async function loadForeignKeyEvidence(client, schema) {
  const references = [];
  const dangling = [];
  for (const foreignKey of schema.foreignKeys) {
    const childPrimaryKey = schema.primaryKeys.get(foreignKey.childTable);
    const parentPrimaryKey = schema.primaryKeys.get(foreignKey.parentTable);
    invariant(childPrimaryKey?.length > 0, `${foreignKey.childTable} 外键子表缺少主键`);
    invariant(parentPrimaryKey?.length > 0, `${foreignKey.parentTable} 外键父表缺少主键`);
    const join = foreignKey.childColumns
      .map(
        (column, index) =>
          `child.${quoteIdentifier(column)} = parent.${quoteIdentifier(
            foreignKey.parentColumns[index]
          )}`
      )
      .join(" AND ");
    const childPresent = foreignKey.childColumns
      .map((column) => `child.${quoteIdentifier(column)} IS NOT NULL`)
      .join(" AND ");
    const rows = await query(
      client,
      `SELECT ${jsonObjectExpression("child", childPrimaryKey)} AS "childPrimaryKey",
              ${jsonObjectExpression("parent", parentPrimaryKey)} AS "parentPrimaryKey"
       FROM ${quoteIdentifier(foreignKey.childTable)} child
       JOIN ${quoteIdentifier(foreignKey.parentTable)} parent ON ${join}
       WHERE ${childPresent}`
    );
    for (const row of rows) {
      references.push({
        name: foreignKey.name,
        childTable: foreignKey.childTable,
        childPrimaryKey: row.childPrimaryKey,
        parentTable: foreignKey.parentTable,
        parentPrimaryKey: row.parentPrimaryKey
      });
    }
    const missing = await query(
      client,
      `SELECT ${jsonObjectExpression("child", childPrimaryKey)} AS "childPrimaryKey"
       FROM ${quoteIdentifier(foreignKey.childTable)} child
       LEFT JOIN ${quoteIdentifier(foreignKey.parentTable)} parent ON ${join}
       WHERE ${childPresent}
         AND parent.${quoteIdentifier(foreignKey.parentColumns[0])} IS NULL`
    );
    for (const row of missing) {
      dangling.push({
        name: foreignKey.name,
        childTable: foreignKey.childTable,
        childPrimaryKey: row.childPrimaryKey,
        parentTable: foreignKey.parentTable
      });
    }
  }
  return { references, dangling };
}

async function loadLogicalRelationEvidence(client, schema) {
  const references = [];
  const dangling = [];
  for (const relation of BUSINESS_ZEROING_LOGICAL_RELATIONS) {
    const childPrimaryKey = schema.primaryKeys.get(relation.childTable);
    const parentPrimaryKey = schema.primaryKeys.get(relation.parentTable);
    invariant(childPrimaryKey?.length > 0, `${relation.childTable} 逻辑关联子表缺少主键`);
    invariant(parentPrimaryKey?.length > 0, `${relation.parentTable} 逻辑关联父表缺少主键`);
    const childColumns = relation.childColumns ?? [relation.childColumn];
    const parentColumns = relation.parentColumns ?? [relation.parentColumn];
    invariant(
      childColumns.length > 0 && childColumns.length === parentColumns.length,
      "逻辑关联列数量不匹配"
    );
    const name = `logical:${relation.childTable}.${childColumns.join("+")}->${relation.parentTable}.${parentColumns.join("+")}`;
    const join = childColumns
      .map(
        (column, index) =>
          `child.${quoteIdentifier(column)} = parent.${quoteIdentifier(parentColumns[index])}`
      )
      .join(" AND ");
    const present = childColumns
      .map((column) => `child.${quoteIdentifier(column)} IS NOT NULL`)
      .join(" AND ");
    const rows = await query(
      client,
      `SELECT ${jsonObjectExpression("child", childPrimaryKey)} AS "childPrimaryKey",
              ${jsonObjectExpression("parent", parentPrimaryKey)} AS "parentPrimaryKey"
       FROM ${quoteIdentifier(relation.childTable)} child
       JOIN ${quoteIdentifier(relation.parentTable)} parent ON ${join}
       WHERE ${present}`
    );
    for (const row of rows) {
      references.push({
        name,
        childTable: relation.childTable,
        childPrimaryKey: row.childPrimaryKey,
        parentTable: relation.parentTable,
        parentPrimaryKey: row.parentPrimaryKey,
        ...(relation.protectsChildLifecycle === true
          ? { protectsChildLifecycle: true }
          : {})
      });
    }
    const missing = await query(
      client,
      `SELECT ${jsonObjectExpression("child", childPrimaryKey)} AS "childPrimaryKey"
       FROM ${quoteIdentifier(relation.childTable)} child
       LEFT JOIN ${quoteIdentifier(relation.parentTable)} parent ON ${join}
       WHERE ${present}
         AND parent.${quoteIdentifier(parentPrimaryKey[0])} IS NULL`
    );
    for (const row of missing) {
      dangling.push({
        name,
        childTable: relation.childTable,
        childPrimaryKey: row.childPrimaryKey,
        parentTable: relation.parentTable
      });
    }
  }
  return { references, dangling };
}

async function inspectDatabaseInventory(client, { environment, lockTables = false }) {
  invariant(typeof environment === "string" && environment.trim(), "必须提供精确环境标识");
  let schema = await loadSchema(client);
  if (lockTables) {
    let lockedTables = new Set();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const unlockedTables = schema.tables.filter((table) => !lockedTables.has(table));
      if (unlockedTables.length > 0) {
        await lockAllTables(client, unlockedTables);
        lockedTables = new Set([...lockedTables, ...unlockedTables]);
      }
      const refreshed = await loadSchema(client);
      const stable =
        refreshed.tables.length === lockedTables.size &&
        refreshed.tables.every((table) => lockedTables.has(table));
      schema = refreshed;
      if (stable) break;
      if (attempt === 4) throw new Error("Schema 在锁定期间持续漂移，执行已阻断");
    }
  }
  const tables = [];
  for (const name of schema.tables) {
    const primaryKey = schema.primaryKeys.get(name);
    invariant(primaryKey?.length > 0, `${name} 没有主键，归零预检失败关闭`);
    tables.push({
      name,
      primaryKey,
      rows: await loadPrimaryKeyRows(client, name, primaryKey)
    });
  }
  const [fileBindingResult, fileRelations, foreignKeyEvidence, logicalRelationEvidence] = await Promise.all([
    loadFileBindings(client, schema.primaryKeys),
    loadFileRelations(client),
    loadForeignKeyEvidence(client, schema),
    loadLogicalRelationEvidence(client, schema)
  ]);
  const bindingManifestPairs = new Set(
    fileBindingResult.manifest.map((item) => `${item.tableName}.${item.columnName}`)
  );
  const unregisteredFileForeignKeys = schema.foreignKeys
    .filter(
      (foreignKey) =>
        foreignKey.parentTable === "FileObject" &&
        foreignKey.childTable !== "FileObject" &&
        foreignKey.childColumns.some(
          (column) => !bindingManifestPairs.has(`${foreignKey.childTable}.${column}`)
        )
    )
    .map((foreignKey) => ({
      code: "UNREGISTERED_FILE_BINDING",
      foreignKey: foreignKey.name,
      table: foreignKey.childTable,
      columns: foreignKey.childColumns
    }));
  const activeTriggerStates =
    schema.identity.sessionReplicationRole === "replica" ? ["R", "A"] : ["O", "A"];
  const deleteGuardTriggers = schema.triggers
    .filter(
      (trigger) =>
        activeTriggerStates.includes(trigger.enabledState) &&
        /\bDELETE\b/iu.test(trigger.triggerDefinition) &&
        /\bRAISE\s+EXCEPTION\b/iu.test(trigger.functionDefinition)
    )
    .map(({ tableName, triggerName, enabledState }) => ({
      tableName,
      triggerName,
      enabledState
    }));
  const migrationHead = schema.migrations.at(-1)?.migrationName ?? null;
  const databaseFingerprint = sha256(schema.identity);
  const schemaDigest = computeSchemaDigest(schema);
  return {
    environment: environment.trim(),
    databaseFingerprint,
    migrationHead,
    migrationCount: schema.migrations.length,
    schemaDigest,
    tables,
    fileBindings: fileBindingResult.bindings,
    fileRelations,
    foreignKeys: schema.foreignKeys,
    foreignKeyReferences: [
      ...foreignKeyEvidence.references,
      ...logicalRelationEvidence.references
    ],
    danglingForeignKeys: [
      ...foreignKeyEvidence.dangling,
      ...logicalRelationEvidence.dangling
    ],
    deleteGuardTriggers,
    schemaBlockers: [
      ...unregisteredFileForeignKeys
    ]
  };
}

async function verifyBusinessZeroingExecutionAudit(client, receipt) {
  const rows = await query(
    client,
    `SELECT "metadata"
       FROM "AuditLog"
      WHERE "action" = $1
        AND "businessType" = $2
        AND "businessId" = $3
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1`,
    "test_business_zeroing.terminal_commit",
    "test_business_zeroing",
    receipt.batchId
  );
  invariant(rows.length === 1, "数据库中缺少本批次权威终态完成标记");
  const metadata = rows[0].metadata;
  invariant(
    metadata?.status === "terminal_committed",
    "本批次权威终态完成标记无效"
  );
  for (const [field, expected, label] of [
    ["environment", receipt.environment, "环境"],
    ["codeSha", receipt.codeSha, "代码 SHA"],
    ["executionCodeSha256", receipt.executionCodeSha256, "实际执行代码指纹"],
    ["deploymentIdentitySha256", receipt.deploymentIdentitySha256, "部署环境身份"],
    ["executorIdentity", receipt.executorIdentity, "执行主体"],
    ["reportSha256", receipt.reportSha256, "执行前报告"],
    ["candidateSha256", receipt.candidateSha256, "候选清单"],
    ["authorizationRef", receipt.authorization?.authorizationRef, "独立授权引用"],
    ["authorizationPublicKeySha256", receipt.authorization?.publicKeySha256, "独立授权公钥"],
    ["authorizationPayloadSha256", receipt.authorization?.payloadSha256, "独立授权 payload"],
    ["receiptSha256", receipt.receiptSha256, "最终执行收据"]
  ]) {
    invariant(metadata?.[field] === expected, `受控执行审计${label}绑定不匹配`);
  }
  invariant(metadata.postcheck?.status === "passed", "受控执行审计后置核验未通过");
  invariant(
    metadata.terminalCommitSha256 ===
      sha256({
        batchId: receipt.batchId,
        reportSha256: receipt.reportSha256,
        candidateSha256: receipt.candidateSha256,
        receiptSha256: receipt.receiptSha256,
        writeFreezeLeaseEnvelopeSha256:
          receipt.writeFreezeLeaseEnvelopeSha256,
        fenceToken: receipt.writeFreezeLease?.fenceToken,
        generation: receipt.writeFreezeLease?.generation
      }),
    "本批次权威终态完成标记绑定不匹配"
  );
  invariant(
    sha256(metadata.executionReceipt) === sha256(receipt),
    "受控执行审计未保留完整最终执行收据"
  );
  return { status: "passed" };
}

function createBusinessZeroingDatabase(prisma, policy) {
  const allowedTables = new Set(policy.tables.map((table) => table.name));
  let primaryKeysByTable = new Map();

  async function refreshSchema(client) {
    const schema = await loadSchema(client);
    primaryKeysByTable = schema.primaryKeys;
    return schema;
  }

  async function appendAuditWithClient(client, event) {
    await query(
      client,
      `INSERT INTO "AuditLog" ("id", "action", "businessType", "businessId", "metadata", "createdAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
      randomUUID(),
      event.databaseAction ?? "test_business_zeroing.controlled_execution",
      "test_business_zeroing",
      event.batchId,
      JSON.stringify(event)
    );
  }

  return {
    async transaction(work) {
      return prisma.$transaction(
        async (tx) => {
          await refreshSchema(tx);
          return work({
            client: tx,
            appendAudit: (event) => appendAuditWithClient(tx, event),
            async deleteExactRecord(candidate) {
              const snapshotStatement = buildExactRowSnapshotStatement(
                candidate,
                primaryKeysByTable,
                allowedTables
              );
              const currentRows = await query(
                tx,
                snapshotStatement.sql,
                ...snapshotStatement.values
              );
              invariant(
                currentRows.length === 1,
                `${candidate.table} 候选逐主键复核数量不是 1，事务必须回滚`
              );
              assertCandidateRowFingerprint(candidate, currentRows[0].rowCanonicalJson);
              const statement = buildExactDeleteStatement(
                candidate,
                primaryKeysByTable,
                allowedTables
              );
              return tx.$executeRawUnsafe(statement.sql, ...statement.values);
            },
            async resetExactSequence(reset) {
              const statement = buildExactSequenceResetStatement(
                reset,
                primaryKeysByTable
              );
              return tx.$executeRawUnsafe(statement.sql, ...statement.values);
            }
          });
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 1_200_000 }
      );
    },
    async commitTerminalAudit({ event, verifyLease }) {
      invariant(typeof verifyLease === "function", "权威终态提交缺少 lease 复核端");
      return prisma.$transaction(
        async (tx) => {
          await query(
            tx,
            `SELECT pg_advisory_xact_lock(${EXECUTION_LOCK_ID}) IS NULL AS "locked"`
          );
          const existing = await query(
            tx,
            `SELECT "id" FROM "AuditLog"
              WHERE "action" = $1 AND "businessType" = $2 AND "businessId" = $3
              LIMIT 1`,
            "test_business_zeroing.terminal_commit",
            "test_business_zeroing",
            event.batchId
          );
          invariant(existing.length === 0, "本批次权威终态已存在，禁止重复提交");
          await appendAuditWithClient(tx, event);
          await appendAuditWithClient(tx, {
            ...event,
            databaseAction: "test_business_zeroing.terminal_commit",
            status: "terminal_committed"
          });
          await verifyLease();
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 1_200_000 }
      );
    },
    appendAudit: (event) => appendAuditWithClient(prisma, event)
  };
}

module.exports = {
  assertCandidateRowFingerprint,
  buildExactDeleteStatement,
  buildExactRowSnapshotStatement,
  buildExactSequenceResetStatement,
  computeSchemaDigest,
  computeDeletionOrder,
  createBusinessZeroingDatabase,
  inspectDatabaseInventory,
  quoteIdentifier,
  verifyBusinessZeroingExecutionAudit
};
