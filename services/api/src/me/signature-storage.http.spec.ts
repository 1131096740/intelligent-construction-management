import { Logger, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";

describe("signature storage rejection over real multipart HTTP", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");
  let app: INestApplication;
  const prisma = { $transaction: jest.fn() };
  const audit = { record: jest.fn() };
  let remoteFetch: jest.SpyInstance;
  let logs: jest.SpyInstance;
  let previous: NodeJS.ProcessEnv;
  const actualFetch = globalThis.fetch;

  beforeEach(async () => {
    previous = { ...process.env };
    Object.assign(process.env, { FILE_STORAGE_DRIVER: "cos", COS_BUCKET: "synthetic-private",
      COS_REGION: "ap-guangzhou", COS_SECRET_ID: "synthetic-id", COS_SECRET_KEY: "synthetic-key",
      FILE_DOWNLOAD_SECRET: "synthetic-download-key-at-least-32-characters" });
    prisma.$transaction.mockReset(); audit.record.mockReset();
    logs = jest.spyOn(Logger.prototype, "error").mockImplementation();
    remoteFetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "<Error><Code>UnavailableForLegalReasons</Code><Message>private provider message</Message></Error>",
      { status: 451 }));
    const files = new FileService(prisma as never, audit as never, new PrivateFileStorage());
    const me = new MeService(prisma as never, files, audit as never);
    const module = await Test.createTestingModule({ controllers: [MeController],
      providers: [{ provide: MeService, useValue: me }] }).compile();
    app = module.createNestApplication({ logger: false });
    // Synthetic identity only; the real controller, multipart parser and storage chain run.
    app.use((req: { user: unknown }, _res: unknown, next: () => void) => {
      req.user = { id: "synthetic-project-manager", roleKeys: ["project_manager"] }; next();
    });
    await app.listen(0, "127.0.0.1");
  });
  afterEach(async () => {
    await app?.close(); remoteFetch?.mockRestore(); logs?.mockRestore();
    process.env = previous;
  });

  it("explains rejection without registering or deleting a rejected upload", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "synthetic.png");
    const response = await actualFetch(await app.getUrl() + "/me/signature/canvas", { method: "POST", body: form });
    const result = await response.json();
    expect(response.status).toBe(503);
    expect(result.message).toBe("资料存储服务当前受限，暂时无法上传。请联系管理员检查服务状态，恢复后重试。");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(remoteFetch).toHaveBeenCalledTimes(1);
    expect(remoteFetch.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.stringify(result)).not.toMatch(/private provider|synthetic-key|UnavailableForLegalReasons/);
  });

  it("reports missing or invalid canvas files before calling storage", async () => {
    for (const bytes of [null, Buffer.from("not a PNG")]) {
      const form = new FormData();
      if (bytes) form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "invalid.png");
      const response = await actualFetch(await app.getUrl() + "/me/signature/canvas", { method: "POST", body: form });
      expect(response.status).toBe(400);
      expect(remoteFetch).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });
});
