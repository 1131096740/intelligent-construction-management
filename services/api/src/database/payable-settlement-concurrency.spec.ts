import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PayableRegistryService } from "../payable-registry/payable-registry.service";

const TEST_DATABASE = "jiangkong_payable_settlement_dynamic_test";
const LIVE_TEST_ENABLED = process.env.RUN_PAYABLE_SETTLEMENT_DATABASE === "1";
type DatabaseClient = PrismaClient | Prisma.TransactionClient;
type PayerAuthority = {
  id: string;
  reference: string;
  holderCompanyEntityId: string;
  holderNameSnapshot: string;
  holderCreditCodeSnapshot: string;
  verificationReference: string;
  verifiedByUserId: string;
  verifiedAt: Date;
  verificationEvidenceFileId: string;
  verificationEvidenceContentSha256: string;
  status: string;
  sourceType: string;
  sourceRecordId: string;
  createdAt?: Date;
};

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
    })).rejects.toThrow("payable_settlement_state_audit_invalid");
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
    })).rejects.toThrow("payable_settlement_state_audit_invalid");
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
    })).rejects.toThrow("payable_settlement_state_audit_invalid");
    await expect(observer.payableSettlementCase.count({
      where: { paymentExecutionId: returned.paymentExecutionId }
    })).resolves.toBe(1);
  });

  it("requires a confirmed cross-company case to carry its proxy relationship root", async () => {
    const fixture = await createFixture(observer, 1_000n, randomUUID());
    await observer.payableSettlementAllocation.create({
      data: allocationData(fixture, "payable-a", 1_000n)
    });
    await observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId },
      data: {
        status: "submitted",
        revision: { increment: 1 },
        submittedByUserId: "submitter",
        submittedAt: new Date("2026-08-27T08:10:00.000Z")
      }
    });
    await expect(observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId },
      data: {
        status: "confirmed",
        revision: { increment: 1 },
        confirmedByUserId: "director",
        confirmedAt: new Date("2026-08-27T08:20:00.000Z")
      }
    })).rejects.toThrow("inter_entity_relationship_required");
    await expect(observer.payableSettlementCase.findUnique({
      where: { id: fixture.settlementCaseId },
      select: { status: true, revision: true }
    })).resolves.toMatchObject({ status: "submitted", revision: 2 });
  });

  it("requires an immutable server-issued bank-holder authority and evidence SoD", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const authority = await createPayerAuthority(observer, fixture);

    await expect(observer.paymentExecutionPayerVerification.create({
      data: authority
    })).rejects.toThrow("payment_execution_payer_verification_issuer_required");
    await expect(observer.$queryRaw(
      Prisma.sql`SELECT * FROM public."jg_issue_payment_execution_payer_verification"(${JSON.stringify(authority)}::JSONB)`
    )).rejects.toThrow("payment_execution_payer_verification_issuer_role_required");

    await expect(issuePayerAuthority(observer, {
      ...authority,
      id: randomUUID(),
      verifiedByUserId: fixture.actorUserId
    })).rejects.toThrow("payment_execution_payer_verification_verifier_invalid");

    const created = await issuePayerAuthority(observer, authority);
    await expect(observer.paymentExecutionPayerVerification.update({
      where: { id: created.id },
      data: { holderNameSnapshot: "篡改主体" }
    })).rejects.toThrow("payment_execution_payer_verification_immutable");
    await expect(observer.paymentExecutionPayerVerification.delete({
      where: { id: created.id }
    })).rejects.toThrow("payment_execution_payer_verification_immutable");

    const attestation = await observer.paymentExecutionPayerAttestation.create({
      data: {
        id: randomUUID(),
        paymentExecutionId: fixture.paymentExecutionId,
        payerVerificationId: created.id,
        bankAccountReference: authority.reference,
        holderCompanyEntityId: authority.holderCompanyEntityId,
        holderNameSnapshot: authority.holderNameSnapshot,
        holderCreditCodeSnapshot: authority.holderCreditCodeSnapshot,
        verificationReference: authority.verificationReference,
        verifiedByUserId: authority.verifiedByUserId,
        verifiedAt: authority.verifiedAt,
        verificationEvidenceFileId: authority.verificationEvidenceFileId,
        verificationEvidenceContentSha256: authority.verificationEvidenceContentSha256
      }
    });
    await expect(observer.paymentExecutionPayerAttestation.update({
      where: { id: attestation.id },
      data: { holderNameSnapshot: "篡改主体" }
    })).rejects.toThrow("payment_execution_payer_attestation_append_only");
    await expect(observer.paymentExecutionPayerAttestation.delete({
      where: { id: attestation.id }
    })).rejects.toThrow("payment_execution_payer_attestation_append_only");

    // A confirmed relationship root must reuse the immutable PaymentExecution
    // voucher as its evidence anchor; a different file is a direct-SQL
    // forgery even when the rest of the subject snapshots look valid.
    await observer.payableSettlementAllocation.create({
      data: allocationData(fixture, "payable-a", fixture.amountCents)
    });
    await observer.payableSettlementCase.update({
      where: { id: fixture.settlementCaseId },
      data: { status: "submitted", revision: { increment: 1 }, submittedByUserId: "submitter", submittedAt: new Date() }
    });
    const forgedEvidenceFileId = randomUUID();
    await observer.fileObject.create({ data: dynamicFile(forgedEvidenceFileId, "forged-relationship-evidence") });
    const forgedAuthorizationEvidenceFileId = randomUUID();
    await observer.fileObject.create({ data: dynamicFile(forgedAuthorizationEvidenceFileId, "forged-relationship-authorization") });
    const forgedActualPayerEvidenceFileId = randomUUID();
    await observer.fileObject.create({ data: dynamicFile(forgedActualPayerEvidenceFileId, "forged-actual-payer-evidence") });
    const forgedRoot = await observer.interEntityRelationshipEntry.create({
      data: {
        id: randomUUID(),
        entryKind: "proxy_payment",
        direction: "increase",
        status: "draft",
        paymentExecutionId: fixture.paymentExecutionId,
        settlementCaseId: fixture.settlementCaseId,
        originalDebtorCompanyId: randomUUID(),
        creditorCompanyId: fixture.debtorCompanyId,
        approvedPayerCompanyId: fixture.debtorCompanyId,
        debtorSnapshot: { companyEntityId: "forged-debtor" },
        creditorSnapshot: { companyEntityId: fixture.debtorCompanyId },
        approvedPayerSnapshot: { companyEntityId: fixture.debtorCompanyId },
        amountCents: fixture.amountCents,
        currencyCode: "CNY",
        evidenceFileId: forgedEvidenceFileId,
        actualPayerVerificationEvidenceFileId: forgedActualPayerEvidenceFileId,
        actualPayerVerificationContentSha256: "f".repeat(64),
        authorizationEvidenceFileId: forgedAuthorizationEvidenceFileId,
        authorizationEvidenceContentSha256: "f".repeat(64),
        reauthorizationReference: randomUUID(),
        reauthorizedByUserId: fixture.actorUserId,
        reauthorizedAt: new Date("2026-08-27T08:30:00.000Z"),
        projectId: fixture.projectId,
        contractId: fixture.contractId,
        contractVersionId: fixture.contractVersionId,
        sourceType: "wage_payable_ref",
        sourceAggregateId: fixture.confirmedVersionId,
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: fixture.amountCents,
        reason: null,
        idempotencyKey: randomUUID(),
        payloadFingerprint: "forged-root",
        createdByUserId: fixture.actorUserId
      }
    });
    await expect(observer.interEntityRelationshipEntry.update({
      where: { id: forgedRoot.id },
      data: { status: "confirmed", confirmedByUserId: "director", confirmedAt: new Date() }
    })).rejects.toThrow("inter_entity_relationship_scope_invalid");
  });

  it("locks the authority evidence row before freezing its hash", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const authority = await createPayerAuthority(observer, fixture);
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let authorityInserted!: () => void;
    const authorityReady = new Promise<void>((resolve) => {
      authorityInserted = resolve;
    });
    const authorityInsert = first.$transaction(async (tx) => {
      await issuePayerAuthority(tx, authority);
      authorityInserted();
      await firstRelease;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await authorityReady;

    let secondStarted!: () => void;
    const secondReady = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let secondSettled = false;
    const fileUpdate = second.$transaction(async (tx) => {
      secondStarted();
      return tx.fileObject.update({
        where: { id: authority.verificationEvidenceFileId },
        data: { contentSha256: "b".repeat(64) }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
      .then((value) => {
        secondSettled = true;
        return value;
      })
      .catch((error) => {
        secondSettled = true;
        throw error;
      });
    await secondReady;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondSettled).toBe(false);
    releaseFirst();
    await expect(authorityInsert).resolves.toBeUndefined();
    await expect(fileUpdate).rejects.toThrow("payment_execution_payer_evidence_immutable");
  });

  it("binds proxy payer attestations to an approved finance-director action and its evidence", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const authority = await createPayerAuthority(observer, fixture);
    const createdAuthority = await issuePayerAuthority(observer, authority);
    const reauthorizerUserId = randomUUID();
    const reauthorizationEvidenceFileId = randomUUID();
    const approvalInstanceId = randomUUID();
    const approvalActionLogId = randomUUID();
    const position = await observer.position.upsert({
      where: { key: "finance_director" },
      update: {},
      create: { key: "finance_director", name: "财务负责人" }
    });
    await observer.user.create({ data: { id: reauthorizerUserId, name: "动态门重新授权人" } });
    await observer.userPosition.create({
      data: { id: randomUUID(), userId: reauthorizerUserId, positionId: position.id, projectId: null }
    });
    await observer.fileObject.create({
      data: {
        ...dynamicFile(reauthorizationEvidenceFileId, "payer-reauthorization"),
        uploadedByUserId: reauthorizerUserId,
        contentSha256: "b".repeat(64)
      }
    });
    await observer.approvalInstance.create({
      data: {
        id: approvalInstanceId,
        flowType: "payment_request",
        businessType: "payment_request",
        businessId: fixture.paymentRequestId,
        status: "approved",
        currentNodeIndex: 0,
        frozenNodes: [],
        applicantUserId: fixture.actorUserId
      }
    });
    await observer.approvalActionLog.create({
      data: {
        id: approvalActionLogId,
        approvalInstanceId,
        action: "approve",
        actorUserId: reauthorizerUserId,
        approvedRoleKey: "finance_director",
        metadata: {
          paymentRequestId: fixture.paymentRequestId,
          contractVersionId: fixture.contractVersionId
        }
      }
    });
    const proxyData = {
      id: randomUUID(),
      paymentExecutionId: fixture.paymentExecutionId,
      payerVerificationId: createdAuthority.id,
      bankAccountReference: authority.reference,
      holderCompanyEntityId: authority.holderCompanyEntityId,
      holderNameSnapshot: authority.holderNameSnapshot,
      holderCreditCodeSnapshot: authority.holderCreditCodeSnapshot,
      verificationReference: authority.verificationReference,
      verifiedByUserId: authority.verifiedByUserId,
      verifiedAt: authority.verifiedAt,
      verificationEvidenceFileId: authority.verificationEvidenceFileId,
      verificationEvidenceContentSha256: authority.verificationEvidenceContentSha256,
      proxyAuthorizationReason: "动态门跨主体授权",
      proxyAuthorizationEvidenceFileId: reauthorizationEvidenceFileId,
      proxyAuthorizationEvidenceSha256: "b".repeat(64),
      reauthorizationReference: approvalActionLogId,
      reauthorizationApprovalInstanceId: approvalInstanceId,
      reauthorizationApprovalActionLogId: approvalActionLogId,
      reauthorizationPaymentRequestId: fixture.paymentRequestId,
      reauthorizationContractVersionId: fixture.contractVersionId,
      reauthorizedByUserId: reauthorizerUserId,
      reauthorizedAt: new Date("2026-08-27T08:30:00.000Z")
    };
    await expect(observer.paymentExecutionPayerAttestation.create({
      data: { ...proxyData, reauthorizationReference: randomUUID() }
    })).rejects.toThrow("payment_execution_payer_attestation_approval_binding_invalid");
    await expect(observer.paymentExecutionPayerAttestation.create({ data: proxyData })).resolves.toMatchObject({
      paymentExecutionId: fixture.paymentExecutionId,
      reauthorizationApprovalActionLogId: approvalActionLogId
    });
    await expect(observer.approvalActionLog.update({
      where: { id: approvalActionLogId },
      data: { comment: "篡改已绑定审批" }
    })).rejects.toThrow("payment_execution_payer_approval_binding_immutable");
    await expect(observer.approvalInstance.update({
      where: { id: approvalInstanceId },
      data: { status: "cancelled" }
    })).rejects.toThrow("payment_execution_payer_approval_binding_immutable");
    await expect(observer.fileObject.update({
      where: { id: reauthorizationEvidenceFileId },
      data: { contentSha256: "c".repeat(64) }
    })).rejects.toThrow("payment_execution_payer_evidence_immutable");
  });

  it("rejects direct allocations whose typed source coordinates do not match a confirmed wage ref", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const invalidSource = allocationData(fixture, "payable-a", 100n);
    await expect(observer.payableSettlementAllocation.create({
      data: {
        ...invalidSource,
        payableRef: randomUUID(),
        sourceLineId: randomUUID()
      }
    })).rejects.toThrow("payable_settlement_source_not_confirmed");
  });

  it("keeps project scope while allowing a separately authorized execution payer", async () => {
    const fixture = await createFixture(observer, 1_000n, randomUUID());
    await expect(observer.payableSettlementAllocation.create({
      data: {
        ...allocationData(fixture, "payable-a", 100n),
        beneficiaryProjectId: randomUUID()
      }
    })).rejects.toThrow("payable_settlement_source_snapshot_invalid");
    await expect(observer.payableSettlementAllocation.count({
      where: { paymentExecutionId: fixture.paymentExecutionId }
    })).resolves.toBe(0);

    await expect(observer.payableSettlementAllocation.create({
      data: {
        ...allocationData(fixture, "payable-b", 100n)
      }
    })).resolves.toMatchObject({ amountCents: 100n });
    await expect(observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(fixture, "payable-immutable", fixture.paymentExecutionId, 100n)
    })).resolves.toMatchObject({ amountCents: 100n });
  });

  it("rejects direct allocations when the request contract lineage crosses project boundaries", async () => {
    const fixture = await createFixture(observer, 1_000n);
    const rogueProjectId = randomUUID();
    const rogueContractId = randomUUID();
    const rogueContractVersionId = randomUUID();
    await observer.project.create({
      data: { id: rogueProjectId, code: `DYN-ROGUE-${rogueProjectId}`, name: "跨项目合同" }
    });
    await observer.contract.create({
      data: {
        id: rogueContractId,
        projectId: rogueProjectId,
        code: `DYN-ROGUE-CONTRACT-${rogueContractId}`,
        name: "跨项目工资付款合同",
        counterparty: "跨项目测试相对方",
        companyEntityId: fixture.debtorCompanyId,
        companyEntityName: "动态门付款主体",
        contractTypeKey: "labor_subcontract",
        ownerUserId: fixture.actorUserId
      }
    });
    await observer.contractVersion.create({
      data: {
        id: rogueContractVersionId,
        contractId: rogueContractId,
        versionNo: 1,
        changeType: "original",
        status: "draft",
        amountCents: fixture.amountCents,
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: fixture.debtorCompanyId,
        draftData: {},
        templateSnapshot: {},
        clauseSnapshot: {}
      }
    });
    await observer.paymentRequest.update({
      where: { id: fixture.paymentRequestId },
      data: { contractId: rogueContractId, contractVersionId: rogueContractVersionId }
    });

    await expect(observer.payableSettlementAllocation.create({
      data: allocationData(fixture, "payable-a", 100n)
    })).rejects.toThrow("payable_settlement_execution_scope_invalid");
    await expect(observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(fixture, "payable-a", fixture.paymentExecutionId, 100n)
    })).rejects.toThrow("payment_execution_wage_binding_scope_invalid");
  });

  it("rejects a direct allocation whose amount exceeds the existing execution", async () => {
    const fixture = await createFixture(observer, 1_000n);
    await expect(observer.payableSettlementAllocation.create({
      data: allocationData(fixture, "payable-a", fixture.amountCents + 1n)
    })).rejects.toThrow("payable_settlement_execution_amount_invalid");
  });

  it("enforces the cumulative wage-binding amount for one payment execution", async () => {
    const fixture = await createFixture(observer, 1_000n);
    await observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(fixture, "payable-a", fixture.paymentExecutionId, 700n)
    });

    await expect(observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(fixture, "payable-b", fixture.paymentExecutionId, 400n)
    })).rejects.toThrow("payment_execution_wage_binding_execution_balance_invalid");
    await expect(observer.paymentExecutionWagePayableBinding.count({
      where: { paymentExecutionId: fixture.paymentExecutionId }
    })).resolves.toBe(1);
  });

  it("enforces cumulative wage-binding balance for one source ref across executions", async () => {
    const fixture = await createFixture(observer, 1_000n);
    await observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(fixture, "payable-a", fixture.paymentExecutionId, 700n)
    });

    const secondVoucherFileId = randomUUID();
    const secondPaymentExecutionId = randomUUID();
    await observer.fileObject.create({
      data: dynamicFile(secondVoucherFileId, "payment-voucher-second")
    });
    await observer.paymentExecution.create({
      data: {
        id: secondPaymentExecutionId,
        idempotencyKey: randomUUID(),
        paymentRequestId: fixture.paymentRequestId,
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: fixture.debtorCompanyId,
        companyEntityNameSnapshot: "动态门付款主体",
        companyEntityCreditCodeSnapshot: "91310000DYNAMICGATE",
        amountCents: fixture.amountCents,
        paidAt: new Date(),
        executedByUserId: fixture.actorUserId,
        voucherFileId: secondVoucherFileId
      }
    });

    await expect(observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(fixture, "payable-a", secondPaymentExecutionId, 400n)
    })).rejects.toThrow("payment_execution_wage_binding_source_balance_invalid");
    await expect(observer.paymentExecutionWagePayableBinding.count({
      where: { wagePayableRefId: fixture.payableRefs["payable-a"] }
    })).resolves.toBe(1);
  });

  it("enforces one execution total across generic allocations and wage bindings in either write order", async () => {
    const genericFirst = await createFixture(observer, 1_000n);
    await observer.paymentExecutionAllocation.create({
      data: paymentExecutionAllocationData(genericFirst, 700n)
    });
    await expect(observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(genericFirst, "payable-a", genericFirst.paymentExecutionId, 400n)
    })).rejects.toThrow("payment_execution_wage_binding_execution_balance_invalid");
    await expect(observer.paymentExecutionWagePayableBinding.count({
      where: { paymentExecutionId: genericFirst.paymentExecutionId }
    })).resolves.toBe(0);

    const wageFirst = await createFixture(observer, 1_000n);
    await observer.paymentExecutionWagePayableBinding.create({
      data: wageBindingData(wageFirst, "payable-a", wageFirst.paymentExecutionId, 700n)
    });
    await expect(observer.paymentExecutionAllocation.create({
      data: paymentExecutionAllocationData(wageFirst, 400n)
    })).rejects.toThrow("payment_execution_allocation_total_invalid");
    await expect(observer.paymentExecutionAllocation.count({
      where: { paymentExecutionId: wageFirst.paymentExecutionId }
    })).resolves.toBe(0);
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

  it("confirms a cross-company service path while reusing voucher and authorization evidence", async () => {
    const fixture = await createEligibleServiceFixture(observer, 1_000n, true);
    const authority = await createPayerAuthority(observer, fixture);
    const createdAuthority = await issuePayerAuthority(observer, authority);
    const reauthorizerUserId = randomUUID();
    const confirmerUserId = randomUUID();
    const reauthorizationEvidenceFileId = randomUUID();
    const approvalInstanceId = randomUUID();
    const approvalActionLogId = randomUUID();
    const directorPosition = await observer.position.upsert({
      where: { key: "finance_director" },
      update: {},
      create: { key: "finance_director", name: "财务负责人" }
    });
    await observer.user.create({ data: { id: reauthorizerUserId, name: "动态门跨主体授权人" } });
    await observer.user.create({ data: { id: confirmerUserId, name: "动态门核销确认人" } });
    await observer.userPosition.createMany({
      data: [
        { id: randomUUID(), userId: reauthorizerUserId, positionId: directorPosition.id, projectId: null },
        { id: randomUUID(), userId: confirmerUserId, positionId: directorPosition.id, projectId: null }
      ]
    });
    await observer.fileObject.create({
      data: {
        ...dynamicFile(reauthorizationEvidenceFileId, "payer-reauthorization"),
        uploadedByUserId: reauthorizerUserId,
        contentSha256: "b".repeat(64)
      }
    });
    await observer.approvalInstance.create({
      data: {
        id: approvalInstanceId,
        flowType: "payment_request",
        businessType: "payment_request",
        businessId: fixture.paymentRequestId,
        status: "approved",
        currentNodeIndex: 0,
        frozenNodes: [],
        applicantUserId: fixture.actorUserId
      }
    });
    await observer.approvalActionLog.create({
      data: {
        id: approvalActionLogId,
        approvalInstanceId,
        action: "approve",
        actorUserId: reauthorizerUserId,
        approvedRoleKey: "finance_director",
        metadata: {
          paymentRequestId: fixture.paymentRequestId,
          contractVersionId: fixture.contractVersionId
        }
      }
    });
    await observer.paymentExecutionPayerAttestation.create({
      data: {
        id: randomUUID(),
        paymentExecutionId: fixture.paymentExecutionId,
        payerVerificationId: createdAuthority.id,
        bankAccountReference: authority.reference,
        holderCompanyEntityId: authority.holderCompanyEntityId,
        holderNameSnapshot: authority.holderNameSnapshot,
        holderCreditCodeSnapshot: authority.holderCreditCodeSnapshot,
        verificationReference: authority.verificationReference,
        verifiedByUserId: authority.verifiedByUserId,
        verifiedAt: authority.verifiedAt,
        verificationEvidenceFileId: authority.verificationEvidenceFileId,
        verificationEvidenceContentSha256: authority.verificationEvidenceContentSha256,
        proxyAuthorizationReason: "动态门跨主体付款授权",
        proxyAuthorizationEvidenceFileId: reauthorizationEvidenceFileId,
        proxyAuthorizationEvidenceSha256: "b".repeat(64),
        reauthorizationReference: approvalActionLogId,
        reauthorizationApprovalInstanceId: approvalInstanceId,
        reauthorizationApprovalActionLogId: approvalActionLogId,
        reauthorizationPaymentRequestId: fixture.paymentRequestId,
        reauthorizationContractVersionId: fixture.contractVersionId,
        reauthorizedByUserId: reauthorizerUserId,
        reauthorizedAt: new Date("2026-08-27T08:30:00.000Z")
      }
    });
    const service = realService(
      observer,
      new AuditService(),
      async (actorUserId) => actorUserId === confirmerUserId
        ? ["finance_director"]
        : ["finance_staff"]
    );
    const listed = await service.listPaymentExecutionCandidates(
      fixture.actorUserId,
      fixture.payableRef
    );
    expect(listed.candidates).toHaveLength(1);
    const allocated = await service.allocatePaymentExecution(fixture.actorUserId, {
      payableRef: fixture.payableRef,
      selectionRef: listed.candidates[0].selectionRef,
      selectionExpiresAt: listed.candidates[0].expiresAt,
      amountCents: 1_000n,
      expectedCaseRevision: fixture.caseRevision,
      idempotencyKey: randomUUID()
    }) as unknown as { settlementCaseId: string; revision: number };
    const submitted = await service.submit(fixture.actorUserId, {
      settlementCaseId: allocated.settlementCaseId,
      expectedRevision: allocated.revision,
      idempotencyKey: randomUUID()
    }) as unknown as { revision: number };
    const confirmed = await service.confirm(confirmerUserId, {
      settlementCaseId: allocated.settlementCaseId,
      expectedRevision: submitted.revision,
      idempotencyKey: randomUUID()
    }) as unknown as { status: string };

    expect(confirmed.status).toBe("confirmed");
    await expect(observer.interEntityRelationshipEntry.findFirst({
      where: {
        settlementCaseId: allocated.settlementCaseId,
        entryKind: "proxy_payment",
        direction: "increase",
        status: "confirmed"
      },
      select: {
        evidenceFileId: true,
        authorizationEvidenceFileId: true,
        originalDebtorCompanyId: true,
        creditorCompanyId: true,
        approvedPayerCompanyId: true,
        sourceAllocationCount: true,
        sourceAllocationAmountCents: true
      }
    })).resolves.toMatchObject({
      evidenceFileId: expect.not.stringContaining(reauthorizationEvidenceFileId),
      authorizationEvidenceFileId: reauthorizationEvidenceFileId,
      originalDebtorCompanyId: fixture.debtorCompanyId,
      creditorCompanyId: fixture.executionPayerCompanyId,
      approvedPayerCompanyId: fixture.debtorCompanyId,
      sourceAllocationCount: 1,
      sourceAllocationAmountCents: 1_000n
    });
    const execution = await observer.paymentExecution.findUniqueOrThrow({
      where: { id: fixture.paymentExecutionId },
      select: { voucherFileId: true }
    });
    const relationship = await observer.interEntityRelationshipEntry.findFirstOrThrow({
      where: { settlementCaseId: allocated.settlementCaseId, entryKind: "proxy_payment" },
      select: { evidenceFileId: true }
    });
    expect(relationship.evidenceFileId).toBe(execution.voucherFileId);
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
  actorUserId: string;
  paymentExecutionId: string;
  executionPayerCompanyId: string;
  paymentRequestId: string;
  settlementCaseId: string;
  amountCents: bigint;
  confirmedVersionId: string;
  debtorCompanyId: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  payeeSubjectType: "employee_user";
  payeeSubjectId: string;
  payableRefs: Readonly<Record<string, string>>;
}>;

async function createFixture(
  client: PrismaClient,
  amountCents: bigint,
  executionCompanyIdSnapshot?: string
): Promise<Fixture> {
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
  const evidenceFileId = randomUUID();
  const sourceVersionId = randomUUID();
  const statementId = randomUUID();
  const confirmedVersionId = randomUUID();
  const serviceBasisBindingId = randomUUID();
  const payableRefs = {
    "payable-a": randomUUID(),
    "payable-b": randomUUID(),
    "payable-immutable": randomUUID()
  } as const;
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
      originalText: "动态门付款条款"
    }
  });
  await client.fileObject.create({ data: dynamicFile(evidenceFileId, "wage-source") });
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
  for (const id of Object.values(payableRefs)) {
    const personLineId = randomUUID();
    const creditorBreakdownId = randomUUID();
    const projectAllocationId = randomUUID();
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
        creditorSubjectType: "employee_user",
        creditorUserId: actorUserId,
        creditorSubjectIdentityKey: `employee_user:${actorUserId}`,
        creditorNameSnapshot: "动态门工资员工",
        creditorUnifiedIdentitySnapshot: null,
        creditorVersionFingerprint: "c".repeat(64),
        creditorCategory: "employee_net_pay",
        amountCents,
        sourceSnapshot: { protected: true }
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
        id,
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
          subjectType: "employee_user",
          identityKey: `employee_user:${actorUserId}`,
          name: "动态门工资员工"
        },
        amountCents,
        direction: "increase",
        settlementRecheckRequired: false
      }
    });
  }
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
      companyEntityIdSnapshot: executionCompanyIdSnapshot ?? companyId,
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
  return {
    actorUserId,
    paymentExecutionId,
    executionPayerCompanyId: executionCompanyIdSnapshot ?? companyId,
    paymentRequestId,
    settlementCaseId,
    amountCents,
    confirmedVersionId,
    debtorCompanyId: companyId,
    projectId,
    contractId,
    contractVersionId,
    paymentTermsVersionId,
    payeeSubjectType: "employee_user",
    payeeSubjectId: `employee_user:${actorUserId}`,
    payableRefs
  };
}

