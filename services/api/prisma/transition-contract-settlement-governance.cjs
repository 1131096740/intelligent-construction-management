#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const APPLY_CONFIRMATION = "ALLOW_GOVERNANCE_TRANSITION_APPLY";
const MANIFEST_SCHEMA_VERSION = 1;
const TERMINATION_REASON = "因合同结算治理规则升级终止旧流程，请补充治理资料后重新提交";
const CONTRACT_ACTIVE_STATUSES = [
  "in_approval",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "approval_pending",
  "approved",
  "sealed_pending_archive"
];
const SETTLEMENT_ACTIVE_STATUSES = [
  "in_approval",
  "approval_pending",
  "pending_generation",
  "approved_pending_archive",
  "archive_pending",
  "pending_archive_confirm"
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const parsed = { apply: false, help: false, includes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    const [rawKey, inlineValue] = argument.split("=", 2);
    if (rawKey === "--include") {
      const value = inlineValue ?? argv[index + 1];
      invariant(value && !value.startsWith("--"), "参数 --include 缺少 kind:id 值");
      parsed.includes.push(value);
      if (inlineValue === undefined) index += 1;
      continue;
    }
    const mapping = {
      "--manifest": "manifestPath",
      "--candidate-sha": "candidateSha",
      "--confirm": "confirmation",
      "--operator-user-id": "operatorUserId"
    };
    const key = mapping[rawKey];
    invariant(key, `不支持的参数：${argument}`);
    const value = inlineValue ?? argv[index + 1];
    invariant(value && !value.startsWith("--"), `参数 ${rawKey} 缺少值`);
    parsed[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function manifestDigest(manifestWithoutDigest) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(manifestWithoutDigest)))
    .digest("hex");
}

function createManifest(discoveredItems, candidateSha, generatedAt = new Date(), options = {}) {
  invariant(/^[0-9a-f]{40}$/.test(candidateSha), "候选 SHA 必须是 40 位小写十六进制提交 SHA");
  const sortedDiscovered = [...discoveredItems].sort((left, right) =>
    `${left.kind}:${left.businessId}`.localeCompare(`${right.kind}:${right.businessId}`)
  );
  const blockedItems = sortedDiscovered.filter((item) => item.blockers?.length);
  const safeItems = sortedDiscovered.filter((item) => !item.blockers?.length);
  const requestedIncludes = [...new Set(options.includes ?? [])].sort();
  const safeByIdentity = new Map(
    safeItems.map((item) => [`${item.kind}:${item.businessId}`, item])
  );
  const blockedIdentities = new Set(
    blockedItems.map((item) => `${item.kind}:${item.businessId}`)
  );
  for (const identity of requestedIncludes) {
    invariant(
      /^(contract_version|settlement):[^:]+$/.test(identity),
      `include 格式无效：${identity}，必须使用 contract_version:id 或 settlement:id`
    );
    invariant(!blockedIdentities.has(identity), `include ${identity} 是阻断项，不能写入 apply 清单`);
    invariant(safeByIdentity.has(identity), `include ${identity} 不在本次只读预览候选中`);
  }
  const selectedItems = requestedIncludes.length
    ? requestedIncludes.map((identity) => safeByIdentity.get(identity))
    : safeItems;
  const body = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    mode: "preview",
    candidateSha,
    generatedAt: generatedAt.toISOString(),
    selection: {
      mode: requestedIncludes.length ? "explicit" : "all_safe",
      includes: requestedIncludes
    },
    discoveredItemCount: sortedDiscovered.length,
    itemCount: selectedItems.length,
    blockedCount: blockedItems.length,
    items: selectedItems,
    blockedItems,
    digestAlgorithm: "sha256"
  };
  return { ...body, digest: manifestDigest(body) };
}

function verifyManifestIntegrity(manifest) {
  invariant(manifest && typeof manifest === "object", "manifest 格式无效");
  invariant(manifest.schemaVersion === MANIFEST_SCHEMA_VERSION, "manifest 版本不受支持");
  invariant(manifest.mode === "preview", "manifest 不是只读预览生成物");
  invariant(Array.isArray(manifest.items), "manifest items 格式无效");
  invariant(Array.isArray(manifest.blockedItems), "manifest blockedItems 格式无效");
  invariant(manifest.itemCount === manifest.items.length, "manifest 项目数量不一致");
  invariant(manifest.blockedCount === manifest.blockedItems.length, "manifest 阻断项目数量不一致");
  invariant(
    manifest.selection?.mode === "explicit"
      ? manifest.discoveredItemCount >= manifest.itemCount + manifest.blockedCount
      : manifest.discoveredItemCount === manifest.itemCount + manifest.blockedCount,
    "manifest 发现项目数量不一致"
  );
  invariant(
    ["all_safe", "explicit"].includes(manifest.selection?.mode) &&
      Array.isArray(manifest.selection?.includes),
    "manifest selection 格式无效"
  );
  invariant(manifest.digestAlgorithm === "sha256", "manifest 摘要算法不受支持");
  const { digest, ...body } = manifest;
  invariant(
    typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest) && crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(manifestDigest(body))
    ),
    "manifest 已被修改或摘要不匹配"
  );
}

function assertApplyGates({ args, manifest, currentSha, checkoutClean = true }) {
  invariant(args.apply === true, "只有显式 --apply 才能执行过渡写入");
  invariant(args.manifestPath, "apply 必须提供由预览生成的 --manifest 文件");
  invariant(/^[0-9a-f]{40}$/.test(args.candidateSha ?? ""), "apply 必须提供精确 40 位候选 SHA");
  invariant(args.confirmation === APPLY_CONFIRMATION, `apply 确认串必须精确为 ${APPLY_CONFIRMATION}`);
  invariant(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.operatorUserId ?? ""),
    "apply 必须提供有效操作者用户 ID"
  );
  verifyManifestIntegrity(manifest);
  invariant((args.includes ?? []).length === 0, "--include 只能在 preview 生成 manifest 时使用");
  invariant(checkoutClean, "当前 Git 工作区不是洁净候选，禁止 apply");
  invariant(args.candidateSha === currentSha, "候选 SHA 与当前执行代码 SHA 不一致");
  invariant(manifest.candidateSha === currentSha, "manifest SHA 与当前执行代码 SHA 不一致");
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function toNumber(value) {
  return Number(typeof value === "bigint" ? value.toString() : value ?? 0);
}

