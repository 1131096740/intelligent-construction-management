import { createHash } from "node:crypto";

export const POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS = {
  sourceVersion: "POL219:HISTORICAL_WAGE_SUMMARY_SOURCE_VERSION:V1",
  balanceReconciliation: "POL219:HISTORICAL_WAGE_BALANCE_RECONCILIATION:V1",
  authority: "POL219:HISTORICAL_WAGE_SUMMARY_AUTHORITY:V1",
  assignedWageExclusionSet: "POL219:ASSIGNED_WAGE_EXCLUSION_SET:V1",
  verifiedPaymentExecutionSet: "POL219:VERIFIED_PAYMENT_EXECUTION_SET:V1"
} as const;

export type Pol219HistoricalWageFingerprintDomain =
  typeof POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS[keyof typeof POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS];

export type Pol219EvidenceCoordinate = {
  sourceObjectSha256: string;
  worksheetName: string | null;
  rowNumber: string | null;
  columnNumber: string | null;
  normalizedRowSha256: string;
};

export type Pol219EvidenceReference = {
  fileObjectId: string;
  contentSha256: string;
  evidenceCoordinate: Pol219EvidenceCoordinate;
};

type Pol219CreditorStableIdentity = {
  categoryCode: string;
  creditorIdentityKind: string;
  creditorPartyVersionId: string | null;
  controlledScopeCode: string | null;
  controlledScopeDescription: string | null;
  targetKind: string;
  targetBusinessKey: string;
};

