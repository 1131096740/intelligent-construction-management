import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type { SaveContractTakeoverHandoverDto } from "./dto/save-contract-takeover-handover.dto";
import {
  CONTRACT_TAKEOVER_HANDOVER_ACTION_REGISTER,
  CONTRACT_TAKEOVER_HANDOVER_ACTION_REASSIGN,
  CONTRACT_TAKEOVER_HANDOVER_DUTIES,
  CONTRACT_TAKEOVER_HANDOVER_DUTY_LABELS,
  CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE,
  parseTakeoverHandoverSnapshot,
  requiresTakeoverHandover,
  type ContractTakeoverHandoverAssignments,
  type ContractTakeoverHandoverDuty,
  type ContractTakeoverHandoverSnapshot
} from "./contract-takeover-handover";

const DUTY_POSITION_RULES: Record<
  ContractTakeoverHandoverDuty,
  { allowed: ReadonlySet<string>; requirementText: string }
> = {
  contract: {
    allowed: new Set(["contract_staff", "contract_director"]),
    requirementText: "合同员或合同部主管"
  },
  finance: {
    allowed: new Set(["finance_staff", "finance_director"]),
    requirementText: "财务或财务主管"
  },
  supervisor: {
    allowed: new Set(["contract_director"]),
    requirementText: "合同部主管"
  }
};

const TAKEOVER_LEVEL_LABELS: Record<string, string> = {
  A: "A级（历史兼容）",
  B: "B级（历史兼容）",
  C: "C级（历史兼容）",
  NONE: "无等级（按分工接管）"
};

type HandoverClient = Prisma.TransactionClient;

interface HandoverEventRow {
  id: string;
  idempotencyKey: string;
  takeoverId: string;
  action: string;
  revision: number;
  reason: string | null;
  actorUserId: string;
  createdAt: Date;
  responseSnapshot: Prisma.JsonValue | null;
}

export interface ContractTakeoverHandoverAssignmentReadModel {
  duty: ContractTakeoverHandoverDuty;
  dutyLabel: string;
  userId: string;
  userName: string | null;
  roleKeys: string[];
}

export interface ContractTakeoverHandoverHistoryReadModel {
  revision: number;
  action: "handover_register" | "handover_reassign";
  actionLabel: string;
  reason: string | null;
  actorUserId: string;
  actorUserName: string | null;
  createdAt: string;
  assignments: ContractTakeoverHandoverAssignmentReadModel[];
}

export interface ContractTakeoverHandoverReadModel {
  projectId: string;
  takeoverId: string;
  contractId: string;
  takeoverStatus: string;
  takeoverLevel: string;
  takeoverLevelLabel: string;
  requiresHandover: boolean;
  registered: boolean;
  revision: number | null;
  assignments: ContractTakeoverHandoverAssignmentReadModel[];
  history: ContractTakeoverHandoverHistoryReadModel[];
  actorDuty: ContractTakeoverHandoverDuty | null;
}

