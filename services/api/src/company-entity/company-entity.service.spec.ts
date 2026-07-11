import { BadRequestException } from "@nestjs/common";
import { CompanyEntityService } from "./company-entity.service";

describe("CompanyEntityService", () => {
  it.each([undefined, "", "   "])("公司主体名称缺失时返回中文 400", async (name) => {
    const prisma = { companyEntity: { create: jest.fn() } };
    const service = new CompanyEntityService(prisma as never);

    let thrown: unknown;
    try {
      await service.create({ name: name as string });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(thrown).toMatchObject({ status: 400, message: "请填写公司主体名称" });
    expect(prisma.companyEntity.create).not.toHaveBeenCalled();
  });
});
