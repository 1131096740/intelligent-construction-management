import { generalRequestEstimateText } from "./general-procurement-request-facts";
import { Prisma } from "@prisma/client";
import type { WorkItem } from "../me/me.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { GENERAL_REQUEST_DUTY_RESOURCE, generalRequestActor, generalRequestDutyIdentity } from "./general-procurement-request-access";

export async function generalRequestWorkItems(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService, userId: string,
  mode: "pending" | "started" | "delegated" | "procurement" = "pending"): Promise<WorkItem[]> {
  if (!tx.generalProcurement?.findMany) return [];
  const actor = await generalRequestActor(tx, visibility, userId, null);
  const globalDirector = actor.globalRoleKeys.includes("comprehensive_director");
  if (mode === "procurement" && !globalDirector) return [];
  let scopeWhere: Prisma.GeneralProcurementWhereInput[] | undefined;
  if (mode === "delegated" || (mode === "pending" && !globalDirector)) {
    const now = new Date();
    const mandates = await tx.approvalDelegation.findMany({ where: { toUserId: userId, enabled: true,
      actionKey: "general_procurement.approve", resourceType: GENERAL_REQUEST_DUTY_RESOURCE, startsAt: { lte: now }, endsAt: { gt: now } }, select: { resourceId: true } });
    const roundIds = [...new Set(mandates.flatMap(mandate => typeof mandate.resourceId === "string" && /^[0-9a-f-]{36}:[01]$/i.test(mandate.resourceId) ? [mandate.resourceId.split(":")[0]] : []))];
    const projectIds = mode === "pending" ? await visibility.businessProjectIdsInTransaction(tx, userId) : [];
    scopeWhere = [{ projectId: { in: projectIds } }, { approvalInstanceId: { in: roundIds } }];
    if (!projectIds.length && !roundIds.length) return [];
  }
  const result: WorkItem[] = [];
  const updatedAtById = new Map<string, number>();
  let afterId: string | undefined;
  // Bound each read, then authorize every row before producing personal items.
  // A global top-N before authorization can hide older work and undercount duties.
  let hasMore = true;
  while (hasMore) {
    const rows = await tx.generalProcurement.findMany({ where: { requestProtocolVersion: 2,
      ...(afterId ? { id: { gt: afterId } } : {}), ...(scopeWhere ? { OR: scopeWhere } : {}),
      ...(mode === "started" ? { applicantUserId: userId, status: { in: ["approval_pending", "approved_pending_procurement"] } } : { status: mode === "procurement" ? "approved_pending_procurement" : "approval_pending" }) }, orderBy: { id: "asc" }, take: 100 });
    hasMore = rows.length === 100;
    if (!rows.length) break;
    afterId = rows[rows.length - 1].id;
    for (const row of rows) {
      if (row.requestProtocolVersion !== 2) continue;
      const round = row.approvalInstanceId ? await tx.approvalInstance.findUnique({ where: { id: row.approvalInstanceId } }) : null;
      if (!round || round.businessType !== "general_procurement" || round.businessId !== row.id || !isParallelApprovalRound(round.frozenNodes)) continue;
      const project = row.projectId ? await tx.project.findUnique({ where: { id: row.projectId }, select: { name: true } }) : null;
      const common = { title: `综合采购申请：${row.reason || "详见需求清单"}`, projectId: row.projectId ?? undefined, projectName: project?.name ?? "公司日常", businessCode: row.code,
        businessType: "general_procurement", businessId: row.id, amountText: row.estimatedAmount == null ? "预计金额待明确" : `整单独立预计 ¥${generalRequestEstimateText(row.estimatedAmount)}`,
        stayedText: "", targetPath: `/综合采购申请/${encodeURIComponent(row.id)}` };
      if (mode === "procurement") {
        if (round.status !== "approved" || !(await generalRequestActor(tx, visibility, userId, null)).globalRoleKeys.includes("comprehensive_director")) continue;
        updatedAtById.set(row.id, row.updatedAt.getTime());
        result.push({ ...common, id: `general-procurement:${row.id}`, type: "procurement", currentNode: "综合部采购", nextAction: "按实际需要采购", tone: "warning" });
        continue;
      }
      if (mode === "started") {
        updatedAtById.set(row.id, row.updatedAt.getTime());
        result.push({ ...common, id: `general-request-started:${row.id}`, type: "approval", currentNode: row.status === "approved_pending_procurement" ? "综合部采购" : "并联审批", nextAction: "查看办理进度", tone: "primary" });
        continue;
      }
      if (round.status !== "in_progress") continue;
      for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
        const identity = await generalRequestDutyIdentity(tx, visibility, row, round, index, userId);
        if (!identity || (mode === "delegated" && !identity.delegationId)) continue;
        const name = String(round.frozenNodes[index].name);
        updatedAtById.set(row.id, row.updatedAt.getTime());
        result.push({ ...common, id: `general-request-duty:${round.id}:${index}`, type: "approval", currentNode: name, nextAction: `办理${name}审批`, tone: "warning" });
      }
    }
  }
  return result.sort((left, right) => (updatedAtById.get(right.businessId!) ?? 0) - (updatedAtById.get(left.businessId!) ?? 0) || left.id.localeCompare(right.id));
}
