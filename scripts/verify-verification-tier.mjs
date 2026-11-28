#!/usr/bin/env node
/**
 * 变更分档检查器（T1 / T2 / T3）。
 *
 * 唯一事实来源：本文件的 TIER_RULES。docs/agents/development-loop.md
 * 的「变更分档与必做检查」是它的说明，冲突时以本文件为准。
 *
 * 用法：
 *   node scripts/verify-verification-tier.mjs --explain
 *   node scripts/verify-verification-tier.mjs --base origin/main --explain
 *   node scripts/verify-verification-tier.mjs --base "$PR_BASE_SHA" \
 *     --pr-body "$RUNNER_TEMP/pr-body.txt" --require-declaration
 *   node scripts/verify-verification-tier.mjs --files a.sql,docs/x.md --json
 *
 * 退出码：0 通过，1 声明缺失或低于自动计算值，2 参数或 git 错误。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TIERS = ["T1", "T2", "T3"];

const RANK = { T1: 3, T2: 2, T3: 1 };

/** T1：数据库、资金、状态机、权限、审计、归档、文书字节。 */
const T1_PATHS = [
  [/^services\/api\/prisma\/migrations\//u, "数据库迁移"],
  [/^services\/api\/prisma\/schema\.prisma$/u, "Prisma Schema"],
  [/\.sql$/u, "SQL 文件"]
];

/** 只有这些目录下的“名称含风险关键词”才升到 T1，避免把普通工具脚本拖进真库门。 */
const T1_KEYWORD_SCOPES = [
  /^services\/api\/src\//u,
  /^packages\/shared-domain\/src\//u
];

const T1_KEYWORDS =
  /(payment|settlement|contract|approval|permission|authori[sz]ation|audit|archive|ledger|cash|advance|payable|receivable|refund|transfer|invoice|precision|decimal|money|funding|reimburse|expense|quota|capital|voucher|seal)/iu;

/** T3：文档、清单、CI 与本地脚本、纯样式与静态资源。 */
const T3_PATHS = [
  [/^docs\//u, "文档"],
  [/\.md$/u, "Markdown"],
  [/^\.github\//u, "CI 与仓库配置"],
  [/^scripts\//u, "仓库脚本"],
  [/\.(css|scss|less|sass|svg|png|jpe?g|webp|ico|gif)$/u, "样式或静态资源"]
];

/** T2：其余业务实现。命中不了任何规则时也按 T2（宁可升档）。 */
const T2_PATHS = [
  [/^services\/api\//u, "API 实现"],
  [/^apps\/web-admin\//u, "Web 实现"],
  [/^packages\//u, "共享包"]
];

export const TIER_RULES = { T1_PATHS, T1_KEYWORD_SCOPES, T1_KEYWORDS, T2_PATHS, T3_PATHS };

export const TIER_REQUIREMENTS = {
  T1: [
    "受影响后端回归（相关 Jest，含金额/状态/权限断言）",
    "真实隔离 PostgreSQL 16：受限角色、一次性容器，模拟不能替代真实事务证明",
    "页面或文书受影响时补浏览器/文书门",
    "主回执：docs/progress/ 记录候选、命令、结果与未覆盖边界"
  ],
  T2: [
    "相关单测/回归",
    "受影响包 typecheck 与 lint",
    "Web 改动加 check:ui"
  ],
  T3: [
    "引用/清单检查（inspect:* --check）",
    "Web 可见改动加 check:ui",
    "纯文档改动不触发应用测试"
  ]
};

export function normalizePath(file) {
  return file.replace(/^\.\//u, "").trim();
}

/** 单个文件的档位与原因。 */
export function classifyPath(file) {
  const path = normalizePath(file);
  if (!path) return { tier: "T2", reason: "空路径按 T2" };

  for (const [pattern, reason] of T1_PATHS) {
    if (pattern.test(path)) return { tier: "T1", reason };
  }
  if (T1_KEYWORD_SCOPES.some((scope) => scope.test(path))) {
    const match = T1_KEYWORDS.exec(path);
    if (match) return { tier: "T1", reason: `资金/状态/权限关键词「${match[0]}」` };
  }
  for (const [pattern, reason] of T3_PATHS) {
    if (pattern.test(path)) return { tier: "T3", reason };
  }
  for (const [pattern, reason] of T2_PATHS) {
    if (pattern.test(path)) return { tier: "T2", reason };
  }
  return { tier: "T2", reason: "未命中规则，按 T2 处理" };
}

/** 多文件取最高档。 */
export function classifyPaths(files) {
  const entries = files.map((file) => ({ file: normalizePath(file), ...classifyPath(file) }));
  let tier = "T3";
  for (const entry of entries) {
    if (RANK[entry.tier] > RANK[tier]) tier = entry.tier;
  }
  if (entries.length === 0) tier = "T3";
  const triggered = entries.filter((entry) => entry.tier === tier);
  return { tier, files: entries, triggered, reason: describe(tier, triggered) };
}

function describe(tier, triggered) {
  if (tier === "T3" && triggered.length === 0) return "无改动文件";
  const reasons = [...new Set(triggered.map((entry) => entry.reason))];
  return `${tier} 由 ${triggered.length} 个文件触发（${reasons.join("；")}）`;
}

export function requiredChecks(tier) {
  return TIER_REQUIREMENTS[tier] ?? [];
}

/** 从 PR 正文里取 `验证分档: T2`（兼容全角冒号）。 */
export function findDeclaredTier(text) {
  if (typeof text !== "string") return null;
  const match = /验证分档\s*[:：]\s*(T[123])/u.exec(text);
  return match ? match[1] : null;
}

/** 声明不得低于自动计算值；高于允许（自愿升档）。 */
export function evaluate(computed, declared) {
  if (!declared) {
    return { ok: false, problem: "缺少「验证分档: T1|T2|T3」声明" };
  }
  if (RANK[declared] < RANK[computed]) {
    return { ok: false, problem: `声明 ${declared} 低于自动计算的 ${computed}` };
  }
  return { ok: true, problem: null };
}

export function changedFiles(base) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`git diff 失败（base=${base}）：${result.stderr?.trim() || "未知错误"}`);
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const options = { base: "origin/main", prBody: null, declare: null, requireDeclaration: false, explain: false, json: false, files: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`缺少参数值：${arg}`);
      return argv[index];
    };
    switch (arg) {
      case "--base": options.base = next(); break;
      case "--pr-body": options.prBody = next(); break;
      case "--declare": options.declare = next(); break;
      case "--files": options.files = next().split(",").map((item) => item.trim()).filter(Boolean); break;
      case "--require-declaration": options.requireDeclaration = true; break;
      case "--explain": options.explain = true; break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

const HELP = `变更分档检查器（T1/T2/T3）

  --base <ref>            比较基点，默认 origin/main
  --files a,b,c           直接给出改动文件（跳过 git diff）
  --declare T2            直接给出声明档位
  --pr-body <path>        从 PR 正文文件读取「验证分档: Tn」
  --require-declaration   缺声明即失败（CI 用）
  --explain               打印逐文件判定
  --json                  输出 JSON
`;

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`参数错误：${error.message}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let files;
  try {
    files = options.files ?? changedFiles(options.base);
  } catch (error) {
    console.error(`比较失败：${error.message}`);
    return 2;
  }

  const { tier, triggered } = classifyPaths(files);
  const declared = options.declare
    ?? (options.prBody ? findDeclaredTier(readFileSync(options.prBody, "utf8")) : null);
  const verdict = evaluate(tier, declared);
  // 有声明就按声明判定；没声明时只有 CI 的 --require-declaration 才算失败，本地只用来看清单。
  const ok = declared ? verdict.ok : !options.requireDeclaration;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      computed: tier,
      declared,
      ok,
      problem: verdict.problem,
      base: options.base,
      changedFiles: files.length,
      triggered,
      requiredChecks: requiredChecks(tier)
    }, null, 2)}\n`);
    return ok ? 0 : 1;
  }

  const lines = [
    "== 变更分档 ==",
    `比较基点：${options.files ? "--files（显式给出）" : options.base}`,
    `改动文件：${files.length} 个`,
    `自动计算：${tier}`,
    ""
  ];
  if (options.explain && triggered.length > 0) {
    lines.push("触发原因：");
    for (const entry of triggered.slice(0, 12)) lines.push(`  - ${entry.file}（${entry.reason}）`);
    if (triggered.length > 12) lines.push(`  - ……另有 ${triggered.length - 12} 个同档文件`);
    lines.push("");
  }
  lines.push(`必做检查（${tier}）：`);
  for (const check of requiredChecks(tier)) lines.push(`  - ${check}`);
  lines.push("");
  lines.push(declared ? `声明：${declared}${verdict.ok ? " ✓" : ` ✗ ${verdict.problem}`}` : `声明：未提供${verdict.ok ? "" : ` ✗ ${verdict.problem}`}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
