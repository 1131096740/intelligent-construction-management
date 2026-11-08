import { Prisma } from "@prisma/client";

const FACT_COLUMNS = ["id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceBusinessCode", "occurredAt", "confirmedAt", "affiliateAssignmentId", "affiliateBusinessPartyVersionId", "affiliateNameSnapshot", "affiliateCreditCodeSnapshot", "operatingLedgerEffectiveDateSnapshot", "isBeforeOperatingLedgerEffectiveDate", "historicalTakeoverBatchId", "factKind", "operatingLevel", "evidenceLevel", "amountCents", "currencyCode", "direction", "debtorSubjectKind", "debtorSubjectId", "creditorSubjectKind", "creditorSubjectId", "approvedPayerSubjectKind", "approvedPayerSubjectId", "actualPayerSubjectKind", "actualPayerSubjectId", "payeeSubjectKind", "payeeSubjectId", "costBearingCompanySubjectKind", "costBearingCompanySubjectId", "subjectSnapshot", "sourceSnapshot", "basisSnapshot", "entryKind", "adjustsFactId", "idempotencyKey", "confirmedByUserId", "status", "paymentExecutionId", "fundExecutionId", "fundExecutionCaseId"];
const IMPACT_COLUMNS = ["id", "factId", "projectId", "sourceType", "sourceBusinessId", "sourceImpactKey", "idempotencyKey", "impactKind", "amountCents", "direction", "subjectRole", "subjectKind", "subjectId", "costCategoryCode", "fundPurpose", "description", "impactSnapshot", "paymentExecutionId", "fundExecutionId", "fundExecutionCaseId", "executionAllocationLineId"];

/** Fixed ROW-parameter projection only; no SQL engine, connection or source calculation. */
export function syntheticOperatingWrite(query: Prisma.Sql): { kind: string; row: Record<string, unknown> } {
  const text = query.strings.map((part, i) => part + (i < query.values.length ? `$${i}` : "")).join("");
  const match = /^\s*SELECT \*\s+FROM public\."appendOperating(Fact|Impact)ThroughService"\(\s*ROW\(([\s\S]*?)\)::public\."OperatingLedger(Fact|Impact)WritePayload(V2)?"\s*,\s*\$\d+\s*,\s*\$\d+\s*\)\s*$/u.exec(text);
  if (!match || match[1] !== match[3]) throw new Error("合成经营持久层拒绝未知受控写入形状");
  const version = match[4] ? 2 : 1;
  const columns = [...(match[1] === "Fact" ? FACT_COLUMNS : IMPACT_COLUMNS), ...(version === 2 ? ["numericProtocolVersion", "amountYuan"] : [])];
  const cells = match[2].split(",").map(cell => cell.trim());
  if (cells.length !== columns.length) throw new Error("合成经营持久层的固定参数数量不符");
  const row: Record<string, unknown> = {};
  cells.forEach((cell, index) => {
    if (cell === "NULL::jsonb") { row[columns[index]] = null; return; }
    const bound = /^\$(\d+)::(text|integer|timestamptz|date|boolean|bigint|numeric|jsonb)$/u.exec(cell);
    if (!bound) throw new Error("合成经营持久层拒绝未知参数转换");
    const value = query.values[Number(bound[1])];
    row[columns[index]] = value == null ? null : bound[2] === "jsonb" ? JSON.parse(String(value)) : bound[2] === "numeric" ? new Prisma.Decimal(String(value)) : value;
  });
  row.numericProtocolVersion ??= 1;
  row.amountYuan ??= null;
  // Independent protocol oracle: old cents stay known, v2 never writes cents.
  if (row.numericProtocolVersion === 1 ? typeof row.amountCents !== "bigint" || row.amountYuan !== null : row.numericProtocolVersion !== 2 || row.amountCents !== null) throw new Error("合成经营持久层拒绝混淆原分事实与新版元事实");
  return { kind: match[1], row: { ...row, createdAt: new Date(), ...(match[1] === "Fact" ? { recordedAt: new Date(), recordedByUserId: query.values.at(-2) } : {}) } };
}
