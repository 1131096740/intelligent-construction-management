import { SettlementAttachmentTemplateService } from "./settlement-attachment-template.service";

describe("SettlementAttachmentTemplateService", () => {
  it.each([
    ["receipt-form", "收方单模板.xlsx"],
    ["labor-signoff", "签工单模板.xlsx"],
    ["sporadic-machinery-confirmation", "零星机械签认单模板.xlsx"],
    ["shift-record", "台班记录表模板.xlsx"]
  ])("exports the %s offline settlement attachment template", async (templateKey, fileName) => {
    const service = new SettlementAttachmentTemplateService();

    const result = await service.exportTemplate("settlement-1", templateKey, "user-1");

    expect(result.fileName).toBe(fileName);
    expect(result.buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("exports a downloadable xlsx template and audits the download", async () => {
    const audit = { record: jest.fn() };
    const prisma = { settlement: { findFirst: jest.fn().mockResolvedValue({ id: "settlement-real-1" }) } };
    const service = new SettlementAttachmentTemplateService(prisma as never, audit as never);

    const result = await service.exportTemplate("settlement-1", "receipt-form", "user-1");

    expect(result.fileName).toBe("收方单模板.xlsx");
    expect(result.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(result.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        actorUserId: "user-1",
        action: "settlement.attachment_template.download",
        businessType: "settlement",
        businessId: "settlement-real-1",
        metadata: expect.objectContaining({ templateKey: "receipt-form" })
      })
    );
  });

  it("rejects template downloads for unknown settlements", async () => {
    const prisma = { settlement: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new SettlementAttachmentTemplateService(prisma as never);

    await expect(service.exportTemplate("missing", "receipt-form", "user-1")).rejects.toThrow(
      "未找到该结算单，请刷新结算台账后重试"
    );
  });

  it("rejects unknown settlement attachment template keys", async () => {
    const service = new SettlementAttachmentTemplateService();

    await expect(service.exportTemplate("settlement-1", "unknown", "user-1")).rejects.toThrow(
      "未找到该结算附件模板，请重新选择模板后再下载"
    );
  });
});
