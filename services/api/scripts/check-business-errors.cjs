#!/usr/bin/env node

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const ts = require("typescript");

const API_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(API_ROOT, "src");
const ASCII_ONLY = /^[\x00-\x7F]+$/;
const ASCII_FRAGMENT = /^[\x00-\x7F]*$/;
const NEST_EXCEPTION_KINDS = new Set([
  "BadRequestException",
  "ForbiddenException",
  "NotFoundException",
  "UnauthorizedException",
  "InternalServerErrorException"
]);
const EXCEPTION_KINDS = new Set([...NEST_EXCEPTION_KINDS, "Error"]);

const ALLOWED_INTERNAL_ERRORS = [
  { file: "src/approval/approval-delegation.service.ts", kind: "Error", message: "Prisma service is required to create approval delegation", expectedOccurrences: 1, reason: "可选依赖注入缺失时的内部构造保护" },
  { file: "src/approval/approval-delegation.service.ts", kind: "Error", message: "Prisma service is required to list approval delegations", expectedOccurrences: 1, reason: "可选依赖注入缺失时的内部查询保护" },
  { file: "src/approval/approval-delegation.service.ts", kind: "Error", message: "Prisma service is required to list active users", expectedOccurrences: 1, reason: "可选依赖注入缺失时的内部查询保护" },
  { file: "src/approval/approval-delegation.service.ts", kind: "Error", message: "Prisma service is required to revoke approval delegation", expectedOccurrences: 1, reason: "可选依赖注入缺失时的内部撤销保护" },
  { file: "src/approval/approval-delegation.service.ts", kind: "Error", message: "Project visibility service is required to scope approval delegation", expectedOccurrences: 1, reason: "项目可见性依赖缺失时的内部保护" },
  { file: "src/approval/approval-form.service.ts", kind: "Error", message: "Prisma and file services are required to generate approval form", expectedOccurrences: 1, reason: "审批单生成依赖缺失时的内部保护" },
  { file: "src/approval/approval-form.service.ts", kind: "Error", message: "Prisma and file services are required to download approval form", expectedOccurrences: 1, reason: "审批单下载依赖缺失时的内部保护" },
  { file: "src/approval/approval-form.service.ts", kind: "Error", message: "Auth service is required to confirm approval form download", expectedOccurrences: 1, reason: "审批单下载认证依赖缺失时的内部保护" },
  { file: "src/approval/approval-form.service.ts", kind: "Error", message: "Prisma service is required to load approval form", expectedOccurrences: 1, reason: "审批单加载依赖缺失时的内部保护" },
  { file: "src/audit/audit.service.ts", kind: "Error", message: "Prisma service is required to list audit logs", expectedOccurrences: 1, reason: "审计查询依赖缺失时的内部保护" },
  { file: "src/audit/audit.service.ts", kind: "Error", message: "Prisma service is required to list file download audit logs", expectedOccurrences: 1, reason: "下载审计查询依赖缺失时的内部保护" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "invalid token encoding", expectedOccurrences: 1, reason: "JWT 解析后统一映射中文 401 的内部哨兵" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "invalid token type", expectedOccurrences: 1, reason: "JWT 解析后统一映射中文 401 的内部哨兵" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "invalid token structure", expectedOccurrences: 1, reason: "JWT 解析后统一映射中文 401 的内部哨兵" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "invalid token header", expectedOccurrences: 1, reason: "JWT 解析后统一映射中文 401 的内部哨兵" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "invalid token payload", expectedOccurrences: 1, reason: "JWT 解析后统一映射中文 401 的内部哨兵" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "invalid token signature", expectedOccurrences: 1, reason: "JWT 解析后统一映射中文 401 的内部哨兵" },
  { file: "src/auth/jwt-token.service.ts", kind: "Error", message: "template:[\"\",\" must be set to a non-default production secret\"]", expectedOccurrences: 1, reason: "生产密钥启动配置保护，不进入业务响应" },
  { file: "src/contract/contract-status.service.ts", kind: "Error", message: "template:[\"Invalid contract status transition: \",\" -> \",\"\"]", expectedOccurrences: 1, reason: "状态机不可达转换的内部诊断" },
  { file: "src/contract-bill/contract-bill-excel.service.ts", kind: "Error", message: "invalid expression", expectedOccurrences: 1, reason: "公式解析后转换为中文预检问题的内部哨兵" },
  { file: "src/contract-bill/contract-bill-excel.service.ts", kind: "Error", message: "unbalanced parentheses", expectedOccurrences: 1, reason: "公式解析后转换为中文预检问题的内部哨兵" },
  { file: "src/contract-bill/contract-bill-excel.service.ts", kind: "Error", message: "unexpected token", expectedOccurrences: 1, reason: "公式解析后转换为中文预检问题的内部哨兵" },
  { file: "src/contract-bill/contract-bill-excel.service.ts", kind: "Error", message: "trailing tokens", expectedOccurrences: 1, reason: "公式解析后转换为中文预检问题的内部哨兵" },
  { file: "src/contract-bill/contract-bill-excel.service.ts", kind: "Error", message: "not JSON", expectedOccurrences: 1, reason: "JSON 兼容解析分支的内部控制流哨兵" },
  { file: "src/contract-bill/contract-bill.service.ts", kind: "Error", message: "not JSON", expectedOccurrences: 1, reason: "JSON 兼容解析分支的内部控制流哨兵" },
  { file: "src/contract-document/pdf-normalizer.ts", kind: "Error", message: "Invalid PNG", expectedOccurrences: 1, reason: "图片解析后由上层固定中文包装的内部哨兵" },
  { file: "src/contract-document/pdf-normalizer.ts", kind: "Error", message: "Invalid JPEG", expectedOccurrences: 4, reason: "图片解析后由上层固定中文包装的内部哨兵" },
  { file: "src/contract-takeover/dto/precheck-contract-takeover-import.dto.ts", kind: "Error", message: "invalid import row", expectedOccurrences: 2, reason: "接管导入 DTO 反射失败后固定中文降级的内部哨兵" },
  { file: "src/contract-workbench/contract-workbench.service.ts", kind: "Error", message: "Unreachable checkpoint transaction retry state", expectedOccurrences: 1, reason: "检查点事务重试耗尽后的不可达内部状态" },
  { file: "src/file/file.service.ts", kind: "Error", message: "not-directory", expectedOccurrences: 1, reason: "私有目录类型检查后固定中文包装的内部哨兵" },
  { file: "src/file/file.service.ts", kind: "Error", message: "template:[\"\",\" is required for COS private storage\"]", expectedOccurrences: 1, reason: "COS 启动配置保护，不进入业务响应" },
  { file: "src/file/file.service.ts", kind: "Error", message: "FILE_DOWNLOAD_SECRET must be set to a non-default secret", expectedOccurrences: 1, reason: "下载密钥启动配置保护，不进入业务响应" },
  { file: "src/project/project.service.ts", kind: "Error", message: "Auth service is required to confirm project receipt", expectedOccurrences: 1, reason: "项目到账认证依赖缺失时的内部保护" },
  { file: "src/project/project.service.ts", kind: "Error", message: "Auth service is required to confirm upstream settlement", expectedOccurrences: 1, reason: "对上结算认证依赖缺失时的内部保护" },
  { file: "src/project/project.service.ts", kind: "Error", message: "Auth service is required to confirm project owner contract", expectedOccurrences: 1, reason: "业主主合同认证依赖缺失时的内部保护" },
  { file: "src/project/project.service.ts", kind: "Error", message: "Auth service is required to review settlement exception quota", expectedOccurrences: 1, reason: "结算例外额度认证依赖缺失时的内部保护" },
  { file: "src/project/project.service.ts", kind: "Error", message: "Auth service is required to review project financing quota", expectedOccurrences: 1, reason: "融资额度认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "Auth service is required to confirm project expense attachment download", expectedOccurrences: 1, reason: "支出附件下载认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "File service is required to create project expense attachment download ticket", expectedOccurrences: 1, reason: "支出附件下载文件依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "Auth service is required to confirm project expense approval PDF download", expectedOccurrences: 1, reason: "支出审批单下载认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "File service is required to create project expense approval PDF download ticket", expectedOccurrences: 1, reason: "支出审批单下载文件依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "Auth service is required to confirm project expense execution", expectedOccurrences: 1, reason: "支出实付认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "Auth service is required to confirm project expense purchase execution", expectedOccurrences: 1, reason: "采购执行认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "Auth service is required to confirm project expense finance record", expectedOccurrences: 1, reason: "支出财务入账认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "Auth service is required to confirm project expense purchase receipt", expectedOccurrences: 1, reason: "采购收货认证依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "File service is required to generate project expense approval PDF", expectedOccurrences: 1, reason: "支出审批 PDF 文件依赖缺失时的内部保护" },
  { file: "src/project-expense/project-expense.service.ts", kind: "Error", message: "File service is required to generate project expense finance PDF", expectedOccurrences: 1, reason: "支出财务 PDF 文件依赖缺失时的内部保护" }
];

function isExcludedTypeScriptFile(fileName) {
  return (
    !fileName.endsWith(".ts") ||
    fileName.endsWith(".d.ts") ||
    /\.(spec|test)\.ts$/.test(fileName)
  );
}

function listTypeScriptFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (!isExcludedTypeScriptFile(entry.name)) {
        files.push(absolute);
      }
    }
  }
  walk(root);
  return files.sort();
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticAsciiMessage(node) {
  const value = unwrapExpression(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return ASCII_ONLY.test(value.text) ? value.text : null;
  }
  if (!ts.isTemplateExpression(value)) return null;
  const fragments = [value.head.text, ...value.templateSpans.map((span) => span.literal.text)];
  return fragments.every((fragment) => ASCII_FRAGMENT.test(fragment))
    ? `template:${JSON.stringify(fragments)}`
    : null;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    const expression = unwrapExpression(node.expression);
    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text;
    }
  }
  return null;
}

