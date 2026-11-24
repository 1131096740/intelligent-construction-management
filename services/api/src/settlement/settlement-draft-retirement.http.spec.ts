import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { SettlementDraftController } from "./settlement-draft.controller";
import { SettlementDraftService } from "./settlement-draft.service";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { SettlementCounterpartyDocumentService } from "./settlement-counterparty-document.service";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";
import { SettlementLineAttachmentService } from "./settlement-line-attachment.service";
import { SettlementImportController } from "./settlement-import.controller";
import { SettlementImportService } from "./settlement-import.service";

describe("历史结算草稿 HTTP 入口", () => {
  let app: INestApplication;
  const historicalDraft = { id: "draft-1", projectId: "project-1", status: "abandoned", revision: 3 };
  const drafts = {
    create: jest.fn(),
    copyAbandoned: jest.fn(),
    update: jest.fn(),
    abandon: jest.fn(),
    list: jest.fn().mockResolvedValue([historicalDraft]),
    get: jest.fn().mockResolvedValue({ ...historicalDraft, availableActions: [{ key: "delete_pristine_draft" }] }),
    finalPreparation: jest.fn().mockResolvedValue({ draftId: "draft-1", revision: 3 })
  };
  const submissions = { submitDraft: jest.fn() };
  const imports = { previewImport: jest.fn(), applyImport: jest.fn() };
  const counterparty = { link: jest.fn() };
  const frozen = { generate: jest.fn() };
  const attachments = {
    attachToDraftLine: jest.fn(),
    invalidateDraftAttachment: jest.fn(),
    listDraftAttachments: jest.fn().mockResolvedValue([{ id: "file-1" }])
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SettlementDraftController, SettlementImportController],
      providers: [
        { provide: SettlementDraftService, useValue: drafts },
        { provide: SettlementImportService, useValue: imports },
        { provide: SettlementSubmissionService, useValue: submissions },
        { provide: SettlementCounterpartyDocumentService, useValue: counterparty },
        { provide: SettlementFrozenDocumentService, useValue: frozen },
        { provide: SettlementLineAttachmentService, useValue: attachments }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: "contract-handler" };
      next();
    });
    app.useGlobalGuards(new RetiredWriteEntryGuard());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => { await app?.close(); });

  async function request(path: string, method = "GET") {
    return fetch(`${await app.getUrl()}/projects/project-1/settlement-drafts${path}`, {
      method,
      ...(method === "GET" ? {} : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 3, action: "delete_pristine_draft" })
      })
    });
  }

  it.each([
    ["POST", "", drafts.create],
    ["POST", "/draft-1/copies", drafts.copyAbandoned],
    ["PATCH", "/draft-1", drafts.update],
    ["POST", "/draft-1/approval-submission", submissions.submitDraft],
    ["POST", "/draft-1/abandonment", drafts.abandon],
    ["POST", "/draft-1/counterparty-signed-documents", counterparty.link],
    ["POST", "/draft-1/frozen-document", frozen.generate],
    ["POST", "/draft-1/lines/line-1/attachments", attachments.attachToDraftLine],
    ["POST", "/draft-1/line-attachments/file-1/invalidation", attachments.invalidateDraftAttachment],
    ["POST", "/files", undefined]
  ])("拒绝旧草稿写入 %s %s", async (method, path, mutate) => {
    const response = await request(path, method);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED" });
    if (mutate) expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    ["/contract-versions/contract-version-1/imports/preview", imports.previewImport],
    ["/projects/project-1/imports/import-1/apply", imports.applyImport]
  ])("禁止旧结算导入落库 %s", async (path, mutate) => {
    const response = await fetch(`${await app.getUrl()}/settlement-workbench${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(response.status).toBe(410);
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    ["", [historicalDraft]],
    ["/draft-1", { ...historicalDraft, availableActions: [] }],
    ["/draft-1/final-preparation", { draftId: "draft-1", revision: 3 }],
    ["/draft-1/line-attachments", [{ id: "file-1" }]],
    ["/capability", { projectId: "project-1", availableActions: [] }]
  ])("保留历史查询 %s", async (path, expected) => {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  });
});
