import type { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
// Read-only adapters for existing domain state machines; never creates or advances a workflow.
type Db = Prisma.TransactionClient;
type Row = Record<string, unknown>;
type Model = {
  findUnique(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Row[]>;
};
export interface IndependentReviewNode {
  name: string;
  roleKeys: RoleKey[];
  scope: "project" | "global" | "global_or_project";
  selectedUserIds?: string[];
  excludeUserIds?: string[];
  mode?: "any" | "all";
  status: "已通过" | "处理中" | "未开始" | "已驳回" | "未执行";
}
export interface IndependentReviewSubject {
  id: string;
  kind: string;
  title: string;
  businessCode: string;
  projectId: string | null;
  applicantUserId: string;
  applicantName?: string;
  requiresActiveProject?: boolean;
  participantIds: string[];
  createdAt: Date;
  updatedAt: Date;
  status: "in_progress" | "approved" | "rejected" | "cancelled";
  currentNodeIndex: number;
  nodes: IndependentReviewNode[];
  history: Array<{
    actorUserId: string;
    action: string;
    comment: string | null;
    createdAt: Date;
  }>;
  lockTargets: Array<{
    table: string;
    id: string;
  }>;
}
export interface IndependentReviewSource {
  kind: string;
  title: string;
  listIds(db: Db, cursor?: string, take?: number): Promise<string[]>;
  load(db: Db, id: string): Promise<IndependentReviewSubject | null>;
}
const model = (db: Db, name: string) => (db as unknown as Record<string, Model>)[name];
const get = (db: Db, name: string, id: string) => model(db, name).findUnique({ where: { id } });
const many = (db: Db, name: string, where: Row) => model(db, name).findMany({ where, orderBy: { createdAt: "asc" } });
const str = (row: Row, key: string) => typeof row[key] === "string" ? row[key] as string : "";
const date = (row: Row, key: string): Date | null => row[key] instanceof Date ? row[key] as Date : null;
const people = (...ids: Array<string | null | undefined>) => [...new Set(ids.filter((id): id is string => Boolean(id)))];
const newest = (row: Row) => ["updatedAt", "reviewedAt", "confirmedAt", "approvedAt", "createdAt"].map(k => date(row, k)).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(0);
function event(row: Row, actor: string, at: string, action: string, comment?: string) {
  const actorUserId = str(row, actor);
  const createdAt = date(row, at);
  return actorUserId && createdAt ? [{ actorUserId, action, createdAt, comment: comment ? str(row, comment) || null : null }] : [];
}
async function auditHistory(db: Db, businessType: string, businessId: string, actions: Record<string, string>) {
  const rows = await many(db, "auditLog", { businessType, businessId, action: { in: Object.keys(actions) } });
  return rows.filter(row => str(row, "businessType") === businessType && str(row, "businessId") === businessId && Object.hasOwn(actions, str(row, "action"))).flatMap(row => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Row : {};
    return event({ ...row, auditComment: str(metadata, "comment") || str(metadata, "reason") }, "actorUserId", "createdAt", actions[str(row, "action")], "auditComment");
  });
}
function mergeHistory(stored: IndependentReviewSubject["history"], audited: IndependentReviewSubject["history"]) {
  return [...stored.filter(event => !audited.some(audit => audit.actorUserId === event.actorUserId && audit.action === event.action)), ...audited].sort((a,b) => a.createdAt.getTime()-b.createdAt.getTime());
}
function one(row: Row, source: {
  kind: string;
  title: string;
  table: string;
}, input: {
  projectId: string | null;
  applicant: string;
  code: string;
  roles: RoleKey[];
  scope?: "project" | "global" | "global_or_project";
  pending: boolean;
  approved: boolean;
  cancelled?: boolean;
  participants?: string[];
  history?: IndependentReviewSubject["history"];
  exclude?: string[];
}): IndependentReviewSubject {
  const cancelled = Boolean(input.cancelled) || ["cancelled", "voided", "abandoned", "reversed", "stopped", "revoked", "invalidated"].includes(str(row, "status"));
  const rejected = ["rejected", "returned", "needs_supplement", "disputed"].includes(str(row, "status")) || str(row, "takeoverStatus") === "needs_supplement";
  // A pending record blocked by stale coordinates is still waiting, never fabricated as rejected.
  const status = cancelled ? "cancelled" : input.pending ? "in_progress" : input.approved ? "approved" : rejected ? "rejected" : "in_progress";
  return {
    id: str(row, "id"), kind: source.kind, title: source.title, businessCode: input.code,
    projectId: input.projectId, applicantUserId: input.applicant, participantIds: people(input.applicant, ...(input.participants ?? [])),
    createdAt: date(row, "createdAt") ?? newest(row), updatedAt: newest(row), status, currentNodeIndex: status === "approved" ? 1 : 0,
    nodes: [
      {
        name: source.title, roleKeys: input.roles, scope: input.scope ?? "global_or_project", excludeUserIds: input.exclude,
        status: status === "cancelled" ? "未执行" : input.pending ? "处理中" : input.approved ? "已通过" : rejected ? "已驳回" : "未开始"
      }
    ],
    history: input.history ?? [], lockTargets: [{ table: source.table, id: str(row, "id") }]
  };
}
function source(kind: string, title: string, modelName: string, where: Row, loadRow: (db: Db, row: Row, identity: {
  kind: string;
  title: string;
  table: string;
}) => Promise<IndependentReviewSubject | null>): IndependentReviewSource {
  const identity = { kind, title, table: modelName[0].toUpperCase() + modelName.slice(1) };
  return {
    kind, title,
    async listIds(db, cursor, take = 100) {
      const rows = await model(db, modelName).findMany({
        where, select: { id: true }, orderBy: { id: "asc" }, take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      return rows.map(row => str(row, "id"));
    },
    async load(db, id) { const row = await get(db, modelName, id); return row ? loadRow(db, row, identity) : null; }
  };
}
async function contractContext(db: Db, versionId: string) {
  const version = await get(db, "contractVersion", versionId);
  const contract = version ? await get(db, "contract", str(version, "contractId")) : null;
  if (!version || !contract)
    return null;
  const approvals = await many(db, "approvalInstance", { businessType: "contract_version", businessId: versionId });
  return {
    version, contract, applicant: str(approvals[approvals.length - 1] ?? {}, "applicantUserId") || str(contract, "ownerUserId")
  };
}
const contractArchiveStates = ["seal_approved_pending_archive", "pending_archive_confirm", "effective", "superseded", "terminated", "closed"];
const contractPostApprovalStates = ["approved_pending_seal", "in_seal", "seal_approved_pending_archive", ...contractArchiveStates];
const seal = source("contract_seal", "用章审批", "contractVersion", { status: { in: contractPostApprovalStates } }, async (db, row, identity) => {
  if (!contractPostApprovalStates.includes(str(row, "status")))
    return null;
  const context = await contractContext(db, str(row, "id"));
  if (!context)
    return null;
  const tasks = await many(db, "contractSealTask", { contractVersionId: str(row, "id") });
  const task = tasks.filter(t => str(t, "status") !== "cancelled").at(-1);
  const governed = row.contractGovernanceVersion === 1;
  if (governed && !task)
    return null;
  const sealHistory = await auditHistory(db, "contract_version", str(row, "id"), { "contract.seal.approve": "同意用章" });
  const pending = str(row, "status") === "approved_pending_seal" && (!task || str(task, "status") === "pending_approval");
  const result = one(row, identity, {
    projectId: str(context.contract, "projectId"), applicant: context.applicant, code: str(context.contract, "code") || str(context.contract, "name") || "历史合同",
    roles: ["comprehensive_director"], scope: governed ? "global" : "global_or_project", pending, approved: str(row, "status") !== "approved_pending_seal",
    participants: task ? people(str(task, "handlerUserId"), str(task, "approvedByUserId"), str(task, "completedByUserId")) : [],
    history: mergeHistory(task ? event(task, "approvedByUserId", "approvedAt", "同意用章") : [], sealHistory)
  });
  if (task)
    result.lockTargets.push({ table: "ContractSealTask", id: str(task, "id") });
  return result;
});
const contractArchive = source("contract_archive", "合同归档确认", "contractVersion", { status: { in: contractArchiveStates } }, async (db, row, identity) => {
  if (!contractArchiveStates.includes(str(row, "status")))
    return null;
  const c = await contractContext(db, str(row, "id"));
  if (!c)
    return null;
  const governed = row.contractGovernanceVersion === 1;
  const records = await many(db, governed ? "contractFormalFile" : "contractArchiveFile", { contractVersionId: str(row, "id"), ...(governed ? { purpose: "mutually_signed_final" } : {}) });
  const history = mergeHistory(records.flatMap(r => event(r, "confirmedByUserId", "confirmedAt", "归档确认")), await auditHistory(db, "contract_version", str(row, "id"), { "contract.archive.confirm": "归档确认", "contract.formal_file.return_correction": "归档退回补正" }));
  if(str(row,"status")==="seal_approved_pending_archive"&&!records.length&&!history.length)return null;
  const tasks = governed ? await many(db, "contractSealTask", { contractVersionId: str(row, "id"), status: { not: "cancelled" } }) : [];
  const task = tasks.at(-1);
  const finalFile = records.find(record => str(record, "status") === "active");
  const ready = governed ? Boolean(task) && str(task!, "status") === "completed" && Boolean(finalFile) : records.some(r => str(r, "status") === "pending_confirm");
  const excluded = governed && finalFile && str(finalFile, "uploadedByUserId") !== str(task ?? {}, "handlerUserId") ? people(str(finalFile, "uploadedByUserId")) : [];
  return one(row, identity, {
    projectId: str(c.contract, "projectId"), applicant: c.applicant, code: str(c.contract, "code") || str(c.contract, "name") || "历史合同", roles: ["contract_director"], scope: governed ? "global" : "global_or_project", exclude: excluded, pending: str(row, "status") === "pending_archive_confirm" && ready, approved: !["pending_archive_confirm", "seal_approved_pending_archive"].includes(str(row, "status")), participants: records.flatMap(r => people(str(r, "uploadedByUserId"), str(r, "confirmedByUserId"))), history
  });
});
const settlementArchive = source("settlement_archive", "结算归档确认", "settlement", { status: { in: ["pending_archive_confirm", "effective", "partially_paid", "paid"] } }, async (db, row, identity) => {
  if (!["pending_archive_confirm", "effective", "partially_paid", "paid"].includes(str(row, "status")))
    return null;
  const approvals = await many(db, "approvalInstance", { businessType: "settlement", businessId: str(row, "id") });
  const records = await many(db, "settlementArchiveFile", { settlementId: str(row, "id") });
  const signed = await many(db, "settlementSignedDocument", { settlementId: str(row, "id"), purpose: "final_internal_signed_copy", status: "active" });
  const ready = row.governanceVersion === 1 ? signed.length > 0 : records.some(r => str(r, "status") === "pending_confirm");
  const all = [...records, ...signed];
  return one(row, identity, {
    projectId: str(row, "projectId"), applicant: str(row, "preparedByUserId") || str(approvals.at(-1) ?? {}, "applicantUserId"), code: str(row, "code") || "结算单", roles: ["contract_director"], pending: str(row, "status") === "pending_archive_confirm" && ready, approved: str(row, "status") !== "pending_archive_confirm", participants: all.flatMap(r => people(str(r, "uploadedByUserId"), str(r, "confirmedByUserId"))), history: all.flatMap(r => event(r, "confirmedByUserId", "confirmedAt", "归档确认"))
  });
});
const receipt = source("receipt_review", "收货复核", "spotProcurementReceipt", { firstSubmittedAt: { not: null } }, async (db, row, identity) => {
  if (!date(row, "firstSubmittedAt") && !date(row, "submittedAt"))
    return null;
  const procurement = await get(db, "spotProcurement", str(row, "procurementId"));
  if (!procurement)
    return null;
  const reviews = await many(db, "spotProcurementReceiptReview", { receiptId: str(row, "id") });
  const version = await get(db, "spotProcurementVersion", str(row, "procurementVersionId"));
  const revisions = await many(db, "spotProcurementReceiptRevision", { receiptId: str(row, "id"), revisionNo: row.currentRevisionNo });
  const revision = revisions[0];
  const active = str(procurement, "status") === "approved_in_progress" && Boolean(version) && str(version!, "status") === "approved" && str(procurement, "currentVersionId") === str(row, "procurementVersionId") && Boolean(revision) && str(revision!, "procurementVersionId") === str(row, "procurementVersionId") && str(procurement, "handlerUserId") === str(row, "handlerUserId") && str(version!, "handlerUserId") === str(row, "handlerUserId") && str(revision!, "handlerUserId") === str(row, "handlerUserId") && Boolean(date(revision!, "submittedAt"));
  const result = one(row, identity, {
    projectId: str(row, "projectId"), applicant: str(row, "submittedByUserId") || str(row, "handlerUserId"), code: str(procurement, "code") || "收货单", roles: ["material_director"], pending: str(row, "status") === "submitted" && active, approved: ["reviewed", "locked"].includes(str(row, "status")),
    participants: people(str(row, "handlerUserId"), str(row, "createdByUserId"), ...reviews.map(r => str(r, "reviewedByUserId"))), history: reviews.flatMap(r => event(r, "reviewedByUserId", "createdAt", str(r, "decision") === "approved" ? "收货复核通过" : str(r, "decision") === "returned" ? "收货退回" : "撤销复核", "comment"))
  });
  result.lockTargets.unshift({ table: "SpotProcurement", id: str(row, "procurementId") });
  return result;
});
const tax = source("tax_fact_review", "合同税务事实复核", "contractTaxFactRevision", { submittedAt: { not: null } }, async (db, row, identity) => {
  if (!date(row, "submittedAt"))
    return null;
  const contract = await get(db, "contract", str(row, "contractId"));
  if (!contract)
    return null;
  const state = str(row, "status");
  const pending = ["pending_finance_review", "pending_contract_confirmation"].includes(state);
  const approved = state === "confirmed";
  const result = one(row, identity, {
    projectId: str(row, "projectId"), applicant: str(row, "submittedByUserId") || str(row, "createdByUserId"), code: str(contract, "code") || str(contract, "name") || "税务事实", roles: ["finance_director"], pending, approved, cancelled: state === "abandoned", participants: people(str(row, "financeReviewedByUserId"), str(row, "confirmedByUserId")), history: [
      ...event(row, "financeReviewedByUserId", "financeReviewedAt", state === "rejected" && !date(row, "confirmedAt") ? "财务复核驳回" : "财务复核通过", "financeReviewComment"), ...event(row, "confirmedByUserId", "confirmedAt", state === "rejected" ? "合同确认驳回" : "合同确认通过", "contractReviewComment")
    ]
  });
  const reviewedHistory = await auditHistory(db, "contract_tax_fact_revision", str(row, "id"), {
    "contract.tax_fact_revision.finance_approve": "财务复核通过", "contract.tax_fact_revision.finance_reject": "财务复核驳回",
    "contract.tax_fact_revision.contract_reject": "合同确认驳回", "contract.tax_fact_revision.confirm": "合同确认通过", "contract.tax_fact_revision.correction_confirm": "合同确认通过"
  });
  if(reviewedHistory.length) result.history = reviewedHistory;
  result.currentNodeIndex = approved ? 2 : state === "pending_contract_confirmation" || Boolean(date(row, "confirmedAt")) ? 1 : 0;
  result.nodes = [
    {
      name: "财务复核", roleKeys: ["finance_director"], scope: "global_or_project", status: result.currentNodeIndex > 0 ? "已通过" : pending ? "处理中" : state === "rejected" ? "已驳回" : "未执行"
    }, {
      name: "合同部确认", roleKeys: ["contract_director"], scope: "global_or_project", status: approved ? "已通过" : state === "pending_contract_confirmation" ? "处理中" : result.currentNodeIndex === 1 && state === "rejected" ? "已驳回" : pending ? "未开始" : "未执行"
    }
  ];
  result.lockTargets.unshift({ table: "ContractVersion", id: str(row, "contractVersionId") });
  return result;
});
const correction = source("takeover_correction", "历史接管更正复核", "contractTakeoverCorrection", { submittedAt: { not: null } }, async (db, row, identity) => {
  if (str(row, "status") === "draft" || (!date(row, "submittedAt") && str(row, "status") !== "submitted"))
    return null;
  const takeover = await get(db, "contractTakeover", str(row, "takeoverId"));
  if (!takeover)
    return null;
  const contract = await get(db, "contract", str(takeover, "contractId"));
  const scope = str(row, "correctionScope");
  const company = str(row, "correctionType") === "company_entity";
  const role: RoleKey = company || scope === "historical_settlement" ? "contract_director" : "finance_director";
  if (!company && !["historical_settlement", "historical_payment", "historical_advance", "abnormal_overpay"].includes(scope))
    return null;
  return one(row, identity, {
    projectId: str(row, "projectId"), applicant: str(row, "submittedByUserId") || str(row, "createdByUserId"), code: contract ? (str(contract, "code") || str(contract, "name")) : "历史合同更正", roles: [role], pending: str(row, "status") === "submitted" && str(takeover, "takeoverStatus") === "confirmed", approved: ["applied", "confirmed"].includes(str(row, "status")), participants: people(str(row, "reviewedByUserId"), str(row, "appliedByUserId"), str(row, "responsibleUserId")), history: event(row, "reviewedByUserId", "reviewedAt", str(row, "status") === "rejected" ? "更正驳回" : "更正复核通过", "reviewComment")
  });
});
const takeover = source("takeover_review", "历史合同接管复核", "contractTakeover", { OR: [{ submittedAt: { not: null } }, { takeoverStatus: "pending_review" }] }, async (db, row, identity) => {
  if (!date(row, "submittedAt") && str(row, "takeoverStatus") !== "pending_review")
    return null;
  const contract = await get(db, "contract", str(row, "contractId"));
  return one(row, identity, {
    projectId: str(row, "projectId"), applicant: str(row, "submittedByUserId") || str(row, "createdByUserId"), code: contract ? (str(contract, "code") || str(contract, "name")) : "历史接管", roles: ["contract_director"], pending: str(row, "takeoverStatus") === "pending_review", approved: str(row, "takeoverStatus") === "confirmed", cancelled: str(row, "takeoverStatus") === "abandoned", participants: people(str(row, "responsibleUserId"), str(row, "confirmedByUserId")), history: mergeHistory(event(row, "confirmedByUserId", "confirmedAt", "接管确认", "reviewComment"), await auditHistory(db, "contract_takeover", str(row, "id"), { "contract_takeover.confirm": "接管确认", "contract_takeover.return_for_supplement": "退回补充" }))
  });
});
const takeoverBatch = source("takeover_batch_review", "历史接管批次验收", "contractTakeoverBatch", { status: { in: ["drafts_generated", "under_review", "accepted", "limited_accepted", "disputed"] } }, async (db, row, identity) => {
  if (!["drafts_generated", "under_review", "accepted", "limited_accepted", "disputed"].includes(str(row, "status")))
    return null;
  const logs = await many(db, "auditLog", { businessType: "contract_takeover_batch", businessId: str(row, "id"), action: "contract_takeover_batch.review" });
  return one(row, identity, {
    projectId: str(row, "projectId"), applicant: str(row, "createdByUserId"), code: str(row, "batchNo") || identity.title, roles: ["contract_director"], pending: ["drafts_generated", "under_review"].includes(str(row, "status")), approved: ["accepted", "limited_accepted"].includes(str(row, "status")), participants: people(str(row, "responsibleUserId"), ...logs.map(log => str(log, "actorUserId"))), history: logs.flatMap(log => event(log, "actorUserId", "createdAt", "批次复核"))
  });
});
const abnormal = source("abnormal_termination", "零采异常终止确认", "spotProcurementAbnormalTermination", {}, async (db, row, identity) => {
  const procurement = await get(db, "spotProcurement", str(row, "procurementId"));
  if (!procurement)
    return null;
  const result = one(row, identity, {
    projectId: str(procurement, "projectId"), applicant: str(row, "requestedByUserId"), code: str(procurement, "code") || "零采异常终止", roles: ["finance_director"], pending: str(row, "status") === "requested" && str(procurement, "status") === "approved_in_progress", approved: str(row, "status") === "confirmed", participants: people(str(row, "confirmedByUserId"), str(row, "rejectedByUserId")), history: [
      ...event(row, "confirmedByUserId", "confirmedAt", "异常终止确认"), ...event(row, "rejectedByUserId", "rejectedAt", "异常终止驳回", "rejectionReason")
    ]
  });
  result.lockTargets.unshift({ table: "SpotProcurement", id: str(procurement, "id") });
  return result;
});
const repayment = source("loan_repayment", "员工还款确认", "employeeLoanRepayment", {}, async (db, row, identity) => {
  const account = await get(db, "employeeProjectLoanAccount", str(row, "loanAccountId"));
  if (!account)
    return null;
  const scope = str(account, "scopeKey");
  if (!scope.startsWith("project:"))
    return null;
  return one(row, identity, {
    projectId: scope.slice(8), applicant: str(row, "recordedByUserId"), code: "员工还款", roles: ["finance_director"], pending: str(row, "status") === "recorded", approved: str(row, "status") === "confirmed", cancelled: str(row, "status") === "reversed", participants: people(str(account, "userId"), str(row, "confirmedByUserId"), str(row, "reversedByUserId")), history: [
      ...event(row, "recordedByUserId", "createdAt", "登记还款"), ...event(row, "confirmedByUserId", "confirmedAt", "确认还款", "confirmationNote"), ...event(row, "reversedByUserId", "reversedAt", "冲销还款", "reversalReason")
    ]
  });
});
function invoice(kind: "no_invoice" | "invoice_exception", modelName: string, title: string) {
  return source(kind, title, modelName, {}, async (db, row, identity) => {
    const procurement = await get(db, "spotProcurement", str(row, "procurementId"));
    const receiptRow = await get(db, "spotProcurementReceipt", str(row, "receiptId"));
    if (!procurement || !receiptRow)
      return null;
    const version = await get(db, "spotProcurementVersion", str(row, "procurementVersionId"));
    const payments = await many(db, "spotProcurementPayment", { procurementId: str(procurement, "id") });
    const lines = await many(db, "spotProcurementReceiptLine", { receiptId: str(receiptRow, "id"), receiptRevisionNo: receiptRow.currentRevisionNo });
    const revisions = await many(db, "spotProcurementReceiptRevision", { receiptId: str(receiptRow, "id"), revisionNo: receiptRow.currentRevisionNo });
    const reviews = await many(db, "spotProcurementReceiptReview", { receiptId: str(receiptRow, "id") });
    const latestReview = reviews.sort((a, b) => Number(b.sequenceNo) - Number(a.sequenceNo))[0];
    const revision = revisions[0];
    const validReceipt = Boolean(revision) && str(revision!, "procurementId") === str(procurement, "id") && str(revision!, "procurementVersionId") === str(row, "procurementVersionId") && revision!.actualCostCents === receiptRow.actualCostCents && Boolean(latestReview) && str(latestReview!, "decision") === "approved" && latestReview!.receiptRevisionNo === receiptRow.currentRevisionNo && str(latestReview!, "procurementVersionId") === str(row, "procurementVersionId");
    const sameVersion = validReceipt && str(procurement, "status") === "approved_in_progress" && str(procurement, "currentVersionId") === str(row, "procurementVersionId") && Boolean(version) && str(version!, "status") === "approved" && str(receiptRow, "procurementVersionId") === str(row, "procurementVersionId") && receiptRow.currentRevisionNo === row.receiptRevisionNo && str(row, "projectId") === str(procurement, "projectId") && !payments.some(p => p.paymentType !== null) && lines.some(line => str(line, "procurementLineId") === str(row, "procurementLineId"));
    const result = one(row, identity, {
      projectId: str(row, "projectId"), applicant: str(row, "submittedByUserId"), code: str(procurement, "code") || title, roles: ["finance_director"], pending: str(row, "status") === "pending_review" && sameVersion && str(receiptRow, "status") === "reviewed", approved: str(row, "status") === "confirmed", cancelled: str(row, "status") === "reversed", participants: people(str(row, "reviewedByUserId"), str(row, "reversedByUserId")), history: [
        ...event(row, "reviewedByUserId", "reviewedAt", str(row, "status") === "returned" ? "退回" : "确认", "reviewComment"), ...event(row, "reversedByUserId", "reversedAt", "冲销", "reversalReason")
      ]
    });
    result.lockTargets.unshift({ table: "SpotProcurement", id: str(procurement, "id") }, { table: "SpotProcurementReceipt", id: str(receiptRow, "id") });
    return result;
  });
}
function fact(kind: string, modelName: string, title: string, roles: RoleKey[], codeField: string) {
  return source(kind, title, modelName, { status: { in: ["pending_confirm", "confirmed", "effective", "voided"] } }, async (_db, row, identity) => {
    if (!["pending_confirm", "confirmed", "effective", "voided"].includes(str(row, "status")))
      return null;
    if (kind === "upstream_fund" && str(row, "factType") === "unreconciled_receipt_difference")
      return null;
    return one(row, identity, {
      projectId: str(row, "projectId"), applicant: str(row, "recordedByUserId"), code: str(row, codeField) || title, roles: ["upstream_fund", "affiliate_payment"].includes(kind) && str(row, "basisType") === "oral" ? ["finance_director"] : roles, pending: str(row, "status") === "pending_confirm" && !date(row, "voidedAt"), approved: ["confirmed", "effective"].includes(str(row, "status")) && !date(row, "voidedAt"), cancelled: Boolean(date(row, "voidedAt")) || str(row, "status") === "voided", participants: people(str(row, "confirmedByUserId")), history: event(row, "confirmedByUserId", "confirmedAt", "确认")
    });
  });
}
function template(kind: string, modelName: string, title: string, parentModel: string, parentKey: string, roles: RoleKey[]) {
  return source(kind, title, modelName, { status: { in: ["submitted", "published", "stopped", "revoked"] } }, async (db, row, identity) => {
    if (!["submitted", "published", "stopped", "revoked"].includes(str(row, "status")))
      return null;
    const parent = await get(db, parentModel, str(row, parentKey));
    if (!parent)
      return null;
    return one(row, identity, {
      projectId: null, applicant: str(row, "submittedByUserId"), code: str(parent, "name") || str(parent, "title") || title, roles, scope: "global", pending: str(row, "status") === "submitted", approved: Boolean(date(row, "publishedAt")), cancelled: ["stopped", "revoked"].includes(str(row, "status")), participants: people(str(row, "publishedByUserId")), history: event(row, "publishedByUserId", "publishedAt", "审核发布")
    });
  });
}
// Department confirmations are independently actionable; saving facts creates the durable pending stage.
function takeoverSide(side: "contract" | "finance") {
  return source(`takeover_${side}_confirmation`, side === "contract" ? "历史接管合同侧确认" : "历史接管财务侧确认", "contractTakeover", {}, async (db, row, identity) => {
    const contractFacts = await model(db, "contractTakeoverContractFacts").findUnique({ where: { takeoverId: str(row, "id") } });
    const financeFacts = await model(db, "contractTakeoverFinanceFacts").findUnique({ where: { takeoverId: str(row, "id") } });
    const facts = side === "contract" ? contractFacts : financeFacts;
    if (!contractFacts || !facts)
      return null;
    const contract = await get(db, "contract", str(row, "contractId"));
    const events = await many(db, "contractTakeoverConfirmationEvent", { takeoverId: str(row, "id") });
    const history = events.flatMap(e => event(e, "actorUserId", "createdAt", `${str(e, "side") === "contract" ? "合同侧" : "财务侧"}${str(e, "action") === "confirm" ? "确认" : "撤回确认"}`, "reason"));
    const current = side === "contract" || financeFacts!.basedOnFinanceBasisRevision === contractFacts.financeBasisRevision;
    const result = one(row, identity, {
      projectId: str(row, "projectId"), applicant: str(facts, "updatedByUserId") || str(row, "createdByUserId"), code: contract ? (str(contract, "code") || str(contract, "name")) : identity.title, roles: [side === "contract" ? "contract_director" : "finance_director"], pending: !date(row, "activatedAt") && facts.confirmedRevision === null && current, approved: facts.confirmedRevision === facts.revision, cancelled: Boolean(date(row, "activatedAt")) && facts.confirmedRevision !== facts.revision, participants: people(str(row, "createdByUserId"), str(contractFacts, "updatedByUserId"), str(financeFacts ?? {}, "updatedByUserId"), ...history.map(e => e.actorUserId)), history
    });
    // Every writer locks the takeover root before the facts, so the root lock protects both revisions.
    result.updatedAt = new Date(Math.max(result.updatedAt.getTime(), newest(contractFacts).getTime(), financeFacts ? newest(financeFacts).getTime() : 0));
    const otherSide = side === "contract" ? "finance" : "contract";
    const otherFacts = otherSide === "contract" ? contractFacts : financeFacts;
    const otherCurrent = otherSide === "contract" || (financeFacts !== null && financeFacts.basedOnFinanceBasisRevision === contractFacts.financeBasisRevision);
    result.nodes.push({
      name: otherSide === "contract" ? "合同侧确认" : "财务侧确认", roleKeys: [otherSide === "contract" ? "contract_director" : "finance_director"], scope: "global_or_project", status: otherFacts && otherFacts.confirmedRevision === otherFacts.revision ? "已通过" : otherFacts && otherCurrent && !date(row, "activatedAt") ? "处理中" : "未开始"
    });
    // This projection represents one independent confirmation, not a sequential dependency.
    result.currentNodeIndex = 0;
    return result;
  });
}
async function projectAllowsPending(db: Db, projectId: string | null) {
  if (!projectId) return true;
  const project = await get(db, "project", projectId);
  return project?.isActive === true;
}
function ledgerConfirmation(kind: string, title: string, modelName: string, role: RoleKey, scope: IndependentReviewNode["scope"], actionPrefix: string) {
  return source(kind, title, modelName, {status:{in:["pending_confirm","confirmed","returned"]}}, async(db,row,identity)=>{
    if(!["pending_confirm","confirmed","returned"].includes(str(row,"status")))return null;
    const history=await auditHistory(db,kind,str(row,"id"),{[`${actionPrefix}.confirm`]:"复核确认",[`${actionPrefix}.return`]:"退回"});
    const projectId=str(row,"projectId")||null;
    const result=one(row,identity,{projectId,applicant:str(row,"recordedByUserId"),code:title,roles:[role],scope,
      pending:str(row,"status")==="pending_confirm"&&await projectAllowsPending(db,projectId),approved:str(row,"status")==="confirmed",exclude:people(str(row,"recordedByUserId")),
      participants:people(str(row,"confirmedByUserId")),history:mergeHistory(event(row,"confirmedByUserId","confirmedAt","复核确认"),history)});
    result.requiresActiveProject = true;
    if(projectId)result.lockTargets.unshift({table:"Project",id:projectId});
    return result;
  });
}
const economicReview=source("contract_economic_review","履约范围复核","contractEconomicReview",{status:{in:["pending_review","pending_finance","confirmed","returned","superseded"]}},async(db,row,identity)=>{
  if(!["pending_review","pending_finance","confirmed","returned","superseded"].includes(str(row,"status")))return null;
  const state=str(row,"status");const needsFinance=row.financeRequired===true;
  const history=await auditHistory(db,"contract_economic_review",str(row,"id"),{"contract.economic_review.review":"复核通过","contract.economic_review.return":"退回"});
  const actionable=await projectAllowsPending(db,str(row,"projectId"));
  const result=one(row,identity,{projectId:str(row,"projectId"),applicant:str(row,"preparedByUserId"),code:"履约范围复核",roles:["contract_director"],pending:["pending_review","pending_finance"].includes(state)&&actionable,approved:state==="confirmed",cancelled:state==="superseded",participants:people(str(row,"contractReviewedById"),str(row,"financeReviewedById")),history});
  const stage=state==="pending_finance"||Boolean(str(row,"contractReviewedById"))?1:0;
  result.nodes=[{name:"合同部复核",roleKeys:["contract_director"],scope:"global_or_project",excludeUserIds:people(str(row,"preparedByUserId")),status:stage>0||state==="confirmed"?"已通过":state==="pending_review"&&actionable?"处理中":state==="returned"?"已驳回":"未开始"}];
  if(needsFinance)result.nodes.push({name:"财务复核",roleKeys:["finance_director"],scope:"global_or_project",excludeUserIds:people(str(row,"preparedByUserId"),str(row,"contractReviewedById")),status:state==="confirmed"?"已通过":state==="pending_finance"&&actionable?"处理中":state==="returned"&&stage===1?"已驳回":state==="pending_review"?"未开始":"未执行"});
  result.currentNodeIndex=state==="confirmed"?result.nodes.length:stage;
  result.requiresActiveProject = true;
  result.lockTargets.unshift({table:"Project",id:str(row,"projectId")});return result;
});
const employeeRegistration=source("employee_registration","员工入职审核","employeeRegistration",{status:{in:["pending","chairman_review","approved","returned"]}},async(db,row,identity)=>{
  if(!["pending","chairman_review","approved","returned"].includes(str(row,"status")))return null;
  const history=await auditHistory(db,"employee_registration",str(row,"id"),{"employee.registration.approve":"入职批准","employee.registration.return":"退回修改","employee.registration.refer":"转交董事长"});
  const state=str(row,"status");const referred=state!=="pending"&&(state==="chairman_review"||history.some(event=>event.action==="转交董事长"));
  // Pending external applicants do not have a User account. Never manufacture a user ID or SMS recipient.
  const applicant=state==="approved"?str(row,"userId"):"";
  const result=one(row,identity,{projectId:null,applicant,code:"入职申请",roles:["comprehensive_director","chairman"],scope:"global",pending:["pending","chairman_review"].includes(state),approved:state==="approved",participants:people(str(row,"reviewedBy")),history});
  result.applicantName=applicant?undefined:"待入职人员";
  // employeeManagerRoles permits either global manager at pending; a referral locks the next stage to chairman.
  result.nodes=[{name:"入职初审",roleKeys:["comprehensive_director","chairman"],scope:"global",status:referred||state==="approved"?"已通过":state==="pending"?"处理中":"已驳回"},
    {name:"董事长复核（转交后）",roleKeys:["chairman"],scope:"global",status:state==="chairman_review"?"处理中":referred&&state==="approved"?"已通过":referred&&state==="returned"?"已驳回":state==="pending"?"未开始":"未执行"}];
  result.currentNodeIndex=state==="approved"?2:referred?1:0;return result;
});
export const SOURCES: readonly IndependentReviewSource[] = [
  employeeRegistration, economicReview,
  ledgerConfirmation("contract_bank_verification","银行流水核验","contractBankVerificationRequest","finance_director","global","contract.bank_verification"),
  ledgerConfirmation("contract_proxy_execution","代付及往来确认","contractProxyExecution","finance_director","global_or_project","contract.proxy_execution"),
  ledgerConfirmation("upward_contract_amount_revision","对上合同金额修订","upwardContractAmountRevision","contract_director","global_or_project","contract.upward_amount"),
  ledgerConfirmation("upward_receipt_match","对上到账核销","upwardReceiptMatch","finance_director","global_or_project","contract.receipt_match"),
  seal, contractArchive, settlementArchive, receipt, tax, takeover, takeoverBatch, takeoverSide("contract"), takeoverSide("finance"), correction, abnormal, repayment,
  invoice("no_invoice", "noInvoiceConfirmation", "无票据确认"), invoice("invoice_exception", "invoiceExceptionConfirmation", "票据例外确认"),
  fact("upstream_fund", "projectUpstreamFundFact", "上游资金事实确认", ["finance_staff", "finance_director"], "counterpartyName"),
  fact("affiliate_contract", "projectAffiliateContractFact", "施工企业合同事实确认", ["contract_director"], "externalContractReference"),
  fact("affiliate_settlement", "projectAffiliateSettlementFact", "施工企业结算事实确认", ["budget_staff"], "periodLabel"),
  fact("affiliate_payment", "projectAffiliatePaymentFact", "施工企业付款事实确认", ["finance_staff", "finance_director"], "externalPaymentReference"),
  fact("affiliate_company_contract", "projectAffiliateCompanyContract", "挂靠公司合同确认", ["contract_director"], "contractReference"),
  fact("upstream_settlement", "projectUpstreamSettlement", "上游结算确认", ["budget_staff"], "periodLabel"),
  fact("owner_contract", "projectOwnerContract", "业主主合同确认", ["contract_director"], "contractCode"),
  template("contract_template", "contractBusinessTemplateVersion", "合同模板发布审核", "contractBusinessTemplate", "templateId", ["contract_director"]),
  template("layout_template", "contractLayoutTemplateVersion", "版式模板发布审核", "contractLayoutTemplate", "layoutTemplateId", ["contract_director"]),
  template("standard_clause", "standardClauseVersion", "标准条款发布审核", "standardClause", "clauseId", ["contract_director"]),
  template("settlement_template", "settlementTemplateVersion", "结算模板发布审核", "settlementTemplate", "settlementTemplateId", ["contract_director", "super_admin"])
];
// SQL identifiers are trusted constants, never derived from the client-provided kind or ID.
export const INDEPENDENT_REVIEW_LOCK_TABLES = [
  "Project", "EmployeeRegistration", "ContractEconomicReview", "ContractBankVerificationRequest", "ContractProxyExecution", "UpwardContractAmountRevision", "UpwardReceiptMatch",
  "ContractVersion", "ContractSealTask", "Settlement", "SpotProcurement", "SpotProcurementReceipt",
  "ContractTaxFactRevision", "ContractTakeover", "ContractTakeoverBatch", "ContractTakeoverCorrection",
  "SpotProcurementAbnormalTermination", "EmployeeLoanRepayment", "NoInvoiceConfirmation",
  "InvoiceExceptionConfirmation", "ProjectUpstreamFundFact", "ProjectAffiliateContractFact",
  "ProjectAffiliateSettlementFact", "ProjectAffiliatePaymentFact", "ProjectAffiliateCompanyContract",
  "ProjectUpstreamSettlement", "ProjectOwnerContract", "ContractBusinessTemplateVersion",
  "ContractLayoutTemplateVersion", "StandardClauseVersion", "SettlementTemplateVersion"
] as const;
