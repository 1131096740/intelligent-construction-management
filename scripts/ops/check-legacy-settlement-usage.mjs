#!/usr/bin/env node
// CUT-03 read-only audit runner (#396). Never writes business data and never
// retires the legacy settlement entry; #425 owns deletion.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
// The workspace hoists Prisma Client under the API package, not the repo root.
const { PrismaClient } = createRequire(
  new URL("../../services/api/package.json", import.meta.url)
)("@prisma/client");
const sqlPath = join(here, "check-legacy-settlement-usage.sql");

function receiptPath(argv) {
  const index = argv.indexOf("--receipt");
  return index >= 0 ? resolve(argv[index + 1]) : null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL：CUT-03 核查只接受只读连接");
  }
  const sql = await readFile(sqlPath, "utf8");
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const audit = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const rows = await tx.$queryRawUnsafe(sql);
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row || typeof row !== "object" || !row.audit) {
          throw new Error("CUT-03 核查未返回结构化结果");
        }
        const [catalog] = await tx.$queryRaw`
          SELECT pg_catalog.to_regclass('public."SignedContractSettlement"') IS NOT NULL AS "available"
        `;
        if (!catalog.available) {
          const [ledger] = await tx.$queryRaw`
            SELECT EXISTS (
              SELECT 1 FROM public."_prisma_migrations"
              WHERE migration_name = '20261119004100_signed_contract_settlement_registration'
                AND finished_at IS NOT NULL AND rolled_back_at IS NULL
            ) AS "migrationApplied"
          `;
          if (ledger.migrationApplied) {
            throw new Error("已签结算登记迁移已完成，但恢复库缺少登记表");
          }
          return {
            ...row.audit,
            signedSettlementRegistration: { available: false, total: null, confirmed: null }
          };
        }

        const [registration] = await tx.$queryRaw`
          SELECT jsonb_build_object(
            'available', true,
            'total', count(*),
            'confirmed', count(*) FILTER (WHERE state = 'confirmed')
          ) AS "counts" FROM public."SignedContractSettlement"
        `;
        return { ...row.audit, signedSettlementRegistration: registration.counts };
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 }
    );
    const receipt = { ok: true, command: "check-legacy-settlement-usage", audit };
    const output = `${JSON.stringify(receipt, null, 2)}\n`;
    const target = receiptPath(process.argv.slice(2));
    if (target) await writeFile(target, output, { mode: 0o600 });
    process.stdout.write(output);
    if (audit.verdict !== "LEGACY_SETTLEMENT_UNUSED") process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      command: "check-legacy-settlement-usage",
      message: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
});
