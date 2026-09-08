import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException
} from "@nestjs/common";
import { Prisma, type ClearingCase } from "@prisma/client";
import type { ClearingEventKind } from "@jiangkong/shared-domain";

import type { AffiliateClearingSelectionRefService } from "./affiliate-clearing-selection-ref.service";

const MAX_BIGINT = 9_223_372_036_854_775_807n;

type FreezeInput = {
  tx: Prisma.TransactionClient;
  clearingCase: ClearingCase;
  eventKind: ClearingEventKind;
  eventAmountCents: bigint;
  draft: Record<string, unknown>;
  actorUserId: string;
  selectionRefs?: AffiliateClearingSelectionRefService;
};

export async function freezeClearingReconciliationIntent(
  input: FreezeInput
): Promise<Record<string, unknown>> {
  const operation = requiredText(input.draft.operation, "核对意图 operation 不能为空");
  if (operation === "open_item" || operation === "replace_item") {
    return freezeItemDefinition(input, operation);
  }
  if (operation === "add_coverage") {
    return freezeCoverageAddition(input);
  }
  if (operation === "resolve") {
    return freezeResolution(input);
  }
  if (operation === "reverse_resolution") {
    return freezeResolutionReversal(input);
  }
  if (operation === "reverse_definition") {
    return freezeDefinitionReversal(input);
  }
  throw new BadRequestException("当前核对意图 operation 不受支持");
}

async function freezeItemDefinition(
  input: FreezeInput,
  operation: "open_item" | "replace_item"
): Promise<Record<string, unknown>> {
  assertExactKeys(
    input.draft,
    ["operation", "itemDefinition", "coverages"],
    "待核对定义意图"
  );
  if (input.eventKind !== "pending_reconciliation") {
    throw new BadRequestException("待核对定义只能由 pending_reconciliation 决策");
  }
  const itemDraft = requireRecord(
    input.draft.itemDefinition,
    "待核对定义格式不正确"
  );
  const mode = requiredText(itemDraft.mode, "待核对定义 mode 不能为空");
  if (
    (operation === "open_item" && mode !== "independent" && mode !== "addition") ||
    (operation === "replace_item" && mode !== "replacement")
  ) {
    throw new BadRequestException("待核对 operation 与定义 mode 不匹配");
  }
  const definitionKeys = mode === "independent"
    ? ["mode", "amountCents"]
    : mode === "addition"
      ? ["mode", "additionOfItemId", "amountCents"]
      : Object.hasOwn(itemDraft, "correctsDefinitionReversalId")
        ? ["mode", "replacesRevisionId", "correctsDefinitionReversalId", "amountCents"]
        : ["mode", "replacesRevisionId", "amountCents"];
  assertExactKeys(itemDraft, definitionKeys, "待核对定义");
  const amountCents = positiveCents(itemDraft.amountCents);
  if (amountCents !== input.eventAmountCents) {
    throw new BadRequestException("待核对定义金额必须等于事件金额");
  }
  if (!Array.isArray(input.draft.coverages)) {
    throw new BadRequestException("待核对覆盖必须是数组");
  }

  let itemId: string;
  let lineageRootItemId: string;
  let additionOfItemId: string | null = null;
  let revisionNo = 1;
  let replacesRevisionId: string | null = null;
  let replacedOpenAmountCents: string | null = null;
  let correctsDefinitionReversalId: string | null = null;
  let replacementTargetRevisionId: string | null = null;
  if (mode === "independent") {
    itemId = randomUUID();
    lineageRootItemId = itemId;
  } else if (mode === "addition") {
    additionOfItemId = requiredText(
      itemDraft.additionOfItemId,
      "新增待核对项必须引用父 item"
    );
    const parent = await input.tx.clearingReconciliationItem.findUnique({
      where: { id: additionOfItemId }
    });
    if (!parent || parent.clearingCaseId !== input.clearingCase.id) {
      throw new BadRequestException("新增待核对项父 item 不存在或跨案");
    }
    itemId = randomUUID();
    lineageRootItemId = parent.lineageRootItemId;
  } else {
    replacementTargetRevisionId = requiredText(
      itemDraft.replacesRevisionId,
      "替代待核对定义必须引用当前 revision"
    );
    const target = await input.tx.clearingReconciliationRevision.findUnique({
      where: { id: replacementTargetRevisionId },
      include: { item: true }
    });
    if (!target || target.clearingCaseId !== input.clearingCase.id) {
      throw new BadRequestException("替代目标 revision 不存在或跨案");
    }
    const later = await input.tx.clearingReconciliationRevision.findFirst({
      where: {
        itemId: target.itemId,
        revisionNo: { gt: target.revisionNo },
        correctedByDefinitionReversal: { is: null }
      }
    });
    if (later) {
      throw new ConflictException("替代目标已不是当前因果前沿，请刷新后重试");
    }
    const reversal = await input.tx.clearingReconciliationDefinitionReversal.findUnique({
      where: { targetRevisionId: target.id }
    });
    const requestedCorrection = itemDraft.correctsDefinitionReversalId === undefined
      ? null
      : requiredText(
          itemDraft.correctsDefinitionReversalId,
          "定义纠正必须引用 exact definition reversal"
        );
    if ((reversal?.id ?? null) !== requestedCorrection) {
      throw new ConflictException("替代目标的定义反向状态已漂移，请刷新后重试");
    }
    if (reversal && target.revisionNo !== 1) {
      throw new ConflictException("只有首次 open 定义反向后可使用 corrected replacement");
    }
    const [open] = await input.tx.$queryRaw<Array<{ openAmountCents: bigint }>>(Prisma.sql`
      SELECT (
        revision."amountCents" - COALESCE(SUM(
          CASE WHEN resolution."entryKind" = 'resolution'
            THEN resolution."amountCents" ELSE -resolution."amountCents" END
        ), 0)
      )::bigint AS "openAmountCents"
      FROM "ClearingReconciliationRevision" revision
      LEFT JOIN "ClearingReconciliationResolution" resolution
        ON resolution."reconciliationRevisionId" = revision.id
      WHERE revision.id = ${target.id}
      GROUP BY revision.id, revision."amountCents"
    `);
    const openAmountCents = reversal
      ? 0n
      : open?.openAmountCents ?? target.amountCents;
    const latestHistorical = await input.tx.clearingReconciliationRevision.findFirst({
      where: { itemId: target.itemId },
      orderBy: { revisionNo: "desc" },
      select: { revisionNo: true }
    });
    itemId = target.itemId;
    lineageRootItemId = target.item.lineageRootItemId;
    revisionNo = (latestHistorical?.revisionNo ?? target.revisionNo) + 1;
    replacesRevisionId = target.id;
    replacedOpenAmountCents = (reversal ? 0n : openAmountCents).toString();
    correctsDefinitionReversalId = reversal?.id ?? null;
  }

  const revisionId = randomUUID();
  const coverageRows = await freezeCoverageSelections(
    input,
    revisionId,
    input.draft.coverages,
    replacementTargetRevisionId
  );
  let plannedPairedWithheld: Record<string, unknown> | null = null;
  if (coverageRows.length === 0) {
    const available = await availableWithheldTotal(
      input,
      replacementTargetRevisionId
    );
    if (available > 0n) {
      throw new BadRequestException(
        "案件已有可用暂扣，必须显式选择覆盖，不能自动补冻差额"
      );
    }
    const pair = plannedPairedWithheldFor(input, amountCents);
    plannedPairedWithheld = pair.plan;
    coverageRows.push({
      lineNo: 1,
      coverageId: pair.coverageId,
      reconciliationRevisionId: revisionId,
      withheldEventVersionId: pair.eventVersionId,
      withheldEventVersionFingerprint: pair.fingerprint,
      amountCents: amountCents.toString()
    });
  }
  const coverageTotal = coverageRows.reduce(
    (sum, row) => sum + BigInt(String(row.amountCents)),
    0n
  );
  if (coverageTotal > amountCents) {
    throw new BadRequestException("待核对覆盖合计不得超过定义金额");
  }
  return {
    schema: "clearing_reconciliation_intent/V1",
    operation,
    plannedIds: {
      newItemId: mode === "replacement" ? null : itemId,
      revisionId,
      coverageIds: coverageRows.map((row) => row.coverageId),
      resolutionIds: [],
      resolutionLineIds: [],
      definitionReversalId: null,
      clearingAllocationIds: []
    },
    plannedPairedWithheld,
    itemDefinition: {
      mode,
      itemId,
      lineageRootItemId,
      additionOfItemId,
      revisionId,
      revisionNo,
      replacesRevisionId,
      replacedOpenAmountCents,
      correctsDefinitionReversalId,
      adoptsLegacyPendingEventVersionId: null,
      amountCents: amountCents.toString(),
      currencyCode: "CNY"
    },
    coverages: coverageRows,
    resolutions: [],
    definitionReversal: null,
    eventAllocations: []
  };
}

