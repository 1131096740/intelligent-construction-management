import { Prisma } from "@prisma/client";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import type { WorkItem } from "../me/me.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { currentSpotMaterialRoleKeys } from "./spot-procurement-material-role-scope";

/** Current approved request -> personal purchase task, without a payment/receipt write. */
export async function spotPurchaseWorkItems(tx: Prisma.TransactionClient, userId: string, projectIds: string[]): Promise<WorkItem[]> {
  if (!projectIds.length || !tx.spotProcurement?.findMany || !tx.spotProcurementVersion?.findUnique || !tx.user?.findUnique) return [];
  const visibility = new ProjectVisibilityService(tx as never);
  const result: Array<{item: WorkItem; updatedAt: number}> = [];
  let afterId: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const rows = await tx.spotProcurement.findMany({where: {status: "approved_in_progress", projectId: {in: projectIds}, ...(afterId ? {id: {gt: afterId}} : {})}, orderBy: {id: "asc"}, take: 100});
    hasMore = rows.length === 100;
    if (!rows.length) break;
    afterId = rows[rows.length - 1].id;
    for (const row of rows) {
      if (row.status !== "approved_in_progress" || !row.currentVersionId) continue;
      const actor = await tx.user.findUnique({where: {id: userId}, select: {isActive: true}});
      if (!actor?.isActive) continue;
      const scopes = await visibility.effectiveRoleScopesInTransaction(tx, userId, row.projectId);
      const roles = await currentSpotMaterialRoleKeys(tx, userId, [...scopes.globalRoleKeys, ...scopes.projectRoleKeys]);
      if (!scopes.projectRoleKeys.includes("material_staff") && !(scopes.globalRoleKeys.includes("material_director") && roles.includes("material_director"))) continue;
      const [current, version, project] = await Promise.all([
        tx.spotProcurement.findUnique({where: {id: row.id}}),
        tx.spotProcurementVersion.findUnique({where: {id: row.currentVersionId}}),
        tx.project.findUnique({where: {id: row.projectId}, select: {name: true}})
      ]);
      if (!current || current.status !== "approved_in_progress" || current.currentVersionId !== row.currentVersionId ||
        !version || version.procurementId !== row.id || version.requestProtocolVersion !== 2 || version.status !== "approved") continue;
      result.push({updatedAt: row.updatedAt.getTime(), item: {
        id: `spot-procurement-purchase:${version.id}`, type: "procurement", title: `生产材料采购：${version.reason || "详见需求清单"}`,
        projectId: row.projectId, projectName: project?.name ?? "所属项目", businessCode: row.code,
        businessType: "spot_procurement", businessId: row.id,
        amountText: version.estimatedTotalAmount == null ? "预计金额待确定" : `整单独立预计 ¥${normalizeBusinessAmount(version.estimatedTotalAmount.toString())}`,
        currentNode: "项目物资采购", nextAction: "按实际需要采购", stayedText: "", tone: "warning", targetPath: `/零星采购/${encodeURIComponent(row.id)}`
      }});
    }
  }
  return result.sort((left, right) => right.updatedAt - left.updatedAt || left.item.id.localeCompare(right.item.id)).map(row => row.item);
}
