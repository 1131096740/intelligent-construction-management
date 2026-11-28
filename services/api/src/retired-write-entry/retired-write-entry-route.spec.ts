import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { ContractController } from "../contract/contract.controller";
import { ContractService } from "../contract/contract.service";
import { PaymentController } from "../payment/payment.controller";
import { SettlementController } from "../settlement/settlement.controller";
import { SettlementService } from "../settlement/settlement.service";
import { SettlementArchiveNotificationService } from "../settlement/settlement-archive-notification.service";
import { SignedContractSettlementController } from "../settlement/signed-contract-settlement.controller";
import { SignedContractSettlementService } from "../settlement/signed-contract-settlement.service";
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


describe("retired contract changes and approval reminders", () => {
  let app: INestApplication | undefined;
  const contract = { createChangeDraft: jest.fn().mockResolvedValue({ legacy: true }) };
  const legacySettlement = {
    reviewApproval: jest.fn().mockResolvedValue({ legacy: true }),
    withdrawApproval: jest.fn().mockResolvedValue({ legacy: true }),
    transferApproval: jest.fn().mockResolvedValue({ legacy: true }),
    delegateApproval: jest.fn().mockResolvedValue({ legacy: true }),
    confirmArchiveFile: jest.fn().mockResolvedValue({ preserved: true })
  };
  const signedSettlement = { review: jest.fn().mockResolvedValue({ current: true }) };
  const archiveNotifications = { retry: jest.fn().mockResolvedValue({ archiveNotification: true }) };
  const progress = {
    remindBusiness: jest.fn().mockResolvedValue({ legacy: true }),
    remind: jest.fn().mockResolvedValue({ accepted: true })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractController, PaymentController, SettlementController, SignedContractSettlementController, ApprovalProgressController]
    }).useMocker(token => {
      if (token === ContractService) return contract;
      if (token === SettlementService) return legacySettlement;
      if (token === SignedContractSettlementService) return signedSettlement;
      if (token === SettlementArchiveNotificationService) return archiveNotifications;
      if (token === ApprovalProgressService) return progress;
      return {};
    }).compile();
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

  it("returns 410 for the old contract change draft endpoint", async () => {
    const response = await fetch(`${await app!.getUrl()}/contracts/local-version/change-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeReason: "旧版草稿请求", changeDirection: "unchanged", changeAmountCents: "0" })
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED", statusCode: 410 });
    expect(contract.createChangeDraft).not.toHaveBeenCalled();
  });

  it.each(["contracts", "payments", "settlements"])("rejects the old %s reminder before any reminder service executes", async domain => {
    const response = await fetch(`${await app!.getUrl()}/${domain}/local-item/approval-reminder`, { method: "POST" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED", statusCode: 410 });
    expect(progress.remindBusiness).not.toHaveBeenCalled();
    expect(progress.remind).not.toHaveBeenCalled();
  });

  it.each([
    ["approval", "reviewApproval", { decision: "approve" }],
    ["approval-withdrawal", "withdrawApproval", {}],
    ["approval-transfer", "transferApproval", { toUserId: "recipient" }],
    ["approval-delegation", "delegateApproval", { toUserId: "recipient" }]
  ] as const)("returns 410 for the old settlement %s entry before invoking its service", async (suffix, handler, body) => {
    const response = await fetch(`${await app!.getUrl()}/settlements/local-item/${suffix}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED", statusCode: 410 });
    expect(legacySettlement[handler]).not.toHaveBeenCalled();
  });

  it("preserves current signed settlement review and the separate historical archive confirmation and notice retry", async () => {
    const root = await app!.getUrl();
    const post = (route: string, body: object) => fetch(root + route, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const signed = await post("/projects/project-1/signed-contract-settlements/signed-item/review", {
      revision: 2, decision: "confirm", confirmationPassword: "current"
    });
    const archive = await post("/settlements/local-item/archive-confirmation", {
      archiveFileId: "historical-file", confirmationPassword: "current"
    });
    const retry = await post("/settlements/local-item/duty-sms/retry", { attemptId: "archive-attempt" });

    expect(signed.status).toBe(201);
    expect(signedSettlement.review).toHaveBeenCalledWith("project-1", "signed-item", "local-reviewer", 2, "confirm", undefined, "current");
    expect(archive.status).toBe(201);
    expect(legacySettlement.confirmArchiveFile).toHaveBeenCalledTimes(1);
    expect(retry.status).toBe(201);
    expect(archiveNotifications.retry).toHaveBeenCalledWith("local-item", "local-reviewer", "archive-attempt");
  });

  it("preserves the current unified reminder route and its confirmation token", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const reminderToken = "a".repeat(64);
    const response = await fetch(`${await app!.getUrl()}/approval-progress/local-flow/remind`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, reminderToken })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ accepted: true });
    expect(progress.remind).toHaveBeenCalledWith("local-flow", "local-reviewer", requestId, reminderToken, undefined);
    expect(progress.remindBusiness).not.toHaveBeenCalled();
  });
});