async function freezeCoverageAddition(input: FreezeInput): Promise<Record<string, unknown>> {
  assertExactKeys(
    input.draft,
    ["operation", "targetRevisionId", "coverages"],
    "coverage_added 核对意图"
  );
  if (input.eventKind !== "coverage_added") {
    throw new BadRequestException("add_coverage 只能由 coverage_added 决策");
  }
  const targetRevisionId = requiredText(
    input.draft.targetRevisionId,
    "补充覆盖必须引用目标 revision"
  );
  const targetRevision = await input.tx.clearingReconciliationRevision.findUnique({
    where: { id: targetRevisionId }
  });
  if (
    !targetRevision ||
    targetRevision.clearingCaseId !== input.clearingCase.id
  ) {
    throw new BadRequestException("补充覆盖目标 revision 不存在或跨案");
  }
  const [later, reversal] = await Promise.all([
    input.tx.clearingReconciliationRevision.findFirst({
      where: {
        itemId: targetRevision.itemId,
        revisionNo: { gt: targetRevision.revisionNo },
        correctedByDefinitionReversal: { is: null }
      }
    }),
    input.tx.clearingReconciliationDefinitionReversal.findUnique({
      where: { targetRevisionId: targetRevision.id }
    })
  ]);
  if (later || reversal) {
    throw new ConflictException("只能给当前有效 revision 补充覆盖");
  }
  if (!Array.isArray(input.draft.coverages) || input.draft.coverages.length === 0) {
    throw new BadRequestException("coverage_added 必须提供真实暂扣覆盖");
  }
  const coverageRows = await freezeCoverageSelections(
    input,
    targetRevision.id,
    input.draft.coverages,
    null
  );
  const total = coverageRows.reduce(
    (sum, row) => sum + BigInt(String(row.amountCents)),
    0n
  );
  if (total !== input.eventAmountCents) {
    throw new BadRequestException("coverage_added 事件金额必须等于覆盖行合计");
  }
  return {
    schema: "clearing_reconciliation_intent/V1",
    operation: "add_coverage",
    plannedIds: {
      newItemId: null,
      revisionId: null,
      coverageIds: coverageRows.map((row) => row.coverageId),
      resolutionIds: [],
      resolutionLineIds: [],
      definitionReversalId: null,
      clearingAllocationIds: []
    },
    plannedPairedWithheld: null,
    itemDefinition: null,
    coverages: coverageRows,
    resolutions: [],
    definitionReversal: null,
    eventAllocations: []
  };
}

