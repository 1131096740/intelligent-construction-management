import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PayableRegistryService } from "../payable-registry/payable-registry.service";

const TEST_DATABASE = "jiangkong_payable_settlement_dynamic_test";
const LIVE_TEST_ENABLED = process.env.RUN_PAYABLE_SETTLEMENT_DATABASE === "1";

export function payableSettlementDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("工资应付核销动态测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("工资应付核销动态测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("payable settlement database target guard", () => {
  it("rejects a production or non-local database target", () => {
    expect(() =>
      payableSettlementDatabaseUrl("postgresql://user:pass@example.com/production")
    ).toThrow("工资应付核销动态测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? payableSettlementDatabaseUrl(process.env.PAYABLE_SETTLEMENT_DATABASE_URL)
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describeDatabase("payable settlement PostgreSQL concurrency and immutability", () => {
  const createClient = () => databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : new PrismaClient();
  const first = createClient();
  const second = createClient();
  const observer = createClient();

  afterAll(async () => {
    await Promise.all([first.$disconnect(), second.$disconnect(), observer.$disconnect()]);
  });

  it("allows at most one concurrent allocation when both attempts would exceed the payment", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const attempts = await Promise.allSettled([
      allocateWithExecutionLock(first, fixture, "payable-a", 700n),
      allocateWithExecutionLock(second, fixture, "payable-b", 700n)
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(observer.payableSettlementAllocation.aggregate({
      where: { settlementCaseId: fixture.settlementCaseId },
      _sum: { amountCents: true }
    })).resolves.toMatchObject({ _sum: { amountCents: 700n } });
  });

  it("keeps one durable receipt for a contended idempotency key", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const idempotencyKey = randomUUID();
    const data = (fingerprint: string) => ({
      id: randomUUID(),
      idempotencyKey,
      payloadFingerprint: fingerprint,
      action: "payable_settlement.allocation.create",
      settlementCaseId: fixture.settlementCaseId,
      responseSnapshot: { settlementCaseId: fixture.settlementCaseId }
    });
    const attempts = await Promise.allSettled([
      first.payableSettlementCommandReceipt.create({ data: data("fingerprint-a") }),
      second.payableSettlementCommandReceipt.create({ data: data("fingerprint-b") })
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(observer.payableSettlementCommandReceipt.count({ where: { idempotencyKey } }))
      .resolves.toBe(1);
  });

  it("blocks allocation mutation and case mutation after confirmation", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const otherFixture = await createFixture(observer, 1_000n);
    const allocation = await observer.payableSettlementAllocation.create({
      data: allocationData(fixture, "payable-immutable", 1_000n)
    });
    await observer.payableSettlementCase.update({
      where: { id: otherFixture.settlementCaseId },
      data: { status: "submitted", revision: { increment: 1 }, submittedByUserId: "submitter", submittedAt: new Date() }
    });
    await expect(observer.payableSettlementAllocation.update({
      where: { id: allocation.id },
      data: { settlementCaseId: otherFixture.settlementCaseId }
    })).rejects.toThrow("payable_settlement_allocation_case_immutable");
    await observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId },
      data: { status: "submitted", revision: { increment: 1 }, submittedByUserId: "submitter", submittedAt: new Date() }
    });
    await expect(observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId },
      data: {
        status: "confirmed",
        revision: { increment: 1 },
        submittedByUserId: "changed-submitter",
        submittedAt: new Date("2026-08-27T00:00:00.000Z"),
        confirmedByUserId: "director",
        confirmedAt: new Date()
      }
    })).rejects.toThrow("payable_settlement_submitted_audit_immutable");
    await observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId },
      data: { status: "confirmed", revision: { increment: 1 }, confirmedByUserId: "director", confirmedAt: new Date() }
    });

    await expect(observer.payableSettlementAllocation.update({
      where: { id: allocation.id }, data: { amountCents: 999n }
    })).rejects.toThrow("payable_settlement_confirmed_allocation_immutable");
    await expect(observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId }, data: { revision: { increment: 1 } }
    })).rejects.toThrow("payable_settlement_confirmed_case_immutable");

    const invalidFixture = await createFixture(observer, 1_000n);
    await expect(observer.payableSettlementCase.update({
      where: { id: invalidFixture.settlementCaseId },
      data: { status: "submitted", revision: { increment: 1 } }
    })).rejects.toThrow("payable_settlement_state_audit_invalid");
  });

  it("rejects direct non-draft inserts even with complete lifecycle audit fields", async () => {
    const submitted = await createFixture(observer, 1_000n);
    await expect(observer.payableSettlementCase.create({
      data: {
        id: randomUUID(),
        paymentExecutionId: submitted.paymentExecutionId,
        status: "submitted",
        revision: 2,
        createdByUserId: "maker",
        submittedByUserId: "submitter",
        submittedAt: new Date()
      }
    })).rejects.toThrow("payable_settlement_case_initial_state_invalid");
    await expect(observer.payableSettlementCase.count({
      where: { paymentExecutionId: submitted.paymentExecutionId }
    })).resolves.toBe(1);

    const confirmed = await createFixture(observer, 1_000n);
    await expect(observer.payableSettlementCase.create({
      data: {
        id: randomUUID(),
        paymentExecutionId: confirmed.paymentExecutionId,
        status: "confirmed",
        revision: 2,
        createdByUserId: "maker",
        submittedByUserId: "submitter",
        submittedAt: new Date(),
        confirmedByUserId: "director",
        confirmedAt: new Date()
      }
    })).rejects.toThrow("payable_settlement_case_initial_state_invalid");
    await expect(observer.payableSettlementCase.count({
      where: { paymentExecutionId: confirmed.paymentExecutionId }
    })).resolves.toBe(1);

    const returned = await createFixture(observer, 1_000n);
    await expect(observer.payableSettlementCase.create({
      data: {
        id: randomUUID(),
        paymentExecutionId: returned.paymentExecutionId,
        status: "review_returned",
        revision: 2,
        createdByUserId: "maker",
        submittedByUserId: "submitter",
        submittedAt: new Date()
      }
    })).rejects.toThrow("payable_settlement_case_initial_state_invalid");
    await expect(observer.payableSettlementCase.count({
      where: { paymentExecutionId: returned.paymentExecutionId }
    })).resolves.toBe(1);
  });

  it("runs the real service with one durable allocation and receipt under an idempotent race", async () => {
    const fixture = await createEligibleServiceFixture(observer, 1_000n);
    const service = realService(observer);
    const listed = await service.listPaymentExecutionCandidates(
      fixture.actorUserId,
      fixture.payableRef
    );
    expect(listed.candidates).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(fixture.paymentExecutionId);
    const candidate = listed.candidates[0];
    const idempotencyKey = randomUUID();
    const command = {
      payableRef: fixture.payableRef,
      selectionRef: candidate.selectionRef,
      selectionExpiresAt: candidate.expiresAt,
      amountCents: 1_000n,
      expectedCaseRevision: fixture.caseRevision,
      idempotencyKey
    };

    const [firstResult, secondResult] = await Promise.all([
      service.allocatePaymentExecution(fixture.actorUserId, command),
      service.allocatePaymentExecution(fixture.actorUserId, command)
    ]);

    expect(secondResult).toEqual(firstResult);
    await expect(observer.payableSettlementAllocation.count({
      where: { payableRef: fixture.payableRef }
    })).resolves.toBe(1);
    await expect(observer.payableSettlementCommandReceipt.count({
      where: { idempotencyKey }
    })).resolves.toBe(1);
  });

  it("rolls back case, allocation, receipt and audit when the real service audit step fails", async () => {
    const fixture = await createEligibleServiceFixture(observer, 1_000n);
    const service = realService(observer, {
      record: jest.fn().mockRejectedValue(new Error("fault-injected-audit"))
    });
    const listed = await service.listPaymentExecutionCandidates(
      fixture.actorUserId,
      fixture.payableRef
    );
    const candidate = listed.candidates[0];
    const idempotencyKey = randomUUID();

    await expect(service.allocatePaymentExecution(fixture.actorUserId, {
      payableRef: fixture.payableRef,
      selectionRef: candidate.selectionRef,
      selectionExpiresAt: candidate.expiresAt,
      amountCents: 1_000n,
      expectedCaseRevision: fixture.caseRevision,
      idempotencyKey
    })).rejects.toThrow("fault-injected-audit");

    await expect(observer.payableSettlementAllocation.count({
      where: { payableRef: fixture.payableRef }
    })).resolves.toBe(0);
    await expect(observer.payableSettlementCase.count({
      where: { paymentExecutionId: fixture.paymentExecutionId }
    })).resolves.toBe(0);
    await expect(observer.payableSettlementCommandReceipt.count({
      where: { idempotencyKey }
    })).resolves.toBe(0);
  });
});

