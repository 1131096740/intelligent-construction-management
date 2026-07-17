import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

function facts(amountCents = 112_200n) {
  return {
    amountCents,
    finalCumulativeAmountCents: null,
    previousEffectiveSettlementCents: 2_000_000n,
    payableAmountCents: (amountCents * 8500n) / 10_000n,
    currentSettlementStage: { id: "stage-1", ratioBps: 8500 },
    taxFacts: {
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "13",
      taxFactRevision: 4
    },
    lines: [{
      sourceType: "contract_bill_row" as const,
      contractBillRowId: "row-1",
      name: "钢材",
      specification: "HRB400",
      unit: "吨",
      quantity: "2",
      taxInclusiveUnitPrice: "561",
      taxExclusiveUnitPrice: "496.46",
      taxRatePercent: "13",
      taxInclusiveAmountCents: amountCents,
      taxExclusiveAmountCents: 99_292n,
      taxAmountCents: amountCents - 99_292n,
      remark: null
    }]
  };
}

function context(preparedFacts: ReturnType<typeof facts>[] = [facts(), facts()]) {
  const draft = {
    id: "draft-1",
    projectId: "project-1",
    contractId: "contract-1",
    contractVersionId: "version-1",
    paymentTermsVersionId: "terms-1",
    settlementTemplateVersionId: "template-1",
    code: "JS-001",
    periodLabel: "2026-07",
    isFinal: false,
    finalCumulativeAmountCents: null,
    lines: [],
    revision: 3,
    status: "draft",
    ownerUserId: "owner-1",
    governanceVersion: 1,
    fieldReviewerUserId: "material-1",
    fieldReviewerRoleKey: "material_staff",
    finalScopeCompleted: null,
    finalPriorSettlementsIncluded: null,
    finalNoOutstandingSettlements: null,
    finalWithinContractCap: null,
    finalNoFurtherOrdinarySettlements: null,
    submittedSettlementId: null,
    submittedAt: null,
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
    updatedAt: new Date("2026-07-18T00:00:00.000Z")
  };
  let active: Record<string, unknown> | null = null;
  let fileSequence = 0;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: "locked" }]),
    settlementDraft: { findUnique: jest.fn().mockResolvedValue(draft) },
    contract: { findUnique: jest.fn().mockResolvedValue({
      id: "contract-1", code: "HT-001", name: "钢材采购合同",
      contractTypeKey: "material_purchase", counterparty: "供应商",
      companyEntityName: "建设公司"
    }) },
    project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "项目一" }) },
    contractVersion: { findUnique: jest.fn().mockResolvedValue({
      id: "version-1", companyEntityNameSnapshot: "建设公司",
      invoiceType: "vat_special", taxMode: "single_rate",
      defaultTaxRatePercent: { toString: () => "13" }, taxFactRevision: 4
    }) },
    settlementSignedDocument: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(active)),
      update: jest.fn().mockImplementation(({ data }) => {
        active = active ? { ...active, ...data } : null;
        return Promise.resolve(active);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        active = { id: "frozen-1", ...data };
        return Promise.resolve(active);
      })
    }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    settlementSignedDocument: tx.settlementSignedDocument
  };
  const settlements = {
    prepareDraftDocumentFacts: jest.fn(),
    freezeGovernedSettlementFacts: jest.fn().mockResolvedValue({})
  };
  for (const value of preparedFacts) settlements.prepareDraftDocumentFacts.mockResolvedValueOnce(value);
  const files = {
    uploadPrivateFile: jest.fn().mockImplementation(({ buffer }) => {
      fileSequence += 1;
      return Promise.resolve({ id: `file-${fileSequence}`, contentSha256: sha(buffer) });
    }),
    discardUnlinkedGeneratedFile: jest.fn().mockResolvedValue(undefined)
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new SettlementFrozenDocumentService(
    prisma as never,
    settlements as never,
    files as never,
    audit as never
  );
  return {
    service,
    draft,
    tx,
    prisma,
    settlements,
    files,
    audit,
    getActive: () => active,
    setActive: (value: Record<string, unknown> | null) => { active = value; }
  };
}

