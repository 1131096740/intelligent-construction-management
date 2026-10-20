import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { snapshotApprovalSignature, withApprovalIdentity } from "./approval-signature-snapshot";

export interface IndependentApprovalFacts {
  businessType: string;
  businessId: string;
  applicantUserId: string;
  actorUserId: string;
  roleKey: string;
  nodeName: string;
  comment?: string | null;
  signedAt: Date | null;
  stageIndex?: number;
  nodes?: Array<{ name: string; mode: "any"; roleKeys: string[] }>;
  form: {
    title: string;
    code: string;
    projectId: string | null;
    companyName: string;
    summary: Array<{ label: string; value: string }>;
  };
}

/** Called inside the domain's locked approval transaction; never grants approval authority. */
export async function recordIndependentApproval(tx: Prisma.TransactionClient, input: IndependentApprovalFacts) {
  if (!(input.signedAt instanceof Date) || !Number.isFinite(input.signedAt.getTime())) {
    throw new ConflictException("实际签批时间缺失，不能生成审批证据");
  }
  const stage = input.stageIndex ?? 0;
  const nodes = input.nodes ?? [{ name: input.nodeName, mode: "any" as const, roleKeys: [input.roleKey] }];
  if (!nodes[stage]?.roleKeys.includes(input.roleKey)) throw new ConflictException("审批岗位与当前签批节点不一致");
  let instance = await tx.approvalInstance.findFirst({
    where: { businessType: input.businessType, businessId: input.businessId, flowType: "formal_approval_evidence" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  if (!instance) {
    if (stage !== 0) throw new ConflictException("前序审批签名证据缺失，请核查原审批记录");
    instance = await tx.approvalInstance.create({ data: {
      businessType: input.businessType, businessId: input.businessId, flowType: "formal_approval_evidence",
      status: "in_progress", currentNodeIndex: 0, frozenNodes: nodes,
      applicantUserId: input.applicantUserId
    } });
  }
  const frozen = instance.frozenNodes as unknown as typeof nodes;
  if (instance.status !== "in_progress" || instance.currentNodeIndex !== stage || !Array.isArray(frozen) ||
      frozen.length !== nodes.length || frozen.some((node, index) => node.name !== nodes[index].name ||
        node.mode !== nodes[index].mode || node.roleKeys.join("|") !== nodes[index].roleKeys.join("|"))) {
    throw new ConflictException("审批签名证据已变化，请刷新后重试");
  }
  const signature = await snapshotApprovalSignature(tx, input.actorUserId, { required: true });
  const applicant = await tx.user.findUnique({ where: { id: input.applicantUserId }, select: { name: true } });
  await tx.approvalActionLog.create({ data: await withApprovalIdentity(tx, {
    approvalInstanceId: instance.id, action: "approve", actorUserId: input.actorUserId,
    representedUserId: input.actorUserId, approvedRoleKey: input.roleKey,
    comment: input.comment ?? null,
    createdAt: input.signedAt,
    signatureFileIdSnapshot: signature.fileId, signatureSha256Snapshot: signature.sha256,
    signatureVersionIdSnapshot: signature.versionId,
    metadata: { nodeName: input.nodeName, roleName: input.nodeName, nodeIndex: stage,
      form: { ...input.form, applicantName: applicant?.name ?? "" } }
  }, signature) });
  return tx.approvalInstance.update({ where: { id: instance.id }, data: {
    currentNodeIndex: stage + 1, status: stage + 1 === nodes.length ? "approved" : "in_progress"
  } });
}

/** Invalidate the formal artifact in the same transaction that reverses the source fact. */
export async function invalidateIndependentApproval(
  tx: Prisma.TransactionClient,
  input: { businessType: string; businessId: string; actorUserId: string; reason: string | null; invalidatedAt: Date }
) {
  const instance = await tx.approvalInstance.findFirst({
    where: { businessType: input.businessType, businessId: input.businessId, flowType: "formal_approval_evidence" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  // Historical source facts may predate signed evidence; never create replacement history.
  if (!instance || instance.status !== "approved") return;
  await tx.approvalInstance.update({ where: { id: instance.id }, data: { status: "terminated" } });
  await tx.approvalActionLog.create({ data: {
    approvalInstanceId: instance.id, action: "void", actorUserId: input.actorUserId,
    comment: input.reason, createdAt: input.invalidatedAt,
    metadata: { reason: "source_fact_invalidated" }
  } });
}
