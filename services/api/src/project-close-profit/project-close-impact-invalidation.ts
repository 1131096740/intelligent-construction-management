import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { ProjectStage } from "@jiangkong/shared-domain";

import { resolveProjectCloseImpactPolicy } from "./project-close-impact-policy";

type NewOperatingImpact = Readonly<{
  id: string;
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceImpactKey: string;
  impactKind: string;
  amountCents: bigint;
  direction: string;
  subjectId?: string;
  observedAt: Date;
  actorUserId: string;
}>;

type ParticipationChange = Readonly<{
  projectId: string;
  participantId: string;
  companyEntityId: string;
  companyEntityVersionId: string;
  effectiveFrom: Date;
  endedAt: Date | null;
  mutation: "added" | "ended" | "removed";
  observedAt: Date;
  actorUserId: string;
}>;

type InvalidationSource = Readonly<{
  projectId: string;
  sourceType: string;
  sourceId: string;
  sourceFingerprint: string;
  reason: string;
  affectedStages: readonly ProjectStage[];
  observedAt: Date;
  actorUserId: string;
  basis: Prisma.InputJsonObject;
}>;

export async function invalidateProjectCloseForOperatingImpact(
  tx: Prisma.TransactionClient,
  impact: NewOperatingImpact
): Promise<void> {
  const policy = resolveProjectCloseImpactPolicy(impact.impactKind);
  if (policy.affectedStages.length === 0) return;
  await appendProjectCloseInvalidation(tx, {
    projectId: impact.projectId,
    sourceType: impact.sourceType,
    sourceId: `${impact.sourceBusinessId}:${impact.sourceImpactKey}`,
    sourceFingerprint: fingerprint({
      impactKind: impact.impactKind,
      amountCents: impact.amountCents.toString(),
      direction: impact.direction,
      subjectId: impact.subjectId ?? null
    }),
    reason: policy.reason,
    affectedStages: policy.affectedStages,
    observedAt: impact.observedAt,
    actorUserId: impact.actorUserId,
    basis: { operatingImpactEntryId: impact.id }
  });
}

export async function invalidateProjectCloseForParticipationChange(
  tx: Prisma.TransactionClient,
  change: ParticipationChange
): Promise<void> {
  await appendProjectCloseInvalidation(tx, {
    projectId: change.projectId,
    sourceType: "project_participating_company",
    sourceId: change.participantId,
    sourceFingerprint: projectParticipationChangeFingerprint(change),
    reason: "项目参与公司或分配关系发生变化",
    affectedStages: ["profit_distribution_completed", "project_funds_cleared"],
    observedAt: change.observedAt,
    actorUserId: change.actorUserId,
    basis: {
      projectParticipatingCompanyId: change.participantId,
      mutation: change.mutation
    }
  });
}

export function projectParticipationChangeFingerprint(change: Pick<
  ParticipationChange,
  "companyEntityId" | "companyEntityVersionId" | "effectiveFrom" | "endedAt" | "mutation"
>): string {
  return fingerprint({
    companyEntityId: change.companyEntityId,
    companyEntityVersionId: change.companyEntityVersionId,
    effectiveFrom: change.effectiveFrom.toISOString(),
    endedAt: change.endedAt?.toISOString() ?? null,
    mutation: change.mutation
  });
}

async function appendProjectCloseInvalidation(
  tx: Prisma.TransactionClient,
  source: InvalidationSource
): Promise<void> {
  if (!tx.projectCloseAggregate?.findUnique) return;
  const aggregate = await tx.projectCloseAggregate.findUnique({
    where: { projectId: source.projectId },
    select: { projectId: true }
  });
  if (!aggregate) return;

  await tx.$executeRaw(Prisma.sql`
    SELECT 1 FROM "ProjectCloseAggregate"
    WHERE "projectId" = ${source.projectId}
    FOR UPDATE
  `);
  const existing = await tx.projectCloseImpact.findUnique({
    where: {
      projectId_sourceType_sourceId_sourceFingerprint: {
        projectId: source.projectId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceFingerprint: source.sourceFingerprint
      }
    },
    select: { id: true }
  });
  if (existing) return;

  const versions = await tx.projectCloseStageVersion.findMany({
    where: {
      projectId: source.projectId,
      stageKey: { in: [...source.affectedStages] }
    },
    orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
  });
  const latest = new Map<ProjectStage, typeof versions[number]>();
  for (const version of versions) {
    const stageKey = version.stageKey as ProjectStage;
    if (!latest.has(stageKey)) latest.set(stageKey, version);
  }
  const affectedStages = source.affectedStages.filter((stageKey) => {
    const version = latest.get(stageKey);
    return version?.status === "completed" && version.projectionCutoffAt < source.observedAt;
  });
  if (affectedStages.length === 0) return;

  const projectionFingerprint = affectedStages
    .map((stageKey) => latest.get(stageKey)?.projectionFingerprint)
    .find((value): value is string => Boolean(value)) ?? source.sourceFingerprint;
  const closeImpact = await tx.projectCloseImpact.create({
    data: {
      projectId: source.projectId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceFingerprint: source.sourceFingerprint,
      reason: source.reason,
      affectedStages: [...affectedStages],
      observedAt: source.observedAt,
      projectionFingerprint,
      idempotencyKey: randomUUID(),
      payloadFingerprint: fingerprint({
        sourceFingerprint: source.sourceFingerprint,
        affectedStages,
        observedAt: source.observedAt.toISOString()
      })
    }
  });

  for (const stageKey of affectedStages) {
    const previous = latest.get(stageKey)!;
    await tx.projectCloseStageVersion.create({
      data: {
        projectId: source.projectId,
        stageKey,
        revision: previous.revision + 1,
        status: "needs_reconfirmation",
        previousVersionId: previous.id,
        projectionReadAt: previous.projectionReadAt,
        projectionCutoffAt: previous.projectionCutoffAt,
        projectionFingerprint: previous.projectionFingerprint,
        amountSnapshot: previous.amountSnapshot as Prisma.InputJsonValue,
        stateSnapshot: previous.stateSnapshot as Prisma.InputJsonValue,
        basisSnapshot: {
          reason: source.reason,
          projectCloseImpactId: closeImpact.id,
          ...source.basis
        },
        confirmedByUserId: source.actorUserId,
        confirmedAt: source.observedAt,
        idempotencyKey: randomUUID(),
        payloadFingerprint: fingerprint({
          projectCloseImpactId: closeImpact.id,
          stageKey,
          previousVersionId: previous.id
        })
      }
    });
  }
  await tx.projectCloseAggregate.update({
    where: { projectId: source.projectId },
    data: { revision: { increment: affectedStages.length } }
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
