#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const REPORT_TTL_MS = 30 * 60 * 1000;
const POLICY_ID = "pol-22-business-zeroing-v1";
const WRITE_FREEZE_LEASE_PAYLOAD_FIELDS = Object.freeze([
  "batchId",
  "candidateSha256",
  "environment",
  "expiresAt",
  "fenceToken",
  "generation",
  "holderDeploymentIdentitySha256",
  "holderExecutorIdentity",
  "issuedAt",
  "issuer",
  "leaseId",
  "objectDeletionManifestSha256",
  "reportSha256",
  "revokedAt",
  "schemaVersion",
  "scopes",
  "status",
  "testProvenanceRegistrySha256"
]);
const HAN_PATTERN = /[\u3400-\u9fff]/u;
const PREFORMAL_STATUS_ALLOWLIST = new Set([
  "approval_pending",
  "deleting",
  "draft",
  "open",
  "pending",
  "pending_confirm",
  "pending_review",
  "preview",
  "purging",
  "queued",
  "requested",
  "reserved"
]);
const PREFORMAL_LIFECYCLE_FIELD_VALUE_ALLOWLIST = Object.freeze({
  dataStatus: new Set(["legacy_incomplete"]),
  generationStatus: new Set(["not_applicable", "pending", "queued"]),
  mappingStatus: new Set([null, "draft", "pending", "preview"]),
  normalizationStatus: new Set([null, "pending"]),
  pricingFactStatus: new Set(["draft", "unconfirmed"]),
  takeoverStatus: new Set(["draft"]),
  taxFactStatus: new Set(["draft", "pending_finance_review", "unconfirmed"])
});
const FORMAL_LIFECYCLE_FIELD_TOKENS = new Set([
  "abandon", "abandoned",
  "active", "activated", "approval", "approved", "archive", "archived",
  "close", "closed", "complete", "completed", "confirm", "confirmed",
  "discard", "discarded", "dispose", "disposed",
  "effective", "enable", "enabled", "end", "ended", "execute", "executed",
  "expire", "expired", "final", "formal", "freeze", "frozen", "invalid",
  "invalidated", "lock", "locked", "paid", "publish", "published", "release",
  "released", "reject", "rejected", "repaid", "resolve", "resolved", "reverse",
  "reversed", "revoke", "revoked", "seal", "sealed", "sign", "signed", "state",
  "status", "submit", "submitted", "valid", "void", "voided", "workflow",
  "lifecycle", "phase", "apply", "applied", "terminate", "terminated"
]);

const NULLABLE_LIFECYCLE_EVENT_FIELD =
  /(?:At|ByUserId|Reason|Status|State|Phase)$/u;

function isFormalLifecycleField(field) {
  return String(field)
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .some((token) => FORMAL_LIFECYCLE_FIELD_TOKENS.has(token));
}

function parsePrismaNullableLifecycleRegistry(schemaSource) {
  invariant(typeof schemaSource === "string" && schemaSource.trim(), "Prisma Schema 为空");
  const registry = new Map();
  let modelName;
  for (const sourceLine of schemaSource.split(/\r?\n/u)) {
    const line = sourceLine.replace(/\/\/.*$/u, "");
    const model = line.match(/^\s*model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/u);
    if (model) {
      modelName = model[1];
      registry.set(modelName, new Set());
      continue;
    }
    if (modelName && /^\s*\}/u.test(line)) {
      modelName = undefined;
      continue;
    }
    if (!modelName) continue;
    const field = line.match(/^\s+([A-Za-z][A-Za-z0-9_]*)\s+([^\s]+)\?/u);
    if (
      field &&
      (NULLABLE_LIFECYCLE_EVENT_FIELD.test(field[1]) ||
        isFormalLifecycleField(field[1]))
    ) {
      registry.get(modelName).add(field[1]);
    }
  }
  return registry;
}

function parsePrismaNullableLifecycleFields(schemaSource) {
  return new Set(
    [...parsePrismaNullableLifecycleRegistry(schemaSource).values()]
      .flatMap((fields) => [...fields])
  );
}

const KNOWN_NULLABLE_LIFECYCLE_REGISTRY = parsePrismaNullableLifecycleRegistry(
  readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8")
);

function isKnownNullableLifecycleField(tableName, field) {
  return KNOWN_NULLABLE_LIFECYCLE_REGISTRY.get(tableName)?.has(field) === true;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function comparePrimaryKeys(left, right) {
  return JSON.stringify(canonicalize(left)).localeCompare(
    JSON.stringify(canonicalize(right))
  );
}

function rowPrimaryKey(table, row) {
  const primaryKey = Object.fromEntries(
    table.primaryKey.map((column) => [column, String(row[column] ?? "")])
  );
  invariant(
    Object.values(primaryKey).every((value) => value.length > 0),
    `${table.name} 存在空主键，无法形成显式候选`
  );
  return primaryKey;
}

function recordKey(table, primaryKey) {
  return `${table}:${sha256(primaryKey)}`;
}

function verifySignedDocument(document, label) {
  invariant(document && typeof document === "object", `${label}无效`);
  const { receiptSha256, ...body } = document;
  invariant(
    /^[0-9a-f]{64}$/u.test(receiptSha256 ?? "") &&
      receiptSha256 === sha256(body),
    `${label} SHA-256 不匹配`
  );
}

function validatePolicy(policy) {
  invariant(policy?.id === POLICY_ID, `策略必须精确为 ${POLICY_ID}`);
  invariant(Array.isArray(policy.tables) && policy.tables.length > 0, "策略表清单不能为空");
  const names = new Set();
  for (const table of policy.tables) {
    invariant(/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table.name), "策略包含非法表名");
    invariant(!names.has(table.name), `策略表重复：${table.name}`);
    names.add(table.name);
    invariant(HAN_PATTERN.test(table.chineseName ?? ""), `${table.name} 缺少中文业务名称`);
    invariant(
      ["protected", "review", "business_review", "file"].includes(table.disposition),
      `${table.name} disposition 无效`
    );
  }
  invariant(
    policy.tables.some(
      (table) => table.name === "_prisma_migrations" && table.disposition === "protected"
    ),
    "数据库迁移历史必须显式保护"
  );
  invariant(
    policy.tables.some((table) => table.name === "FileObject" && table.disposition === "file"),
    "FileObject 必须逐绑定分类"
  );
  return policy;
}

function validateBackupReceipt(receipt, environment, databaseFingerprint, generatedAt) {
  verifySignedDocument(receipt, "备份恢复收据");
  invariant(receipt.schemaVersion === 1, "备份恢复收据版本无效");
  invariant(receipt.environment === environment, "备份恢复收据环境不匹配");
  invariant(
    receipt.databaseFingerprint === databaseFingerprint,
    "备份恢复收据数据库 fingerprint 不匹配"
  );
  const preflightAt = new Date(generatedAt).getTime();
  invariant(
    typeof generatedAt === "string" &&
      Number.isFinite(preflightAt) &&
      new Date(preflightAt).toISOString() === generatedAt,
    "预检生成时间无效"
  );
  for (const [key, chineseName] of [
    ["databaseBackup", "数据库备份"],
    ["privateFileBackup", "私有文件备份"]
  ]) {
    const backup = receipt[key];
    invariant(typeof backup?.location === "string" && backup.location.trim(), `${chineseName}位置缺失`);
    invariant(/^[0-9a-f]{64}$/u.test(backup.sha256 ?? ""), `${chineseName}校验值无效`);
    const capturedAt = new Date(backup.capturedAt).getTime();
    invariant(
      typeof backup.capturedAt === "string" &&
        Number.isFinite(capturedAt) &&
        new Date(capturedAt).toISOString() === backup.capturedAt,
      `${chineseName}捕获时间无效`
    );
    invariant(
      typeof backup.restoreTarget === "string" && backup.restoreTarget.trim(),
      `${chineseName}隔离恢复目标缺失`
    );
    const restoreVerifiedAt = new Date(backup.restoreVerifiedAt).getTime();
    invariant(
      typeof backup.restoreVerifiedAt === "string" &&
        Number.isFinite(restoreVerifiedAt) &&
        new Date(restoreVerifiedAt).toISOString() === backup.restoreVerifiedAt &&
        restoreVerifiedAt >= capturedAt,
      `${chineseName}恢复验证时间无效`
    );
    invariant(
      capturedAt <= preflightAt && restoreVerifiedAt <= preflightAt,
      `${chineseName}捕获或恢复验证时间晚于本次预检`
    );
    invariant(backup.restoreStatus === "passed", `${chineseName}恢复验证未通过`);
  }
  return receipt;
}

function validateDecisionManifest(
  manifest,
  policy,
  inventory,
  { allowMissingDeletedDecisions = false } = {}
) {
  validatePolicy(policy);
  verifySignedDocument(manifest, "逐主键决定清单");
  invariant(manifest.schemaVersion === 1, "逐主键决定清单版本无效");
  invariant(manifest.policyId === policy.id, "逐主键决定清单策略不匹配");
  invariant(manifest.environment === inventory.environment, "逐主键决定清单环境不匹配");
  invariant(
    manifest.databaseFingerprint === inventory.databaseFingerprint,
    "逐主键决定清单数据库 fingerprint 不匹配"
  );
  invariant(Array.isArray(manifest.records), "逐主键决定清单 records 必须是数组");

  const policyByName = new Map(policy.tables.map((table) => [table.name, table]));
  const inventoryByName = new Map(inventory.tables.map((table) => [table.name, table]));
  const inventoryRecordKeys = new Set();
  for (const table of inventory.tables) {
    if (!Array.isArray(table.primaryKey) || !Array.isArray(table.rows)) continue;
    for (const row of table.rows) {
      inventoryRecordKeys.add(recordKey(table.name, rowPrimaryKey(table, row)));
    }
  }
  const decisions = new Map();
  for (const record of manifest.records) {
    invariant(HAN_PATTERN.test(record.businessType ?? ""), "保留决定必须使用中文业务类型");
    const tablePolicy = policyByName.get(record.table);
    invariant(
      ["review", "business_review"].includes(tablePolicy?.disposition),
      "决定清单只能包含需逐条复核的基础或业务资料"
    );
    const table = inventoryByName.get(record.table);
    invariant(table, `决定清单包含当前 Schema 不存在的表：${record.table}`);
    invariant(record.primaryKey && typeof record.primaryKey === "object", "决定清单主键无效");
    const actualColumns = Object.keys(record.primaryKey).sort();
    const expectedColumns = [...table.primaryKey].sort();
    invariant(
      JSON.stringify(actualColumns) === JSON.stringify(expectedColumns) &&
        Object.values(record.primaryKey).every(
          (value) => ["string", "number", "bigint"].includes(typeof value) && String(value).length > 0
        ),
      `${record.table} 决定清单主键不精确`
    );
    invariant(["preserve", "delete"].includes(record.decision), "决定必须为 preserve 或 delete");
    invariant(typeof record.reason === "string" && record.reason.trim(), "决定必须说明中文复核原因");
    const key = recordKey(record.table, canonicalize(record.primaryKey));
    invariant(
      inventoryRecordKeys.has(key) ||
        (allowMissingDeletedDecisions && record.decision === "delete"),
      "逐主键决定清单包含当前数据库不存在的主键"
    );
    invariant(!decisions.has(key), "逐主键决定清单包含重复主键");
    decisions.set(key, {
      ...record,
      primaryKey: canonicalize(record.primaryKey),
      businessType: tablePolicy.chineseName
    });
  }
  return decisions;
}

