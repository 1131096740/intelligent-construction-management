import { ContractService } from "./contract.service";

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
    effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
    changeType: "original",
    amountCents: 1_000_000n,
    estimatedAmountCents: null,
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
    const latest = { ...latestEffective, ...options.latest };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([contract]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "v1", contractId: "contract-1" }),
        findFirst: jest.fn()
          .mockResolvedValueOnce(latest)
          .mockResolvedValueOnce({ versionNo: options.latestVersionNo ?? 2 })
          .mockResolvedValueOnce(null),
        findMany: jest.fn().mockResolvedValue([latest]),
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
      changeType: "change",
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

  it("inherits an unlimited contract estimate without changing its amount nature", async () => {
    const tx = makeChangeTx({
      latest: {
        amountCents: 0n,
        estimatedAmountCents: 300_000n,
        amountLimitType: "unlimited",
        pricingNature: "framework"
      }
    });
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    };
    const service = new ContractService(
      prisma as never,
      { record: jest.fn() } as never
    );

    await service.createChangeDraft("v1", {
      changeType: "change",
      changeReason: "更新预计发生量",
      changeDirection: "unchanged",
      changeAmountCents: "0"
    }, "owner-1");

    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountCents: 0n,
        estimatedAmountCents: 300_000n,
        amountLimitType: "unlimited",
        pricingNature: "framework"
      })
    });
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
        originalBaseAmountCents: 1_000_000n,
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
      changeType: "change",
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
        originalBaseAmountCents: 1_000_000n,
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
      changeType: "change",
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
    ["projected amount", { amountCents: 9_223_372_036_854_775_807n }]
  ])("rejects %s PostgreSQL BIGINT overflow before creating a draft", async (_label, latest) => {
    const tx = makeChangeTx({ latest });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const audit = { record: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    await expect(service.createChangeDraft("v1", {
      changeType: "change",
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
      changeType: "change",
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
    const base = {
      ...latestEffective,
      draftData: baseDraftData,
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([base, version]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          ownerUserId: "owner-1",
          voidedAt: null
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(base),
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

  it("blocks only future change eligibility when a confirmed historical contract lacks its baseline", async () => {
    const current = {
      ...latestEffective,
      changeType: "historical_takeover",
      originalBaseAmountCents: null
    };
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "v1", contractId: "contract-1" }),
        findFirst: jest.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(null),
        findMany: jest.fn().mockResolvedValue([current])
      },
      contract: { findUnique: jest.fn().mockResolvedValue({
        id: "contract-1", source: "historical_takeover", contractTypeKey: "material_purchase",
        companyEntityName: "我方公司", counterparty: "历史乙方", voidedAt: null
      }) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([
        { roleKey: "party_a", displayOrder: 1, businessPartyVersionId: null, snapshot: { name: "我方公司" } },
        { roleKey: "party_b", displayOrder: 1, businessPartyVersionId: null, snapshot: { name: "历史乙方" } }
      ]) },
      contractBill: { findMany: jest.fn().mockResolvedValue([sourceBill]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({
        id: "terms-v1", versionNo: 1, originalText: "原付款条款"
      }) }
    };
    const service = new ContractService(prisma as never, { record: jest.fn() } as never);

    await expect(service.changeEligibility("v1")).resolves.toEqual(expect.objectContaining({
      eligible: false,
      reason: expect.stringContaining("历史合同尚未确认历史变更基线")
    }));
  });

  it("recomputes effective positive increases at submit and persists an over-limit denial audit", async () => {
    const snapshots = {
      companyEntityIdSnapshot: "entity-1",
      companyEntityVersionId: "entity-version-1",
      companyEntityNameSnapshot: "我方公司",
      companyEntityCreditCodeSnapshot: "91350211M000100Y46",
      companyEntityRegisteredAddressSnapshot: null
    };
    const root = {
      ...latestEffective,
      ...snapshots,
      id: "v1",
      status: "superseded",
      baseVersionId: null,
      amountCents: 1_000_000n,
      effectiveAt: new Date("2026-01-01")
    };
    const previous = {
      ...root,
      id: "v2",
      versionNo: 2,
      changeType: "change",
      baseVersionId: "v1",
      status: "effective",
      changeDirection: "increase",
      changeAmountCents: 100_000n,
      amountCents: 1_100_000n,
      effectiveAt: new Date("2026-02-01")
    };
    const candidate = {
      ...previous,
      id: "v3",
      versionNo: 3,
      status: "draft",
      baseVersionId: "v2",
      changeAmountCents: 1n,
      amountCents: 1_100_001n,
      effectiveAt: null,
      draftRevision: 1,
      contractGovernanceVersion: 1,
      templateSnapshot: { fieldSchema: [], clauseSchema: [] }
    };
    const businessTx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([candidate])
        .mockResolvedValueOnce([root, previous, candidate]),
      contract: { findUnique: jest.fn().mockResolvedValue({
        id: "contract-1", projectId: "project-1", ownerUserId: "owner-1", voidedAt: null
      }) },
      contractVersion: { updateMany: jest.fn() },
      approvalInstance: { create: jest.fn() }
    };
    const auditTx = {};
    let transactionNo = 0;
    const prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(transactionNo++ === 0 ? businessTx : auditTx)
      )
    };
    const auditForTest = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractService(prisma as never, auditForTest as never);

    await expect(service.submitApproval("v3", "owner-1", { numberRuleId: "rule-1" }))
      .rejects.toThrow("累计增项已超过原合同 10%，必须新签合同");
    expect(businessTx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(auditForTest.record).toHaveBeenCalledWith(auditTx, {
      actorUserId: "owner-1",
      action: "contract.change.limit.denied",
      businessType: "contract_version",
      businessId: "v3",
      metadata: { reason: "累计增项已超过原合同 10%，必须新签合同" }
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    "companyEntityIdSnapshot",
    "companyEntityVersionId",
    "companyEntityNameSnapshot",
    "companyEntityCreditCodeSnapshot",
    "companyEntityRegisteredAddressSnapshot"
  ] as const)("rejects a changed %s instead of refreshing the signing subject", async (key) => {
    const snapshots = {
      companyEntityIdSnapshot: "entity-1",
      companyEntityVersionId: "entity-version-1",
      companyEntityNameSnapshot: "我方公司",
      companyEntityCreditCodeSnapshot: "91350211M000100Y46",
      companyEntityRegisteredAddressSnapshot: "注册地址"
    };
    const base = {
      ...latestEffective,
      ...snapshots,
      id: "v1",
      baseVersionId: null,
      effectiveAt: new Date("2026-01-01")
    };
    const candidate = {
      ...base,
      id: "v2",
      versionNo: 2,
      status: "draft",
      changeType: "change",
      baseVersionId: "v1",
      changeDirection: "unchanged",
      changeAmountCents: 0n,
      effectiveAt: null,
      [key]: key === "companyEntityRegisteredAddressSnapshot" ? null : "changed",
      templateSnapshot: { fieldSchema: [], clauseSchema: [] }
    };
    const tx = { $queryRaw: jest.fn().mockResolvedValue([base, candidate]) };
    const service = new ContractService({} as never, { record: jest.fn() } as never);
    const subject = service as unknown as {
      assertChangeAmountProjection(client: unknown, version: typeof candidate): Promise<void>;
    };

    await expect(subject.assertChangeAmountProjection(tx, candidate))
      .rejects.toThrow("合同变更不能替换我方签约主体");
  });
});
