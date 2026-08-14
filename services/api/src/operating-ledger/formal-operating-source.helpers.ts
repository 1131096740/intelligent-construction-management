import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { OperatingLedgerTransaction } from "./operating-ledger.service";

export interface FrozenAffiliateSnapshot {
  assignmentId: string;
  businessPartyVersionId: string;
  name: string;
  creditCode?: string;
}

export async function readOperatingLedgerEffectiveDate(
  tx: OperatingLedgerTransaction,
  projectId: string
): Promise<Date> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { operatingLedgerEffectiveDate: true }
  });
  if (!project?.operatingLedgerEffectiveDate) {
    throw new BadRequestException("项目尚未启用经营账，不能读取正式经营来源");
  }
  return project.operatingLedgerEffectiveDate;
}

export async function readAffiliateSnapshot(
  tx: OperatingLedgerTransaction,
  input: {
    projectId: string;
    occurredAt: Date;
    assignmentId?: string | null;
    businessPartyVersionId?: string | null;
  }
): Promise<FrozenAffiliateSnapshot> {
  const assignment = await tx.projectAffiliateAssignment.findFirst({
    where: {
      projectId: input.projectId,
      ...(input.assignmentId ? { id: input.assignmentId } : {}),
      ...(input.businessPartyVersionId
        ? { businessPartyVersionId: input.businessPartyVersionId }
        : {}),
      AND: [
        { effectiveFrom: { lte: input.occurredAt } },
        { OR: [{ endedAt: null }, { endedAt: { gt: input.occurredAt } }] }
      ]
    },
    select: {
      id: true,
      businessPartyVersionId: true,
      affiliateNameSnapshot: true,
      affiliateCreditCodeSnapshot: true
    },
    orderBy: { effectiveFrom: "desc" }
  });
  if (!assignment) {
    throw new BadRequestException("正式来源在业务发生日缺少有效施工企业快照");
  }
  return {
    assignmentId: assignment.id,
    businessPartyVersionId: assignment.businessPartyVersionId,
    name: assignment.affiliateNameSnapshot,
    ...(assignment.affiliateCreditCodeSnapshot
      ? { creditCode: assignment.affiliateCreditCodeSnapshot }
      : {})
  };
}

export function sourceJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

export function requiredJsonRecord(
  value: Prisma.InputJsonValue,
  label: string
): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label}快照格式不正确`);
  }
  return value as Record<string, Prisma.InputJsonValue>;
}

export function requiredJsonText(
  record: Record<string, Prisma.InputJsonValue>,
  key: string,
  label: string
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}快照缺少${key}`);
  }
  return value.trim();
}

export function optionalJsonText(
  record: Record<string, Prisma.InputJsonValue>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredJsonMoney(
  record: Record<string, Prisma.InputJsonValue>,
  key: string,
  label: string
): bigint {
  const value = requiredJsonText(record, key, label);
  if (!/^-?\d+$/u.test(value)) {
    throw new BadRequestException(`${label}快照金额必须使用整数分`);
  }
  return BigInt(value);
}

export function requiredJsonDate(
  record: Record<string, Prisma.InputJsonValue>,
  key: string,
  label: string
): Date {
  const value = requiredJsonText(record, key, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label}快照日期格式不正确`);
  }
  return parsed;
}

export function frozenAffiliateFromJson(
  record: Record<string, Prisma.InputJsonValue>,
  label: string
): FrozenAffiliateSnapshot {
  const affiliate = requiredJsonRecord(record.affiliate, `${label}施工企业`);
  return {
    assignmentId: requiredJsonText(affiliate, "assignmentId", label),
    businessPartyVersionId: requiredJsonText(
      affiliate,
      "businessPartyVersionId",
      label
    ),
    name: requiredJsonText(affiliate, "name", label),
    ...(optionalJsonText(affiliate, "creditCode")
      ? { creditCode: optionalJsonText(affiliate, "creditCode") }
      : {})
  };
}

export function occurredBeforeEffectiveDate(
  occurredAt: Date,
  operatingLedgerEffectiveDate: Date
): boolean {
  return dateOnly(occurredAt) < dateOnly(operatingLedgerEffectiveDate);
}

export function stableNamedSubjectId(prefix: string, name: string): string {
  return `${prefix}:${name.trim()}`;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
