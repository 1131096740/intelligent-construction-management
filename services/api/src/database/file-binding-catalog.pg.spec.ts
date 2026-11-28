import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { readFileBindingCatalog } from "./registered-payment-catalog";

/**
 * 文件绑定目录的**真库**契约：目录判定只允许依赖安装指纹（对象形状、
 * body 哈希、search_path），不允许依赖“运行时角色是谁”。受限运行时被
 * owner 授予 reader 的 EXECUTE 后，目录仍必须可核验；PUBLIC 可执行则
 * 必须继续 fail closed。
 *
 * 用真实 PostgreSQL 的独立数据库复刻最小安装面：目录只检查对象是否存在、
 * 形状、body 哈希、ACL 与触发器，不读取业务行；因此这里以真实迁移文本的
 * body 装配，不伪造 catalog 返回值。默认跳过，入口：
 * RUN_FILE_BINDING_CATALOG_DATABASE=1 DATABASE_URL=<可 CREATEDB 的隔离库>
 */
const enabled =
  process.env.RUN_FILE_BINDING_CATALOG_DATABASE === "1" ? describe : describe.skip;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const REGISTRY_BODY_SHA = "2a2b941651afd8763a7932f8ea110e845eb0851783ea86726b1da78ed20ded85";
const OWNER_SETTLEMENT_PRIOR_BODY_SHA =
  "46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3";
const READER_BODY_SHA = "fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14";
const GUARD_BODY_SHA = "91b57f66e67bb1d888d1d0e8803cabbe08c289b01d2a6e810bfa69fe82a48d62";

const migrations = resolve(__dirname, "../../prisma/migrations");

/** 取迁移中 `AS $body$ … $body$` 之间的精确 prosrc（哈希与安装指纹一致）。 */
function migrationBody(migration: string, expectedSha: string): string {
  const source = readFileSync(resolve(migrations, migration, "migration.sql"), "utf8");
  const start = source.indexOf("AS $body$");
  if (start < 0) throw new Error(`fixture: ${migration} 缺少 $body$`);
  const from = start + "AS $body$".length;
  const to = source.indexOf("$body$;", from);
  const body = source.slice(from, to);
  if (sha256(body) !== expectedSha) throw new Error(`fixture: ${migration} body 哈希漂移`);
  return body;
}

/** 取迁移中 `AS $$ … $$;` 之间的精确 prosrc（reader 在 185000 迁移创建）。 */
function migrationDollarBody(migration: string, expectedSha: string): string {
  const source = readFileSync(resolve(migrations, migration, "migration.sql"), "utf8");
  const start = source.indexOf("AS $$");
  if (start < 0) throw new Error(`fixture: ${migration} 缺少 $$ body`);
  const from = start + "AS $$".length;
  const to = source.indexOf("$$;", from);
  const body = source.slice(from, to);
  if (sha256(body) !== expectedSha) throw new Error(`fixture: ${migration} $$ body 哈希漂移`);
  return body;
}

/** 从安装见证材料按哈希取精确 body（registered-payment 安装阶段创建）。 */
function witnessedBody(expectedSha: string): string {
  const material = JSON.parse(
    readFileSync(resolve(__dirname, "../../prisma/task16-registered-access.json"), "utf8")
  ) as unknown;
  const stack: unknown[] = [material];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === "string") {
      if (sha256(node) === expectedSha) return node;
    } else if (node && typeof node === "object") {
      stack.push(...Object.values(node as Record<string, unknown>));
    }
  }
  throw new Error("fixture: 安装见证材料缺少目标 body");
}

