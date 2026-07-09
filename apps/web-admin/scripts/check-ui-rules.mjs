#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_SOURCE_DIR = path.join(ROOT, "src");

// migration allowlist
const allowlistedFiles = new Set([
  "src/app/App.vue",
  "src/app/AdminLayout.vue",
  "src/app/design-tokens.css",
  "src/components/ApprovalTimeline.vue",
  "src/components/BusinessActionPanel.vue",
  "src/components/EvidenceFileCards.vue",
  "src/pages/approval-center/ApprovalCenterPage.vue",
  "src/pages/archives/ArchiveListPage.vue",
  "src/pages/audit/AuditLogPage.vue",
  "src/pages/business-parties/BusinessPartyEditorPage.vue",
  "src/pages/business-parties/BusinessPartyListPage.vue",
  "src/pages/contract-templates/ContractNumberRulePage.vue",
  "src/pages/contract-templates/ContractTemplateEditorPage.vue",
  "src/pages/contract-templates/ContractTemplateListPage.vue",
  "src/pages/contract-templates/LayoutTemplateEditorPage.vue",
  "src/pages/contract-templates/StandardClauseLibraryPage.vue",
  "src/pages/contracts/ContractDetailPage.vue",
  "src/pages/contracts/ContractListPage.vue",
  "src/pages/contracts/ContractTakeoverPage.vue",
  "src/pages/contracts/ContractWorkbenchPage.vue",
  "src/pages/contracts/workbench/ContractBasicSection.vue",
  "src/pages/contracts/workbench/ContractBillEditor.vue",
  "src/pages/contracts/workbench/ContractBillsSection.vue",
  "src/pages/contracts/workbench/ContractClausesSection.vue",
  "src/pages/contracts/workbench/ContractDocumentsSection.vue",
  "src/pages/contracts/workbench/ContractOverviewSection.vue",
  "src/pages/contracts/workbench/ContractPartySection.vue",
  "src/pages/contracts/workbench/ContractPricingSection.vue",
  "src/pages/contracts/workbench/ContractProfessionalFieldsSection.vue",
  "src/pages/contracts/workbench/ContractReadinessPanel.vue",
  "src/pages/delegations/DelegationListPage.vue",
  "src/pages/home/HomePage.vue",
  "src/pages/login/ChangePasswordPage.vue",
  "src/pages/login/LoginPage.vue",
  "src/pages/payments/PaymentDetailPage.vue",
  "src/pages/payments/PaymentListPage.vue",
  "src/pages/projects/ProjectOperatingOverviewPage.vue",
  "src/pages/projects/ProjectRosterPage.vue",
  "src/pages/route-placeholder/RoutePlaceholderPage.vue",
  "src/pages/search/GlobalSearchPage.vue",
  "src/pages/settings/SettingsPage.vue",
  "src/pages/settlements/SettlementDetailPage.vue",
  "src/pages/settlements/SettlementListPage.vue"
]);

const nativeControlPatterns = [
  { pattern: /<button\b/i, message: "使用 t-button，不要手写 button" },
  { pattern: /<input\b/i, message: "使用 TDesign 输入组件；原生文件输入必须加 ui-rules-ignore" },
  { pattern: /<select\b/i, message: "使用 t-select，不要手写 select" },
  { pattern: /<textarea\b/i, message: "使用 t-textarea，不要手写 textarea" },
  { pattern: /<table\b/i, message: "使用 t-table，不要手写 table" },
  { pattern: /<dialog\b/i, message: "使用 t-dialog，不要手写 dialog" }
];

const visualPatterns = [
  { pattern: /#[0-9a-fA-F]{3,8}\b/, message: "颜色必须来自设计 token" },
  { pattern: /\brgba?\s*\(/i, message: "颜色必须来自设计 token" },
  { pattern: /box-shadow\s*:/i, message: "阴影必须来自设计 token" },
  { pattern: /style="[^"]*color\s*:/i, message: "禁止高风险内联颜色样式" },
  { pattern: /style="[^"]*background/i, message: "禁止高风险内联背景样式" },
  { pattern: /style="[^"]*font-size\s*:/i, message: "禁止高风险内联字号样式" },
  { pattern: /style="[^"]*border-radius\s*:/i, message: "禁止高风险内联圆角样式" }
];

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function hasNativeFileInputIgnore(source) {
  const lines = source.split(/\r?\n/);
  return lines.some((line, index) => {
    if (!/<input\b/i.test(line) || !/type\s*=\s*["']file["']/i.test(line)) {
      return false;
    }

    const start = Math.max(0, index - 1);
    const end = Math.min(lines.length - 1, index + 1);
    for (let cursor = start; cursor <= end; cursor += 1) {
      if (lines[cursor].includes("ui-rules-ignore: native-file-input")) {
        return true;
      }
    }

    return false;
  });
}

export function findUiRuleViolations(filePath, source) {
  const relative = relativePath(filePath);
  if (allowlistedFiles.has(relative)) return [];

  return [...nativeControlPatterns, ...visualPatterns].flatMap((rule) => {
    if (rule.pattern === nativeControlPatterns[1].pattern && hasNativeFileInputIgnore(source)) {
      return [];
    }

    return rule.pattern.test(source) ? [{ file: relative, message: rule.message }] : [];
  });
}

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(vue|css)$/.test(entry.name) ? [fullPath] : [];
  });
}

function runSelfTest() {
  const badFile = path.join(ROOT, "src/pages/contracts/Bad.vue");
  const annotatedFile = path.join(ROOT, "src/pages/contracts/Annotated.vue");
  const okFile = path.join(ROOT, "src/app/design-tokens.css");
  const bad = findUiRuleViolations(
    badFile,
    "<template><button>保存</button></template><style>.x{color:#fff}</style>"
  );
  const annotated = findUiRuleViolations(
    annotatedFile,
    [
      "<template>",
      '  <input type=\"file\"> <!-- ui-rules-ignore: native-file-input -->',
      "  <button>保存</button>",
      "</template>",
      "<style>",
      "  .x { color: #fff; box-shadow: 0 8px 24px rgba(21, 25, 34, 0.14); }",
      "</style>"
    ].join("\n")
  );
  const ok = findUiRuleViolations(okFile, ":root { --jg-color-bg-panel: #ffffff; }");

  if (
    bad.length < 2 ||
    ok.length !== 0 ||
    !annotated.some((violation) => violation.message === "使用 t-button，不要手写 button") ||
    !annotated.some((violation) => violation.message === "颜色必须来自设计 token") ||
    !annotated.some((violation) => violation.message === "阴影必须来自设计 token") ||
    annotated.some((violation) => violation.message.includes("input"))
  ) {
    console.error("UI 规则自检失败");
    process.exit(1);
  }

  console.log("UI 规则自检通过");
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const rootArgIndex = process.argv.indexOf("--root");
  const sourceDir = rootArgIndex >= 0 ? path.resolve(process.argv[rootArgIndex + 1]) : DEFAULT_SOURCE_DIR;
  const violations = listSourceFiles(sourceDir).flatMap((filePath) =>
    findUiRuleViolations(filePath, fs.readFileSync(filePath, "utf8"))
  );

  if (violations.length > 0) {
    violations.forEach((violation) => console.error(`${violation.file}: ${violation.message}`));
    process.exit(1);
  }

  console.log("UI 规则检查通过");
}

main();