function collectStaticValues(node, addFinding) {
  const value = unwrapExpression(node);
  const message = staticAsciiMessage(value);
  if (message !== null) {
    addFinding(value, message);
    return;
  }
  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      collectStaticValues(
        ts.isSpreadElement(element) ? element.expression : element,
        addFinding
      );
    }
    return;
  }
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) {
        collectStaticValues(property.initializer, addFinding);
      } else if (ts.isSpreadAssignment(property)) {
        collectStaticValues(property.expression, addFinding);
      }
    }
  }
}

function collectObjectMessages(node, addFinding) {
  const value = unwrapExpression(node);
  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      collectObjectMessages(
        ts.isSpreadElement(element) ? element.expression : element,
        addFinding
      );
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(value)) return;
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      collectObjectMessages(property.expression, addFinding);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (name === "message" || name === "errors") {
      collectStaticValues(property.initializer, addFinding);
    } else {
      collectObjectMessages(property.initializer, addFinding);
    }
  }
}

function collectDirectMessages(node, addFinding) {
  const value = unwrapExpression(node);
  const message = staticAsciiMessage(value);
  if (message !== null) {
    addFinding(value, message);
    return;
  }
  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      collectDirectMessages(
        ts.isSpreadElement(element) ? element.expression : element,
        addFinding
      );
    }
    return;
  }
  collectObjectMessages(value, addFinding);
}

