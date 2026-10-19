import "reflect-metadata";
import { ForbiddenException, type Type, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PDFDocument } from "pdf-lib";
import { createApiValidationPipe } from "../validation/api-validation";
import { OperatingTakeoverController } from "../operating-takeover/operating-takeover.controller";
import { PayableRegistryController } from "../payable-registry/payable-registry.controller";
import { PaymentController } from "../payment/payment.controller";
import { ProjectController } from "../project/project.controller";
import { ProjectExpenseController } from "../project-expense/project-expense.controller";
import { SettlementDraftController } from "../settlement/settlement-draft.controller";
import { SettlementController } from "../settlement/settlement.controller";
import { SpotProcurementPaymentController } from "../spot-procurement/spot-procurement-payment.controller";
import { SpotProcurementReceiptController } from "../spot-procurement/spot-procurement-receipt.controller";

const cases: Array<{ controller: Type<unknown>; route: string; fields?: Record<string, string> }> = [
  { controller: OperatingTakeoverController, route: "/projects/:projectId/operating-takeovers/files" },
  { controller: PayableRegistryController, route: "/payable-settlements/inter-entity-relationships/:relationshipEntryId/evidence" },
  { controller: PaymentController, route: "/payments/:paymentId/execution-voucher-file-uploads" },
  { controller: PaymentController, route: "/payments/:paymentId/pdf-archive-file-uploads" },
  { controller: ProjectController, route: "/projects/:projectId/affiliate-company-contracts/file-uploads" },
  { controller: ProjectController, route: "/projects/:projectId/upstream-fund-facts/file-uploads" },
  { controller: ProjectController, route: "/projects/:projectId/affiliate-contract-facts/file-uploads" },
  { controller: ProjectController, route: "/projects/:projectId/affiliate-settlement-facts/file-uploads" },
  { controller: ProjectController, route: "/projects/:projectId/affiliate-payment-facts/file-uploads" },
  { controller: ProjectController, route: "/projects/:projectId/affiliate-business-facts/:factId/evidence-file-uploads", fields: { businessType: "affiliate_contract" } },
  { controller: ProjectController, route: "/projects/:projectId/financing-quotas/file-uploads" },
  { controller: ProjectExpenseController, route: "/projects/:projectId/expense-requests/file-uploads" },
  { controller: ProjectExpenseController, route: "/projects/:projectId/expense-requests/:expenseRequestId/execution-voucher-file-uploads" },
  { controller: SettlementDraftController, route: "/projects/:projectId/settlement-drafts/files" },
  { controller: SettlementController, route: "/settlements/:settlementId/recovery-file-uploads" },
  { controller: SettlementController, route: "/settlements/:settlementId/archive-file-uploads" },
  { controller: SpotProcurementPaymentController, route: "/spot-procurement-payments/:paymentId/draft-file-uploads" },
  { controller: SpotProcurementReceiptController, route: "/spot-procurements/:procurementId/invoice-file-uploads" }
];
// Exercise the real multipart parser, controller and global DTO pipe. Collaborators
// isolate storage/business operations; their existing action denials must still run.
describe.each(cases)("multipart $route", ({ controller, route, fields }) => {
  let app: INestApplication;
  let pdf: Uint8Array<ArrayBuffer>;
  let denied = false;
  const upload = jest.fn().mockResolvedValue({ id: "uploaded-file" });
  const allowed = async () => { if (denied) throw new ForbiddenException("当前操作不可用"); };
  beforeAll(async () => {
    const doc = await PDFDocument.create(); doc.addPage(); pdf = new Uint8Array(await doc.save());
    const dependencies: Array<new (...args: never[]) => unknown> = Reflect.getMetadata("design:paramtypes", controller);
    const collaborator = {
      uploadPrivateFile: upload,
      uploadSourceFile: async (_project: string, _actor: string, input: unknown) => { await allowed(); return upload(input); },
      visibleProjectIds: async () => ["test-id"],
      getDetail: async () => { await allowed(); return { availableActionKeys: ["record_execution", "archive_pdf", "record_recovery", "upload_archive"] }; },
      getApprovalDetail: async () => { await allowed(); return { availableActions: [{ key: "record_execution", enabled: true }] }; },
      assertEvidenceUploadAllowed: allowed, assertInterEntityRelationshipEvidenceUpload: allowed,
      assertPaymentActionAvailable: allowed, assertActionAvailable: allowed,
      createInterEntityRelationshipEvidenceClaim: async (_actor: string, _entry: string, id: string) => ({ id })
    };
    const module = await Test.createTestingModule({ controllers: [controller], providers: dependencies.map(provide => ({ provide, useValue: collaborator })) }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => { request.user = { id: "test-actor" }; next(); });
    await app.listen(0, "127.0.0.1");
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { denied = false; upload.mockClear(); });
  async function send(metadata: Record<string,string> = {}, includeFile = true) {
    const body = new FormData();
    if (includeFile) body.append("file", new Blob([pdf], { type: "application/pdf" }), "历史资料.pdf");
    for (const [key,value] of Object.entries({ ...fields, ...metadata })) body.append(key,value);
    const response = await fetch(`${await app.getUrl()}${route.replace(/:[A-Za-z0-9_]+/g, "test-id")}`, { method: "POST", body });
    return { status: response.status, body: await response.json() as unknown };
  }
  it.each<Record<string, string>>([{}, { idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4" }])("accepts a PDF with metadata %j", async metadata => {
    expect(await send(metadata)).toEqual({ status: 201, body: { id: "uploaded-file" } });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ originalName: "历史资料.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf), ...metadata }));
  });
  it.each<Record<string, string>>([{ idempotencyKey: "invalid" }, { uploadedByUserId: "other" }])("rejects malformed or injected fields %j", async metadata => {
    expect((await send(metadata)).status).toBe(400); expect(upload).not.toHaveBeenCalled();
  });
  it("reports missing file without storage", async () => { expect((await send({}, false)).status).toBe(400); expect(upload).not.toHaveBeenCalled(); });
  if (!/affiliate-company-contracts|upstream-fund-facts|affiliate-contract-facts|affiliate-settlement-facts|affiliate-payment-facts|financing-quotas|settlement-drafts\/files|expense-requests\/file-uploads/.test(route)) {
    it("preserves the business denial before storage", async () => { denied = true; expect((await send()).status).toBe(403); expect(upload).not.toHaveBeenCalled(); });
  }
});
