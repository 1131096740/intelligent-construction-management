import type { ApprovalTimelineItemReadModel } from "@jiangkong/shared-domain";

interface ApprovalTimelinePrisma {
  approvalInstance?: {
    findFirst(args: {
      where: { businessType: string; businessId: string };
      orderBy: { createdAt: "desc" };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  approvalActionLog?: {
    findMany(args: {
      where: { approvalInstanceId: string };
      orderBy: { createdAt: "asc" };
    }): Promise<
      Array<{
        id: string;
        action: string;
        actorUserId: string;
        comment: string | null;
        metadata: unknown;
        createdAt: Date;
      }>
    >;
  };
  user?: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
}

const ACTION_LABELS: Record<string, string> = {
  approve: "同意",
  reject: "驳回",
  reject_previous: "退回上一节点",
  return_to_applicant: "退回申请人",
  withdraw: "撤回",
  remind: "催办",
  transfer: "转交",
  delegate: "委托"
};

const ROLE_LABELS: Record<string, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "施工队长",
  engineering_tech: "技术员",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

export async function approvalTimelineForBusiness(
  prisma: unknown,
  businessType: string,
  businessId: string
): Promise<ApprovalTimelineItemReadModel[]> {
  const client = prisma as ApprovalTimelinePrisma;
  if (!client.approvalInstance || !client.approvalActionLog) {
    return [];
  }

  const instance = await client.approvalInstance.findFirst({
    where: { businessType, businessId },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!instance) {
    return [];
  }

  const logs = await client.approvalActionLog.findMany({
    where: { approvalInstanceId: instance.id },
    orderBy: { createdAt: "asc" }
  });
  const actorUserIds = Array.from(new Set(logs.map((log) => log.actorUserId)));
  const users = client.user && actorUserIds.length
    ? await client.user.findMany({
        where: { id: { in: actorUserIds } },
        select: { id: true, name: true }
      })
    : [];
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    actionLabel: ACTION_LABELS[log.action] ?? "审批动作未读取",
    actorUserId: log.actorUserId,
    actorName: userNameById.get(log.actorUserId) ?? "审批人未读取",
    comment: log.comment ?? null,
    nodeName: metadataString(log.metadata, "nodeName") ?? metadataString(log.metadata, "fromNodeName"),
    roleName: roleLabel(metadataString(log.metadata, "approvedRoleKey")),
    selfReview: metadataBoolean(log.metadata, "selfReview"),
    selfReviewReason:
      metadataBoolean(log.metadata, "selfReview")
        ? metadataString(log.metadata, "selfReviewReason")?.trim() ?? null
        : null,
    createdAt: log.createdAt.toISOString()
  }));
}

function metadataBoolean(metadata: unknown, key: string): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as Record<string, unknown>)[key] === true;
}

function roleLabel(roleKey: string | null): string | null {
  if (!roleKey) {
    return null;
  }

  return ROLE_LABELS[roleKey] ?? "审批角色未读取";
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}
