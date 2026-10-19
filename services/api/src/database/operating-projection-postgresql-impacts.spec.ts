import { operatingProjectionPostgresCases } from "./operating-projection-postgresql.cases";

const describePostgres = process.env.RUN_POL108_OPERATING_PROJECTION_PG16 === "1" ? describe : describe.skip;
describePostgres("POL-108 operating projection PostgreSQL 16", () => {
  const testCase = operatingProjectionPostgresCases("impacts");
  it("以公开写入缝验证 50,001 和 100,000/100,001 分录及独立逻辑字节上限", ...testCase("以公开写入缝验证 50,001 和 100,000/100,001 分录及独立逻辑字节上限"));
});
