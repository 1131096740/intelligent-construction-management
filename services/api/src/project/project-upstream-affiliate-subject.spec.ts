import { ProjectService } from "./project.service";

function projectTransaction(tx: object) {
  return {
    $transaction: jest.fn(async (callback: (client: object) => unknown) => callback(tx))
  };
}

describe("ProjectService upstream affiliate snapshots", () => {
  it("fails an upstream settlement before file or business writes when the mapping is missing", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      fileObject: { findUnique: jest.fn() },
      projectUpstreamSettlement: { create: jest.fn() }
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      projectTransaction(tx) as never,
      undefined,
      auth as never
    );

    await expect(
      service.recordUpstreamSettlement("project-1", "budget-1", {
        settledAt: "2026-07-28T00:00:00.000Z",
        reportedAmountCents: "10000",
        approvedAmountCents: "9000",
        approvingPartyName: "建设单位",
        periodLabel: "2026-07",
        isFinal: false,
        voucherFileId: "file-1"
      })
    ).rejects.toThrow("项目尚未明确配置唯一施工企业");
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectUpstreamSettlement.create).not.toHaveBeenCalled();
  });

  it("rejects the legacy receipt write before affiliate or file facts can be written", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      projectReceipt: {
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      projectTransaction(tx) as never,
      undefined,
      auth as never
    );

    await expect(
      service.recordReceipt("project-1", "finance-1", {
        receivedAt: "2026-07-28T00:00:00.000Z",
        amountCents: "10000",
        payerName: "挂靠建设集团",
        sourceType: "general_contractor_payment",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow(
      "旧项目收款入口已停止新增；请分别登记业主付款、施工企业向我方拨款、施工企业扣款或待核对到账差额"
    );
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectReceipt.create).not.toHaveBeenCalled();
  });
});
