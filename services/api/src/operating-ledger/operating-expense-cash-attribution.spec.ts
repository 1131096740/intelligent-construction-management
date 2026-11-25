import { ConflictException, ForbiddenException } from "@nestjs/common";
import { OperatingCostAttributionService } from "./operating-cost-attribution.service";

const linkId = "expense-cash-link";
const factId = "original-expense-fact";
const projectId = "project-1";
const actor = "requester";
const reviewer = "reviewer";
const occurredAt = new Date("2026-11-20T08:00:00.000Z");
const requested = { companyEntityId: "bearing-company", reason: "按原现金分摊", idempotencyKey: "request-1", expenseCashCostLinkId: linkId };

function fixture(linkAmount = 300n, numberOfLinks = 1) {
  let row: Record<string, unknown> | null = null;
  const expenseExecution = { expenseClaimId: "expense-1", refunds: [] as Array<{ amountCents: bigint; receivedAt: Date }> };
  const evidence = {
    id: linkId,
    amountCents: linkAmount,
    costImpact: { id: "original-cost", factId, description: "原费用行",
      fact: { sourceType: "expense_claim_approval", sourceBusinessCode: "BX-1", sourceBusinessId: "expense-1", occurredAt } },
    operationalPayment: { amountCents: 800n, expenseExecution,
      expensePublicCashCosts: Array.from({ length: numberOfLinks }, (_, i) => ({ id: `link-${i}` })) }
  };
  const tx = {
    project: { findFirst: jest.fn(async () => ({ id: projectId })) },
    $queryRaw: jest.fn(async () => [{ id: "expense-1" }]),
    operatingFact: { findFirst: jest.fn(async () => ({ id: factId, occurredAt })), findMany: jest.fn(async () => []) },
    expensePublicCashCostLink: { findFirst: jest.fn(async () => evidence), findMany: jest.fn(async () => [evidence]) },
    operatingCostAttributionConfirmation: {
      findUnique: jest.fn(async () => row), findUniqueOrThrow: jest.fn(async () => row),
      findFirst: jest.fn(async () => row?.activeKey ? row : null), findMany: jest.fn(async () => row ? [row] : []),
      create: jest.fn(async ({ data }) => {
        row = { ...data, id: "confirmation-1", revision: 1, requestedAt: occurredAt,
          reviewedAt: null, reviewedByUserId: null, reviewReason: null };
        return row;
      }),
      updateMany: jest.fn(async ({ data }) => {
        row = { ...row, ...data, reviewedAt: occurredAt, revision: 2 };
        return { count: 1 };
      })
    },
    projectParticipatingCompany: { findFirst: jest.fn(async () => ({
      companyEntityId: "bearing-company", companyEntityVersionId: "bearing-v1", companyNameSnapshot: "承担公司",
      companyCreditCodeSnapshot: null
    })) }
  };
  const prisma = { ...tx, $transaction: async (execute: (client: typeof tx) => Promise<unknown>) => execute(tx) };
  const visibility = { effectiveRoleKeysByProjectInTransaction: jest.fn(async (_tx, userId) => new Map([
    [projectId, userId === actor ? ["comprehensive_director"] : userId === reviewer ? ["finance_director"] : ["employee"]]
  ])) };
  const audit = { record: jest.fn() };
  const service = new OperatingCostAttributionService(prisma as never, visibility as never, audit as never, {} as never);
  return { service, tx, evidence, audit, expenseExecution, clearReceipt: () => { row = null; } };
}

