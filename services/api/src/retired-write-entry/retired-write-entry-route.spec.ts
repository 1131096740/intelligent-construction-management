import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { ContractController } from "../contract/contract.controller";
import { PaymentController } from "../payment/payment.controller";
import { SettlementController } from "../settlement/settlement.controller";
import { ApprovalProgressController } from "../approval/approval-progress.controller";
import { ApprovalProgressService } from "../approval/approval-progress.service";
import { RetiredWriteEntryGuard } from "./retired-write-entry.guard";

describe("POL-19E old write entry public HTTP tombstone", () => {
  let app: INestApplication | undefined;
  const auth = {
    login: jest.fn().mockResolvedValue({ active: true }),
    wxLogin: jest.fn().mockResolvedValue({ legacy: true })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController]
    })
      .useMocker((token) => (token === AuthService ? auth : {}))
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new RetiredWriteEntryGuard());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 410 before the retired WeChat login write can run", async () => {
    const response = await fetch(`${await app!.getUrl()}/auth/wx-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "legacy-code" })
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      statusCode: 410,
      code: "OLD_WRITE_ENTRY_RETIRED",
      message: "该旧办理入口已停止使用，请返回当前业务页面办理"
    });
    expect(auth.wxLogin).not.toHaveBeenCalled();
  });

  it("does not change the current password login entry", async () => {
    const response = await fetch(`${await app!.getUrl()}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "13800000000", password: "not-real" })
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ active: true });
    expect(auth.login).toHaveBeenCalledTimes(1);
  });
});


describe("retired approval reminders public HTTP tombstones", () => {
  let app: INestApplication | undefined;
  const progress = {
    remindBusiness: jest.fn().mockResolvedValue({ legacy: true }),
    remind: jest.fn().mockResolvedValue({ accepted: true })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractController, PaymentController, SettlementController, ApprovalProgressController]
    }).useMocker(token => token === ApprovalProgressService ? progress : {}).compile();
    app = moduleRef.createNestApplication();
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: "local-reviewer" };
      next();
    });
    app.useGlobalGuards(new RetiredWriteEntryGuard());
    await app.listen(0, "127.0.0.1");
  });
  afterAll(async () => { if (app) await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it.each(["contracts", "payments", "settlements"])("rejects the old %s reminder before any reminder service executes", async domain => {
    const response = await fetch(`${await app!.getUrl()}/${domain}/local-item/approval-reminder`, { method: "POST" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED", statusCode: 410 });
    expect(progress.remindBusiness).not.toHaveBeenCalled();
    expect(progress.remind).not.toHaveBeenCalled();
  });

  it("preserves the current unified reminder route and its confirmation token", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const reminderToken = "a".repeat(64);
    const response = await fetch(`${await app!.getUrl()}/approval-progress/local-flow/remind`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, reminderToken })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ accepted: true });
    expect(progress.remind).toHaveBeenCalledWith("local-flow", "local-reviewer", requestId, reminderToken);
    expect(progress.remindBusiness).not.toHaveBeenCalled();
  });
});