function fixture(replayRole: string): string[] {
  const registryBody = migrationBody(
    "20261119007500_signed_change_and_settlement_attachment_file_binding",
    REGISTRY_BODY_SHA
  );
  const ownerSettlementPriorBody = witnessedBody(OWNER_SETTLEMENT_PRIOR_BODY_SHA);
  const readerBody = migrationDollarBody(
    "20261118185000_project_owner_settlement_voucher_binding",
    READER_BODY_SHA
  );
  const guardBody = witnessedBody(GUARD_BODY_SHA);
  const neutralRegistry = "SELECT NULL::text, NULL::text, NULL::boolean";
  const table = (name: string, columns: string) =>
    `CREATE TABLE public."${name}" (${columns})`;
  return [
    table("FileObject", `"id" text PRIMARY KEY, "bucket" text, "objectKey" text, "storageStatus" text, "contentSha256" text, "supersedesFileObjectId" text`),
    table("PaymentExecution", `"id" text PRIMARY KEY, "voucherFileId" text`),
    table("ProjectOwnerSettlementEntry", `"id" text PRIMARY KEY, "voucherFileId" text`),
    table("RegisteredPaymentVoucher", `"executionId" text NOT NULL, "fileId" text NOT NULL, "uploadedByUserId" text NOT NULL, "contentSha256" text NOT NULL, "createdAt" timestamp(3) NOT NULL, CONSTRAINT "RegisteredPaymentVoucher_pkey" PRIMARY KEY ("executionId"), CONSTRAINT "RegisteredPaymentVoucher_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES public."FileObject"("id") ON UPDATE RESTRICT ON DELETE RESTRICT`),
    table("RegisteredPaymentFunding", `"id" text PRIMARY KEY`),
    table("RegisteredFundPaymentAllocation", `"id" text PRIMARY KEY`),
    table("RegisteredPaymentEvent", `"id" text PRIMARY KEY`),
    table("RegisteredContractHistoryRevision", `"id" text PRIMARY KEY`),
    `CREATE FUNCTION public.jg_enforce_exclusive_file_business_binding() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$`,
    `CREATE FUNCTION public.jg_registered_payment_voucher_file_immutable() RETURNS trigger LANGUAGE plpgsql AS $body$${guardBody}$body$`,
    `CREATE TRIGGER "RegisteredPaymentVoucher_file_immutable" BEFORE UPDATE OR DELETE ON public."FileObject" FOR EACH ROW EXECUTE FUNCTION public.jg_registered_payment_voucher_file_immutable()`,
    `CREATE TRIGGER "jg_efb_registered_payment_voucher" BEFORE INSERT ON public."RegisteredPaymentVoucher" FOR EACH ROW EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding()`,
    `CREATE FUNCTION public.jg_file_business_binding_columns_before_registered_payment() RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE AS $body$${neutralRegistry}$body$`,
    `CREATE FUNCTION public.jg_file_business_binding_columns_before_owner_settlement() RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp AS $body$${ownerSettlementPriorBody}$body$`,
    `CREATE FUNCTION public.jg_file_business_binding_columns_before_signed_settlement() RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$${neutralRegistry}$body$`,
    `CREATE FUNCTION public.jg_file_business_binding_columns() RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$${registryBody}$body$`,
    `CREATE FUNCTION public.jg_project_owner_settlement_voucher_bound(candidate TEXT) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $body$${readerBody}$body$`,
    `REVOKE ALL ON FUNCTION public.jg_file_business_binding_columns() FROM PUBLIC`,
    `REVOKE ALL ON FUNCTION public.jg_file_business_binding_columns_before_owner_settlement() FROM PUBLIC`,
    `REVOKE ALL ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) FROM PUBLIC`,
    `CREATE ROLE "${replayRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    `GRANT USAGE ON SCHEMA public TO "${replayRole}"`
  ];
}

enabled("registered payment file binding catalog on real PostgreSQL", () => {
  jest.setTimeout(180000);
  const sourceUrl = process.env.DATABASE_URL;
  const suffix = randomUUID().replace(/-/gu, "").slice(0, 12);
  const database = `file_binding_catalog_${suffix}`;
  const replayRole = `file_binding_catalog_replay_${suffix}`;
  const admin = () => new PrismaClient({ datasources: { db: { url: sourceUrl! } } });
  let control: PrismaClient;
  let db: PrismaClient;

  beforeAll(async () => {
    if (!sourceUrl) throw new Error("文件绑定目录真库测试必须提供隔离 DATABASE_URL");
    control = admin();
    await control.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    const target = new URL(sourceUrl);
    target.pathname = `/${database}`;
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    for (const statement of fixture(replayRole)) await db.$executeRawUnsafe(statement);
  });

  afterAll(async () => {
    await db?.$disconnect().catch(() => undefined);
    await control?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await control?.$executeRawUnsafe(`DROP ROLE IF EXISTS "${replayRole}"`);
    await control?.$disconnect().catch(() => undefined);
  });

  /** 受限运行时的核验：只在事务内切到 NOLOGIN 运行时角色。 */
  async function readAsRestricted() {
    return db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${replayRole}"`);
      try {
        return { catalog: await readFileBindingCatalog(tx) };
      } catch (error) {
        return { message: (error as Error).message };
      }
    });
  }

  const revokeReader = () =>
    db.$executeRawUnsafe(
      `REVOKE ALL ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) FROM PUBLIC, "${replayRole}"`
    );

  it("在 owner-only reader ACL 下识别已安装目录", async () => {
    await expect(readAsRestricted()).resolves.toEqual({
      catalog: { registeredPayment: true, ownerSettlementVoucher: true }
    });
  });

  it("受限运行时被 owner 授予 reader 后仍能核验文件绑定", async () => {
    await revokeReader();
    await db.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) TO "${replayRole}"`
    );
    await expect(readAsRestricted()).resolves.toEqual({
      catalog: { registeredPayment: true, ownerSettlementVoucher: true }
    });
    await revokeReader();
  });

  it("受限运行时按一次性全函数授权仍能核验（复刻 task410 lane 的授权方式）", async () => {
    await revokeReader();
    await db.$executeRawUnsafe(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${replayRole}"`
    );
    await expect(readAsRestricted()).resolves.toEqual({
      catalog: { registeredPayment: true, ownerSettlementVoucher: true }
    });
    await db.$executeRawUnsafe(
      `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM "${replayRole}"`
    );
  });

  it("reader 对 PUBLIC 可执行时继续 fail closed", async () => {
    await revokeReader();
    await db.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) TO PUBLIC`
    );
    await expect(readAsRestricted()).resolves.toEqual({
      message: expect.stringContaining("付款凭证文件绑定暂不可核验")
    });
    await revokeReader();
  });

  it("reader 被授予 GRANT OPTION 时继续 fail closed", async () => {
    await revokeReader();
    await db.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) TO "${replayRole}" WITH GRANT OPTION`
    );
    await expect(readAsRestricted()).resolves.toEqual({
      message: expect.stringContaining("付款凭证文件绑定暂不可核验")
    });
    await revokeReader();
  });

  it("目录 SQL 不读取任何业务表（受限角色无表权限也可核验）", async () => {
    const [row] = await db.$queryRaw<Array<{ tablePrivileges: number }>>(Prisma.sql`
      SELECT count(*)::int AS "tablePrivileges" FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND pg_catalog.has_table_privilege(${replayRole}, c.oid, 'SELECT')
    `);
    expect(row.tablePrivileges).toBe(0);
  });
});
