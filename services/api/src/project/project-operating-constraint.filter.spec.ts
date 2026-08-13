import { Controller, Get, INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { AddressInfo } from "node:net";
import { ProjectOperatingConstraintFilter } from "./project-operating-constraint.filter";

@Controller("project-operating-constraint-test")
class ConstraintTestController {
  @Get()
  read() {
    throw new Prisma.PrismaClientKnownRequestError(
      "该公司未在本项目参与公司名单中，或已停止新增业务",
      {
        code: "P2004",
        clientVersion: "5.22.0",
        meta: { database_error: "该公司未在本项目参与公司名单中，或已停止新增业务" }
      }
    );
  }

  @Get("expired-assignment")
  readExpiredAssignment() {
    throw new Prisma.PrismaClientKnownRequestError(
      "正式经营事实引用的施工企业已失效，请刷新后重试",
      {
        code: "P2004",
        clientVersion: "5.22.0",
        meta: { database_error: "正式经营事实引用的施工企业已失效，请刷新后重试" }
      }
    );
  }
}

describe("ProjectOperatingConstraintFilter", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConstraintTestController],
      providers: [{ provide: APP_FILTER, useClass: ProjectOperatingConstraintFilter }]
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  it("maps a formal-fact database constraint to a correctable Chinese HTTP 400", async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/project-operating-constraint-test`
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "该公司未在本项目参与公司名单中，或已停止新增业务"
    });
  });

  it("maps an expired construction-enterprise reference to HTTP 400", async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/project-operating-constraint-test/expired-assignment`
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "正式经营事实引用的施工企业已失效，请刷新后重试"
    });
  });
});
