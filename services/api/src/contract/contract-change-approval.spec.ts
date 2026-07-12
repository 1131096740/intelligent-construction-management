import { evaluateContractChangeApproval } from "./contract-change-approval";
import { ContractService } from "./contract.service";

describe("evaluateContractChangeApproval", () => {
  const evaluate = (
    cumulativeIncreaseCents: bigint,
    cumulativeDecreaseCents: bigint = 0n,
    amountLimitType = "capped"
  ) => evaluateContractChangeApproval({
    changeType: "supplement",
    amountLimitType,
    changeAmountCents: cumulativeIncreaseCents + cumulativeDecreaseCents > 0n ? 1n : 0n,
    originalBaseAmountCents: 10_000n,
    cumulativeIncreaseCents,
    cumulativeDecreaseCents
  });

  it.each([
    ["9%", 900n, false],
    ["exactly 10%", 1_000n, false],
    ["strictly over 10%", 1_001n, true]
  ])("routes a capped change at %s", (_label, cumulative, enhanced) => {
    expect(evaluate(cumulative).enhanced).toBe(enhanced);
  });

  it("tracks increases and decreases separately instead of offsetting them", () => {
    const result = evaluate(1_100n, 1_100n);
    expect(result.enhanced).toBe(true);
    expect(result.reasons).toContain("cumulative_change_strictly_over_ten_percent");
  });

  it("enhances any non-zero amount change for an unlimited framework contract", () => {
    expect(evaluate(1n, 0n, "unlimited")).toEqual({
      enhanced: true,
      reasons: ["unlimited_amount_change"]
    });
  });
});

