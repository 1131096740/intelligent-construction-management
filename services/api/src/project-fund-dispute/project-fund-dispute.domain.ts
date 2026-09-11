import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException
} from "@nestjs/common";
import {
  PROJECT_FUND_DISPUTE_ENTRY_KINDS,
  PROJECT_FUND_DISPUTE_KINDS,
  PROJECT_FUND_DISPUTE_SOURCE_TYPE,
  type ProjectFundDisputeEntryKind,
  type ProjectFundDisputeFundHolderKind,
  type ProjectFundDisputeKind,
  type ProjectFundDisputeStatus,
  type ProjectFundDisputeTransitionAction,
  type RoleKey
} from "@jiangkong/shared-domain";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

export interface ProjectFundDisputeIdentityInput {
  projectId: string;
  affiliateAssignmentId: string;
  fundHolderKind: ProjectFundDisputeFundHolderKind;
  fundHolderId: string;
  basisKind: string;
  basisBusinessIdOrEvidenceSha256: string;
  currencyCode: "CNY";
}

export function buildProjectFundDisputeIdentity(
  input: ProjectFundDisputeIdentityInput
): { economicIdentityKey: string; sourceIdentityKey: string } {
  const economicIdentityKey = sha256Jcs([
    requiredIdentityText(input.projectId),
    requiredIdentityText(input.affiliateAssignmentId),
    input.fundHolderKind,
    requiredIdentityText(input.fundHolderId),
    requiredIdentityText(input.basisKind),
    requiredIdentityText(input.basisBusinessIdOrEvidenceSha256),
    input.currencyCode
  ]);
  return {
    economicIdentityKey,
    sourceIdentityKey: sha256Jcs([
      economicIdentityKey,
      PROJECT_FUND_DISPUTE_SOURCE_TYPE
    ])
  };
}