async function createPayerAuthority(
  client: DatabaseClient,
  fixture: Pick<Fixture, "debtorCompanyId" | "executionPayerCompanyId">
): Promise<Omit<PayerAuthority, "createdAt">> {
  const verifierUserId = randomUUID();
  const verificationEvidenceFileId = randomUUID();
  const position = await client.position.upsert({
    where: { key: "finance_director" },
    update: {},
    create: { key: "finance_director", name: "财务负责人" }
  });
  await client.user.create({ data: { id: verifierUserId, name: "动态门银行核验人" } });
  await client.userPosition.create({
    data: { id: randomUUID(), userId: verifierUserId, positionId: position.id, projectId: null }
  });
  await client.fileObject.create({
    data: {
      ...dynamicFile(verificationEvidenceFileId, "payer-verification"),
      uploadedByUserId: verifierUserId,
      contentSha256: "a".repeat(64)
    }
  });
  return {
    id: randomUUID(),
    reference: `bank-authority-${randomUUID()}`,
    holderCompanyEntityId: fixture.executionPayerCompanyId,
    holderNameSnapshot: fixture.executionPayerCompanyId === fixture.debtorCompanyId
      ? "动态门付款主体"
      : "动态门实际付款主体",
    holderCreditCodeSnapshot: "91310000DYNAMICGATE",
    verificationReference: `bank-check-${randomUUID()}`,
    verifiedByUserId: verifierUserId,
    verifiedAt: new Date("2026-08-27T08:00:00.000Z"),
    verificationEvidenceFileId,
    verificationEvidenceContentSha256: "a".repeat(64),
    status: "verified",
    sourceType: "bank_account_legal_holder",
    sourceRecordId: `bank-record-${randomUUID()}`
  };
}

