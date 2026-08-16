#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REGISTRY_PATH = path.join(ROOT, "docs/product/business-language-surface-registry.json");

function loadRegistry() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.surfaces)) {
    throw new Error("中文业务语言登记表格式不正确");
  }
  for (const surface of registry.surfaces) {
    if (!surface.id || !Array.isArray(surface.paths) || !Array.isArray(surface.forbiddenLiterals)) {
      throw new Error("中文业务语言登记表存在未完整登记的表面");
    }
  }
  for (const scan of registry.automaticScans ?? []) {
    if (!scan.id || !scan.root || !Array.isArray(scan.extensions) || !Array.isArray(scan.forbiddenRegexes)) {
      throw new Error("中文业务语言自动扫描规则格式不正确");
    }
  }
  for (const evidence of registry.artifactEvidence ?? []) {
    if (!evidence.id || !evidence.path || !Array.isArray(evidence.requiredLiterals)) {
      throw new Error("中文业务语言制品证据登记格式不正确");
    }
  }
  return registry;
}

function checkRegistry(registry) {
  const violations = [];
  for (const surface of registry.surfaces) {
    for (const relativePath of surface.paths) {
      const filePath = path.join(ROOT, relativePath);
      if (!fs.existsSync(filePath)) {
        violations.push(`${surface.id}: 文件不存在 ${relativePath}`);
        continue;
      }
      const source = fs.readFileSync(filePath, "utf8");
      for (const literal of surface.forbiddenLiterals) {
        if (source.includes(literal)) {
          violations.push(`${surface.id}: ${relativePath} 包含禁止用户表面内容 ${literal}`);
        }
      }
    }
  }
  return violations;
}

function changedFiles() {
  const outputs = new Set();
  const commands = [
    ["diff", "--name-only", "origin/main...HEAD"],
    ["diff", "--name-only"],
    ["diff", "--name-only", "--cached"],
    ["ls-files", "--others", "--exclude-standard"]
  ];
  for (const args of commands) {
    try {
      execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => outputs.add(value));
    } catch (error) {
      throw new Error(`无法读取 Git 变更，中文业务语言自动扫描拒绝放行：${args.join(" ")}`, { cause: error });
    }
  }
  return outputs;
}

function checkArtifactEvidence(registry) {
  const violations = [];
  for (const evidence of registry.artifactEvidence ?? []) {
    const filePath = path.join(ROOT, evidence.path);
    if (!fs.existsSync(filePath)) {
      violations.push(`${evidence.id}: 制品证据文件不存在 ${evidence.path}`);
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    for (const literal of evidence.requiredLiterals) {
      if (!source.includes(literal)) {
        violations.push(`${evidence.id}: 制品证据缺少 ${literal}`);
      }
    }
  }
  return violations;
}

function checkAutomaticScans(registry) {
  const violations = [];
  const files = changedFiles();
  for (const scan of registry.automaticScans ?? []) {
    for (const relativePath of files) {
      if (!relativePath.startsWith(`${scan.root}/`)) continue;
      if (!scan.extensions.some((extension) => relativePath.endsWith(extension))) continue;
      const filePath = path.join(ROOT, relativePath);
      if (!fs.existsSync(filePath)) continue;
      const source = fs.readFileSync(filePath, "utf8");
      for (const pattern of scan.forbiddenRegexes) {
        if (new RegExp(pattern, "u").test(source)) {
          violations.push(`${scan.id}: ${relativePath} 包含未经业务映射的原始错误信息`);
        }
      }
    }
  }
  return violations;
}

function checkExceptions(registry) {
  const violations = [];
  for (const exception of registry.exceptions ?? []) {
    const filePath = path.join(ROOT, exception.path ?? "");
    if (!exception.path || !exception.literal || !exception.reason || !fs.existsSync(filePath)) {
      violations.push(`例外清单无效：${exception.path ?? "未填写路径"}`);
      continue;
    }
    if (!fs.readFileSync(filePath, "utf8").includes(exception.literal)) {
      violations.push(`例外清单与源码不一致：${exception.path} / ${exception.literal}`);
    }
  }
  return violations;
}

function runSelfTest(registry) {
  const sample = registry.surfaces[0];
  if (!sample || !sample.forbiddenLiterals.includes("追溯编号")) {
    throw new Error("中文业务语言登记表自检失败");
  }
  if (!registry.automaticScans?.some((scan) => scan.id === "changed-web-pages")) {
    throw new Error("中文业务语言自动扫描自检失败");
  }
}

const registry = loadRegistry();
runSelfTest(registry);
const violations = [
  ...checkRegistry(registry),
  ...checkAutomaticScans(registry),
  ...checkArtifactEvidence(registry),
  ...checkExceptions(registry)
];
if (violations.length) {
  violations.forEach((violation) => console.error(violation));
  process.exit(1);
}
console.log("中文业务语言登记表与已知制品泄漏检查通过");
