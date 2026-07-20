import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const verification = localRequire("../../prisma/verify-draft-lifecycle.cjs") as {
  DATABASE_NAME: string;
  EXPECTED_MIGRATION_COUNT: number;
  LIFECYCLE_MIGRATIONS: string[];
  assertDedicatedLocalDatabase: (
    databaseUrl: string,
    options?: { allowIsolatedRestore?: boolean }
  ) => { isDedicatedLocalDatabase: boolean; isExplicitRestoreDatabase: boolean };
  normalizeSnapshot: (rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  normalizeProbeFacts: (facts: Record<string, Record<string, unknown>>) => Record<string, unknown>;
};

const prismaRoot = resolve(__dirname, "../../prisma");
const migrations = verification.LIFECYCLE_MIGRATIONS.map((name) =>
  readFileSync(resolve(prismaRoot, "migrations", name, "migration.sql"), "utf8")
);
const script = readFileSync(resolve(prismaRoot, "verify-draft-lifecycle.cjs"), "utf8");
const runner = readFileSync(resolve(prismaRoot, "run-draft-lifecycle-local.cjs"), "utf8");

describe("draft lifecycle live verification", () => {
  it("只允许固定本地隔离 PostgreSQL，拒绝生产和远程连接形态", () => {
    expect(verification.DATABASE_NAME).toBe("jiangkong_draft_lifecycle_verify");
    expect(() =>
      verification.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/jiangkong_draft_lifecycle_verify"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_draft_lifecycle_verify",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_draft_lifecycle_verify",
      "not-a-url"
    ]) {
      expect(() => verification.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
    expect(() =>
      verification.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:5432/jiangkong_restore_20260720_candidate"
      )
    ).toThrow();
    expect(
      verification.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:5432/jiangkong_restore_20260720_candidate",
        { allowIsolatedRestore: true }
      )
    ).toEqual({ isDedicatedLocalDatabase: false, isExplicitRestoreDatabase: true });
    expect(() =>
      verification.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:5432/jiangkong_restore_candidate-with-dash",
        { allowIsolatedRestore: true }
      )
    ).toThrow();
  });

  it("固定全部 73 个迁移和 M70-M73，不把旧版本冒充已验证", () => {
    expect(verification.EXPECTED_MIGRATION_COUNT).toBe(73);
    expect(verification.LIFECYCLE_MIGRATIONS).toEqual([
      "20260719210000_contract_settlement_draft_lifecycle",
      "20260719211000_payment_spot_draft_lifecycle",
      "20260719212000_template_draft_lifecycle",
      "20260720183000_draft_copy_source"
    ]);
    expect(script).toContain("SET TRANSACTION READ ONLY");
    expect(script).toContain("--probe-rollback");
    expect(script).toContain("ROLLBACK_DRAFT_LIFECYCLE_PROBE");
  });

  it("M70-M73 只增加生命周期列、约束和索引，不包含业务 DML 或金额改写", () => {
    for (const sql of migrations) {
      expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
      expect(sql).not.toMatch(/\bTRUNCATE\b/iu);
      expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/iu);
      expect(sql).not.toMatch(/\bINSERT\s+INTO\b/iu);
      expect(sql).not.toMatch(/(?:^|;)\s*UPDATE\s+"?[A-Za-z]/imu);
      expect(sql).not.toMatch(/SET\s+"?(?:amount|paidAmount|requestedAmount|approvedAmount)[A-Za-z]*Cents"?/iu);
    }
  });

  it("按 PostgreSQL 实际 regclass 和 indexdef 形式执行迁移前置检查", () => {
    expect(migrations[0]).toContain(`'"ContractVersion"'::regclass`);
    expect(migrations[1]).toContain(`'"PaymentRequest"'::regclass`);
    expect(migrations[2]).toContain(`'"SettlementTemplateVersion"'::regclass`);
    expect(migrations[2]).toContain(`position('(status, "publishedAt")' IN definition)`);
    expect(migrations[3]).toContain(`ADD COLUMN "copiedFromContractVersionId" TEXT`);
    expect(migrations[3]).toContain(`ADD COLUMN "copiedFromDraftId" TEXT`);
  });

  it("计数和金额摘要把 bigint 规范为可稳定比较的十进制字符串", () => {
    expect(
      verification.normalizeSnapshot([
        { entity: "Contract", count: 2n, moneyDigest: "0" },
        { entity: "PaymentRequest", count: 1n, moneyDigest: "12345" }
      ])
    ).toEqual([
      { entity: "Contract", count: "2", moneyDigest: "0" },
      { entity: "PaymentRequest", count: "1", moneyDigest: "12345" }
    ]);
  });

  it("回滚探针逐字段固定状态、结束事实和金额，不只比较聚合计数", () => {
    const facts = verification.normalizeProbeFacts({
      contract: {
        id: "contract-version-1",
        status: "draft",
        amountCents: 100n,
        abandonedAt: null,
        abandonedByUserId: null,
        abandonReason: null
      },
      payment: {
        id: "payment-1",
        status: "draft",
        requestedAmountCents: 80n,
        approvedAmountCents: null,
        paidAmountCents: 0n,
        abandonedAt: null,
        abandonedByUserId: null,
        abandonReason: null
      },
      template: {
        id: "template-version-1",
        status: "draft",
        discardedAt: null,
        discardedByUserId: null,
        discardReason: null
      }
    });
    expect(facts).toMatchObject({
      contract: { status: "draft", amountCents: "100", abandonedAt: null },
      payment: { status: "draft", requestedAmountCents: "80", paidAmountCents: "0" },
      template: { status: "draft", discardedAt: null }
    });
    expect(script).toContain("回滚探针后生命周期状态、操作事实或金额字段发生变化");
  });

  it("本地 runner 从空 PostgreSQL 16 应用迁移、检查 status、seed 并强制清理", () => {
    expect(runner).toContain('"postgres:16"');
    expect(runner).toContain('"migrate", "deploy"');
    expect(runner).toContain('"migrate", "status"');
    expect(runner).toContain('"services/api/prisma/seed.cjs"');
    expect(runner).toContain("cwd: temporaryRoot");
    expect(runner).toContain('"--probe-rollback"');
    expect(runner).toContain("assertLocalDockerEndpoint");
    expect(runner).toContain("removeContainer");
    expect(runner).toContain("removeTemporaryRoot");
  });
});
