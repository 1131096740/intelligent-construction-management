import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PDFDocument } from "pdf-lib";
import { ContractTakeoverController } from "../contract-takeover/contract-takeover.controller";
import { createApiValidationPipe } from "../validation/api-validation";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService, PrivateFileStorage } from "./file.service";

describe("private upload validation through historical takeover HTTP", () => {
  let app: INestApplication;
  let pdf: Uint8Array<ArrayBuffer>;
  let actorId = "test-contract-staff";
  const storage = { write: jest.fn(), delete: jest.fn(), bucketName: jest.fn(() => "test-private") };
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => data);
  const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ fileObject: { create } }));
  const record = jest.fn();
  const priorLimit = process.env.FILE_UPLOAD_MAX_BYTES;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    document.addPage();
    pdf = new Uint8Array(await document.save());
    const fileService = new FileService(
      { $transaction: transaction } as unknown as PrismaService,
      { record } as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const dependencies: Array<new (...args: never[]) => unknown> = Reflect.getMetadata("design:paramtypes", ContractTakeoverController);
    const module = await Test.createTestingModule({
      controllers: [ContractTakeoverController],
      providers: dependencies.map(provide => ({ provide, useValue: provide === FileService ? fileService : {} }))
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => {
      request.user = { id: actorId };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });
  beforeEach(() => {
    actorId = "test-contract-staff";
    delete process.env.FILE_UPLOAD_MAX_BYTES;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    if (priorLimit === undefined) delete process.env.FILE_UPLOAD_MAX_BYTES;
    else process.env.FILE_UPLOAD_MAX_BYTES = priorLimit;
  });
  async function upload(bytes: string | Uint8Array<ArrayBuffer>, name = "验收.pdf") {
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: "application/pdf" }), name);
    const response = await fetch(`${await app.getUrl()}/projects/test-project/contract-takeovers/files`, { method: "POST", body });
    return { status: response.status, body: await response.json() as unknown };
  }

  it.each([
    { name: "empty file", bytes: "", filename: "验收.pdf", message: "上传文件为空，请重新选择资料文件" },
    { name: "unsupported extension", bytes: "%PDF-1.4", filename: "验收.exe", message: "文件格式不支持，请上传 PDF、Word、Excel 或图片资料" },
    { name: "over configured limit", bytes: "%PDF-1.4", filename: "验收.pdf", limit: "1", message: "上传文件超过系统限制，请压缩后重新上传或联系管理员" },
    { name: "missing actor", bytes: "%PDF-1.4", filename: "验收.pdf", actor: "", message: "上传人信息缺失，请重新登录后再上传资料" }
  ])("returns an actionable 400 for $name without storage or audit writes", async ({ bytes, filename, message, limit, actor }) => {
    if (limit !== undefined) process.env.FILE_UPLOAD_MAX_BYTES = limit;
    if (actor !== undefined) actorId = actor;
    expect(await upload(bytes, filename)).toMatchObject({ status: 400, body: { message } });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("preserves successful file registration and its audit", async () => {
    expect(await upload(pdf)).toMatchObject({ status: 201, body: { originalName: "验收.pdf", sizeBytes: pdf.length } });
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "file.upload", actorUserId: actorId }));
  });
});
