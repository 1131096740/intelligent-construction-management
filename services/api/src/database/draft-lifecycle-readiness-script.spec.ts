import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts = require("typescript");

const EXPECTED_CHECKS = [
  "migrationCount",
  "contractCandidates",
  "takeoverCandidates",
  "taxRevisionCandidates",
  "settlementCandidates",
  "paymentCandidates",
  "projectExpenseCandidates",
  "spotProcurementCandidates",
  "spotPaymentCandidates",
  "spotReceiptCandidates",
  "templateVersionCandidates",
  "temporaryCandidates"
];
const SQL_WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|MERGE|COPY|CALL|DO|GRANT|REVOKE)\b/iu;
const ORM_WRITE_METHODS = new Set([
  "create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collect<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T) {
  const result: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function methodName(call: ts.CallExpression) {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
}

function rootIdentifier(expression: ts.Expression) {
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function checksObject(sourceFile: ts.SourceFile) {
  const declaration = collect(
    sourceFile,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "checks"
  )[0];
  invariant(declaration, "checks declaration is required");
  invariant(
    ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0,
    "checks must be const"
  );
  invariant(declaration.initializer && ts.isCallExpression(declaration.initializer), "checks must be frozen");
  invariant(
    declaration.initializer.expression.getText(sourceFile) === "Object.freeze",
    "checks must use Object.freeze"
  );
  const object = declaration.initializer.arguments[0];
  invariant(object && ts.isObjectLiteralExpression(object), "checks must be a fixed object literal");
  return object;
}

function assertSafeScript(candidateSource: string) {
  const sourceFile = ts.createSourceFile(
    "inspect-draft-lifecycle-readiness.cjs",
    candidateSource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS
  );
  const object = checksObject(sourceFile);
  const entries = object.properties.map((property) => {
    invariant(
      ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)),
      "every readiness check must be a fixed SQL literal"
    );
    invariant(!SQL_WRITE_PATTERN.test(property.initializer.text), "write SQL is forbidden");
    invariant(!/objectKey|bankAccount|passwordHash|tokenHash/iu.test(property.initializer.text), "sensitive fields are forbidden");
    return property.name.text;
  });
  invariant(JSON.stringify(entries) === JSON.stringify(EXPECTED_CHECKS), "readiness check allowlist changed");

  const calls = collect(sourceFile, ts.isCallExpression);
  const transactions = calls.filter(
    (call) => methodName(call) === "$transaction" && rootIdentifier(call.expression) === "prisma"
  );
  invariant(transactions.length === 1, "script must use exactly one Prisma transaction");
  const callback = transactions[0].arguments[0];
  invariant(callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body), "transaction callback is required");
  const txCalls = collect(callback.body, ts.isCallExpression).filter(
    (call) => rootIdentifier(call.expression) === "tx"
  );
  invariant(
    txCalls.filter((call) => methodName(call) === "$executeRawUnsafe").length === 2,
    "two read-only transaction guards are required"
  );
  invariant(
    txCalls.filter((call) => methodName(call) === "$queryRawUnsafe").length === 1,
    "one allowlisted query iterator is required"
  );
  const rawCalls = calls.filter((call) =>
    ["$executeRawUnsafe", "$queryRawUnsafe", "$executeRaw", "$queryRaw"].includes(methodName(call) ?? "")
  );
  invariant(
    txCalls.length === 3 && rawCalls.length === 3 && rawCalls.every((call) => txCalls.includes(call)),
    "transaction call allowlist changed"
  );
  invariant(
    !calls.some((call) => {
      const method = methodName(call);
      return Boolean(method && ORM_WRITE_METHODS.has(method));
    }),
    "Prisma mutation methods are forbidden"
  );
  invariant(candidateSource.includes("SET TRANSACTION READ ONLY"), "transaction must be read only");
  invariant(candidateSource.includes("SET default_transaction_read_only = on"), "session must fail closed to read only");
  invariant(candidateSource.includes("left(md5"), "business identifiers must be masked");
}

function replaceOnce(source: string, target: string, replacement: string) {
  const index = source.indexOf(target);
  invariant(index >= 0, `mutation target not found: ${target}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + target.length)}`;
}

describe("draft lifecycle readiness inspection script", () => {
  const scriptPath = resolve(__dirname, "../../scripts/inspect-draft-lifecycle-readiness.cjs");
  const source = readFileSync(scriptPath, "utf8");

  it("uses only the fixed read-only and redacted query allowlist", () => {
    expect(() => assertSafeScript(source)).not.toThrow();
  });

  it("rejects a write statement added to an allowlisted query", () => {
    const mutated = replaceOnce(
      source,
      'SELECT count(*)::text AS "count" FROM "_prisma_migrations"',
      'DELETE FROM "User"'
    );
    expect(() => assertSafeScript(mutated)).toThrow(/write SQL/iu);
  });

  it("rejects sensitive storage fields added to a query", () => {
    const mutated = replaceOnce(source, 'left(md5(f."id"), 12)', 'f."objectKey"');
    expect(() => assertSafeScript(mutated)).toThrow(/sensitive fields/iu);
  });
});