type FingerprintedPayload<T> = { payload: T; fingerprint: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const NON_NEGATIVE_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_INTEGER = /^(?:0|-?[1-9][0-9]*)$/u;
const CANONICAL_INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

/**
 * RFC 8785/JCS serializer for server-built closed JSON payloads. Values with
 * JavaScript-only semantics are rejected instead of being silently coerced.
 */
export function strictJcs(value: unknown): string {
  return serializeJcs(value, new Set<object>());
}

export function pol219DomainFingerprint(
  domain: Pol219HistoricalWageFingerprintDomain,
  payload: unknown
): string {
  if (!Object.values(POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS).includes(domain)) {
    throw new TypeError("POL219 指纹 domain 不受支持");
  }
  if (!isPlainRecord(payload) || payload.schemaVersion !== 1) {
    throw new TypeError("POL219 指纹 payload 必须包含 JSON integer schemaVersion=1");
  }
  return createHash("sha256")
    .update(`${domain}\n${strictJcs(payload)}`, "utf8")
    .digest("hex");
}

export function normalizePol219Text(value: string): string {
  if (typeof value !== "string") throw new TypeError("POL219 文本必须是字符串");
  assertUnicodeScalarString(value);
  return value.replace(/\r\n?/gu, "\n").normalize("NFC");
}

export function normalizePol219Uuid(value: string): string {
  const normalized = normalizePol219Text(value).toLowerCase();
  if (!UUID.test(normalized)) throw new TypeError("POL219 UUID 必须是 canonical UUID");
  return normalized;
}

export function normalizePol219Hash(value: string): string {
  const normalized = normalizePol219Text(value).toLowerCase();
  if (!SHA256.test(normalized)) throw new TypeError("POL219 hash 必须是 64 位十六进制 SHA-256");
  return normalized;
}

export function normalizePol219NonNegativeInteger(value: bigint | string): string {
  const normalized = typeof value === "bigint" ? value.toString() : value;
  if (typeof normalized !== "string" || !NON_NEGATIVE_INTEGER.test(normalized)) {
    throw new TypeError("POL219 非负整数必须使用无前导零十进制字符串");
  }
  return normalized;
}

export function normalizePol219SignedInteger(value: bigint | string): string {
  const normalized = typeof value === "bigint" ? value.toString() : value;
  if (typeof normalized !== "string" || !SIGNED_INTEGER.test(normalized)) {
    throw new TypeError("POL219 有符号整数必须使用 canonical 十进制字符串");
  }
  return normalized;
}

export function normalizePol219Instant(value: string): string {
  const normalized = normalizePol219Text(value);
  if (!CANONICAL_INSTANT.test(normalized)) {
    throw new TypeError("POL219 时间必须精确使用 YYYY-MM-DDTHH:mm:ss.SSSZ");
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new TypeError("POL219 时间不是有效的 canonical UTC instant");
  }
  return normalized;
}

export function normalizePol219EvidenceCoordinate(value: unknown): Pol219EvidenceCoordinate {
  const item = exactRecord(value, [
    "sourceObjectSha256",
    "worksheetName",
    "rowNumber",
    "columnNumber",
    "normalizedRowSha256"
  ], "POL219 evidenceCoordinate");
  return {
    sourceObjectSha256: normalizePol219Hash(item.sourceObjectSha256 as string),
    worksheetName: nullableText(item.worksheetName, "worksheetName"),
    rowNumber: nullableNonNegativeInteger(item.rowNumber, "rowNumber"),
    columnNumber: nullableNonNegativeInteger(item.columnNumber, "columnNumber"),
    normalizedRowSha256: normalizePol219Hash(item.normalizedRowSha256 as string)
  };
}

export function normalizePol219ControlledId(value: unknown, label = "id"): string {
  return requiredControlledText(value, label);
}

export function normalizePol219BusinessText(value: unknown, label = "text"): string {
  return requiredBusinessText(value, label);
}

export function normalizePol219NullableControlledId(value: unknown, label = "id"): string | null {
  return nullableControlledText(value, label);
}

export function normalizePol219NullableBusinessText(value: unknown, label = "text"): string | null {
  return nullableText(value, label);
}

export function normalizePol219DateOnly(value: unknown, label = "date"): string {
  return requiredDateOnly(value, label);
}

export function normalizePol219WageMonth(value: unknown): string {
  return requiredWageMonth(value);
}

export function normalizePol219EvidenceReference(value: unknown): Pol219EvidenceReference {
  return normalizeEvidenceReference(value);
}

export function canonicalPol219CreditorStableKey(value: Pol219CreditorStableIdentity): string {
  const item = exactRecord(value, [
    "categoryCode",
    "creditorIdentityKind",
    "creditorPartyVersionId",
    "controlledScopeCode",
    "controlledScopeDescription",
    "targetKind",
    "targetBusinessKey"
  ], "POL219 creditor stable identity");
  return strictJcs([
    requiredControlledText(item.categoryCode, "categoryCode"),
    requiredControlledText(item.creditorIdentityKind, "creditorIdentityKind"),
    nullableControlledText(item.creditorPartyVersionId, "creditorPartyVersionId"),
    nullableControlledText(item.controlledScopeCode, "controlledScopeCode"),
    nullableText(item.controlledScopeDescription, "controlledScopeDescription"),
    requiredControlledText(item.targetKind, "targetKind"),
    requiredControlledText(item.targetBusinessKey, "targetBusinessKey")
  ]);
}

export function computePol219HistoricalWageSourceVersionFingerprint(value: unknown) {
  const item = exactRecord(value, [
    "schemaVersion",
    "sourceDiscriminator",
    "sourceObjectId",
    "sourceObjectCoordinate",
    "originalSourceVersion",
    "originalBusinessNumber",
    "asOfDate",
    "basisDate",
    "sourceHeader",
    "creditorSourceFacts",
    "originalControlledScopeDescription",
    "evidence",
    "sourceEvidenceReviewerSnapshot"
  ], "POL219 historical wage source version");
  assertSchemaVersion(item.schemaVersion);
  if (item.sourceDiscriminator !== "historical_wage_summary") {
    throw new TypeError("POL219 B source discriminator 必须是 historical_wage_summary");
  }
  const sourceHeader = normalizeSourceHeader(item.sourceHeader);
  const rawCreditorFacts = requiredArray(item.creditorSourceFacts, "creditorSourceFacts");
  const creditorSourceFacts = canonicalizePol219Set(
    rawCreditorFacts.map(normalizeSourceCreditorFact),
    (fact) => strictJcs([
      fact.categoryCode,
      fact.creditorIdentityKind,
      fact.creditorPartyVersionId,
      fact.controlledScopeCode,
      fact.controlledScopeDescription
    ])
  );
  if (!creditorSourceFacts.length) {
    throw new TypeError("POL219 creditorSourceFacts 不能为空");
  }
  const sourceEvidence = canonicalEvidenceSet(item.evidence, true);
  const payload = {
    schemaVersion: 1,
    sourceDiscriminator: "historical_wage_summary" as const,
    sourceObjectId: requiredControlledText(item.sourceObjectId, "sourceObjectId"),
    sourceObjectCoordinate: normalizePol219EvidenceCoordinate(item.sourceObjectCoordinate),
    originalSourceVersion: requiredBusinessText(item.originalSourceVersion, "originalSourceVersion"),
    originalBusinessNumber: requiredBusinessText(item.originalBusinessNumber, "originalBusinessNumber"),
    asOfDate: nullableDateOnly(item.asOfDate, "asOfDate"),
    basisDate: nullableDateOnly(item.basisDate, "basisDate"),
    sourceHeader,
    creditorSourceFacts,
    originalControlledScopeDescription: nullableText(item.originalControlledScopeDescription, "originalControlledScopeDescription"),
    evidence: sourceEvidence,
    sourceEvidenceReviewerSnapshot: normalizeSourceEvidenceReviewer(item.sourceEvidenceReviewerSnapshot, sourceEvidence)
  };
  return fingerprinted(POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.sourceVersion, payload);
}

export function computePol219HistoricalWageBalanceReconciliationFingerprint(value: unknown) {
  const item = exactRecord(value, [
    "schemaVersion",
    "reservedTargetId",
    "reconciliationAuthorityVersionId",
    "reconciliationReference",
    "sourceVersionFingerprint",
    "employmentCompanyId",
    "employmentCompanyNameSnapshot",
    "employmentCompanyCreditCodeSnapshot",
    "projectId",
    "projectCodeSnapshot",
    "projectNameSnapshot",
    "wageMonth",
    "catalogVersion",
    "positionCategoryCode",
    "positionCategoryLabelSnapshot",
    "categoryCode",
    "categoryLabelSnapshot",
    "creditorIdentityKind",
    "creditorPartyVersionId",
    "controlledScopeCode",
    "controlledScopeDescription",
    "targetKind",
    "targetBusinessKey",
    "currencyCode",
    "debtStatus",
    "grossDebtCents",
    "historicallySettledCents",
    "outstandingBalanceCents",
    "asOfDate",
    "evidence",
    "supportingPaymentExecutions"
  ], "POL219 historical wage balance reconciliation");
  assertSchemaVersion(item.schemaVersion);
  if (item.targetKind !== "historical_wage_balance_reconciliation_version" || item.currencyCode !== "CNY") {
    throw new TypeError("POL219 balance target kind/currency 无效");
  }
  const grossDebtCents = normalizePol219NonNegativeInteger(item.grossDebtCents as string);
  const historicallySettledCents = normalizePol219NonNegativeInteger(item.historicallySettledCents as string);
  const outstandingBalanceCents = normalizePol219NonNegativeInteger(item.outstandingBalanceCents as string);
  assertDebtEquation(item.debtStatus, grossDebtCents, historicallySettledCents, outstandingBalanceCents);
  const supportingPaymentExecutions = canonicalizePol219Set(
    requiredArray(item.supportingPaymentExecutions, "supportingPaymentExecutions").map(normalizeSupportingPayment),
    (payment) => payment.paymentExecutionId.toLowerCase()
  );
  const payload = {
    schemaVersion: 1,
    reservedTargetId: normalizePol219Uuid(item.reservedTargetId as string),
    reconciliationAuthorityVersionId: requiredControlledText(item.reconciliationAuthorityVersionId, "reconciliationAuthorityVersionId"),
    reconciliationReference: requiredBusinessText(item.reconciliationReference, "reconciliationReference"),
    sourceVersionFingerprint: normalizePol219Hash(item.sourceVersionFingerprint as string),
    employmentCompanyId: requiredControlledText(item.employmentCompanyId, "employmentCompanyId"),
    employmentCompanyNameSnapshot: requiredBusinessText(item.employmentCompanyNameSnapshot, "employmentCompanyNameSnapshot"),
    employmentCompanyCreditCodeSnapshot: requiredControlledText(item.employmentCompanyCreditCodeSnapshot, "employmentCompanyCreditCodeSnapshot"),
    projectId: requiredControlledText(item.projectId, "projectId"),
    projectCodeSnapshot: requiredBusinessText(item.projectCodeSnapshot, "projectCodeSnapshot"),
    projectNameSnapshot: requiredBusinessText(item.projectNameSnapshot, "projectNameSnapshot"),
    wageMonth: requiredWageMonth(item.wageMonth),
    catalogVersion: requiredControlledText(item.catalogVersion, "catalogVersion"),
    positionCategoryCode: requiredControlledText(item.positionCategoryCode, "positionCategoryCode"),
    positionCategoryLabelSnapshot: requiredBusinessText(item.positionCategoryLabelSnapshot, "positionCategoryLabelSnapshot"),
    categoryCode: requiredControlledText(item.categoryCode, "categoryCode"),
    categoryLabelSnapshot: requiredBusinessText(item.categoryLabelSnapshot, "categoryLabelSnapshot"),
    creditorIdentityKind: requiredControlledText(item.creditorIdentityKind, "creditorIdentityKind"),
    creditorPartyVersionId: nullableControlledText(item.creditorPartyVersionId, "creditorPartyVersionId"),
    controlledScopeCode: nullableControlledText(item.controlledScopeCode, "controlledScopeCode"),
    controlledScopeDescription: nullableText(item.controlledScopeDescription, "controlledScopeDescription"),
    targetKind: "historical_wage_balance_reconciliation_version" as const,
    targetBusinessKey: requiredControlledText(item.targetBusinessKey, "targetBusinessKey"),
    currencyCode: "CNY" as const,
    debtStatus: requiredDebtStatus(item.debtStatus),
    grossDebtCents,
    historicallySettledCents,
    outstandingBalanceCents,
    asOfDate: requiredDateOnly(item.asOfDate, "asOfDate"),
    evidence: canonicalEvidenceSet(item.evidence, true),
    supportingPaymentExecutions
  };
  return fingerprinted(POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.balanceReconciliation, payload);
}

export function computePol219AssignedWageExclusionSet(values: unknown) {
  const assignedWageExclusions = canonicalizePol219Set(
    requiredArray(values, "assignedWageExclusions").map(normalizeAssignedWageExclusion),
    (proof) => `${proof.authorityVersionId}\u0000${proof.lineId}`
  );
  return fingerprinted(POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.assignedWageExclusionSet, {
    schemaVersion: 1,
    assignedWageExclusions
  });
}

export function computePol219VerifiedPaymentExecutionSet(values: unknown) {
  const unique = canonicalizePol219Set(
    requiredArray(values, "paymentExecutions").map(normalizePaymentExecutionEvidence),
    (payment) => payment.paymentExecutionId.toLowerCase()
  );
  if (!unique.length) {
    throw new TypeError("POL219 paymentExecutions 不能为空");
  }
  unique.sort((left, right) => {
    const byTime = left.paidAt.localeCompare(right.paidAt);
    if (byTime) return byTime;
    return Buffer.compare(
      Buffer.from(left.paymentExecutionId.toLowerCase(), "utf8"),
      Buffer.from(right.paymentExecutionId.toLowerCase(), "utf8")
    );
  });
  const payload = {
    schemaVersion: 1,
    paymentExecutionIds: unique.map((payment) => payment.paymentExecutionId),
    paymentExecutions: unique
  };
  return fingerprinted(POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.verifiedPaymentExecutionSet, payload);
}

export function computePol219HistoricalWageAuthorityFingerprint(value: unknown) {
  const item = exactRecord(value, [
    "schemaVersion",
    "authorityVersionId",
    "atomicScopeVersionId",
    "sourceVersionFingerprint",
    "summaryBucketKey",
    "authorityHeader",
    "revision",
    "supersedesVersionId",
    "lineageRootAuthorityVersionId",
    "sourceDeltaFingerprint",
    "rootClosureFingerprint",
    "creditorLines",
    "legacySources",
    "assignedWageExclusions",
    "assignedWageExclusionSetFingerprint",
    "verifiedPaymentExecutionSets",
    "conflictReadSet",
    "scopeCreatorIdentity",
    "permissionScopeFingerprint"
  ], "POL219 historical wage summary authority");
  assertSchemaVersion(item.schemaVersion);
  const revision = requiredPositiveInteger(item.revision, "revision");
  const supersedesVersionId = nullableControlledText(item.supersedesVersionId, "supersedesVersionId");
  const lineageRootAuthorityVersionId = nullableControlledText(item.lineageRootAuthorityVersionId, "lineageRootAuthorityVersionId");
  if ((revision === 1 && (supersedesVersionId || lineageRootAuthorityVersionId)) ||
      (revision > 1 && (!supersedesVersionId || !lineageRootAuthorityVersionId))) {
    throw new TypeError("POL219 authority revision lineage 不闭合");
  }
  const exclusion = computePol219AssignedWageExclusionSet(item.assignedWageExclusions);
  const assertedExclusionFingerprint = normalizePol219Hash(item.assignedWageExclusionSetFingerprint as string);
  if (exclusion.fingerprint !== assertedExclusionFingerprint) {
    throw new TypeError("POL219 assigned wage exclusion set fingerprint 不一致");
  }
  const sourceVersionFingerprint = normalizePol219Hash(item.sourceVersionFingerprint as string);
  const authorityHeader = normalizeSourceHeader(item.authorityHeader);
  const summaryBucketKey = [
    authorityHeader.employmentCompanyId,
    authorityHeader.projectId,
    authorityHeader.wageMonth,
    authorityHeader.positionCategoryCode
  ].join(":");
  if (item.summaryBucketKey !== summaryBucketKey) {
    throw new TypeError("POL219 summaryBucketKey 必须由 authority header 唯一派生");
  }
  const creditorLines = canonicalizePol219Set(
    requiredArray(item.creditorLines, "creditorLines").map((line) =>
      normalizeAuthorityCreditorLine(line, sourceVersionFingerprint, authorityHeader)
    ),
    (line) => line.stableBucketKey
  );
  if (!creditorLines.length) throw new TypeError("POL219 authority creditorLines 不能为空");
  const verifiedPaymentExecutionSets = canonicalizePol219Set(
    requiredArray(item.verifiedPaymentExecutionSets, "verifiedPaymentExecutionSets").map(normalizeVerifiedPaymentSetBinding),
    (set) => set.paymentExecutionSetFingerprint
  );
  const paymentLineFingerprints = creditorLines
    .filter((line) => line.targetKind === "existing_verified_payment_execution_set")
    .map((line) => line.targetFingerprint)
    .sort();
  const declaredPaymentSetFingerprints = verifiedPaymentExecutionSets
    .map((set) => set.paymentExecutionSetFingerprint)
    .sort();
  if (
    new Set(paymentLineFingerprints).size !== paymentLineFingerprints.length ||
    strictJcs(paymentLineFingerprints) !== strictJcs(declaredPaymentSetFingerprints)
  ) {
    throw new TypeError("POL219 authority 付款集合与 creditor targets 不闭合");
  }
  const conflictReadSet = normalizeAuthorityConflictReadSet(
    item.conflictReadSet,
    authorityHeader,
    exclusion.payload.assignedWageExclusions
  );
  const legacySources = canonicalizePol219Set(
    requiredArray(item.legacySources, "legacySources").map(normalizeLegacyAuthoritySource),
    (source) => source.factId
  );
  if (!legacySources.length) {
    throw new TypeError("POL219 legacySources 不能为空");
  }
  const payload = {
    schemaVersion: 1,
    authorityVersionId: normalizePol219Uuid(item.authorityVersionId as string),
    atomicScopeVersionId: normalizePol219Uuid(item.atomicScopeVersionId as string),
    sourceVersionFingerprint,
    summaryBucketKey,
    authorityHeader,
    revision,
    supersedesVersionId,
    lineageRootAuthorityVersionId,
    sourceDeltaFingerprint: normalizePol219Hash(item.sourceDeltaFingerprint as string),
    rootClosureFingerprint: normalizePol219Hash(item.rootClosureFingerprint as string),
    creditorLines,
    legacySources,
    assignedWageExclusions: exclusion.payload.assignedWageExclusions,
    assignedWageExclusionSetFingerprint: assertedExclusionFingerprint,
    verifiedPaymentExecutionSets,
    conflictReadSet,
    scopeCreatorIdentity: normalizeScopeCreatorIdentity(item.scopeCreatorIdentity),
    permissionScopeFingerprint: normalizePol219Hash(item.permissionScopeFingerprint as string)
  };
  return fingerprinted(POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.authority, payload);
}

export function canonicalizePol219Set<T>(
  values: readonly T[],
  stableKey: (value: T) => string
): T[] {
  if (!Array.isArray(values)) throw new TypeError("POL219 set 必须是数组");
  const seenElements = new Set<string>();
  const seenStableKeys = new Map<string, string>();
  const entries = values.map((value) => {
    const canonical = strictJcs(value);
    if (seenElements.has(canonical)) throw new TypeError("POL219 set 存在完全重复元素");
    seenElements.add(canonical);
    const key = stableKey(value);
    if (typeof key !== "string" || !key.length) throw new TypeError("POL219 set 稳定键无效");
    const prior = seenStableKeys.get(key);
    if (prior !== undefined) {
      throw new TypeError(prior === canonical
        ? "POL219 set 存在完全重复元素"
        : "POL219 set 存在稳定键相同但内容不同的元素");
    }
    seenStableKeys.set(key, canonical);
    return { canonical, value };
  });
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.canonical, "utf8"), Buffer.from(right.canonical, "utf8")));
  return entries.map((entry) => entry.value);
}