async function freezeResolution(input: FreezeInput): Promise<Record<string, unknown>> {
  assertExactKeys(
    input.draft,
    ["operation", "resolutions", "ordinaryAllocations"],
    "解决核对意图"
  );
  const resultKind =
    input.eventKind === "final_confirmed" || input.eventKind === "supplemental"
      ? "final_confirmed"
      : input.eventKind === "returned"
        ? "real_return"
        : input.eventKind === "continued_withheld"
          ? "continued_withheld"
          : null;
  if (!resultKind) {
    throw new BadRequestException("resolve 与清算事件类型不匹配");
  }
  if (
    !Array.isArray(input.draft.resolutions) ||
    input.draft.resolutions.length === 0 ||
    !Array.isArray(input.draft.ordinaryAllocations)
  ) {
    throw new BadRequestException("resolve 必须提供解决项及完整 ordinary allocation 数组");
  }
  if (!input.selectionRefs) {
    throw new ConflictException("清算 resolution selectionRef 服务未注册，必须失败关闭");
  }
  const coverageCandidates = await input.tx.clearingReconciliationCoverage.findMany({
    where: { clearingCaseId: input.clearingCase.id },
    include: { withheldEventVersion: true }
  });
  const resolutionRows: Array<Record<string, unknown>> = [];
  const eventAllocations: Array<Record<string, unknown>> = [];
  const resolutionIds: string[] = [];
  const resolutionLineIds: string[] = [];
  const clearingAllocationIds: string[] = [];
  const coverageConsumed = new Map<string, bigint>();
  let resolvedTotal = 0n;

  for (const [itemIndex, entry] of input.draft.resolutions.entries()) {
    const resolutionDraft = requireRecord(entry, "解决项格式不正确");
    assertExactKeys(
      resolutionDraft,
      ["reconciliationRevisionId", "amountCents", "lines"],
      "解决项"
    );
    const revisionId = requiredText(
      resolutionDraft.reconciliationRevisionId,
      "解决项必须引用目标 revision"
    );
    const revision = await input.tx.clearingReconciliationRevision.findUnique({
      where: { id: revisionId }
    });
    if (!revision || revision.clearingCaseId !== input.clearingCase.id) {
      throw new BadRequestException("解决目标 revision 不存在或跨案");
    }
    await assertCurrentRevision(input, revision);
    if (!Array.isArray(resolutionDraft.lines) || resolutionDraft.lines.length === 0) {
      throw new BadRequestException("解决项必须提供逐行来源");
    }
    const resolutionAmount = positiveCents(resolutionDraft.amountCents);
    let lineTotal = 0n;
    const lines: Array<Record<string, unknown>> = [];
    const resolutionId = randomUUID();
    resolutionIds.push(resolutionId);
    for (const [lineIndex, entryLine] of resolutionDraft.lines.entries()) {
      const lineDraft = requireRecord(entryLine, "解决行格式不正确");
      assertExactKeys(
        lineDraft,
        ["sourceKind", "sourceSelectionRef", "amountCents"],
        "解决行"
      );
      const amountCents = positiveCents(lineDraft.amountCents);
      const sourceKind = requiredText(lineDraft.sourceKind, "解决行来源类型不能为空");
      const sourceSelectionRef = requiredText(
        lineDraft.sourceSelectionRef,
        "解决行必须提交短效来源选择"
      );
      if (
        sourceKind !== "withheld_coverage" &&
        sourceKind !== "authority_cap" &&
        sourceKind !== "prior_economic_event"
      ) {
        throw new BadRequestException("当前解决行来源类型未获准");
      }
      if (resultKind === "continued_withheld" && sourceKind !== "withheld_coverage") {
        throw new BadRequestException("继续暂扣只能引用已有 withheld coverage");
      }
      if (
        resultKind === "real_return" &&
        sourceKind !== "withheld_coverage" &&
        sourceKind !== "prior_economic_event"
      ) {
        throw new BadRequestException("真实退回只能使用 withheld coverage 或既有经济事件");
      }
      if (resultKind === "final_confirmed" && sourceKind === "prior_economic_event") {
        throw new BadRequestException("最终解决不得使用既有经济事件退回来源");
      }
      const resolutionLineId = randomUUID();
      resolutionLineIds.push(resolutionLineId);
      let coverageId: string | null = null;
      let plannedClearingAllocationId: string | null = null;
      let frozenSource: Record<string, unknown>;
      let allocationSourceKind:
        | "withheld"
        | "authority_cap"
        | "final_confirmed"
        | "supplemental";
      let sourceEventVersionId: string | null;
      if (sourceKind === "withheld_coverage") {
        const coverage = coverageCandidates.find(
          (candidate) =>
            candidate.reconciliationRevisionId === revision.id &&
            input.selectionRefs?.matches(sourceSelectionRef, {
              actorUserId: input.actorUserId,
              authorityVersionId:
                input.clearingCase.authorityVersionId ?? input.clearingCase.id,
              authorityFingerprint:
                input.clearingCase.authoritySnapshotRef ?? input.clearingCase.id,
              purpose: "allocation",
              selectedKey: candidate.id,
              revision: input.clearingCase.revision
            })
        );
        if (
          !coverage ||
          !/^[0-9a-f]{64}$/.test(coverage.withheldEventVersion.fingerprint)
        ) {
          throw new BadRequestException("withheld coverage 选择已过期或跨 revision");
        }
        coverageId = coverage.id;
        sourceEventVersionId = coverage.withheldEventVersionId;
        allocationSourceKind = "withheld";
        frozenSource = {
          kind: "withheld_coverage",
          coverageId,
          withheldEventVersionId: sourceEventVersionId,
          withheldEventVersionFingerprint:
            coverage.withheldEventVersion.fingerprint
        };
        const openCoverage = await openCoverageAmount(
          input,
          coverage.id,
          coverage.amountCents
        );
        const nextCoverageConsumed =
          (coverageConsumed.get(coverage.id) ?? 0n) + amountCents;
        if (nextCoverageConsumed > openCoverage) {
          throw new ConflictException("withheld coverage 可用金额已漂移，请重新准备版本");
        }
        coverageConsumed.set(coverage.id, nextCoverageConsumed);
      } else if (sourceKind === "authority_cap") {
        if (
          !input.clearingCase.authorityVersionId ||
          !input.clearingCase.authoritySnapshotRef ||
          !input.clearingCase.sourceDiscriminator ||
          !input.selectionRefs.matches(sourceSelectionRef, {
            actorUserId: input.actorUserId,
            authorityVersionId: input.clearingCase.authorityVersionId,
            authorityFingerprint: input.clearingCase.authoritySnapshotRef,
            purpose: "allocation",
            selectedKey: input.clearingCase.id,
            revision: input.clearingCase.revision
          })
        ) {
          throw new BadRequestException("authority cap 选择已过期或权威坐标不完整");
        }
        sourceEventVersionId = null;
        allocationSourceKind = "authority_cap";
        frozenSource = {
          kind: "authority_cap",
          authorityVersionId: input.clearingCase.authorityVersionId,
          authoritySnapshotRef: input.clearingCase.authoritySnapshotRef,
          sourceDiscriminator: input.clearingCase.sourceDiscriminator
        };
      } else {
        const prior = await freezePriorEconomicSource(
          input,
          sourceSelectionRef,
          amountCents
        );
        sourceEventVersionId = prior.sourceEventVersionId;
        allocationSourceKind = prior.allocationSourceKind;
        frozenSource = prior.frozenSource;
      }
      if (resultKind !== "continued_withheld") {
        plannedClearingAllocationId = randomUUID();
        clearingAllocationIds.push(plannedClearingAllocationId);
        eventAllocations.push({
          allocationNo: eventAllocations.length + 1,
          clearingAllocationId: plannedClearingAllocationId,
          purpose: "reconciliation_line",
          resolutionLineId,
          allocationSourceKind,
          sourceEventVersionId,
          amountCents: amountCents.toString(),
          frozenSource:
            sourceKind === "withheld_coverage"
              ? {
                  kind: "withheld",
                  sourceEventVersionId,
                  sourceEventVersionFingerprint:
                    frozenSource.withheldEventVersionFingerprint
                }
              : frozenSource
        });
      }
      lineTotal += amountCents;
      lines.push({
        lineNo: lineIndex + 1,
        resolutionLineId,
        sourceKind,
        coverageId,
        amountCents: amountCents.toString(),
        reversesResolutionLineId: null,
        plannedClearingAllocationId,
        frozenSource
      });
    }
    if (lineTotal !== resolutionAmount) {
      throw new BadRequestException("解决行合计必须等于解决项金额");
    }
    resolvedTotal += resolutionAmount;
    resolutionRows.push({
      itemNo: itemIndex + 1,
      resolutionId,
      reconciliationRevisionId: revision.id,
      itemId: revision.itemId,
      entryKind: "resolution",
      resultKind,
      reversesResolutionId: null,
      amountCents: resolutionAmount.toString(),
      lines
    });
  }
  const ordinaryAllocations = await freezeOrdinaryAllocations(
    input,
    resultKind,
    input.draft.ordinaryAllocations,
    eventAllocations.length + 1,
    eventAllocations
  );
  for (const allocation of ordinaryAllocations) {
    eventAllocations.push(allocation);
    clearingAllocationIds.push(String(allocation.clearingAllocationId));
  }
  const ordinaryTotal = ordinaryAllocations.reduce(
    (sum, row) => sum + BigInt(String(row.amountCents)),
    0n
  );
  if (
    resolvedTotal > input.eventAmountCents ||
    (resultKind === "continued_withheld" &&
      (resolvedTotal !== input.eventAmountCents || ordinaryTotal !== 0n)) ||
    (resultKind !== "continued_withheld" &&
      resolvedTotal + ordinaryTotal !== input.eventAmountCents)
  ) {
    throw new BadRequestException("关系解决金额与事件金额不闭合");
  }
  return {
    schema: "clearing_reconciliation_intent/V1",
    operation: "resolve",
    plannedIds: {
      newItemId: null,
      revisionId: null,
      coverageIds: [],
      resolutionIds,
      resolutionLineIds,
      definitionReversalId: null,
      clearingAllocationIds
    },
    plannedPairedWithheld: null,
    itemDefinition: null,
    coverages: [],
    resolutions: resolutionRows,
    definitionReversal: null,
    eventAllocations
  };
}

