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
    source: method.getText(sourceFile),
    destructiveCalls: destructiveCalls(method, sourceFile)
  }));
}

function destructiveCalls(method: ts.MethodDeclaration, sourceFile: ts.SourceFile) {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "delete" ||
        node.expression.name.text === "deleteMany")
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(method);
  return calls.map((call) => ({
    source: call.getText(sourceFile),
    isScopedContractDraftEditLeaseCleanup:
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === "deleteMany" &&
      ts.isPropertyAccessExpression(call.expression.expression) &&
      call.expression.expression.name.text === "contractDraftEditLease" &&
      ts.isIdentifier(call.expression.expression.expression) &&
      call.expression.expression.expression.text === "tx" &&
      call.arguments.length === 1 &&
      ts.isObjectLiteralExpression(call.arguments[0]) &&
      call.arguments[0].properties.some((property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "where" &&
        ts.isObjectLiteralExpression(property.initializer) &&
        property.initializer.properties.some((whereProperty) =>
          ts.isPropertyAssignment(whereProperty) &&
          ts.isIdentifier(whereProperty.name) &&
          whereProperty.name.text === "contractVersionId"
        )
      )
  }));
}

describe("draft lifecycle preserves business records", () => {
  it.each(SERVICE_FILES)("never physically deletes business facts in %s", (relativePath) => {
    const filePath = resolve(__dirname, relativePath);
    for (const method of lifecycleMethods(filePath)) {
      for (const call of method.destructiveCalls) {
        expect({
          method: method.name,
          call: call.source,
          reason:
            "lifecycle methods may only delete the current ContractDraftEditLease technical lock",
          isScopedContractDraftEditLeaseCleanup:
            call.isScopedContractDraftEditLeaseCleanup
        }).toEqual(expect.objectContaining({
          isScopedContractDraftEditLeaseCleanup: true
        }));
      }
      expect(`${method.name}\n${method.source}`).not.toMatch(/\bDELETE\s+FROM\b/iu);
      expect(`${method.name}\n${method.source}`).not.toMatch(/\bTRUNCATE\b/iu);
    }
  });
});
