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

  it.each([123, {}, []])("公司主体名称类型不正确时返回中文 400", async (name) => {
    const prisma = { companyEntity: { create: jest.fn() } };
    const service = new CompanyEntityService(prisma as never);

    let thrown: unknown;
    try {
      await service.create({ name } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      status: 400,
      message: "公司主体名称必须是文字"
    });
    expect(prisma.companyEntity.create).not.toHaveBeenCalled();
  });

  it.each([123, {}, []])("统一社会信用代码类型不正确时返回中文 400", async (creditCode) => {
    const prisma = { companyEntity: { create: jest.fn() } };
    const service = new CompanyEntityService(prisma as never);

    let thrown: unknown;
    try {
      await service.create({ name: "测试主体", unifiedSocialCreditCode: creditCode } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      status: 400,
      message: "统一社会信用代码必须是文字"
    });
    expect(prisma.companyEntity.create).not.toHaveBeenCalled();
  });
});