async function freezeResolutionReversal(
  input: FreezeInput
): Promise<Record<string, unknown>> {
  assertExactKeys(
    input.draft,
    ["operation", "reversals"],
    "解决技术反向意图"
  );
  if (input.eventKind !== "technical_reversal") {
    throw new BadRequestException("reverse_resolution 只能由 technical_reversal 决策");
  }
  if (!Array.isArray(input.draft.reversals) || input.draft.reversals.length === 0) {
    throw new BadRequestException("解决技术反向必须提供 exact reversal 数组");
  }
  const resolutions: Array<Record<string, unknown>> = [];
  const eventAllocations: Array<Record<string, unknown>> = [];
  const resolutionIds: string[] = [];
  const resolutionLineIds: string[] = [];
  const clearingAllocationIds: string[] = [];
  let eventTotal = 0n;
  for (const [itemIndex, raw] of input.draft.reversals.entries()) {
    const draft = requireRecord(raw, "解决技术反向项格式不正确");
    assertExactKeys(
      draft,
      ["resolutionId", "amountCents", "lines"],
      "解决技术反向项"
    );
    const targetResolutionId = requiredText(
      draft.resolutionId,
      "解决技术反向必须引用原 resolution"
    );
    const target = await input.tx.clearingReconciliationResolution.findUnique({
      where: { id: targetResolutionId },
      include: {
        lines: { include: { clearingAllocation: true, coverage: true } },
        decisionEventVersion: true
      }
    });
    if (
      !target ||
      target.clearingCaseId !== input.clearingCase.id ||
      target.entryKind !== "resolution"
    ) {
      throw new BadRequestException("解决技术反向目标不存在、跨案或不是原始解决");
    }
    await assertCurrentRevision(input, {
      id: target.reconciliationRevisionId,
      itemId: target.itemId,
      revisionNo: await revisionNo(input, target.reconciliationRevisionId)
    });
    const amountCents = positiveCents(draft.amountCents);
    const reversed = await input.tx.clearingReconciliationResolution.aggregate({
      where: { reversesResolutionId: target.id },
      _sum: { amountCents: true }
    });
    if (amountCents > target.amountCents - (reversed._sum.amountCents ?? 0n)) {
      throw new ConflictException("解决技术反向超过原解决剩余效果");
    }
    if (!Array.isArray(draft.lines) || draft.lines.length === 0) {
      throw new BadRequestException("解决技术反向必须逐行引用原解决行");
    }
    const targetIntent = reconciliationIntentFromPayload(
      target.decisionEventVersion.payloadSnapshot
    );
    const lines: Array<Record<string, unknown>> = [];
    let lineTotal = 0n;
    for (const [lineIndex, rawLine] of draft.lines.entries()) {
      const lineDraft = requireRecord(rawLine, "解决技术反向行格式不正确");
      assertExactKeys(
        lineDraft,
        ["resolutionLineId", "amountCents"],
        "解决技术反向行"
      );
      const targetLineId = requiredText(
        lineDraft.resolutionLineId,
        "解决技术反向行必须引用原 line"
      );
      const targetLine = target.lines.find((line) => line.id === targetLineId);
      if (!targetLine) {
        throw new BadRequestException("解决技术反向行不属于原 resolution");
      }
      const lineAmount = positiveCents(lineDraft.amountCents);
      const lineReversed = await input.tx.clearingReconciliationResolutionLine.aggregate({
        where: { reversesResolutionLineId: targetLine.id },
        _sum: { amountCents: true }
      });
      if (lineAmount > targetLine.amountCents - (lineReversed._sum.amountCents ?? 0n)) {
        throw new ConflictException("解决技术反向行超过原行剩余效果");
      }
      const frozenSource = targetLine.clearingAllocation
        ? frozenEventAllocationSource(
            targetIntent,
            targetLine.clearingAllocation.id
          )
        : frozenResolutionLineSource(targetIntent, targetLine.id);
      const resolutionLineId = randomUUID();
      resolutionLineIds.push(resolutionLineId);
      let plannedClearingAllocationId: string | null = null;
      if (targetLine.clearingAllocation) {
        plannedClearingAllocationId = randomUUID();
        clearingAllocationIds.push(plannedClearingAllocationId);
        eventAllocations.push({
          allocationNo: eventAllocations.length + 1,
          clearingAllocationId: plannedClearingAllocationId,
          purpose: "reconciliation_line",
          resolutionLineId,
          allocationSourceKind: targetLine.clearingAllocation.sourceKind,
          sourceEventVersionId:
            targetLine.clearingAllocation.sourceEventVersionId,
          amountCents: lineAmount.toString(),
          frozenSource
        });
      }
      lineTotal += lineAmount;
      lines.push({
        lineNo: lineIndex + 1,
        resolutionLineId,
        sourceKind: targetLine.sourceKind,
        coverageId: targetLine.coverageId,
        amountCents: lineAmount.toString(),
        reversesResolutionLineId: targetLine.id,
        plannedClearingAllocationId,
        frozenSource
      });
    }
    if (lineTotal !== amountCents) {
      throw new BadRequestException("解决技术反向行合计必须等于反向金额");
    }
    const resolutionId = randomUUID();
    resolutionIds.push(resolutionId);
    eventTotal += amountCents;
    resolutions.push({
      itemNo: itemIndex + 1,
      resolutionId,
      reconciliationRevisionId: target.reconciliationRevisionId,
      itemId: target.itemId,
      entryKind: "technical_reversal",
      resultKind: target.resultKind,
      reversesResolutionId: target.id,
      amountCents: amountCents.toString(),
      lines
    });
  }
  if (eventTotal !== input.eventAmountCents) {
    throw new BadRequestException("技术反向解决合计必须等于事件金额");
  }
  return {
    schema: "clearing_reconciliation_intent/V1",
    operation: "reverse_resolution",
    plannedIds: {
      newItemId: null,
      revisionId: null,
      coverageIds: [],
      resolutionIds,
      resolutionLineIds,
      definitionReversalId: null,
      clearingAllocationIds
    },
    plannedPairedWithheld: null,
    itemDefinition: null,
    coverages: [],
    resolutions,
    definitionReversal: null,
    eventAllocations
  };
}

