import { BadRequestException } from "@nestjs/common";
import { ProjectAffiliateBusinessService } from "./project-affiliate-business.service";

function roleTables(roleKey: string) {
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function contractFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-fact-1",
    ledgerId: "contract-ledger-1",
    projectId: "project-1",
    entryKind: "original",
    adjustsFactId: null,
    effectDirection: "increase",
    contractType: "material_purchase",
    externalContractReference: "GK-HT-2026-001",
    counterpartyName: "材料供应商",
    signedAt: new Date("2026-07-20T00:00:00.000Z"),
    amountNature: "fixed",
    amountCents: 100000n,
    advanceAllowed: false,
    advanceLimitCents: null,
    advanceTermsSummary: null,
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "挂靠建设集团",
    basisType: "written",
    description: null,
    evidenceFileId: "contract-file-1",
    documentVersion: 1,
    fileContentSha256Snapshot: "a".repeat(64),
    idempotencyKey: "2dfca5de-eb12-4b9e-b093-e392653a5cdf",
    requestFingerprint: "b".repeat(64),
    recordedByUserId: "contract-1",
    recordedByRoleKey: "contract_staff",
    status: "confirmed",
    confirmedByUserId: "contract-director-1",
    confirmedAt: new Date("2026-07-28T00:00:00.000Z"),
    confirmationActionId: "e832035b-e073-4c04-8d43-b72583e99c32",
    confirmationSignatureVersionId: "signature-version-1",
    confirmationSignatureFileId: "signature-file-1",
    confirmationSignatureSha256: "c".repeat(64),
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    updatedAt: new Date("2026-07-28T00:00:00.000Z"),
    ...overrides
  };
}

function settlementFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "settlement-fact-1",
    ledgerId: "settlement-ledger-1",
    projectId: "project-1",
    contractLedgerId: "contract-ledger-1",
    entryKind: "original",
    adjustsFactId: null,
    effectDirection: "increase",
    counterpartyName: "材料供应商",
    settledAt: new Date("2026-07-25T00:00:00.000Z"),
    periodLabel: "2026-07",
    amountCents: 50000n,
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "挂靠建设集团",
    basisType: "written",
    description: null,
    evidenceFileId: "settlement-file-1",
    documentVersion: 1,
    fileContentSha256Snapshot: "d".repeat(64),
    idempotencyKey: "e974f2f0-5b2e-4e6a-9d9d-03b81e1868ad",
    requestFingerprint: "e".repeat(64),
    recordedByUserId: "budget-1",
    recordedByRoleKey: "budget_staff",
    status: "confirmed",
    confirmedByUserId: "budget-1",
    confirmedAt: new Date("2026-07-28T01:00:00.000Z"),
    confirmationActionId: "0763bc87-efb9-42dd-830f-e8f60ce3df59",
    confirmationSignatureVersionId: "signature-version-2",
    confirmationSignatureFileId: "signature-file-2",
    confirmationSignatureSha256: "f".repeat(64),
    createdAt: new Date("2026-07-27T01:00:00.000Z"),
    updatedAt: new Date("2026-07-28T01:00:00.000Z"),
    ...overrides
  };
}

function paymentFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-fact-1",
    ledgerId: "payment-ledger-1",
    projectId: "project-1",
    contractLedgerId: "contract-ledger-1",
    settlementLedgerId: "settlement-ledger-1",
    entryKind: "original",
    adjustsFactId: null,
    effectDirection: "increase",
    counterpartyName: "材料供应商",
    paidAt: new Date("2026-07-29T00:00:00.000Z"),
    amountCents: 5000n,
    paymentKind: "normal",
    externalPaymentReference: "BANK-20260729-001",
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "挂靠建设集团",
    basisType: "oral",
    description: null,
    evidenceFileId: null,
    documentVersion: 1,
    fileContentSha256Snapshot: null,
    idempotencyKey: "cdad0cb7-2e78-48db-ae27-86253bf54bbd",
    requestFingerprint: "1".repeat(64),
    recordedByUserId: "finance-1",
    recordedByRoleKey: "finance_staff",
    status: "pending_confirm",
    confirmedByUserId: null,
    confirmedAt: null,
    confirmationActionId: null,
    confirmationSignatureVersionId: null,
    confirmationSignatureFileId: null,
    confirmationSignatureSha256: null,
    createdAt: new Date("2026-07-29T01:00:00.000Z"),
    updatedAt: new Date("2026-07-29T01:00:00.000Z"),
    ...overrides
  };
}

