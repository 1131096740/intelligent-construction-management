import { UPWARD_DIRECT_ARCHIVE_AUTHORITY, type UpwardDirectArchiveAuthority, type UpwardDirectExecution } from "./contract-upward-direct-registration";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { PrivateFileStorage } from "../file/file.service";
import { DIRECT_ARCHIVE_EXECUTOR, type DirectArchiveExecution, type DirectArchiveExecutor } from "./contract-direct-archive-executor";

type SyntheticClient = {
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  $disconnect: jest.Mock;
};
const mockPrisma = jest.fn<SyntheticClient, [Prisma.PrismaClientOptions]>();

jest.mock("@prisma/client", () => ({
  ...jest.requireActual<typeof import("@prisma/client")>("@prisma/client"),
  PrismaClient: class {
    constructor(options: Prisma.PrismaClientOptions) {
      return mockPrisma(options);
    }
  }
}));

const keys = ["DATABASE_URL", "DIRECT_ARCHIVE_ISSUER_DATABASE_URL", "DIRECT_ARCHIVE_RUNTIME_DATABASE_URL", "UPWARD_DIRECT_ARCHIVE_ISSUER_DATABASE_URL", "UPWARD_DIRECT_ARCHIVE_RUNTIME_DATABASE_URL"] as const;
const database = "postgresql://ordinary:synthetic-app@db.invalid:5432/jg_isolated";
const dedicated = (role: string, name = "jg_isolated") =>
  `postgresql://${role}:synthetic-${role}@db.invalid:5432/${name}?schema=public&connection_limit=1&sslmode=require&sslaccept=strict&sslcert=%2Ffixture%2Fca.crt`;
const nonce = "042c7d1a-7de0-42fd-9de0-f7a9270cc47f";
const intentId = "442c7d1a-7de0-42fd-9de0-f7a9270cc47f";
const archiveId = "842c7d1a-7de0-42fd-9de0-f7a9270cc47f";
const original = Buffer.from("synthetic-original");

