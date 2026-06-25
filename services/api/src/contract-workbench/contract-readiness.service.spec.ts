import { ContractReadinessService } from "./contract-readiness.service";

describe("ContractReadinessService", () => {
  const version = {
    id: "version-1",
    draftRevision: 4,
    amountCents: 1_000n,
    amountSource: "bill_sum",
    amountAdjustmentReason: null,
    layoutTemplateVersionId: "layout-1",
    draftData: { project_name: "建设项目" },
    templateSnapshot: {
      fieldSchema: [
        { key: "project_name", label: "项目名称", type: "text", required: true }
      ],
      billSchema: [
        {
          key: "main_bill",
          name: "主清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          required: true,
          columns: [{ key: "item_name", label: "项目", type: "text", required: true }]
        }
      ],
      clauseSchema: [
        {
          key: "payment",
          title: "付款条款",
          numberingMode: "automatic",
          required: true,
          content: {}
        }
      ],
      attachmentSchema: [{ key: "later", name: "二阶段附件", required: true }],
      validationSchema: [
        {
          key: "payment_basis",
          level: "block",
          targetClauseKey: "payment",
          requiredPhrases: ["结算", "付款"],
          message: "付款条款缺少结算付款依据"
        },
        {
          key: "friendly_warning",
          level: "warning",
          targetClauseKey: "payment",
          requiredPhrases: ["友好协商"],
          message: "建议增加协商措辞"
        }
      ]
    },
    clauseSnapshot: [
      {
        key: "payment",
        title: "付款条款",
        numberingMode: "automatic",
        required: true,
        content: { text: "按结算结果付款" }
      }
    ]
  };

  function tx(overrides: Record<string, unknown> = {}) {
    return {
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-1",
            billKey: "main_bill",
            taxInclusiveAmountCents: 1_000n
          }
        ])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          { contractBillId: "bill-1", itemName: "钢材", customData: { item_name: "钢材" } }
        ])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { id: "party-a", roleKey: "party_a" },
          { id: "party-b", roleKey: "party_b" }
        ])
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-1",
          layoutTemplateId: "layout-template-1",
          status: "published"
        })
      },
      contractLayoutTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-template-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractGeneratedDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "document-1",
            purpose: "internal_review",
            status: "success",
            sourceRevision: 4,
            layoutTemplateVersionId: "layout-1"
          }
        ])
      },
      ...overrides
    };
  }

  const contract = { contractTypeKey: "material_purchase" };

  it("blocks internal review when a required field is missing", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, draftData: { project_name: "" } } as never,
      contract,
      false
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "field.project_name" })])
    );
  });

  it("blocks when a required clause is empty", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, clauseSnapshot: [{ ...version.clauseSnapshot[0], content: "" }] } as never,
      contract,
      false
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "clause.payment" })])
    );
  });

  it("blocks when required payment-basis phrases are missing", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      {
        ...version,
        clauseSnapshot: [
          { ...version.clauseSnapshot[0], content: { text: "仅约定付款" } }
        ]
      } as never,
      contract,
      false
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "payment_basis" })])
    );
  });

  it("warns but does not block for non-critical phrase rules", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      version as never,
      contract,
      false
    );

    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ key: "friendly_warning" })
    ]);
  });

  it("blocks approval submission when the latest internal-review document is stale", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractGeneratedDocument: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "document-1",
              purpose: "internal_review",
              status: "success",
              sourceRevision: 3,
              layoutTemplateVersionId: "layout-1"
            }
          ])
        }
      }) as never,
      version as never,
      contract,
      true
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "document.internal_review" })])
    );
  });

  it("ignores attachment completeness until stage 2", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      version as never,
      contract,
      false
    );

    expect(result.blocking.some((item) => item.section === "attachments")).toBe(false);
  });
});