export function sha256Jcs(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export interface ProjectFundDisputeDraftCommand {
  disputeId?: string;
  entryId?: string;
  projectId: string;
  businessCode: string;
  affiliateAssignmentId: string;
  fundHolderKind: ProjectFundDisputeFundHolderKind;
  fundHolderId: string;
  disputeKind: ProjectFundDisputeKind;
  counterpartyKind: string;
  counterpartyId: string;
  counterpartyNameSnapshot: string;
  referenceCode: string;
  basisKind: string;
  basisBusinessIdOrEvidenceSha256: string;
  entryKind: ProjectFundDisputeEntryKind;
  adjustsEntryId?: string;
  amountCents: string;
  occurredAt: string;
  evidenceLevel: "A" | "B" | "C";
  evidenceFileId: string;
  evidenceSha256: string;
  disputeSummary: string;
  resolutionBasisSummary?: string;
  replacementImpacts?: Array<{
    operatingImpactEntryId: string;
    amountCents: string;
  }>;
  idempotencyKey: string;
  expectedRevision?: number;
}

export interface ValidatedProjectFundDisputeDraft
  extends Omit<ProjectFundDisputeDraftCommand, "amountCents" | "evidenceLevel"> {
  amountCents: bigint;
  evidenceLevel: "A" | "B";
  occurredAtDate: Date;
}

export function assertProjectFundDisputeDraft(
  input: ProjectFundDisputeDraftCommand
): ValidatedProjectFundDisputeDraft {
  const projectId = requiredText(input.projectId, "项目不能为空");
  const businessCode = requiredText(input.businessCode, "争议资金业务编号不能为空");
  const affiliateAssignmentId = requiredText(
    input.affiliateAssignmentId,
    "施工企业档案不能为空"
  );
  if (!new Set(["construction_enterprise", "participating_company"]).has(input.fundHolderKind)) {
    throw new BadRequestException("资金持有主体只能是施工企业或参与公司");
  }
  const fundHolderId = requiredText(input.fundHolderId, "资金持有主体不能为空");
  if (!PROJECT_FUND_DISPUTE_KINDS.includes(input.disputeKind)) {
    throw new BadRequestException("争议类型不正确");
  }
  if (!PROJECT_FUND_DISPUTE_ENTRY_KINDS.includes(input.entryKind)) {
    throw new BadRequestException("争议资金分录类型不正确");
  }
  const disputeId = input.disputeId?.trim() || undefined;
  if (!disputeId && input.entryKind !== "establish") {
    throw new BadRequestException("争议资金首笔分录必须先建立争议");
  }
  const amountCents = parsePositiveMoney(input.amountCents);
  if (input.evidenceLevel !== "A" && input.evidenceLevel !== "B") {
    throw new BadRequestException("一般争议资金只有 A 级或 B 级证据可以产生金额");
  }
  if (!UUID_V4.test(input.idempotencyKey)) {
    throw new BadRequestException("幂等键必须使用 UUIDv4");
  }
  if (!SHA256.test(input.evidenceSha256)) {
    throw new BadRequestException("证据内容哈希必须是 SHA-256");
  }
  if (!DATE_ONLY.test(input.occurredAt)) {
    throw new BadRequestException("业务发生日必须是 YYYY-MM-DD");
  }
  const occurredAtDate = new Date(`${input.occurredAt}T00:00:00.000Z`);
  if (occurredAtDate.toISOString().slice(0, 10) !== input.occurredAt) {
    throw new BadRequestException("业务发生日不是有效日期");
  }
  const adjustsEntryId = input.adjustsEntryId?.trim() || undefined;
  if (["release", "technical_reversal"].includes(input.entryKind) !== Boolean(adjustsEntryId)) {
    throw new BadRequestException("释放或技术冲销必须且只能精确引用原确认分录");
  }
  const replacementImpacts = (input.replacementImpacts ?? []).map((replacement) => ({
    operatingImpactEntryId: requiredText(
      replacement.operatingImpactEntryId,
      "替代影响不能为空"
    ),
    amountCents: parsePositiveMoney(replacement.amountCents).toString()
  }));
  if (new Set(replacementImpacts.map((replacement) => replacement.operatingImpactEntryId)).size !== replacementImpacts.length) {
    throw new BadRequestException("同一替代正式影响不能重复关联");
  }
  if (input.entryKind !== "release" && replacementImpacts.length > 0) {
    throw new BadRequestException("只有释放分录可以关联替代正式影响");
  }
  const resolutionBasisSummary = input.resolutionBasisSummary?.trim() || undefined;
  if (input.entryKind === "release" && !resolutionBasisSummary) {
    throw new BadRequestException("解除争议必须填写解决依据");
  }
  if (input.entryKind !== "release" && resolutionBasisSummary) {
    throw new BadRequestException("只有解除争议分录可以填写解决依据");
  }
  return {
    ...input,
    disputeId,
    projectId,
    businessCode,
    affiliateAssignmentId,
    fundHolderId,
    counterpartyKind: requiredText(input.counterpartyKind, "争议相对方类型不能为空"),
    counterpartyId: requiredText(input.counterpartyId, "争议相对方不能为空"),
    counterpartyNameSnapshot: requiredText(
      input.counterpartyNameSnapshot,
      "争议相对方名称不能为空"
    ),
    referenceCode: requiredText(input.referenceCode, "外部案号或内部依据编号不能为空"),
    basisKind: requiredText(input.basisKind, "依据类型不能为空"),
    basisBusinessIdOrEvidenceSha256: requiredText(
      input.basisBusinessIdOrEvidenceSha256,
      "依据业务编号或证据哈希不能为空"
    ),
    evidenceFileId: requiredText(input.evidenceFileId, "私有证据文件不能为空"),
    disputeSummary: requiredText(input.disputeSummary, "争议摘要不能为空"),
    resolutionBasisSummary,
    adjustsEntryId,
    replacementImpacts,
    amountCents,
    evidenceLevel: input.evidenceLevel,
    occurredAtDate
  };
}

export function buildProjectFundDisputeFingerprint(
  input: ValidatedProjectFundDisputeDraft
): string {
  return sha256Jcs({
    projectId: input.projectId,
    businessCode: input.businessCode,
    affiliateAssignmentId: input.affiliateAssignmentId,
    fundHolderKind: input.fundHolderKind,
    fundHolderId: input.fundHolderId,
    disputeKind: input.disputeKind,
    counterpartyKind: input.counterpartyKind,
    counterpartyId: input.counterpartyId,
    counterpartyNameSnapshot: input.counterpartyNameSnapshot,
    referenceCode: input.referenceCode,
    basisKind: input.basisKind,
    basisBusinessIdOrEvidenceSha256: input.basisBusinessIdOrEvidenceSha256,
    entryKind: input.entryKind,
    adjustsEntryId: input.adjustsEntryId ?? null,
    amountCents: input.amountCents.toString(),
    occurredAt: input.occurredAt,
    evidenceLevel: input.evidenceLevel,
    evidenceFileId: input.evidenceFileId,
    evidenceSha256: input.evidenceSha256,
    disputeSummary: input.disputeSummary,
    resolutionBasisSummary: input.resolutionBasisSummary ?? null,
    replacementImpacts: input.replacementImpacts ?? []
  });
}

export function assertProjectFundDisputeTransition(input: {
  action: ProjectFundDisputeTransitionAction;
  status: ProjectFundDisputeStatus;
  preparedByUserId: string;
  attestedByUserId?: string | null;
  actorUserId: string;
  actorRoles: readonly RoleKey[];
  fingerprint: string;
  expectedFingerprint: string;
}): ProjectFundDisputeStatus {
  if (!SHA256.test(input.expectedFingerprint) || input.fingerprint !== input.expectedFingerprint) {
    throw new ConflictException("争议资金冻结指纹已变化，请刷新后重试");
  }
  const allowedRolesByAction: Record<ProjectFundDisputeTransitionAction, readonly RoleKey[]> = {
    submit: ["contract_staff", "contract_director", "finance_staff", "finance_director"],
    attest: ["project_manager", "contract_director"],
    confirm: ["finance_director"],
    return: ["finance_director"]
  };
  if (!allowedRolesByAction[input.action].some((role) => input.actorRoles.includes(role))) {
    throw new ForbiddenException("当前岗位不能执行该争议资金动作");
  }
  if (input.action === "submit" && !new Set(["draft", "returned"]).has(input.status)) {
    throw new ConflictException("当前状态不能提交");
  }
  if (input.action === "attest") {
    if (input.status !== "submitted") throw new ConflictException("只有待见证分录可以见证");
    if (input.preparedByUserId === input.actorUserId) {
      throw new ConflictException("准备人与争议见证人必须是不同自然人");
    }
  }
  if (input.action === "confirm") {
    if (input.status !== "attested" || !input.attestedByUserId) {
      throw new ConflictException("争议资金必须先由项目经理或合同总监独立见证");
    }
  }
  if (input.action === "return" && !new Set(["submitted", "attested"]).has(input.status)) {
    throw new ConflictException("只有待见证或待确认分录可以退回");
  }
  return {
    submit: "submitted",
    attest: "attested",
    confirm: "confirmed",
    return: "returned"
  }[input.action] as ProjectFundDisputeStatus;
}

export function hashEconomicAdvisoryCoordinate(economicIdentityKey: string): string {
  if (!SHA256.test(economicIdentityKey)) {
    throw new BadRequestException("经济身份键格式不正确");
  }
  return createHash("sha256")
    .update(`pol:project-cash-restriction:economic:${economicIdentityKey}`)
    .digest("hex");
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("JCS 不接受非有限数或负零");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("JCS 只能包含 JSON 值");
  if (ancestors.has(value)) throw new TypeError("JCS 不接受循环引用");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("JCS 不接受数组空洞");
        items.push(canonicalJson(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JCS 只接受 plain JSON object");
    }
    const record = value as Record<string, unknown>;
    const keys = Reflect.ownKeys(record);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("JCS 不接受 symbol key");
    }
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("JCS 只接受 enumerable data property");
      }
    }
    stringKeys.sort();
    return `{${stringKeys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`)
      .join(",")}}`;
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
        throw new TypeError("JCS 文本包含 lone surrogate");
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("JCS 文本包含 lone surrogate");
    }
  }
}

function requiredIdentityText(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError("经济身份字段不能为空");
  return normalized;
}

function parsePositiveMoney(value: string): bigint {
  if (!/^\d+$/u.test(value)) throw new BadRequestException("金额必须使用整数分");
  const amount = BigInt(value);
  if (amount <= 0n || amount > 9_223_372_036_854_775_807n) {
    throw new BadRequestException("金额必须为 PostgreSQL bigint 范围内的正整数分");
  }
  return amount;
}

function requiredText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}
