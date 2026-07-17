const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function readDatabaseUrl(filePath) {
  try {
    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (!line) return undefined;

    const raw = line.slice(line.indexOf("=") + 1).trim();
    return (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    );
  } catch {
    return undefined;
  }
}

if (!process.env.DATABASE_URL) {
  const apiRoot = path.resolve(__dirname, "..");
  const databaseUrl = readDatabaseUrl(path.join(apiRoot, ".env"));
  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }
}

const checks = {
  migration52: `SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260716160000_contract_tax_facts_and_settlement_drafts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  companyEntities: `SELECT "id", "name", "unifiedSocialCreditCode", "isActive" FROM "CompanyEntity" ORDER BY "createdAt"`,
  duplicateCreditCodes: `SELECT upper(trim("unifiedSocialCreditCode")) code, count(*) FROM "CompanyEntity" WHERE "unifiedSocialCreditCode" IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  activeContracts: `SELECT "status", count(*) FROM "ContractVersion" WHERE "status" IN ('in_approval','approved_pending_seal','in_seal','seal_approved_pending_archive','pending_archive_confirm','approval_pending','approved','sealed_pending_archive') GROUP BY "status"`,
  activeSettlements: `SELECT "status", count(*) FROM "Settlement" WHERE "status" IN ('in_approval','approval_pending','approved_pending_archive','archive_pending','pending_archive_confirm') GROUP BY "status"`
};

async function inspect() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET default_transaction_read_only = on");

      const report = {};
      for (const [name, query] of Object.entries(checks)) {
        report[name] = await tx.$queryRawUnsafe(query);
      }
      return report;
    });
  } finally {
    await prisma.$disconnect();
  }
}

inspect()
  .then((report) => {
    process.stdout.write(
      `${JSON.stringify(
        report,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2
      )}\n`
    );
  })
  .catch(() => {
    process.stderr.write("合同结算治理只读预检失败，请检查数据库连接和只读权限。\n");
    process.exitCode = 1;
  });