function configuration(issuer?: string, runtime?: string) {
  for (const [key, value] of [[keys[0], database], [keys[1], issuer], [keys[2], runtime]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function disconnectedClient(): SyntheticClient {
  return { $queryRaw: jest.fn(), $transaction: jest.fn(), $disconnect: jest.fn().mockResolvedValue(undefined) };
}

async function compile() {
  const ordinary = disconnectedClient();
  const storage = { readVerifiedVersion: jest.fn().mockResolvedValue({ buffer: original, objectGeneration: "fixed-test-version" }) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(ordinary)
    .overrideProvider(PrivateFileStorage).useValue(storage)
    .compile();
  return { module, ordinary, storage };
}

describe("表外直签原生连接在正常模块中的接线", () => {
  const savedEnv = new Map(keys.map(key => [key, process.env[key]]));
  beforeEach(() => { mockPrisma.mockReset(); delete process.env.UPWARD_DIRECT_ARCHIVE_ISSUER_DATABASE_URL; delete process.env.UPWARD_DIRECT_ARCHIVE_RUNTIME_DATABASE_URL; });
  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("从两个专用 DSN 注入发行和执行，不调用普通连接，关闭时释放两个客户端", async () => {
    const issuerUrl = dedicated("issuer"), runtimeUrl = dedicated("executor");
    configuration(issuerUrl, runtimeUrl);
    const issuer = disconnectedClient();
    const runtime = disconnectedClient();
    const execute = disconnectedClient();
    issuer.$queryRaw.mockResolvedValue([{ intentId }]);
    runtime.$transaction.mockImplementation((operation: (tx: SyntheticClient) => unknown) => operation(execute));
    execute.$queryRaw.mockResolvedValue([{ archiveId }]);
    mockPrisma.mockReturnValueOnce(issuer).mockReturnValueOnce(runtime);
    const { module, ordinary, storage } = await compile();
    try {
      const transport = module.get<DirectArchiveExecutor | undefined>(DIRECT_ARCHIVE_EXECUTOR);
      expect(transport).toBeDefined();
      const command: DirectArchiveExecution = {
        actor: "handler", projectId: "project", contractId: "contract", versionId: "version", revision: 2,
        inputSha256: "a".repeat(64), key: "archive-key", nativeNonce: nonce,
        originals: [{ fileId: "file", displayOrder: 0, bucket: "private", objectKey: "synthetic-original",
          mimeType: "image/png", sizeBytes: original.length, contentSha256: createHash("sha256").update(original).digest("hex") }]
      };
      await transport?.execute(command);
      expect(mockPrisma.mock.calls.map(([options]) => options.datasources?.db?.url)).toEqual([issuerUrl, runtimeUrl]);
      const issued = issuer.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      const executed = execute.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(issued.sql).toContain("jg_issue_contract_direct_archive_intent_v1");
      expect(executed.sql).toContain("jg_execute_contract_direct_archive_outside_v1");
      for (const query of [issued, executed]) {
        expect(query.sql).toContain("jg_contract_direct_archive_native_channel_v1");
        expect(query.sql).toContain("pg_catalog.pg_stat_ssl");
        expect(query.sql).toContain("current_user=session_user");
      }
      expect(issued.values[0]).toBe(nonce);
      expect(executed.values.slice(0, 2)).toEqual([nonce, intentId]);
      expect(ordinary.$queryRaw).not.toHaveBeenCalled();
      expect(ordinary.$transaction).not.toHaveBeenCalled();
      expect(storage.readVerifiedVersion.mock.calls[1][0].expectedGeneration).toBe("fixed-test-version");
      issuer.$queryRaw.mockResolvedValueOnce([]);
      await expect(transport?.execute(command)).rejects.toThrow("直签登记写入资格尚未完整核对");
      expect(runtime.$transaction).toHaveBeenCalledTimes(1);
    } finally {
      await module.close();
    }
    expect(issuer.$disconnect).toHaveBeenCalledTimes(1);
    expect(runtime.$disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["未配置", undefined, undefined],
    ["只配置发行", dedicated("issuer"), undefined],
    ["同登录名", dedicated("issuer"), dedicated("issuer").replace("synthetic-issuer", "other-password")],
    ["使用普通登录", dedicated("ordinary"), dedicated("executor")],
    ["不同数据库", dedicated("issuer"), dedicated("executor", "another_db")],
    ["允许无证书验证", dedicated("issuer"), dedicated("executor").replace("sslaccept=strict", "sslaccept=accept_invalid_certs")],
    ["查询参数重写用户", dedicated("issuer") + "&user=ordinary", dedicated("executor")],
    ["重复 TLS 参数", dedicated("issuer") + "&sslmode=disable", dedicated("executor")]
  ])("%s 时保持关闭且不创建客户端", async (_name, issuer, runtime) => {
    configuration(issuer, runtime);
    const { module, ordinary, storage } = await compile();
    try {
      expect(module.get(DIRECT_ARCHIVE_EXECUTOR)).toBeUndefined();
      expect(mockPrisma).not.toHaveBeenCalled();
      expect(ordinary.$queryRaw).not.toHaveBeenCalled();
      expect(storage.readVerifiedVersion).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
  it("对上未供应专用连接时不借用已配置的表外客户端", async () => {
    configuration(dedicated("outside_issuer"), dedicated("outside_executor"));
    mockPrisma.mockImplementation(() => disconnectedClient());
    const { module, ordinary } = await compile();
    try {
      expect(module.get(UPWARD_DIRECT_ARCHIVE_AUTHORITY)).toBeUndefined();
      expect(ordinary.$queryRaw).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it.each(["outside_issuer", "outside_executor"])("对上配置复用表外%s时保持关闭", async outsideRole => {
    configuration(dedicated("outside_issuer"), dedicated("outside_executor"));
    process.env.UPWARD_DIRECT_ARCHIVE_ISSUER_DATABASE_URL = dedicated(outsideRole);
    process.env.UPWARD_DIRECT_ARCHIVE_RUNTIME_DATABASE_URL = dedicated("upward_executor");
    mockPrisma.mockImplementation(() => disconnectedClient());
    const { module } = await compile();
    try {
      expect(module.get(UPWARD_DIRECT_ARCHIVE_AUTHORITY)).toBeUndefined();
      expect(mockPrisma.mock.calls.map(([options]) => options.datasources?.db?.url)).toEqual([
        dedicated("outside_issuer"), dedicated("outside_executor")]);
    } finally { await module.close(); }
  });

  it("对上独立客户端只调用既有Q2签发与专用执行入口", async () => {
    configuration();
    process.env.UPWARD_DIRECT_ARCHIVE_ISSUER_DATABASE_URL = dedicated("upward_issuer");
    process.env.UPWARD_DIRECT_ARCHIVE_RUNTIME_DATABASE_URL = dedicated("upward_executor");
    const issuer = disconnectedClient(), runtime = disconnectedClient(), execute = disconnectedClient();
    issuer.$queryRaw.mockResolvedValue([{ intentId }]);
    runtime.$transaction.mockImplementation((operation: (tx: SyntheticClient) => unknown) => operation(execute));
    execute.$queryRaw.mockResolvedValue([{ archiveId }]);
    mockPrisma.mockReturnValueOnce(issuer).mockReturnValueOnce(runtime);
    const { module, ordinary } = await compile();
    try {
      const authority = module.get<UpwardDirectArchiveAuthority | undefined>(UPWARD_DIRECT_ARCHIVE_AUTHORITY);
      expect(authority).toBeDefined();
      const command: UpwardDirectExecution = { actor: "handler", projectId: "project", contractId: "contract", versionId: "version",
        revision: 2, inputSha256: "a".repeat(64), key: "archive-key", nativeNonce: nonce, Q: {}, qText: "{}", requestSha256: "b".repeat(64),
        originals: [{ fileId: "file", displayOrder: 0, bucket: "private", objectKey: "synthetic-original", mimeType: "image/png",
          sizeBytes: original.length, contentSha256: createHash("sha256").update(original).digest("hex") }] };
      await authority!.execute(command);
      const issued = issuer.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(issued.sql).toContain("jg_issue_contract_direct_upward_intent_v2");
      expect(issued.sql).toContain("jg_upward_issuer_channel_v2");
      expect(issued.sql).toContain("current_user=session_user");
      expect(issued.sql).toContain("pg_catalog.pg_stat_ssl");
      expect(issued.values[0]).toBe(nonce);
      expect((execute.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql).toContain("jg_execute_contract_direct_upward_v2");
      issuer.$queryRaw.mockResolvedValueOnce([]);
      await expect(authority!.execute(command)).rejects.toThrow("对上");
      expect(runtime.$transaction).toHaveBeenCalledTimes(1);
      expect(ordinary.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.mock.calls.map(([options]) => options.datasources?.db?.url)).toEqual([dedicated("upward_issuer"), dedicated("upward_executor")]);
    } finally { await module.close(); }
    expect(issuer.$disconnect).toHaveBeenCalledTimes(1); expect(runtime.$disconnect).toHaveBeenCalledTimes(1);
  });

});
