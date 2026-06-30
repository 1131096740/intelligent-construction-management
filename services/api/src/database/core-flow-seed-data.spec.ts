import { coreFlowSeedData } from "./core-flow-seed-data";

describe("coreFlowSeedData", () => {
  it("describes the first contract-settlement-payment closed loop", () => {
    expect(coreFlowSeedData.project.code).toBe("JGXM-001");
    expect(coreFlowSeedData.contract.code).toBe("HT-2026-001");
    expect(coreFlowSeedData.contractVersion.status).toBe("effective");
    expect(coreFlowSeedData.paymentTermsVersion.status).toBe("effective");
    expect(coreFlowSeedData.paymentStages.map((stage) => stage.ratioBps)).toEqual([8000, 2000]);
    expect(coreFlowSeedData.settlement.code).toBe("JS-2026-018");
    expect(coreFlowSeedData.settlement.status).toBe("effective");
    expect(coreFlowSeedData.paymentRequest.code).toBe("FK-2026-006");
    expect(coreFlowSeedData.paymentRequest.status).toBe("approved_pending_payment");
    expect(coreFlowSeedData.paymentExecution.amountCents).toBe(12800000);
  });

  it("describes the material purchase workbench template seed", () => {
    const seed = coreFlowSeedData.materialPurchaseWorkbench;

    expect(seed.template).toMatchObject({
      code: "material_purchase",
      contractTypeKey: "material_purchase",
      status: "published"
    });
    expect(seed.version).toMatchObject({ versionNo: 1, status: "published" });

    expect(seed.fields.map((field) => field.key)).toEqual([
      "deliveryLocation",
      "deliveryDeadline",
      "qualityStandard",
      "taxRatePercent",
      "settlementMethod"
    ]);
    expect(seed.bills.map((bill) => bill.key)).toEqual(["materials", "transportFees"]);
    expect(seed.bills.map((bill) => bill.name)).toEqual(["材料价格清单", "运费清单"]);

    expect(seed.validations).toContainEqual(
      expect.objectContaining({
        key: "payment_basis_required",
        level: "block",
        targetClauseKey: "payment",
        requiredPhrases: ["已生效结算单", "合规发票"]
      })
    );
    expect(seed.standardPaymentClause).toMatchObject({
      code: "STD-PAYMENT-MATERIAL-001",
      category: "payment",
      status: "published",
      versionNo: 1
    });
    expect(seed.clauses[0]).toMatchObject({
      key: "payment",
      required: true,
      standardClauseVersionId: seed.standardPaymentClause.versionId
    });

    expect(seed.layout).toMatchObject({
      status: "published",
      versionNo: 1,
      docxFile: { objectKey: "seed/templates/material-purchase-v1.docx" },
      previewPdfFile: { objectKey: "seed/templates/material-purchase-v1-preview.pdf" },
      previewJob: { status: "succeeded" }
    });
    expect(seed.layout.inspectionReport.blockingErrors).toEqual([]);
    expect(seed.layout.inspectionReport.placeholders).toEqual(
      expect.arrayContaining([
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.deliveryLocation",
        "clause.payment.text",
        "bill.materials"
      ])
    );
    expect(seed.layout.previewJob.sampleData.contract).toMatchObject({
      amountUppercase: "人民币壹拾贰万捌仟元整"
    });
    expect(seed.layout.previewJob.sampleData.bill.materials[0]).toMatchObject({
      itemName: "钢筋",
      taxInclusiveAmount: "42000.00"
    });

    expect(seed.numberingRule).toMatchObject({
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      isActive: true
    });
  });

  it("describes the initial enterprise contract template types", () => {
    const seeds = [
      coreFlowSeedData.materialPurchaseWorkbench,
      coreFlowSeedData.equipmentRentalWorkbench,
      coreFlowSeedData.laborSubcontractWorkbench
    ];

    expect(seeds.map((seed) => seed.template.contractTypeKey)).toEqual([
      "material_purchase",
      "equipment_rental",
      "labor_subcontract"
    ]);
    expect(seeds.every((seed) => seed.version.status === "published")).toBe(true);
    expect(seeds.map((seed) => seed.layout.status)).toEqual([
      "published",
      "published",
      "published"
    ]);
    expect(coreFlowSeedData.equipmentRentalWorkbench.bills[0].columns.map((column) => column.key)).toEqual([
      "itemName",
      "specification",
      "quantity",
      "unit",
      "fuelIncluded",
      "operatorIncluded",
      "unitPrice",
      "taxRatePercent",
      "taxInclusiveAmount",
      "remark"
    ]);
    expect(coreFlowSeedData.laborSubcontractWorkbench.attachments.map((attachment) => attachment.key)).toEqual([
      "safety_agreement",
      "wage_commitment"
    ]);
  });
});
