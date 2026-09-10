import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runner = readFileSync(
  resolve(__dirname, "../../prisma/run-pol279-necessary-expense-reserve-local.cjs"),
  "utf8"
);

describe("POL-279 disposable PostgreSQL 16 runner", () => {
  it("is exact-SHA, clean-worktree, local-only and never pulls an image", () => {
    expect(runner).toContain("LOCAL_PG16_DYNAMIC_GATE");
    expect(runner).toContain("POL279_EXPECTED_SHA");
    expect(runner).toContain('["status", "--porcelain"]');
    expect(runner).toContain('name.endsWith("_DATABASE_URL")');
    expect(runner).toContain('environment.NODE_ENV === "production"');
    expect(runner).toContain('"context", "inspect"');
    expect(runner).toContain('"--publish", `127.0.0.1:${port}:5432`');
    expect(runner).toContain('"--pull=never"');
    expect(runner).toContain('const IMAGE = "postgres:16"');
    expect(runner).toContain("createRunnerCleanup");
  });

  it("deploys twice, seeds only the disposable database and runs the gated public-seam suite", () => {
    expect(runner).toContain("for (let pass = 0; pass < 2; pass += 1)");
    expect(runner).toContain("cwd: temporaryRoot");
    expect(runner).toContain('RUN_POL279_NECESSARY_EXPENSE_RESERVE_PG16: "1"');
    expect(runner).toContain("necessary-expense-reserve-postgresql.spec.ts");
    expect(runner).toContain('productionTouched: false');
  });
});