describe("ProjectAffiliateBusinessService", () => {
  it.each([
    ["contract_staff", ["record_affiliate_contract_fact"]],
    ["contract_director", []]
  ])("derives original contract record capability for %s", async (roleKey, expected) => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables(roleKey)
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const capability = await service.getRecordCapability(
      "project-1",
      "actor-1",
      "contract",
      "original",
      undefined
    );

    expect(capability).toMatchObject({
      projectId: "project-1",
      businessType: "contract",
      entryKind: "original",
      availableActions: expected
    });
  });

  it.each([
    ["finance_staff", ["supplement_affiliate_evidence"]],
    ["finance_director", ["confirm_affiliate_fact", "supplement_affiliate_evidence"]]
  ])("derives oral payment fact capability for %s", async (roleKey, expected) => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables(roleKey),
      projectAffiliatePaymentFact: {
        findFirst: jest.fn().mockResolvedValue(paymentFact())
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const capability = await service.getFactCapability(
      "project-1",
      "payment-fact-1",
      "actor-1",
      "payment"
    );

    expect(capability.availableActions).toEqual(expected);
  });

  it("rejects affiliate evidence upload before file storage for the wrong business role", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("employee"),
      projectAffiliateContractFact: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.assertEvidenceUploadAllowed(
        "project-1",
        "contract-fact-1",
        "employee-1",
        "contract"
      )
    ).rejects.toThrow("当前岗位不能为该施工企业外部事实补充依据");
    expect(tx.projectAffiliateContractFact.findFirst).not.toHaveBeenCalled();
  });

  it("does not advertise contract adjustments to a confirming-only contract director", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("contract_director"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: { findMany: jest.fn().mockResolvedValue([]) },
      projectAffiliatePaymentFact: { findMany: jest.fn().mockResolvedValue([]) },
      projectAffiliateBusinessEvidence: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const result = await service.listFacts("project-1", "contract-director-1");

    expect(result.availableActions).toEqual([]);
    expect(result.contracts[0].availableActions).toEqual(["supplement_evidence"]);
  });

  it("returns a payment request business code for correction receipts without replacing the hidden id", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("finance_staff"),
      projectAffiliateContractFact: { findMany: jest.fn().mockResolvedValue([]) },
      projectAffiliateSettlementFact: { findMany: jest.fn().mockResolvedValue([]) },
      projectAffiliatePaymentFact: {
        findMany: jest.fn().mockResolvedValue([
          paymentFact({ paymentRequestId: "payment-request-uuid-1" })
        ])
      },
      projectAffiliateBusinessEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-request-uuid-1", code: "FK-2026-001" }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const result = await service.listFacts("project-1", "finance-1");

    expect(result.payments[0]).toMatchObject({
      paymentRequestId: "payment-request-uuid-1",
      paymentRequestCode: "FK-2026-001"
    });
  });

  it("does not create company approval work when recording an external affiliate contract", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "assignment-1",
            businessPartyId: "party-1",
            businessPartyVersionId: "party-version-1",
            affiliateNameSnapshot: "挂靠建设集团",
            affiliateCreditCodeSnapshot: "91310000AFFILIATE",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
          }
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      fileObject: { findUnique: jest.fn() },
      projectAffiliateContractFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: data.id,
          ...data,
          confirmedByUserId: null,
          confirmedAt: null,
          confirmationActionId: null,
          confirmationSignatureVersionId: null,
          confirmationSignatureFileId: null,
          confirmationSignatureSha256: null,
          createdAt: new Date("2026-07-29T03:00:00.000Z")
        }))
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const result = await service.recordContractFact("project-1", "contract-1", {
      contractType: "material_purchase",
      externalContractReference: "GK-HT-2026-001",
      counterpartyName: "材料供应商",
      signedAt: "2026-07-20",
      amountNature: "fixed",
      amountCents: "100000",
      basisType: "oral",
      advanceAllowed: false,
      idempotencyKey: "2dfca5de-eb12-4b9e-b093-e392653a5cdf"
    });

    expect(result).toMatchObject({
      status: "pending_confirm",
      availableActions: ["supplement_evidence"]
    });
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("rejects a normal payment for a settlement-required contract without a confirmed settlement", async () => {
    const prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback({})
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordPaymentFact("project-1", "finance-1", {
        contractLedgerId: "contract-ledger-1",
        counterpartyName: "材料供应商",
        paidAt: "2026-07-29",
        amountCents: "5000",
        paymentKind: "normal",
        externalPaymentReference: "BANK-20260729-001",
        basisType: "oral",
        idempotencyKey: "cdad0cb7-2e78-48db-ae27-86253bf54bbd"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(["normal", "advance", "direct_contract"] as const)(
    "rejects a post-effective %s payment without an approved payment request",
    async (paymentKind) => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" }),
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

      await expect(
        service.recordPaymentFact("project-1", "finance-1", {
        contractLedgerId: "contract-ledger-1",
        ...(paymentKind === "normal"
          ? { settlementLedgerId: "settlement-ledger-1" }
          : {}),
        counterpartyName: "材料供应商",
        paidAt: "2026-08-02",
        amountCents: "5000",
        paymentKind,
        externalPaymentReference: "BANK-20260802-001",
        basisType: "oral",
        idempotencyKey: "a87e7a4f-57c7-4c75-8a75-702d02b5d90a"
        })
      ).rejects.toThrow(
        "经营账生效日后的例外付款必须填写事后补录原因；正常付款请关联已审批付款申请"
      );
    }
  );

  it("rejects a future post-effective exceptional payment", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "locked-row" }]),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" }),
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      ...roleTables("finance_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findMany: jest.fn().mockResolvedValue([settlementFact()])
      },
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(
          paymentFact({
            paidAt: new Date("2026-08-18T00:00:00.000Z"),
            paymentRequestId: null,
            description: "抢险付款事后据实补录"
          })
        )
      },
      fileObject: { findUnique: jest.fn() },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    try {
      await expect(
        service.recordPaymentFact("project-1", "finance-1", {
          contractLedgerId: "contract-ledger-1",
          settlementLedgerId: "settlement-ledger-1",
          counterpartyName: "材料供应商",
          paidAt: "2026-08-18",
          amountCents: "5000",
          paymentKind: "normal",
          externalPaymentReference: "BANK-FUTURE-EXCEPTION-001",
          basisType: "oral",
          description: "抢险付款事后据实补录",
          idempotencyKey: "18e5064b-8082-4669-b745-56215c47aa2a"
        })
      ).rejects.toThrow("施工企业付款日期不能晚于当前时间");
    } finally {
      jest.useRealTimers();
    }

    expect(tx.projectAffiliatePaymentFact.create).not.toHaveBeenCalled();
  });

  it("records a post-effective exceptional payment for review without fabricating approval", async () => {
    const created = paymentFact({
      paidAt: new Date("2026-08-02T00:00:00.000Z"),
      paymentRequestId: null,
      description: "抢险当日已付，事后据实补录"
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "locked-row" }]),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" }),
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      ...roleTables("finance_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findMany: jest.fn().mockResolvedValue([settlementFact()])
      },
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(created)
      },
      fileObject: { findUnique: jest.fn() },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const result = await service.recordPaymentFact("project-1", "finance-1", {
      contractLedgerId: "contract-ledger-1",
      settlementLedgerId: "settlement-ledger-1",
      counterpartyName: "材料供应商",
      paidAt: "2026-08-02",
      amountCents: "5000",
      paymentKind: "normal",
      externalPaymentReference: "BANK-EXCEPTION-001",
      basisType: "oral",
      description: "抢险当日已付，事后据实补录",
      idempotencyKey: "fb4155df-2a44-48c6-a728-55fd10e59f9d"
    });

    expect(result).toMatchObject({
      status: "pending_confirm",
      paymentRequestId: null,
      description: "抢险当日已付，事后据实补录"
    });
    expect(tx.projectAffiliatePaymentFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentRequestId: null,
        status: "pending_confirm",
        description: "抢险当日已付，事后据实补录"
      })
    });
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it("records an external settlement without creating company approval work", async () => {
    const created = settlementFact({
      status: "pending_confirm",
      confirmedByUserId: null,
      confirmedAt: null,
      confirmationActionId: null,
      confirmationSignatureVersionId: null,
      confirmationSignatureFileId: null,
      confirmationSignatureSha256: null
    });
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("budget_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created)
      },
      projectAffiliateCompanyContract: {
        findFirst: jest.fn().mockResolvedValue({
          affiliateAssignmentId: "assignment-1",
          affiliateBusinessPartyVersionId: "party-version-1",
          companyEntityNameSnapshot: "材料供应商"
        })
      },
      fileObject: { findUnique: jest.fn() },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordSettlementFact("project-1", "budget-1", {
        contractLedgerId: "contract-ledger-1",
        affiliateCompanyContractId: "company-contract-1",
        counterpartyName: "材料供应商",
        settledAt: "2026-07-28",
        periodLabel: "2026-07",
        amountCents: "50000",
        basisType: "oral",
        idempotencyKey: "e974f2f0-5b2e-4e6a-9d9d-03b81e1868ad"
      })
    ).resolves.toMatchObject({
      status: "pending_confirm",
      availableActions: ["confirm", "supplement_evidence"]
    });
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("rejects a settlement correction below existing construction-enterprise payments", async () => {
    const target = settlementFact({ amountCents: 100000n });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: target.id }]),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("budget_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(target),
        findMany: jest.fn().mockResolvedValue([
          { effectDirection: "increase", amountCents: 100000n }
        ]),
        create: jest.fn()
      },
      projectAffiliatePaymentFact: {
        findMany: jest.fn().mockResolvedValue([
          { effectDirection: "increase", amountCents: 80000n }
        ])
      },
      projectUpstreamFundFact: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordSettlementFact("project-1", "budget-1", {
        contractLedgerId: "contract-ledger-1",
        counterpartyName: "材料供应商",
        settledAt: "2026-07-28",
        periodLabel: "2026-07",
        amountCents: "30000",
        entryKind: "correction",
        effectDirection: "decrease",
        adjustsFactId: target.id,
        basisType: "oral",
        idempotencyKey: "settlement-correction-below-payment"
      })
    ).rejects.toThrow("施工企业结算有效金额不能低于已登记付款金额");
    expect(tx.projectAffiliateSettlementFact.create).not.toHaveBeenCalled();
  });

  it("does not let another pending settlement increase mask a decrease being recorded", async () => {
    const target = settlementFact({ amountCents: 100000n });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: target.id }]),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("budget_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(target),
        findMany: jest.fn().mockImplementation(
          async (args: { where?: { status?: unknown }; select?: { id?: boolean } }) => {
            if (args.select?.id) return [{ id: target.id }];
            return args.where?.status === "confirmed"
              ? [{ effectDirection: "increase", amountCents: 100000n }]
              : [
                  { effectDirection: "increase", amountCents: 100000n },
                  { effectDirection: "increase", amountCents: 100000n }
                ];
          }
        ),
        create: jest.fn().mockResolvedValue(settlementFact({
          id: "settlement-pending-decrease-1",
          entryKind: "correction",
          effectDirection: "decrease",
          amountCents: 50000n,
          status: "pending_confirm",
          confirmedByUserId: null,
          confirmedAt: null
        }))
      },
      projectAffiliatePaymentFact: {
        findMany: jest.fn().mockResolvedValue([
          { effectDirection: "increase", amountCents: 80000n }
        ])
      },
      projectUpstreamFundFact: {
        findMany: jest.fn().mockResolvedValue([])
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordSettlementFact("project-1", "budget-1", {
        contractLedgerId: "contract-ledger-1",
        counterpartyName: "材料供应商",
        settledAt: "2026-07-28",
        periodLabel: "2026-07",
        amountCents: "50000",
        entryKind: "correction",
        effectDirection: "decrease",
        adjustsFactId: target.id,
        basisType: "oral",
        idempotencyKey: "settlement-pending-increase-must-not-mask-decrease"
      })
    ).rejects.toThrow("施工企业结算有效金额不能低于已登记付款金额");
    expect(tx.projectAffiliateSettlementFact.create).not.toHaveBeenCalled();
  });

  it("aggregates remittances linked to any fact in the settlement ledger", async () => {
    const target = settlementFact({ amountCents: 100000n });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: target.id }]),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("budget_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(target),
        findMany: jest.fn().mockImplementation(({ select }: { select?: { id?: boolean } }) =>
          select?.id
            ? [{ id: target.id }, { id: "settlement-correction-1" }]
            : [{ effectDirection: "increase", amountCents: 100000n }]
        ),
        create: jest.fn()
      },
      projectAffiliatePaymentFact: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectUpstreamFundFact: {
        findMany: jest.fn().mockResolvedValue([
          {
            affiliateSettlementFactId: "settlement-correction-1",
            effectDirection: "increase",
            amountCents: 80000n
          }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordSettlementFact("project-1", "budget-1", {
        contractLedgerId: "contract-ledger-1",
        counterpartyName: "材料供应商",
        settledAt: "2026-07-28",
        periodLabel: "2026-07",
        amountCents: "30000",
        entryKind: "correction",
        effectDirection: "decrease",
        adjustsFactId: target.id,
        basisType: "oral",
        idempotencyKey: "settlement-correction-below-remittance"
      })
    ).rejects.toThrow("施工企业结算有效金额不能低于已登记拨款金额");
    expect(tx.projectAffiliateSettlementFact.create).not.toHaveBeenCalled();
  });

  it("records a normal affiliate payment only against a confirmed matching settlement", async () => {
    const created = paymentFact();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-fact-1" }]),
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" }),
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      ...roleTables("finance_staff"),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-request-1",
          status: "approved_pending_payment",
          sourceType: "settlement",
          paymentSubjectType: "affiliate",
          contractId: "internal-contract-1",
          contractVersionId: "internal-contract-version-1",
          settlementId: "internal-settlement-1",
          approvedAmountCents: 5000n,
          requestedAmountCents: 5000n
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "internal-contract-version-1",
          contractId: "internal-contract-1",
          signingSubjectType: "affiliate",
          affiliateBusinessPartyVersionId: "party-version-1"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          counterparty: "材料供应商",
          code: "GK-HT-2026-001"
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "internal-settlement-1",
          projectId: "project-1",
          contractVersionId: "internal-contract-version-1",
          status: "effective",
          periodLabel: "2026-07"
        })
      },
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findMany: jest.fn().mockResolvedValue([settlementFact()])
      },
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(created)
      },
      fileObject: { findUnique: jest.fn() },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    const result = await service.recordPaymentFact("project-1", "finance-1", {
      contractLedgerId: "contract-ledger-1",
      settlementLedgerId: "settlement-ledger-1",
      counterpartyName: "材料供应商",
      paidAt: "2026-08-02",
      amountCents: "5000",
      paymentKind: "normal",
      externalPaymentReference: "BANK-20260729-001",
      paymentRequestId: "payment-request-1",
      basisType: "oral",
      idempotencyKey: "cdad0cb7-2e78-48db-ae27-86253bf54bbd"
    });

    expect(result).toMatchObject({
      id: "payment-fact-1",
      paymentSubjectType: "affiliate",
      companyCashExecutionAllowed: false,
      availableActions: ["supplement_evidence"]
    });
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.projectAffiliatePaymentFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        paymentKind: "normal",
        affiliateAssignmentId: "assignment-1",
        amountCents: 5000n
      })
    });

    tx.contract.findUnique.mockResolvedValueOnce({
      projectId: "project-1",
      counterparty: "材料供应商",
      code: "GK-HT-OTHER"
    });
    await expect(
      service.recordPaymentFact("project-1", "finance-1", {
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        counterpartyName: "材料供应商",
        paidAt: "2026-08-02",
        amountCents: "5000",
        paymentKind: "normal",
        externalPaymentReference: "BANK-CROSS-CONTRACT",
        paymentRequestId: "payment-request-1",
        basisType: "oral",
        idempotencyKey: "payment-cross-contract"
      })
    ).rejects.toThrow("施工企业付款申请必须与外部合同台账一致");

    tx.contract.findUnique.mockResolvedValueOnce({
      projectId: "project-1",
      counterparty: "材料供应商",
      code: "GK-HT-2026-001"
    });
    tx.settlement.findUnique.mockResolvedValueOnce({
      id: "internal-settlement-1",
      projectId: "project-1",
      contractVersionId: "internal-contract-version-1",
      status: "effective",
      periodLabel: "2026-06"
    });
    await expect(
      service.recordPaymentFact("project-1", "finance-1", {
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        counterpartyName: "材料供应商",
        paidAt: "2026-08-02",
        amountCents: "5000",
        paymentKind: "normal",
        externalPaymentReference: "BANK-CROSS-SETTLEMENT",
        paymentRequestId: "payment-request-1",
        basisType: "oral",
        idempotencyKey: "payment-cross-settlement"
      })
    ).rejects.toThrow("施工企业正常付款申请必须与外部结算台账一致");

    tx.contract.findUnique.mockResolvedValueOnce({
      projectId: "project-1",
      counterparty: "材料供应商",
      code: "GK-HT-2026-001"
    });
    tx.settlement.findUnique.mockResolvedValueOnce({
      id: "internal-settlement-1",
      projectId: "project-1",
      contractVersionId: "internal-contract-version-1",
      status: "effective",
      periodLabel: "2026-07"
    });
    tx.projectAffiliateSettlementFact.findMany
      .mockResolvedValueOnce([settlementFact()])
      .mockResolvedValueOnce([
        settlementFact(),
        settlementFact({
          id: "settlement-fact-2",
          ledgerId: "settlement-ledger-2"
        })
      ]);
    await expect(
      service.recordPaymentFact("project-1", "finance-1", {
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        counterpartyName: "材料供应商",
        paidAt: "2026-08-02",
        amountCents: "5000",
        paymentKind: "normal",
        externalPaymentReference: "BANK-AMBIGUOUS-SETTLEMENT",
        paymentRequestId: "payment-request-1",
        basisType: "oral",
        idempotencyKey: "payment-ambiguous-settlement"
      })
    ).rejects.toThrow("同一合同和期间存在多笔外部结算，请先明确付款申请对应的债务");
  });

  it("permits a pre-settlement advance only when frozen contract terms allow it", async () => {
    const advanceContract = contractFact({
      advanceAllowed: true,
      advanceLimitCents: 20000n,
      advanceTermsSummary: "签约后可预付不超过 20,000 分"
    });
    const created = paymentFact({
      settlementLedgerId: null,
      paymentKind: "advance",
      externalPaymentReference: "BANK-ADVANCE-001",
      amountCents: 10000n,
      recordedByUserId: "finance-director-1",
      recordedByRoleKey: "finance_director"
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-fact-1" }]),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("finance_director"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([advanceContract])
      },
      projectAffiliateSettlementFact: { findMany: jest.fn() },
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(created)
      },
      fileObject: { findUnique: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordPaymentFact("project-1", "finance-director-1", {
        contractLedgerId: "contract-ledger-1",
        counterpartyName: "材料供应商",
        paidAt: "2026-07-29",
        amountCents: "10000",
        paymentKind: "advance",
        externalPaymentReference: "BANK-ADVANCE-001",
        basisType: "oral",
        idempotencyKey: "46e34999-5ccf-4a18-b010-46ed35fc37d7"
      })
    ).resolves.toMatchObject({
      paymentKind: "advance",
      settlementLedgerId: null,
      availableActions: ["confirm", "supplement_evidence"]
    });
  });

  it.each(["advance", "direct_contract"] as const)(
    "accepts a post-effective %s payment with its matching contract payment request",
    async (paymentKind) => {
      const contract =
        paymentKind === "advance"
          ? contractFact({ advanceAllowed: true, advanceLimitCents: 20000n })
          : contractFact({ contractType: "general_direct_payment" });
      const created = paymentFact({
        settlementLedgerId: null,
        paymentRequestId: "payment-request-1",
        paymentKind,
        paidAt: new Date("2026-08-02T00:00:00.000Z")
      });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "payment-request-1" }]),
        project: {
          findFirst: jest.fn().mockResolvedValue({ id: "project-1" }),
          findUnique: jest.fn().mockResolvedValue({
            operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
          })
        },
        ...roleTables("finance_staff"),
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: "payment-request-1",
            status: "approved_pending_payment",
            sourceType: paymentKind === "advance" ? "contract_advance" : "contract_due",
            paymentSubjectType: "affiliate",
            contractId: "internal-contract-1",
            contractVersionId: "internal-contract-version-1",
            settlementId: null,
            approvedAmountCents: 5000n,
            requestedAmountCents: 5000n
          })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "internal-contract-version-1",
            contractId: "internal-contract-1",
            signingSubjectType: "affiliate",
            affiliateBusinessPartyVersionId: "party-version-1"
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            projectId: "project-1",
            counterparty: "材料供应商",
            code: "GK-HT-2026-001"
          })
        },
        projectAffiliateContractFact: {
          findMany: jest.fn().mockResolvedValue([contract])
        },
        projectAffiliateSettlementFact: {
          findMany: jest.fn()
        },
        projectAffiliatePaymentFact: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue(created)
        },
        fileObject: { findUnique: jest.fn() },
        auditLog: { create: jest.fn() }
      };
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx)
        )
      };
      const service = new ProjectAffiliateBusinessService(prisma as never);

      await expect(
        service.recordPaymentFact("project-1", "finance-1", {
          contractLedgerId: "contract-ledger-1",
          counterpartyName: "材料供应商",
          paidAt: "2026-08-02",
          amountCents: "5000",
          paymentKind,
          externalPaymentReference: `BANK-${paymentKind}-001`,
          paymentRequestId: "payment-request-1",
          basisType: "oral",
          idempotencyKey:
            paymentKind === "advance"
              ? "46e34999-5cc7-4a18-b010-46ed35fc37d7"
              : "56e34999-5cc7-4a18-b010-46ed35fc37d7"
        })
      ).resolves.toMatchObject({ paymentKind, settlementLedgerId: null });
    }
  );

  it("rejects a payment whose counterparty differs from the contract and settlement subject", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-fact-1" }]),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("finance_staff"),
      projectAffiliateContractFact: {
        findMany: jest.fn().mockResolvedValue([contractFact()])
      },
      projectAffiliateSettlementFact: {
        findMany: jest.fn().mockResolvedValue([settlementFact()])
      },
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ProjectAffiliateBusinessService(prisma as never);

    await expect(
      service.recordPaymentFact("project-1", "finance-1", {
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        counterpartyName: "另一供应商",
        paidAt: "2026-07-29",
        amountCents: "5000",
        paymentKind: "normal",
        externalPaymentReference: "BANK-20260729-002",
        basisType: "oral",
        idempotencyKey: "fc09b6c6-f1d2-44e1-af8b-688042ed980b"
      })
    ).rejects.toThrow("付款对象必须与施工企业对下合同相对方完全一致");
  });

  it("does not let another pending settlement increase mask the decrease being confirmed", async () => {
    const confirmedAt = new Date("2026-07-29T04:00:00.000Z");
    const pendingDecrease = settlementFact({
      id: "settlement-decrease-1",
      entryKind: "correction",
      adjustsFactId: "settlement-fact-1",
      effectDirection: "decrease",
      amountCents: 80000n,
      status: "pending_confirm",
      confirmedByUserId: null,
      confirmedAt: null,
      confirmationActionId: null
    });
    const confirmed = {
      ...pendingDecrease,
      status: "confirmed",
      confirmedByUserId: "budget-1",
      confirmedAt,
      confirmationActionId: "settlement-confirm-decrease",
      confirmationSignatureVersionId: "signature-version-2",
      confirmationSignatureFileId: "signature-file-2",
      confirmationSignatureSha256: "f".repeat(64)
    };
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "settlement-decrease-1" }])
        .mockResolvedValueOnce([{ id: "settlement-ledger-1" }])
        .mockResolvedValueOnce([{ id: "budget-1", isActive: true }])
        .mockResolvedValueOnce([
          {
            id: "signature-version-2",
            fileId: "signature-file-2",
            contentSha256: "f".repeat(64)
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "signature-file-2",
            contentSha256: "f".repeat(64),
            storageStatus: "active"
          }
        ]),
      ...roleTables("budget_staff"),
      projectAffiliateSettlementFact: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(confirmed),
        findFirst: jest.fn().mockResolvedValue(pendingDecrease),
        findMany: jest.fn().mockImplementation(
          async (args: { where?: { OR?: unknown[] }; select?: { id?: boolean } }) =>
            args.select?.id
              ? [
                  { id: "settlement-fact-1" },
                  { id: "settlement-decrease-1" }
                ]
              : args.where?.OR
                ? [
                    { effectDirection: "increase", amountCents: 100000n },
                    { effectDirection: "decrease", amountCents: 80000n }
                  ]
                : [
                    { effectDirection: "increase", amountCents: 100000n },
                    { effectDirection: "decrease", amountCents: 80000n },
                    { effectDirection: "increase", amountCents: 100000n }
                  ]
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      projectAffiliatePaymentFact: {
        findMany: jest.fn().mockResolvedValue([
          { effectDirection: "increase", amountCents: 90000n }
        ])
      },
      projectUpstreamFundFact: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn()
    };
    const service = new ProjectAffiliateBusinessService(
      prisma as never,
      undefined,
      auth as never,
      operatingSources as never
    );

    await expect(
      service.confirmSettlementFact(
        "project-1",
        "settlement-decrease-1",
        "budget-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: "settlement-confirm-decrease"
        },
        confirmedAt
      )
    ).rejects.toThrow("施工企业结算有效金额不能低于已登记付款金额");
    expect(tx.projectAffiliateSettlementFact.updateMany).not.toHaveBeenCalled();
  });

  it("requires a finance director to confirm an oral payment and freezes the signature", async () => {
    const confirmedAt = new Date("2026-07-29T04:00:00.000Z");
    const confirmed = paymentFact({
      status: "confirmed",
      confirmedByUserId: "finance-director-1",
      confirmedAt,
      confirmationActionId: "439f38e7-d374-4275-9066-794a59a1cf0d",
      confirmationSignatureVersionId: "signature-version-3",
      confirmationSignatureFileId: "signature-file-3",
      confirmationSignatureSha256: "9".repeat(64)
    });
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "payment-fact-1" }])
        .mockResolvedValueOnce([{ id: "finance-director-1", isActive: true }])
        .mockResolvedValueOnce([
          {
            id: "signature-version-3",
            fileId: "signature-file-3",
            contentSha256: "9".repeat(64)
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "signature-file-3",
            contentSha256: "9".repeat(64),
            storageStatus: "active"
          }
        ]),
      ...roleTables("finance_director"),
      projectAffiliatePaymentFact: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(confirmed),
        findFirst: jest.fn().mockResolvedValue(paymentFact()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectAffiliateBusinessService(
      prisma as never,
      undefined,
      auth as never
    );

    const result = await service.confirmPaymentFact(
      "project-1",
      "payment-fact-1",
      "finance-director-1",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "439f38e7-d374-4275-9066-794a59a1cf0d"
      },
      confirmedAt
    );

    expect(result).toMatchObject({
      status: "confirmed",
      confirmationSignatureVersionId: "signature-version-3",
      availableActions: [
        "supplement_evidence",
        "record_correction",
        "record_reversal"
      ]
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "finance-director-1",
      "current-password"
    );
    expect(tx.projectAffiliatePaymentFact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "payment-fact-1",
        projectId: "project-1",
        status: "pending_confirm",
        confirmationActionId: null
      },
      data: expect.objectContaining({
        status: "confirmed",
        confirmationActionId: "439f38e7-d374-4275-9066-794a59a1cf0d",
        confirmationSignatureFileId: "signature-file-3"
      })
    });
  });
});