async function freezeDefinitionReversal(
  input: FreezeInput
): Promise<Record<string, unknown>> {
  assertExactKeys(
    input.draft,
    ["operation", "targetRevisionId"],
    "定义技术反向意图"
  );
  if (input.eventKind !== "technical_reversal") {
    throw new BadRequestException("reverse_definition 只能由 technical_reversal 决策");
  }
  const targetRevisionId = requiredText(
    input.draft.targetRevisionId,
    "定义技术反向必须引用当前 revision"
  );
  const target = await input.tx.clearingReconciliationRevision.findUnique({
    where: { id: targetRevisionId },
    include: { decisionEventVersion: true }
  });
  if (!target || target.clearingCaseId !== input.clearingCase.id) {
    throw new BadRequestException("定义技术反向目标不存在或跨案");
  }
  await assertCurrentRevision(input, target);
  const [net] = await input.tx.$queryRaw<Array<{ resolvedCents: bigint }>>(Prisma.sql`
    SELECT COALESCE(SUM(CASE WHEN "entryKind" = 'resolution'
      THEN "amountCents" ELSE -"amountCents" END), 0)::bigint AS "resolvedCents"
    FROM "ClearingReconciliationResolution"
    WHERE "reconciliationRevisionId" = ${target.id}
  `);
  if ((net?.resolvedCents ?? 0n) !== 0n) {
    throw new ConflictException("定义反向前必须先精确反向全部后继解决");
  }
  if (input.eventAmountCents !== target.amountCents) {
    throw new BadRequestException("定义反向事件金额必须等于目标定义金额");
  }
  if (!/^[0-9a-f]{64}$/.test(target.decisionEventVersion.fingerprint)) {
    throw new ConflictException("定义反向目标版本 fingerprint 损坏");
  }
  const [capacity] = await input.tx.$queryRaw<Array<{ exceedsCapacity: boolean }>>(Prisma.sql`
    WITH restored_revision AS (
      SELECT revision.id
      FROM "ClearingReconciliationRevision" revision
      WHERE revision."itemId" = ${target.itemId}
        AND revision."revisionNo" < ${target.revisionNo}
        AND NOT EXISTS (
          SELECT 1 FROM "ClearingReconciliationDefinitionReversal" reversed
          WHERE reversed."targetRevisionId" = revision.id
        )
      ORDER BY revision."revisionNo" DESC
      LIMIT 1
    ), affected_source AS (
      SELECT coverage."withheldEventVersionId" AS source_id
      FROM "ClearingReconciliationCoverage" coverage
      WHERE coverage."reconciliationRevisionId" = ${target.id}
      UNION
      SELECT coverage."withheldEventVersionId"
      FROM "ClearingReconciliationCoverage" coverage
      WHERE coverage."reconciliationRevisionId" = (SELECT id FROM restored_revision)
    )
    SELECT EXISTS (
      SELECT 1
      FROM affected_source affected
      JOIN "ClearingEventVersion" source ON source.id = affected.source_id
      WHERE public."pol275_active_coverage_occupancy"(affected.source_id)
        - COALESCE((
            SELECT SUM(coverage."amountCents" - COALESCE((
              SELECT SUM(CASE WHEN resolution."entryKind" = 'resolution'
                THEN line."amountCents" ELSE -line."amountCents" END)
              FROM "ClearingReconciliationResolutionLine" line
              JOIN "ClearingReconciliationResolution" resolution
                ON resolution.id = line."resolutionId"
              WHERE line."coverageId" = coverage.id
            ), 0))
            FROM "ClearingReconciliationCoverage" coverage
            WHERE coverage."reconciliationRevisionId" = ${target.id}
              AND coverage."withheldEventVersionId" = affected.source_id
          ), 0)
        + COALESCE((
            SELECT SUM(coverage."amountCents" - COALESCE((
              SELECT SUM(CASE WHEN resolution."entryKind" = 'resolution'
                THEN line."amountCents" ELSE -line."amountCents" END)
              FROM "ClearingReconciliationResolutionLine" line
              JOIN "ClearingReconciliationResolution" resolution
                ON resolution.id = line."resolutionId"
              WHERE line."coverageId" = coverage.id
            ), 0))
            FROM "ClearingReconciliationCoverage" coverage
            WHERE coverage."reconciliationRevisionId" = (SELECT id FROM restored_revision)
              AND coverage."withheldEventVersionId" = affected.source_id
          ), 0)
        + COALESCE((
            SELECT SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
              THEN allocation."amountCents" ELSE -allocation."amountCents" END)
            FROM "ClearingAllocation" allocation
            WHERE allocation."sourceEventVersionId" = affected.source_id
          ), 0) > source."amountCents"
    ) AS "exceedsCapacity"
  `);
  if (capacity?.exceedsCapacity) {
    throw new ConflictException(
      "定义反向会恢复超过暂扣来源容量的旧覆盖，必须先精确解除后继占用"
    );
  }
  const definitionReversalId = randomUUID();
  return {
    schema: "clearing_reconciliation_intent/V1",
    operation: "reverse_definition",
    plannedIds: {
      newItemId: null,
      revisionId: null,
      coverageIds: [],
      resolutionIds: [],
      resolutionLineIds: [],
      definitionReversalId,
      clearingAllocationIds: []
    },
    plannedPairedWithheld: null,
    itemDefinition: null,
    coverages: [],
    resolutions: [],
    definitionReversal: {
      definitionReversalId,
      targetRevisionId: target.id,
      targetDecisionEventVersionId: target.decisionEventVersionId,
      targetDecisionEventVersionFingerprint:
        target.decisionEventVersion.fingerprint,
      reversedAmountCents: target.amountCents.toString()
    },
    eventAllocations: []
  };
}

