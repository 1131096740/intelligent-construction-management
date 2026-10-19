import { operatingProjectionPostgresCases } from "./operating-projection-postgresql.cases";

const describePostgres = process.env.RUN_POL108_OPERATING_PROJECTION_PG16 === "1" ? describe : describe.skip;
describePostgres("POL-108 operating projection PostgreSQL 16", () => {
  const testCase = operatingProjectionPostgresCases("facts");
  it("以公开写入缝验证普通事实 10,001 和 20,000/20,001 的真实数据库预算", ...testCase("以公开写入缝验证普通事实 10,001 和 20,000/20,001 的真实数据库预算"));
});
