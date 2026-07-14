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
  "src/app/design-tokens.css",
  "src/components/ApprovalTimeline.vue",
  "src/components/BusinessActionPanel.vue",
  "src/components/EvidenceFileCards.vue",
  "src/pages/approval-center/ApprovalCenterPage.vue",
  "src/pages/archives/ArchiveListPage.vue",
  "src/pages/audit/AuditLogPage.vue",
  "src/pages/business-parties/BusinessPartyEditorPage.vue",
  "src/pages/business-parties/BusinessPartyListPage.vue",
  "src/pages/contract-templates/ContractTemplateEditorPage.vue",
  "src/pages/contract-templates/LayoutTemplateEditorPage.vue",
  "src/pages/contract-templates/StandardClauseLibraryPage.vue",
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
  "src/pages/login/ChangePasswordPage.vue",
  "src/pages/login/LoginPage.vue",
  "src/pages/projects/ProjectOperatingOverviewPage.vue",
  "src/pages/projects/ProjectRosterPage.vue",
  "src/pages/route-placeholder/RoutePlaceholderPage.vue",
  "src/pages/search/GlobalSearchPage.vue",
  "src/pages/settings/SettingsPage.vue"
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

const businessLanguageAllowlistedFiles = new Set(["src/api/error-message.ts"]);

const businessLanguagePatterns = [
  { pattern: /\bForbidden\b/, message: "用户可见文案不得出现 Forbidden，请改成中文业务原因和下一步" },
  {
    pattern: /Invalid status transition/i,
    message: "用户可见文案不得出现 Invalid status transition，请说明当前单据为什么不能办理"
  },
  {
    pattern: /contractVersionId required/i,
    message: "用户可见文案不得出现 contractVersionId required，请改为合同版本等中文业务名称"
  },
  {
    pattern: /Missing required project role/i,
    message: "用户可见文案不得出现 Missing required project role，请说明缺少哪个项目岗位权限"
  },
  {
    pattern: /Failed to fetch/i,
    message: "用户可见文案不得出现 Failed to fetch，请改为网络连接失败和下一步建议"
  },
  { pattern: /\bsnapshot\b/i, message: "用户可见文案不得出现 snapshot，请改为审批稿" },
  { pattern: /\bworkflow\b/i, message: "用户可见文案不得出现 workflow，请改为审批进度" },
  { pattern: /\bforceSave\b/i, message: "用户可见文案不得出现 forceSave，请改为保存当前正文" },
  { pattern: /\bbillItem\b/i, message: "用户可见文案不得出现 billItem，请改为合同清单项" }
];

const p0VisualFiles = new Set([
  "src/app/AdminLayout.vue",
  "src/pages/home/HomePage.vue",
  "src/pages/payments/PaymentListPage.vue",
  "src/pages/payments/PaymentWorkbenchPage.vue",
  "src/pages/payments/PaymentDetailPage.vue",
  "src/pages/settlements/SettlementListPage.vue",
  "src/pages/settlements/SettlementDetailPage.vue",
  "src/pages/contracts/ContractListPage.vue",
  "src/pages/contracts/ContractDetailPage.vue",
  "src/components/BusinessStatusSummary.vue",
  "src/components/BusinessDetailHeader.vue",
  "src/components/PaymentConfirmationSummary.vue"
]);

const p0VisualPatterns = [
  { pattern: /\banimation\s*:/i, message: "P0 样板页禁止自定义动画" },
  { pattern: /\btransition\s*:/i, message: "P0 样板页禁止自定义过渡动效" },
  { pattern: /(?:linear|radial)-gradient\s*\(/i, message: "P0 样板页禁止渐变" }
];

const p0BusinessLanguageFiles = new Set([
  "src/pages/home/HomePage.vue",
  "src/pages/payments/PaymentListPage.vue",
  "src/pages/payments/payment-list.config.ts",
  "src/pages/payments/PaymentWorkbenchPage.vue",
  "src/pages/payments/PaymentDetailPage.vue",
  "src/pages/settlements/SettlementListPage.vue",
  "src/pages/settlements/settlement-list.config.ts",
  "src/pages/settlements/SettlementDetailPage.vue",
  "src/pages/settlements/settlement-detail.config.ts",
  "src/pages/contracts/ContractListPage.vue",
  "src/pages/contracts/contract-list.config.ts",
  "src/pages/contracts/ContractDetailPage.vue",
  "src/pages/contracts/contract-detail.config.ts",
  "src/components/PaymentConfirmationSummary.vue"
]);

const p0BusinessLanguagePatterns = [
  { pattern: /读取付款预览/, message: "P0 用户文案应使用校验可付款额度" },
  { pattern: /当前系统未提供/, message: "P0 缺失值应使用中性占位并集中说明" },
  { pattern: /(?:后端|前端|读模型|API\s*约束)/i, message: "P0 用户文案不得暴露实现术语" },
  { pattern: /\b(?:limit|offset|total)\b/i, message: "P0 用户文案不得暴露分页参数" }
];

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function hasNearbyNativeFileInputIgnore(source, inputStart) {
  const lines = source.split(/\r?\n/);
  let cursor = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const nextCursor = cursor + lines[index].length + 1;
    if (inputStart < nextCursor) {
      const start = Math.max(0, index - 1);
      const end = Math.min(lines.length - 1, index + 1);
      for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
        if (lines[lineIndex].includes("ui-rules-ignore: native-file-input")) {
          return true;
        }
      }
      return false;
    }
    cursor = nextCursor;
  }

  return false;
}