async function freezeCoverageSelections(
  input: FreezeInput,
  reconciliationRevisionId: string,
  drafts: unknown[],
  replacingRevisionId: string | null
): Promise<Array<Record<string, unknown>>> {
  if (drafts.length === 0) return [];
  if (!input.selectionRefs) {
    throw new ConflictException("清算 coverage selectionRef 服务未注册，必须失败关闭");
  }
  const candidates = await input.tx.clearingEventVersion.findMany({
    where: {
      clearingCaseId: input.clearingCase.id,
      workflowStatus: "confirmed"
    },
    include: { clearingEvent: true, confirmation: true }
  });
  const selectedBySource = new Map<string, bigint>();
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, raw] of drafts.entries()) {
    const draft = requireRecord(raw, "待核对覆盖行格式不正确");
    assertExactKeys(
      draft,
      ["sourceSelectionRef", "amountCents"],
      "待核对覆盖行"
    );
    const amountCents = positiveCents(draft.amountCents);
    const sourceSelectionRef = requiredText(
      draft.sourceSelectionRef,
      "待核对覆盖必须提交短效来源选择"
    );
    const selected = candidates.find(
      (candidate) =>
        candidate.confirmation &&
        candidate.clearingEvent.kind === "withheld" &&
        input.selectionRefs?.matches(sourceSelectionRef, {
          actorUserId: input.actorUserId,
          authorityVersionId:
            input.clearingCase.authorityVersionId ?? input.clearingCase.id,
          authorityFingerprint:
            input.clearingCase.authoritySnapshotRef ?? input.clearingCase.id,
          purpose: "allocation",
          selectedKey: candidate.id,
          revision: input.clearingCase.revision
        })
    );
    if (!selected || !/^[0-9a-f]{64}$/.test(selected.fingerprint)) {
      throw new BadRequestException(
        "待核对覆盖来源选择已过期、非同案已确认暂扣或 fingerprint 无效"
      );
    }
    if (selectedBySource.has(selected.id)) {
      throw new BadRequestException("同一决策的覆盖来源不得重复");
    }
    const remaining = await availableWithheldSource(
      input,
      selected.id,
      replacingRevisionId,
      selected.amountCents
    );
    if (amountCents > remaining) {
      throw new ConflictException("暂扣覆盖来源容量已漂移，请刷新并重新准备版本");
    }
    selectedBySource.set(selected.id, amountCents);
    rows.push({
      lineNo: index + 1,
      coverageId: randomUUID(),
      reconciliationRevisionId,
      withheldEventVersionId: selected.id,
      withheldEventVersionFingerprint: selected.fingerprint,
      amountCents: amountCents.toString()
    });
  }
  return rows;
}

async function availableWithheldTotal(
  input: FreezeInput,
  replacingRevisionId: string | null
): Promise<bigint> {
  const [row] = await input.tx.$queryRaw<Array<{ remaining: bigint }>>(Prisma.sql`
    SELECT COALESCE(SUM(
      source."amountCents"
      - COALESCE((
          SELECT SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
            THEN allocation."amountCents" ELSE -allocation."amountCents" END)
          FROM "ClearingAllocation" allocation
          WHERE allocation."sourceEventVersionId" = source.id
        ), 0)
      - public."pol275_active_coverage_occupancy"(source.id)
      + CASE WHEN ${replacingRevisionId}::text IS NULL THEN 0 ELSE COALESCE((
          SELECT SUM(coverage."amountCents") - COALESCE(SUM((
            SELECT COALESCE(SUM(CASE WHEN resolution."entryKind" = 'resolution'
              THEN line."amountCents" ELSE -line."amountCents" END), 0)
            FROM "ClearingReconciliationResolutionLine" line
            JOIN "ClearingReconciliationResolution" resolution
              ON resolution.id = line."resolutionId"
            WHERE line."coverageId" = coverage.id
          )), 0)
          FROM "ClearingReconciliationCoverage" coverage
          WHERE coverage."reconciliationRevisionId" = ${replacingRevisionId}
            AND coverage."withheldEventVersionId" = source.id
        ), 0) END
    ), 0)::bigint AS remaining
    FROM "ClearingEventVersion" source
    JOIN "ClearingEvent" source_event ON source_event.id = source."clearingEventId"
    JOIN "ClearingConfirmation" source_confirmation
      ON source_confirmation."eventVersionId" = source.id
    WHERE source."clearingCaseId" = ${input.clearingCase.id}
      AND source_event.kind = 'withheld'
  `);
  return row?.remaining ?? 0n;
}

async function availableWithheldSource(
  input: FreezeInput,
  sourceEventVersionId: string,
  replacingRevisionId: string | null,
  fallbackAmountCents: bigint
): Promise<bigint> {
  const [row] = await input.tx.$queryRaw<Array<{ remaining: bigint }>>(Prisma.sql`
    SELECT (
      source."amountCents"
      - COALESCE((
          SELECT SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
            THEN allocation."amountCents" ELSE -allocation."amountCents" END)
          FROM "ClearingAllocation" allocation
          WHERE allocation."sourceEventVersionId" = source.id
        ), 0)
      - public."pol275_active_coverage_occupancy"(source.id)
      + CASE WHEN ${replacingRevisionId}::text IS NULL THEN 0 ELSE COALESCE((
          SELECT SUM(coverage."amountCents") - COALESCE(SUM((
            SELECT COALESCE(SUM(CASE WHEN resolution."entryKind" = 'resolution'
              THEN line."amountCents" ELSE -line."amountCents" END), 0)
            FROM "ClearingReconciliationResolutionLine" line
            JOIN "ClearingReconciliationResolution" resolution
              ON resolution.id = line."resolutionId"
            WHERE line."coverageId" = coverage.id
          )), 0)
          FROM "ClearingReconciliationCoverage" coverage
          WHERE coverage."reconciliationRevisionId" = ${replacingRevisionId}
            AND coverage."withheldEventVersionId" = source.id
        ), 0) END
    )::bigint AS remaining
    FROM "ClearingEventVersion" source
    WHERE source.id = ${sourceEventVersionId}
  `);
  return row?.remaining ?? fallbackAmountCents;
}

function plannedPairedWithheldFor(input: FreezeInput, amountCents: bigint): {
  plan: Record<string, unknown>;
  coverageId: string;
  eventVersionId: string;
  fingerprint: string;
} {
  const clearingEventId = randomUUID();
  const eventVersionId = randomUUID();
  const fingerprint = createHash("sha256")
    .update(stableJson({
      schema: "clearing_paired_withheld/V1",
      clearingCaseId: input.clearingCase.id,
      clearingEventId,
      eventVersionId,
      amountCents: amountCents.toString(),
      currencyCode: "CNY"
    }))
    .digest("hex");
  return {
    plan: {
      clearingEventId,
      eventVersionId,
      eventVersionFingerprint: fingerprint,
      amountCents: amountCents.toString(),
      currencyCode: "CNY"
    },
    coverageId: randomUUID(),
    eventVersionId,
    fingerprint
  };
}

