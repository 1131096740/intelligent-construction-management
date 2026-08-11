import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { ContractTakeoverController } from "./contract-takeover.controller";
import { ContractTakeoverService } from "./contract-takeover.service";

describe("历史合同接管切换：旧确认写入永久 tombstone", () => {
  let app: INestApplication | undefined;
  const previousMode = process.env.CONTRACT_CUTOVER_MODE;
  const previousCanaryUsers = process.env.CONTRACT_CUTOVER_CANARY_USER_IDS;
  const takeoverWrites = {
    confirm: jest.fn(),
    detail: jest.fn().mockResolvedValue({ id: "takeover-1" })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractTakeoverController]
    })
      .useMocker((token) => token === ContractTakeoverService ? takeoverWrites : {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new ContractCutoverGuard(new Reflector()));
    app.use((
      request: { user?: unknown },
      _response: unknown,
      next: () => void
    ) => {
      request.user = {
        id: "takeover-tombstone-route-owner",
        name: "旧接管确认 tombstone 路由测试用户",
        phone: null
      };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CONTRACT_CUTOVER_CANARY_USER_IDS;
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.CONTRACT_CUTOVER_MODE;
    else process.env.CONTRACT_CUTOVER_MODE = previousMode;
    if (previousCanaryUsers === undefined) {
      delete process.env.CONTRACT_CUTOVER_CANARY_USER_IDS;
    } else {
      process.env.CONTRACT_CUTOVER_CANARY_USER_IDS = previousCanaryUsers;
    }
    if (app) await app.close();
  });

  it.each(["release-a", "maintenance", "release-b-maintenance", "release-b"])(
    "在 %s 下旧接管确认永久返回 410 且不调用业务写入",
    async (mode) => {
      process.env.CONTRACT_CUTOVER_MODE = mode;

      const response = await fetch(
        `${await app!.getUrl()}/projects/project-1/contract-takeovers/takeover-1/confirmation`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ currentPassword: "not-a-real-password" })
        }
      );

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        statusCode: 410,
        code: "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
      });
      expect(takeoverWrites.confirm).not.toHaveBeenCalled();
    }
  );

  it.each(["release-a", "maintenance", "release-b-maintenance", "release-b"])(
    "在 %s 下继续保留历史接管详情读取",
    async (mode) => {
      process.env.CONTRACT_CUTOVER_MODE = mode;

      const response = await fetch(
        `${await app!.getUrl()}/projects/project-1/contract-takeovers/takeover-1`
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: "takeover-1" });
      expect(takeoverWrites.detail).toHaveBeenCalledWith(
        "project-1",
        "takeover-1",
        "takeover-tombstone-route-owner"
      );
    }
  );
});