async function issuePayerAuthority(
  client: DatabaseClient,
  authority: Omit<PayerAuthority, "createdAt">
): Promise<PayerAuthority> {
  const runAsIssuer = async (tx: DatabaseClient) => {
    await tx.$executeRaw(
      Prisma.sql`SET LOCAL ROLE "jg_payment_execution_payer_issuer"`
    );
    const rows = await tx.$queryRaw<PayerAuthority[]>(
      Prisma.sql`SELECT * FROM public."jg_issue_payment_execution_payer_verification"(${JSON.stringify(authority)}::JSONB)`
    );
    if (rows.length !== 1) {
      throw new Error("付款主体权威表受控签发未返回唯一记录");
    }
    return rows[0];
  };

  if ("$transaction" in client) {
    return client.$transaction((tx) => runAsIssuer(tx));
  }
  return runAsIssuer(client);
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
  const resolvedPayableRef = fixture.payableRefs[payableRef] ?? payableRef;
  return {
    id: randomUUID(),
    settlementCaseId: fixture.settlementCaseId,
    paymentExecutionId: fixture.paymentExecutionId,
    payableRef: resolvedPayableRef,
    sourceType: "wage_payable_ref",
    sourceAggregateId: fixture.confirmedVersionId,
    sourceLineId: resolvedPayableRef,
    confirmedVersionId: fixture.confirmedVersionId,
    debtorCompanyId: fixture.debtorCompanyId,
    payeeSubjectType: fixture.payeeSubjectType,
    payeeSubjectId: fixture.payeeSubjectId,
    currencyCode: "CNY",
    beneficiaryProjectId: fixture.projectId,
    sourceSnapshot: { payableRef: resolvedPayableRef },
    confirmedAmountCents: fixture.amountCents,
    amountCents,
    createdByUserId: fixture.actorUserId
  };
}