function hasDisallowedNativeInput(source) {
  const inputPattern = /<input\b[^>]*>/gi;
  let match;

  while ((match = inputPattern.exec(source)) !== null) {
    const inputTag = match[0];
    const isFileInput = /type\s*=\s*["']file["']/i.test(inputTag);
    if (isFileInput && hasNearbyNativeFileInputIgnore(source, match.index)) {
      continue;
    }

    return true;
  }

  return false;
}

export function findUiRuleViolations(filePath, source) {
  const relative = relativePath(filePath);
  if (allowlistedFiles.has(relative)) return [];

  const violations = [];

  if (hasDisallowedNativeInput(source)) {
    violations.push({ file: relative, message: nativeControlPatterns[1].message });
  }

  for (const rule of [...nativeControlPatterns.slice(0, 1), ...nativeControlPatterns.slice(2), ...visualPatterns]) {
    if (rule.pattern.test(source)) {
      violations.push({ file: relative, message: rule.message });
    }
  }

  if (p0VisualFiles.has(relative)) {
    for (const rule of p0VisualPatterns) {
      if (rule.pattern.test(source)) {
        violations.push({ file: relative, message: rule.message });
      }
    }
  }

  return violations;
}

function visibleTemplateText(source) {
  const match = source.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  if (!match) return "";

  return match[1]
    .replace(/{{[\s\S]*?}}/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function selectedTemplateAttributes(source) {
  const match = source.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  if (!match) return [];

  const values = [];
  const attrPattern =
    /\b(?:aria-label|content|description|label|message|placeholder|title)\s*=\s*"([^"]*)"/gi;
  let attr;
  while ((attr = attrPattern.exec(match[1])) !== null) {
    values.push(attr[1]);
  }
  return values;
}

function scriptUserFacingStrings(relative, source) {
  if (!/(\.config\.ts|\.vue)$/.test(relative)) return [];

  const script = relative.endsWith(".vue")
    ? source.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? ""
    : source;
  const values = [];
  const stringPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let stringLiteral;

  while ((stringLiteral = stringPattern.exec(script)) !== null) {
    values.push(stringLiteral[2]);
  }

  return values;
}

export function findBusinessLanguageViolations(filePath, source) {
  const relative = relativePath(filePath);
  if (businessLanguageAllowlistedFiles.has(relative) || /\.test\.ts$/.test(relative)) return [];

  const candidates = relative.endsWith(".vue")
    ? [visibleTemplateText(source), ...selectedTemplateAttributes(source), ...scriptUserFacingStrings(relative, source)]
    : scriptUserFacingStrings(relative, source);

  const patterns = p0BusinessLanguageFiles.has(relative)
    ? [...businessLanguagePatterns, ...p0BusinessLanguagePatterns]
    : businessLanguagePatterns;

  return candidates.flatMap((candidate) =>
    patterns.flatMap((rule) =>
      rule.pattern.test(candidate) ? [{ file: relative, message: rule.message }] : []
    )
  );
}

function listSourceFiles(dir, pattern = /\.(vue|css)$/) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath, pattern);
    return pattern.test(entry.name) ? [fullPath] : [];
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
      "  <input type=\"text\">",
      "  <button>保存</button>",
      "</template>",
      "<style>",
      "  .x { color: #fff; box-shadow: 0 8px 24px rgba(21, 25, 34, 0.14); }",
      "</style>"
    ].join("\n")
  );
  const ok = findUiRuleViolations(okFile, ":root { --jg-color-bg-panel: #ffffff; }");
  const languageBad = findBusinessLanguageViolations(
    path.join(ROOT, "src/pages/contracts/LanguageBad.vue"),
    [
      "<template>",
      '  <t-alert title="Failed to fetch" />',
      "  <span>snapshot</span>",
      "</template>"
    ].join("\n")
  );
  const languageInternal = findBusinessLanguageViolations(
    path.join(ROOT, "src/pages/contracts/LanguageInternal.vue"),
    [
      "<template>",
      "  {{ snapshot(row).name }}",
      '  <div class="snapshot-attachments">审批附件</div>',
      "</template>",
      "<script setup lang=\"ts\">",
      "const workflowActions = [];",
      "</script>"
    ].join("\n")
  );

  if (
    bad.length < 2 ||
    ok.length !== 0 ||
    !annotated.some((violation) => violation.message === "使用 t-button，不要手写 button") ||
    annotated.filter((violation) => violation.message === "使用 TDesign 输入组件；原生文件输入必须加 ui-rules-ignore").length !== 1 ||
    !annotated.some((violation) => violation.message === "颜色必须来自设计 token") ||
    !annotated.some((violation) => violation.message === "阴影必须来自设计 token") ||
    !languageBad.some((violation) => violation.message.includes("Failed to fetch")) ||
    !languageBad.some((violation) => violation.message.includes("snapshot")) ||
    languageInternal.length !== 0
  ) {
    console.error("UI 和业务语言规则自检失败");
    process.exit(1);
  }

  console.log("UI 和业务语言规则自检通过");
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  runSelfTest();

  const rootArgIndex = process.argv.indexOf("--root");
  const sourceDir = rootArgIndex >= 0 ? path.resolve(process.argv[rootArgIndex + 1]) : DEFAULT_SOURCE_DIR;
  const uiViolations = listSourceFiles(sourceDir).flatMap((filePath) =>
    findUiRuleViolations(filePath, fs.readFileSync(filePath, "utf8"))
  );
  const businessLanguageViolations = listSourceFiles(sourceDir, /\.(vue|ts)$/).flatMap((filePath) =>
    findBusinessLanguageViolations(filePath, fs.readFileSync(filePath, "utf8"))
  );
  const violations = [...uiViolations, ...businessLanguageViolations];

  if (violations.length > 0) {
    violations.forEach((violation) => console.error(`${violation.file}: ${violation.message}`));
    process.exit(1);
  }

  console.log("UI 和业务语言规则检查通过");
}

main();
