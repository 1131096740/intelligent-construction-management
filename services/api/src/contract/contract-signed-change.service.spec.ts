import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ContractSignedChangeService } from "./contract-signed-change.service";

describe("ContractSignedChangeService", () => {
  function fixture({ director = false, amountYuan = "100.0123" }: {
    director?: boolean; amountYuan?: string | null;
  } = {}) {
    const version = {
      id: "version", contractId: "contract", status: "effective", numericProtocolVersion: 2,
      draftRevision: 1, amountCents: 10001n, pricingNature: "fixed_total", amountLimitType: "capped",
      amountYuan: amountYuan === null ? null : new Prisma.Decimal(amountYuan)
    };
    const appendix = {
      id: "appendix", contractVersionId: "version", purpose: "signed_change_appendix",
      status: "active", confirmedAt: null, uploadedByUserId: "staff", fileId: "file", contentSha256: "hash", pageCount: 2
    };
    const row = {
      id: "change", contractId: "contract", baseVersionId: "version", status: "pending_review",
      appendixFormalFileId: "appendix", summary: "调整完工范围", paymentAgreementText: "阶段验收后付款", sequenceNo: 1, submittedByUserId: "staff", createdAt: new Date(),
      amountDeltaYuan: new Prisma.Decimal("-0.0001"),
      precedingAmountYuan: version.amountYuan,
      effectiveAmountYuan: amountYuan === null ? null : new Prisma.Decimal("100.0122"),
      appendixFormalFile: appendix
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version" }]),
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      position: { findUnique: jest.fn().mockResolvedValue({ id: "director-position" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "contract-staff-position" }) },
      userPosition: { findFirst: jest.fn().mockResolvedValue(director ? { id: "director-grant" } : null) },
      project: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ id: "contract", projectId: "project" }) },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        findFirst: jest.fn().mockResolvedValue(version),
        update: jest.fn()
      },
      paymentRequest: { update: jest.fn() },
      settlement: { update: jest.fn() },
      contractFormalFile: {
        create: jest.fn().mockResolvedValue(appendix),
        findUnique: jest.fn().mockResolvedValue(appendix),
        update: jest.fn()
      },
      contractSignedChange: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue([row]),
        update: jest.fn().mockResolvedValue({ ...row, status: "approved" })
      }
    };
    const prisma = { $transaction: jest.fn().mockImplementation(callback => callback(tx)) };
    const formalFiles = {
      inspectOwnedStoredPdf: jest.fn().mockResolvedValue({ sha256: "hash", pageCount: 2, fileSnapshot: { sizeBytes: 64 } }),
      inspectLinkedStoredPdf: jest.fn().mockResolvedValue({ sha256: "hash", pageCount: 2, fileSnapshot: { sizeBytes: 64 } })
    };
    const auth = { confirmPassword: jest.fn() };
    return {
      tx, formalFiles, auth, row,
      service: new ContractSignedChangeService(prisma as never, formalFiles as never, auth as never)
    };
  }

  it("stops before modifying records if the dedicated submit witness is unavailable", async () => {
    const { service, tx } = fixture();
    const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    try {
      await expect(service.submit("version", "staff", {
        fileId: "file", summary: "调整范围", amountDeltaYuan: "-0.0001"
      })).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (oldKey !== undefined) process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
    }
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
    expect(tx.contractSignedChange.create).not.toHaveBeenCalled();
  });

  it("submits the inspected PDF through the witnessed transaction and leaves historical records untouched", async () => {
    const { service, tx, formalFiles, row } = fixture();
    tx.$queryRaw.mockResolvedValueOnce([{ database: "db", role: "app", xid: "1", backend: "2", expires: "1700000000" }])
      .mockResolvedValueOnce([row]);
    const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = "a".repeat(64);
    try {
      await expect(service.submit("version", "staff", {
        fileId: "file", summary: "调整完工范围", amountDeltaYuan: "-0.0001",
        paymentAgreementText: " 阶段验收后付款 "
      })).resolves.toMatchObject({
        status: "pending_review", precedingAmountYuan: "100.0123", effectiveAmountYuan: "100.0122"
      });
    } finally {
      if (oldKey === undefined) delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
      else process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
    }
    expect(formalFiles.inspectOwnedStoredPdf).toHaveBeenCalledWith("file", "staff");
    expect(tx.$queryRaw).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.stringContaining("jg_submit_contract_signed_change_v1")]),
      "project", "contract", "version", "staff", "file", "hash", 64, 2,
      "调整完工范围", "阶段验收后付款", "-0.0001", "1700000000", expect.stringMatching(/^[a-f0-9]{64}$/u)
    );
    expect(tx.contractFormalFile.create).not.toHaveBeenCalled();
    expect(tx.contractSignedChange.create).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("stops an authorized review before writing when the signed-change witness is absent", async () => {
    const { service, tx, row } = fixture({ director: true });
    tx.contractSignedChange.findFirst.mockResolvedValue(row);
    const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    try {
      await expect(service.review("version", "change", "director", { decision: "approve" }))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (oldKey !== undefined) process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
    }
    expect(tx.contractSignedChange.update).not.toHaveBeenCalled();
  });

  it("lets only the current supervisor approve an intact appendix through the witnessed transaction", async () => {
    const unauthorized = fixture();
    await expect(unauthorized.service.review("version", "change", "staff", { decision: "approve" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(unauthorized.tx.$queryRaw).not.toHaveBeenCalled();

    const { row, service, tx, formalFiles } = fixture({ director: true });
    tx.$queryRaw
      .mockResolvedValueOnce([{ status: "pending_review", submittedByUserId: "staff", appendixFileId: "file", contentSha256: "hash", pageCount: 2 }])
      .mockResolvedValueOnce([{ database: "db", role: "app", xid: "1", backend: "2", expires: "1700000000" }])
      .mockResolvedValueOnce([{ ...row, status: "approved" }])
      .mockResolvedValueOnce([{ status: "approved" }]);
    const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = "a".repeat(64);
    try {
      await expect(service.review("version", "change", "director", { decision: "approve" }))
        .resolves.toMatchObject({ status: "approved", effectiveAmountYuan: "100.0122" });
      expect(formalFiles.inspectLinkedStoredPdf).toHaveBeenCalledWith("file", "hash", 2);
      expect(tx.$queryRaw).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.stringContaining("jg_review_contract_signed_change_v1")]),
        "project", "contract", "version", "change", "director", "approve", null, null,
        "file", "hash", 64, 2, "1700000000", expect.stringMatching(/^[a-f0-9]{64}$/u)
      );
      await expect(service.review("version", "change", "director", { decision: "approve" })).rejects.toBeInstanceOf(ConflictException);
    } finally {
      if (oldKey === undefined) delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
      else process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
    }
    expect(tx.contractFormalFile.update).not.toHaveBeenCalled();
    expect(tx.contractSignedChange.update).not.toHaveBeenCalled();
  });

  it("needs a reason and current password before signing self-review", async () => {
    const { service, tx, auth } = fixture({ director: true });
    const change = { status: "pending_review", submittedByUserId: "director", appendixFileId: "file", contentSha256: "hash", pageCount: 2 };
    const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = "a".repeat(64);
    try {
      tx.$queryRaw.mockResolvedValueOnce([change]);
      await expect(service.review("version", "change", "director", { decision: "approve" })).rejects.toBeInstanceOf(BadRequestException);
      tx.$queryRaw.mockResolvedValueOnce([change]);
      await expect(service.review("version", "change", "director", { decision: "approve", selfReviewReason: "业务留痕" }))
        .rejects.toBeInstanceOf(BadRequestException);
      tx.$queryRaw.mockResolvedValueOnce([change]);
      auth.confirmPassword.mockRejectedValueOnce(new BadRequestException("当前密码不正确"));
      await expect(service.review("version", "change", "director", {
        decision: "approve", selfReviewReason: "业务留痕", confirmationPassword: "wrong"
      })).rejects.toThrow("当前密码不正确");
      expect(auth.confirmPassword).toHaveBeenCalledWith("director", "wrong", tx);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    } finally {
      if (oldKey === undefined) delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
      else process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
    }
  });

  it("rejects an unrelated user before opening the signed change list", async () => {
    const { service, tx } = fixture();
    tx.projectMember.findFirst.mockResolvedValue(null);
    await expect(service.list("version", "outsider")).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("keeps the original total until approval and displays the effective precise total afterward", async () => {
    const { service, tx, row } = fixture();
    tx.contractSignedChange.findMany.mockRejectedValue(new Error("42501"));
    tx.$queryRaw.mockResolvedValue([{ ...row, appendixFileId: "file" }]);
    await expect(service.list("version", "staff")).resolves.toMatchObject({
      originalAmountYuan: "100.0123", effectiveAmountYuan: "100.0123",
      currentPaymentAgreementText: null,
      changes: [expect.objectContaining({ status: "pending_review", appendixFileId: "file" })]
    });
    tx.$queryRaw.mockResolvedValue([{ ...row, status: "approved", appendixFileId: "file" }]);
    await expect(service.list("version", "staff")).resolves.toMatchObject({
      originalAmountYuan: "100.0123", effectiveAmountYuan: "100.0122", currentPaymentAgreementText: "阶段验收后付款"
    });
  });
});