function wageBindingData(
  fixture: Fixture,
  payableRef: string,
  paymentExecutionId: string,
  amountCents: bigint
) {
  const resolvedPayableRef = fixture.payableRefs[payableRef] ?? payableRef;
  return {
    id: randomUUID(),
    paymentExecutionId,
    wagePayableRefId: resolvedPayableRef,
    debtorCompanyId: fixture.debtorCompanyId,
    debtorCompanySnapshot: { companyId: fixture.debtorCompanyId },
    projectId: fixture.projectId,
    projectSnapshot: { projectId: fixture.projectId },
    creditorSubjectType: "employee_user",
    creditorUserId: fixture.actorUserId,
    creditorBusinessPartyVersionId: null,
    creditorSubjectIdentityKey: `employee_user:${fixture.actorUserId}`,
    creditorNameSnapshot: "动态门工资员工",
    creditorUnifiedIdentitySnapshot: null,
    creditorVersionFingerprint: "c".repeat(64),
    creditorSnapshot: {
      subjectType: "employee_user",
      identityKey: `employee_user:${fixture.actorUserId}`,
      name: "动态门工资员工"
    },
    amountCents,
    currencyCode: "CNY",
    createdByUserId: fixture.actorUserId
  };
}

function paymentExecutionAllocationData(
  fixture: Fixture,
  amountCents: bigint,
  allocationOrder = 1
) {
  return {
    id: randomUUID(),
    paymentExecutionId: fixture.paymentExecutionId,
    paymentRequestId: fixture.paymentRequestId,
    projectId: fixture.projectId,
    contractId: fixture.contractId,
    contractVersionId: fixture.contractVersionId,
    settlementId: randomUUID(),
    sourceType: "contract_due",
    allocationType: "contract_due_payment",
    sourceRowId: `dynamic-total-${randomUUID()}`,
    paymentTermsVersionId: fixture.paymentTermsVersionId,
    stageType: "progress",
    stageId: null,
    stageName: null,
    triggerAnchor: null,
    dueDays: null,
    ratioBps: null,
    fixedAmountCents: null,
    sourceEffectiveAt: new Date("2026-08-01T00:00:00.000Z"),
    expectedPayableAt: new Date("2026-08-31T00:00:00.000Z"),
    sourcePayableAmountCents: fixture.amountCents,
    amountCents,
    allocationOrder,
    createdByUserId: fixture.actorUserId
  };
}