function importedExceptionBindings(sourceFile) {
  const named = new Map();
  const namespaces = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@nestjs/common"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (NEST_EXCEPTION_KINDS.has(importedName)) {
          named.set(element.name.text, importedName);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  return { named, namespaces };
}

function constructorKind(node, bindings) {
  const target = unwrapExpression(node);
  if (ts.isIdentifier(target)) {
    if (target.text === "Error") return "Error";
    return bindings.named.get(target.text) ?? null;
  }
  if (
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(unwrapExpression(target.expression)) &&
    bindings.namespaces.has(unwrapExpression(target.expression).text) &&
    NEST_EXCEPTION_KINDS.has(target.name.text)
  ) {
    return target.name.text;
  }
  return null;
}

function scanSourceTree(sourceRoot, baseDir = path.dirname(sourceRoot)) {
  const findings = [];
  const files = listTypeScriptFiles(sourceRoot);
  for (const absoluteFile of files) {
    const source = fs.readFileSync(absoluteFile, "utf8");
    const sourceFile = ts.createSourceFile(
      absoluteFile,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const bindings = importedExceptionBindings(sourceFile);
    function visit(node) {
      if (ts.isThrowStatement(node) && node.expression) {
        const expression = unwrapExpression(node.expression);
        if (ts.isNewExpression(expression)) {
          const kind = constructorKind(expression.expression, bindings);
          if (kind) {
            const addFinding = (messageNode, message) => {
              const location = sourceFile.getLineAndCharacterOfPosition(
                messageNode.getStart(sourceFile)
              );
              findings.push({
                file: path.relative(baseDir, absoluteFile).split(path.sep).join("/"),
                line: location.line + 1,
                kind,
                message
              });
            };
            for (const argument of expression.arguments ?? []) {
              collectDirectMessages(argument, addFinding);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return { files, findings };
}

function findingKey(value) {
  return `${value.file}\u0000${value.kind}\u0000${value.message}`;
}

function evaluateFindings(findings, allowlist) {
  const errors = [];
  const actual = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    const current = actual.get(key) ?? { ...finding, occurrences: 0, lines: [] };
    current.occurrences += 1;
    current.lines.push(finding.line);
    actual.set(key, current);
  }

  const allowed = new Map();
  const expectedKeys = ["expectedOccurrences", "file", "kind", "message", "reason"];
  for (const entry of allowlist) {
    const keys = Object.keys(entry).sort();
    const hasExactShape = JSON.stringify(keys) === JSON.stringify(expectedKeys);
    const hasValidValues =
      typeof entry.file === "string" &&
      entry.file.startsWith("src/") &&
      !/[?*\[\]]/.test(entry.file) &&
      EXCEPTION_KINDS.has(entry.kind) &&
      typeof entry.message === "string" &&
      ASCII_ONLY.test(entry.message) &&
      Number.isInteger(entry.expectedOccurrences) &&
      entry.expectedOccurrences > 0 &&
      typeof entry.reason === "string" &&
      entry.reason.trim().length > 0;
    if (!hasExactShape || !hasValidValues) {
      errors.push({ type: "invalid_allow_entry", entry });
      continue;
    }
    const key = findingKey(entry);
    if (allowed.has(key)) {
      errors.push({ type: "duplicate_allow_entry", entry });
      continue;
    }
    allowed.set(key, entry);
  }

  for (const [key, finding] of actual) {
    const entry = allowed.get(key);
    if (!entry) {
      errors.push({ type: "unallowed", finding });
    } else if (finding.occurrences !== entry.expectedOccurrences) {
      errors.push({ type: "count_mismatch", finding, entry });
    }
  }
  for (const [key, entry] of allowed) {
    if (!actual.has(key)) errors.push({ type: "stale_allow_entry", entry });
  }
  return errors;
}

function safeOutputFile(value) {
  if (typeof value !== "string") return "src/<invalid-file>";
  const normalized = value.split(path.sep).join("/");
  if (
    !normalized.startsWith("src/") ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").includes("..") ||
    !/^src\/[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    return "src/<invalid-file>";
  }
  return normalized;
}

function safeOutputLine(value) {
  const text = String(value);
  return /^\d+(,\d+)*$/.test(text) ? text : "-";
}

function describeValue(value, line = "-") {
  const message = typeof value?.message === "string" ? value.message : "";
  const fingerprint = crypto
    .createHash("sha256")
    .update(message)
    .digest("hex")
    .slice(0, 12);
  const kind = EXCEPTION_KINDS.has(value?.kind) ? value.kind : "UnknownException";
  return `${safeOutputFile(value?.file)}:${safeOutputLine(line)} ${kind} sha256:${fingerprint} length=${message.length}`;
}

function formatErrors(errors) {
  return errors.map((error) => {
    if (error.type === "unallowed") {
      return `${describeValue(error.finding, error.finding.line)} 未在允许清单中`;
    }
    if (error.type === "count_mismatch") {
      return `${describeValue(error.finding, error.finding.lines.join(","))} 出现次数 ${error.finding.occurrences}，允许清单要求 ${error.entry.expectedOccurrences}`;
    }
    if (error.type === "stale_allow_entry") {
      return `${describeValue(error.entry)} 允许清单已失效`;
    }
    if (error.type === "duplicate_allow_entry") {
      return `${describeValue(error.entry)} 允许清单重复`;
    }
    return `${describeValue(error.entry)} 允许清单字段必须精确为 file/kind/message/expectedOccurrences/reason`;
  });
}

function run() {
  const result = scanSourceTree(SOURCE_ROOT, API_ROOT);
  const errors = evaluateFindings(result.findings, ALLOWED_INTERNAL_ERRORS);
  if (errors.length) {
    console.error("英文业务错误检查失败：");
    for (const line of formatErrors(errors)) console.error(`- ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `英文业务错误检查通过：扫描 ${result.files.length} 个生产 TypeScript 文件，精确允许 ${result.findings.length} 处内部英文哨兵。`
  );
}

module.exports = {
  ALLOWED_INTERNAL_ERRORS,
  evaluateFindings,
  formatErrors,
  scanSourceTree,
  staticAsciiMessage
};

if (require.main === module) run();
