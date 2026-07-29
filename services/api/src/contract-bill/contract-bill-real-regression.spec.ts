import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve(
  __dirname,
  "../../scripts/inspect-contract-bill-regression.cjs"
);

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    sourceSha256: "a".repeat(64),
    sourceSheetName: "脱敏清单",
    taxMode: "single_rate",
    defaultTaxRatePercent: "9",
    rows: [
      {
        quantityCell: {
          value: 2000,
          numFmt: "0.00",
          formulaType: "none"
        },
        grossUnitPriceCell: {
          value: 375,
          numFmt: "0.00",
          formulaType: "none"
        },
        taxRateCell: {
          value: 0.09,
          numFmt: "0%",
          formulaType: "none"
        }
      }
    ],
    expected: {
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: "68807339"
    },
    ...overrides
  };
}

describe("real contract bill regression inspector", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(resolve(tmpdir(), "contract-bill-regression-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function inspect(value: unknown) {
    const fixturePath = resolve(workDir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify(value), "utf8");
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--fixture", fixturePath],
      { encoding: "utf8" }
    );
    const output = result.stdout.trim()
      ? JSON.parse(result.stdout) as Record<string, unknown>
      : null;
    return { ...result, output };
  }

  it("reproduces exact authoritative cents from cell value and number format", () => {
    const result = inspect(fixture());

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.output).toMatchObject({
      status: "matched",
      sourceSha256: "a".repeat(64),
      sourceSheetName: "脱敏清单",
      totals: {
        taxInclusiveAmountCents: "75000000",
        taxExclusiveAmountCents: "68807339",
        taxAmountCents: "6192661"
      },
      rows: [
        {
          rowNumber: 1,
          normalizedTaxRatePercent: "9",
          taxInclusiveAmountCents: "75000000",
          taxExclusiveAmountCents: "68807339",
          taxAmountCents: "6192661",
          taxExclusiveUnitPrice: "344.036695"
        }
      ]
    });
    expect(result.stdout).not.toContain(workDir);
  });

  it("fails closed instead of consuming a formula tax cached result", () => {
    const value = fixture();
    const rows = value.rows as Array<{
      taxRateCell: Record<string, unknown>;
    }>;
    rows[0].taxRateCell.formulaType = "formula";

    const result = inspect(value);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatchObject({
      status: "blocked",
      code: "FORMULA_TAX_RATE_REQUIRES_REVIEW",
      rowNumber: 1
    });
    expect(result.output).not.toHaveProperty("formula");
  });

  it("returns a non-zero mismatch without leaking unknown fixture fields", () => {
    const value = fixture({
      contractName: "不得输出的真实合同名称",
      expected: {
        taxInclusiveAmountCents: "1",
        taxExclusiveAmountCents: "2"
      }
    });

    const result = inspect(value);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatchObject({
      status: "blocked",
      code: "FIXTURE_SCHEMA_INVALID"
    });
    expect(result.stdout).not.toContain("不得输出的真实合同名称");
  });

  it("returns a non-zero result when authoritative totals differ", () => {
    const result = inspect(fixture({
      expected: {
        taxInclusiveAmountCents: "75000000",
        taxExclusiveAmountCents: "68807338"
      }
    }));

    expect(result.status).not.toBe(0);
    expect(result.output).toMatchObject({
      status: "mismatch",
      expected: {
        taxInclusiveAmountCents: "75000000",
        taxExclusiveAmountCents: "68807338"
      },
      totals: {
        taxInclusiveAmountCents: "75000000",
        taxExclusiveAmountCents: "68807339"
      }
    });
  });

  it.todo("runs against the de-identified fixture extracted from the real contract department Excel");
});