describe("SettlementFrozenDocumentService", () => {
  it("persists an A4-landscape frozen copy from formal tax and payable facts", async () => {
    const { service, tx, files, audit, getActive } = context();

    await expect(service.generate("project-1", "draft-1", "owner-1", 3))
      .resolves.toEqual(expect.objectContaining({
        purpose: "frozen_counterparty_copy",
        sourceRevision: 3,
        pageCount: 1,
        status: "active"
      }));

    expect(files.uploadPrivateFile).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: "application/pdf",
      uploadedByUserId: "owner-1",
      buffer: expect.any(Buffer)
    }));
    expect(tx.settlementSignedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        businessSnapshotToken: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    });
    expect(getActive()).not.toBeNull();
    expect(files.discardUnlinkedGeneratedFile).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "settlement.frozen_document.generated"
    }));
  });

  it("discards the uploaded orphan and refuses activation when facts drift", async () => {
    const { service, tx, files } = context([facts(), facts(112_201n)]);

    await expect(service.generate("project-1", "draft-1", "owner-1", 3))
      .rejects.toThrow("前序结算已变化");

    expect(tx.settlementSignedDocument.create).not.toHaveBeenCalled();
    expect(files.discardUnlinkedGeneratedFile).toHaveBeenCalledWith("file-1", "owner-1");
  });

  it("refuses submission when a previously signed frozen copy no longer matches current facts", async () => {
    const first = context([facts(), facts()]);
    await first.service.generate("project-1", "draft-1", "owner-1", 3);
    const oldDocument = first.getActive();

    const changed = context([facts(112_201n)]);
    changed.tx.settlementSignedDocument.findFirst.mockResolvedValue(oldDocument);
    await expect(changed.service.assertCurrentFacts(changed.tx as never, changed.draft as never))
      .rejects.toThrow("重新生成冻结版并由乙方重新签章");
  });

  it("reuses the same active snapshot without a second upload", async () => {
    const current = context([facts(), facts(), facts()]);
    const first = await current.service.generate("project-1", "draft-1", "owner-1", 3);
    const second = await current.service.generate("project-1", "draft-1", "owner-1", 3);
    expect(second).toEqual(first);
    expect(current.files.uploadPrivateFile).toHaveBeenCalledTimes(1);
    expect(current.tx.settlementSignedDocument.create).toHaveBeenCalledTimes(1);
  });

  it("returns the concurrent winner and discards the losing uploaded file", async () => {
    const current = context([facts(), facts()]);
    const winner = {
      id: "winner",
      settlementDraftId: "draft-1",
      purpose: "frozen_counterparty_copy",
      status: "active",
      sourceRevision: 3,
      businessSnapshotToken: ""
    };
    current.tx.settlementSignedDocument.create.mockImplementationOnce(({ data }) => {
      current.setActive({ ...winner, businessSnapshotToken: data.businessSnapshotToken });
      return Promise.reject({ code: "P2002" });
    });

    await expect(current.service.generate("project-1", "draft-1", "owner-1", 3))
      .resolves.toEqual(expect.objectContaining({ id: "winner" }));
    expect(current.files.discardUnlinkedGeneratedFile).toHaveBeenCalledWith("file-1", "owner-1");
  });

  it("cleans the uploaded file when database association fails", async () => {
    const current = context([facts(), facts()]);
    current.tx.settlementSignedDocument.create.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    await expect(current.service.generate("project-1", "draft-1", "owner-1", 3))
      .rejects.toThrow("database unavailable");
    expect(current.files.discardUnlinkedGeneratedFile).toHaveBeenCalledWith("file-1", "owner-1");
  });

  it("rejects project, owner, governance and revision mismatches before upload", async () => {
    for (const mutate of [
      (draft: Record<string, unknown>) => { draft.projectId = "project-2"; },
      (draft: Record<string, unknown>) => { draft.ownerUserId = "owner-2"; },
      (draft: Record<string, unknown>) => { draft.governanceVersion = null; },
      (draft: Record<string, unknown>) => { draft.revision = 4; }
    ]) {
      const current = context([facts()]);
      mutate(current.draft as unknown as Record<string, unknown>);
      await expect(current.service.generate("project-1", "draft-1", "owner-1", 3))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(current.files.uploadPrivateFile).not.toHaveBeenCalled();
    }
  });

  it("rejects missing tax facts and a mismatched field-review route before upload", async () => {
    const missingTax = facts();
    (missingTax.taxFacts as { invoiceType: string | null }).invoiceType = null;
    const current = context([missingTax]);
    await expect(current.service.generate("project-1", "draft-1", "owner-1", 3))
      .rejects.toThrow("税务事实不完整");
    expect(current.files.uploadPrivateFile).not.toHaveBeenCalled();

    const wrongRole = context([facts()]);
    wrongRole.draft.fieldReviewerRoleKey = "engineering_tech";
    await expect(wrongRole.service.generate("project-1", "draft-1", "owner-1", 3))
      .rejects.toThrow("现场复核岗位与合同类型不一致");
    expect(wrongRole.files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("refuses a missing, cross-project or inactive field reviewer before upload", async () => {
    for (const message of [
      "请选择所属项目当前有效人员",
      "只能选择所属项目当前有效人员"
    ]) {
      const current = context([facts()]);
      current.settlements.freezeGovernedSettlementFacts.mockRejectedValueOnce(
        new BadRequestException(message)
      );
      await expect(current.service.generate("project-1", "draft-1", "owner-1", 3))
        .rejects.toThrow(message);
      expect(current.files.uploadPrivateFile).not.toHaveBeenCalled();
    }
  });
});
