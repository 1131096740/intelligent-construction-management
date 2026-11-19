import { AuditService } from "../audit/audit.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { FileService } from "../file/file.service";
import { PrismaService } from "./prisma.service";
import { withTask12DefaultDocumentScope } from "./task12-default-document-scope";

function fixture() {
  const client = Object.create(PrismaService.prototype) as PrismaService;
  const identity = { database: "jg_task01_0123456789abcdef0123456789abcdef", databaseOid: "16000", namespaceOid: "2200", ownerOid: "10", roleOid: "17000", role: "jg_fixture_app_0123456789abcdef01234567", sessionRole: "jg_fixture_app_0123456789abcdef01234567", pid: 1234, start: "2026-11-18T00:00:00.000000Z", clientAddress: "127.0.0.1", serverAddress: "127.0.0.1", serverPort: 55555, tls: true, restricted: true };
  Object.defineProperty(client, "$queryRaw", { value: jest.fn(async () => [identity]) });
  Object.defineProperty(client, "$disconnect", { value: jest.fn(async () => undefined) });
  const instance = <T extends object>(type: { prototype: T }, props: object) => Object.assign(Object.create(type.prototype), props) as T;
  const audit = instance(AuditService, { prisma: client });
  const files = instance(FileService, { prisma: client, audit });
  const template = instance(LayoutTemplateService, { prisma: client, audit, files });
  const queue = instance(ContractDocumentService, { prisma: client, audit, files });
  const worker = instance(ContractDocumentProcessor, { prisma: client, audit, files });
  return { client, identity, audit, files, template, queue, worker,
    expected: { database: identity.database, databaseOid: identity.databaseOid, namespaceOid: identity.namespaceOid, roleOid: identity.roleOid, role: identity.role, serverPort: identity.serverPort } };
}

describe("对上回退之外的文书真实默认同身份装配", () => {
  it("仅向调用方交付原始 Nest 文书实例并在前后核验单个受限身份", async () => {
    const f = fixture();
    await expect(withTask12DefaultDocumentScope(f, f.expected, async value => {
      expect(value.worker).toBe(f.worker); expect(value.queue).toBe(f.queue); expect(value.template).toBe(f.template); return "ok";
    })).resolves.toBe("ok");
    expect(f.client.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it.each(["owner", "role", "sessionRole", "privileged", "tls", "port", "otherClient"] as const)("身份或 Nest 绑定异常 %s 时在业务前拒绝", async mode => {
    const f = fixture();
    if (mode === "owner") f.identity.roleOid = "10";
    if (mode === "role") f.identity.role = "other";
    if (mode === "sessionRole") f.identity.sessionRole = "other";
    if (mode === "privileged") f.identity.restricted = false;
    if (mode === "tls") f.identity.tls = false;
    if (mode === "port") f.identity.serverPort++;
    if (mode === "otherClient") Object.assign(f.worker, { prisma: Object.create(PrismaService.prototype) });
    const run = jest.fn();
    await expect(withTask12DefaultDocumentScope(f, f.expected, run)).rejects.toMatchObject({ code: expect.any(String) });
    expect(run).not.toHaveBeenCalled();
  });
  it("使用中连接身份漂移时不得报告通过", async () => {
    const f = fixture();
    await expect(withTask12DefaultDocumentScope(f, f.expected, async () => { f.identity.sessionRole = "other"; return "ok"; })).rejects.toMatchObject({ code: expect.any(String) });
  });
});

it("Nest 实际解析的模板、入队、worker 和文件服务共享同一 Prisma provider（合成身份）", async () => {
  const { Test } = await import("@nestjs/testing");
  const { Task12GeneratedDocumentApplicationModule } = await import("./task12-generated-document-application.module");
  const f = fixture();
  const previous = process.env.FILE_DOWNLOAD_SECRET;
  process.env.FILE_DOWNLOAD_SECRET = "synthetic-download-secret-for-test-only";
  try {
    const moduleRef = await Test.createTestingModule({ imports: [Task12GeneratedDocumentApplicationModule] })
      .overrideProvider(PrismaService).useValue(f.client).compile();
    try {
      const providers = { client: moduleRef.get(PrismaService), audit: moduleRef.get(AuditService), files: moduleRef.get(FileService),
        template: moduleRef.get(LayoutTemplateService), queue: moduleRef.get(ContractDocumentService), worker: moduleRef.get(ContractDocumentProcessor) };
      await expect(withTask12DefaultDocumentScope(providers, f.expected, async value => value.client === f.client)).resolves.toBe(true);
    } finally { await moduleRef.close(); }
  } finally { if (previous === undefined) delete process.env.FILE_DOWNLOAD_SECRET; else process.env.FILE_DOWNLOAD_SECRET = previous; }
});

it("完整 AppModule 默认装配未替换 Prisma，文书组件共享实际 Nest 创建的客户端（不连接数据库）", async () => {
  const { Test } = await import("@nestjs/testing");
  const { AppModule } = await import("../app.module");
  const previousUrl = process.env.DATABASE_URL, previousSecret = process.env.FILE_DOWNLOAD_SECRET;
  process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:65534/synthetic";
  process.env.FILE_DOWNLOAD_SECRET = "synthetic-download-secret-for-test-only";
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const client = moduleRef.get(PrismaService), template = moduleRef.get(LayoutTemplateService),
        queue = moduleRef.get(ContractDocumentService), worker = moduleRef.get(ContractDocumentProcessor), files = moduleRef.get(FileService);
      expect(client).toBeInstanceOf(PrismaService);
      for (const provider of [template, queue, worker, files]) expect(Object.getOwnPropertyDescriptor(provider, "prisma")?.value).toBe(client);
    } finally { await moduleRef.close(); }
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.FILE_DOWNLOAD_SECRET; else process.env.FILE_DOWNLOAD_SECRET = previousSecret;
  }
});
it("业务前后将实际会话交给独立 owner 核验，核验失败不得继续", async () => {
  const f = fixture();
  const verify = jest.fn(async () => { throw new Error("owner mismatch"); });
  const business = jest.fn();
  await expect(withTask12DefaultDocumentScope(f, f.expected, business, verify)).rejects.toThrow("owner mismatch");
  expect(verify).toHaveBeenCalledWith(expect.objectContaining({ pid: f.identity.pid, start: f.identity.start, roleOid: f.identity.roleOid }));
  expect(business).not.toHaveBeenCalled();
});
