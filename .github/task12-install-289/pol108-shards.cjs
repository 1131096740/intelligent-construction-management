"use strict";
const assert = require("node:assert/strict");
const SHARDS = {
  "core": {
    "file": "src/database/operating-projection-postgresql.spec.ts",
    "titles": [
      "通过公开写入缝与同一只读快照重算项目四层投影、追溯事实和可分配上限",
      "保持项目/项目集/公司/施工企业/往来方/成本分类/来源下钻与中文导出共用同一投影结果",
      "以同一 readAt 遍历签名游标并排除首屏之后补录的回填确认事实",
      "以窄列跨越稀疏筛选的内部批次且保持公开明细响应不变",
      "通过公开经营账与限制资金释放流程覆盖全部已知影响的导出映射",
      "以上游资金 V2 指纹稳定分页，并在 20,001 行内验证有界快照",
      "对可变参与关系漂移失败关闭，同时忽略 readAt 后新增和范围外关系",
      "在同一事务内对三类明细终态执行 UTF-8 8 MiB 门禁并覆盖临界值",
      "在读取事实前按主体 fallback 预检两类限制来源与高压缩快照字节",
      "在 ORM 明细物化前拒绝普通非限制事实的大快照字节",
      "省略 projectIds 时由后端在 500 个可见项目内取全集并在 501 个时返回 413",
      "在真实高压缩普通事实上执行 64 MiB 逻辑字节下上界且不受账号影响"
    ]
  },
  "facts": {
    "file": "src/database/operating-projection-postgresql-facts.spec.ts",
    "titles": [
      "以公开写入缝验证普通事实 10,001 和 20,000/20,001 的真实数据库预算"
    ]
  },
  "impacts": {
    "file": "src/database/operating-projection-postgresql-impacts.spec.ts",
    "titles": [
      "以公开写入缝验证 50,001 和 100,000/100,001 分录及独立逻辑字节上限"
    ]
  }
};
function selectShards(args) {
  if (!args.length) return Object.values(SHARDS);
  if (args.length !== 2 || args[0] !== "--shard" || !Object.hasOwn(SHARDS, args[1])) {
    throw new Error("POL-108 仅接受 --shard core|facts|impacts；省略则执行全部用例");
  }
  return [SHARDS[args[1]]];
}
function assertTestResults(report, shards) {
  const expected = shards.reduce((sum, shard) => sum + shard.titles.length, 0);
  assert.equal(report.success, true, "POL-108 Jest 未成功");
  for (const key of ["numFailedTests", "numPendingTests", "numTodoTests", "numRuntimeErrorTestSuites"]) {
    assert.equal(report[key], 0, `POL-108 ${key} 必须为 0`);
  }
  assert.equal(report.numTotalTests, expected, "POL-108 实际测试数量不符");
  assert.equal(report.numPassedTests, expected, "POL-108 实际通过数量不符");
  assert.equal(report.testResults.length, shards.length, "POL-108 实际测试文件数量不符");
  for (const shard of shards) {
    const suites = report.testResults.filter(suite => suite.name.replaceAll("\\", "/").endsWith(`/services/api/${shard.file}`));
    assert.equal(suites.length, 1, `POL-108 缺失或重复文件 ${shard.file}`);
    const cases = suites[0].assertionResults;
    assert.ok(cases.every(entry => entry.status === "passed"), "POL-108 用例失败或被跳过");
    assert.deepEqual(cases.map(entry => entry.title).sort(), [...shard.titles].sort(), "POL-108 用例身份不完整");
  }
  return expected;
}
async function runSelectedShards(args, runShard) {
  let total = 0;
  // Each invocation owns its container, migration/seed and result file. Never
  // combine these suites in one database: their seed-project fixtures overlap.
  for (const shard of selectShards(args)) {
    const count = await runShard(shard);
    assert.equal(count, shard.titles.length, "POL-108 分组实跑数量不符");
    total += count;
  }
  return total;
}
module.exports = { SHARDS, selectShards, assertTestResults, runSelectedShards };