function toCents(value) {
  return String(value ?? 0);
}

function grouped(rows, keyName) {
  const result = new Map();
  for (const row of rows) {
    const key = row[keyName];
    const current = result.get(key) ?? [];
    current.push(row);
    result.set(key, current);
  }
  return result;
}

function stateDigest(values) {
  return crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function placeholders(values, offset = 1) {
  return values.map((_, index) => `$${index + offset}`).join(", ");
}

function orderedLockClause(lock) {
  return lock ? ' ORDER BY "id" FOR UPDATE' : ' ORDER BY "id"';
}

function resolveApprovalSelection(relatedApprovals, businessStatus) {
  const expectedStatus = ["in_approval", "approval_pending"].includes(businessStatus)
    ? "in_progress"
    : "approved";
  const expectedApprovals = relatedApprovals.filter((candidate) => candidate.status === expectedStatus);
  const approval = expectedApprovals.length === 1 ? expectedApprovals[0] : null;
  const unexpectedActiveApprovals = relatedApprovals.filter(
    (candidate) => candidate.status === "in_progress" && candidate.id !== approval?.id
  );
  const blockers = [];
  if (expectedApprovals.length !== 1) blockers.push(`当前审批实例数量应为 1，实际为 ${expectedApprovals.length}`);
  if (unexpectedActiveApprovals.length) blockers.push("除选中当前审批外仍存在活动审批实例，禁止自动过渡");
  return { expectedStatus, approval, blockers };
}

function resolveReplacementOwnerAccess({ owner, positions, memberships, projectId }) {
  const roleAssignments = [
    ...positions.filter((assignment) => assignment.projectId === null || assignment.projectId === projectId),
    ...memberships.filter((assignment) => assignment.projectId === projectId)
  ];
  return {
    roleAssignments,
    hasSettlementCreate: Boolean(owner?.isActive && roleAssignments.length)
  };
}

function createSqlStore(tx) {
  let lockedSettlementLines = new Map();

  async function loadBase(kind, ids, lock) {
    const isContract = kind === "contract_version";
    const table = isContract ? "ContractVersion" : "Settlement";
    const governanceColumn = isContract ? '"contractGovernanceVersion"' : '"governanceVersion"';
    const revisionColumn = isContract ? '"draftRevision"' : "NULL::integer";
    const eligibility = isContract ? CONTRACT_ACTIVE_STATUSES : SETTLEMENT_ACTIVE_STATUSES;
    const where = ids
      ? `"id" IN (${placeholders(ids)})`
      : `${governanceColumn} IS NULL AND "status" IN (${eligibility.map((status) => `'${status}'`).join(", ")})`;
    const settlementFields = isContract
      ? ""
      : `, "projectId", "contractId", "contractVersionId", "paymentTermsVersionId",
           "settlementTemplateVersionId", "code", "periodLabel", "isFinal",
           "finalCumulativeAmountCents", "fieldReviewerUserId", "fieldReviewerRoleKey",
           "finalScopeCompleted", "finalPriorSettlementsIncluded", "finalNoOutstandingSettlements",
           "finalWithinContractCap", "finalNoFurtherOrdinarySettlements"`;
    return tx.$queryRawUnsafe(
      `SELECT "id", "status", ${revisionColumn} AS "revision", ${governanceColumn} AS "governanceVersion", "updatedAt"${settlementFields}
       FROM "${table}" WHERE ${where}${orderedLockClause(lock)}`,
      ...(ids ?? [])
    );
  }

  async function hydrate(contractRows, settlementRows, lock) {
    const contractIds = contractRows.map((row) => row.id).sort();
    const settlementIds = settlementRows.map((row) => row.id).sort();
    const conditions = [];
    const parameters = [];
    if (contractIds.length) {
      conditions.push(`("businessType" = 'contract_version' AND "flowType" = 'contract.approve' AND "businessId" IN (${placeholders(contractIds, parameters.length + 1)}))`);
      parameters.push(...contractIds);
    }
    if (settlementIds.length) {
      conditions.push(`("businessType" = 'settlement' AND "flowType" = 'settlement.approve' AND "businessId" IN (${placeholders(settlementIds, parameters.length + 1)}))`);
      parameters.push(...settlementIds);
    }
    const approvals = conditions.length
      ? await tx.$queryRawUnsafe(
          `SELECT "id", "flowType", "businessType", "businessId", "status", "currentNodeIndex",
                  "frozenNodes", "applicantUserId", "updatedAt", "createdAt"
           FROM "ApprovalInstance" WHERE ${conditions.join(" OR ")}${orderedLockClause(lock)}`,
          ...parameters
        )
      : [];

    const approvalIds = approvals.map((row) => row.id).sort();
    const approvalApplicantIds = [...new Set(approvals.map((row) => row.applicantUserId))].sort();

    const queryRelated = async (table, parentColumn, ids, fields, where = "TRUE") => {
      if (!ids.length) return [];
      return tx.$queryRawUnsafe(
        `SELECT ${fields} FROM "${table}" WHERE "${parentColumn}" IN (${placeholders(ids)}) AND ${where}${orderedLockClause(lock)}`,
        ...ids
      );
    };
    const contractDocuments = await queryRelated(
      "ContractFormalFile", "contractVersionId", contractIds,
      '"id", "contractVersionId", "purpose", "status", "fileId", "contentSha256", "sourceRevision"', '"status" = \'active\''
    );
    const contractArchives = await queryRelated(
      "ContractArchiveFile", "contractVersionId", contractIds,
      '"id", "contractVersionId", \'archive\'::text AS "purpose", "status", "fileId", "confirmedByUserId", "confirmedAt"', '"status" <> \'voided\''
    );
    const sealTasks = await queryRelated(
      "ContractSealTask", "contractVersionId", contractIds,
      '"id", "contractVersionId", "status", "handlerUserId", "approvedByUserId", "approvedAt", "completedByUserId", "completedAt", "updatedAt"', '"status" <> \'cancelled\''
    );
    const settlementDocuments = await queryRelated(
      "SettlementSignedDocument", "settlementId", settlementIds,
      '"id", "settlementId", "purpose", "status", "fileId", "contentSha256", "sourceRevision", "businessSnapshotToken", "approvalActionSetHash", "updatedAt"', '"status" = \'active\''
    );
    const settlementArchives = await queryRelated(
      "SettlementArchiveFile", "settlementId", settlementIds,
      '"id", "settlementId", \'archive\'::text AS "purpose", "status", "fileId", "confirmedByUserId", "confirmedAt"', '"status" <> \'voided\''
    );
    const generationClaims = await queryRelated(
      "SettlementSignedDocumentGenerationClaim", "settlementId", settlementIds,
      '"id", "settlementId", "status", "sourceRevision", "originalDocumentId", "uploadedFileId", "finalDocumentId", "updatedAt"',
      '"status" IN (\'pending\', \'uploaded\')'
    );
    const quotaUsages = await queryRelated(
      "ProjectSettlementExceptionQuotaUsage", "settlementId", settlementIds,
      '"id", "settlementId", "status", "quotaId", "amountCents", "updatedAt"',
      '"status" = \'occupied\''
    );
    const approvalFormClaims = await queryRelated(
      "ApprovalFormGenerationClaim", "approvalInstanceId", approvalIds,
      '"approvalInstanceId" AS "id", "approvalInstanceId", "status", "claimToken", "uploadedFileId", "pdfDocumentId", "attemptCount", "safeFailureCode", "updatedAt"'
    );
    const ownerUsers = approvalApplicantIds.length
      ? await tx.$queryRawUnsafe(
          `SELECT "id", "isActive", "updatedAt" FROM "User"
           WHERE "id" IN (${placeholders(approvalApplicantIds)})${orderedLockClause(lock)}`,
          ...approvalApplicantIds
        )
      : [];
    const ownerUserPositions = approvalApplicantIds.length
      ? await tx.$queryRawUnsafe(
          `SELECT up."id", up."userId", up."projectId", p."key" AS "positionKey", up."createdAt"
           FROM "UserPosition" up JOIN "Position" p ON p."id" = up."positionId"
           WHERE up."userId" IN (${placeholders(approvalApplicantIds)}) AND p."key" = 'contract_staff'
           ORDER BY up."id"${lock ? " FOR UPDATE OF up" : ""}`,
          ...approvalApplicantIds
        )
      : [];
    const ownerProjectMemberships = approvalApplicantIds.length
      ? await tx.$queryRawUnsafe(
          `SELECT "id", "userId", "projectId", "positionKey", "createdAt"
           FROM "ProjectMember"
           WHERE "userId" IN (${placeholders(approvalApplicantIds)}) AND "positionKey" = 'contract_staff'
           ${orderedLockClause(lock)}`,
          ...approvalApplicantIds
        )
      : [];
    const settlementLines = await queryRelated(
      "SettlementLine", "settlementId", settlementIds,
      '"id", "settlementId", "contractBillRowId", "sourceType", "name", "unit", "quantity", "unitPriceCents", "amountCents", "reason", "remark", "sortOrder", "updatedAt"'
    );
    const referencedContractVersionIds = [...new Set(settlementRows.map((row) => row.contractVersionId))].sort();
    const settlementDrafts = await queryRelated(
      "SettlementDraft", "contractVersionId", referencedContractVersionIds,
      '"id", "contractVersionId", "periodLabel", "status", "ownerUserId", "governanceVersion", "submittedSettlementId", "updatedAt"'
    );
    if (lock) lockedSettlementLines = grouped(settlementLines, "settlementId");

    const contractPayments = contractIds.length
      ? await tx.$queryRawUnsafe(
          `SELECT cv."id" AS "businessId",
                  (SELECT count(*)::integer FROM "PaymentRequest" pr WHERE pr."contractVersionId" = cv."id") AS "requestCount",
                  (SELECT count(*)::integer FROM "PaymentExecution" pe JOIN "PaymentRequest" pr ON pr."id" = pe."paymentRequestId" WHERE pr."contractVersionId" = cv."id") AS "executionCount",
                  (SELECT count(*)::integer FROM "FinanceRecord" fr LEFT JOIN "PaymentRequest" pr ON pr."id" = fr."paymentRequestId" LEFT JOIN "Settlement" s ON s."id" = fr."settlementId" WHERE pr."contractVersionId" = cv."id" OR s."contractVersionId" = cv."id") AS "financeRecordCount",
                  ((SELECT coalesce(sum(pe."amountCents"), 0) FROM "PaymentExecution" pe JOIN "PaymentRequest" pr ON pr."id" = pe."paymentRequestId" WHERE pr."contractVersionId" = cv."id")
                    + (SELECT coalesce(sum(s."paidAmountCents"), 0) FROM "Settlement" s WHERE s."contractVersionId" = cv."id"))::text AS "paidAmountCents"
           FROM "ContractVersion" cv WHERE cv."id" IN (${placeholders(contractIds)}) ORDER BY cv."id"`,
          ...contractIds
        )
      : [];
    const settlementPayments = settlementIds.length
      ? await tx.$queryRawUnsafe(
          `SELECT s."id" AS "businessId",
                  (SELECT count(*)::integer FROM "PaymentRequest" pr WHERE pr."settlementId" = s."id") AS "requestCount",
                  (SELECT count(*)::integer FROM "PaymentExecution" pe JOIN "PaymentRequest" pr ON pr."id" = pe."paymentRequestId" WHERE pr."settlementId" = s."id") AS "executionCount",
                  (SELECT count(*)::integer FROM "FinanceRecord" fr LEFT JOIN "PaymentRequest" pr ON pr."id" = fr."paymentRequestId" WHERE fr."settlementId" = s."id" OR pr."settlementId" = s."id") AS "financeRecordCount",
                  (s."paidAmountCents" + (SELECT coalesce(sum(pe."amountCents"), 0) FROM "PaymentExecution" pe JOIN "PaymentRequest" pr ON pr."id" = pe."paymentRequestId" WHERE pr."settlementId" = s."id"))::text AS "paidAmountCents"
           FROM "Settlement" s WHERE s."id" IN (${placeholders(settlementIds)}) ORDER BY s."id"`,
          ...settlementIds
        )
      : [];

    const approvalsByBusiness = new Map();
    for (const row of approvals) {
      const key = `${row.businessType}:${row.businessId}`;
      const current = approvalsByBusiness.get(key) ?? [];
      current.push(row);
      approvalsByBusiness.set(key, current);
    }
    const approvalClaimsByApproval = grouped(approvalFormClaims, "approvalInstanceId");
    const ownerUserById = new Map(ownerUsers.map((owner) => [owner.id, owner]));
    const positionsByOwner = grouped(ownerUserPositions, "userId");
    const membershipsByOwner = grouped(ownerProjectMemberships, "userId");
    const contractDocs = grouped(contractDocuments, "contractVersionId");
    const contractArchiveRows = grouped(contractArchives, "contractVersionId");
    const contractSealRows = grouped(sealTasks, "contractVersionId");
    const settlementDocs = grouped(settlementDocuments, "settlementId");
    const settlementArchiveRows = grouped(settlementArchives, "settlementId");
    const settlementClaimRows = grouped(generationClaims, "settlementId");
    const settlementQuotaRows = grouped(quotaUsages, "settlementId");
    const settlementLineRows = grouped(settlementLines, "settlementId");
    const draftsByContractVersion = grouped(settlementDrafts, "contractVersionId");
    const paymentByBusiness = new Map([
      ...contractPayments.map((row) => [`contract_version:${row.businessId}`, row]),
      ...settlementPayments.map((row) => [`settlement:${row.businessId}`, row])
    ]);

    const mapRow = (kind, row) => {
      const relatedApprovals = (approvalsByBusiness.get(`${kind}:${row.id}`) ?? [])
        .sort((left, right) => iso(left.createdAt).localeCompare(iso(right.createdAt)) || left.id.localeCompare(right.id));
      const payment = paymentByBusiness.get(`${kind}:${row.id}`);
      const isContract = kind === "contract_version";
      const activeDocuments = isContract ? contractDocs.get(row.id) ?? [] : settlementDocs.get(row.id) ?? [];
      const archives = isContract ? contractArchiveRows.get(row.id) ?? [] : settlementArchiveRows.get(row.id) ?? [];
      const sealRows = isContract ? contractSealRows.get(row.id) ?? [] : [];
      const claimRows = isContract ? [] : settlementClaimRows.get(row.id) ?? [];
      const quotaRows = isContract ? [] : settlementQuotaRows.get(row.id) ?? [];
      const paymentFacts = {
        requestCount: toNumber(payment?.requestCount),
        executionCount: toNumber(payment?.executionCount),
        financeRecordCount: toNumber(payment?.financeRecordCount),
        paidAmountCents: toCents(payment?.paidAmountCents)
      };
      const blockers = [];
      if (paymentFacts.requestCount || paymentFacts.executionCount || paymentFacts.financeRecordCount || paymentFacts.paidAmountCents !== "0") {
        blockers.push("已存在付款、实付或入账事实，禁止自动过渡");
      }
      const approvalSelection = resolveApprovalSelection(relatedApprovals, row.status);
      blockers.push(...approvalSelection.blockers);
      const approval = approvalSelection.approval;
      const approvalClaimRows = relatedApprovals.flatMap((candidate) => approvalClaimsByApproval.get(candidate.id) ?? []);
      const existingEditableDrafts = isContract
        ? []
        : (draftsByContractVersion.get(row.contractVersionId) ?? []).filter(
            (draft) => draft.periodLabel === row.periodLabel && draft.status === "draft"
          );
      if (existingEditableDrafts.length) blockers.push("同一合同版本和结算期间已存在可编辑草稿，请先人工核查");
      const lineRows = isContract ? [] : settlementLineRows.get(row.id) ?? [];
      const replacementOwner = approval ? ownerUserById.get(approval.applicantUserId) : null;
      const ownerPositions = approval ? positionsByOwner.get(approval.applicantUserId) ?? [] : [];
      const ownerMemberships = approval ? membershipsByOwner.get(approval.applicantUserId) ?? [] : [];
      const ownerAccess = isContract
        ? { roleAssignments: [], hasSettlementCreate: false }
        : resolveReplacementOwnerAccess({
            owner: replacementOwner,
            positions: ownerPositions,
            memberships: ownerMemberships,
            projectId: row.projectId
          });
      const ownerRoleAssignments = ownerAccess.roleAssignments;
      const ownerHasSettlementCreate = ownerAccess.hasSettlementCreate;
      if (!isContract && approval && !replacementOwner?.isActive) blockers.push("原申请人不存在或已停用，不能接收替代结算草稿");
      if (!isContract && approval && replacementOwner?.isActive && !ownerHasSettlementCreate) {
        blockers.push("原申请人当前不具备该项目的结算编制权限，不能接收替代结算草稿");
      }
      return {
        kind,
        businessId: row.id,
        status: row.status,
        revision: row.revision === null ? null : toNumber(row.revision),
        updatedAt: iso(row.updatedAt),
        governanceVersion: row.governanceVersion,
        ...(isContract ? {} : {
          projectId: row.projectId,
          contractId: row.contractId,
          contractVersionId: row.contractVersionId,
          paymentTermsVersionId: row.paymentTermsVersionId,
          settlementTemplateVersionId: row.settlementTemplateVersionId,
          code: row.code,
          periodLabel: row.periodLabel,
          isFinal: row.isFinal,
          finalCumulativeAmountCents: row.finalCumulativeAmountCents === null ? null : toCents(row.finalCumulativeAmountCents),
          fieldReviewerUserId: row.fieldReviewerUserId,
          fieldReviewerRoleKey: row.fieldReviewerRoleKey,
          finalScopeCompleted: row.finalScopeCompleted,
          finalPriorSettlementsIncluded: row.finalPriorSettlementsIncluded,
          finalNoOutstandingSettlements: row.finalNoOutstandingSettlements,
          finalWithinContractCap: row.finalWithinContractCap,
          finalNoFurtherOrdinarySettlements: row.finalNoFurtherOrdinarySettlements
        }),
        approvalInstanceState: relatedApprovals.map((candidate) => ({
          id: candidate.id,
          status: candidate.status,
          currentNodeIndex: toNumber(candidate.currentNodeIndex),
          updatedAt: iso(candidate.updatedAt),
          stateDigest: stateDigest([
            candidate.flowType,
            candidate.status,
            candidate.currentNodeIndex,
            candidate.frozenNodes,
            candidate.applicantUserId
          ])
        })),
        approvalInstance: approval
          ? {
              id: approval.id,
              status: approval.status,
              currentNodeIndex: toNumber(approval.currentNodeIndex),
              applicantUserId: approval.applicantUserId,
              updatedAt: iso(approval.updatedAt),
              stateDigest: stateDigest([
                approval.flowType,
                approval.status,
                approval.currentNodeIndex,
                approval.frozenNodes,
                approval.applicantUserId
              ])
            }
          : null,
        approvalFormClaimState: approvalClaimRows.map((claim) => ({
          id: claim.id,
          status: claim.status,
          stateDigest: stateDigest([
            claim.claimToken,
            claim.uploadedFileId,
            claim.pdfDocumentId,
            claim.attemptCount,
            claim.safeFailureCode,
            iso(claim.updatedAt)
          ])
        })),
        ...(!isContract ? {
          replacementDraftOwnerState: approval
            ? {
                userId: approval.applicantUserId,
                isActive: Boolean(replacementOwner?.isActive),
                hasSettlementCreate: ownerHasSettlementCreate,
                stateDigest: stateDigest([
                  replacementOwner ? iso(replacementOwner.updatedAt) : null,
                  ownerRoleAssignments.map((assignment) => [
                    assignment.id,
                    assignment.projectId,
                    assignment.positionKey,
                    iso(assignment.createdAt)
                  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))
                ])
              }
            : null
        } : {}),
        activeDocumentState: activeDocuments.map((document) => ({
          id: document.id,
          purpose: document.purpose,
          status: document.status,
          stateDigest: stateDigest([
            document.fileId,
            document.contentSha256,
            document.sourceRevision,
            document.businessSnapshotToken,
            document.approvalActionSetHash,
            document.updatedAt ? iso(document.updatedAt) : null
          ])
        })),
        archiveState: archives.map((archive) => ({
          id: archive.id,
          status: archive.status,
          stateDigest: stateDigest([
            archive.fileId,
            archive.confirmedByUserId,
            archive.confirmedAt ? iso(archive.confirmedAt) : null
          ])
        })),
        sealTaskState: sealRows.map((task) => ({
          id: task.id,
          status: task.status,
          stateDigest: stateDigest([
            task.handlerUserId,
            task.approvedByUserId,
            task.approvedAt ? iso(task.approvedAt) : null,
            task.completedByUserId,
            task.completedAt ? iso(task.completedAt) : null,
            task.updatedAt ? iso(task.updatedAt) : null
          ])
        })),
        generationClaimState: claimRows.map((claim) => ({
          id: claim.id,
          status: claim.status,
          stateDigest: stateDigest([
            claim.sourceRevision,
            claim.originalDocumentId,
            claim.uploadedFileId,
            claim.finalDocumentId,
            iso(claim.updatedAt)
          ])
        })),
        quotaUsageState: quotaRows.map((usage) => ({
          id: usage.id,
          status: usage.status,
          stateDigest: stateDigest([usage.quotaId, toCents(usage.amountCents), iso(usage.updatedAt)])
        })),
        settlementLineState: lineRows.map((line) => ({
          id: line.id,
          stateDigest: stateDigest([
            line.contractBillRowId,
            line.sourceType,
            line.name,
            line.unit,
            line.quantity === null ? null : String(line.quantity),
            line.unitPriceCents === null ? null : toCents(line.unitPriceCents),
            toCents(line.amountCents),
            line.reason,
            line.remark,
            line.sortOrder,
            iso(line.updatedAt)
          ])
        })),
        existingDraftState: existingEditableDrafts.map((draft) => ({
          id: draft.id,
          status: draft.status,
          stateDigest: stateDigest([
            draft.ownerUserId,
            draft.governanceVersion,
            draft.submittedSettlementId,
            iso(draft.updatedAt)
          ])
        })),
        paymentFacts,
        blockers,
        suggestedAction: isContract
          ? "终止旧审批并退回合同草稿补充治理资料后重提"
          : "终止旧结算流程并生成可编辑的治理草稿，由原申请人补充治理资料后重提"
      };
    };
    return [
      ...contractRows.map((row) => mapRow("contract_version", row)),
      ...settlementRows.map((row) => mapRow("settlement", row))
    ].sort((left, right) => `${left.kind}:${left.businessId}`.localeCompare(`${right.kind}:${right.businessId}`));
  }

  function processedEvidence(item) {
    const categories = {
      approvalInstances: item.approvalInstance ? [item.approvalInstance.id] : [],
      approvalFormClaims: (item.approvalFormClaimState ?? [])
        .filter((row) => row.id === item.approvalInstance?.id && ["pending", "uploaded"].includes(row.status))
        .map((row) => row.id),
      formalDocuments: (item.activeDocumentState ?? []).map((row) => row.id),
      archiveFiles: (item.archiveState ?? []).map((row) => row.id),
      sealTasks: (item.sealTaskState ?? []).map((row) => row.id),
      generationClaims: (item.generationClaimState ?? []).map((row) => row.id),
      quotaUsages: (item.quotaUsageState ?? []).map((row) => row.id),
      settlementLines: (item.settlementLineState ?? []).map((row) => row.id)
    };
    return {
      processedCounts: Object.fromEntries(Object.entries(categories).map(([key, ids]) => [key, ids.length])),
      processedIdDigests: Object.fromEntries(Object.entries(categories).map(([key, ids]) => [
        key,
        stateDigest([...ids].sort())
      ]))
    };
  }

  function draftLinesForSettlement(settlementId) {
    return (lockedSettlementLines.get(settlementId) ?? [])
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .map((line) => ({
        sourceType: line.sourceType,
        ...(line.contractBillRowId ? { contractBillRowId: line.contractBillRowId } : {}),
        name: line.name,
        ...(line.unit !== null ? { unit: line.unit } : {}),
        ...(line.quantity !== null ? { quantity: String(line.quantity) } : {}),
        ...(line.unitPriceCents !== null ? { unitPriceCents: toCents(line.unitPriceCents) } : {}),
        amountCents: toCents(line.amountCents),
        ...(line.reason !== null ? { reason: line.reason } : {}),
        ...(line.remark !== null ? { remark: line.remark } : {}),
        sortOrder: toNumber(line.sortOrder)
      }));
  }

  return {
    async loadPreviewItems() {
      const contracts = await loadBase("contract_version", null, false);
      const settlements = await loadBase("settlement", null, false);
      return hydrate(contracts, settlements, false);
    },

    async lockAndLoad(items) {
      const contractIds = items.filter((item) => item.kind === "contract_version").map((item) => item.businessId).sort();
      const settlementIds = items.filter((item) => item.kind === "settlement").map((item) => item.businessId).sort();
      const referencedVersionIds = [...new Set(items
        .filter((item) => item.kind === "settlement")
        .map((item) => item.contractVersionId))].sort();
      const allVersionIds = [...new Set([...contractIds, ...referencedVersionIds])].sort();
      if (allVersionIds.length) {
        await tx.$queryRawUnsafe(
          `SELECT "id" FROM "ContractVersion" WHERE "id" IN (${placeholders(allVersionIds)}) ORDER BY "id" FOR UPDATE`,
          ...allVersionIds
        );
      }
      const contracts = contractIds.length ? await loadBase("contract_version", contractIds, false) : [];
      const settlements = settlementIds.length ? await loadBase("settlement", settlementIds, true) : [];
      return hydrate(contracts, settlements, true);
    },

    async assertActiveOperator(operatorUserId) {
      const rows = await tx.$queryRawUnsafe(
        'SELECT "id" FROM "User" WHERE "id" = $1 AND "isActive" = TRUE FOR UPDATE',
        operatorUserId
      );
      invariant(rows.length === 1, "操作者不存在或已停用，禁止执行过渡");
      const roles = await tx.$queryRawUnsafe(
        `SELECT up."id" FROM "UserPosition" up
         JOIN "Position" p ON p."id" = up."positionId"
         WHERE up."userId" = $1 AND up."projectId" IS NULL AND p."key" = 'super_admin'
         ORDER BY up."id" FOR UPDATE OF up`,
        operatorUserId
      );
      invariant(roles.length === 1, "只有全局超级管理员可以执行治理过渡");
    },

    async findProcessedIdentities(digest, items) {
      if (!items.length) return [];
      const sorted = [...items].sort((left, right) =>
        `${left.kind}:${left.businessId}`.localeCompare(`${right.kind}:${right.businessId}`)
      );
      const conditions = sorted.map((_, index) =>
        `("businessType" = $${index * 2 + 1} AND "businessId" = $${index * 2 + 2})`
      );
      const parameters = sorted.flatMap((item) => [item.kind, item.businessId]);
      const rows = await tx.$queryRawUnsafe(
        `SELECT DISTINCT "businessType", "businessId" FROM "AuditLog"
         WHERE "action" = 'governance.transition.terminated'
           AND (${conditions.join(" OR ")})
           AND "metadata"->>'manifestDigest' = $${parameters.length + 1}
         ORDER BY "businessType", "businessId"`,
        ...parameters,
        digest
      );
      return rows.map((row) => `${row.businessType}:${row.businessId}`);
    },

    async findProcessedSettlementReplacements(digest, items) {
      const settlementIds = items
        .filter((item) => item.kind === "settlement")
        .map((item) => item.businessId)
        .sort();
      if (!settlementIds.length) return [];
      const rows = await tx.$queryRawUnsafe(
        `SELECT "businessId" AS "sourceSettlementId", "metadata"->>'replacementDraftId' AS "replacementDraftId"
         FROM "AuditLog"
         WHERE "action" = 'governance.transition.terminated'
           AND "businessType" = 'settlement'
           AND "businessId" IN (${placeholders(settlementIds)})
           AND "metadata"->>'manifestDigest' = $${settlementIds.length + 1}
         ORDER BY "businessId"`,
        ...settlementIds,
        digest
      );
      invariant(rows.every((row) => row.replacementDraftId), "已处理结算缺少替代草稿审计关联");
      return rows;
    },

    async applyContract(item, context) {
      const evidence = processedEvidence(item);
      const metadata = JSON.stringify({
        tag: "governance.transition.terminated",
        manifestDigest: context.manifestDigest,
        candidateSha: context.candidateSha,
        reason: TERMINATION_REASON,
        fromStatus: item.status,
        toStatus: "draft",
        ...evidence
      });
      await tx.$executeRawUnsafe(
        `UPDATE "ContractVersion" SET "status" = 'draft', "draftRevision" = "draftRevision" + 1,
           "contractGovernanceVersion" = 1, "readinessSnapshot" = NULL,
           "taxFactStatus" = 'draft', "taxFactsFrozenAt" = NULL, "updatedAt" = $2
         WHERE "id" = $1`,
        item.businessId,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ApprovalInstance" SET "status" = 'governance_transition_terminated', "updatedAt" = $2 WHERE "id" = $1`,
        item.approvalInstance.id,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ApprovalFormGenerationClaim" SET "status" = 'failed',
           "safeFailureCode" = 'finalize_retry_required', "updatedAt" = $2
         WHERE "approvalInstanceId" = $1 AND "status" IN ('pending', 'uploaded')`,
        item.approvalInstance.id,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ContractFormalFile" SET "status" = 'invalidated', "invalidatedAt" = $2, "invalidationReason" = $3
         WHERE "contractVersionId" = $1 AND "status" = 'active'`,
        item.businessId,
        context.now,
        TERMINATION_REASON
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ContractArchiveFile" SET "status" = 'voided' WHERE "contractVersionId" = $1 AND "status" <> 'voided'`,
        item.businessId
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ContractSealTask" SET "status" = 'cancelled', "cancelledByUserId" = $2,
           "cancelledAt" = $3, "cancellationReason" = $4, "updatedAt" = $3
         WHERE "contractVersionId" = $1 AND "status" <> 'cancelled'`,
        item.businessId,
        context.operatorUserId,
        context.now,
        TERMINATION_REASON
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "ApprovalActionLog" ("id", "approvalInstanceId", "action", "actorUserId", "comment", "metadata", "createdAt")
         VALUES (gen_random_uuid(), $1, 'governance_transition_terminated', $2, $3, $4::jsonb, $5)`,
        item.approvalInstance.id,
        context.operatorUserId,
        TERMINATION_REASON,
        metadata,
        context.now
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "AuditLog" ("id", "actorUserId", "action", "businessType", "businessId", "metadata", "createdAt")
         VALUES (gen_random_uuid(), $1, 'governance.transition.terminated', 'contract_version', $2, $3::jsonb, $4)`,
        context.operatorUserId,
        item.businessId,
        metadata,
        context.now
      );
    },

    async applySettlement(item, context) {
      const replacementDraftId = crypto.randomUUID();
      const replacementLines = draftLinesForSettlement(item.businessId);
      invariant(
        replacementLines.length === (item.settlementLineState ?? []).length,
        "结算明细锁定结果与 manifest 不一致，整批取消"
      );
      const evidence = processedEvidence(item);
      const metadata = JSON.stringify({
        tag: "governance.transition.terminated",
        manifestDigest: context.manifestDigest,
        candidateSha: context.candidateSha,
        reason: TERMINATION_REASON,
        fromStatus: item.status,
        toStatus: "withdrawn",
        sourceSettlementId: item.businessId,
        replacementDraftId,
        nextAction: "打开系统生成的治理草稿，补充治理资料后重新提交",
        ...evidence
      });
      const replacementDraftMetadata = JSON.stringify({
        tag: "governance.transition.replacement_draft_created",
        manifestDigest: context.manifestDigest,
        candidateSha: context.candidateSha,
        reason: TERMINATION_REASON,
        sourceSettlementId: item.businessId,
        replacementDraftId,
        ownerUserId: item.approvalInstance.applicantUserId,
        ...evidence
      });
      await tx.$executeRawUnsafe(
        `UPDATE "Settlement" SET "status" = 'withdrawn', "updatedAt" = $2 WHERE "id" = $1`,
        item.businessId,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ApprovalInstance" SET "status" = 'governance_transition_terminated', "updatedAt" = $2 WHERE "id" = $1`,
        item.approvalInstance.id,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ApprovalFormGenerationClaim" SET "status" = 'failed',
           "safeFailureCode" = 'finalize_retry_required', "updatedAt" = $2
         WHERE "approvalInstanceId" = $1 AND "status" IN ('pending', 'uploaded')`,
        item.approvalInstance.id,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "SettlementSignedDocument" SET "status" = 'invalidated', "invalidatedAt" = $2,
           "invalidationReason" = $3, "updatedAt" = $2 WHERE "settlementId" = $1 AND "status" = 'active'`,
        item.businessId,
        context.now,
        TERMINATION_REASON
      );
      await tx.$executeRawUnsafe(
        `UPDATE "SettlementSignedDocumentGenerationClaim" SET "status" = 'failed',
           "safeFailureCode" = 'facts_changed', "updatedAt" = $2
         WHERE "settlementId" = $1 AND "status" IN ('pending', 'uploaded')`,
        item.businessId,
        context.now
      );
      await tx.$executeRawUnsafe(
        `UPDATE "SettlementArchiveFile" SET "status" = 'voided' WHERE "settlementId" = $1 AND "status" <> 'voided'`,
        item.businessId
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ProjectSettlementExceptionQuotaUsage" SET "status" = 'released', "updatedAt" = $2
         WHERE "settlementId" = $1 AND "status" = 'occupied'`,
        item.businessId,
        context.now
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "SettlementDraft" (
           "id", "projectId", "contractId", "contractVersionId", "paymentTermsVersionId",
           "settlementTemplateVersionId", "code", "periodLabel", "isFinal",
           "finalCumulativeAmountCents", "lines", "revision", "status", "ownerUserId",
           "governanceVersion", "fieldReviewerUserId", "fieldReviewerRoleKey",
           "finalScopeCompleted", "finalPriorSettlementsIncluded", "finalNoOutstandingSettlements",
           "finalWithinContractCap", "finalNoFurtherOrdinarySettlements", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 1, 'draft', $12,
           1, $13, $14, $15, $16, $17, $18, $19, $20, $20
         )`,
        replacementDraftId,
        item.projectId,
        item.contractId,
        item.contractVersionId,
        item.paymentTermsVersionId,
        item.settlementTemplateVersionId,
        `${item.code}-治理重提-${item.businessId.slice(0, 8)}`,
        item.periodLabel,
        item.isFinal,
        item.finalCumulativeAmountCents,
        JSON.stringify(replacementLines),
        item.approvalInstance.applicantUserId,
        item.fieldReviewerUserId,
        item.fieldReviewerRoleKey,
        item.finalScopeCompleted,
        item.finalPriorSettlementsIncluded,
        item.finalNoOutstandingSettlements,
        item.finalWithinContractCap,
        item.finalNoFurtherOrdinarySettlements,
        context.now
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "ApprovalActionLog" ("id", "approvalInstanceId", "action", "actorUserId", "comment", "metadata", "createdAt")
         VALUES (gen_random_uuid(), $1, 'governance_transition_terminated', $2, $3, $4::jsonb, $5)`,
        item.approvalInstance.id,
        context.operatorUserId,
        TERMINATION_REASON,
        metadata,
        context.now
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "AuditLog" ("id", "actorUserId", "action", "businessType", "businessId", "metadata", "createdAt")
         VALUES (gen_random_uuid(), $1, 'governance.transition.terminated', 'settlement', $2, $3::jsonb, $4)`,
        context.operatorUserId,
        item.businessId,
        metadata,
        context.now
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "AuditLog" ("id", "actorUserId", "action", "businessType", "businessId", "metadata", "createdAt")
         VALUES (gen_random_uuid(), $1, 'governance.transition.replacement_draft_created', 'settlement_draft', $2, $3::jsonb, $4)`,
        context.operatorUserId,
        replacementDraftId,
        replacementDraftMetadata,
        context.now
      );
      return { sourceSettlementId: item.businessId, replacementDraftId };
    }
  };
}

async function previewManifest({
  prisma,
  candidateSha,
  now = new Date(),
  includes = [],
  createStore = createSqlStore
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const items = await createStore(tx).loadPreviewItems();
    return createManifest(items, candidateSha, now, { includes });
  });
}

function comparableItems(items) {
  return JSON.stringify(canonicalize([...items].sort((left, right) =>
    `${left.kind}:${left.businessId}`.localeCompare(`${right.kind}:${right.businessId}`)
  )));
}

async function executeTransition({ store, manifest, operatorUserId, now = new Date() }) {
  verifyManifestIntegrity(manifest);
  const items = manifest.items;
  const identities = new Set(items.map((item) => `${item.kind}:${item.businessId}`));
  invariant(identities.size === items.length, "manifest 包含重复业务实例");
  invariant(items.every((item) => item.kind === "contract_version" || item.kind === "settlement"), "manifest 包含不支持的业务类型");
  invariant(items.every((item) => item.governanceVersion === null), "manifest 只能包含旧治理实例");
  invariant(items.every((item) => item.approvalInstance?.id), "manifest 存在无审批实例的阻断项，禁止 apply");
  invariant(items.every((item) => !(item.blockers?.length)), "manifest 存在阻断项，禁止 apply");
  invariant(items.every((item) =>
    item.paymentFacts.requestCount === 0 &&
    item.paymentFacts.executionCount === 0 &&
    item.paymentFacts.financeRecordCount === 0 &&
    item.paymentFacts.paidAmountCents === "0"
  ), "manifest 存在付款、实付或入账事实，禁止 apply");

  const currentItems = await store.lockAndLoad(items);
  const processed = await store.findProcessedIdentities(manifest.digest, items);
  if (processed.length === items.length) {
    const settlementReplacements = store.findProcessedSettlementReplacements
      ? await store.findProcessedSettlementReplacements(manifest.digest, items)
      : [];
    return {
      applied: 0,
      alreadyProcessed: items.length,
      manifestDigest: manifest.digest,
      settlementReplacements
    };
  }
  invariant(processed.length === 0, "manifest 只完成了部分实例，禁止重复执行，请人工核查审计记录");
  invariant(currentItems.length === items.length, "manifest 实例已删除或不完整，状态发生漂移");
  invariant(comparableItems(currentItems) === comparableItems(items), "manifest 生成后实例状态、版本、审批或正式文件已发生漂移，整批取消");

  const context = {
    operatorUserId,
    now,
    manifestDigest: manifest.digest,
    candidateSha: manifest.candidateSha
  };
  const settlementReplacements = [];
  for (const item of items) {
    if (item.kind === "contract_version") await store.applyContract(item, context);
    else {
      const replacement = await store.applySettlement(item, context);
      if (replacement) settlementReplacements.push(replacement);
    }
  }
  return {
    applied: items.length,
    alreadyProcessed: 0,
    manifestDigest: manifest.digest,
    settlementReplacements
  };
}

function currentGitState() {
  const options = {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8"
  };
  return {
    sha: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
    clean: execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], options).trim() === ""
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "用法：\n" +
      "  只读预览：node transition-contract-settlement-governance.cjs [--candidate-sha <40位SHA>] [--include <kind:id>] [--manifest <新文件>]\n" +
      `  正式执行：node transition-contract-settlement-governance.cjs --apply --manifest <文件> --candidate-sha <40位SHA> --operator-user-id <UUID> --confirm ${APPLY_CONFIRMATION}\n`
    );
    return;
  }
  const gitState = currentGitState();
  const sha = gitState.sha;
  const prisma = new PrismaClient();
  try {
    if (!args.apply) {
      invariant(gitState.clean, "当前 Git 工作区不是洁净候选，禁止生成正式过渡 manifest");
      if (args.candidateSha) invariant(args.candidateSha === sha, "预览候选 SHA 与当前执行代码 SHA 不一致");
      const manifest = await previewManifest({ prisma, candidateSha: sha, includes: args.includes });
      const output = `${JSON.stringify(manifest, null, 2)}\n`;
      if (args.manifestPath) {
        fs.writeFileSync(path.resolve(args.manifestPath), output, { encoding: "utf8", mode: 0o600, flag: "wx" });
        process.stdout.write(JSON.stringify({
          mode: "preview",
          manifestPath: path.resolve(args.manifestPath),
          itemCount: manifest.itemCount,
          blockedCount: manifest.blockedCount,
          digest: manifest.digest
        }) + "\n");
      } else {
        process.stdout.write(output);
      }
      return;
    }

    invariant(args.manifestPath, "apply 必须提供 manifest 文件");
    const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifestPath), "utf8"));
    assertApplyGates({ args, manifest, currentSha: sha, checkoutClean: gitState.clean });
    const result = await prisma.$transaction(async (tx) => {
      const store = createSqlStore(tx);
      await store.assertActiveOperator(args.operatorUserId);
      return executeTransition({ store, manifest, operatorUserId: args.operatorUserId });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
    process.stdout.write(JSON.stringify({ mode: "apply", ...result }) + "\n");
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  APPLY_CONFIRMATION,
  parseArgs,
  createManifest,
  verifyManifestIntegrity,
  assertApplyGates,
  previewManifest,
  executeTransition,
  createSqlStore,
  resolveApprovalSelection,
  resolveReplacementOwnerAccess
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`合同结算治理过渡失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
