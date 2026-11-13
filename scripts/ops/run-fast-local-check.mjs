#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const startedAt = performance.now();
const report = {
  mode: "default", base: null, head: null,
  coverage: {}, paths: [], commands: [], timings: {}
};
process.on("exit", (code) => {
  report.exitCode = code;
  report.timings.total = Math.round(performance.now() - startedAt);
  writeSync(1, `[check:fast] report: ${JSON.stringify(report)}\n`);
});

const gitBin = process.env.GIT_BIN || "git";
const pnpmBin = process.env.PNPM_BIN || "pnpm";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message, exitCode = 1) {
  console.error(`[check:fast] ${message}`);
  process.exit(exitCode);
}

function assertCommandPassed(command, args, result) {
  if (result.error) {
    fail(`无法执行 ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`${command} ${args.join(" ")} 执行失败`);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  assertCommandPassed(command, args, result);
  return result.stdout;
}

function runTimed(label, command, args) {
  report.commands.push({ label, command, args });
  console.log(`[check:fast] command: ${JSON.stringify({ label, command, args })}`);
  console.log(`[check:fast] ${label} started`);
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    env: process.env,
    cwd: repoRoot,
    stdio: "inherit"
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  report.timings[label] = (report.timings[label] || 0) + elapsedMs;
  if (result.error || result.status !== 0) {
    console.error(`[check:fast] ${label} failed (${elapsedMs} ms)`);
    assertCommandPassed(command, args, result);
  }
  console.log(`[check:fast] ${label} passed (${elapsedMs} ms)`);
}

function runTimedCapture(label, command, args) {
  report.commands.push({ label, command, args });
  console.log(`[check:fast] command: ${JSON.stringify({ label, command, args })}`);
  console.log(`[check:fast] ${label} started`);
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  report.timings[label] = (report.timings[label] || 0) + elapsedMs;
  if (result.error || result.status !== 0) {
    console.error(`[check:fast] ${label} failed (${elapsedMs} ms)`);
    assertCommandPassed(command, args, result);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`[check:fast] ${label} passed (${elapsedMs} ms)`);
  return result.stdout;
}

function readPaths(output) {
  return output.split("\0").filter(Boolean).map((path) => {
    if (path.startsWith("/") || path === ".." || path.startsWith("../") || path.includes("/../")) {
      fail(`Git 返回了不安全的路径: ${JSON.stringify(path)}`);
    }
    return path;
  });
}

const args = process.argv.slice(2);
const development = args.length === 2 && args[0] === "--dev-base";
if (args.length && !development) fail("用法: pnpm check:fast [--dev-base <commit>]");
const collectStartedAt = performance.now();
let baseSha;
if (development) {
  // Full immutable commit IDs only: no flags, shell syntax or moving references.
  if (!/^[0-9a-f]{40}$/u.test(args[1])) fail("开发基线必须是完整40位提交 SHA");
  baseSha = runCapture(gitBin, ["rev-parse", "--verify", `${args[1]}^{commit}`]).trim();
  runCapture(gitBin, ["merge-base", "--is-ancestor", baseSha, "HEAD"]);
  report.mode = "development-delta";
  console.log("[check:fast] delta only: 仅证明开发差量；不证明整分支、CI或发布，最终候选仍须完整门禁");
} else {
  baseSha = runCapture(gitBin, ["merge-base", "origin/main", "HEAD"]).trim();
}
if (!/^[0-9a-f]{40}$/u.test(baseSha)) fail("无法解析比较基线");
report.base = baseSha;
report.head = runCapture(gitBin, ["rev-parse", "HEAD"]).trim();
if (!/^[0-9a-f]{40}$/u.test(report.head)) fail("无法解析 HEAD");
const pathDiff = (...args) => readPaths(runCapture(gitBin, [
  "diff", "--name-only", "-z", "--no-renames", ...args, "--"
]));
report.coverage = {
  committed: pathDiff(baseSha, "HEAD"),
  staged: pathDiff("--cached", "HEAD"),
  unstaged: pathDiff(),
  untracked: readPaths(runCapture(gitBin, ["ls-files", "-z", "--others", "--exclude-standard"]))
};
const changedPaths = [...new Set(Object.values(report.coverage).flat())].sort();
report.paths = changedPaths;
report.timings.collect = Math.round(performance.now() - collectStartedAt);

if (changedPaths.length === 0) {
  console.log("[check:fast] no changes（没有需要检查的变更）");
  process.exit(0);
}

function isDependencyManifest(path) {
  return (
    basename(path) === "package.json" ||
    path === "pnpm-lock.yaml" ||
    path === "pnpm-workspace.yaml" ||
    path === ".npmrc"
  );
}

function isSharedProductionSource(path) {
  return (
    path.startsWith("packages/shared-domain/src/") &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function isGovernanceManifest(path) {
  return (
    path.startsWith("docs/product/") &&
    /(?:capabilit|manifest|readiness|matrix)/iu.test(path)
  );
}

function releaseSensitiveReason(path) {
  if (development && path.startsWith("services/api/") &&
      /(?:^|[/._-])(?:auth|authorization|permission|permissions|role|roles|acl|guard|guards)(?:[/._-]|$)/iu.test(path)) {
    return "权限或身份边界，需要受影响完整检查及真实受限角色验证";
  }
  if (isDependencyManifest(path)) return "依赖或工作区清单";
  if (path.startsWith("services/api/prisma/")) return "数据库 Schema、迁移或动态验证";
  if (isSharedProductionSource(path)) return "跨应用共享领域契约";
  if (path.startsWith(".github/") || path.startsWith("scripts/")) return "发布或运维工具";
  if (isGovernanceManifest(path)) return "发布治理清单";
  return null;
}

function isDocumentation(path) {
  return (
    path.startsWith("docs/") ||
    path.startsWith("obsidian-current/") ||
    /(?:^|\/)(?:AGENTS|PROGRESS|CONTEXT-MAP|README)\.md$/u.test(path) ||
    /\.(?:md|mdx|txt)$/u.test(path)
  );
}

function isWebPath(path) {
  return path.startsWith("apps/web-admin/");
}

function isWebUnitTest(path) {
  return (
    path.startsWith("apps/web-admin/src/") &&
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function isApiPath(path) {
  return path.startsWith("services/api/");
}

function isApiTest(path) {
  return (
    path.startsWith("services/api/src/") &&
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function isSharedTest(path) {
  return (
    path.startsWith("packages/shared-domain/src/") &&
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function runWebChecks(paths) {
  runTimed("web:typecheck", pnpmBin, ["--filter", "@jiangkong/web-admin", "typecheck"]);
  runTimed("web:lint", pnpmBin, ["--filter", "@jiangkong/web-admin", "lint"]);
  runTimed("web:ui-governance", pnpmBin, [
    "--filter",
    "@jiangkong/web-admin",
    "check:ui"
  ]);

  const changedTestPaths = paths.filter(isWebUnitTest);
  if (changedTestPaths.some((path) => !existsSync(resolve(repoRoot, path)))) {
    console.log("[check:fast] deleted test fallback: full web test");
    runTimed("web:full-test", pnpmBin, [
      "--filter",
      "@jiangkong/web-admin",
      "test"
    ]);
    return;
  }
  const changedTests = changedTestPaths.map((path) => resolve(repoRoot, path));
  const relatedSources = paths
    .filter(
      (path) => path.startsWith("apps/web-admin/src/") && !isWebUnitTest(path)
    )
    .map((path) => resolve(repoRoot, path));
  if (relatedSources.length > 0) {
    const output = runTimedCapture("web:related-tests", pnpmBin, [
      "--filter",
      "@jiangkong/web-admin",
      "exec",
      "vitest",
      "related",
      ...relatedSources,
      "--run",
      "--passWithNoTests",
      "--reporter=dot"
    ]);
    if (/No test files found/iu.test(output)) {
      console.log("[check:fast] fallback: full web test");
      runTimed("web:full-test", pnpmBin, [
        "--filter",
        "@jiangkong/web-admin",
        "test"
      ]);
      return;
    }
  }

  if (changedTests.length > 0) {
    runTimed("web:changed-tests", pnpmBin, [
      "--filter",
      "@jiangkong/web-admin",
      "test",
      "--",
      ...changedTests
    ]);
  }
  if (relatedSources.length > 0 || changedTests.length > 0) {
    return;
  }

  console.log("[check:fast] fallback: full web test");
  runTimed("web:full-test", pnpmBin, ["--filter", "@jiangkong/web-admin", "test"]);
}

function runApiTestFiles(testPaths, label) {
  runTimed(label, pnpmBin, [
    "--filter",
    "@jiangkong/api",
    "test",
    "--",
    "--runInBand",
    "--runTestsByPath",
    ...testPaths
  ]);
}

function runApiChecks(paths) {
  runTimed("api:typecheck", pnpmBin, ["--filter", "@jiangkong/api", "typecheck"]);
  runTimed("api:lint", pnpmBin, ["--filter", "@jiangkong/api", "lint"]);
  runTimed("api:business-errors", pnpmBin, [
    "--filter",
    "@jiangkong/api",
    "check:business-errors"
  ]);

  const changedTestPaths = paths.filter(isApiTest);
  if (changedTestPaths.some((path) => !existsSync(resolve(repoRoot, path)))) {
    console.log("[check:fast] deleted test fallback: full api test");
    runTimed("api:full-test", pnpmBin, [
      "--filter",
      "@jiangkong/api",
      "test",
      "--",
      "--runInBand"
    ]);
    return;
  }
  const changedTests = changedTestPaths.map((path) => resolve(repoRoot, path));
  const relatedSources = paths
    .filter((path) => path.startsWith("services/api/src/") && !isApiTest(path))
    .map((path) => resolve(repoRoot, path));
  let relatedTests = [];
  if (relatedSources.length > 0) {
    const output = runTimedCapture("api:related-test-discovery", pnpmBin, [
      "--filter",
      "@jiangkong/api",
      "exec",
      "jest",
      "--listTests",
      "--findRelatedTests",
      ...relatedSources
    ]);
    relatedTests = output.split("\n").filter(Boolean);
    for (const testPath of relatedTests) {
      if (
        !testPath.startsWith(`${repoRoot}/services/api/`) ||
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(testPath)
      ) {
        fail(`Jest 返回了无法验证的测试路径: ${testPath}`);
      }
    }
    if (relatedTests.length === 0) {
      console.log("[check:fast] fallback: full api test");
      runTimed("api:full-test", pnpmBin, [
        "--filter",
        "@jiangkong/api",
        "test",
        "--",
        "--runInBand"
      ]);
      return;
    }
  }

  const selectedTests = [...new Set([...changedTests, ...relatedTests])];
  if (selectedTests.length > 0) {
    runApiTestFiles(selectedTests, "api:selected-tests");
    return;
  }

  console.log("[check:fast] fallback: full api test");
  runTimed("api:full-test", pnpmBin, [
    "--filter",
    "@jiangkong/api",
    "test",
    "--",
    "--runInBand"
  ]);
}

function runSharedChecks({ apiHandled, webHandled }) {
  runTimed("shared-domain:typecheck", pnpmBin, [
    "--filter",
    "@jiangkong/shared-domain",
    "typecheck"
  ]);
  runTimed("shared-domain:lint", pnpmBin, [
    "--filter",
    "@jiangkong/shared-domain",
    "lint"
  ]);
  runTimed("shared-domain:test", pnpmBin, [
    "--filter",
    "@jiangkong/shared-domain",
    "test"
  ]);
  if (!apiHandled) {
    runTimed("shared-domain:api-consumer-typecheck", pnpmBin, [
      "--filter",
      "@jiangkong/api",
      "typecheck"
    ]);
  }
  if (!webHandled) {
    runTimed("shared-domain:web-consumer-typecheck", pnpmBin, [
      "--filter",
      "@jiangkong/web-admin",
      "typecheck"
    ]);
  }
}

const selectionStartedAt = performance.now();
const releaseSensitivePaths = changedPaths
  .map((path) => ({ path, reason: releaseSensitiveReason(path) }))
  .filter(({ reason }) => reason !== null);

report.timings.select = Math.round(performance.now() - selectionStartedAt);

if (releaseSensitivePaths.length > 0) {
  console.error("[check:fast] 快速检查不能安全覆盖以下变更：");
  for (const { path, reason } of releaseSensitivePaths) {
    console.error(`[check:fast] - ${path}（${reason}）`);
  }
  fail("请在精确 SHA 上运行完整门禁：pnpm release:local", 2);
}

if (changedPaths.every(isDocumentation)) {
  console.log("[check:fast] scope: docs");
  console.log(`[check:fast] reason: ${changedPaths.length} 个文件均为文档`);
  runTimed("docs:diff-check", gitBin, ["diff", "--check", baseSha, "--"]);
  process.exit(0);
}

const nonDocumentationPaths = changedPaths.filter((path) => !isDocumentation(path));
const scopeByPath = nonDocumentationPaths.map((path) => {
  if (isWebPath(path)) return "web";
  if (isApiPath(path)) return "api";
  if (isSharedTest(path)) return "shared-domain";
  return null;
});
if (scopeByPath.every((scope) => scope !== null)) {
  const scopes = new Set(scopeByPath);
  const scopeLabel = scopes.size === 1 ? [...scopes][0] : "mixed";
  console.log(`[check:fast] scope: ${scopeLabel}`);
  console.log(
    `[check:fast] reason: ${nonDocumentationPaths.length} 个文件分布在 ${[
      ...scopes
    ].join(" + ")}`
  );
  const hasApi = scopes.has("api");
  const hasWeb = scopes.has("web");
  if (scopes.has("shared-domain")) {
    runSharedChecks({ apiHandled: hasApi, webHandled: hasWeb });
  }
  if (hasApi) runApiChecks(nonDocumentationPaths.filter(isApiPath));
  if (hasWeb) runWebChecks(nonDocumentationPaths.filter(isWebPath));
  process.exit(0);
}

fail("存在尚未归类的变更；请运行 pnpm release:local", 2);
