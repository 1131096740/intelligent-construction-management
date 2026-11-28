import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AuthService } from "../auth/auth.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { WageStatementController } from "./wage-statement.controller";
import { WageStatementService } from "./wage-statement.service";

describe("工资承担历史入口", () => {
  let app: INestApplication;
  const wages = {
    createApprovedSource: jest.fn(),
    createDraft: jest.fn(),
    createRevision: jest.fn(),
    updateDraft: jest.fn(),
    submit: jest.fn(),
    returnForReview: jest.fn(),
    confirm: jest.fn(),
    listWorkbench: jest.fn().mockResolvedValue({ items: [{ statementId: "statement-1" }] }),
    readSummary: jest.fn().mockResolvedValue({ revision: 2, statusLabel: "已确认" }),
    readImportPreview: jest.fn().mockResolvedValue({ sourceStatusLabel: "已导入" }),
    createSensitiveExportTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/wage-history/download" })
  };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WageStatementController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: WageStatementService, useValue: wages }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: "finance-reviewer" };
      next();
    });
    app.useGlobalGuards(new RetiredWriteEntryGuard());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => { await app.close(); });

  it.each([
    ["approved-sources", "createApprovedSource"],
    ["drafts", "createDraft"],
    ["statement-1/revisions", "createRevision"],
    ["statement-1/draft", "updateDraft"],
    ["statement-1/submit", "submit"],
    ["statement-1/return", "returnForReview"],
    ["statement-1/confirm", "confirm"]
  ] as const)("禁止通过旧地址 %s 改写工资记录", async (path, handler) => {
    const response = await fetch(`${await app.getUrl()}/wage-statements/${path}`, { method: "POST" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED" });
    expect(wages[handler]).not.toHaveBeenCalled();
  });

  it.each([
    ["workbench", { items: [{ statementId: "statement-1" }] }],
    ["statement-1/summary", { revision: 2, statusLabel: "已确认" }],
    ["statement-1/import-preview", { sourceStatusLabel: "已导入" }]
  ])("仍可读取 %s 的历史数据", async (path, expected) => {
    const response = await fetch(`${await app.getUrl()}/wage-statements/${path}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  });

  it("历史敏感导出仍需重新确认密码并提供审计原因", async () => {
    const url = `${await app.getUrl()}/wage-statements/statement-1/sensitive-export-ticket`;
    const request = (body: object) => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    expect((await request({ confirmationPassword: "local-password" })).status).toBe(400);
    expect(wages.createSensitiveExportTicket).not.toHaveBeenCalled();

    const response = await request({ confirmationPassword: "local-password", downloadReason: "核对历史归档" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ downloadUrl: "/files/wage-history/download" });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-reviewer", "local-password");
    expect(wages.createSensitiveExportTicket).toHaveBeenCalledWith("finance-reviewer", "statement-1", "核对历史归档");
  });
});