type Fixture = Readonly<{
  paymentExecutionId: string;
  settlementCaseId: string;
  amountCents: bigint;
}>;

async function createFixture(client: PrismaClient, amountCents: bigint): Promise<Fixture> {
  const actorUserId = randomUUID();
  const paymentExecutionId = randomUUID();
  const settlementCaseId = randomUUID();
  const paymentRequestId = randomUUID();
  const voucherFileId = randomUUID();
  const projectId = randomUUID();
  const companyId = randomUUID();
  const companyVersionId = randomUUID();
  const contractId = randomUUID();
  const contractVersionId = randomUUID();
  const paymentTermsVersionId = randomUUID();
  await client.user.create({
    data: { id: actorUserId, name: "动态门并发操作人" }
  });
  await client.project.create({
    data: { id: projectId, code: `DYN-${projectId}`, name: "动态门项目" }
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: randomUUID(),
      projectId,
      businessPartyId: randomUUID(),
      businessPartyVersionId: randomUUID(),
      affiliateNameSnapshot: "动态门施工企业",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "数据库动态门夹具",
      assignedByUserId: actorUserId
    }
  });
  await client.companyEntity.create({
    data: {
      id: companyId,
      name: "动态门付款主体",
      unifiedSocialCreditCode: `DYN${companyId.replace(/-/g, "").slice(0, 15)}`
    }
  });
  await client.companyEntityVersion.create({
    data: {
      id: companyVersionId,
      companyEntityId: companyId,
      versionNo: 1,
      name: "动态门付款主体",
      unifiedSocialCreditCode: `DYN${companyId.replace(/-/g, "").slice(0, 15)}`,
      isActive: true,
      action: "create",
      actorUserId
    }
  });
  await client.contract.create({
    data: {
      id: contractId,
      projectId,
      code: `DYN-CONTRACT-${contractId}`,
      name: "动态门付款合同",
      counterparty: "动态门付款相对方",
      companyEntityId: companyId,
      companyEntityName: "动态门付款主体",
      contractTypeKey: "material_purchase",
      ownerUserId: actorUserId
    }
  });
  await client.contractVersion.create({
    data: {
      id: contractVersionId,
      contractId,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents,
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: companyId,
      companyEntityVersionId: companyVersionId,
      companyEntityNameSnapshot: "动态门付款主体",
      companyEntityCreditCodeSnapshot: `DYN${companyId.replace(/-/g, "").slice(0, 15)}`,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.paymentTermsVersion.create({
    data: {
      id: paymentTermsVersionId,
      contractId,
      contractVersionId,
      versionNo: 1,
      status: "effective",
      originalText: "动态门付款条款"
    }
  });
  await client.paymentRequest.create({
    data: {
      id: paymentRequestId,
      projectId,
      sourceType: "contract_due",
      contractId,
      contractVersionId,
      paymentTermsVersionId,
      code: `DYN-${paymentRequestId}`,
      status: "paid",
      requestedAmountCents: amountCents,
      approvedAmountCents: amountCents,
      paidAmountCents: amountCents,
      paymentSubjectType: "our_company"
    }
  });
  await client.fileObject.create({ data: dynamicFile(voucherFileId, "payment-voucher") });
  await client.paymentExecution.create({
    data: {
      id: paymentExecutionId,
      idempotencyKey: randomUUID(),
      paymentRequestId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: companyId,
      companyEntityNameSnapshot: "动态门付款主体",
      companyEntityCreditCodeSnapshot: "91310000DYNAMICGATE",
      amountCents,
      paidAt: new Date(),
      executedByUserId: actorUserId,
      voucherFileId
    }
  });
  await client.payableSettlementCase.create({
    data: {
      id: settlementCaseId,
      paymentExecutionId,
      status: "draft",
      revision: 1,
      createdByUserId: actorUserId
    }
  });
  return { paymentExecutionId, settlementCaseId, amountCents };
}

async function allocateWithExecutionLock(
  client: PrismaClient,
  fixture: Fixture,
  payableRef: string,
  amountCents: bigint
) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${fixture.paymentExecutionId} FOR UPDATE`
    );
    const allocated = await tx.payableSettlementAllocation.aggregate({
      where: {
        paymentExecutionId: fixture.paymentExecutionId,
        settlementCase: { status: { in: ["draft", "submitted", "confirmed"] } }
      },
      _sum: { amountCents: true }
    });
    if ((allocated._sum.amountCents ?? 0n) + amountCents > fixture.amountCents) {
      throw new Error("核销金额超过付款当前余额");
    }
    return tx.payableSettlementAllocation.create({
      data: allocationData(fixture, payableRef, amountCents)
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function allocationData(fixture: Fixture, payableRef: string, amountCents: bigint) {
  return {
    id: randomUUID(),
    settlementCaseId: fixture.settlementCaseId,
    paymentExecutionId: fixture.paymentExecutionId,
    payableRef,
    sourceType: "wage_payable_ref",
    sourceAggregateId: "confirmed-version",
    sourceLineId: payableRef,
    confirmedVersionId: "confirmed-version",
    debtorCompanyId: "debtor-company",
    payeeSubjectType: "business_party",
    payeeSubjectId: "business_party:creditor-version",
    currencyCode: "CNY",
    beneficiaryProjectId: "beneficiary-project",
    sourceSnapshot: { payableRef },
    confirmedAmountCents: amountCents,
    amountCents,
    createdByUserId: "maker"
  };
}

function realService(
  client: PrismaClient,
  audit: Pick<AuditService, "record"> = new AuditService()
) {
  return new PayableRegistryService(
    client as never,
    { resolveActiveRoleScopes: async () => ["finance_staff"] } as never,
    audit as AuditService
  );
}

async function createEligibleServiceFixture(client: PrismaClient, amountCents: bigint) {
  const actorUserId = randomUUID();
  const companyId = randomUUID();
  const companyVersionId = randomUUID();
  const projectId = randomUUID();
  const businessPartyId = randomUUID();
  const businessPartyVersionId = randomUUID();
  const sourceVersionId = randomUUID();
  const statementId = randomUUID();
  const confirmedVersionId = randomUUID();
  const personLineId = randomUUID();
  const creditorBreakdownId = randomUUID();
  const serviceBasisBindingId = randomUUID();
  const projectAllocationId = randomUUID();
  const payableRef = randomUUID();
  const paymentRequestId = randomUUID();
  const paymentExecutionId = randomUUID();
  const contractId = randomUUID();
  const contractVersionId = randomUUID();
  const paymentTermsVersionId = randomUUID();
  const evidenceFileId = randomUUID();
  const voucherFileId = randomUUID();

  await client.user.create({ data: { id: actorUserId, name: "动态门财务人员" } });
  const position = await client.position.upsert({
    where: { key: "finance_staff" },
    update: {},
    create: { key: "finance_staff", name: "财务人员" }
  });
  await client.userPosition.create({
    data: { userId: actorUserId, positionId: position.id, projectId: null }
  });
  await client.project.create({
    data: { id: projectId, code: `DYN-${projectId}`, name: "动态门项目" }
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: randomUUID(),
      projectId,
      businessPartyId: randomUUID(),
      businessPartyVersionId: randomUUID(),
      affiliateNameSnapshot: "动态门施工企业",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "数据库动态门夹具",
      assignedByUserId: actorUserId
    }
  });
  await client.companyEntity.create({
    data: {
      id: companyId,
      name: "动态门付款主体",
      unifiedSocialCreditCode: `DYN${companyId.replace(/-/g, "").slice(0, 15)}`
    }
  });
  await client.companyEntityVersion.create({
    data: {
      id: companyVersionId,
      companyEntityId: companyId,
      versionNo: 1,
      name: "动态门付款主体",
      unifiedSocialCreditCode: `DYN${companyId.replace(/-/g, "").slice(0, 15)}`,
      isActive: true,
      action: "create",
      actorUserId
    }
  });
  await client.contract.create({
    data: {
      id: contractId,
      projectId,
      code: `DYN-CONTRACT-${contractId}`,
      name: "动态门工资核销合同",
      counterparty: "动态门工资债权机构",
      companyEntityId: companyId,
      companyEntityName: "动态门付款主体",
      contractTypeKey: "labor_subcontract",
      ownerUserId: actorUserId
    }
  });
  await client.contractVersion.create({
    data: {
      id: contractVersionId,
      contractId,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents,
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: companyId,
      companyEntityVersionId: companyVersionId,
      companyEntityNameSnapshot: "动态门付款主体",
      companyEntityCreditCodeSnapshot: `DYN${companyId.replace(/-/g, "").slice(0, 15)}`,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.paymentTermsVersion.create({
    data: {
      id: paymentTermsVersionId,
      contractId,
      contractVersionId,
      versionNo: 1,
      status: "effective",
      originalText: "动态门工资核销付款条款"
    }
  });
  await client.fileObject.create({
    data: {
      id: evidenceFileId,
      bucket: "local-test",
      objectKey: `payable-settlement/${evidenceFileId}.json`,
      originalName: "wage-source.json",
      mimeType: "application/json",
      sizeBytes: 1,
      uploadedByUserId: actorUserId,
      contentSha256: "a".repeat(64),
      storageStatus: "active"
    }
  });
  await client.wageApprovedSourceVersion.create({
    data: {
      id: sourceVersionId,
      employmentCompanyId: companyId,
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: `external-${sourceVersionId}`,
      sourceVersion: "v1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId,
      evidenceSha256: "a".repeat(64),
      sourceFingerprint: "b".repeat(64),
      sourceSnapshot: { source: "payable-settlement-dynamic-test" },
      createdByUserId: actorUserId
    }
  });
  await client.wageStatement.create({
    data: {
      id: statementId,
      employmentCompanyId: companyId,
      wageMonth: "2026-08",
      currentRevision: 1,
      createdByUserId: actorUserId
    }
  });
  await client.wageStatementVersion.create({
    data: {
      id: confirmedVersionId,
      statementId,
      revision: 1,
      kind: "base",
      status: "confirmed",
      sourceVersionId,
      sourceSnapshot: { sourceVersionId },
      createdByUserId: actorUserId,
      lastEditedByUserId: actorUserId,
      confirmedByUserId: actorUserId,
      confirmedAt: new Date()
    }
  });
  await client.businessParty.create({
    data: {
      id: businessPartyId,
      name: "动态门工资债权机构",
      normalizedName: `dynamic-creditor-${businessPartyId}`,
      createdByUserId: actorUserId
    }
  });
  await client.businessPartyVersion.create({
    data: {
      id: businessPartyVersionId,
      businessPartyId,
      versionNo: 1,
      snapshot: { name: "动态门工资债权机构" },
      createdByUserId: actorUserId
    }
  });
  await client.wagePersonLine.create({
    data: {
      id: personLineId,
      statementVersionId: confirmedVersionId,
      employeeId: randomUUID(),
      employmentSnapshotId: randomUUID(),
      employeeSnapshot: { protected: true },
      employmentSnapshot: { protected: true },
      periodSnapshot: { wageMonth: "2026-08" },
      positionCategorySnapshot: { category: "general_worker" },
      approvedAmountCents: amountCents
    }
  });
  await client.wageCreditorBreakdown.create({
    data: {
      id: creditorBreakdownId,
      personLineId,
      creditorSubjectType: "business_party",
      creditorBusinessPartyVersionId: businessPartyVersionId,
      creditorSubjectIdentityKey: `business_party:${businessPartyVersionId}`,
      creditorNameSnapshot: "动态门工资债权机构",
      creditorVersionFingerprint: "c".repeat(64),
      creditorCategory: "other_controlled_payee",
      amountCents,
      sourceSnapshot: { protected: true }
    }
  });
  await client.wageServiceBasisBinding.create({
    data: {
      id: serviceBasisBindingId,
      sourceVersionId,
      projectId,
      serviceSnapshotId: randomUUID(),
      serviceMonth: "2026-08",
      evidenceSha256: "d".repeat(64),
      authorityFingerprint: "e".repeat(64)
    }
  });
  await client.wageProjectAllocation.create({
    data: {
      id: projectAllocationId,
      personLineId,
      projectId,
      serviceSnapshotId: randomUUID(),
      serviceBasisBindingId,
      serviceSnapshot: { projectId },
      amountCents
    }
  });
  await client.wagePayableRef.create({
    data: {
      id: payableRef,
      confirmedVersionId,
      projectAllocationId,
      creditorBreakdownId,
      debtorCompanyId: companyId,
      costBearingCompanyId: companyId,
      projectId,
      personLineId,
      debtorCompanySnapshot: { companyId },
      costBearingCompanySnapshot: { companyId },
      projectSnapshot: { projectId },
      personSnapshot: { protected: true },
      creditorSnapshot: {
        subjectType: "business_party",
        identityKey: `business_party:${businessPartyVersionId}`,
        name: "动态门工资债权机构"
      },
      amountCents,
      direction: "increase"
    }
  });
  await client.paymentRequest.create({
    data: {
      id: paymentRequestId,
      projectId,
      sourceType: "contract_due",
      contractId,
      contractVersionId,
      paymentTermsVersionId,
      code: `DYN-${paymentRequestId}`,
      status: "paid",
      requestedAmountCents: amountCents,
      approvedAmountCents: amountCents,
      paidAmountCents: amountCents,
      paymentSubjectType: "our_company"
    }
  });
  await client.contractPartySnapshot.create({
    data: {
      id: randomUUID(),
      contractVersionId,
      roleKey: "party_b",
      displayOrder: 1,
      businessPartyVersionId,
      snapshot: { name: "动态门工资债权机构" }
    }
  });
  await client.fileObject.create({ data: dynamicFile(voucherFileId, "payment-voucher") });
  await client.paymentExecution.create({
    data: {
      id: paymentExecutionId,
      idempotencyKey: randomUUID(),
      paymentRequestId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: companyId,
      companyEntityNameSnapshot: "动态门付款主体",
      companyEntityCreditCodeSnapshot: "91310000DYNAMICGATE",
      amountCents,
      paidAt: new Date(),
      executedByUserId: actorUserId,
      voucherFileId
    }
  });

  return {
    actorUserId,
    payableRef,
    paymentExecutionId,
    caseRevision: 1
  };
}

function dynamicFile(id: string, prefix: string) {
  return {
    id,
    bucket: "local-test",
    objectKey: `payable-settlement/${prefix}-${id}.json`,
    originalName: `${prefix}.json`,
    mimeType: "application/json",
    sizeBytes: 1,
    uploadedByUserId: "dynamic-test",
    contentSha256: "f".repeat(64),
    storageStatus: "active"
  };
}