async function assertCurrentRevision(
  input: FreezeInput,
  revision: { id: string; itemId: string; revisionNo: number }
): Promise<void> {
  const [later, reversal] = await Promise.all([
    input.tx.clearingReconciliationRevision.findFirst({
      where: {
        itemId: revision.itemId,
        revisionNo: { gt: revision.revisionNo },
        correctedByDefinitionReversal: { is: null }
      }
    }),
    input.tx.clearingReconciliationDefinitionReversal.findUnique({
      where: { targetRevisionId: revision.id }
    })
  ]);
  if (later || reversal) {
    throw new ConflictException("核对目标已不是当前有效 revision，请刷新后重试");
  }
}

async function revisionNo(
  input: FreezeInput,
  revisionId: string
): Promise<number> {
  const revision = await input.tx.clearingReconciliationRevision.findUnique({
    where: { id: revisionId },
    select: { revisionNo: true }
  });
  if (!revision) {
    throw new ConflictException("解决目标 revision 已不存在");
  }
  return revision.revisionNo;
}

function reconciliationIntentFromPayload(
  payloadSnapshot: Prisma.JsonValue
): Record<string, unknown> {
  const payload = requireRecord(
    payloadSnapshot,
    "原解决版本业务快照损坏"
  );
  const intent = requireRecord(
    payload.reconciliationIntent,
    "原解决版本缺少冻结核对意图"
  );
  if (
    intent.schema !== "clearing_reconciliation_intent/V1" ||
    !Array.isArray(intent.resolutions)
  ) {
    throw new ConflictException("原解决版本冻结核对意图损坏");
  }
  return intent;
}

function frozenResolutionLineSource(
  intent: Record<string, unknown>,
  resolutionLineId: string
): Record<string, unknown> {
  for (const rawResolution of intent.resolutions as unknown[]) {
    const resolution = requireRecord(rawResolution, "原解决冻结项损坏");
    if (!Array.isArray(resolution.lines)) continue;
    for (const rawLine of resolution.lines) {
      const line = requireRecord(rawLine, "原解决冻结行损坏");
      if (line.resolutionLineId === resolutionLineId) {
        return requireRecord(line.frozenSource, "原解决冻结来源损坏");
      }
    }
  }
  throw new ConflictException("原解决冻结意图缺少 exact resolution line");
}

function frozenEventAllocationSource(
  intent: Record<string, unknown>,
  clearingAllocationId: string
): Record<string, unknown> {
  if (!Array.isArray(intent.eventAllocations)) {
    throw new ConflictException("原解决冻结意图缺少完整 allocation plan");
  }
  for (const rawAllocation of intent.eventAllocations) {
    const allocation = requireRecord(rawAllocation, "原解决冻结 allocation 损坏");
    if (allocation.clearingAllocationId === clearingAllocationId) {
      return requireRecord(
        allocation.frozenSource,
        "原解决冻结 allocation 来源损坏"
      );
    }
  }
  throw new ConflictException("原解决冻结意图缺少 exact allocation");
}

async function openCoverageAmount(
  input: FreezeInput,
  coverageId: string,
  fallbackAmountCents: bigint
): Promise<bigint> {
  const [row] = await input.tx.$queryRaw<Array<{ openAmountCents: bigint }>>(Prisma.sql`
    SELECT (
      coverage."amountCents" - COALESCE(SUM(
        CASE WHEN resolution."entryKind" = 'resolution'
          THEN line."amountCents" ELSE -line."amountCents" END
      ), 0)
    )::bigint AS "openAmountCents"
    FROM "ClearingReconciliationCoverage" coverage
    LEFT JOIN "ClearingReconciliationResolutionLine" line
      ON line."coverageId" = coverage.id
    LEFT JOIN "ClearingReconciliationResolution" resolution
      ON resolution.id = line."resolutionId"
    WHERE coverage.id = ${coverageId}
    GROUP BY coverage.id, coverage."amountCents"
  `);
  return row?.openAmountCents ?? fallbackAmountCents;
}

async function freezePriorEconomicSource(
  input: FreezeInput,
  sourceSelectionRef: string,
  amountCents: bigint
): Promise<{
  sourceEventVersionId: string;
  allocationSourceKind: "final_confirmed" | "supplemental";
  sourceAllocationRemainingCents: bigint;
  sourceClearingAllocationId: string;
  frozenSource: Record<string, unknown>;
}> {
  if (!input.selectionRefs) {
    throw new ConflictException("清算 prior-event selectionRef 服务未注册，必须失败关闭");
  }
  const allocations = await input.tx.clearingAllocation.findMany({
    where: {
      eventVersion: {
        clearingCaseId: input.clearingCase.id,
        workflowStatus: "confirmed"
      },
      reversesAllocationId: null
    },
    include: {
      eventVersion: {
        include: {
          clearingEvent: true,
          confirmation: true,
          impactLinks: true
        }
      }
    }
  });
  const selected = allocations.find((candidate) => {
    const eventKind = candidate.eventVersion.clearingEvent.kind;
    return (
      candidate.eventVersion.confirmation &&
      (eventKind === "final_confirmed" || eventKind === "supplemental") &&
      input.selectionRefs?.matches(sourceSelectionRef, {
        actorUserId: input.actorUserId,
        authorityVersionId:
          input.clearingCase.authorityVersionId ?? input.clearingCase.id,
        authorityFingerprint:
          input.clearingCase.authoritySnapshotRef ?? input.clearingCase.id,
        purpose: "allocation",
        selectedKey: candidate.id,
        revision: input.clearingCase.revision
      })
    );
  });
  const kind = selected?.eventVersion.clearingEvent.kind;
  const impact = selected?.eventVersion.impactLinks
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (
    !selected ||
    (kind !== "final_confirmed" && kind !== "supplemental") ||
    !impact ||
    !/^[0-9a-f]{64}$/.test(selected.eventVersion.fingerprint)
  ) {
    throw new BadRequestException("既有经济事件选择已过期、跨案或影响链不完整");
  }
  const reversed = await input.tx.clearingAllocation.aggregate({
    where: { reversesAllocationId: selected.id },
    _sum: { amountCents: true }
  });
  const remaining = selected.amountCents - (reversed._sum.amountCents ?? 0n);
  if (amountCents > remaining) {
    throw new ConflictException("既有经济事件可退回金额已漂移，请重新准备版本");
  }
  return {
    sourceEventVersionId: selected.eventVersionId,
    allocationSourceKind: kind,
    sourceAllocationRemainingCents: remaining,
    sourceClearingAllocationId: selected.id,
    frozenSource: {
      kind: "prior_economic_event",
      sourceEventVersionId: selected.eventVersionId,
      sourceEventVersionFingerprint: selected.eventVersion.fingerprint,
      sourceClearingAllocationId: selected.id,
      sourceImpactId: impact.id
    }
  };
}

