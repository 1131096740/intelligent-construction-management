const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const jsonOutput = process.argv.includes("--json");
const HISTORICAL_TAKEOVER_MARKER = "historical_takeover";
const PROVABLE_INVOICE_TYPES = new Map([
  ["增值税普通发票", "vat_general"],
  ["增值税专用发票", "vat_special"]
]);
const COMPLETED_SETTLEMENT_STATUSES = new Set(["effective", "archived"]);
const DRAFT_SETTLEMENT_STATUSES = new Set(["draft"]);

function readEnvFile(filePath) {
  try {
    return Object.fromEntries(
      readFileSync(filePath, "utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const key = line.slice(0, separator).trim();
          const raw = line.slice(separator + 1).trim();
          const value =
            (raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'"))
              ? raw.slice(1, -1)
              : raw;
          return [key, value];
        })
    );
  } catch {
    return {};
  }
}

const apiRoot = path.resolve(__dirname, "..");
const env = {
  ...readEnvFile(path.join(apiRoot, ".env")),
  ...process.env
};
if (!process.env.DATABASE_URL && env.DATABASE_URL) {
  process.env.DATABASE_URL = env.DATABASE_URL;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function fieldValue(draftData, key) {
  const draft = object(draftData);
  const fields = object(draft.fieldValues);
  return fields[key] ?? draft[key] ?? null;
}

function provableInvoiceAndRate(draftData) {
  const invoiceType = fieldValue(draftData, "invoiceType");
  const rateValue = fieldValue(draftData, "taxRatePercent");
  if (typeof invoiceType !== "string" || !PROVABLE_INVOICE_TYPES.has(invoiceType.trim())) {
    return false;
  }
  if (typeof rateValue !== "string" && typeof rateValue !== "number") {
    return false;
  }
  const rateText = String(rateValue).trim();
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/u.test(rateText)) {
    return false;
  }
  const rate = Number(rateText);
  return Number.isFinite(rate) && rate > 0 && rate <= 100;
}

function decimalPlaces(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value.decimalPlaces === "function") {
    return value.decimalPlaces();
  }
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/u, "").split(".")[1]?.length ?? 0 : 0;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function templateHasQuantityScaleOverTwo(billSchema) {
  return array(billSchema).some((bill) => {
    const record = object(bill);
    return typeof record.quantityScale === "number" && record.quantityScale > 2;
  });
}

function templateContainsZeroTaxOption(fieldSchema) {
  return array(fieldSchema).some((field) => {
    const record = object(field);
    if (record.key !== "taxRatePercent") return false;
    return array(record.options).some((option) => {
      const optionRecord = object(option);
      return String(optionRecord.value ?? optionRecord.label ?? "").trim() === "0";
    });
  });
}

async function inspect() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const prisma = new PrismaClient();
  try {
    const [versions, takeovers, rows, templates, settlementGroups] = await Promise.all([
      prisma.contractVersion.findMany({
        select: {
          id: true,
          status: true,
          draftData: true
        }
      }),
      prisma.contractTakeover.findMany({
        select: { contractVersionId: true }
      }),
      prisma.contractBillRow.findMany({
        select: {
          quantity: true,
          unitPrice: true,
          taxRate: true
        }
      }),
      prisma.contractBusinessTemplateVersion.findMany({
        where: { status: "published" },
        select: {
          fieldSchema: true,
          billSchema: true
        }
      }),
      prisma.settlement.groupBy({
        by: ["status"],
        _count: { _all: true }
      })
    ]);

    const takeoverVersionIds = new Set(takeovers.map((item) => item.contractVersionId));
    const historicalVersions = versions.filter((version) => {
      const draft = object(version.draftData);
      return (
        takeoverVersionIds.has(version.id) ||
        draft.historicalTakeover === true ||
        draft.sourceType === HISTORICAL_TAKEOVER_MARKER
      );
    });
    const systemVersions = versions.filter(
      (version) => !historicalVersions.some((historical) => historical.id === version.id)
    );
    const provableSystemVersions = systemVersions.filter((version) =>
      provableInvoiceAndRate(version.draftData)
    );

    const settlementCount = (statuses) =>
      settlementGroups
        .filter((group) => statuses.has(group.status))
        .reduce((total, group) => total + group._count._all, 0);
    const totalSettlements = settlementGroups.reduce(
      (total, group) => total + group._count._all,
      0
    );
    const draftSettlements = settlementCount(DRAFT_SETTLEMENT_STATUSES);
    const completedSettlements = settlementCount(COMPLETED_SETTLEMENT_STATUSES);

    return {
      generatedAt: new Date().toISOString(),
      contractVersions: {
        total: versions.length,
        historicalTakeover: historicalVersions.length,
        systemCreated: systemVersions.length,
        provableInvoiceAndRate: provableSystemVersions.length,
        unconfirmed: historicalVersions.length + systemVersions.length - provableSystemVersions.length
      },
      billRows: {
        total: rows.length,
        taxRateNotPositive: rows.filter((row) => row.taxRate.lte(0)).length,
        quantityOverTwoDecimals: rows.filter((row) => decimalPlaces(row.quantity) > 2).length,
        unitPriceOverTwoDecimals: rows.filter((row) => decimalPlaces(row.unitPrice) > 2).length
      },
      templates: {
        published: templates.length,
        quantityScaleOverTwo: templates.filter((template) =>
          templateHasQuantityScaleOverTwo(template.billSchema)
        ).length,
        containsZeroTaxOption: templates.filter((template) =>
          templateContainsZeroTaxOption(template.fieldSchema)
        ).length
      },
      settlements: {
        draft: draftSettlements,
        active: totalSettlements - draftSettlements - completedSettlements,
        completed: completedSettlements
      },
      migrationGroups: {
        systemFactsCanBackfill: provableSystemVersions.length,
        mustRemainUnconfirmed:
          historicalVersions.length + systemVersions.length - provableSystemVersions.length,
        legacyPrecisionRows: rows.length
      }
    };
  } finally {
    await prisma.$disconnect();
  }
}

inspect()
  .then((report) => {
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write("合同税务事实迁移只读审计完成。\n");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(
      `合同税务事实迁移只读审计失败：${error instanceof Error ? error.message : "未知错误"}\n`
    );
    process.exitCode = 1;
  });
