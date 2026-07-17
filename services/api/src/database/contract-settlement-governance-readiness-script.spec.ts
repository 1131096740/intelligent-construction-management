import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts = require("typescript");

const CHECK_NAMES = [
  "migration52",
  "companyEntities",
  "duplicateCreditCodes",
  "activeContracts",
  "activeSettlements"
];
const PRISMA_MUTATION_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert"
]);
const SQL_WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|MERGE|COPY|CALL|DO|GRANT|REVOKE)\b/i;

describe("contract settlement governance readiness inspection script", () => {
  const scriptPath = resolve(
    __dirname,
    "../../scripts/inspect-contract-settlement-governance-readiness.cjs"
  );
  const source = readFileSync(scriptPath, "utf8");
  const sourceFile = ts.createSourceFile(
    scriptPath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS
  );

  function collectCalls(root: ts.Node) {
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(root);
    return calls.sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile));
  }

  function methodName(call: ts.CallExpression) {
    return ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text
      : undefined;
  }

  function rootIdentifier(call: ts.CallExpression) {
    let expression: ts.Expression = call.expression;
    while (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
    ) {
      expression = expression.expression;
    }
    return ts.isIdentifier(expression) ? expression.text : undefined;
  }

  function singleStringArgument(call: ts.CallExpression) {
    if (call.arguments.length !== 1) return undefined;
    const argument = call.arguments[0];
    return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
      ? argument.text
      : undefined;
  }

  function extractChecks() {
    let checksObject: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "checks" &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        checksObject = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!checksObject) throw new Error("checks must be a fixed object literal");

    return checksObject.properties.map((property) => {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isIdentifier(property.name) ||
        (!ts.isStringLiteral(property.initializer) &&
          !ts.isNoSubstitutionTemplateLiteral(property.initializer))
      ) {
        throw new Error("each check must be a fixed string literal");
      }
      return { name: property.name.text, sql: property.initializer.text };
    });
  }

  function extractStatusValues(sql: string) {
    const inClause = sql.match(/\bIN\s*\(([^)]*)\)/iu)?.[1];
    if (!inClause) throw new Error("active status query must contain a fixed IN clause");
    return Array.from(inClause.matchAll(/'([^']+)'/gu), (match) => match[1]);
  }

  function transactionBody() {
    const transactionCalls = collectCalls(sourceFile).filter(
      (call) => methodName(call) === "$transaction" && rootIdentifier(call) === "prisma"
    );
    if (transactionCalls.length !== 1) {
      throw new Error("script must use one Prisma transaction");
    }
    const callback = transactionCalls[0].arguments[0];
    if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
      throw new Error("transaction must use a block callback");
    }
    return callback.body;
  }

  const calls = collectCalls(sourceFile);

  it("keeps exactly the five fixed SELECT checks", () => {
    const checks = extractChecks();
    expect(checks.map((check) => check.name)).toEqual(CHECK_NAMES);
    for (const check of checks) {
      expect(check.sql).toMatch(/^SELECT\b/iu);
    }
    expect(checks[0].sql).toContain(
      "20260716160000_contract_tax_facts_and_settlement_drafts"
    );
    expect(source).not.toMatch(SQL_WRITE_PATTERN);
  });

  it("covers the complete active contract status set", () => {
    const checks = new Map(extractChecks().map((check) => [check.name, check.sql]));
    expect(extractStatusValues(checks.get("activeContracts") ?? "")).toEqual([
      "in_approval",
      "approved_pending_seal",
      "in_seal",
      "seal_approved_pending_archive",
      "pending_archive_confirm",
      "approval_pending",
      "approved",
      "sealed_pending_archive"
    ]);
  });

  it("covers the complete active settlement status set", () => {
    const checks = new Map(extractChecks().map((check) => [check.name, check.sql]));
    expect(extractStatusValues(checks.get("activeSettlements") ?? "")).toEqual([
      "in_approval",
      "approval_pending",
      "approved_pending_archive",
      "archive_pending",
      "pending_archive_confirm"
    ]);
  });

  it("starts the transaction read-only before every other tx database call", () => {
    const txCalls = collectCalls(transactionBody()).filter(
      (call) => rootIdentifier(call) === "tx"
    );
    expect(methodName(txCalls[0])).toBe("$executeRawUnsafe");
    expect(singleStringArgument(txCalls[0])).toBe("SET TRANSACTION READ ONLY");

    const firstQueryIndex = txCalls.findIndex(
      (call) => methodName(call) === "$queryRawUnsafe"
    );
    expect(firstQueryIndex).toBeGreaterThan(0);
  });

  it("allows only fixed raw calls and forbids Prisma mutation methods", () => {
    const executeCalls = calls.filter(
      (call) => methodName(call) === "$executeRawUnsafe"
    );
    expect(
      executeCalls.map((call) => ({
        receiver: rootIdentifier(call),
        command: singleStringArgument(call)
      }))
    ).toEqual([
      { receiver: "tx", command: "SET TRANSACTION READ ONLY" },
      { receiver: "tx", command: "SET default_transaction_read_only = on" }
    ]);
    expect(source.match(/\.\$executeRawUnsafe\b/gu) ?? []).toHaveLength(2);

    const queryCalls = calls.filter((call) => methodName(call) === "$queryRawUnsafe");
    expect(queryCalls).toHaveLength(1);
    expect(source.match(/\.\$queryRawUnsafe\b/gu) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/\.\$(executeRaw|queryRaw)(?!Unsafe)\b/u);
    expect(rootIdentifier(queryCalls[0])).toBe("tx");
    expect(queryCalls[0].arguments).toHaveLength(1);
    expect(ts.isIdentifier(queryCalls[0].arguments[0])).toBe(true);
    expect(queryCalls[0].arguments[0].getText(sourceFile)).toBe("query");

    let parent = queryCalls[0].parent;
    while (parent && !ts.isForOfStatement(parent)) parent = parent.parent;
    if (!parent || !ts.isVariableDeclarationList(parent.initializer)) {
      throw new Error("query must come from the checks iterator");
    }
    const declaration = parent.initializer.declarations[0];
    expect(declaration.name.getText(sourceFile)).toBe("[name, query]");
    expect(parent.expression.getText(sourceFile)).toBe("Object.entries(checks)");

    const rawArgumentSource = [...executeCalls, ...queryCalls]
      .flatMap((call) => [...call.arguments])
      .map((argument) => argument.getText(sourceFile))
      .join("\n");
    expect(rawArgumentSource).not.toMatch(
      /process\.(env|argv)|\+|\$\{|\.concat\s*\(/u
    );

    expect(
      calls
        .map((call) => methodName(call))
        .filter((name): name is string => Boolean(name && PRISMA_MUTATION_METHODS.has(name)))
    ).toEqual([]);
  });
});