@Injectable()
export class ContractTakeoverHandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  async read(
    projectId: string,
    takeoverId: string,
    actorUserId: string
  ): Promise<ContractTakeoverHandoverReadModel> {
    return this.readInClient(this.prisma as unknown as HandoverClient, projectId, takeoverId, actorUserId);
  }

  async register(
    projectId: string,
    takeoverId: string,
    actorUserId: string,
    input: SaveContractTakeoverHandoverDto
  ): Promise<ContractTakeoverHandoverReadModel> {
    const assignments: ContractTakeoverHandoverAssignments = {
      contract: requiredUserId(input.contractUserId, "合同办理负责人"),
      finance: requiredUserId(input.financeUserId, "财务收付负责人"),
      supervisor: requiredUserId(input.supervisorUserId, "合同复核负责人")
    };
    const reason = input.reason?.trim() || null;
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;

    return this.prisma.$transaction(async (tx) => {
      const takeover = await tx.contractTakeover.findFirst({
        where: { id: takeoverId, projectId },
        select: {
          id: true,
          projectId: true,
          contractId: true,
          takeoverStatus: true,
          takeoverLevel: true
        }
      });
      if (!takeover) {
        throw new NotFoundException("未找到历史合同接管记录，请刷新接管工作台后重试");
      }
      if (takeover.takeoverStatus === "abandoned") {
        throw new BadRequestException("接管记录已放弃，不能登记分工");
      }

      if (idempotencyKey) {
        const existing = await tx.contractTakeoverConfirmationEvent.findUnique({
          where: { idempotencyKey },
          select: {
            takeoverId: true,
            actorUserId: true,
            side: true
          }
        });
        if (existing) {
          if (
            existing.side !== CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE ||
            existing.takeoverId !== takeoverId ||
            existing.actorUserId !== actorUserId
          ) {
            throw new ConflictException("接管分工登记请求已被使用，请刷新后重试");
          }
          return this.readInClient(tx, projectId, takeoverId, actorUserId);
        }
      }

      const latest = await this.latestSnapshot(tx, takeoverId);
      if (latest && !reason) {
        throw new BadRequestException("更换接管责任人必须填写原因");
      }
      if (latest && sameAssignments(latest.assignments, assignments)) {
        return this.readInClient(tx, projectId, takeoverId, actorUserId);
      }

      await this.assertDutyAssignments(tx, projectId, assignments);

      const revision = (latest?.revision ?? 0) + 1;
      const action = latest
        ? CONTRACT_TAKEOVER_HANDOVER_ACTION_REASSIGN
        : CONTRACT_TAKEOVER_HANDOVER_ACTION_REGISTER;
      await tx.contractTakeoverConfirmationEvent.create({
        data: {
          idempotencyKey: idempotencyKey ?? randomIdempotencyKey(),
          takeoverId,
          side: CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE,
          action,
          revision,
          reason: reason ?? null,
          actorUserId,
          responseSnapshot: {
            schemaVersion: 1,
            revision,
            assignments,
            previousAssignments: latest?.assignments ?? null
          } as unknown as Prisma.InputJsonValue
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: `contract_takeover.handover.${latest ? "reassign" : "register"}`,
        businessType: "contract_takeover",
        businessId: takeoverId,
        metadata: {
          projectId,
          contractId: takeover.contractId,
          revision,
          fromAssignments: latest?.assignments ?? null,
          toAssignments: assignments,
          reason
        } as unknown as Prisma.InputJsonValue
      });

      return this.readInClient(tx, projectId, takeoverId, actorUserId);
    });
  }

  private async latestSnapshot(
    tx: HandoverClient,
    takeoverId: string
  ): Promise<ContractTakeoverHandoverSnapshot | null> {
    const event = await tx.contractTakeoverConfirmationEvent.findFirst({
      where: { takeoverId, side: CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE },
      orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
      select: { responseSnapshot: true }
    });
    return event ? parseTakeoverHandoverSnapshot(event.responseSnapshot) : null;
  }

  private async readInClient(
    client: HandoverClient,
    projectId: string,
    takeoverId: string,
    actorUserId: string
  ): Promise<ContractTakeoverHandoverReadModel> {
    const takeover = await client.contractTakeover.findFirst({
      where: { id: takeoverId, projectId },
      select: {
        id: true,
        projectId: true,
        contractId: true,
        takeoverStatus: true,
        takeoverLevel: true
      }
    });
    if (!takeover) {
      throw new NotFoundException("未找到历史合同接管记录，请刷新接管工作台后重试");
    }
    const events = (await client.contractTakeoverConfirmationEvent.findMany({
      where: { takeoverId, side: CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE },
      orderBy: [{ revision: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        idempotencyKey: true,
        takeoverId: true,
        action: true,
        revision: true,
        reason: true,
        actorUserId: true,
        createdAt: true,
        responseSnapshot: true
      }
    })) as HandoverEventRow[];
    const parsed = events
      .map((event) => ({
        event,
        snapshot: parseTakeoverHandoverSnapshot(event.responseSnapshot)
      }))
      .filter(
        (entry): entry is { event: HandoverEventRow; snapshot: ContractTakeoverHandoverSnapshot } =>
          entry.snapshot !== null
      );
    const latest = parsed[parsed.length - 1]?.snapshot ?? null;
    const userIds = [
      ...new Set([
        ...(latest
          ? CONTRACT_TAKEOVER_HANDOVER_DUTIES.map((duty) => latest.assignments[duty])
          : []),
        ...parsed.map((entry) => entry.event.actorUserId)
      ])
    ];
    const [users, roleKeysByUser] = await Promise.all([
      userIds.length
        ? client.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, isActive: true }
          })
        : Promise.resolve([]),
      this.roleKeysByUser(client, projectId, [
        ...new Set(
          latest ? CONTRACT_TAKEOVER_HANDOVER_DUTIES.map((duty) => latest.assignments[duty]) : []
        )
      ])
    ]);
    const userNameById = new Map(users.map((user) => [user.id, user.name]));

    const toAssignments = (
      snapshot: ContractTakeoverHandoverSnapshot
    ): ContractTakeoverHandoverAssignmentReadModel[] =>
      CONTRACT_TAKEOVER_HANDOVER_DUTIES.map((duty) => ({
        duty,
        dutyLabel: CONTRACT_TAKEOVER_HANDOVER_DUTY_LABELS[duty],
        userId: snapshot.assignments[duty],
        userName: userNameById.get(snapshot.assignments[duty]) ?? null,
        roleKeys: roleKeysByUser.get(snapshot.assignments[duty]) ?? []
      }));

    return {
      projectId: takeover.projectId,
      takeoverId: takeover.id,
      contractId: takeover.contractId,
      takeoverStatus: takeover.takeoverStatus,
      takeoverLevel: takeover.takeoverLevel,
      takeoverLevelLabel:
        TAKEOVER_LEVEL_LABELS[(takeover.takeoverLevel ?? "").trim().toUpperCase()] ??
        "接管等级待确认",
      requiresHandover: requiresTakeoverHandover(takeover.takeoverLevel),
      registered: latest !== null,
      revision: latest?.revision ?? null,
      assignments: latest ? toAssignments(latest) : [],
      history: parsed.map(({ event, snapshot }) => ({
        revision: snapshot.revision,
        action: event.action as "handover_register" | "handover_reassign",
        actionLabel:
          event.action === CONTRACT_TAKEOVER_HANDOVER_ACTION_REASSIGN
            ? "更换接管责任人"
            : "接管分工登记",
        reason: event.reason,
        actorUserId: event.actorUserId,
        actorUserName: userNameById.get(event.actorUserId) ?? null,
        createdAt: event.createdAt.toISOString(),
        assignments: toAssignments(snapshot)
      })),
      actorDuty: latest
        ? CONTRACT_TAKEOVER_HANDOVER_DUTIES.find(
            (duty) => latest.assignments[duty] === actorUserId
          ) ?? null
        : null
    };
  }

  private async assertDutyAssignments(
    tx: HandoverClient,
    projectId: string,
    assignments: ContractTakeoverHandoverAssignments
  ): Promise<void> {
    const ids = CONTRACT_TAKEOVER_HANDOVER_DUTIES.map((duty) => assignments[duty]);
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, isActive: true }
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    for (const duty of CONTRACT_TAKEOVER_HANDOVER_DUTIES) {
      const user = userById.get(assignments[duty]);
      if (!user || !user.isActive) {
        throw new BadRequestException(
          `${CONTRACT_TAKEOVER_HANDOVER_DUTY_LABELS[duty]}负责人不存在或已停用`
        );
      }
    }
    const roleKeysByUser = await this.roleKeysByUser(tx, projectId, [...new Set(ids)]);
    for (const duty of CONTRACT_TAKEOVER_HANDOVER_DUTIES) {
      const rules = DUTY_POSITION_RULES[duty];
      const roleKeys = roleKeysByUser.get(assignments[duty]) ?? [];
      if (!roleKeys.some((key) => rules.allowed.has(key))) {
        throw new BadRequestException(
          `${CONTRACT_TAKEOVER_HANDOVER_DUTY_LABELS[duty]}负责人需为${rules.requirementText}`
        );
      }
    }
  }

  private async roleKeysByUser(
    tx: HandoverClient,
    projectId: string,
    userIds: string[]
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!userIds.length) return result;
    const [assignments, memberships] = await Promise.all([
      tx.userPosition.findMany({
        where: {
          userId: { in: userIds },
          OR: [{ projectId: null }, { projectId }]
        },
        select: { userId: true, positionId: true }
      }),
      tx.projectMember.findMany({
        where: { projectId, userId: { in: userIds } },
        select: { userId: true, positionKey: true }
      })
    ]);
    const positionIds = [...new Set(assignments.map((assignment) => assignment.positionId))];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const keyById = new Map(positions.map((position) => [position.id, position.key]));
    for (const assignment of assignments) {
      const key = keyById.get(assignment.positionId);
      if (key) appendRoleKey(result, assignment.userId, key);
    }
    for (const membership of memberships) {
      appendRoleKey(result, membership.userId, membership.positionKey);
    }
    return result;
  }
}

function appendRoleKey(map: Map<string, string[]>, userId: string, key: string) {
  const current = map.get(userId) ?? [];
  if (!current.includes(key)) current.push(key);
  map.set(userId, current);
}

function requiredUserId(value: string | undefined, label: string): string {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`请选择${label}`);
  return text;
}

function sameAssignments(
  left: ContractTakeoverHandoverAssignments,
  right: ContractTakeoverHandoverAssignments
): boolean {
  return CONTRACT_TAKEOVER_HANDOVER_DUTIES.every((duty) => left[duty] === right[duty]);
}

let fallbackIdempotencyCounter = 0;
function randomIdempotencyKey(): string {
  fallbackIdempotencyCounter += 1;
  return `handover-${Date.now()}-${fallbackIdempotencyCounter}`;
}