describe("ContractService change draft version lineage", () => {
  const standardTemplateSnapshot = {
    fieldSchema: [],
    billSchema: [],
    clauseSchema: [{
      key: "clause-1",
      title: "第一条",
      numberingMode: "automatic",
      content: { privateFileId: "embedded-private-file" }
    }],
    attachmentSchema: [],
    validationSchema: [],
    submissionSnapshot: {
      bills: [{ sourceExcelFileId: "source-excel-file" }],
      internalReviewDocument: {
        docxFileId: "source-docx-file",
        pdfFileId: "source-pdf-file"
      }
    }
  };

  const sourceBill = {
    id: "bill-v1",
    billKey: "main_bill",
    name: "主合同清单",
    amountRole: "included",
    pricingMode: "tax_inclusive",
    quantityScale: 2,
    unitPriceScale: 2,
    schemaSnapshot: {
      columns: [{ key: "itemName", label: "名称", type: "text", required: true }]
    },
    sourceExcelFileId: "source-excel-file",
    revision: 2,
    taxInclusiveAmountCents: 1_000_000n,
    taxExclusiveAmountCents: 900_000n,
    taxAmountCents: 100_000n
  };

  const latestEffective = {
    id: "v1",
    contractId: "contract-1",
    versionNo: 1,
    status: "effective",
    changeType: "original",
    amountCents: 1_000_000n,
    amountLimitType: "capped",
    baseVersionId: null,
    originalBaseAmountCents: null,
    cumulativeIncreaseCents: 0n,
    cumulativeDecreaseCents: 0n,
    businessTemplateVersionId: "template-v1",
    layoutTemplateVersionId: null,
    pricingNature: "fixed_total",
    amountSource: "manual",
    amountAdjustmentReason: null,
    draftData: {},
    templateSnapshot: standardTemplateSnapshot,
    clauseSnapshot: []
  };

  function makeChangeTx(options: {
    contract?: Record<string, unknown>;
    latest?: Record<string, unknown>;
    latestVersionNo?: number;
    parties?: Array<Record<string, unknown>>;
    bills?: Array<Record<string, unknown>>;
    sourceTerms?: Record<string, unknown> | null;
  } = {}) {
    const contract = {
      id: "contract-1",
      ownerUserId: "owner-1",
      voidedAt: null,
      code: "HT-001",
      source: "system",
      contractTypeKey: "material_purchase",
      companyEntityName: "甲方公司",
      counterparty: "乙方公司",
      ...options.contract
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([contract]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "v1", contractId: "contract-1" }),
        findFirst: jest.fn()
          .mockResolvedValueOnce({ ...latestEffective, ...options.latest })
          .mockResolvedValueOnce({ versionNo: options.latestVersionNo ?? 2 })
          .mockResolvedValueOnce(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "v3",
          ...data
        }))
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue(options.parties ?? [
          {
            roleKey: "party_a",
            displayOrder: 1,
            businessPartyVersionId: "party-a-v1",
            snapshot: {
              name: "甲方公司",
              attachments: [{ fileId: "party-a-private-file", name: "营业执照" }]
            }
          },
          {
            roleKey: "party_b",
            displayOrder: 1,
            businessPartyVersionId: "party-b-v1",
            snapshot: { name: "乙方公司", attachments: [] }
          }
        ]),
        createMany: jest.fn()
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue(options.bills ?? [sourceBill]),
        create: jest.fn().mockResolvedValue({ id: "bill-v3" })
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue(
          options.sourceTerms === undefined
            ? { id: "terms-v1", versionNo: 1, originalText: "原付款条款" }
            : options.sourceTerms
        ),
        create: jest.fn().mockResolvedValue({ id: "terms-v3" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    return tx;
  }

  it("uses max version number plus one while keeping direct latest effective as base", async () => {
    const tx = makeChangeTx();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    await service.createChangeDraft("v1", {
      changeType: "supplement",
      changeReason: "补充工程量",
      changeDirection: "increase",
      changeAmountCents: "100000"
    }, "owner-1");

    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionNo: 3,
        baseVersionId: "v1",
        supersedesVersionId: null
      })
    });
    expect(tx.paymentTermsVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "v3",
        versionNo: 3
      })
    });
    const versionData = tx.contractVersion.create.mock.calls[0][0].data;
    expect(versionData.draftData).toEqual({});
    expect(versionData.clauseSnapshot).toEqual([]);
    expect(versionData.templateSnapshot).toEqual({
      fieldSchema: [],
      billSchema: [],
      clauseSchema: [{
        key: "clause-1",
        title: "第一条",
        numberingMode: "automatic",
        content: {}
      }],
      attachmentSchema: [],
      validationSchema: []
    });
    expect(JSON.stringify(versionData.templateSnapshot)).not.toContain("file");
    expect(tx.contractPartySnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          roleKey: "party_a",
          businessPartyVersionId: "party-a-v1",
          snapshot: { name: "甲方公司", attachments: [] }
        })
      ])
    });
    expect(JSON.stringify(tx.contractPartySnapshot.createMany.mock.calls[0][0])).not.toContain(
      "fileId"
    );
  });

  it("synthesizes safe historical facts without copying file identifiers", async () => {
    const tx = makeChangeTx({
      contract: {
        source: "historical_takeover",
        companyEntityName: "  历史甲方  ",
        counterparty: "  历史乙方  "
      },
      latestVersionNo: 1,
      latest: {
        changeType: "historical_takeover",
        templateSnapshot: {
          historicalTakeover: true,
          submissionSnapshot: { pdfFileId: "legacy-private-file" }
        }
      },
      parties: []
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    await service.createChangeDraft("v1", {
      changeType: "supplement",
      changeReason: "补充工程量",
      changeDirection: "increase",
      changeAmountCents: "100000"
    }, "owner-1");

    const versionData = tx.contractVersion.create.mock.calls[0][0].data;
    expect(versionData.draftData).toEqual({ historicalTakeover: true });
    expect(versionData.clauseSnapshot).toEqual([]);
    expect(versionData.templateSnapshot).toEqual({
      fieldSchema: [],
      billSchema: [{
        key: "main_bill",
        name: "主合同清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        columns: [{ key: "itemName", label: "名称", type: "text", required: true }]
      }],
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: []
    });
    expect(JSON.stringify(versionData.templateSnapshot)).not.toContain("fileId");
    expect(tx.contractPartySnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          roleKey: "party_a",
          businessPartyVersionId: null,
          snapshot: { name: "历史甲方", attachments: [] }
        }),
        expect.objectContaining({
          roleKey: "party_b",
          businessPartyVersionId: null,
          snapshot: { name: "历史乙方", attachments: [] }
        })
      ])
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceType: "historical_takeover",
          historicalFactsSynthesized: true
        })
      })
    );
    expect(JSON.stringify(audit.record.mock.calls[0][1].metadata)).not.toContain("历史甲方");
    expect(JSON.stringify(audit.record.mock.calls[0][1].metadata)).not.toContain("历史乙方");
  });

  it("blocks incomplete historical subject facts before creating any draft", async () => {
    const tx = makeChangeTx({
      contract: {
        source: "historical_takeover",
        companyEntityName: "   ",
        counterparty: "历史乙方"
      },
      latest: {
        changeType: "historical_takeover",
        templateSnapshot: { historicalTakeover: true }
      },
      parties: []
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    await expect(service.createChangeDraft("v1", {
      changeType: "supplement",
      changeReason: "补充工程量",
      changeDirection: "increase",
      changeAmountCents: "100000"
    }, "owner-1")).rejects.toThrow("历史接管合同缺少已确认的甲方名称");

    expect(tx.contractVersion.create).not.toHaveBeenCalled();
    expect(tx.contractPartySnapshot.createMany).not.toHaveBeenCalled();
    expect(tx.paymentTermsVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["projected amount", { amountCents: 9_223_372_036_854_775_807n }],
    ["cumulative increase", { cumulativeIncreaseCents: 9_223_372_036_854_775_807n }]
  ])("rejects %s PostgreSQL BIGINT overflow before creating a draft", async (_label, latest) => {
    const tx = makeChangeTx({ latest });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    await expect(service.createChangeDraft("v1", {
      changeType: "supplement",
      changeReason: "补充工程量",
      changeDirection: "increase",
      changeAmountCents: "1"
    }, "owner-1")).rejects.toThrow("合同变更金额累计后超出系统可保存范围");

    expect(tx.contractVersion.create).not.toHaveBeenCalled();
    expect(tx.contractPartySnapshot.createMany).not.toHaveBeenCalled();
    expect(tx.paymentTermsVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rechecks the direct-base content policy on approval submission", async () => {
    const baseDraftData = {
      contractName: "原合同",
      myCompanyEntity: "甲方公司",
      fieldValues: { site_name: "旧项目" },
      partyValues: { party_a: "甲方公司", party_b: "乙方公司" }
    };
    const version = {
      ...latestEffective,
      id: "v2",
      versionNo: 2,
      status: "draft",
      changeType: "supplement",
      baseVersionId: "v1",
      changeDirection: "increase",
      changeAmountCents: 100_000n,
      amountCents: 1_100_000n,
      draftRevision: 3,
      draftData: { ...baseDraftData, myCompanyEntity: "攻击者公司" },
      clauseSnapshot: [],
      templateSnapshot: {
        fieldSchema: [
          { key: "myCompanyEntity", label: "我方主体", type: "text" },
          { key: "site_name", label: "项目名称", type: "text" }
        ],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: [],
        supplementChangePolicy: {
          version: 1,
          editableFieldKeys: ["myCompanyEntity", "site_name"],
          editableClauseKeys: [],
          coreClauseKeys: []
        }
      }
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          ownerUserId: "owner-1",
          voidedAt: null
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          ...latestEffective,
          draftData: baseDraftData,
          clauseSnapshot: []
        }),
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const service = new ContractService(prisma as never, { record: jest.fn() } as never);

    await expect(service.submitApproval("v2", "owner-1", {
      numberRuleId: "rule-1"
    })).rejects.toThrow("合同变更不得修改我方签约主体");

    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("reports the same incomplete historical subject blocker from eligibility", async () => {
    const current = {
      ...latestEffective,
      changeType: "historical_takeover",
      templateSnapshot: { historicalTakeover: true }
    };
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "v1", contractId: "contract-1" }),
        findFirst: jest.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(null)
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          source: "historical_takeover",
          contractTypeKey: "material_purchase",
          companyEntityName: "   ",
          counterparty: "历史乙方",
          voidedAt: null
        })
      },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractBill: { findMany: jest.fn().mockResolvedValue([sourceBill]) },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-v1",
          versionNo: 1,
          originalText: "原付款条款"
        })
      }
    };
    const service = new ContractService(prisma as never, { record: jest.fn() } as never);

    await expect(service.changeEligibility("v1")).resolves.toEqual(
      expect.objectContaining({
        eligible: false,
        reason: expect.stringContaining("历史接管合同缺少已确认的甲方名称")
      })
    );
  });
});
