import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  occurredBeforeEffectiveDate,
  optionalJsonText,
  requiredJsonDate,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson
} from "./formal-operating-source.helpers";
import type { AppendOperatingFactInput } from "./operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "./operating-source-adapter";

export const WAGE_STATEMENT_OPERATING_SOURCE_TYPE = "wage_statement_version";

type WageCostCell = {
  id: string;
  projectAllocationId: string;
  amountCents: bigint;
  componentCode: string;
  direction: "increase" | "decrease";
};

type WagePayableCell = {
  id: string;
  projectAllocationId: string;
  creditorBreakdownId: string;
  amountCents: bigint;
  payableRefId: string;
  direction: "increase" | "decrease";
};

interface WageProjectionMapping {
  readonly costCells: readonly WageCostCell[];
  readonly payableCells: readonly WagePayableCell[];
}

interface WageOperatingSourceSnapshot extends OperatingSourceSnapshot {
  readonly wageProjectionMapping: WageProjectionMapping;
}

/**
 * Rebuilds the same per-project wage envelope that confirmation writes.  The
 * persisted source snapshot deliberately contains only envelope coordinates;
 * matrix money and creditor/person data stay inside the controlled transaction
 * and are never copied into an OperatingFact snapshot.
 */
export class WageStatementOperatingSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = WAGE_STATEMENT_OPERATING_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.wageStatementVersion.findMany({
      where: {
        status: "confirmed",
        projectionOrigin: "ordinary",
        payableRefs: { some: { projectId } }
      },
      select: { id: true, revision: true, kind: true, operatingProjectionSnapshot: true },
      orderBy: [{ confirmedAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row, projectId)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    if (locator.sourceType !== this.sourceType) return null;
    const versionId = versionIdFromLocator(locator);
    const row = await tx.wageStatementVersion.findFirst({
      where: { id: versionId, status: "confirmed", projectionOrigin: "ordinary" },
      select: { id: true, revision: true, kind: true, operatingProjectionSnapshot: true }
    });
    if (!row) return null;
    return this.snapshot(tx, row, locator.projectId);
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const wageSnapshot = snapshot as WageOperatingSourceSnapshot;
    const mapping = wageSnapshot.wageProjectionMapping;
    if (!mapping) {
      throw new BadRequestException("工资经营来源缺少受控矩阵映射，不能重放");
    }
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "工资经营正式来源");
    const affiliate = requiredJsonRecord(source.affiliate, "工资经营施工企业");
    const occurredAt = requiredJsonDate(source, "occurredAt", "工资经营");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "工资经营");
    const effectiveDate = requiredJsonDate(source, "operatingLedgerEffectiveDate", "工资经营");
    const versionId = requiredJsonText(source, "wageStatementVersionId", "工资经营");
    const employmentCompanyId = requiredJsonText(source, "employmentCompanyId", "工资经营");
    if (
      requiredJsonText(source, "formalStatus", "工资经营") !== "confirmed" ||
      snapshot.sourceBusinessId !== `${versionId}:${snapshot.projectId}` ||
      requiredJsonText(source, "projectId", "工资经营") !== snapshot.projectId ||
      Number(requiredJsonText(source, "sourceVersion", "工资经营")) !== snapshot.sourceVersion
    ) {
      throw new BadRequestException("工资经营来源冻结坐标不一致");
    }

    const payableRefIds = source.payableRefIds;
    if (!Array.isArray(payableRefIds) || payableRefIds.some((id) => typeof id !== "string")) {
      throw new BadRequestException("工资经营来源缺少应付引用坐标");
    }
    const mappedRefIds = mapping.payableCells.map((cell) => cell.payableRefId);
    if (
      new Set(mappedRefIds).size !== mappedRefIds.length ||
      new Set(payableRefIds).size !== payableRefIds.length ||
      mappedRefIds.length !== payableRefIds.length ||
      mappedRefIds.some((id) => !payableRefIds.includes(id))
    ) {
      throw new BadRequestException("工资经营来源应付引用与冻结矩阵不一致");
    }
    const costAmount = sum(mapping.costCells.map((cell) => cell.amountCents));
    const payableAmount = sum(mapping.payableCells.map((cell) => cell.amountCents));
    const envelopeAmount = costAmount > payableAmount ? costAmount : payableAmount;
    if (envelopeAmount <= 0n || (!mapping.costCells.length && !mapping.payableCells.length)) {
      throw new BadRequestException("工资经营来源缺少非零冻结差量");
    }

    const debtor = { kind: "participating_company" as const, id: employmentCompanyId };
    const impacts: AppendOperatingFactInput["impacts"] = [
      ...mapping.costCells.map((cell) => ({
        idempotencyKey: `wage:${versionId}:${cell.id}:cost`,
        sourceImpactKey: `cost:${cell.id}`,
        impactKind: "confirmed_cost" as const,
        amountCents: cell.amountCents,
        direction: cell.direction,
        subjectRole: "cost_bearing_company" as const,
        subject: debtor,
        costCategoryCode: "crew_and_labor" as const,
        // This is a non-sensitive, frozen classification coordinate.  It
        // keeps each confirmed-cost impact distinguishable when the wage
        // version is replayed, without copying personnel or money details
        // into the project-wage envelope snapshot.
        impactSnapshot: sourceJson({ wageCostComponentCode: cell.componentCode })
      })),
      ...mapping.payableCells.map((cell) => ({
        idempotencyKey: `wage:${versionId}:${cell.id}:payable`,
        sourceImpactKey: `payable:${cell.id}`,
        impactKind: cell.direction === "increase" ? "payable_increase" as const : "payable_decrease" as const,
        amountCents: cell.amountCents,
        direction: cell.direction,
        impactSnapshot: sourceJson({ wagePayableRefId: cell.payableRefId })
      }))
    ];
    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `wage:${versionId}:${snapshot.projectId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "工资经营"),
        factKind: "project_wage",
        operatingLevel: "participating_company",
        evidenceLevel: "A",
        amountCents: envelopeAmount,
        currencyCode: "CNY",
        direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          occurredAt,
          effectiveDate
        ),
        affiliateAssignmentId: requiredJsonText(affiliate, "assignmentId", "工资经营"),
        affiliateBusinessPartyVersionId: requiredJsonText(
          affiliate,
          "businessPartyVersionId",
          "工资经营"
        ),
        affiliateNameSnapshot: requiredJsonText(affiliate, "name", "工资经营"),
        ...(optionalJsonText(affiliate, "creditCode")
          ? { affiliateCreditCodeSnapshot: optionalJsonText(affiliate, "creditCode") }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        subjects: { debtor, costBearingCompany: debtor },
        impacts
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: { id: string; revision: number; kind: string; operatingProjectionSnapshot: Prisma.JsonValue | null },
    projectId: string
  ): Promise<WageOperatingSourceSnapshot> {
    const projection = requiredJsonRecord(
      row.operatingProjectionSnapshot as Prisma.InputJsonValue,
      "工资经营冻结投影"
    );
    if (
      requiredJsonText(projection, "wageStatementVersionId", "工资经营冻结投影") !== row.id ||
      Number(requiredJsonText(projection, "sourceVersion", "工资经营冻结投影")) !== row.revision ||
      requiredJsonText(projection, "wageVersionKind", "工资经营冻结投影") !== wageVersionKind(row.kind)
    ) {
      throw new BadRequestException("工资经营冻结投影与确认版本不一致");
    }
    const projects = requiredJsonRecord(projection.projects, "工资经营冻结投影项目集合");
    const project = requiredJsonRecord(projects[projectId], "工资经营冻结投影项目");
    if (requiredJsonText(project, "projectId", "工资经营冻结投影项目") !== projectId) {
      throw new BadRequestException("工资经营冻结投影项目坐标不一致");
    }
    // The stored OperatingFact envelope is project-local, while the wage
    // version retains all project envelopes in one immutable root snapshot.
    const envelope = sourceJson({
      formalStatus: requiredJsonText(projection, "formalStatus", "工资经营冻结投影"),
      wageStatementVersionId: row.id,
      sourceVersion: String(row.revision),
      wageVersionKind: wageVersionKind(row.kind),
      ...project
    });
    const mapping = await this.readMapping(tx, row.id, projectId, wageVersionKind(row.kind), envelope);
    return {
      projectId,
      sourceType: this.sourceType,
      sourceBusinessId: `${row.id}:${projectId}`,
      sourceBusinessCode: `工资承担单-${row.revision}`,
      sourceVersion: row.revision,
      status: "confirmed",
      sourceSnapshot: envelope,
      wageProjectionMapping: mapping
    };
  }

  private async readMapping(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    versionId: string,
    projectId: string,
    kind: WageVersionKind,
    sourceSnapshot: Prisma.InputJsonObject
  ): Promise<WageProjectionMapping> {
    const [costRows, refs] = await Promise.all([
      tx.wageProjectCostComponentAllocation.findMany({
        where: { projectAllocation: { projectId, personLine: { statementVersionId: versionId } } },
        select: {
          id: true,
          projectAllocationId: true,
          amountCents: true,
          costComponent: { select: { componentCode: true } },
          projectAllocation: { select: { projectId: true, serviceSnapshotId: true, personLine: { select: { employeeId: true, employmentSnapshotId: true } } } }
        },
        orderBy: { id: "asc" }
      }),
      tx.wagePayableRef.findMany({
        where: { confirmedVersionId: versionId, projectId },
        select: {
          id: true,
          projectAllocationId: true,
          creditorBreakdownId: true,
          amountCents: true,
          direction: true,
          adjustsPayableRefId: true,
          settlementRecheckRequired: true
        },
        orderBy: { id: "asc" }
      })
    ]);
    const costDeltaRows = sourceSnapshot.costDeltaCells;
    if (!Array.isArray(costDeltaRows) || costDeltaRows.some((cell) => !cell || typeof cell !== "object")) {
      throw new BadRequestException("工资经营来源缺少冻结成本差量坐标");
    }
    const costDirections = new Map(costDeltaRows.map((cell) => {
      const value = cell as Record<string, unknown>;
      if (typeof value.id !== "string" || (value.direction !== "increase" && value.direction !== "decrease")) {
        throw new BadRequestException("工资经营来源成本差量坐标不正确");
      }
      return [value.id, value.direction] as const;
    }));
    const priorCostByIdentity = kind === "base" ? new Map<string, bigint>() : await this.priorCostByIdentity(tx, versionId, projectId);
    const costCells = costRows.filter((row) => costDirections.has(row.id)).map((row) => {
      const key = costIdentity(row.projectAllocation.projectId, row.projectAllocation.serviceSnapshotId, row.projectAllocation.personLine.employeeId, row.projectAllocation.personLine.employmentSnapshotId, row.costComponent.componentCode);
      const delta = kind === "base" ? row.amountCents : row.amountCents - (priorCostByIdentity.get(key) ?? 0n);
      const direction = costDirections.get(row.id)!;
      if (delta === 0n || (delta > 0n ? "increase" : "decrease") !== direction) {
        throw new BadRequestException("工资经营来源成本差量与冻结版本不一致");
      }
      return {
      id: row.id,
      projectAllocationId: row.projectAllocationId,
      amountCents: delta < 0n ? -delta : delta,
      componentCode: row.costComponent.componentCode,
      direction
      };
    });
    if (costCells.length !== costDirections.size) throw new BadRequestException("工资经营来源成本差量坐标与冻结矩阵不一致");
    for (const ref of refs) {
      const hasDirectBaseTarget = typeof ref.adjustsPayableRefId === "string" && ref.adjustsPayableRefId.length > 0;
      const isBaseOrSupplemental = kind === "base" || kind === "supplemental";
      const isControlledIncrease = ref.direction === "increase" && !ref.settlementRecheckRequired &&
        (isBaseOrSupplemental ? !hasDirectBaseTarget : hasDirectBaseTarget);
      const isControlledDecrease = !isBaseOrSupplemental && ref.direction === "decrease" &&
        hasDirectBaseTarget && ref.settlementRecheckRequired;
      if (!isControlledIncrease && !isControlledDecrease) {
        throw new BadRequestException("工资经营来源应付引用与版本处置不一致");
      }
    }
    const payableCells = refs.map((ref) => ({
      id: ref.id, projectAllocationId: ref.projectAllocationId, creditorBreakdownId: ref.creditorBreakdownId,
      amountCents: ref.amountCents, payableRefId: ref.id, direction: ref.direction as "increase" | "decrease"
    }));
    return { costCells, payableCells };
  }

  private async priorCostByIdentity(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0], versionId: string, projectId: string
  ) {
    const current = await tx.wageStatementVersion.findUnique({ where: { id: versionId }, select: { statementId: true, revision: true } });
    if (!current) throw new BadRequestException("工资经营来源版本不存在");
    const prior = await tx.wageStatementVersion.findFirst({
      where: { statementId: current.statementId, revision: { lt: current.revision }, status: "confirmed" },
      orderBy: { revision: "desc" }, select: { id: true }
    });
    if (!prior) throw new BadRequestException("工资经营来源缺少已确认前置版本");
    const rows = await tx.wageProjectCostComponentAllocation.findMany({
      where: { projectAllocation: { projectId, personLine: { statementVersionId: prior.id } } },
      select: {
        amountCents: true, costComponent: { select: { componentCode: true } },
        projectAllocation: { select: { projectId: true, serviceSnapshotId: true, personLine: { select: { employeeId: true, employmentSnapshotId: true } } } }
      }
    });
    const result = new Map<string, bigint>();
    for (const row of rows) {
      const key = costIdentity(row.projectAllocation.projectId, row.projectAllocation.serviceSnapshotId, row.projectAllocation.personLine.employeeId, row.projectAllocation.personLine.employmentSnapshotId, row.costComponent.componentCode);
      if (result.has(key)) throw new BadRequestException("工资经营前置版本存在重复成本身份");
      result.set(key, row.amountCents);
    }
    return result;
  }
}

type WageVersionKind = "base" | "supplemental" | "correction" | "reversal";

function wageVersionKind(value: string): WageVersionKind {
  if (value === "base" || value === "supplemental" || value === "correction" || value === "reversal") return value;
  throw new BadRequestException("工资版本处置类型不受支持，不能重放");
}

function versionIdFromLocator(locator: OperatingSourceLocator): string {
  const suffix = `:${locator.projectId}`;
  if (!locator.sourceBusinessId.endsWith(suffix)) {
    throw new BadRequestException("工资经营来源业务坐标不正确");
  }
  const versionId = locator.sourceBusinessId.slice(0, -suffix.length);
  if (!versionId) throw new BadRequestException("工资经营来源业务坐标不正确");
  return versionId;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function costIdentity(projectId: string, serviceSnapshotId: string, employeeId: string, employmentSnapshotId: string, componentCode: string) {
  return `${projectId}:${serviceSnapshotId}:${employeeId}:${employmentSnapshotId}:${componentCode}`;
}
