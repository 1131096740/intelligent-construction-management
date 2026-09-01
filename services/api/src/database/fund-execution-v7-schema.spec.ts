import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(__dirname, "../..");
const schema = readFileSync(resolve(apiRoot, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    apiRoot,
    "prisma/migrations/20260831120000_pol13d_fund_execution_v7/migration.sql"
  ),
  "utf8"
);

function model(name: string) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
}

describe("POL-13D fund execution v7 schema", () => {
  it("keeps both reversal targets many-to-one and maps them to ordinary migration indexes", () => {
    const fundExecution = model("FundExecution");
    const reversalIndexes = [
      {
        field: "reversesPaymentExecutionId",
        index: "FundExecution_reverses_payment_idx"
      },
      {
        field: "reversesFundExecutionId",
        index: "FundExecution_reverses_fund_idx"
      }
    ];

    for (const { field, index } of reversalIndexes) {
      expect(fundExecution).toMatch(
        new RegExp(`^\\s*${field}\\s+String\\?\\s*$`, "mu")
      );
      expect(fundExecution).toContain(
        `@@index([${field}], map: "${index}")`
      );
      expect(migration).toMatch(
        new RegExp(
          `CREATE INDEX "${index}"\\s+ON "FundExecution"\\("${field}"\\);`,
          "u"
        )
      );
      expect(migration).not.toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "[^"]+"\\s+ON "FundExecution"\\("${field}"\\);`,
          "u"
        )
      );
    }
  });
});
