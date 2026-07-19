import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts = require("typescript");

const SERVICE_FILES = [
  "../contract/contract.service.ts",
  "../contract-takeover/contract-takeover.service.ts",
  "../contract-tax-facts/contract-tax-facts.service.ts",
  "../settlement/settlement-draft.service.ts",
  "../settlement/settlement.service.ts",
  "../payment/payment-request.service.ts",
  "../project-expense/project-expense.service.ts",
  "../spot-procurement/spot-procurement-application.service.ts",
  "../spot-procurement/spot-procurement-payment.service.ts",
  "../spot-procurement/spot-procurement-receipt.service.ts",
  "../contract-template/contract-template.service.ts",
  "../contract-template/layout-template.service.ts",
  "../settlement/settlement-template.service.ts"
];

function lifecycleMethods(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true);
  const methods: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^(abandon|discard|reset.*draft)/iu.test(node.name.text)
    ) {
      methods.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return methods.map((method) => ({
    name: (method.name as ts.Identifier).text,
    source: method.getText(sourceFile)
  }));
}

describe("draft lifecycle preserves business records", () => {
  it.each(SERVICE_FILES)("never physically deletes business facts in %s", (relativePath) => {
    const filePath = resolve(__dirname, relativePath);
    for (const method of lifecycleMethods(filePath)) {
      expect(`${method.name}\n${method.source}`).not.toMatch(/\.(delete|deleteMany)\s*\(/u);
      expect(`${method.name}\n${method.source}`).not.toMatch(/\bDELETE\s+FROM\b/iu);
      expect(`${method.name}\n${method.source}`).not.toMatch(/\bTRUNCATE\b/iu);
    }
  });
});
