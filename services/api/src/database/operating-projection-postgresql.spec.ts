import { operatingProjectionPostgresCases } from "./operating-projection-postgresql.cases";

const describePostgres = process.env.RUN_POL108_OPERATING_PROJECTION_PG16 === "1" ? describe : describe.skip;
describePostgres("POL-108 operating projection PostgreSQL 16", () => {
  const testCase = operatingProjectionPostgresCases("core");
  it("通过公开写入缝与同一只读快照重算项目四层投影、追溯事实和可分配上限", ...testCase("通过公开写入缝与同一只读快照重算项目四层投影、追溯事实和可分配上限"));
  it("保持项目/项目集/公司/施工企业/往来方/成本分类/来源下钻与中文导出共用同一投影结果", ...testCase("保持项目/项目集/公司/施工企业/往来方/成本分类/来源下钻与中文导出共用同一投影结果"));
  it("以同一 readAt 遍历签名游标并排除首屏之后补录的回填确认事实", ...testCase("以同一 readAt 遍历签名游标并排除首屏之后补录的回填确认事实"));
  it("以窄列跨越稀疏筛选的内部批次且保持公开明细响应不变", ...testCase("以窄列跨越稀疏筛选的内部批次且保持公开明细响应不变"));
  it("通过公开经营账与限制资金释放流程覆盖全部已知影响的导出映射", ...testCase("通过公开经营账与限制资金释放流程覆盖全部已知影响的导出映射"));
  it("以上游资金 V2 指纹稳定分页，并在 20,001 行内验证有界快照", ...testCase("以上游资金 V2 指纹稳定分页，并在 20,001 行内验证有界快照"));
  it("对可变参与关系漂移失败关闭，同时忽略 readAt 后新增和范围外关系", ...testCase("对可变参与关系漂移失败关闭，同时忽略 readAt 后新增和范围外关系"));
  it("在同一事务内对三类明细终态执行 UTF-8 8 MiB 门禁并覆盖临界值", ...testCase("在同一事务内对三类明细终态执行 UTF-8 8 MiB 门禁并覆盖临界值"));
  it("在读取事实前按主体 fallback 预检两类限制来源与高压缩快照字节", ...testCase("在读取事实前按主体 fallback 预检两类限制来源与高压缩快照字节"));
  it("在 ORM 明细物化前拒绝普通非限制事实的大快照字节", ...testCase("在 ORM 明细物化前拒绝普通非限制事实的大快照字节"));
  it("省略 projectIds 时由后端在 500 个可见项目内取全集并在 501 个时返回 413", ...testCase("省略 projectIds 时由后端在 500 个可见项目内取全集并在 501 个时返回 413"));
  it("在真实高压缩普通事实上执行 64 MiB 逻辑字节下上界且不受账号影响", ...testCase("在真实高压缩普通事实上执行 64 MiB 逻辑字节下上界且不受账号影响"));
});
