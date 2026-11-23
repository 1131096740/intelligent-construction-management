import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  TIERS,
  classifyPath,
  classifyPaths,
  evaluate,
  findDeclaredTier,
  requiredChecks
} from "./verify-verification-tier.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "verify-verification-tier.mjs");

test("数据库迁移与 SQL 一律 T1", () => {
  assert.equal(classifyPath("services/api/prisma/migrations/20261119007000_x/migration.sql").tier, "T1");
  assert.equal(classifyPath("services/api/prisma/schema.prisma").tier, "T1");
  assert.equal(classifyPath("scripts/legacy/report.sql").tier, "T1");
});

test("资金/状态/权限关键词把 API 实现升到 T1", () => {
  for (const file of [
    "services/api/src/settlement/settlement.service.ts",
    "services/api/src/payment/payment-request.ts",
    "services/api/src/contract/contract-lifecycle.ts",
    "services/api/src/approval/parallel-approval.ts",
    "services/api/src/archive/archive-confirmation.ts",
    "packages/shared-domain/src/business-decimal.ts"
  ]) {
    assert.equal(classifyPath(file).tier, "T1", file);
  }
});

test("普通业务实现是 T2，关键词只在业务目录内生效", () => {
  assert.equal(classifyPath("services/api/src/common/pagination.ts").tier, "T2");
  assert.equal(classifyPath("apps/web-admin/src/pages/projects/ProjectList.vue").tier, "T2");
  assert.equal(classifyPath("services/api/scripts/check-business-errors.cjs").tier, "T2");
  assert.equal(classifyPath("services/api/src/unknown-zone/anything.ts").tier, "T2");
});

test("文档、CI、仓库脚本、样式是 T3", () => {
  for (const file of [
    "docs/agents/development-loop.md",
    "PROGRESS.md",
    ".github/workflows/ci.yml",
    "scripts/verify-verification-tier.mjs",
    "apps/web-admin/src/styles/theme.css",
    "apps/web-admin/public/logo.svg"
  ]) {
    assert.equal(classifyPath(file).tier, "T3", file);
  }
});

test("多文件取最高档，空改动按 T3", () => {
  assert.equal(classifyPaths(["docs/a.md", "apps/web-admin/src/x.vue"]).tier, "T2");
  assert.equal(classifyPaths(["docs/a.md", "services/api/prisma/migrations/m/migration.sql"]).tier, "T1");
  assert.equal(classifyPaths([]).tier, "T3");
});

test("声明低于自动计算值被拒，等于或高于通过，缺失被拒", () => {
  assert.equal(evaluate("T1", "T2").ok, false);
  assert.equal(evaluate("T1", "T3").ok, false);
  assert.equal(evaluate("T1", "T1").ok, true);
  assert.equal(evaluate("T2", "T1").ok, true, "自愿升档允许");
  assert.equal(evaluate("T2", "T2").ok, true);
  assert.equal(evaluate("T3", null).ok, false);
});

test("PR 正文解析兼容全角冒号与多余空白", () => {
  assert.equal(findDeclaredTier("验证分档: T2"), "T2");
  assert.equal(findDeclaredTier("## 说明\n\n验证分档 ： T1\n更多"), "T1");
  assert.equal(findDeclaredTier("验证分档: T4"), null);
  assert.equal(findDeclaredTier("没有这一行"), null);
  assert.equal(findDeclaredTier(undefined), null);
});

test("每个档位都有必做清单", () => {
  for (const tier of TIERS) {
    assert.ok(requiredChecks(tier).length >= 3, tier);
  }
  assert.deepEqual(requiredChecks("T9"), []);
});

test("命令行按声明判定退出码", () => {
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  const moneyFiles = "services/api/prisma/migrations/m/migration.sql,docs/a.md";

  assert.equal(run("--files", moneyFiles, "--declare", "T1").status, 0);
  assert.equal(run("--files", moneyFiles, "--declare", "T2").status, 1, "降档必须失败");
  assert.equal(run("--files", "docs/a.md", "--declare", "T3").status, 0);
  assert.equal(run("--files", "docs/a.md").status, 0, "本地不强制声明");
  assert.equal(run("--files", "docs/a.md", "--require-declaration").status, 1, "CI 缺声明必须失败");
  assert.equal(run("--files", "docs/a.md", "--json").status, 0);
});

test("命令行 JSON 输出可用于脚本消费", () => {
  const result = spawnSync(
    process.execPath,
    [script, "--files", "services/api/prisma/schema.prisma", "--declare", "T1", "--json"],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.computed, "T1");
  assert.equal(payload.declared, "T1");
  assert.equal(payload.ok, true);
  assert.ok(payload.requiredChecks.length >= 3);
});