function realService(
  client: PrismaClient,
  audit: Pick<AuditService, "record"> = new AuditService(),
  resolveRoles: (actorUserId: string) => Promise<readonly string[]> = async () => ["finance_staff"]
) {
  return new PayableRegistryService(
    client as never,
    { resolveActiveRoleScopes: resolveRoles } as never,
    audit as AuditService
  );
}

async function createEligibleServiceFixture(
  client: PrismaClient,
  amountCents: bigint,
  crossCompany = false
) {
  const actorUserId = randomUUID();
  const companyId = randomUUID();
  const executionPayerCompanyId = crossCompany ? randomUUID() : companyId;
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
  if (crossCompany) {
    await client.companyEntity.create({
      data: {
        id: executionPayerCompanyId,
        name: "动态门实际付款主体",
        unifiedSocialCreditCode: "91310000DYNAMICGATE"
      }
    });
  }
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
      companyEntityIdSnapshot: executionPayerCompanyId,
      companyEntityNameSnapshot: crossCompany ? "动态门实际付款主体" : "动态门付款主体",
      companyEntityCreditCodeSnapshot: "91310000DYNAMICGATE",
      amountCents,
      paidAt: new Date(),
      executedByUserId: actorUserId,
      voucherFileId
    }
  });
  await client.paymentExecutionWagePayableBinding.create({
    data: {
      id: randomUUID(),
      paymentExecutionId,
      wagePayableRefId: payableRef,
      debtorCompanyId: companyId,
      debtorCompanySnapshot: { companyId },
      projectId,
      projectSnapshot: { projectId },
      creditorSubjectType: "business_party",
      creditorUserId: null,
      creditorBusinessPartyVersionId: businessPartyVersionId,
      creditorSubjectIdentityKey: `business_party:${businessPartyVersionId}`,
      creditorNameSnapshot: "动态门工资债权机构",
      creditorUnifiedIdentitySnapshot: null,
      creditorVersionFingerprint: "c".repeat(64),
      creditorSnapshot: {
        subjectType: "business_party",
        identityKey: `business_party:${businessPartyVersionId}`,
        name: "动态门工资债权机构"
      },
      amountCents,
      currencyCode: "CNY",
      createdByUserId: actorUserId
    }
  });

  return {
    actorUserId,
    payableRef,
    paymentExecutionId,
    executionPayerCompanyId,
    debtorCompanyId: companyId,
    paymentRequestId,
    contractId,
    contractVersionId,
    projectId,
    caseRevision: 0
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