async function freezeOrdinaryAllocations(
  input: FreezeInput,
  resultKind: "final_confirmed" | "real_return" | "continued_withheld",
  drafts: unknown[],
  startingOrdinal: number,
  existingPlans: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  if (drafts.length === 0) return [];
  if (resultKind === "continued_withheld") {
    throw new BadRequestException("继续暂扣不得带 ordinary allocation");
  }
  if (!input.selectionRefs) {
    throw new ConflictException("清算 ordinary selectionRef 服务未注册，必须失败关闭");
  }
  const candidates = await input.tx.clearingEventVersion.findMany({
    where: {
      clearingCaseId: input.clearingCase.id,
      workflowStatus: "confirmed"
    },
    include: { clearingEvent: true, confirmation: true }
  });
  const output: Array<Record<string, unknown>> = [];
  for (const [index, raw] of drafts.entries()) {
    const draft = requireRecord(raw, "ordinary allocation 格式不正确");
    assertExactKeys(
      draft,
      ["sourceKind", "sourceSelectionRef", "amountCents"],
      "ordinary allocation"
    );
    const sourceKind = requiredText(draft.sourceKind, "ordinary 来源类型不能为空");
    const amountCents = positiveCents(draft.amountCents);
    const sourceSelectionRef = requiredText(
      draft.sourceSelectionRef,
      "ordinary allocation 必须提交短效来源选择"
    );
    if (
      (resultKind === "final_confirmed" &&
        sourceKind !== "withheld" && sourceKind !== "authority_cap") ||
      (resultKind === "real_return" &&
        sourceKind !== "withheld" &&
        sourceKind !== "final_confirmed" &&
        sourceKind !== "supplemental")
    ) {
      throw new BadRequestException("ordinary allocation 来源类型与结果事件不匹配");
    }
    let sourceEventVersionId: string | null = null;
    let frozenSource: Record<string, unknown>;
    let sourceRemaining: bigint;
    if (sourceKind === "authority_cap") {
      if (
        !input.clearingCase.authorityVersionId ||
        !input.clearingCase.authoritySnapshotRef ||
        !input.clearingCase.sourceDiscriminator ||
        !input.selectionRefs.matches(sourceSelectionRef, {
          actorUserId: input.actorUserId,
          authorityVersionId: input.clearingCase.authorityVersionId,
          authorityFingerprint: input.clearingCase.authoritySnapshotRef,
          purpose: "allocation",
          selectedKey: input.clearingCase.id,
          revision: input.clearingCase.revision
        })
      ) {
        throw new BadRequestException("ordinary authority cap 选择已过期或坐标不完整");
      }
      const [cap] = await input.tx.$queryRaw<Array<{ remaining: bigint }>>(Prisma.sql`
        SELECT (${input.clearingCase.authoritativeGrossCapCents}::bigint - COALESCE(SUM(
          CASE WHEN allocation."reversesAllocationId" IS NULL
            THEN allocation."amountCents" ELSE -allocation."amountCents" END
        ), 0))::bigint AS remaining
        FROM "ClearingAllocation" allocation
        JOIN "ClearingEventVersion" version ON version.id = allocation."eventVersionId"
        WHERE version."clearingCaseId" = ${input.clearingCase.id}
          AND allocation."sourceKind" = 'authority_cap'
      `);
      sourceRemaining = cap?.remaining ?? input.clearingCase.authoritativeGrossCapCents;
      frozenSource = {
        kind: "authority_cap",
        authorityVersionId: input.clearingCase.authorityVersionId,
        authoritySnapshotRef: input.clearingCase.authoritySnapshotRef,
        sourceDiscriminator: input.clearingCase.sourceDiscriminator
      };
    } else if (sourceKind === "final_confirmed" || sourceKind === "supplemental") {
      const prior = await freezePriorEconomicSource(
        input,
        sourceSelectionRef,
        amountCents
      );
      if (prior.allocationSourceKind !== sourceKind) {
        throw new BadRequestException("ordinary 既有经济事件类型与选择不一致");
      }
      sourceEventVersionId = prior.sourceEventVersionId;
      sourceRemaining = prior.sourceAllocationRemainingCents;
      frozenSource = prior.frozenSource;
    } else {
      const selected = candidates.find(
        (candidate) =>
          candidate.confirmation &&
          candidate.clearingEvent.kind === sourceKind &&
          input.selectionRefs?.matches(sourceSelectionRef, {
            actorUserId: input.actorUserId,
            authorityVersionId:
              input.clearingCase.authorityVersionId ?? input.clearingCase.id,
            authorityFingerprint:
              input.clearingCase.authoritySnapshotRef ?? input.clearingCase.id,
            purpose: "allocation",
            selectedKey: candidate.id,
            revision: input.clearingCase.revision
          })
      );
      if (!selected || !/^[0-9a-f]{64}$/.test(selected.fingerprint)) {
        throw new BadRequestException("ordinary 来源选择已过期、未确认或跨案");
      }
      sourceEventVersionId = selected.id;
      const [available] = await input.tx.$queryRaw<Array<{ remaining: bigint }>>(Prisma.sql`
        SELECT (
          source."amountCents"
          - COALESCE(SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
              THEN allocation."amountCents" ELSE -allocation."amountCents" END), 0)
          - CASE WHEN ${sourceKind} = 'withheld'
              THEN public."pol275_active_coverage_occupancy"(source.id) ELSE 0 END
        )::bigint AS remaining
        FROM "ClearingEventVersion" source
        LEFT JOIN "ClearingAllocation" allocation
          ON allocation."sourceEventVersionId" = source.id
        WHERE source.id = ${selected.id}
        GROUP BY source.id, source."amountCents"
      `);
      sourceRemaining = available?.remaining ?? selected.amountCents;
      frozenSource = {
        kind: "withheld",
        sourceEventVersionId: selected.id,
        sourceEventVersionFingerprint: selected.fingerprint
      };
    }
    const alreadyPlanned = [...existingPlans, ...output]
      .filter((plan) =>
        plan.allocationSourceKind === sourceKind &&
        plan.sourceEventVersionId === sourceEventVersionId
      )
      .reduce((sum, plan) => sum + BigInt(String(plan.amountCents)), 0n);
    if (alreadyPlanned + amountCents > sourceRemaining) {
      throw new ConflictException("ordinary allocation 来源容量已漂移，请重新准备版本");
    }
    output.push({
      allocationNo: startingOrdinal + index,
      clearingAllocationId: randomUUID(),
      purpose: "ordinary_remainder",
      resolutionLineId: null,
      allocationSourceKind: sourceKind,
      sourceEventVersionId,
      amountCents: amountCents.toString(),
      frozenSource
    });
  }
  return output;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const expected = new Set(keys);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new BadRequestException(`${label}字段集合不正确`);
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function positiveCents(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException("核对金额必须是正整数分字符串");
  }
  const cents = BigInt(value);
  if (cents > MAX_BIGINT) throw new BadRequestException("核对金额超过数据库整数分上限");
  return cents;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
