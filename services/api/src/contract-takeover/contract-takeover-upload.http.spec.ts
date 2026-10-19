import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PDFDocument } from "pdf-lib";
import { createApiValidationPipe } from "../validation/api-validation";
import { ContractTakeoverController } from "./contract-takeover.controller";

describe("historical takeover multipart HTTP upload", () => {
  let app: INestApplication;
  let pdf: Uint8Array<ArrayBuffer>;
  const uploadPrivateFile = jest.fn().mockResolvedValue({ id: "uploaded-evidence" });
  beforeAll(async () => {
    const document = await PDFDocument.create();
    document.addPage();
    pdf = new Uint8Array(await document.save());
    await PDFDocument.load(pdf);
    const dependencies: Array<new (...args: never[]) => unknown> =
      Reflect.getMetadata("design:paramtypes", ContractTakeoverController);
    const module = await Test.createTestingModule({
      controllers: [ContractTakeoverController],
      providers: dependencies.map((provide) => ({
        provide, useValue: provide.name === "FileService" ? { uploadPrivateFile } : {}
      }))
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => {
      request.user = { id: "test-contract-staff" };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => uploadPrivateFile.mockClear());

  async function upload(fields: Record<string, string> = {}, includeFile = true) {
    const body = new FormData();
    if (includeFile) body.append("file", new Blob([pdf], { type: "application/pdf" }), "历史合同.pdf");
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    const response = await fetch(`${await app.getUrl()}/projects/test-project/contract-takeovers/files`, { method: "POST", body });
    return { status: response.status, body: await response.json() as unknown };
  }

  it.each([undefined, "a43073f9-9731-4d71-9498-b9727344dbd4"])("accepts valid PDF with optional retry key %s", async (key) => {
    expect(await upload(key ? { idempotencyKey: key } : {})).toEqual({ status: 201, body: { id: "uploaded-evidence" } });
    expect(uploadPrivateFile).toHaveBeenCalledWith(expect.objectContaining({
      originalName: "历史合同.pdf", mimeType: "application/pdf", sizeBytes: pdf.length,
      uploadedByUserId: "test-contract-staff", buffer: Buffer.from(pdf),
      ...(key ? { idempotencyKey: key } : {})
    }));
  });

  it.each<Record<string, string>>([{ idempotencyKey: "not-a-uuid" }, { uploadedByUserId: "another-user" }])("rejects invalid metadata before storage", async (fields) => {
    expect((await upload(fields)).status).toBe(400);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("returns an actionable missing-file error without storage", async () => {
    expect(await upload({}, false)).toMatchObject({ status: 400, body: { message: "请选择要上传的资料文件" } });
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });
});
