import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { PrismaService } from "../database/prisma.service";
import { loadSettlementLineOccupancy } from "../settlement/settlement-line-occupancy";
import type {
  ConfirmContractBillTransitionsDto,
  DiscardContractBillTransitionsDto,
  SaveContractBillTransitionDto
} from "./dto/contract-bill-transition.dto";

const EDITABLE_VERSION_STATUSES = new Set(["draft", "approval_rejected"]);
const DECIMAL_SCALE = 6;

type ParsedMapping = {
  sourceContractBillRowId: string;
  targetContractBillRowId: string;
  sourceSettledQuantityAllocated: Prisma.Decimal;
  targetOpeningQuantity: Prisma.Decimal;
  settledAmountAllocatedCents: bigint;
  quantityConversionBasis: string | null;
  relationType: "one_to_one" | "split" | "merge";
};

@Injectable()
export class ContractBillTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  saveDraftMappings(
    toContractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseSaveInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const context = await this.lockEditablePair(
        tx,
        input.fromContractVersionId,
        toContractVersionId,
        actorUserId,
        input.expectedTargetVersionRevision,
        false
      );
      const mappings = await this.resolveMappings(tx, input.mappings, context);
      const sourceIds = [...new Set(mappings.map((mapping) => mapping.sourceContractBillRowId))];
      const targetIds = [...new Set(mappings.map((mapping) => mapping.targetContractBillRowId))];
      await this.assertMappingsNotFrozenByRemainderCancellation(
        tx,
        context,
        sourceIds,
        targetIds
      );
      const existing = await tx.contractBillRowTransition.findMany({
        where: {
          fromContractVersionId: context.fromVersion.id,
          toContractVersionId: context.toVersion.id,
          status: "confirmed",
          matchBasis: { not: "clone_row_key" },
          OR: [
            { sourceContractBillRowId: { in: sourceIds } },
            { targetContractBillRowId: { in: targetIds } }
          ]
        }
      });
      if (existing.length) {
        throw new ConflictException("存在合同部主任已确认的跨版本映射，不能原地修改；请通过新合同版本修正");
      }
      await tx.contractBillRowTransition.updateMany({
        where: {
          fromContractVersionId: context.fromVersion.id,
          toContractVersionId: context.toVersion.id,
          sourceContractBillRowId: { in: sourceIds },
          status: "draft"
        },
        data: { status: "invalidated", revision: { increment: 1 } }
      });
      await tx.contractBillRowTransition.updateMany({
        where: {
          fromContractVersionId: context.fromVersion.id,
          toContractVersionId: context.toVersion.id,
          status: "confirmed",
          matchBasis: "clone_row_key",
          sourceSettledQuantityAllocated: null,
          targetOpeningQuantity: null,
          settledAmountAllocatedCents: null,
          OR: [
            { sourceContractBillRowId: { in: sourceIds } },
            { targetContractBillRowId: { in: targetIds } }
          ]
        },
        data: { status: "invalidated", revision: { increment: 1 } }
      });
      await Promise.all(mappings.map((mapping) => tx.contractBillRowTransition.upsert({
        where: {
          fromContractVersionId_toContractVersionId_sourceContractBillRowId_targetContractBillRowId: {
            fromContractVersionId: context.fromVersion.id,
            toContractVersionId: context.toVersion.id,
            sourceContractBillRowId: mapping.sourceContractBillRowId,
            targetContractBillRowId: mapping.targetContractBillRowId
          }
        },
        create: {
          contractId: context.toVersion.contractId,
          fromContractVersionId: context.fromVersion.id,
          toContractVersionId: context.toVersion.id,
          sourceContractBillRowId: mapping.sourceContractBillRowId,
          targetContractBillRowId: mapping.targetContractBillRowId,
          relationType: mapping.relationType,
          matchBasis: "manual",
          sourceSettledQuantityAllocated: mapping.sourceSettledQuantityAllocated,
          targetOpeningQuantity: mapping.targetOpeningQuantity,
          settledAmountAllocatedCents: mapping.settledAmountAllocatedCents,
          quantityConversionBasis: mapping.quantityConversionBasis,
          status: "draft",
          revision: 1
        },
        update: {
          relationType: mapping.relationType,
          matchBasis: "manual",
          sourceSettledQuantityAllocated: mapping.sourceSettledQuantityAllocated,
          targetOpeningQuantity: mapping.targetOpeningQuantity,
          settledAmountAllocatedCents: mapping.settledAmountAllocatedCents,
          quantityConversionBasis: mapping.quantityConversionBasis,
          status: "draft",
          confirmedByUserId: null,
          confirmedAt: null,
          revision: { increment: 1 }
        }
      })));
      await this.bumpRevision(tx, context.toVersion.id, input.expectedTargetVersionRevision);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.bill.transition.draft.save",
        businessType: "contract_version",
        businessId: context.toVersion.id,
        metadata: {
          fromContractVersionId: context.fromVersion.id,
          mappingCount: mappings.length,
          revisionBefore: input.expectedTargetVersionRevision,
          revisionAfter: input.expectedTargetVersionRevision + 1
        }
      });
      return this.readMappings(tx, context.fromVersion.id, context.toVersion.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  confirmDraftMappings(
    toContractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseConfirmInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const context = await this.lockEditablePair(
        tx,
        undefined,
        toContractVersionId,
        actorUserId,
        input.expectedTargetVersionRevision,
        true
      );
      const transitions = await tx.contractBillRowTransition.findMany({
        where: {
          fromContractVersionId: context.fromVersion.id,
          toContractVersionId: context.toVersion.id,
          status: "draft",
          matchBasis: "manual"
        }
      });
      if (!transitions.length) {
        throw new BadRequestException("当前合同版本没有待确认的人工跨版本映射");
      }
      await this.assertMappingsNotFrozenByRemainderCancellation(
        tx,
        context,
        [...new Set(transitions.map((transition) => transition.sourceContractBillRowId))],
        [...new Set(transitions.map((transition) => transition.targetContractBillRowId))]
      );
      await this.assertDraftMappingsConserved(tx, context, transitions);
      const confirmedAt = new Date();
      const confirmed = await tx.contractBillRowTransition.updateMany({
        where: { id: { in: transitions.map((transition) => transition.id) }, status: "draft" },
        data: {
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt,
          revision: { increment: 1 }
        }
      });
      if (confirmed.count !== transitions.length) {
        throw new ConflictException("人工跨版本映射已变化，请刷新后重新确认");
      }
      await this.bumpRevision(tx, context.toVersion.id, input.expectedTargetVersionRevision);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.bill.transition.confirm",
        businessType: "contract_version",
        businessId: context.toVersion.id,
        metadata: {
          fromContractVersionId: context.fromVersion.id,
          mappingCount: transitions.length,
          revisionBefore: input.expectedTargetVersionRevision,
          revisionAfter: input.expectedTargetVersionRevision + 1
        }
      });
      return this.readMappings(tx, context.fromVersion.id, context.toVersion.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  discardDraftMappings(
    toContractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseDiscardInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const context = await this.lockEditablePair(
        tx,
        input.fromContractVersionId,
        toContractVersionId,
        actorUserId,
        input.expectedTargetVersionRevision,
        false
      );
      await this.assertMappingsNotFrozenByRemainderCancellation(
        tx,
        context,
        [],
        [],
        true
      );
      const discarded = await tx.contractBillRowTransition.updateMany({
        where: {
          fromContractVersionId: context.fromVersion.id,
          toContractVersionId: context.toVersion.id,
          status: "draft",
          matchBasis: "manual"
        },
        data: { status: "invalidated", revision: { increment: 1 } }
      });
      if (!discarded.count) {
        throw new BadRequestException("当前合同版本没有可撤销的未确认跨版本映射");
      }
      await this.bumpRevision(tx, context.toVersion.id, input.expectedTargetVersionRevision);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.bill.transition.draft.discard",
        businessType: "contract_version",
        businessId: context.toVersion.id,
        metadata: {
          fromContractVersionId: context.fromVersion.id,
          mappingCount: discarded.count,
          revisionBefore: input.expectedTargetVersionRevision,
          revisionAfter: input.expectedTargetVersionRevision + 1
        }
      });
      return this.readMappings(tx, context.fromVersion.id, context.toVersion.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listMappings(toContractVersionId: string, actorUserId: string) {
    const version = await this.prisma.contractVersion.findUnique({ where: { id: toContractVersionId } });
    if (!version) throw new NotFoundException("合同草稿版本不存在");
    const contract = await this.prisma.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("合同不存在");
    if (contract.ownerUserId !== actorUserId && !(await this.hasGlobalContractDirector(this.prisma, actorUserId))) {
      throw new ForbiddenException("当前账号无权查看该合同的跨版本映射");
    }
    if (!version.baseVersionId) return [];
    return this.readMappings(this.prisma, version.baseVersionId, version.id);
  }

  async listOptions(toContractVersionId: string, actorUserId: string) {
    const version = await this.prisma.contractVersion.findUnique({ where: { id: toContractVersionId } });
    if (!version) throw new NotFoundException("合同草稿版本不存在");
    const contract = await this.prisma.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("合同不存在");
    const canConfirm = await this.hasGlobalContractDirector(this.prisma, actorUserId);
    if (contract.ownerUserId !== actorUserId && !canConfirm) {
      throw new ForbiddenException("当前账号无权查看该合同的跨版本映射");
    }
    if (!version.baseVersionId) return { fromContractVersionId: null, canConfirm, sources: [], targets: [] };
    const [sourceBills, targetBills] = await Promise.all([
      this.prisma.contractBill.findMany({ where: { contractVersionId: version.baseVersionId }, select: { id: true } }),
      this.prisma.contractBill.findMany({ where: { contractVersionId: version.id }, select: { id: true } })
    ]);
    const [sourceRows, targetRows] = await Promise.all([
      sourceBills.length ? this.prisma.contractBillRow.findMany({ where: { contractBillId: { in: sourceBills.map((bill) => bill.id) } }, select: { id: true, lineageId: true, itemName: true, specification: true, unit: true } }) : [],
      targetBills.length ? this.prisma.contractBillRow.findMany({ where: { contractBillId: { in: targetBills.map((bill) => bill.id) } }, select: { id: true, itemName: true, specification: true, unit: true } }) : []
    ]);
    const occupancy = await loadSettlementLineOccupancy(
      this.prisma,
      version.baseVersionId,
      sourceRows,
      { mode: "irreversible_history" }
    );
    return {
      fromContractVersionId: version.baseVersionId,
      canConfirm,
      sources: sourceRows.map((row) => {
        const facts = occupancy.get(row.id);
        return {
          ...row,
          historicalQuantity: facts?.quantityComplete
            ? facts.quantity.toString()
            : null,
          historicalAmountCents: facts?.amountCents.toString() ?? "0",
          hasReversibleOccupancy: facts?.hasReversibleOccupancy ?? false
        };
      }).filter((row) => row.historicalQuantity !== null || row.historicalAmountCents !== "0"),
      targets: targetRows
    };
  }

  private async lockEditablePair(
    tx: Prisma.TransactionClient,
    requestedFromVersionId: string | undefined,
    toContractVersionId: string,
    actorUserId: string,
    expectedTargetVersionRevision: number,
    requireDirector: boolean
  ) {
    if (!Number.isInteger(expectedTargetVersionRevision) || expectedTargetVersionRevision < 1) {
      throw new BadRequestException("合同草稿版本号不正确，请刷新后重试");
    }
    if (requireDirector) await this.assertGlobalContractDirector(tx, actorUserId);
    const mutationBoundary =
      await lockContractDraftMutationBoundary<
        NonNullable<
          Awaited<ReturnType<typeof tx.contractVersion.findUnique>>
        >,
        NonNullable<
          Awaited<ReturnType<typeof tx.contract.findUnique>>
        >
      >(tx, toContractVersionId);
    if (!mutationBoundary) {
      throw new NotFoundException("合同草稿版本不存在");
    }
    const { version: toVersion, contract } = mutationBoundary;
    if (!EDITABLE_VERSION_STATUSES.has(toVersion.status)) {
      throw new BadRequestException("当前合同草稿状态不可维护跨版本映射");
    }
    if (toVersion.changeType === "historical_takeover") {
      throw new BadRequestException("历史接管草稿必须在历史接管工作台办理");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException(
        "合同已存在正式业务事实，不能维护跨版本映射"
      );
    }
    if (toVersion.draftRevision !== expectedTargetVersionRevision) {
      throw new ConflictException("合同草稿已被他人更新，请刷新后重新编辑");
    }
    if (!toVersion.baseVersionId) {
      throw new BadRequestException("原始合同没有相邻旧版本，不能维护跨版本映射");
    }
    if (requestedFromVersionId && requestedFromVersionId !== toVersion.baseVersionId) {
      throw new BadRequestException("跨版本映射必须选择该变更合同的直接来源版本");
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ContractVersion" WHERE "id" = ${toVersion.baseVersionId} FOR UPDATE
    `);
    const fromVersion = await tx.contractVersion.findUnique({ where: { id: toVersion.baseVersionId } });
    if (!fromVersion || fromVersion.contractId !== toVersion.contractId) {
      throw new BadRequestException("直接来源合同版本无效，请刷新后重试");
    }
    if (!requireDirector) {
      if (contract.ownerUserId !== actorUserId) {
        throw new ForbiddenException("只有合同草稿经办人可以维护未确认跨版本映射");
      }
    }
    return { fromVersion, toVersion };
  }

  private async resolveMappings(
    tx: Prisma.TransactionClient,
    rawMappings: SaveContractBillTransitionDto["mappings"],
    context: Awaited<ReturnType<ContractBillTransitionService["lockEditablePair"]>>
  ) {
    if (!rawMappings.length) throw new BadRequestException("请至少保留一条跨版本映射");
    const pairKeys = new Set<string>();
    const parsed = rawMappings.map((mapping, index) => {
      const sourceContractBillRowId = this.requireId(mapping?.sourceContractBillRowId, `第 ${index + 1} 条映射的来源行`);
      const targetContractBillRowId = this.requireId(mapping?.targetContractBillRowId, `第 ${index + 1} 条映射的目标行`);
      const key = `${sourceContractBillRowId}:${targetContractBillRowId}`;
      if (pairKeys.has(key)) throw new BadRequestException("同一来源行和目标行不能重复映射");
      pairKeys.add(key);
      return {
        sourceContractBillRowId,
        targetContractBillRowId,
        sourceSettledQuantityAllocated: this.parsePositiveDecimal(mapping.sourceSettledQuantityAllocated, "来源历史数量分配"),
        targetOpeningQuantity: this.parsePositiveDecimal(mapping.targetOpeningQuantity, "目标期初数量"),
        settledAmountAllocatedCents: this.parseIntegerCents(mapping.settledAmountAllocatedCents),
        quantityConversionBasis: typeof mapping.quantityConversionBasis === "string" && mapping.quantityConversionBasis.trim()
          ? mapping.quantityConversionBasis.trim()
          : null
      };
    });
    const rowIds = [...new Set(parsed.flatMap((mapping) => [mapping.sourceContractBillRowId, mapping.targetContractBillRowId]))];
    const rows = await tx.contractBillRow.findMany({ where: { id: { in: rowIds } } });
    if (rows.length !== rowIds.length) throw new BadRequestException("存在已删除的合同清单行，请刷新后重试");
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const bills = await tx.contractBill.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.contractBillId))] } },
      select: { id: true, contractVersionId: true }
    });
    const versionByBillId = new Map(bills.map((bill) => [bill.id, bill.contractVersionId]));
    for (const mapping of parsed) {
      const source = rowsById.get(mapping.sourceContractBillRowId)!;
      const target = rowsById.get(mapping.targetContractBillRowId)!;
      if (versionByBillId.get(source.contractBillId) !== context.fromVersion.id || versionByBillId.get(target.contractBillId) !== context.toVersion.id) {
        throw new BadRequestException("映射行不属于选定的相邻合同版本");
      }
      if (source.unit !== target.unit && !mapping.quantityConversionBasis) {
        throw new BadRequestException("来源和目标单位不一致时必须填写数量换算依据");
      }
      if (source.unit === target.unit && !mapping.sourceSettledQuantityAllocated.equals(mapping.targetOpeningQuantity)) {
        throw new BadRequestException("相同单位的来源数量分配与目标期初数量必须相等");
      }
    }
    const sourceCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();
    for (const mapping of parsed) {
      sourceCounts.set(mapping.sourceContractBillRowId, (sourceCounts.get(mapping.sourceContractBillRowId) ?? 0) + 1);
      targetCounts.set(mapping.targetContractBillRowId, (targetCounts.get(mapping.targetContractBillRowId) ?? 0) + 1);
    }
    if (parsed.some((mapping) => (sourceCounts.get(mapping.sourceContractBillRowId) ?? 0) > 1 && (targetCounts.get(mapping.targetContractBillRowId) ?? 0) > 1)) {
      throw new BadRequestException("一批人工映射不能形成多对多网状关系，请拆分为清晰的一对多或多对一关系");
    }
    return parsed.map((mapping): ParsedMapping => ({
      ...mapping,
      relationType: (sourceCounts.get(mapping.sourceContractBillRowId) ?? 0) > 1
        ? "split"
        : (targetCounts.get(mapping.targetContractBillRowId) ?? 0) > 1
          ? "merge"
          : "one_to_one"
    }));
  }

  private async assertDraftMappingsConserved(
    tx: Prisma.TransactionClient,
    context: Awaited<ReturnType<ContractBillTransitionService["lockEditablePair"]>>,
    transitions: Awaited<ReturnType<Prisma.TransactionClient["contractBillRowTransition"]["findMany"]>>
  ) {
    const sourceIds = [...new Set(transitions.map((transition) => transition.sourceContractBillRowId))];
    const sourceRows = await tx.contractBillRow.findMany({ where: { id: { in: sourceIds } } });
    if (sourceRows.length !== sourceIds.length) throw new BadRequestException("来源清单行已变化，请刷新后重试");
    const occupancy = await loadSettlementLineOccupancy(
      tx,
      context.fromVersion.id,
      sourceRows,
      { mode: "irreversible_history" }
    );
    for (const sourceId of sourceIds) {
      const source = sourceRows.find((row) => row.id === sourceId)!;
      const facts = occupancy.get(sourceId);
      if (facts?.hasReversibleOccupancy) {
        throw new BadRequestException(
          "来源版本存在尚未生效的在途结算，请先完成或撤回后再确认映射"
        );
      }
      const hasOccupancy = Boolean(facts && (
        !facts.quantityComplete ||
        !facts.quantity.isZero() ||
        facts.amountCents !== 0n ||
        facts.count > (source.lineageId ? 1 : 0)
      ));
      if (!hasOccupancy) {
        throw new BadRequestException("未发现该来源行的已生效历史结算，不能确认历史分配");
      }
      if (!facts!.quantityComplete) {
        throw new BadRequestException("来源行存在没有数量的历史结算，不能确认数量分配");
      }
      const edges = transitions.filter((transition) => transition.sourceContractBillRowId === sourceId);
      const quantityAllocated = edges.reduce((total, edge) => total.plus(edge.sourceSettledQuantityAllocated!), new Prisma.Decimal(0));
      const amountAllocated = edges.reduce((total, edge) => total + edge.settledAmountAllocatedCents!, 0n);
      if (!quantityAllocated.equals(facts!.quantity) || amountAllocated !== facts!.amountCents) {
        throw new BadRequestException("人工跨版本映射的历史数量或金额分配不守恒");
      }
    }
  }

  private async assertMappingsNotFrozenByRemainderCancellation(
    tx: Prisma.TransactionClient,
    context: Awaited<ReturnType<ContractBillTransitionService["lockEditablePair"]>>,
    sourceIds: string[],
    targetIds: string[],
    wholePair = false
  ) {
    const scopedPredicate = wholePair
      ? Prisma.sql`TRUE`
      : Prisma.sql`
          target."id" IN (${Prisma.join(targetIds)})
          OR EXISTS (
            SELECT 1
            FROM "ContractBillRowTransition" scoped
            WHERE scoped."fromContractVersionId" = ${context.fromVersion.id}
              AND scoped."toContractVersionId" = ${context.toVersion.id}
              AND scoped."status" <> 'invalidated'
              AND scoped."targetContractBillRowId" = target."id"
              AND scoped."sourceContractBillRowId" IN (${Prisma.join(sourceIds)})
          )
        `;
    const frozen = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT target."id"
      FROM "ContractBillRow" target
      JOIN "ContractBill" bill ON bill."id" = target."contractBillId"
      WHERE bill."contractVersionId" = ${context.toVersion.id}
        AND target."remainderDisposition" = 'cancelled'
        AND (${scopedPredicate})
      LIMIT 1
    `);
    if (frozen.length) {
      throw new ConflictException(
        "已取消未实施余量的清单行及其历史来源映射已冻结；如需修正请新建合同版本"
      );
    }
  }

  private async bumpRevision(tx: Prisma.TransactionClient, versionId: string, expectedRevision: number) {
    const updated = await tx.contractVersion.updateMany({
      where: { id: versionId, draftRevision: expectedRevision, status: { in: [...EDITABLE_VERSION_STATUSES] } },
      data: { draftRevision: { increment: 1 }, readinessSnapshot: Prisma.DbNull }
    });
    if (updated.count !== 1) throw new ConflictException("合同草稿已变化，请刷新后重新编辑");
  }

  private async readMappings(client: Pick<PrismaService, "contractBillRowTransition">, fromContractVersionId: string, toContractVersionId: string) {
    const rows = await client.contractBillRowTransition.findMany({
      where: { fromContractVersionId, toContractVersionId, status: { not: "invalidated" } },
      orderBy: [{ sourceContractBillRowId: "asc" }, { targetContractBillRowId: "asc" }]
    });
    return rows.map((row) => ({
      ...row,
      sourceSettledQuantityAllocated: row.sourceSettledQuantityAllocated?.toString() ?? null,
      targetOpeningQuantity: row.targetOpeningQuantity?.toString() ?? null,
      settledAmountAllocatedCents: row.settledAmountAllocatedCents?.toString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null
    }));
  }

  private async assertGlobalContractDirector(tx: Prisma.TransactionClient, actorUserId: string) {
    if (!(await this.hasGlobalContractDirector(tx, actorUserId))) {
      throw new ForbiddenException("只有合同部主任可以确认跨版本映射");
    }
  }

  private async hasGlobalContractDirector(client: Pick<PrismaService, "userPosition" | "position">, actorUserId: string) {
    const positions = await client.userPosition.findMany({ where: { userId: actorUserId, projectId: null } });
    if (!positions.length) return false;
    const definitions = await client.position.findMany({ where: { id: { in: positions.map((position) => position.positionId) } } });
    return definitions.some((position) => position.key === "contract_director");
  }

  private parseSaveInput(rawInput: unknown): SaveContractBillTransitionDto {
    if (!rawInput || typeof rawInput !== "object") throw new BadRequestException("跨版本映射内容不正确");
    const input = rawInput as Partial<SaveContractBillTransitionDto>;
    return {
      fromContractVersionId: this.requireId(input.fromContractVersionId, "直接来源合同版本"),
      expectedTargetVersionRevision: this.requireRevision(input.expectedTargetVersionRevision),
      mappings: Array.isArray(input.mappings) ? input.mappings : []
    };
  }

  private parseConfirmInput(rawInput: unknown): ConfirmContractBillTransitionsDto {
    if (!rawInput || typeof rawInput !== "object") throw new BadRequestException("跨版本映射确认内容不正确");
    return { expectedTargetVersionRevision: this.requireRevision((rawInput as Partial<ConfirmContractBillTransitionsDto>).expectedTargetVersionRevision) };
  }

  private parseDiscardInput(rawInput: unknown): DiscardContractBillTransitionsDto {
    if (!rawInput || typeof rawInput !== "object") throw new BadRequestException("跨版本映射撤销内容不正确");
    const input = rawInput as Partial<DiscardContractBillTransitionsDto>;
    return {
      fromContractVersionId: this.requireId(input.fromContractVersionId, "直接来源合同版本"),
      expectedTargetVersionRevision: this.requireRevision(input.expectedTargetVersionRevision)
    };
  }

  private requireRevision(value: unknown) {
    if (!Number.isInteger(value) || (value as number) < 1) throw new BadRequestException("合同草稿版本号不正确，请刷新后重试");
    return value as number;
  }

  private requireId(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${label}不能为空`);
    return value.trim();
  }

  private parsePositiveDecimal(value: unknown, label: string) {
    if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value.trim())) {
      throw new BadRequestException(`${label}必须是最多 ${DECIMAL_SCALE} 位小数的正数`);
    }
    const parsed = new Prisma.Decimal(value.trim());
    if (parsed.lessThanOrEqualTo(0)) throw new BadRequestException(`${label}必须大于零`);
    return parsed;
  }

  private parseIntegerCents(value: unknown) {
    if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)$/u.test(value.trim())) {
      throw new BadRequestException("历史金额分配必须填写整数分");
    }
    return BigInt(value.trim());
  }
}