it("lists, requests and confirms just the immutable 300-cent cash slice of an 800-cent payment", async () => {
  const { service, tx, audit, expenseExecution } = fixture();
  await expect(service.list(projectId, actor)).resolves.toMatchObject({ candidates: [
    { factId, expenseCashCostLinkId: linkId, amountCents: "300", activeStatus: null }
  ] });
  const request = await service.request(projectId, factId, requested, actor);
  expect(request).toMatchObject({ status: "pending_review", expenseCashCostLinkId: linkId, attributedAmountCents: "300" });
  await expect(service.request(projectId, factId, requested, actor)).resolves.toEqual(request);
  await expect(service.request(projectId, factId, { ...requested, reason: "changed" }, actor)).rejects.toThrow(ConflictException);
  await expect(service.review(projectId, request.id, { decision: "confirm", revision: 1 }, actor)).rejects.toThrow(ForbiddenException);
  const confirmed = await service.review(projectId, request.id, { decision: "confirm", revision: 1 }, reviewer);
  expect(confirmed).toMatchObject({ status: "confirmed", attributedAmountCents: "300", revision: 2 });
  expenseExecution.refunds.push({ amountCents: 800n, receivedAt: occurredAt });
  await expect(service.review(projectId, request.id, { decision: "confirm", revision: 1 }, reviewer)).resolves.toEqual(confirmed);
  await expect(service.list(projectId, actor)).resolves.toMatchObject({ candidates: [], confirmations: [confirmed] });
  expect(tx.operatingCostAttributionConfirmation.create).toHaveBeenCalledTimes(1);
  expect(tx.operatingCostAttributionConfirmation.updateMany).toHaveBeenCalledTimes(1);
  expect(audit.record).toHaveBeenCalledTimes(2);
});

it("refuses review after a refund changes previously exact proof and permits an independent smaller request", async () => {
  const { service, tx, expenseExecution, clearReceipt } = fixture(800n);
  const request = await service.request(projectId, factId, requested, actor);
  expenseExecution.refunds.push({ amountCents: 200n, receivedAt: occurredAt });
  await expect(service.review(projectId, request.id, { decision: "confirm", revision: 1 }, reviewer))
    .rejects.toThrow("实付净额已变化");
  expect(tx.operatingCostAttributionConfirmation.updateMany).not.toHaveBeenCalled();
  await expect(service.review(projectId, request.id, { decision: "return", revision: 1, reason: "重新核对退款" }, reviewer))
    .resolves.toMatchObject({ status: "returned", attributedAmountCents: "800" });
  clearReceipt();
  await expect(service.request(projectId, factId, { ...requested, idempotencyKey: "request-2" }, actor))
    .resolves.toMatchObject({ status: "pending_review", attributedAmountCents: "600" });
});

it.each([[300n, 1], [800n, 2]])("pauses an ambiguous partial refund before linking %s cents", async (amount, count) => {
  const { service, tx, expenseExecution } = fixture(amount, count);
  expenseExecution.refunds.push({ amountCents: 100n, receivedAt: occurredAt });
  await expect(service.request(projectId, factId, requested, actor)).rejects.toThrow("证据待核对");
  expect(tx.operatingCostAttributionConfirmation.create).not.toHaveBeenCalled();
});

it("refuses an otherwise valid link when no unassigned same-project original cost is found", async () => {
  const { service, tx } = fixture();
  tx.expensePublicCashCostLink.findFirst.mockResolvedValueOnce(null as never);
  await expect(service.request(projectId, "other-fact", requested, actor)).rejects.toThrow(ConflictException);
  expect(tx.expensePublicCashCostLink.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ costImpact: expect.objectContaining({ factId: "other-fact", projectId,
      fact: expect.objectContaining({ projectId, costBearingCompanySubjectId: null, costBearingCompanySubjectKind: null })
    }) })
  }));
  expect(tx.operatingCostAttributionConfirmation.create).not.toHaveBeenCalled();
});

it("reports a linked review serialization conflict without returning a confirmed receipt", async () => {
  const { service, tx, audit } = fixture();
  const request = await service.request(projectId, factId, requested, actor);
  tx.operatingCostAttributionConfirmation.updateMany.mockRejectedValueOnce({ code: "40001" });
  await expect(service.review(projectId, request.id, { decision: "confirm", revision: 1 }, reviewer))
    .rejects.toThrow("公共现金归属记录或实付净额已有变化");
  expect(audit.record).toHaveBeenCalledTimes(1);
  await expect(service.list(projectId, actor)).resolves.toMatchObject({
    confirmations: [{ id: request.id, status: "pending_review", revision: 1 }]
  });
});
