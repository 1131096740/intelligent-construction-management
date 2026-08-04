import { readFileSync } from "fs";
import { join } from "path";
import PizZip from "pizzip";
import { coreFlowSeedData } from "./core-flow-seed-data";

function templateText(originalName: string): string {
  const buffer = readFileSync(join(process.cwd(), "assets", "templates", originalName));
  return new PizZip(buffer).file("word/document.xml")?.asText() ?? "";
}

describe("coreFlowSeedData", () => {
  it("describes the first contract-settlement-payment closed loop", () => {
    expect(coreFlowSeedData.project.code).toBe("JGXM-001");
    expect(coreFlowSeedData.project.name).toBe(
      "昆明市2023年城市防洪排涝治理工程一-西山区新运粮河分洪工程设计施工总承包合同"
    );
    expect(coreFlowSeedData.contract.code).toBe("HT-2026-001");
    expect(coreFlowSeedData.contractVersion.status).toBe("effective");
    expect(coreFlowSeedData.paymentTermsVersion.status).toBe("effective");
    expect(coreFlowSeedData.paymentStages.map((stage) => stage.ratioBps)).toEqual([8000, 2000]);
    expect(coreFlowSeedData.paymentStages.map((stage) => stage.stageType)).toEqual([
      "progress",
      "retention"
    ]);
    expect(coreFlowSeedData.paymentStages.map((stage) => stage.triggerAnchor)).toEqual([
      "settlement_effective",
      "final_settlement_effective"
    ]);
    expect(coreFlowSeedData.settlement.code).toBe("JS-2026-018");
    expect(coreFlowSeedData.settlement.status).toBe("partially_paid");
    expect(coreFlowSeedData.settlement.isFinal).toBe(false);
    expect(coreFlowSeedData.paymentRequest.code).toBe("FK-2026-006");
    expect(coreFlowSeedData.paymentRequest.status).toBe("partially_paid");
    expect(coreFlowSeedData.paymentExecution.amountCents).toBe(12800000);
    expect(coreFlowSeedData.companyEntity).toMatchObject({
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    });
    expect(coreFlowSeedData.companyEntityVersion).toMatchObject({
      companyEntityId: coreFlowSeedData.companyEntity.id,
      versionNo: 1,
      isActive: true
    });
    expect(coreFlowSeedData.contractVersion).toMatchObject({
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: coreFlowSeedData.companyEntity.id,
      companyEntityVersionId: coreFlowSeedData.companyEntityVersion.id,
      companyEntityNameSnapshot: coreFlowSeedData.companyEntity.name,
      companyEntityCreditCodeSnapshot:
        coreFlowSeedData.companyEntity.unifiedSocialCreditCode
    });
    expect(coreFlowSeedData.paymentExecution).toMatchObject({
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      ),
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: coreFlowSeedData.companyEntity.id,
      companyEntityNameSnapshot: coreFlowSeedData.companyEntity.name,
      companyEntityCreditCodeSnapshot:
        coreFlowSeedData.companyEntity.unifiedSocialCreditCode
    });
    expect(coreFlowSeedData.ownerContract).toMatchObject({
      documentVersion: 1,
      status: "effective",
      confirmedAt: expect.any(Date)
    });
    expect(coreFlowSeedData.upstreamSettlement).toMatchObject({
      documentVersion: 1,
      status: "legacy_recorded"
    });
    expect(coreFlowSeedData.upstreamSettlement.approvedAmountCents).toBeGreaterThanOrEqual(
      coreFlowSeedData.settlement.amountCents
    );
    expect(coreFlowSeedData.projectReceipt.amountCents).toBeGreaterThanOrEqual(
      coreFlowSeedData.paymentRequest.approvedAmountCents
    );
    expect(coreFlowSeedData.projectReceipt.sourceType).toBe(
      "general_contractor_payment"
    );
  });

  it("seeds the immutable payment execution with funding and audit facts", () => {
    const seedScript = readFileSync(
      join(process.cwd(), "prisma", "seed.cjs"),
      "utf8"
    );

    expect(seedScript).toContain("seedPaymentExecutionClosedLoop");
    expect(seedScript).toContain("assertExactPaymentExecutionFacts");
    expect(seedScript).toContain("paymentExecution.findMany");
    expect(seedScript).toContain("paymentExecution.create");
    expect(seedScript).not.toMatch(/paymentExecution\.upsert/u);
    expect(seedScript).toContain("projectFundingAllocation.findMany");
    expect(seedScript).toContain("projectFundingAllocation.create");
    expect(seedScript).toContain('executionType: "payment_execution"');
    expect(seedScript).toContain('sourceType: "project_cash"');
    expect(seedScript).toContain('reversalKey: "original"');
    expect(seedScript).toContain("auditLog.findUnique");
    expect(seedScript).toContain("auditLog.create");
    expect(seedScript).toContain('action: "payment.execution.record"');
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
      "projectName",
      "deliveryLocation",
      "qualityStandard",
      "taxRatePercent",
      "invoiceType",
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
      docxFile: {
        objectKey: "seed/templates/material-purchase-real-v1.docx",
        originalName: "material-purchase-real-v1.docx"
      },
      previewPdfFile: { objectKey: "seed/templates/material-purchase-v1-preview.pdf" },
      previewJob: { status: "succeeded" }
    });
    expect(seed.layout.inspectionReport.blockingErrors).toEqual([]);
    expect(seed.layout.inspectionReport.placeholders).toEqual(
      expect.arrayContaining([
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.projectName",
        "field.deliveryLocation",
        "party.owner.name",
        "party.counterparty.name",
        "clause.payment.text",
        "bill.materials"
      ])
    );
    expect(seed.layout.previewJob.sampleData.contract).toMatchObject({
      amountUppercase: "人民币壹拾贰万捌仟元整"
    });
    expect(seed.layout.previewJob.sampleData.bill.materials[0]).toMatchObject({
      itemName: "钢筋",
      unitPrice: "4200.00",
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
      coreFlowSeedData.laborSubcontractWorkbench,
      coreFlowSeedData.genericContractWorkbench
    ];

    expect(seeds.map((seed) => seed.template.contractTypeKey)).toEqual([
      "material_purchase",
      "equipment_rental",
      "labor_subcontract",
      "generic_contract"
    ]);
    expect(seeds.every((seed) => seed.version.status === "published")).toBe(true);
    expect(seeds.map((seed) => seed.layout.status)).toEqual([
      "published",
      "published",
      "published",
      "published"
    ]);
    expect(seeds.map((seed) => seed.layout.docxFile.originalName)).toEqual([
      "material-purchase-real-v1.docx",
      "equipment-rental-real-v1.docx",
      "labor-subcontract-real-v1.docx",
      "generic-contract-v1.docx"
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
    expect(coreFlowSeedData.genericContractWorkbench.template).toMatchObject({
      code: "generic_contract",
      status: "published"
    });
    expect(coreFlowSeedData.genericContractWorkbench.fields.map((field) => field.key)).toEqual([
      "projectName",
      "counterpartyName",
      "businessSummary",
      "settlementCycle",
      "paymentRatioPercent",
      "taxRatePercent",
      "invoiceType"
    ]);
    expect(coreFlowSeedData.genericContractWorkbench.bills[0].columns.map((column) => column.key)).toEqual([
      "itemName",
      "specification",
      "unit",
      "quantity",
      "unitPrice",
      "taxInclusiveAmount",
      "remark"
    ]);
    expect(coreFlowSeedData.genericContractWorkbench.clauses.map((clause) => clause.key)).toEqual([
      "payment",
      "specialAgreement"
    ]);
    expect(coreFlowSeedData.laborSubcontractWorkbench.attachments.map((attachment) => attachment.key)).toEqual([
      "safety_agreement",
      "wage_commitment"
    ]);
    expect(coreFlowSeedData.laborSubcontractWorkbench.fields.map((field) => field.key)).toEqual([
      "projectName",
      "workScope",
      "workLocation",
      "plannedStartDate",
      "plannedEndDate",
      "settlementCycle",
      "progressPaymentRatioPercent",
      "taxRatePercent",
      "invoiceType"
    ]);
    expect(
      coreFlowSeedData.laborSubcontractWorkbench.fields
        .filter((field) => ["plannedStartDate", "plannedEndDate"].includes(field.key))
        .every((field) => field.required === false)
    ).toBe(true);
    expect(coreFlowSeedData.laborSubcontractWorkbench.clauses.map((clause) => clause.key)).toEqual([
      "payment",
      "safety",
      "wageCommitment"
    ]);
    expect(coreFlowSeedData.laborSubcontractWorkbench.bills.map((bill) => bill.key)).toEqual(["laborItems"]);
    expect(
      [
        ...coreFlowSeedData.materialPurchaseWorkbench.bills,
        ...coreFlowSeedData.equipmentRentalWorkbench.bills,
        ...coreFlowSeedData.laborSubcontractWorkbench.bills,
        ...coreFlowSeedData.genericContractWorkbench.bills
      ].every((bill) => bill.unitPriceScale === 2)
    ).toBe(true);
    expect(
      [
        ...coreFlowSeedData.materialPurchaseWorkbench.bills,
        ...coreFlowSeedData.equipmentRentalWorkbench.bills,
        ...coreFlowSeedData.laborSubcontractWorkbench.bills,
        ...coreFlowSeedData.genericContractWorkbench.bills
      ].every((bill) => bill.quantityScale === 2)
    ).toBe(true);
    expect(
      coreFlowSeedData.materialPurchaseWorkbench.fields
        .find((field) => field.key === "taxRatePercent")
        ?.options?.map((option) => option.value)
    ).not.toContain("0");
    expect(coreFlowSeedData.equipmentRentalWorkbench.fields.map((field) => field.key)).toEqual([
      "rentalStartDate",
      "rentalEndDate",
      "useLocation",
      "settlementCycle",
      "paymentRatioPercent",
      "taxRatePercent",
      "invoiceType"
    ]);
    expect(
      coreFlowSeedData.equipmentRentalWorkbench.fields
        .filter((field) => ["rentalStartDate", "rentalEndDate"].includes(field.key))
        .every((field) => field.required === false)
    ).toBe(true);
    expect(coreFlowSeedData.genericContractWorkbench.numberingRule).toMatchObject({
      contractTypeKey: "generic_contract",
      isActive: true
    });
  });

  it.each([
    [
      "material purchase",
      coreFlowSeedData.materialPurchaseWorkbench.layout.docxFile.originalName,
      [
        "项目名称",
        "交货地点",
        "甲方名称",
        "乙方名称",
        "付款条款",
        "材料清单"
      ]
    ],
    [
      "equipment rental",
      coreFlowSeedData.equipmentRentalWorkbench.layout.docxFile.originalName,
      [
        "使用地点",
        "甲方名称",
        "乙方名称",
        "付款条款",
        "机械租赁清单"
      ]
    ],
    [
      "labor subcontract",
      coreFlowSeedData.laborSubcontractWorkbench.layout.docxFile.originalName,
      [
        "作业地点",
        "计划开工日期",
        "付款条款",
        "安全文明条款",
        "工资承诺条款",
        "劳务清单"
      ]
    ],
    [
      "generic contract",
      coreFlowSeedData.genericContractWorkbench.layout.docxFile.originalName,
      [
        "项目名称",
        "相对方名称",
        "业务摘要",
        "付款条款",
        "特别约定",
        "通用清单"
      ]
    ]
  ])("ships a matching %s DOCX seed asset", (_label, originalName, placeholders) => {
    const text = templateText(originalName);

    for (const placeholder of placeholders) {
      expect(text).toContain(placeholder);
    }
  });
});
