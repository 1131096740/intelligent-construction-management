import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { ContractWorkbenchController } from "./contract-workbench.controller";
import { ContractWorkbenchService } from "./contract-workbench.service";

describe("合同工作台切换：旧 checkpoint 写入永久 tombstone", () => {
  let app: INestApplication | undefined;
  const previousMode = process.env.CONTRACT_CUTOVER_MODE;
  const checkpointWrites = {
    createCheckpoint: jest.fn(),
    restoreCheckpoint: jest.fn()
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractWorkbenchController],
      providers: [{ provide: ContractWorkbenchService, useValue: checkpointWrites }]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new ContractCutoverGuard(new Reflector()));
    app.use((
      request: { user?: unknown },
      _response: unknown,
      next: () => void
    ) => {
      request.user = {
        id: "checkpoint-tombstone-route-owner",
        name: "旧 checkpoint 写入 tombstone 路由测试用户",
        phone: null
      };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.CONTRACT_CUTOVER_MODE;
    else process.env.CONTRACT_CUTOVER_MODE = previousMode;
    if (app) await app.close();
  });

  it.each([
    ["release-a", "POST", "/contract-workbench/version-1/checkpoints"],
    [
      "release-a",
      "POST",
      "/contract-workbench/version-1/checkpoints/checkpoint-1/restore"
    ],
    ["maintenance", "POST", "/contract-workbench/version-1/checkpoints"],
    [
      "maintenance",
      "POST",
      "/contract-workbench/version-1/checkpoints/checkpoint-1/restore"
    ],
    [
      "release-b-maintenance",
      "POST",
      "/contract-workbench/version-1/checkpoints"
    ],
    [
      "release-b-maintenance",
      "POST",
      "/contract-workbench/version-1/checkpoints/checkpoint-1/restore"
    ],
    ["release-b", "POST", "/contract-workbench/version-1/checkpoints"],
    [
      "release-b",
      "POST",
      "/contract-workbench/version-1/checkpoints/checkpoint-1/restore"
    ]
  ])(
    "在 %s 下旧 checkpoint 写入永久返回 410 且不调用业务写入（%s %s）",
    async (mode, method, path) => {
      process.env.CONTRACT_CUTOVER_MODE = mode;

      const response = await fetch(`${await app!.getUrl()}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "旧 checkpoint" })
      });

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        statusCode: 410,
        code: "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
      });
      expect(checkpointWrites.createCheckpoint).not.toHaveBeenCalled();
      expect(checkpointWrites.restoreCheckpoint).not.toHaveBeenCalled();
    }
  );
});
