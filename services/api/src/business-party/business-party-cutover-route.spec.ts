import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { BusinessPartyController } from "./business-party.controller";
import { BusinessPartyService } from "./business-party.service";

describe("合同工作台切换：普通 party 写入永久 tombstone", () => {
  let app: INestApplication | undefined;
  const previousMode = process.env.CONTRACT_CUTOVER_MODE;
  const partyWrites = {
    addContractParty: jest.fn(),
    updateContractPartyRole: jest.fn(),
    removeContractParty: jest.fn()
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BusinessPartyController],
      providers: [{ provide: BusinessPartyService, useValue: partyWrites }]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new ContractCutoverGuard(new Reflector()));
    app.use((
      request: { user?: unknown },
      _response: unknown,
      next: () => void
    ) => {
      request.user = {
        id: "party-tombstone-route-owner",
        name: "普通 party 写入 tombstone 路由测试用户",
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
    ["release-a", "POST", "/contract-workbench/version-1/parties"],
    ["maintenance", "PATCH", "/contract-workbench/version-1/parties/party-1"],
    ["release-b-maintenance", "DELETE", "/contract-workbench/version-1/parties/party-1"],
    ["release-b", "POST", "/contract-workbench/version-1/parties"]
  ])(
    "在 %s 下普通 party 写入永久返回 410 且不调用业务写入（%s %s）",
    async (mode, method, path) => {
      process.env.CONTRACT_CUTOVER_MODE = mode;

      const response = await fetch(`${await app!.getUrl()}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: "{}"
      });

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        statusCode: 410,
        code: "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
      });
      expect(partyWrites.addContractParty).not.toHaveBeenCalled();
      expect(partyWrites.updateContractPartyRole).not.toHaveBeenCalled();
      expect(partyWrites.removeContractParty).not.toHaveBeenCalled();
    }
  );
});
