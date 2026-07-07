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
    actionLabel: ACTION_LABELS[log.action] ?? log.action,
    actorUserId: log.actorUserId,
    actorName: userNameById.get(log.actorUserId) ?? log.actorUserId,
    comment: log.comment ?? null,
    nodeName: metadataString(log.metadata, "nodeName") ?? metadataString(log.metadata, "fromNodeName"),
    roleName: metadataString(log.metadata, "approvedRoleKey"),
    createdAt: log.createdAt.toISOString()
  }));
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}