function serializeJcs(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("POL219 JCS 不接受非有限数或负零");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("POL219 JCS 仅接受 JSON 值");
  }
  if (ancestors.has(value)) throw new TypeError("POL219 JCS 不接受循环引用");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("POL219 JCS 不接受数组空洞");
        items.push(serializeJcs(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }
    if (!isPlainRecord(value)) throw new TypeError("POL219 JCS 仅接受 plain JSON object");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("POL219 JCS 不接受 symbol key");
    }
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("POL219 JCS 仅接受 enumerable data property");
      }
    }
    stringKeys.sort();
    return `{${stringKeys.map((key) => `${JSON.stringify(key)}:${serializeJcs(value[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("POL219 文本包含 lone surrogate");
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("POL219 文本包含 lone surrogate");
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fingerprinted<T>(domain: Pol219HistoricalWageFingerprintDomain, payload: T): FingerprintedPayload<T> {
  return { payload, fingerprint: pol219DomainFingerprint(domain, payload) };
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} 必须是 object`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) throw new TypeError(`${label} 存在未知字段`);
  const actualKeys = actual as string[];
  const expected = new Set(keys);
  const unknown = actualKeys.filter((key) => !expected.has(key));
  if (unknown.length) throw new TypeError(`${label} 存在未知字段: ${unknown.sort().join(",")}`);
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw new TypeError(`${label} 缺少字段: ${missing.join(",")}`);
  return value;
}

function assertSchemaVersion(value: unknown): asserts value is 1 {
  if (value !== 1 || !Number.isInteger(value)) throw new TypeError("POL219 schemaVersion 必须是 JSON integer 1");
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} 必须是数组`);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw new TypeError(`${label} 不得包含数组空洞`);
  }
  return value;
}

