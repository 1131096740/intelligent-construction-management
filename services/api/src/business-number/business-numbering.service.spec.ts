import { BusinessNumberingService, chinaBusinessDate } from "./business-numbering.service";

describe("BusinessNumberingService", () => {
  it("uses the Beijing business date and zero-padded daily sequence", async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ sequence: 7 }]);
    const service = new BusinessNumberingService();

    await expect(
      service.allocateDaily(
        { $queryRaw: queryRaw } as never,
        "HT",
        new Date("2026-07-23T16:30:00.000Z")
      )
    ).resolves.toBe("HT-20260724-007");
    expect(queryRaw).toHaveBeenCalledWith(expect.anything());
  });

  it("rejects an invalid database allocation result", async () => {
    const service = new BusinessNumberingService();
    await expect(
      service.allocateDaily({ $queryRaw: jest.fn().mockResolvedValue([]) } as never, "HT")
    ).rejects.toThrow("正式编号日流水分配失败");
  });

  it("keeps the business date independent from the process timezone", () => {
    expect(chinaBusinessDate(new Date("2026-07-23T15:59:59.000Z"))).toBe("20260723");
    expect(chinaBusinessDate(new Date("2026-07-23T16:00:00.000Z"))).toBe("20260724");
  });
});