function validateTestProvenanceEnvelope(
  envelope,
  publicKeyInput,
  registry,
  registrySha256,
  policy,
  inventory,
  decisions,
  generatedAt,
  trustedPublicKeySha256,
  trustedRegistrySha256,
  { allowMissingDeletedDecisions = false } = {}
) {
  const deleteDecisions = [...decisions.entries()].filter(
    ([, decision]) => decision.decision === "delete"
  );
  if (deleteDecisions.length === 0 && envelope == null) {
    return { proofs: new Map(), verification: null };
  }
  invariant(
    JSON.stringify(Object.keys(envelope ?? {}).sort()) ===
      JSON.stringify(["algorithm", "payload", "schemaVersion", "signature"]),
    "独立测试来源工件字段不精确"
  );
  invariant(envelope.schemaVersion === 1, "独立测试来源工件版本无效");
  invariant(envelope.algorithm === "Ed25519", "独立测试来源必须使用 Ed25519");
  const payloadBytes = decodeBase64(envelope.payload, "独立测试来源 payload");
  const signature = decodeBase64(envelope.signature, "独立测试来源签名");
  let publicKey;
  try {
    publicKey =
      publicKeyInput?.type === "public"
        ? publicKeyInput
        : crypto.createPublicKey(publicKeyInput);
  } catch {
    throw new Error("独立测试来源公钥无效");
  }
  invariant(publicKey.asymmetricKeyType === "ed25519", "独立测试来源公钥必须是 Ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  invariant(
    /^[0-9a-f]{64}$/u.test(trustedPublicKeySha256 ?? "") &&
      sha256Bytes(publicKeyDer) === trustedPublicKeySha256,
    "独立测试来源公钥与固定部署信任锚不匹配"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(trustedRegistrySha256 ?? "") &&
      registrySha256 === trustedRegistrySha256 &&
      sha256(registry) === registrySha256,
    "外部测试来源注册表与固定部署信任锚不匹配"
  );
  invariant(
    crypto.verify(null, payloadBytes, publicKey, signature),
    "独立测试来源签名验证失败"
  );
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("独立测试来源 payload 不是合法 JSON");
  }
  invariant(
    JSON.stringify(Object.keys(payload ?? {}).sort()) ===
      JSON.stringify([
        "databaseFingerprint",
        "environment",
        "issuedAt",
        "issuer",
        "policyId",
        "records",
        "registryRef",
        "schemaVersion"
      ]),
    "独立测试来源 payload 字段不精确"
  );
  invariant(payload.schemaVersion === 1, "独立测试来源 payload 版本无效");
  invariant(payload.policyId === policy.id, "独立测试来源策略不匹配");
  invariant(payload.environment === inventory.environment, "独立测试来源环境不匹配");
  invariant(
    payload.databaseFingerprint === inventory.databaseFingerprint,
    "独立测试来源数据库 fingerprint 不匹配"
  );
  invariant(
    typeof payload.registryRef === "string" && payload.registryRef.trim().length >= 8,
    "独立测试来源注册表引用无效"
  );
  invariant(typeof payload.issuer === "string" && payload.issuer.trim(), "独立测试来源签发者缺失");
  const issuedAt = new Date(payload.issuedAt).getTime();
  const preflightAt = new Date(generatedAt).getTime();
  invariant(
    typeof payload.issuedAt === "string" &&
      Number.isFinite(issuedAt) &&
      new Date(issuedAt).toISOString() === payload.issuedAt &&
      issuedAt <= preflightAt,
    "独立测试来源签发时间无效"
  );
  invariant(Array.isArray(payload.records), "独立测试来源 records 必须是数组");
  invariant(
    JSON.stringify(Object.keys(registry ?? {}).sort()) ===
      JSON.stringify([
        "databaseFingerprint",
        "environment",
        "records",
        "registryRef",
        "schemaVersion"
      ]),
    "外部测试来源注册表字段不精确"
  );
  invariant(registry.schemaVersion === 1, "外部测试来源注册表版本无效");
  invariant(registry.registryRef === payload.registryRef, "独立测试来源注册表引用不存在");
  invariant(registry.environment === inventory.environment, "外部测试来源注册表环境不匹配");
  invariant(
    registry.databaseFingerprint === inventory.databaseFingerprint,
    "外部测试来源注册表数据库 fingerprint 不匹配"
  );
  invariant(Array.isArray(registry.records), "外部测试来源注册表 records 必须是数组");
  const registryRecords = new Map();
  for (const registryRecord of registry.records) {
    invariant(
      JSON.stringify(Object.keys(registryRecord ?? {}).sort()) ===
        JSON.stringify([
          "evidenceSha256",
          "primaryKey",
          "rowSha256",
          "sourceKind",
          "sourceRef",
          "table"
        ]),
      "外部测试来源注册表记录字段不精确"
    );
    invariant(
      typeof registryRecord.sourceRef === "string" &&
        registryRecord.sourceRef.trim().length >= 8 &&
        !registryRecords.has(registryRecord.sourceRef),
      "外部测试来源注册表记录引用无效或重复"
    );
    const evidenceBody = {
      registryRef: registry.registryRef,
      environment: registry.environment,
      databaseFingerprint: registry.databaseFingerprint,
      sourceKind: registryRecord.sourceKind,
      sourceRef: registryRecord.sourceRef,
      table: registryRecord.table,
      primaryKey: canonicalize(registryRecord.primaryKey),
      rowSha256: registryRecord.rowSha256
    };
    invariant(
      registryRecord.evidenceSha256 === sha256(evidenceBody),
      "外部测试来源注据摘要不匹配"
    );
    registryRecords.set(registryRecord.sourceRef, canonicalize(registryRecord));
  }

  const policyByName = new Map(policy.tables.map((table) => [table.name, table]));
  const inventoryByName = new Map(inventory.tables.map((table) => [table.name, table]));
  const inventoryRows = new Map();
  for (const table of inventory.tables) {
    if (!Array.isArray(table.primaryKey) || !Array.isArray(table.rows)) continue;
    for (const row of table.rows) {
      inventoryRows.set(recordKey(table.name, rowPrimaryKey(table, row)), row);
    }
  }
  const proofs = new Map();
  for (const record of payload.records) {
    invariant(
      JSON.stringify(Object.keys(record ?? {}).sort()) ===
        JSON.stringify([
          "evidenceSha256",
          "primaryKey",
          "rowSha256",
          "sourceKind",
          "sourceRef",
          "table"
        ]),
      "独立测试来源记录字段不精确"
    );
    const tablePolicy = policyByName.get(record.table);
    invariant(
      ["review", "business_review"].includes(tablePolicy?.disposition),
      "独立测试来源只能证明需逐条复核的基础或业务资料"
    );
    const table = inventoryByName.get(record.table);
    invariant(table, `独立测试来源包含当前 Schema 不存在的表：${record.table}`);
    invariant(record.primaryKey && typeof record.primaryKey === "object", "独立测试来源主键无效");
    invariant(
      JSON.stringify(Object.keys(record.primaryKey).sort()) ===
        JSON.stringify([...table.primaryKey].sort()) &&
        Object.values(record.primaryKey).every(
          (value) => ["string", "number", "bigint"].includes(typeof value) && String(value).length > 0
        ),
      `${record.table} 独立测试来源主键不精确`
    );
    invariant(/^[0-9a-f]{64}$/u.test(record.rowSha256 ?? ""), "独立测试来源行指纹无效");
    invariant(
      ["isolated_fixture_registry", "trusted_test_operation_registry"].includes(
        record.sourceKind
      ),
      "独立测试来源类型不受信任"
    );
    invariant(
      typeof record.sourceRef === "string" && record.sourceRef.trim().length >= 8,
      "独立测试来源记录引用无效"
    );
    invariant(
      /^[0-9a-f]{64}$/u.test(record.evidenceSha256 ?? ""),
      "独立测试来源证据摘要无效"
    );
    invariant(
      JSON.stringify(canonicalize(record)) ===
        JSON.stringify(registryRecords.get(record.sourceRef)),
      "独立测试来源记录未在外部不可变注册表中精确登记"
    );
    const primaryKey = canonicalize(record.primaryKey);
    const key = recordKey(record.table, primaryKey);
    invariant(decisions.get(key)?.decision === "delete", "独立测试来源没有对应的删除决定");
    const row = inventoryRows.get(key);
    invariant(
      row || allowMissingDeletedDecisions,
      "独立测试来源对应记录在当前数据库中不存在"
    );
    if (row) {
      invariant(
        record.rowSha256 === recordContentSha256(record.table, row),
        "独立测试来源与当前记录完整行指纹不匹配"
      );
    }
    invariant(!proofs.has(key), "独立测试来源包含重复主键");
    proofs.set(key, { ...record, primaryKey });
  }
  for (const [key] of deleteDecisions) {
    invariant(proofs.has(key), "删除决定缺少逐主键独立测试来源证明");
  }
  invariant(proofs.size === deleteDecisions.length, "独立测试来源范围与删除决定不精确一致");
  return {
    proofs,
    verification: {
      registryRef: payload.registryRef.trim(),
      issuer: payload.issuer.trim(),
      issuedAt: payload.issuedAt,
      publicKeySha256: sha256Bytes(publicKeyDer),
      payloadSha256: sha256Bytes(payloadBytes),
      registrySha256,
      recordCount: proofs.size
    }
  };
}

function candidate(businessType, table, primaryKey, extra = {}) {
  return {
    businessType,
    table,
    primaryKey: canonicalize(primaryKey),
    action: "delete_exact_primary_key",
    ...extra
  };
}

function recordContentSha256(tableName, row, { preservation = false } = {}) {
  const value =
    preservation && tableName === "ContractNumberRule"
      ? row.preservationSha256
      : row.rowSha256;
  invariant(/^[0-9a-f]{64}$/u.test(value ?? ""), `${tableName} 记录内容指纹无效`);
  return value;
}

function selectFormalObservationFields(row, tableName) {
  return Object.fromEntries(
    Object.entries(row ?? {}).filter(
      ([field]) =>
        field === "status" ||
        field === "code" ||
        field === "formalCode" ||
        isFormalLifecycleField(field) ||
        isKnownNullableLifecycleField(tableName, field)
    )
  );
}

function observedFormalProtection(tableName, row) {
  if (Object.hasOwn(row, "status")) {
    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
    if (!PREFORMAL_STATUS_ALLOWLIST.has(status)) {
      return {
        field: "status",
        observedClassification: status ? `protected_or_unknown:${status}` : "invalid_or_empty"
      };
    }
  }
  for (const field of ["code", "formalCode"]) {
    if (
      !(tableName === "ContractNumberTombstone" && field === "formalCode") &&
      Object.hasOwn(row, field) &&
      typeof row[field] === "string" &&
      row[field].trim()
    ) {
      return { field, observedClassification: "non_empty_formal_number" };
    }
  }
  if (["BusinessDailySequence", "ContractNumberTombstone"].includes(tableName)) {
    return null;
  }
  for (const field of Object.keys(row).filter(
    (candidate) =>
      isFormalLifecycleField(candidate) ||
      isKnownNullableLifecycleField(tableName, candidate)
  )) {
    const value = row[field];
    if (field === "status") continue;
    if (value === false) continue;
    if (value === null && isKnownNullableLifecycleField(tableName, field)) {
      continue;
    }
    const allowedValues = PREFORMAL_LIFECYCLE_FIELD_VALUE_ALLOWLIST[field];
    const normalizedValue =
      typeof value === "string" ? value.trim().toLowerCase() : value;
    if (allowedValues?.has(normalizedValue)) continue;
    return {
      field,
      observedClassification:
        value === true
          ? "formal_lifecycle_flag_true"
          : "formal_or_unknown_lifecycle_value_present"
    };
  }
  return null;
}

function preservationAnchor(tableName, primaryKey, row) {
  return {
    table: tableName,
    primaryKey: canonicalize(primaryKey),
    rowSha256: recordContentSha256(tableName, row, { preservation: true })
  };
}

function computeCandidateDeletionOrder(candidates, foreignKeyReferences) {
  const byKey = new Map(
    candidates.map((item) => [recordKey(item.table, item.primaryKey), item])
  );
  const outgoing = new Map([...byKey.keys()].map((key) => [key, new Set()]));
  const indegree = new Map([...byKey.keys()].map((key) => [key, 0]));
  for (const reference of foreignKeyReferences ?? []) {
    const childKey = recordKey(reference.childTable, canonicalize(reference.childPrimaryKey));
    const parentKey = recordKey(reference.parentTable, canonicalize(reference.parentPrimaryKey));
    if (childKey === parentKey || !byKey.has(childKey) || !byKey.has(parentKey)) continue;
    if (!outgoing.get(childKey).has(parentKey)) {
      outgoing.get(childKey).add(parentKey);
      indegree.set(parentKey, indegree.get(parentKey) + 1);
    }
  }
  const compareKeys = (left, right) => {
    const leftItem = byKey.get(left);
    const rightItem = byKey.get(right);
    return (
      leftItem.table.localeCompare(rightItem.table) ||
      comparePrimaryKeys(leftItem.primaryKey, rightItem.primaryKey)
    );
  };
  const ready = [...byKey.keys()].filter((key) => indegree.get(key) === 0).sort(compareKeys);
  const result = [];
  while (ready.length > 0) {
    const current = ready.shift();
    result.push(current);
    for (const parent of [...outgoing.get(current)].sort(compareKeys)) {
      indegree.set(parent, indegree.get(parent) - 1);
      if (indegree.get(parent) === 0) {
        ready.push(parent);
        ready.sort(compareKeys);
      }
    }
  }
  const shape = (key) => ({
    table: byKey.get(key).table,
    primaryKey: byKey.get(key).primaryKey
  });
  return {
    order: result.map(shape),
    cycles: [...byKey.keys()].filter((key) => !result.includes(key)).sort(compareKeys).map(shape)
  };
}

function reportStateFingerprint(report) {
  return sha256({
    migrationHead: report.migrationHead,
    migrationCount: report.migrationCount,
    schemaDigest: report.schemaDigest,
    executionCodeSha256: report.executionCodeSha256,
    deploymentIdentitySha256: report.deploymentIdentitySha256,
    executorIdentity: report.executorIdentity,
    testProvenanceEnvelopeSha256: report.testProvenanceEnvelopeSha256,
    testProvenanceVerification: report.testProvenanceVerification,
    testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
    trustedTestProvenancePublicKeySha256:
      report.trustedTestProvenancePublicKeySha256,
    trustedWriteFreezePublicKeySha256:
      report.trustedWriteFreezePublicKeySha256,
    objectDeletionManifest: report.objectDeletionManifest,
    objectDeletionManifestSha256: report.objectDeletionManifestSha256,
    preservationWhitelist: report.preservationWhitelist,
    preservationAnchors: report.preservationAnchors,
    preservationCounts: report.preservationCounts,
    preservationCountsByBusinessType: report.preservationCountsByBusinessType,
    deletionCandidates: report.deletionCandidates,
    deletionCountsByBusinessType: report.deletionCountsByBusinessType,
    numberResets: report.numberResets,
    expectedReleasedNumbers: report.expectedReleasedNumbers,
    deletionOrder: report.deletionOrder,
    fileBindings: report.fileBindings,
    blockers: report.blockers
  });
}