function requiredControlledText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} 必须是字符串`);
  const normalized = normalizePol219Text(value);
  if (!normalized.length || normalized.trim() !== normalized) {
    throw new TypeError(`${label} 必须是无边界空白的受控值`);
  }
  return UUID.test(normalized.toLowerCase()) ? normalized.toLowerCase() : normalized;
}

function requiredBusinessText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} 必须是字符串`);
  const normalized = normalizePol219Text(value);
  if (!normalized.trim().length) throw new TypeError(`${label} 不能为空`);
  return normalized;
}

function nullableControlledText(value: unknown, label: string): string | null {
  return value === null ? null : requiredControlledText(value, label);
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : requiredBusinessText(value, label);
}

function nullableNonNegativeInteger(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${label} 必须是十进制字符串或 null`);
  return normalizePol219NonNegativeInteger(value);
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} 必须是正安全整数`);
  }
  return value;
}

function requiredDateOnly(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    throw new TypeError(`${label} 必须是 YYYY-MM-DD`);
  }
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} 不是有效日期`);
  }
  return value;
}

function nullableDateOnly(value: unknown, label: string): string | null {
  return value === null ? null : requiredDateOnly(value, label);
}

function requiredWageMonth(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(value)) {
    throw new TypeError("wageMonth 必须是 YYYY-MM");
  }
  return value;
}

function requiredDebtStatus(value: unknown): "settled" | "partially_settled" | "outstanding" {
  if (value !== "settled" && value !== "partially_settled" && value !== "outstanding") {
    throw new TypeError("POL219 debtStatus 无效");
  }
  return value;
}

function assertDebtEquation(status: unknown, gross: string, settled: string, outstanding: string): void {
  const debtStatus = requiredDebtStatus(status);
  const grossValue = BigInt(gross);
  const settledValue = BigInt(settled);
  const outstandingValue = BigInt(outstanding);
  if (grossValue !== settledValue + outstandingValue) throw new TypeError("POL219 工资债务金额不平");
  if (
    (debtStatus === "settled" && (outstandingValue !== 0n || settledValue !== grossValue)) ||
    (debtStatus === "outstanding" && (settledValue !== 0n || outstandingValue !== grossValue)) ||
    (debtStatus === "partially_settled" && (settledValue <= 0n || outstandingValue <= 0n))
  ) throw new TypeError("POL219 debtStatus 与金额不一致");
}

function normalizeSourceHeader(value: unknown) {
  const item = exactRecord(value, [
    "employmentCompanyId",
    "employmentCompanyNameSnapshot",
    "employmentCompanyCreditCodeSnapshot",
    "projectId",
    "projectCodeSnapshot",
    "projectNameSnapshot",
    "wageMonth",
    "catalogVersion",
    "positionCategoryCode",
    "positionCategoryLabelSnapshot"
  ], "POL219 source header");
  return {
    employmentCompanyId: requiredControlledText(item.employmentCompanyId, "employmentCompanyId"),
    employmentCompanyNameSnapshot: requiredBusinessText(item.employmentCompanyNameSnapshot, "employmentCompanyNameSnapshot"),
    employmentCompanyCreditCodeSnapshot: requiredControlledText(item.employmentCompanyCreditCodeSnapshot, "employmentCompanyCreditCodeSnapshot"),
    projectId: requiredControlledText(item.projectId, "projectId"),
    projectCodeSnapshot: requiredBusinessText(item.projectCodeSnapshot, "projectCodeSnapshot"),
    projectNameSnapshot: requiredBusinessText(item.projectNameSnapshot, "projectNameSnapshot"),
    wageMonth: requiredWageMonth(item.wageMonth),
    catalogVersion: requiredControlledText(item.catalogVersion, "catalogVersion"),
    positionCategoryCode: requiredControlledText(item.positionCategoryCode, "positionCategoryCode"),
    positionCategoryLabelSnapshot: requiredBusinessText(item.positionCategoryLabelSnapshot, "positionCategoryLabelSnapshot")
  };
}

function normalizeSourceCreditorFact(value: unknown) {
  const item = exactRecord(value, [
    "categoryCode",
    "categoryLabelSnapshot",
    "creditorIdentityKind",
    "creditorPartyVersionId",
    "controlledScopeCode",
    "controlledScopeDescription",
    "controlledScopeEvidenceCoordinate",
    "grossDebtCents",
    "historicallySettledCents",
    "outstandingBalanceCents",
    "debtStatus"
  ], "POL219 source creditor fact");
  const grossDebtCents = normalizePol219NonNegativeInteger(item.grossDebtCents as string);
  const historicallySettledCents = normalizePol219NonNegativeInteger(item.historicallySettledCents as string);
  const outstandingBalanceCents = normalizePol219NonNegativeInteger(item.outstandingBalanceCents as string);
  assertDebtEquation(item.debtStatus, grossDebtCents, historicallySettledCents, outstandingBalanceCents);
  return {
    categoryCode: requiredControlledText(item.categoryCode, "categoryCode"),
    categoryLabelSnapshot: requiredBusinessText(item.categoryLabelSnapshot, "categoryLabelSnapshot"),
    creditorIdentityKind: requiredControlledText(item.creditorIdentityKind, "creditorIdentityKind"),
    creditorPartyVersionId: nullableControlledText(item.creditorPartyVersionId, "creditorPartyVersionId"),
    controlledScopeCode: nullableControlledText(item.controlledScopeCode, "controlledScopeCode"),
    controlledScopeDescription: nullableText(item.controlledScopeDescription, "controlledScopeDescription"),
    controlledScopeEvidenceCoordinate: item.controlledScopeEvidenceCoordinate === null
      ? null
      : normalizePol219EvidenceCoordinate(item.controlledScopeEvidenceCoordinate),
    grossDebtCents,
    historicallySettledCents,
    outstandingBalanceCents,
    debtStatus: requiredDebtStatus(item.debtStatus)
  };
}

function normalizeEvidenceReference(value: unknown): Pol219EvidenceReference {
  const item = exactRecord(value, ["fileObjectId", "contentSha256", "evidenceCoordinate"], "POL219 evidence reference");
  return {
    fileObjectId: requiredControlledText(item.fileObjectId, "fileObjectId"),
    contentSha256: normalizePol219Hash(item.contentSha256 as string),
    evidenceCoordinate: normalizePol219EvidenceCoordinate(item.evidenceCoordinate)
  };
}

function canonicalEvidenceSet(value: unknown, requireNonEmpty: boolean): Pol219EvidenceReference[] {
  const evidence = canonicalizePol219Set(
    requiredArray(value, "evidence").map(normalizeEvidenceReference),
    (item) => `${item.fileObjectId}\u0000${strictJcs(item.evidenceCoordinate)}`
  );
  if (requireNonEmpty && !evidence.length) throw new TypeError("POL219 evidence 不能为空");
  return evidence;
}

function normalizeSourceEvidenceReviewer(
  value: unknown,
  sourceEvidence: Pol219EvidenceReference[]
) {
  if (value === null) return null;
  const item = exactRecord(value, ["externalIdentityId", "evidence"], "POL219 source evidence reviewer snapshot");
  const evidence = canonicalEvidenceSet(item.evidence, true);
  const sourceEvidenceSet = new Set(sourceEvidence.map((entry) => strictJcs(entry)));
  if (evidence.some((entry) => !sourceEvidenceSet.has(strictJcs(entry)))) {
    throw new TypeError("POL219 source evidence reviewer 引用的证据不属于 source evidence");
  }
  return {
    externalIdentityId: requiredControlledText(item.externalIdentityId, "externalIdentityId"),
    evidence
  };
}

function normalizeSupportingPayment(value: unknown) {
  const item = exactRecord(value, ["paymentExecutionId", "paymentExecutionFingerprint"], "POL219 supporting payment");
  return {
    paymentExecutionId: requiredControlledText(item.paymentExecutionId, "paymentExecutionId"),
    paymentExecutionFingerprint: normalizePol219Hash(item.paymentExecutionFingerprint as string)
  };
}

function normalizeAssignedWageExclusion(value: unknown) {
  const item = exactRecord(value, [
    "authorityVersionId",
    "lineId",
    "lineFingerprint",
    "fileObjectId",
    "contentSha256",
    "evidenceCoordinate"
  ], "POL219 assigned wage exclusion");
  return {
    authorityVersionId: requiredControlledText(item.authorityVersionId, "authorityVersionId"),
    lineId: requiredControlledText(item.lineId, "lineId"),
    lineFingerprint: normalizePol219Hash(item.lineFingerprint as string),
    fileObjectId: requiredControlledText(item.fileObjectId, "fileObjectId"),
    contentSha256: normalizePol219Hash(item.contentSha256 as string),
    evidenceCoordinate: normalizePol219EvidenceCoordinate(item.evidenceCoordinate)
  };
}

const PAYMENT_EVIDENCE_KEYS = [
  "paymentExecutionId", "paymentExecutionFingerprint", "paymentRequestId", "paymentRequestSourceType",
  "paymentRequestProjectId", "paymentRequestFingerprint", "paymentSubjectType", "payerCompanyId",
  "payerCompanyNameSnapshot", "payerCompanyCreditCodeSnapshot", "amountCents", "paidAt", "voucherFileId",
  "voucherContentSha256", "payerAttestationId", "payerVerificationId", "bankAccountReference",
  "legalAccountHolderCompanyId", "legalAccountHolderNameSnapshot", "legalAccountHolderCreditCodeSnapshot",
  "verificationEvidenceFileId", "verificationEvidenceContentSha256", "bankTransactionClaimId", "bankObservationId",
  "transactionSourceType", "transactionSourceId", "transactionSourceIdentity", "transactionAmountCents", "currencyCode",
  "direction", "occurredAt", "transactionEvidenceFileId", "transactionEvidenceContentSha256",
  "observationPayloadFingerprint", "creditorScopeEvidenceCoordinate"
] as const;

function normalizePaymentExecutionEvidence(value: unknown) {
  const item = exactRecord(value, PAYMENT_EVIDENCE_KEYS, "POL219 verified payment execution evidence");
  if (item.currencyCode !== "CNY") throw new TypeError("POL219 payment currency 必须是 CNY");
  const amountCents = normalizePol219NonNegativeInteger(item.amountCents as string);
  const transactionAmountCents = normalizePol219NonNegativeInteger(item.transactionAmountCents as string);
  if (amountCents === "0" || transactionAmountCents === "0") throw new TypeError("POL219 payment amount 必须大于零");
  if (amountCents !== transactionAmountCents) {
    throw new TypeError("POL219 payment 执行金额与银行交易金额不一致");
  }
  return {
    paymentExecutionId: requiredControlledText(item.paymentExecutionId, "paymentExecutionId"),
    paymentExecutionFingerprint: normalizePol219Hash(item.paymentExecutionFingerprint as string),
    paymentRequestId: requiredControlledText(item.paymentRequestId, "paymentRequestId"),
    paymentRequestSourceType: requiredControlledText(item.paymentRequestSourceType, "paymentRequestSourceType"),
    paymentRequestProjectId: requiredControlledText(item.paymentRequestProjectId, "paymentRequestProjectId"),
    paymentRequestFingerprint: normalizePol219Hash(item.paymentRequestFingerprint as string),
    paymentSubjectType: requiredControlledText(item.paymentSubjectType, "paymentSubjectType"),
    payerCompanyId: requiredControlledText(item.payerCompanyId, "payerCompanyId"),
    payerCompanyNameSnapshot: requiredBusinessText(item.payerCompanyNameSnapshot, "payerCompanyNameSnapshot"),
    payerCompanyCreditCodeSnapshot: requiredControlledText(item.payerCompanyCreditCodeSnapshot, "payerCompanyCreditCodeSnapshot"),
    amountCents,
    paidAt: normalizePol219Instant(item.paidAt as string),
    voucherFileId: requiredControlledText(item.voucherFileId, "voucherFileId"),
    voucherContentSha256: normalizePol219Hash(item.voucherContentSha256 as string),
    payerAttestationId: requiredControlledText(item.payerAttestationId, "payerAttestationId"),
    payerVerificationId: requiredControlledText(item.payerVerificationId, "payerVerificationId"),
    bankAccountReference: requiredControlledText(item.bankAccountReference, "bankAccountReference"),
    legalAccountHolderCompanyId: requiredControlledText(item.legalAccountHolderCompanyId, "legalAccountHolderCompanyId"),
    legalAccountHolderNameSnapshot: requiredBusinessText(item.legalAccountHolderNameSnapshot, "legalAccountHolderNameSnapshot"),
    legalAccountHolderCreditCodeSnapshot: requiredControlledText(item.legalAccountHolderCreditCodeSnapshot, "legalAccountHolderCreditCodeSnapshot"),
    verificationEvidenceFileId: requiredControlledText(item.verificationEvidenceFileId, "verificationEvidenceFileId"),
    verificationEvidenceContentSha256: normalizePol219Hash(item.verificationEvidenceContentSha256 as string),
    bankTransactionClaimId: requiredControlledText(item.bankTransactionClaimId, "bankTransactionClaimId"),
    bankObservationId: requiredControlledText(item.bankObservationId, "bankObservationId"),
    transactionSourceType: requiredControlledText(item.transactionSourceType, "transactionSourceType"),
    transactionSourceId: requiredControlledText(item.transactionSourceId, "transactionSourceId"),
    transactionSourceIdentity: requiredControlledText(item.transactionSourceIdentity, "transactionSourceIdentity"),
    transactionAmountCents,
    currencyCode: "CNY" as const,
    direction: requiredControlledText(item.direction, "direction"),
    occurredAt: normalizePol219Instant(item.occurredAt as string),
    transactionEvidenceFileId: requiredControlledText(item.transactionEvidenceFileId, "transactionEvidenceFileId"),
    transactionEvidenceContentSha256: normalizePol219Hash(item.transactionEvidenceContentSha256 as string),
    observationPayloadFingerprint: normalizePol219Hash(item.observationPayloadFingerprint as string),
    creditorScopeEvidenceCoordinate: normalizePol219EvidenceCoordinate(item.creditorScopeEvidenceCoordinate)
  };
}

function normalizeAuthorityCreditorLine(
  value: unknown,
  expectedSourceVersionFingerprint: string,
  authorityHeader: ReturnType<typeof normalizeSourceHeader>
) {
  const item = exactRecord(value, [
    "authorityCreditorLineId", "stableBucketKey", "categoryCode", "categoryLabelSnapshot", "creditorIdentityKind",
    "creditorPartyVersionId", "controlledScopeCode", "controlledScopeDescription", "controlledScopeEvidenceCoordinate", "grossDebtCents",
    "historicallySettledCents", "outstandingBalanceCents", "debtStatus", "targetKind", "targetBusinessKey",
    "targetPayload", "targetFingerprint", "signedGrossDeltaCents", "signedHistoricallySettledDeltaCents",
    "signedOutstandingBalanceDeltaCents", "deltaFingerprint", "rootCreditorLineId", "rootPayableRefId"
  ], "POL219 authority creditor line");
  const stableIdentity = {
    categoryCode: requiredControlledText(item.categoryCode, "categoryCode"),
    creditorIdentityKind: requiredControlledText(item.creditorIdentityKind, "creditorIdentityKind"),
    creditorPartyVersionId: nullableControlledText(item.creditorPartyVersionId, "creditorPartyVersionId"),
    controlledScopeCode: nullableControlledText(item.controlledScopeCode, "controlledScopeCode"),
    controlledScopeDescription: nullableText(item.controlledScopeDescription, "controlledScopeDescription"),
    targetKind: requiredControlledText(item.targetKind, "targetKind"),
    targetBusinessKey: requiredControlledText(item.targetBusinessKey, "targetBusinessKey")
  };
  const stableBucketKey = canonicalPol219CreditorStableKey(stableIdentity);
  if (item.stableBucketKey !== stableBucketKey) throw new TypeError("POL219 creditor stableBucketKey 不一致");
  const targetDomain = stableIdentity.targetKind === "historical_wage_balance_reconciliation_version"
    ? POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.balanceReconciliation
    : stableIdentity.targetKind === "existing_verified_payment_execution_set"
      ? POL219_HISTORICAL_WAGE_FINGERPRINT_DOMAINS.verifiedPaymentExecutionSet
      : null;
  if (!targetDomain) throw new TypeError("POL219 creditor target kind 无效");
  const targetFingerprint = normalizePol219Hash(item.targetFingerprint as string);
  const controlledScopeEvidenceCoordinate = item.controlledScopeEvidenceCoordinate === null
    ? null
    : normalizePol219EvidenceCoordinate(item.controlledScopeEvidenceCoordinate);
  let targetPayload: unknown;
  if (stableIdentity.targetKind === "historical_wage_balance_reconciliation_version") {
    const target = computePol219HistoricalWageBalanceReconciliationFingerprint(item.targetPayload);
    if (target.payload.sourceVersionFingerprint !== expectedSourceVersionFingerprint) {
      throw new TypeError("POL219 balance target sourceVersionFingerprint 与 authority 不一致");
    }
    if (target.payload.targetBusinessKey !== stableIdentity.targetBusinessKey) {
      throw new TypeError("POL219 balance target business key 与 creditor stable key 不一致");
    }
    if (target.payload.reconciliationAuthorityVersionId !== stableIdentity.targetBusinessKey) {
      throw new TypeError("POL219 balance target reconciliation authority 与 business key 不一致");
    }
    assertAuthorityTargetHeader(target.payload, authorityHeader, "balance");
    assertAuthorityTargetCreditor(target.payload, item, stableIdentity, "balance");
    targetPayload = target.payload;
    if (target.fingerprint !== targetFingerprint) {
      throw new TypeError("POL219 creditor target fingerprint 不一致");
    }
  } else {
    const raw = exactRecord(item.targetPayload, ["schemaVersion", "paymentExecutionIds", "paymentExecutions"], "POL219 verified payment set payload");
    const target = computePol219VerifiedPaymentExecutionSet(raw.paymentExecutions);
    if (strictJcs(target.payload) !== strictJcs(raw)) {
      throw new TypeError("POL219 verified payment set payload 不是服务端 canonical 全链顺序");
    }
    if (stableIdentity.targetBusinessKey !== target.fingerprint) {
      throw new TypeError("POL219 payment target business key 与集合指纹不一致");
    }
    assertPaymentTargetClosure(target.payload, item, authorityHeader, controlledScopeEvidenceCoordinate);
    targetPayload = target.payload;
    if (target.fingerprint !== targetFingerprint) {
      throw new TypeError("POL219 creditor target fingerprint 不一致");
    }
  }
  if (pol219DomainFingerprint(targetDomain, targetPayload) !== targetFingerprint) {
    throw new TypeError("POL219 creditor target fingerprint 不一致");
  }
  const grossDebtCents = normalizePol219NonNegativeInteger(item.grossDebtCents as string);
  const historicallySettledCents = normalizePol219NonNegativeInteger(item.historicallySettledCents as string);
  const outstandingBalanceCents = normalizePol219NonNegativeInteger(item.outstandingBalanceCents as string);
  assertDebtEquation(item.debtStatus, grossDebtCents, historicallySettledCents, outstandingBalanceCents);
  const signedGrossDeltaCents = normalizePol219SignedInteger(item.signedGrossDeltaCents as string);
  const signedHistoricallySettledDeltaCents = normalizePol219SignedInteger(item.signedHistoricallySettledDeltaCents as string);
  const signedOutstandingBalanceDeltaCents = normalizePol219SignedInteger(item.signedOutstandingBalanceDeltaCents as string);
  if (
    BigInt(signedGrossDeltaCents) !==
    BigInt(signedHistoricallySettledDeltaCents) + BigInt(signedOutstandingBalanceDeltaCents)
  ) {
    throw new TypeError("POL219 signed delta 金额恒等式不闭合");
  }
  return {
    authorityCreditorLineId: normalizePol219Uuid(item.authorityCreditorLineId as string),
    stableBucketKey,
    categoryCode: stableIdentity.categoryCode,
    categoryLabelSnapshot: requiredBusinessText(item.categoryLabelSnapshot, "categoryLabelSnapshot"),
    creditorIdentityKind: stableIdentity.creditorIdentityKind,
    creditorPartyVersionId: stableIdentity.creditorPartyVersionId,
    controlledScopeCode: stableIdentity.controlledScopeCode,
    controlledScopeDescription: stableIdentity.controlledScopeDescription,
    controlledScopeEvidenceCoordinate,
    grossDebtCents,
    historicallySettledCents,
    outstandingBalanceCents,
    debtStatus: requiredDebtStatus(item.debtStatus),
    targetKind: stableIdentity.targetKind,
    targetBusinessKey: stableIdentity.targetBusinessKey,
    targetPayload,
    targetFingerprint,
    signedGrossDeltaCents,
    signedHistoricallySettledDeltaCents,
    signedOutstandingBalanceDeltaCents,
    deltaFingerprint: normalizePol219Hash(item.deltaFingerprint as string),
    rootCreditorLineId: nullableControlledText(item.rootCreditorLineId, "rootCreditorLineId"),
    rootPayableRefId: nullableControlledText(item.rootPayableRefId, "rootPayableRefId")
  };
}

function normalizeAuthorityConflictReadSet(
  value: unknown,
  authorityHeader: ReturnType<typeof normalizeSourceHeader>,
  assignedWageExclusions: ReturnType<typeof computePol219AssignedWageExclusionSet>["payload"]["assignedWageExclusions"]
) {
  const item = exactRecord(value, [
    "employmentCompanyId", "wageMonth", "projectIds", "contracts", "authorities", "lines"
  ], "POL219 authority conflictReadSet");
  const employmentCompanyId = requiredControlledText(item.employmentCompanyId, "employmentCompanyId");
  const projectIds = canonicalizePol219Set(
    requiredArray(item.projectIds, "projectIds").map((projectId) => requiredControlledText(projectId, "projectId")),
    (projectId) => projectId
  );
  if (!projectIds.length) throw new TypeError("POL219 conflictReadSet projectIds 不能为空");
  const contracts = canonicalizePol219Set(
    requiredArray(item.contracts, "contracts").map((contract) => {
      const contractItem = exactRecord(contract, [
        "id",
        "projectId",
        "companyEntityId",
        "companyEntityVersionId",
        "requestFingerprint",
        "fileContentSha256Snapshot"
      ], "POL219 conflict contract");
      return {
        id: requiredControlledText(contractItem.id, "contractId"),
        projectId: requiredControlledText(contractItem.projectId, "projectId"),
        companyEntityId: requiredControlledText(contractItem.companyEntityId, "companyEntityId"),
        companyEntityVersionId: requiredControlledText(contractItem.companyEntityVersionId, "companyEntityVersionId"),
        requestFingerprint: normalizePol219Hash(contractItem.requestFingerprint as string),
        fileContentSha256Snapshot: normalizePol219Hash(contractItem.fileContentSha256Snapshot as string)
      };
    }),
    (contract) => contract.id
  );
  const authorities = canonicalizePol219Set(
    requiredArray(item.authorities, "authorities").map((authority) => {
      const authorityItem = exactRecord(
        authority,
        ["id", "affiliateCompanyContractId", "authorityFingerprint"],
        "POL219 conflict authority"
      );
      return {
        id: requiredControlledText(authorityItem.id, "authorityId"),
        affiliateCompanyContractId: requiredControlledText(
          authorityItem.affiliateCompanyContractId,
          "affiliateCompanyContractId"
        ),
        authorityFingerprint: normalizePol219Hash(authorityItem.authorityFingerprint as string)
      };
    }),
    (authority) => authority.id
  );
  const lines = canonicalizePol219Set(
    requiredArray(item.lines, "lines").map((line) => {
      const lineItem = exactRecord(line, [
        "id", "authorityVersionId", "projectId", "coverageKind", "personAuthorityKey", "lineFingerprint"
      ], "POL219 conflict line");
      const coverageKind = requiredControlledText(lineItem.coverageKind, "coverageKind");
      if (coverageKind !== "PERSON" && coverageKind !== "ROLE_SUMMARY") {
        throw new TypeError("POL219 conflict line coverageKind 无效");
      }
      const personAuthorityKey = nullableControlledText(lineItem.personAuthorityKey, "personAuthorityKey");
      if ((coverageKind === "PERSON") !== Boolean(personAuthorityKey)) {
        throw new TypeError("POL219 conflict line 人员覆盖键与 coverageKind 不一致");
      }
      return {
        id: requiredControlledText(lineItem.id, "lineId"),
        authorityVersionId: requiredControlledText(lineItem.authorityVersionId, "authorityVersionId"),
        projectId: requiredControlledText(lineItem.projectId, "projectId"),
        coverageKind,
        personAuthorityKey,
        lineFingerprint: normalizePol219Hash(lineItem.lineFingerprint as string)
      };
    }),
    (line) => line.id
  );
  const wageMonth = requiredWageMonth(item.wageMonth);
  if (wageMonth !== authorityHeader.wageMonth) {
    throw new TypeError("POL219 conflictReadSet wageMonth 与 authority header 不一致");
  }
  if (employmentCompanyId !== authorityHeader.employmentCompanyId) {
    throw new TypeError("POL219 conflictReadSet employmentCompanyId 与 authority header 不一致");
  }
  if (strictJcs(projectIds) !== strictJcs([authorityHeader.projectId])) {
    throw new TypeError("POL219 conflictReadSet projectIds 与单项目 B authority 不闭合");
  }
  const projectSet = new Set(projectIds);
  const contractSet = new Set(contracts.map((contract) => contract.id));
  const authoritySet = new Set(authorities.map((authority) => authority.id));
  if (contracts.some((contract) =>
    !projectSet.has(contract.projectId) || contract.companyEntityId !== employmentCompanyId
  )) {
    throw new TypeError("POL219 conflict contracts 未被 company/project read-set 完整覆盖");
  }
  if (authorities.some((authority) => !contractSet.has(authority.affiliateCompanyContractId))) {
    throw new TypeError("POL219 conflict authorities 未被 contract read-set 完整覆盖");
  }
  if (lines.some((line) => !projectSet.has(line.projectId) || !authoritySet.has(line.authorityVersionId))) {
    throw new TypeError("POL219 conflict lines 未被 project/authority read-set 完整覆盖");
  }
  if (lines.some((line) => line.coverageKind !== "PERSON")) {
    throw new TypeError("POL219 B authority 不得包含 ROLE_SUMMARY conflict line");
  }
  const proofKeys = assignedWageExclusions.map((proof) => strictJcs([
    proof.authorityVersionId,
    proof.lineId,
    proof.lineFingerprint
  ])).sort();
  const lineKeys = lines.map((line) => strictJcs([
    line.authorityVersionId,
    line.id,
    line.lineFingerprint
  ])).sort();
  if (strictJcs(proofKeys) !== strictJcs(lineKeys)) {
    throw new TypeError("POL219 assigned wage 排除证明与 conflict lines 不闭合");
  }
  return {
    employmentCompanyId,
    wageMonth,
    projectIds,
    contracts,
    authorities,
    lines
  };
}

function assertAuthorityTargetHeader(
  target: ReturnType<typeof computePol219HistoricalWageBalanceReconciliationFingerprint>["payload"],
  header: ReturnType<typeof normalizeSourceHeader>,
  label: string
) {
  const pairs: Array<[unknown, unknown, string]> = [
    [target.employmentCompanyId, header.employmentCompanyId, "employmentCompanyId"],
    [target.employmentCompanyNameSnapshot, header.employmentCompanyNameSnapshot, "employmentCompanyNameSnapshot"],
    [target.employmentCompanyCreditCodeSnapshot, header.employmentCompanyCreditCodeSnapshot, "employmentCompanyCreditCodeSnapshot"],
    [target.projectId, header.projectId, "projectId"],
    [target.projectCodeSnapshot, header.projectCodeSnapshot, "projectCodeSnapshot"],
    [target.projectNameSnapshot, header.projectNameSnapshot, "projectNameSnapshot"],
    [target.wageMonth, header.wageMonth, "wageMonth"],
    [target.catalogVersion, header.catalogVersion, "catalogVersion"],
    [target.positionCategoryCode, header.positionCategoryCode, "positionCategoryCode"],
    [target.positionCategoryLabelSnapshot, header.positionCategoryLabelSnapshot, "positionCategoryLabelSnapshot"]
  ];
  const mismatch = pairs.find(([actual, expected]) => actual !== expected);
  if (mismatch) throw new TypeError(`POL219 ${label} target ${mismatch[2]} 与 authority header 不一致`);
}

function assertAuthorityTargetCreditor(
  target: ReturnType<typeof computePol219HistoricalWageBalanceReconciliationFingerprint>["payload"],
  line: Record<string, unknown>,
  identity: Pol219CreditorStableIdentity,
  label: string
) {
  const pairs: Array<[unknown, unknown, string]> = [
    [target.categoryCode, identity.categoryCode, "categoryCode"],
    [target.categoryLabelSnapshot, requiredBusinessText(line.categoryLabelSnapshot, "categoryLabelSnapshot"), "categoryLabelSnapshot"],
    [target.creditorIdentityKind, identity.creditorIdentityKind, "creditorIdentityKind"],
    [target.creditorPartyVersionId, identity.creditorPartyVersionId, "creditorPartyVersionId"],
    [target.controlledScopeCode, identity.controlledScopeCode, "controlledScopeCode"],
    [target.controlledScopeDescription, identity.controlledScopeDescription, "controlledScopeDescription"],
    [target.grossDebtCents, normalizePol219NonNegativeInteger(line.grossDebtCents as string), "grossDebtCents"],
    [target.historicallySettledCents, normalizePol219NonNegativeInteger(line.historicallySettledCents as string), "historicallySettledCents"],
    [target.outstandingBalanceCents, normalizePol219NonNegativeInteger(line.outstandingBalanceCents as string), "outstandingBalanceCents"],
    [target.debtStatus, requiredDebtStatus(line.debtStatus), "debtStatus"]
  ];
  const mismatch = pairs.find(([actual, expected]) => actual !== expected);
  if (mismatch) throw new TypeError(`POL219 ${label} target ${mismatch[2]} 与 creditor line 不一致`);
}

function assertPaymentTargetClosure(
  target: ReturnType<typeof computePol219VerifiedPaymentExecutionSet>["payload"],
  line: Record<string, unknown>,
  header: ReturnType<typeof normalizeSourceHeader>,
  controlledScopeEvidenceCoordinate: Pol219EvidenceCoordinate | null
) {
  const grossDebtCents = normalizePol219NonNegativeInteger(line.grossDebtCents as string);
  const historicallySettledCents = normalizePol219NonNegativeInteger(line.historicallySettledCents as string);
  const outstandingBalanceCents = normalizePol219NonNegativeInteger(line.outstandingBalanceCents as string);
  if (
    requiredDebtStatus(line.debtStatus) !== "settled" ||
    outstandingBalanceCents !== "0" ||
    historicallySettledCents !== grossDebtCents
  ) {
    throw new TypeError("POL219 payment target 只能对应全额 settled creditor line");
  }
  const total = target.paymentExecutions.reduce((sum, payment) => sum + BigInt(payment.amountCents), 0n);
  if (total.toString() !== grossDebtCents) {
    throw new TypeError("POL219 payment target 金额与 creditor line 不闭合");
  }
  if (!controlledScopeEvidenceCoordinate) {
    throw new TypeError("POL219 payment target 缺少 creditor scope 证据坐标");
  }
  const expectedCoordinate = strictJcs(controlledScopeEvidenceCoordinate);
  for (const payment of target.paymentExecutions) {
    if (
      payment.paymentRequestProjectId !== header.projectId ||
      payment.payerCompanyId !== header.employmentCompanyId ||
      payment.payerCompanyNameSnapshot !== header.employmentCompanyNameSnapshot ||
      payment.payerCompanyCreditCodeSnapshot !== header.employmentCompanyCreditCodeSnapshot ||
      payment.legalAccountHolderCompanyId !== header.employmentCompanyId ||
      payment.legalAccountHolderNameSnapshot !== header.employmentCompanyNameSnapshot ||
      payment.legalAccountHolderCreditCodeSnapshot !== header.employmentCompanyCreditCodeSnapshot
    ) {
      throw new TypeError("POL219 payment target 公司或项目与 authority header 不一致");
    }
    if (strictJcs(payment.creditorScopeEvidenceCoordinate) !== expectedCoordinate) {
      throw new TypeError("POL219 payment target 债权范围证据与 creditor line 不一致");
    }
  }
}

function normalizeLegacyAuthoritySource(value: unknown) {
  const item = exactRecord(value, [
    "factId", "factFingerprint", "costImpactId", "costImpactFingerprint", "payableImpactId", "payableImpactFingerprint"
  ], "POL219 authority legacy source");
  return {
    factId: requiredControlledText(item.factId, "factId"),
    factFingerprint: normalizePol219Hash(item.factFingerprint as string),
    costImpactId: requiredControlledText(item.costImpactId, "costImpactId"),
    costImpactFingerprint: normalizePol219Hash(item.costImpactFingerprint as string),
    payableImpactId: requiredControlledText(item.payableImpactId, "payableImpactId"),
    payableImpactFingerprint: normalizePol219Hash(item.payableImpactFingerprint as string)
  };
}

function normalizeVerifiedPaymentSetBinding(value: unknown) {
  const item = exactRecord(value, ["paymentExecutionSetFingerprint", "payload"], "POL219 verified payment set binding");
  const raw = exactRecord(item.payload, ["schemaVersion", "paymentExecutionIds", "paymentExecutions"], "POL219 verified payment set payload");
  const computed = computePol219VerifiedPaymentExecutionSet(raw.paymentExecutions);
  if (strictJcs(raw) !== strictJcs(computed.payload)) {
    throw new TypeError("POL219 verified payment set payload 不是服务端 canonical 全链顺序");
  }
  const payload = computed.payload;
  const paymentExecutionSetFingerprint = normalizePol219Hash(item.paymentExecutionSetFingerprint as string);
  if (computed.fingerprint !== paymentExecutionSetFingerprint) {
    throw new TypeError("POL219 verified payment set fingerprint 不一致");
  }
  return { paymentExecutionSetFingerprint, payload };
}

function normalizeScopeCreatorIdentity(value: unknown) {
  const item = exactRecord(value, ["actualUserId", "actualRoles", "delegatorUserId", "delegatorRoles", "actorIds"], "POL219 scope creator identity");
  const actualUserId = requiredControlledText(item.actualUserId, "actualUserId");
  const actualRoles = canonicalizePol219Set(requiredArray(item.actualRoles, "actualRoles").map((role) => requiredControlledText(role, "role")), (role) => role);
  const delegatorUserId = nullableControlledText(item.delegatorUserId, "delegatorUserId");
  const delegatorRoles = item.delegatorRoles === null
    ? null
    : canonicalizePol219Set(requiredArray(item.delegatorRoles, "delegatorRoles").map((role) => requiredControlledText(role, "role")), (role) => role);
  const actorIds = canonicalizePol219Set(requiredArray(item.actorIds, "actorIds").map((id) => requiredControlledText(id, "actorId")), (id) => id);
  if (!actualRoles.length || !actorIds.length) throw new TypeError("POL219 scope creator identity 不完整");
  if ((delegatorUserId === null) !== (delegatorRoles === null) || (delegatorRoles !== null && !delegatorRoles.length)) {
    throw new TypeError("POL219 delegator 身份与权限快照不闭合");
  }
  const expectedActorIds = canonicalizePol219Set(
    delegatorUserId === null ? [actualUserId] : [actualUserId, delegatorUserId],
    (id) => id
  );
  if (strictJcs(actorIds) !== strictJcs(expectedActorIds)) {
    throw new TypeError("POL219 actorIds 必须精确覆盖实际操作者与委托人");
  }
  return {
    actualUserId,
    actualRoles,
    delegatorUserId,
    delegatorRoles,
    actorIds
  };
}
