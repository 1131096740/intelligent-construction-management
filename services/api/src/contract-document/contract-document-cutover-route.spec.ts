import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractService } from "../contract/contract.service";
import { ContractReadService } from "../contract/contract-read.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { ContractController } from "../contract/contract.controller";
import { ContractDocumentController } from "./contract-document.controller";
import { ContractDocumentService } from "./contract-document.service";
import { ContractNegotiationService } from "./contract-negotiation.service";

describe("合同工作台切换：#13 磋商与旧审批写接口退役（release-b 410、读接口正常）", () => {
  let app: INestApplication | undefined;
  const previousMode = process.env.CONTRACT_CUTOVER_MODE;

  beforeAll(async () => {
    const negotiations = {
      listRounds: jest.fn().mockResolvedValue([]),
      listOfflineRevisionHistory: jest.fn().mockResolvedValue([])
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractDocumentController, ContractController],
      providers: [
        { provide: ContractService, useValue: {} },
        { provide: ContractReadService, useValue: {} },
        { provide: ContractWorkbenchService, useValue: {} },
        { provide: ProjectVisibilityService, useValue: {} },
        { provide: ContractDocumentService, useValue: {} },
        { provide: ContractNegotiationService, useValue: negotiations }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new ContractCutoverGuard(new Reflector()));
    app.use((
      request: { user?: unknown; headers: Record<string, string | string[] | undefined> },
      _response: unknown,
      next: () => void
    ) => {
      request.user = {
        id: "cutover-route-owner",
        name: "合同工作台切换路由测试用户",
        phone: null
      };
      next();
    });
    await app.listen(0, "127.0.0.1");
    process.env.CONTRACT_CUTOVER_MODE = "release-b-maintenance";
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.CONTRACT_CUTOVER_MODE;
    else process.env.CONTRACT_CUTOVER_MODE = previousMode;
    if (app) await app.close();
  });

  it.each([
    ["POST /contract-workbench/:id/offline-revisions", "/contract-workbench/version-1/offline-revisions"],
    ["POST /contract-workbench/:id/negotiation-rounds", "/contract-workbench/version-1/negotiation-rounds"],
    ["POST /contract-negotiation-rounds/:id/close", "/contract-negotiation-rounds/round-1/close"],
    ["POST /contract-document-differences/:id/disposition", "/contract-document-differences/diff-1/disposition"],
    ["POST /contract-offline-revisions/:id/retry", "/contract-offline-revisions/rev-1/retry"],
    ["POST /contracts/:id/formal-files/approval", "/contracts/version-1/formal-files/approval"]
  ])("在 release-b-maintenance 下退役写接口返回 410（%s）", async (_label, path) => {
    const response = await fetch(`${await app!.getUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      statusCode: 410,
      code: "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
    });
  });

  it("读接口在 release-b-maintenance 下保持只读可查", async () => {
    const base = await app!.getUrl();
    const rounds = await fetch(`${base}/contract-workbench/version-1/negotiation-rounds`);
    expect(rounds.status).toBe(200);
    expect(await rounds.json()).toEqual([]);
    const revisions = await fetch(`${base}/contract-workbench/version-1/offline-revisions`);
    expect(revisions.status).toBe(200);
    expect(await revisions.json()).toEqual([]);
  });
});