function countByBusinessType(records) {
  return Object.fromEntries(
    [...records.reduce((counts, record) => {
      counts.set(record.businessType, (counts.get(record.businessType) ?? 0) + 1);
      return counts;
    }, new Map())]
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function buildPreflightReport({
  policy,
  inventory,
  decisions,
  backup,
  codeSha,
  executionCodeSha256,
  deploymentIdentitySha256,
  executorIdentity,
  testProvenance,
  testProvenancePublicKey,
  testProvenanceRegistry,
  testProvenanceRegistrySha256,
  trustedTestProvenancePublicKeySha256,
  trustedTestProvenanceRegistrySha256,
  trustedWriteFreezePublicKeySha256,
  generatedAt,
  allowMissingDeletedDecisions = false
}) {
  validatePolicy(policy);
  invariant(/^[0-9a-f]{40}$/u.test(codeSha ?? ""), "候选 SHA 必须是完整 40 位");
  invariant(
    /^[0-9a-f]{64}$/u.test(executionCodeSha256 ?? ""),
    "实际执行代码指纹必须是 64 位 SHA-256"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(deploymentIdentitySha256 ?? ""),
    "部署环境身份指纹必须是 64 位 SHA-256"
  );
  invariant(
    /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(executorIdentity ?? ""),
    "执行主体身份无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(trustedTestProvenancePublicKeySha256 ?? ""),
    "固定的独立测试来源公钥指纹无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(trustedTestProvenanceRegistrySha256 ?? ""),
    "固定的外部测试来源注册表指纹无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(trustedWriteFreezePublicKeySha256 ?? ""),
    "固定的外部写冻结租约公钥指纹无效"
  );
  const generatedAtEpoch = new Date(generatedAt).getTime();
  invariant(
    typeof generatedAt === "string" &&
      Number.isFinite(generatedAtEpoch) &&
      new Date(generatedAtEpoch).toISOString() === generatedAt,
    "预检生成时间无效"
  );
  invariant(/^[0-9a-f]{64}$/u.test(inventory.databaseFingerprint ?? ""), "数据库 fingerprint 无效");
  invariant(/^[0-9a-f]{64}$/u.test(inventory.schemaDigest ?? ""), "Schema digest 无效");
  invariant(Array.isArray(inventory.tables), "Schema 表清单无效");

  const blockers = [];
  const addBlocker = (code, message, details) => blockers.push({ code, message, details });
  const policyByName = new Map(policy.tables.map((table) => [table.name, table]));
  const inventoryByName = new Map(inventory.tables.map((table) => [table.name, table]));

  for (const table of inventory.tables) {
    if (!policyByName.has(table.name)) {
      addBlocker("UNKNOWN_TABLE", "发现未分类的新表，最终表未稳定前禁止归零", { table: table.name });
    }
    if (!Array.isArray(table.primaryKey) || table.primaryKey.length === 0) {
      addBlocker("MISSING_PRIMARY_KEY", "表没有可用于逐条删除的主键", { table: table.name });
    }
  }
  for (const tablePolicy of policy.tables) {
    if (!inventoryByName.has(tablePolicy.name)) {
      addBlocker("MISSING_POLICY_TABLE", "策略表与当前 Schema 不一致", { table: tablePolicy.name });
    }
  }
  for (const schemaBlocker of inventory.schemaBlockers ?? []) {
    addBlocker(
      schemaBlocker.code ?? "SCHEMA_BLOCKER",
      "Schema 依赖无法形成安全删除顺序",
      schemaBlocker
    );
  }

  let decisionByKey = new Map();
  try {
    decisionByKey = validateDecisionManifest(decisions, policy, inventory, {
      allowMissingDeletedDecisions
    });
  } catch (error) {
    addBlocker("INVALID_DECISION_MANIFEST", error.message);
  }
  let testProvenanceByKey = new Map();
  let testProvenanceVerification = null;
  try {
    const validated = validateTestProvenanceEnvelope(
      testProvenance,
      testProvenancePublicKey,
      testProvenanceRegistry,
      testProvenanceRegistrySha256,
      policy,
      inventory,
      decisionByKey,
      generatedAt,
      trustedTestProvenancePublicKeySha256,
      trustedTestProvenanceRegistrySha256,
      { allowMissingDeletedDecisions }
    );
    testProvenanceByKey = validated.proofs;
    testProvenanceVerification = validated.verification;
  } catch (error) {
    addBlocker("TEST_PROVENANCE_NOT_VERIFIED", error.message);
  }
  try {
    validateBackupReceipt(
      backup,
      inventory.environment,
      inventory.databaseFingerprint,
      generatedAt
    );
  } catch (error) {
    addBlocker("BACKUP_NOT_VERIFIED", error.message);
  }

  const dispositionByRecord = new Map();
  const preservationWhitelist = [];
  const preservationAnchors = [];
  const preservationCounts = {};
  const deletionCandidates = [];
  const numberResets = [];
  const expectedReleasedNumbers = [];
  const classificationRequired = [];

  for (const table of inventory.tables) {
    const tablePolicy = policyByName.get(table.name);
    if (!tablePolicy || !Array.isArray(table.rows) || !Array.isArray(table.primaryKey)) continue;
    preservationCounts[table.name] = 0;
    if (tablePolicy.disposition === "file") continue;
    for (const row of table.rows) {
      const primaryKey = rowPrimaryKey(table, row);
      const key = recordKey(table.name, primaryKey);
      if (tablePolicy.disposition === "protected") {
        dispositionByRecord.set(key, "preserve");
        preservationCounts[table.name] += 1;
        preservationAnchors.push(preservationAnchor(table.name, primaryKey, row));
        continue;
      }
      const decision = decisionByKey.get(key);
      if (!decision) {
        classificationRequired.push({
          businessType: tablePolicy.chineseName,
          table: table.name,
          primaryKey
        });
        addBlocker("UNCLASSIFIED_REVIEW_RECORD", "记录没有逐主键复核决定", {
          table: table.name,
          primaryKey
        });
        dispositionByRecord.set(key, "unknown");
      } else if (decision.decision === "preserve") {
        if (["BusinessDailySequence", "ContractNumberTombstone"].includes(table.name)) {
          addBlocker(
            "NUMBER_RELEASE_REQUIRES_DELETE",
            "正式启用前的业务编号状态必须逐主键明确删除",
            { table: table.name, primaryKey }
          );
          dispositionByRecord.set(key, "unknown");
          continue;
        }
        dispositionByRecord.set(key, "preserve");
        preservationCounts[table.name] += 1;
        preservationWhitelist.push({
          businessType: tablePolicy.chineseName,
          table: table.name,
          primaryKey,
          reason: decision.reason.trim()
        });
        preservationAnchors.push(preservationAnchor(table.name, primaryKey, row));
        if (table.name === "ContractNumberRule") {
          invariant(
            Number.isInteger(row.nextSequence) && row.nextSequence >= 1,
            "合同编号规则当前序号无效"
          );
          numberResets.push({
            businessType: "合同编号规则正式启用序号",
            table: table.name,
            primaryKey,
            field: "nextSequence",
            expectedValue: row.nextSequence,
            targetValue: 1,
            action: "reset_exact_field_compare_and_set"
          });
          expectedReleasedNumbers.push({
            businessType: "合同编号规则正式启用序号",
            table: table.name,
            primaryKey,
            kind: "number_rule_sequence",
            currentNextSequence: row.nextSequence,
            targetNextSequence: 1,
            action: "release_by_exact_compare_and_set"
          });
        }
      } else {
        const formalProtection = observedFormalProtection(table.name, row);
        if (formalProtection) {
          addBlocker(
            "FORMAL_RECORD_PROTECTED",
            "记录具有正式、生效、归档、完成或未知状态，独立测试来源不得覆盖硬保护",
            { table: table.name, primaryKey, ...formalProtection }
          );
          dispositionByRecord.set(key, "preserve");
          preservationCounts[table.name] += 1;
          preservationWhitelist.push({
            businessType: tablePolicy.chineseName,
            table: table.name,
            primaryKey,
            reason: "观测到正式或未知生命周期标记，硬保护并阻断归零"
          });
          preservationAnchors.push(preservationAnchor(table.name, primaryKey, row));
          continue;
        }
        const provenance = testProvenanceByKey.get(key);
        if (!provenance) {
          addBlocker(
            "UNPROVEN_TEST_RECORD",
            "删除记录缺少与当前行绑定的独立测试来源证明",
            { table: table.name, primaryKey }
          );
          dispositionByRecord.set(key, "unknown");
          continue;
        }
        dispositionByRecord.set(key, "delete");
        const testBusinessType = `${tablePolicy.chineseName}中的测试资料`;
        deletionCandidates.push(
          candidate(testBusinessType, table.name, primaryKey, {
            rowSha256: recordContentSha256(table.name, row),
            testProvenance: {
              sourceKind: provenance.sourceKind,
              sourceRef: provenance.sourceRef,
              evidenceSha256: provenance.evidenceSha256
            }
          })
        );
        if (table.name === "ContractNumberTombstone") {
          invariant(
            typeof row.formalCode === "string" && row.formalCode.trim(),
            "合同编号占用记录缺少正式编号"
          );
          expectedReleasedNumbers.push({
            businessType: testBusinessType,
            table: table.name,
            primaryKey,
            kind: "formal_code_tombstone",
            formalCode: row.formalCode,
            action: "release_by_exact_record_deletion"
          });
        }
        if (table.name === "BusinessDailySequence") {
          invariant(
            Number.isInteger(row.nextSequence) && row.nextSequence >= 1,
            "业务日编号序列当前值无效"
          );
          expectedReleasedNumbers.push({
            businessType: testBusinessType,
            table: table.name,
            primaryKey,
            kind: "daily_sequence",
            prefix: String(row.prefix),
            businessDate: String(row.businessDate),
            currentNextSequence: row.nextSequence,
            action: "release_by_exact_record_deletion"
          });
        }
      }
    }
  }

  const filesTable = inventoryByName.get("FileObject");
  const bindingsByFile = new Map();
  for (const binding of inventory.fileBindings ?? []) {
    const list = bindingsByFile.get(binding.fileId) ?? [];
    list.push(binding);
    bindingsByFile.set(binding.fileId, list);
  }
  const fileRowsById = new Map(
    (filesTable?.rows ?? []).map((file) => [String(file.id), file])
  );
  const fileParent = new Map([...fileRowsById.keys()].map((fileId) => [fileId, fileId]));
  const findFileRoot = (fileId) => {
    let current = fileId;
    while (fileParent.get(current) !== current) current = fileParent.get(current);
    return current;
  };
  const unionFiles = (left, right) => {
    const leftRoot = findFileRoot(left);
    const rightRoot = findFileRoot(right);
    if (leftRoot !== rightRoot) fileParent.set(rightRoot, leftRoot);
  };
  for (const relation of inventory.fileRelations ?? []) {
    const fileId = String(relation.fileId);
    const relatedFileId = String(relation.relatedFileId);
    if (!fileRowsById.has(fileId) || !fileRowsById.has(relatedFileId)) {
      addBlocker("UNKNOWN_FILE_RELATION", "文件替换链包含不存在的文件", {
        fileId,
        relatedFileId
      });
      continue;
    }
    unionFiles(fileId, relatedFileId);
  }
  const componentMembers = new Map();
  for (const fileId of fileRowsById.keys()) {
    const root = findFileRoot(fileId);
    const members = componentMembers.get(root) ?? [];
    members.push(fileId);
    componentMembers.set(root, members);
  }

  const fileBindings = [];
  const orphanFiles = [];
  const objectKeyOwners = new Map();
  const objectSnapshotsByFileId = new Map(
    (inventory.objectSnapshots ?? []).map((item) => [String(item.fileId), item])
  );
  if (filesTable) {
    for (const file of filesTable.rows) {
      const primaryKey = rowPrimaryKey(filesTable, file);
      const fileId = String(file.id);
      const componentFileIds = componentMembers.get(findFileRoot(fileId)) ?? [fileId];
      const bindings = componentFileIds.flatMap(
        (componentFileId) => bindingsByFile.get(componentFileId) ?? []
      );
      const ownerResults = bindings.map((binding) => {
        const ownerPolicy = policyByName.get(binding.ownerTable);
        const ownerDisposition = ownerPolicy
          ? dispositionByRecord.get(recordKey(binding.ownerTable, canonicalize(binding.ownerPrimaryKey))) ??
            (ownerPolicy.disposition === "protected" ? "preserve" : "unknown")
          : "unknown";
        return {
          ownerTable: binding.ownerTable,
          ownerPrimaryKey: canonicalize(binding.ownerPrimaryKey),
          ownerColumn: binding.ownerColumn,
          disposition: ownerDisposition
        };
      });
      const dispositions = new Set(ownerResults.map((item) => item.disposition));
      let classification = "unknown";
      if (bindings.length === 0) {
        classification = "orphan";
        orphanFiles.push({ primaryKey, objectKey: file.objectKey });
        addBlocker("ORPHAN_FILE", "文件没有可证明的业务绑定", { primaryKey });
      } else if (dispositions.has("unknown")) {
        addBlocker("UNKNOWN_FILE_OWNER", "文件绑定包含未知归属", { primaryKey });
      } else if (dispositions.has("preserve") && dispositions.has("delete")) {
        classification = "mixed";
        addBlocker("MIXED_FILE_OWNERSHIP", "文件同时绑定保留资料与测试业务", { primaryKey });
      } else if (dispositions.size === 1 && dispositions.has("preserve")) {
        classification = "preserve";
        preservationCounts.FileObject = (preservationCounts.FileObject ?? 0) + 1;
        dispositionByRecord.set(recordKey("FileObject", primaryKey), "preserve");
        preservationAnchors.push(preservationAnchor("FileObject", primaryKey, file));
      } else if (dispositions.size === 1 && dispositions.has("delete")) {
        classification = "delete";
        dispositionByRecord.set(recordKey("FileObject", primaryKey), "delete");
        const objectSnapshot = objectSnapshotsByFileId.get(fileId);
        if (objectSnapshot?.status !== "ready" || !objectSnapshot.snapshot) {
          addBlocker("OBJECT_SNAPSHOT_UNAVAILABLE", "待删除文件缺少精确对象版本快照", {
            primaryKey
          });
        }
        deletionCandidates.push(
          candidate("测试业务绑定文件", "FileObject", primaryKey, {
            rowSha256: recordContentSha256("FileObject", file),
            objectKey: file.objectKey,
            bucket: file.bucket,
            objectSnapshot: objectSnapshot?.snapshot
          })
        );
      }
      fileBindings.push({
        fileId,
        objectKey: file.objectKey,
        bucket: file.bucket,
        classification,
        relatedFileIds: componentFileIds.filter((item) => item !== fileId).sort(),
        bindings: ownerResults
      });
      const objectScope = `${file.bucket}:${file.objectKey}`;
      const owners = objectKeyOwners.get(objectScope) ?? [];
      owners.push(fileId);
      objectKeyOwners.set(objectScope, owners);
    }
  }

  for (const [objectScope, fileIds] of objectKeyOwners) {
    if (fileIds.length > 1) {
      addBlocker("DUPLICATE_OBJECT_SCOPE", "多个文件记录指向同一对象存储键", {
        objectScopeSha256: sha256(objectScope),
        fileIds: fileIds.sort()
      });
    }
  }

  const deletionCandidateTables = new Set(deletionCandidates.map((item) => item.table));
  for (const trigger of inventory.deleteGuardTriggers ?? []) {
    if (!deletionCandidateTables.has(trigger.tableName)) continue;
    addBlocker("DELETE_GUARD_TRIGGER", "候选表存在启用且可能拒绝删除的触发器", {
      table: trigger.tableName,
      trigger: trigger.triggerName,
      enabledState: trigger.enabledState
    });
  }

  for (const reference of inventory.foreignKeyReferences ?? []) {
    const childDisposition = dispositionByRecord.get(
      recordKey(reference.childTable, canonicalize(reference.childPrimaryKey))
    );
    const parentDisposition = dispositionByRecord.get(
      recordKey(reference.parentTable, canonicalize(reference.parentPrimaryKey))
    );
    if (childDisposition === "preserve" && parentDisposition === "delete") {
      addBlocker("MIXED_RECORD_OWNERSHIP", "保留记录依赖待删除测试记录", {
        foreignKey: reference.name,
        childTable: reference.childTable,
        childPrimaryKey: reference.childPrimaryKey,
        parentTable: reference.parentTable,
        parentPrimaryKey: reference.parentPrimaryKey
      });
    }
    if (
      reference.protectsChildLifecycle === true &&
      childDisposition === "delete" &&
      parentDisposition !== "delete"
    ) {
      addBlocker(
        "FORMAL_AGGREGATE_CHILD_PROTECTED",
        "正式、保留或未知聚合父记录的组成记录不得作为独立测试候选删除",
        {
          foreignKey: reference.name,
          childTable: reference.childTable,
          childPrimaryKey: reference.childPrimaryKey,
          parentTable: reference.parentTable,
          parentPrimaryKey: reference.parentPrimaryKey,
          parentDisposition: parentDisposition ?? "unknown"
        }
      );
    }
  }

  for (const conflict of inventory.ownershipConflicts ?? []) {
    addBlocker("MIXED_RECORD_OWNERSHIP", "记录同时关联保留资料与测试归属", conflict);
  }
  for (const dangling of inventory.danglingForeignKeys ?? []) {
    addBlocker("DANGLING_FOREIGN_KEY", "发现悬空外键", dangling);
  }

  preservationWhitelist.sort((left, right) =>
    `${left.table}:${JSON.stringify(left.primaryKey)}`.localeCompare(
      `${right.table}:${JSON.stringify(right.primaryKey)}`
    )
  );
  preservationAnchors.sort((left, right) =>
    left.table.localeCompare(right.table) || comparePrimaryKeys(left.primaryKey, right.primaryKey)
  );
  deletionCandidates.sort((left, right) =>
    left.table.localeCompare(right.table) || comparePrimaryKeys(left.primaryKey, right.primaryKey)
  );
  numberResets.sort((left, right) => comparePrimaryKeys(left.primaryKey, right.primaryKey));
  expectedReleasedNumbers.sort(
    (left, right) =>
      left.table.localeCompare(right.table) || comparePrimaryKeys(left.primaryKey, right.primaryKey)
  );
  const candidateDeletion = computeCandidateDeletionOrder(
    deletionCandidates,
    inventory.foreignKeyReferences
  );
  for (const cycle of candidateDeletion.cycles) {
    addBlocker("FOREIGN_KEY_CYCLE", "本批逐主键候选存在循环依赖，禁止执行", cycle);
  }
  fileBindings.sort((left, right) => left.fileId.localeCompare(right.fileId));
  blockers.sort((left, right) =>
    `${left.code}:${JSON.stringify(left.details ?? {})}`.localeCompare(
      `${right.code}:${JSON.stringify(right.details ?? {})}`
    )
  );

  const safeDeletionCandidates = blockers.length === 0 ? deletionCandidates : [];
  const safeDeletionOrder = blockers.length === 0 ? candidateDeletion.order : [];
  const safeNumberResets = blockers.length === 0 ? numberResets : [];
  const safeExpectedReleasedNumbers = blockers.length === 0 ? expectedReleasedNumbers : [];
  const objectDeletionManifest = safeDeletionCandidates
    .filter((item) => item.table === "FileObject")
    .map((item) => {
      const scope = {
        table: item.table,
        primaryKey: item.primaryKey,
        bucket: item.bucket,
        objectKey: item.objectKey,
        objectSnapshot: item.objectSnapshot
      };
      return { ...scope, scopeSha256: sha256(scope) };
    });
  const objectDeletionManifestSha256 = sha256(objectDeletionManifest);
  const preservationCountsByBusinessType = countByBusinessType(preservationWhitelist);
  const deletionCountsByBusinessType = countByBusinessType(safeDeletionCandidates);
  const candidateSha256 = sha256({
    deletionCandidates: safeDeletionCandidates,
    numberResets: safeNumberResets,
    expectedReleasedNumbers: safeExpectedReleasedNumbers,
    objectDeletionManifest,
    objectDeletionManifestSha256
  });
  const body = {
    schemaVersion: 1,
    policyId: policy.id,
    mode: "read_only_preflight",
    executed: false,
    status: blockers.length === 0 ? "ready" : "blocked",
    environment: inventory.environment,
    databaseFingerprint: inventory.databaseFingerprint,
    migrationHead: inventory.migrationHead,
    migrationCount: inventory.migrationCount,
    schemaDigest: inventory.schemaDigest,
    codeSha,
    executionCodeSha256,
    deploymentIdentitySha256,
    executorIdentity,
    generatedAt,
    expiresAt: new Date(new Date(generatedAt).getTime() + REPORT_TTL_MS).toISOString(),
    decisionManifestSha256: decisions?.receiptSha256,
    testProvenanceEnvelopeSha256: testProvenance ? sha256(testProvenance) : null,
    testProvenanceVerification,
    testProvenanceRegistrySha256: trustedTestProvenanceRegistrySha256,
    trustedTestProvenancePublicKeySha256,
    trustedWriteFreezePublicKeySha256,
    backupReceiptSha256: backup?.receiptSha256,
    backupRecovery: backup
      ? {
          databaseBackup: backup.databaseBackup,
          privateFileBackup: backup.privateFileBackup
        }
      : null,
    preservationWhitelist,
    preservationAnchors,
    preservationCounts,
    preservationCountsByBusinessType,
    classificationRequired,
    deletionCandidates: safeDeletionCandidates,
    objectDeletionManifest,
    objectDeletionManifestSha256,
    deletionCountsByBusinessType,
    numberResets: safeNumberResets,
    expectedReleasedNumbers: safeExpectedReleasedNumbers,
    candidateSha256,
    fileBindings,
    orphanFiles,
    foreignKeys: inventory.foreignKeys ?? [],
    deletionOrder: safeDeletionOrder,
    danglingForeignKeys: inventory.danglingForeignKeys ?? [],
    blockers,
    summary: {
      preservationWhitelistCount: preservationWhitelist.length,
      deletionCandidateCount: safeDeletionCandidates.length,
      numberResetCount: safeNumberResets.length,
      fileDeletionCandidateCount: safeDeletionCandidates.filter(
        (item) => item.table === "FileObject"
      ).length,
      migrationHistoryDeletionCandidates: safeDeletionCandidates.filter(
        (item) => item.table === "_prisma_migrations"
      ).length,
      databaseDeletionCandidates: 0,
      blockerCount: blockers.length
    }
  };
  const stateFingerprint = reportStateFingerprint(body);
  const withState = { ...body, stateFingerprint };
  return { ...withState, reportSha256: sha256(withState) };
}

function verifyPreflightReport(report) {
  invariant(report && typeof report === "object", "归零预检报告无效");
  const { reportSha256, ...body } = report;
  invariant(
    /^[0-9a-f]{64}$/u.test(reportSha256 ?? "") && reportSha256 === sha256(body),
    "归零预检报告 SHA-256 不匹配"
  );
  invariant(report.mode === "read_only_preflight" && report.executed === false, "报告不是只读预检");
  invariant(/^[0-9a-f]{40}$/u.test(report.codeSha ?? ""), "归零预检报告代码 SHA 无效");
  invariant(
    /^[0-9a-f]{64}$/u.test(report.executionCodeSha256 ?? ""),
    "归零预检报告实际执行代码指纹无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(report.deploymentIdentitySha256 ?? ""),
    "归零预检报告部署环境身份无效"
  );
  invariant(
    /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(report.executorIdentity ?? ""),
    "归零预检报告执行主体无效"
  );
  invariant(Array.isArray(report.blockers), "归零预检报告 blockers 无效");
  invariant(Array.isArray(report.deletionCandidates), "归零预检报告候选清单无效");
  invariant(Array.isArray(report.objectDeletionManifest), "归零预检报告冻结对象清单无效");
  const expectedObjectDeletionManifest = report.deletionCandidates
    .filter((item) => item.table === "FileObject")
    .map((item) => {
      const scope = {
        table: item.table,
        primaryKey: item.primaryKey,
        bucket: item.bucket,
        objectKey: item.objectKey,
        objectSnapshot: item.objectSnapshot
      };
      return { ...scope, scopeSha256: sha256(scope) };
    });
  invariant(
    JSON.stringify(canonicalize(report.objectDeletionManifest)) ===
      JSON.stringify(canonicalize(expectedObjectDeletionManifest)) &&
      report.objectDeletionManifestSha256 === sha256(expectedObjectDeletionManifest),
    "归零预检报告冻结对象清单与删除候选不匹配"
  );
  invariant(
    report.testProvenanceEnvelopeSha256 === null ||
      /^[0-9a-f]{64}$/u.test(report.testProvenanceEnvelopeSha256 ?? ""),
    "归零预检报告独立测试来源工件指纹无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(report.trustedTestProvenancePublicKeySha256 ?? ""),
    "归零预检报告固定测试来源信任锚无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(report.testProvenanceRegistrySha256 ?? ""),
    "归零预检报告外部测试来源注册表指纹无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(report.trustedWriteFreezePublicKeySha256 ?? ""),
    "归零预检报告固定写冻结租约信任锚无效"
  );
  invariant(
    report.testProvenanceVerification === null ||
      (typeof report.testProvenanceVerification?.registryRef === "string" &&
        /^[0-9a-f]{64}$/u.test(report.testProvenanceVerification.publicKeySha256 ?? "") &&
        /^[0-9a-f]{64}$/u.test(report.testProvenanceVerification.payloadSha256 ?? "") &&
        report.testProvenanceVerification.registrySha256 ===
          report.testProvenanceRegistrySha256 &&
        Number.isInteger(report.testProvenanceVerification.recordCount)),
    "归零预检报告独立测试来源验证结果无效"
  );
  for (const item of report.deletionCandidates.filter((candidate) => candidate.table !== "FileObject")) {
    invariant(
      ["isolated_fixture_registry", "trusted_test_operation_registry"].includes(
        item.testProvenance?.sourceKind
      ) &&
        typeof item.testProvenance?.sourceRef === "string" &&
        /^[0-9a-f]{64}$/u.test(item.testProvenance?.evidenceSha256 ?? ""),
      "数据库删除候选缺少逐主键独立测试来源证明"
    );
  }
  invariant(Array.isArray(report.preservationAnchors), "归零预检报告保留记录锚点无效");
  for (const anchor of report.preservationAnchors) {
    invariant(
      typeof anchor.table === "string" &&
        anchor.primaryKey &&
        Object.keys(anchor.primaryKey).length > 0 &&
        /^[0-9a-f]{64}$/u.test(anchor.rowSha256 ?? ""),
      "归零预检报告保留记录锚点无效"
    );
  }
  invariant(Array.isArray(report.numberResets), "归零预检报告编号复位清单无效");
  invariant(Array.isArray(report.expectedReleasedNumbers), "归零预检报告预计释放编号无效");
  invariant(Array.isArray(report.deletionOrder), "归零预检报告删除顺序无效");
  invariant(
    JSON.stringify(report.preservationCountsByBusinessType) ===
      JSON.stringify(countByBusinessType(report.preservationWhitelist)),
    "中文保留白名单分类数量不匹配"
  );
  invariant(
    JSON.stringify(report.deletionCountsByBusinessType) ===
      JSON.stringify(countByBusinessType(report.deletionCandidates)),
    "中文删除候选分类数量不匹配"
  );
  invariant(
    report.candidateSha256 ===
      sha256({
        deletionCandidates: report.deletionCandidates,
        numberResets: report.numberResets,
        expectedReleasedNumbers: report.expectedReleasedNumbers,
        objectDeletionManifest: report.objectDeletionManifest,
        objectDeletionManifestSha256: report.objectDeletionManifestSha256
      }),
    "候选操作清单 SHA-256 不匹配"
  );
  invariant(
    report.stateFingerprint === reportStateFingerprint(report),
    "归零预检报告状态指纹不匹配"
  );
  invariant(
    (report.status === "ready" && report.blockers.length === 0) ||
      (report.status === "blocked" &&
        report.blockers.length > 0 &&
        report.deletionCandidates.length === 0 &&
        report.numberResets.length === 0 &&
        report.expectedReleasedNumbers.length === 0 &&
        report.objectDeletionManifest.length === 0 &&
        report.deletionOrder.length === 0),
    "归零预检报告状态与阻断项不一致"
  );
}

function isExactObjectKey(objectKey) {
  if (
    typeof objectKey !== "string" ||
    !objectKey.trim() ||
    objectKey === "uploads" ||
    objectKey.endsWith("/") ||
    objectKey.includes("\0") ||
    objectKey.includes("\\")
  ) {
    return false;
  }
  return objectKey
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function verifyObjectSnapshot(snapshot) {
  invariant(snapshot && typeof snapshot === "object", "精确对象版本快照缺失");
  const { snapshotSha256, ...body } = snapshot;
  invariant(
    /^[0-9a-f]{64}$/u.test(snapshotSha256 ?? "") && snapshotSha256 === sha256(body),
    "精确对象版本快照 SHA-256 不匹配"
  );
  if (snapshot.kind === "local_file") {
    invariant(/^[0-9a-f]{64}$/u.test(snapshot.contentSha256 ?? ""), "本地对象内容指纹无效");
    invariant(Number.isInteger(snapshot.sizeBytes) && snapshot.sizeBytes >= 0, "本地对象大小无效");
    invariant(Number.isFinite(new Date(snapshot.lastModified).getTime()), "本地对象时间无效");
    invariant(Number.isInteger(snapshot.deviceId) && snapshot.deviceId >= 0, "本地对象设备标识无效");
    invariant(Number.isInteger(snapshot.inodeId) && snapshot.inodeId > 0, "本地对象 inode 标识无效");
    return snapshot;
  }
  invariant(snapshot.kind === "cos_versions", "对象版本快照类型无效");
  invariant(Array.isArray(snapshot.versions) && snapshot.versions.length > 0, "COS 对象版本清单为空");
  const ids = new Set();
  for (const version of snapshot.versions) {
    invariant(typeof version.versionId === "string" && version.versionId.trim(), "COS versionId 无效");
    invariant(!ids.has(version.versionId), "COS 版本清单包含重复 versionId");
    ids.add(version.versionId);
    invariant(typeof version.isDeleteMarker === "boolean", "COS 删除标记无效");
    invariant(typeof version.isLatest === "boolean", "COS 最新版本标记无效");
    invariant(Number.isFinite(new Date(version.lastModified).getTime()), "COS 对象版本时间无效");
  }
  return snapshot;
}

function orderedCandidates(report) {
  verifyPreflightReport(report);
  invariant(report.status === "ready" && report.blockers.length === 0, "预检报告未就绪");
  invariant(Array.isArray(report.deletionOrder), "报告缺少外键删除顺序");
  const orderKeys = report.deletionOrder.map((item) =>
    recordKey(item.table, canonicalize(item.primaryKey))
  );
  invariant(new Set(orderKeys).size === orderKeys.length, "外键删除顺序包含重复主键");
  const order = new Map(orderKeys.map((key, index) => [key, index]));
  const keys = new Set();
  const candidates = report.deletionCandidates.map((item) => {
    invariant(
      item.action === "delete_exact_primary_key" &&
        item.primaryKey &&
        Object.keys(item.primaryKey).length > 0,
      "禁止无逐主键条件的 broad delete"
    );
    const key = recordKey(item.table, item.primaryKey);
    invariant(order.has(key), `候选主键不在外键删除顺序中：${item.table}`);
    invariant(!keys.has(key), "执行候选存在重复逐主键记录");
    keys.add(key);
    invariant(/^[0-9a-f]{64}$/u.test(item.rowSha256 ?? ""), "执行候选缺少完整行指纹");
    if (item.table === "FileObject") {
      invariant(isExactObjectKey(item.objectKey), "禁止前缀或非精确对象键删除");
      invariant(typeof item.bucket === "string" && item.bucket.trim(), "文件候选缺少精确 bucket");
      verifyObjectSnapshot(item.objectSnapshot);
    } else {
      invariant(item.objectKey === undefined && item.bucket === undefined, "非文件候选不得携带对象范围");
    }
    return item;
  });
  return candidates.sort(
    (left, right) =>
      order.get(recordKey(left.table, left.primaryKey)) -
        order.get(recordKey(right.table, right.primaryKey)) ||
      comparePrimaryKeys(left.primaryKey, right.primaryKey)
  );
}

function assertFreshReport(original, fresh, label) {
  verifyPreflightReport(fresh);
  invariant(fresh.environment === original.environment, `${label}环境已漂移`);
  invariant(
    fresh.databaseFingerprint === original.databaseFingerprint,
    `${label}数据库 fingerprint 已漂移`
  );
  invariant(fresh.codeSha === original.codeSha, `${label}代码 SHA 已漂移`);
  invariant(
    fresh.executionCodeSha256 === original.executionCodeSha256,
    `${label}实际执行代码指纹已漂移`
  );
  invariant(
    fresh.deploymentIdentitySha256 === original.deploymentIdentitySha256,
    `${label}部署环境身份已漂移`
  );
  invariant(fresh.executorIdentity === original.executorIdentity, `${label}执行主体已漂移`);
  invariant(fresh.migrationHead === original.migrationHead, `${label}迁移历史已漂移`);
  invariant(fresh.migrationCount === original.migrationCount, `${label}迁移数量已漂移`);
  invariant(fresh.schemaDigest === original.schemaDigest, `${label}Schema 已漂移`);
  invariant(
    fresh.decisionManifestSha256 === original.decisionManifestSha256,
    `${label}逐主键决定清单已漂移`
  );
  invariant(
    fresh.testProvenanceEnvelopeSha256 === original.testProvenanceEnvelopeSha256,
    `${label}独立测试来源工件已漂移`
  );
  invariant(
    fresh.trustedTestProvenancePublicKeySha256 ===
      original.trustedTestProvenancePublicKeySha256,
    `${label}固定测试来源信任锚已漂移`
  );
  invariant(
    fresh.testProvenanceRegistrySha256 ===
      original.testProvenanceRegistrySha256,
    `${label}外部测试来源注册表已漂移`
  );
  invariant(
    fresh.trustedWriteFreezePublicKeySha256 ===
      original.trustedWriteFreezePublicKeySha256,
    `${label}固定写冻结租约信任锚已漂移`
  );
  invariant(
    fresh.objectDeletionManifestSha256 === original.objectDeletionManifestSha256,
    `${label}冻结对象清单已漂移`
  );
  invariant(
    fresh.backupReceiptSha256 === original.backupReceiptSha256,
    `${label}备份恢复收据已漂移`
  );
  invariant(fresh.stateFingerprint === original.stateFingerprint, `${label}状态指纹已漂移`);
  invariant(fresh.candidateSha256 === original.candidateSha256, `${label}候选指纹已漂移`);
  invariant(fresh.status === "ready" && fresh.blockers.length === 0, `${label}预检未就绪`);
}

async function createDryRunReceipt({ report, currentReport, now = new Date() }) {
  verifyPreflightReport(report);
  const observedAt = new Date(now);
  invariant(Number.isFinite(observedAt.getTime()), "dry-run 当前时间无效");
  invariant(
    new Date(report.expiresAt).getTime() >= observedAt.getTime(),
    "dry-run 预检报告已过期"
  );
  assertFreshReport(report, currentReport, "dry-run 新鲜");
  const candidates = orderedCandidates(report);
  return {
    schemaVersion: 1,
    mode: "dry_run",
    executed: false,
    status: "ready",
    environment: report.environment,
    databaseFingerprint: report.databaseFingerprint,
    codeSha: report.codeSha,
    executionCodeSha256: report.executionCodeSha256,
    deploymentIdentitySha256: report.deploymentIdentitySha256,
    executorIdentity: report.executorIdentity,
    reportSha256: report.reportSha256,
    candidateSha256: report.candidateSha256,
    testProvenanceEnvelopeSha256: report.testProvenanceEnvelopeSha256,
    trustedTestProvenancePublicKeySha256:
      report.trustedTestProvenancePublicKeySha256,
    testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
    trustedWriteFreezePublicKeySha256:
      report.trustedWriteFreezePublicKeySha256,
    objectDeletionManifestSha256: report.objectDeletionManifestSha256,
    expectedReleasedNumbers: report.expectedReleasedNumbers,
    steps: [
      ...candidates.map((item, index) => ({
      order: index + 1,
      businessType: item.businessType,
      table: item.table,
      primaryKey: item.primaryKey,
      ...(item.table === "FileObject"
        ? { bucket: item.bucket, objectKey: item.objectKey }
        : {})
      })),
      ...report.numberResets.map((item, index) => ({
        order: candidates.length + index + 1,
        businessType: item.businessType,
        table: item.table,
        primaryKey: item.primaryKey,
        field: item.field,
        expectedValue: item.expectedValue,
        targetValue: item.targetValue,
        action: item.action
      }))
    ]
  };
}

function expectedConfirmation(batchId) {
  return `EXECUTE_TEST_BUSINESS_ZEROING_${batchId}`;
}

function decodeBase64(value, label) {
  invariant(typeof value === "string" && value.length > 0, `${label}缺失`);
  const decoded = Buffer.from(value, "base64");
  invariant(decoded.length > 0 && decoded.toString("base64") === value, `${label}不是严格 Base64`);
  return decoded;
}

function validateAuthorizationEnvelope(envelope, report, args, publicKeyInput, now = new Date()) {
  invariant(
    JSON.stringify(Object.keys(envelope ?? {}).sort()) ===
      JSON.stringify(["algorithm", "payload", "schemaVersion", "signature"]),
    "独立授权工件字段不精确"
  );
  invariant(envelope?.schemaVersion === 1, "独立授权工件版本无效");
  invariant(envelope.algorithm === "Ed25519", "独立授权必须使用 Ed25519");
  const payloadBytes = decodeBase64(envelope.payload, "独立授权 payload");
  const signature = decodeBase64(envelope.signature, "独立授权签名");
  let publicKey;
  try {
    publicKey =
      publicKeyInput?.type === "public"
        ? publicKeyInput
        : crypto.createPublicKey(publicKeyInput);
  } catch {
    throw new Error("独立授权公钥无效");
  }
  invariant(publicKey.asymmetricKeyType === "ed25519", "独立授权公钥必须是 Ed25519");
  invariant(
    crypto.verify(null, payloadBytes, publicKey, signature),
    "独立授权签名验证失败"
  );
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("独立授权 payload 不是合法 JSON");
  }
  invariant(payload?.schemaVersion === 1, "独立授权 payload 版本无效");
  const payloadFields = [
    "authorizationRef",
    "backupReceiptSha256",
    "batchId",
    "candidateSha256",
    "codeSha",
    "confirmation",
    "databaseFingerprint",
    "decisionManifestSha256",
    "deploymentIdentitySha256",
    "environment",
    "executionCodeSha256",
    "executorIdentity",
    "expiresAt",
    "issuedAt",
    "issuer",
    "objectDeletionManifestSha256",
    "policyId",
    "reportSha256",
    "schemaVersion",
    "testProvenanceEnvelopeSha256",
    "testProvenanceRegistrySha256",
    "trustedTestProvenancePublicKeySha256",
    "trustedWriteFreezePublicKeySha256",
    "writeFreezeLeaseEnvelopeSha256"
  ];
  invariant(
    JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(payloadFields),
    "独立授权 payload 字段不精确"
  );
  invariant(
    typeof payload.authorizationRef === "string" && payload.authorizationRef.trim().length >= 8,
    "独立授权引用无效"
  );
  invariant(typeof payload.issuer === "string" && payload.issuer.trim(), "独立授权签发者缺失");
  const issuedAt = new Date(payload.issuedAt).getTime();
  const expiresAt = new Date(payload.expiresAt).getTime();
  invariant(
    typeof payload.issuedAt === "string" &&
      Number.isFinite(issuedAt) &&
      new Date(issuedAt).toISOString() === payload.issuedAt,
    "独立授权签发时间无效"
  );
  invariant(
    typeof payload.expiresAt === "string" &&
      Number.isFinite(expiresAt) &&
      new Date(expiresAt).toISOString() === payload.expiresAt,
    "独立授权过期时间无效"
  );
  invariant(Number.isFinite(issuedAt) && issuedAt <= now.getTime(), "独立授权签发时间无效");
  invariant(Number.isFinite(expiresAt) && expiresAt >= now.getTime(), "独立授权已过期");
  invariant(issuedAt >= new Date(report.generatedAt).getTime(), "独立授权早于预检报告");
  invariant(expiresAt > issuedAt, "独立授权时间窗口无效");
  invariant(expiresAt <= new Date(report.expiresAt).getTime(), "独立授权不得超过预检报告有效期");
  for (const [field, expected, label] of [
    ["policyId", report.policyId, "策略"],
    ["environment", report.environment, "环境"],
    ["databaseFingerprint", report.databaseFingerprint, "数据库 fingerprint"],
    ["codeSha", report.codeSha, "代码 SHA"],
    ["executionCodeSha256", report.executionCodeSha256, "实际执行代码指纹"],
    ["deploymentIdentitySha256", report.deploymentIdentitySha256, "部署环境身份"],
    ["executorIdentity", report.executorIdentity, "执行主体"],
    ["reportSha256", report.reportSha256, "预检报告"],
    ["candidateSha256", report.candidateSha256, "候选清单"],
    ["decisionManifestSha256", report.decisionManifestSha256, "逐主键决定清单"],
    [
      "testProvenanceEnvelopeSha256",
      report.testProvenanceEnvelopeSha256,
      "独立测试来源工件"
    ],
    [
      "trustedTestProvenancePublicKeySha256",
      report.trustedTestProvenancePublicKeySha256,
      "固定测试来源信任锚"
    ],
    [
      "testProvenanceRegistrySha256",
      report.testProvenanceRegistrySha256,
      "外部测试来源注册表"
    ],
    [
      "trustedWriteFreezePublicKeySha256",
      report.trustedWriteFreezePublicKeySha256,
      "固定写冻结租约信任锚"
    ],
    [
      "writeFreezeLeaseEnvelopeSha256",
      args.writeFreezeLeaseEnvelopeSha256 ?? sha256(args.writeFreezeLeaseEnvelope),
      "外部写冻结租约"
    ],
    [
      "objectDeletionManifestSha256",
      report.objectDeletionManifestSha256,
      "冻结对象清单"
    ],
    ["backupReceiptSha256", report.backupReceiptSha256, "备份恢复收据"],
    ["batchId", args.batchId, "batch-id"],
    ["confirmation", expectedConfirmation(args.batchId), "二次确认"]
  ]) {
    invariant(payload[field] === expected, `独立授权${label}绑定不匹配`);
  }
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  return {
    authorizationRef: payload.authorizationRef.trim(),
    issuer: payload.issuer.trim(),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    publicKeySha256: sha256Bytes(publicKeyDer),
    payloadSha256: sha256Bytes(payloadBytes),
    writeFreezeLeaseEnvelopeSha256:
      payload.writeFreezeLeaseEnvelopeSha256,
    trustedWriteFreezePublicKeySha256:
      payload.trustedWriteFreezePublicKeySha256
  };
}

function validateWriteFreezeLeaseEnvelope(
  envelope,
  report,
  args,
  publicKeyInput,
  expectedPublicKeySha256,
  now = new Date()
) {
  invariant(
    JSON.stringify(Object.keys(envelope ?? {}).sort()) ===
      JSON.stringify(["algorithm", "payload", "schemaVersion", "signature"]),
    "外部写冻结租约工件字段不精确"
  );
  invariant(envelope.schemaVersion === 1, "外部写冻结租约工件版本无效");
  invariant(envelope.algorithm === "Ed25519", "外部写冻结租约必须使用 Ed25519");
  const payloadBytes = decodeBase64(envelope.payload, "外部写冻结租约 payload");
  const signature = decodeBase64(envelope.signature, "外部写冻结租约签名");
  let publicKey;
  try {
    publicKey =
      publicKeyInput?.type === "public"
        ? publicKeyInput
        : crypto.createPublicKey(publicKeyInput);
  } catch {
    throw new Error("外部写冻结租约公钥无效");
  }
  invariant(publicKey.asymmetricKeyType === "ed25519", "外部写冻结租约公钥必须是 Ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeySha256 = sha256Bytes(publicKeyDer);
  invariant(
    /^[0-9a-f]{64}$/u.test(expectedPublicKeySha256 ?? "") &&
      publicKeySha256 === expectedPublicKeySha256 &&
      expectedPublicKeySha256 === report.trustedWriteFreezePublicKeySha256,
    "外部写冻结租约公钥与固定信任锚不匹配"
  );
  invariant(
    crypto.verify(null, payloadBytes, publicKey, signature),
    "外部写冻结租约签名验证失败"
  );
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("外部写冻结租约 payload 不是合法 JSON");
  }
  invariant(
    payload?.schemaVersion === 1 &&
      JSON.stringify(Object.keys(payload).sort()) ===
        JSON.stringify(WRITE_FREEZE_LEASE_PAYLOAD_FIELDS),
    "外部写冻结租约 payload 字段不精确"
  );
  invariant(
    typeof payload.leaseId === "string" && payload.leaseId.trim().length >= 8,
    "外部写冻结租约编号无效"
  );
  invariant(typeof payload.issuer === "string" && payload.issuer.trim(), "外部写冻结租约签发者缺失");
  invariant(payload.status === "active" && payload.revokedAt === null, "外部写冻结租约已失效或撤销");
  invariant(
    Number.isInteger(payload.generation) && payload.generation >= 1 &&
      /^[0-9a-f]{64}$/u.test(payload.fenceToken ?? ""),
    "外部写冻结租约代际或 fence token 无效"
  );
  invariant(
    JSON.stringify(payload.scopes) ===
      JSON.stringify(["database_business_writes", "private_object_writes"]),
    "外部写冻结租约未覆盖数据库业务写和私有对象写"
  );
  const issuedAt = new Date(payload.issuedAt).getTime();
  const expiresAt = new Date(payload.expiresAt).getTime();
  invariant(
    typeof payload.issuedAt === "string" &&
      Number.isFinite(issuedAt) &&
      new Date(issuedAt).toISOString() === payload.issuedAt &&
      issuedAt <= now.getTime(),
    "外部写冻结租约签发时间无效"
  );
  invariant(
    typeof payload.expiresAt === "string" &&
      Number.isFinite(expiresAt) &&
      new Date(expiresAt).toISOString() === payload.expiresAt &&
      expiresAt >= now.getTime() &&
      expiresAt <= new Date(report.expiresAt).getTime(),
    "外部写冻结租约已过期或超出预检窗口"
  );
  for (const [field, expected, label] of [
    ["environment", report.environment, "环境"],
    ["batchId", args.batchId, "批次"],
    ["reportSha256", report.reportSha256, "报告"],
    ["candidateSha256", report.candidateSha256, "候选"],
    ["objectDeletionManifestSha256", report.objectDeletionManifestSha256, "对象清单"],
    ["testProvenanceRegistrySha256", report.testProvenanceRegistrySha256, "测试来源注册表"],
    ["holderDeploymentIdentitySha256", report.deploymentIdentitySha256, "部署身份"],
    ["holderExecutorIdentity", report.executorIdentity, "执行主体"]
  ]) {
    invariant(payload[field] === expected, `外部写冻结租约${label}绑定不匹配`);
  }
  return {
    leaseId: payload.leaseId.trim(),
    issuer: payload.issuer.trim(),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    generation: payload.generation,
    fenceToken: payload.fenceToken,
    publicKeySha256,
    payloadSha256: sha256Bytes(payloadBytes),
    envelopeSha256: sha256(envelope),
    scopes: payload.scopes
  };
}

function validateApplyArguments(args, report, now = new Date()) {
  verifyPreflightReport(report);
  invariant(args.apply === true, "执行必须显式提供 --apply");
  invariant(report.status === "ready" && report.blockers.length === 0, "预检报告未就绪");
  invariant(args.environment === report.environment, "执行环境与报告不匹配");
  invariant(
    /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(args.batchId ?? ""),
    "执行 batch-id 无效"
  );
  invariant(
    args.expectedDatabaseFingerprint === report.databaseFingerprint,
    "执行数据库 fingerprint 与报告不匹配"
  );
  invariant(args.expectedCodeSha === report.codeSha, "执行代码 SHA 与报告不匹配");
  invariant(
    args.expectedExecutionCodeSha256 === report.executionCodeSha256,
    "执行代码指纹与报告不匹配"
  );
  invariant(
    args.deploymentIdentitySha256 === report.deploymentIdentitySha256,
    "执行部署环境身份与报告不匹配"
  );
  invariant(args.executorIdentity === report.executorIdentity, "执行主体与报告不匹配");
  invariant(args.expectedReportSha256 === report.reportSha256, "执行报告 SHA-256 不匹配");
  invariant(
    args.expectedCandidateSha256 === report.candidateSha256,
    "执行候选清单 SHA-256 不匹配"
  );
  invariant(
    args.confirmation === expectedConfirmation(args.batchId),
    `二次确认必须精确为 ${expectedConfirmation(args.batchId)}`
  );
  invariant(new Date(report.expiresAt).getTime() >= now.getTime(), "归零预检报告已过期");
  invariant(report.summary.migrationHistoryDeletionCandidates === 0, "禁止删除迁移历史");
  invariant(report.summary.databaseDeletionCandidates === 0, "禁止删除数据库");
  invariant(
    report.deletionCandidates.every(
      (item) =>
        item.action === "delete_exact_primary_key" &&
        HAN_PATTERN.test(item.businessType ?? "") &&
        item.primaryKey &&
        Object.keys(item.primaryKey).length > 0
    ),
    "执行候选必须是显式中文业务类型与逐主键清单"
  );
  orderedCandidates(report);
  return validateAuthorizationEnvelope(
    args.authorizationEnvelope,
    report,
    args,
    args.authorizationPublicKey,
    now
  );
}

function validateExecutionReceipt(
  receipt,
  before,
  authorizationPublicKey,
  writeFreezePublicKey
) {
  verifyPreflightReport(before);
  invariant(receipt && typeof receipt === "object", "执行收据无效");
  const { receiptSha256, ...body } = receipt;
  invariant(
    /^[0-9a-f]{64}$/u.test(receiptSha256 ?? "") && receiptSha256 === sha256(body),
    "执行收据 SHA-256 不匹配"
  );
  invariant(
    receipt.schemaVersion === 1 && receipt.status === "completed" && receipt.executed === true,
    "执行收据未证明受控执行完成"
  );
  invariant(
    JSON.stringify(Object.keys(receipt).sort()) ===
      JSON.stringify([
        "authorization",
        "authorizationEnvelope",
        "batchId",
        "candidateSha256",
        "codeSha",
        "completedAt",
        "deletedObjectCount",
        "deletedRecordCount",
        "deploymentIdentitySha256",
        "environment",
        "executed",
        "executionCodeSha256",
        "executorIdentity",
        "objectDeletionManifestSha256",
        "objectDispositions",
        "objectPostcheck",
        "postcheck",
        "receiptSha256",
        "reportSha256",
        "resetNumberRuleCount",
        "schemaVersion",
        "startedAt",
        "status",
        "testProvenanceEnvelopeSha256",
        "testProvenanceRegistrySha256",
        "trustedTestProvenancePublicKeySha256",
        "trustedWriteFreezePublicKeySha256",
        "writeFreezeLease",
        "writeFreezeLeaseEnvelope",
        "writeFreezeLeaseEnvelopeSha256"
      ]),
    "执行收据字段不精确"
  );
  for (const [field, expected, label] of [
    ["environment", before.environment, "环境"],
    ["codeSha", before.codeSha, "代码 SHA"],
    ["executionCodeSha256", before.executionCodeSha256, "实际执行代码指纹"],
    ["deploymentIdentitySha256", before.deploymentIdentitySha256, "部署环境身份"],
    ["executorIdentity", before.executorIdentity, "执行主体"],
    ["reportSha256", before.reportSha256, "执行前报告"],
    ["candidateSha256", before.candidateSha256, "候选清单"],
    [
      "testProvenanceEnvelopeSha256",
      before.testProvenanceEnvelopeSha256,
      "独立测试来源工件"
    ],
    [
      "trustedTestProvenancePublicKeySha256",
      before.trustedTestProvenancePublicKeySha256,
      "固定测试来源信任锚"
    ],
    [
      "testProvenanceRegistrySha256",
      before.testProvenanceRegistrySha256,
      "外部测试来源注册表"
    ],
    [
      "trustedWriteFreezePublicKeySha256",
      before.trustedWriteFreezePublicKeySha256,
      "固定写冻结租约信任锚"
    ],
    [
      "objectDeletionManifestSha256",
      before.objectDeletionManifestSha256,
      "冻结对象清单"
    ]
  ]) {
    invariant(receipt[field] === expected, `执行收据${label}绑定不匹配`);
  }
  const expectedObjects = before.deletionCandidates.filter(
    (item) => item.table === "FileObject"
  );
  invariant(
    receipt.deletedRecordCount === before.deletionCandidates.length,
    "执行收据删除记录数量与批准候选不匹配"
  );
  invariant(
    receipt.deletedObjectCount === expectedObjects.length,
    "执行收据对象删除数量与冻结清单不匹配"
  );
  invariant(
    receipt.resetNumberRuleCount === before.numberResets.length,
    "执行收据编号复位数量与批准清单不匹配"
  );
  invariant(
    Array.isArray(receipt.objectDispositions) &&
      receipt.objectDispositions.length === expectedObjects.length,
    "执行收据对象 disposition 范围不完整"
  );
  const dispositionByScope = new Map();
  for (const disposition of receipt.objectDispositions) {
    const key = `${disposition?.bucket}:${disposition?.objectKey}`;
    invariant(!dispositionByScope.has(key), "执行收据对象 disposition 重复");
    dispositionByScope.set(key, disposition);
  }
  for (const file of expectedObjects) {
    const disposition = dispositionByScope.get(`${file.bucket}:${file.objectKey}`);
    invariant(disposition?.businessType === file.businessType, "执行收据对象 disposition 业务类型不匹配");
    validateObjectDeletionDisposition(file, disposition);
  }
  invariant(
    receipt.trustedWriteFreezePublicKeySha256 ===
      before.trustedWriteFreezePublicKeySha256 &&
      receipt.writeFreezeLease?.publicKeySha256 ===
        before.trustedWriteFreezePublicKeySha256 &&
      receipt.writeFreezeLease?.envelopeSha256 ===
        receipt.writeFreezeLeaseEnvelopeSha256,
    "执行收据外部写冻结租约验证结果不匹配"
  );
  invariant(typeof receipt.completedAt === "string", "执行收据完成时间缺失");
  invariant(
    typeof receipt.startedAt === "string" &&
      Number.isFinite(new Date(receipt.startedAt).getTime()) &&
      new Date(receipt.startedAt).getTime() <= new Date(receipt.completedAt).getTime(),
    "执行收据起止时间无效"
  );
  const authorization = validateAuthorizationEnvelope(
    receipt.authorizationEnvelope,
    before,
    {
      batchId: receipt.batchId,
      writeFreezeLeaseEnvelopeSha256:
        receipt.writeFreezeLeaseEnvelopeSha256
    },
    authorizationPublicKey,
    new Date(receipt.completedAt)
  );
  invariant(
    sha256(authorization) === sha256(receipt.authorization),
    "执行收据独立授权验证结果不匹配"
  );
  invariant(
    receipt.writeFreezeLeaseEnvelopeSha256 ===
      authorization.writeFreezeLeaseEnvelopeSha256 &&
      receipt.trustedWriteFreezePublicKeySha256 ===
        authorization.trustedWriteFreezePublicKeySha256,
    "执行收据外部写冻结租约与独立授权不匹配"
  );
  const writeFreezeLease = validateWriteFreezeLeaseEnvelope(
    receipt.writeFreezeLeaseEnvelope,
    before,
    { batchId: receipt.batchId },
    writeFreezePublicKey,
    before.trustedWriteFreezePublicKeySha256,
    new Date(receipt.completedAt)
  );
  invariant(
    sha256(writeFreezeLease) === sha256(receipt.writeFreezeLease),
    "执行收据外部写冻结租约签名验证结果不匹配"
  );
  validateObjectRescan(before, receipt.objectPostcheck);
  invariant(receipt.postcheck?.status === "passed", "执行收据后置核验未通过");
  return { status: "passed", receiptSha256 };
}

function validateObjectRescan(before, objectRescan) {
  invariant(Array.isArray(objectRescan), "缺少执行前冻结对象清单的最终重扫结果");
  const expectedByScope = new Map(
    before.objectDeletionManifest.map((scope) => [scope.scopeSha256, scope])
  );
  invariant(objectRescan.length === expectedByScope.size, "冻结对象最终重扫范围不完整");
  const seen = new Set();
  for (const result of objectRescan) {
    const expected = expectedByScope.get(result?.scopeSha256);
    invariant(expected, "对象最终重扫包含执行前清单外的范围");
    invariant(!seen.has(result.scopeSha256), "对象最终重扫包含重复范围");
    seen.add(result.scopeSha256);
    invariant(
      result.bucket === expected.bucket &&
        result.objectKey === expected.objectKey &&
        result.frozenSnapshotSha256 === expected.objectSnapshot.snapshotSha256,
      "对象最终重扫与执行前冻结 key/version/hash 清单不匹配"
    );
    invariant(
      result.status === "absent" && result.observedGenerationCount === 0,
      "对象最终重扫发现精确对象键或版本仍存在"
    );
  }
  return { status: "passed", objectScopeCount: expectedByScope.size };
}

async function inspectDeletedObjectScopes(report, storage) {
  verifyPreflightReport(report);
  invariant(
    typeof storage?.inspectExactObjectAbsence === "function",
    "对象存储适配器缺少独立最终重扫能力"
  );
  const results = [];
  for (const scope of report.objectDeletionManifest) {
    const observed = await storage.inspectExactObjectAbsence({
      bucket: scope.bucket,
      objectKey: scope.objectKey,
      expectedSnapshot: scope.objectSnapshot
    });
    results.push({
      bucket: scope.bucket,
      objectKey: scope.objectKey,
      scopeSha256: scope.scopeSha256,
      frozenSnapshotSha256: scope.objectSnapshot.snapshotSha256,
      status: observed?.status,
      observedGenerationCount: observed?.observedGenerationCount
    });
  }
  validateObjectRescan(report, results);
  return results;
}

function validateObjectDeletionDisposition(file, disposition) {
  invariant(disposition && typeof disposition === "object", "精确对象删除未返回明确成功结果");
  invariant(disposition.objectKey === file.objectKey, "精确对象删除结果 key 不匹配");
  const receiptFields = Object.hasOwn(disposition, "businessType") || Object.hasOwn(disposition, "bucket");
  if (file.objectSnapshot?.kind === "local_file") {
    invariant(
      JSON.stringify(Object.keys(disposition).sort()) ===
        JSON.stringify(
          receiptFields
            ? ["bucket", "businessType", "kind", "objectKey", "quarantineObjectKey", "status"]
            : ["kind", "objectKey", "quarantineObjectKey", "status"]
        ) &&
      disposition.kind === "local_quarantine" &&
        disposition.status === "object_key_removed_recovery_artifact_retained" &&
        typeof disposition.quarantineObjectKey === "string" &&
        disposition.quarantineObjectKey.trim(),
      "本地精确对象删除未返回可恢复隔离成功结果"
    );
  } else if (file.objectSnapshot?.kind === "cos_versions") {
    invariant(
      JSON.stringify(Object.keys(disposition).sort()) ===
        JSON.stringify(
          receiptFields
            ? ["bucket", "businessType", "deletedVersionIds", "kind", "objectKey", "status"]
            : ["deletedVersionIds", "kind", "objectKey", "status"]
        ) &&
      disposition.kind === "cos_versions" &&
        disposition.status === "deleted_exact_versions" &&
        Array.isArray(disposition.deletedVersionIds),
      "COS 精确对象删除未返回逐版本成功结果"
    );
    const expectedVersionIds = file.objectSnapshot.versions
      .map((version) => version.versionId)
      .sort();
    invariant(
      JSON.stringify([...disposition.deletedVersionIds].sort()) ===
        JSON.stringify(expectedVersionIds),
      "COS 精确对象删除结果与冻结版本清单不一致"
    );
  } else {
    throw new Error("执行前冻结对象快照类型无效");
  }
  return disposition;
}

function verifyPostcheck(
  before,
  after,
  executionReceipt,
  authorizationPublicKey,
  options = {}
) {
  verifyPreflightReport(before);
  verifyPreflightReport(after);
  invariant(before.status === "ready" && before.blockers.length === 0, "执行前预检报告未就绪");
  if (executionReceipt !== undefined) {
    validateExecutionReceipt(
      executionReceipt,
      before,
      authorizationPublicKey,
      options.writeFreezePublicKey
    );
  }
  const finalObjectCheck =
    options.phase === "final" || executionReceipt !== undefined
      ? validateObjectRescan(before, options.objectRescan)
      : null;
  const errors = [];
  for (const [field, label] of [
    ["environment", "环境"],
    ["databaseFingerprint", "数据库 fingerprint"],
    ["migrationHead", "迁移 head"],
    ["migrationCount", "迁移数量"],
    ["schemaDigest", "Schema digest"],
    ["codeSha", "代码 SHA"],
    ["executionCodeSha256", "实际执行代码指纹"],
    ["deploymentIdentitySha256", "部署环境身份"],
    ["executorIdentity", "执行主体"],
    ["policyId", "策略"],
    ["decisionManifestSha256", "逐主键决定清单"],
    ["testProvenanceEnvelopeSha256", "独立测试来源工件"],
    ["testProvenanceRegistrySha256", "外部测试来源注册表"],
    ["trustedTestProvenancePublicKeySha256", "固定测试来源信任锚"],
    ["trustedWriteFreezePublicKeySha256", "固定写冻结租约信任锚"],
    ["backupReceiptSha256", "备份恢复收据"]
  ]) {
    if (before[field] !== undefined && before[field] !== after[field]) {
      errors.push(`${label}发生漂移`);
    }
  }
  if ((after.deletionCandidates ?? []).length > 0) errors.push("测试业务候选未清零");
  if ((after.blockers ?? []).length > 0) errors.push("仍有阻断项");
  if ((after.orphanFiles ?? []).length > 0) errors.push("仍有孤儿文件");
  if ((after.danglingForeignKeys ?? []).length > 0) errors.push("仍有悬空外键");
  for (const [table, count] of Object.entries(before.preservationCounts ?? {})) {
    if (table === "AuditLog") {
      if ((after.preservationCounts?.[table] ?? 0) < count) {
        errors.push(`${table} 保留数量减少`);
      }
    } else if ((after.preservationCounts?.[table] ?? 0) !== count) {
      errors.push(`${table} 保留数量漂移`);
    }
  }
  const afterAnchors = new Map(
    (after.preservationAnchors ?? []).map((anchor) => [
      recordKey(anchor.table, anchor.primaryKey),
      anchor
    ])
  );
  for (const anchor of before.preservationAnchors ?? []) {
    const current = afterAnchors.get(recordKey(anchor.table, anchor.primaryKey));
    if (!current || current.rowSha256 !== anchor.rowSha256) {
      errors.push(`${anchor.table} 保留记录缺失或内容漂移`);
    }
  }
  for (const reset of before.numberResets ?? []) {
    const current = (after.numberResets ?? []).find(
      (item) =>
        item.table === reset.table &&
        JSON.stringify(canonicalize(item.primaryKey)) ===
          JSON.stringify(canonicalize(reset.primaryKey))
    );
    if (!current || current.expectedValue !== reset.targetValue) {
      errors.push(`${reset.table} 编号状态未复位`);
    }
  }
  invariant(errors.length === 0, `后置核验失败：${errors.join("；")}`);
  return {
    status: "passed",
    ...(finalObjectCheck
      ? { objectScopeCount: finalObjectCheck.objectScopeCount }
      : {})
  };
}

async function executeBusinessZeroing({
  args,
  report,
  database,
  storage,
  buildLockedReport,
  buildLockedPostcheckReport,
  buildPostcheckReport,
  persistReceipt,
  verifyWriteFreezeLease,
  clock,
  now
}) {
  invariant(typeof persistReceipt === "function", "受控执行必须配置独立执行收据持久化端");
  invariant(
    typeof verifyWriteFreezeLease === "function",
    "受控执行必须配置外部写冻结租约实时验证端"
  );
  const currentTime =
    typeof clock === "function"
      ? () => new Date(clock())
      : now !== undefined
        ? () => new Date(now)
        : () => new Date();
  const startedAt = currentTime();
  const authorization = validateApplyArguments(args, report, startedAt);
  const verifyActiveWriteFreeze = async () => {
    const verified = await verifyWriteFreezeLease({
      args,
      report,
      now: currentTime()
    });
    invariant(
      verified &&
        verified.envelopeSha256 === sha256(args.writeFreezeLeaseEnvelope) &&
        verified.publicKeySha256 === report.trustedWriteFreezePublicKeySha256,
      "外部写冻结租约实时验证结果与固定工件不匹配"
    );
    return verified;
  };
  let writeFreezeLease = await verifyActiveWriteFreeze();
  const candidates = orderedCandidates(report);
  const fileCandidates = candidates.filter((item) => item.table === "FileObject");
  const auditBase = {
    action: "test_business_zeroing",
    batchId: args.batchId,
    authorizationRef: authorization.authorizationRef,
    authorizationIssuer: authorization.issuer,
    authorizationPublicKeySha256: authorization.publicKeySha256,
    authorizationPayloadSha256: authorization.payloadSha256,
    environment: report.environment,
    databaseFingerprint: report.databaseFingerprint,
    codeSha: report.codeSha,
    executionCodeSha256: report.executionCodeSha256,
    deploymentIdentitySha256: report.deploymentIdentitySha256,
    executorIdentity: report.executorIdentity,
    reportSha256: report.reportSha256,
    candidateSha256: report.candidateSha256,
    testProvenanceEnvelopeSha256: report.testProvenanceEnvelopeSha256,
    testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
    trustedTestProvenancePublicKeySha256:
      report.trustedTestProvenancePublicKeySha256,
    objectDeletionManifestSha256: report.objectDeletionManifestSha256,
    candidateCount: candidates.length,
    numberResetCount: report.numberResets.length,
    startedAt: startedAt.toISOString()
  };

  await database.transaction(async (tx) => {
    writeFreezeLease = await verifyActiveWriteFreeze();
    const lockedReport = await buildLockedReport(tx);
    assertFreshReport(report, lockedReport, "锁内");
    await tx.appendAudit({ ...auditBase, status: "started" });
    for (const item of candidates) {
      const deletedCount = await tx.deleteExactRecord(item);
      invariant(deletedCount === 1, `${item.table} 逐主键删除数量不是 1，事务必须回滚`);
    }
    for (const reset of report.numberResets) {
      const updatedCount = await tx.resetExactSequence(reset);
      invariant(updatedCount === 1, "合同编号规则 CAS 复位数量不是 1，事务必须回滚");
    }
    const lockedPostcheck = await buildLockedPostcheckReport(tx);
    verifyPostcheck(report, lockedPostcheck);
    writeFreezeLease = await verifyActiveWriteFreeze();
    validateApplyArguments(args, report, currentTime());
  });

  let receipt;
  let completionLeaseFinalized = false;
  const objectDispositions = [];
  const recoveryObjectDispositions = [];
  const remainingObjectScopes = () => {
    const completed = new Set(
      objectDispositions.map((item) => `${item.bucket}:${item.objectKey}`)
    );
    return report.objectDeletionManifest.filter(
      (scope) => !completed.has(`${scope.bucket}:${scope.objectKey}`)
    );
  };
  const recoveryReceipt = (status, observedAt, safeFailure) => {
    const body = {
      schemaVersion: 1,
      status,
      executed: true,
      completed: false,
      batchId: args.batchId,
      environment: report.environment,
      codeSha: report.codeSha,
      executionCodeSha256: report.executionCodeSha256,
      deploymentIdentitySha256: report.deploymentIdentitySha256,
      executorIdentity: report.executorIdentity,
      reportSha256: report.reportSha256,
      candidateSha256: report.candidateSha256,
      testProvenanceEnvelopeSha256: report.testProvenanceEnvelopeSha256,
      testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
      trustedTestProvenancePublicKeySha256:
        report.trustedTestProvenancePublicKeySha256,
      objectDeletionManifestSha256: report.objectDeletionManifestSha256,
      writeFreezeLeaseEnvelopeSha256: sha256(args.writeFreezeLeaseEnvelope),
      writeFreezeLeaseEnvelope: args.writeFreezeLeaseEnvelope,
      trustedWriteFreezePublicKeySha256:
        report.trustedWriteFreezePublicKeySha256,
      writeFreezeLease,
      authorization,
      authorizationEnvelope: args.authorizationEnvelope,
      startedAt: startedAt.toISOString(),
      observedAt: observedAt.toISOString(),
      completedObjectDispositions: [...objectDispositions],
      recoveryObjectDispositions: [...recoveryObjectDispositions],
      remainingObjectScopes: remainingObjectScopes(),
      ...(safeFailure ? { safeFailure } : {})
    };
    return { ...body, receiptSha256: sha256(body) };
  };
  try {
    for (const file of fileCandidates) {
      writeFreezeLease = await verifyActiveWriteFreeze();
      validateApplyArguments(args, report, currentTime());
      const disposition = await storage.deleteExactObject({
        bucket: file.bucket,
        objectKey: file.objectKey,
        expectedSnapshot: file.objectSnapshot,
        persistRecoveryDisposition: async (plannedDisposition) => {
          invariant(
            plannedDisposition?.kind === "local_quarantine" &&
              plannedDisposition.status === "quarantine_planned" &&
              plannedDisposition.objectKey === file.objectKey &&
              typeof plannedDisposition.quarantineObjectKey === "string" &&
              plannedDisposition.quarantineObjectKey.trim(),
            "本地对象 typed recovery disposition 无效"
          );
          const recovery = {
            businessType: file.businessType,
            bucket: file.bucket,
            ...plannedDisposition
          };
          recoveryObjectDispositions.push(recovery);
          const plannedReceipt = recoveryReceipt(
            "object_recovery_planned",
            currentTime()
          );
          await persistReceipt(plannedReceipt);
          await database.appendAudit({
            ...auditBase,
            status: "object_recovery_planned",
            receiptSha256: plannedReceipt.receiptSha256,
            executionReceipt: plannedReceipt
          });
        }
      });
      validateObjectDeletionDisposition(file, disposition);
      objectDispositions.push({
        businessType: file.businessType,
        bucket: file.bucket,
        objectKey: file.objectKey,
        ...disposition
      });
      writeFreezeLease = await verifyActiveWriteFreeze();
      const progressReceipt = recoveryReceipt(
        "object_deletion_progress",
        currentTime()
      );
      await database.appendAudit({
        ...auditBase,
        status: "object_deletion_progress",
        receiptSha256: progressReceipt.receiptSha256,
        executionReceipt: progressReceipt
      });
    }
    writeFreezeLease = await verifyActiveWriteFreeze();
    const objectPostcheck = await inspectDeletedObjectScopes(report, storage);
    const postcheck = await buildPostcheckReport();
    const postcheckResult = verifyPostcheck(
      report,
      postcheck,
      undefined,
      undefined,
      { phase: "final", objectRescan: objectPostcheck }
    );
    writeFreezeLease = await verifyActiveWriteFreeze();
    validateApplyArguments(args, report, currentTime());
    const pendingReceipt = recoveryReceipt(
      "completion_pending",
      currentTime()
    );
    const pendingPersistenceResults = await Promise.allSettled([
      persistReceipt(pendingReceipt),
      database.appendAudit({
        ...auditBase,
        status: "completion_pending",
        receiptSha256: pendingReceipt.receiptSha256,
        executionReceipt: pendingReceipt
      })
    ]);
    const failedPendingPersistence = pendingPersistenceResults.find(
      (result) => result.status === "rejected"
    );
    if (failedPendingPersistence) throw failedPendingPersistence.reason;
    writeFreezeLease = await verifyActiveWriteFreeze();
    const completedAt = currentTime();
    validateApplyArguments(args, report, completedAt);
    const receiptBody = {
      schemaVersion: 1,
      status: "completed",
      executed: true,
      batchId: args.batchId,
      environment: report.environment,
      codeSha: report.codeSha,
      executionCodeSha256: report.executionCodeSha256,
      deploymentIdentitySha256: report.deploymentIdentitySha256,
      executorIdentity: report.executorIdentity,
      reportSha256: report.reportSha256,
      candidateSha256: report.candidateSha256,
      testProvenanceEnvelopeSha256: report.testProvenanceEnvelopeSha256,
      testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
      trustedTestProvenancePublicKeySha256:
        report.trustedTestProvenancePublicKeySha256,
      objectDeletionManifestSha256: report.objectDeletionManifestSha256,
      writeFreezeLeaseEnvelopeSha256: sha256(args.writeFreezeLeaseEnvelope),
      writeFreezeLeaseEnvelope: args.writeFreezeLeaseEnvelope,
      trustedWriteFreezePublicKeySha256:
        report.trustedWriteFreezePublicKeySha256,
      writeFreezeLease,
      deletedRecordCount: candidates.length,
      deletedObjectCount: fileCandidates.length,
      objectDispositions,
      objectPostcheck,
      resetNumberRuleCount: report.numberResets.length,
      authorization,
      authorizationEnvelope: args.authorizationEnvelope,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      postcheck: postcheckResult
    };
    receipt = { ...receiptBody, receiptSha256: sha256(receiptBody) };
    writeFreezeLease = await verifyActiveWriteFreeze();
    invariant(
      sha256(writeFreezeLease) === sha256(receipt.writeFreezeLease),
      "持久化前外部写冻结租约验证结果已漂移"
    );
    await persistReceipt(receipt);
    writeFreezeLease = await verifyActiveWriteFreeze();
    invariant(
      sha256(writeFreezeLease) === sha256(receipt.writeFreezeLease),
      "收据持久化后外部写冻结租约验证结果已漂移"
    );
    const terminalCommitSha256 = sha256({
      batchId: receipt.batchId,
      reportSha256: receipt.reportSha256,
      candidateSha256: receipt.candidateSha256,
      receiptSha256: receipt.receiptSha256,
      writeFreezeLeaseEnvelopeSha256:
        receipt.writeFreezeLeaseEnvelopeSha256,
      fenceToken: receipt.writeFreezeLease.fenceToken,
      generation: receipt.writeFreezeLease.generation
    });
    invariant(
      typeof database.commitTerminalAudit === "function",
      "受控执行必须配置事务化权威终态提交端"
    );
    await database.commitTerminalAudit({
      event: {
        ...auditBase,
        status: "completed",
        postcheck: postcheckResult,
        terminalCommitSha256,
        receiptSha256: receipt.receiptSha256,
        executionReceipt: receipt
      },
      verifyLease: async () => {
        writeFreezeLease = await verifyActiveWriteFreeze();
        invariant(
          sha256(writeFreezeLease) === sha256(receipt.writeFreezeLease),
          "权威终态提交时外部写冻结租约验证结果已漂移"
        );
      }
    });
    completionLeaseFinalized = true;
    return receipt;
  } catch (error) {
    const safeFailure = error instanceof Error ? error.message : "未知错误";
    const downgradeCompletedReceipt = receipt && !completionLeaseFinalized;
    const failureReceipt =
      !receipt || downgradeCompletedReceipt
        ? recoveryReceipt(
            "failed_after_database_commit",
            currentTime(),
            safeFailure
          )
        : receipt;
    await Promise.allSettled([
      !receipt || downgradeCompletedReceipt
        ? persistReceipt(failureReceipt)
        : Promise.resolve(),
      database.appendAudit?.({
        ...auditBase,
        status: "failed_after_database_commit",
        safeFailure,
        receiptSha256: failureReceipt.receiptSha256,
        executionReceipt: failureReceipt
      }) ?? Promise.resolve()
    ]);
    throw error;
  }
}

module.exports = {
  POLICY_ID,
  WRITE_FREEZE_LEASE_PAYLOAD_FIELDS,
  buildPreflightReport,
  canonicalize,
  createDryRunReceipt,
  executeBusinessZeroing,
  expectedConfirmation,
  parsePrismaNullableLifecycleFields,
  parsePrismaNullableLifecycleRegistry,
  selectFormalObservationFields,
  sha256,
  inspectDeletedObjectScopes,
  validateAuthorizationEnvelope,
  validateApplyArguments,
  validateBackupReceipt,
  validateDecisionManifest,
  validateObjectRescan,
  validateObjectDeletionDisposition,
  validateTestProvenanceEnvelope,
  validateWriteFreezeLeaseEnvelope,
  validateExecutionReceipt,
  validatePolicy,
  verifyObjectSnapshot,
  orderedCandidates,
  verifyPostcheck,
  verifyPreflightReport
};
