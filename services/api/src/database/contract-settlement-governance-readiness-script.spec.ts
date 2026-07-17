import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts = require("typescript");

const EXPECTED_CHECKS = {
  migration52: `SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260716160000_contract_tax_facts_and_settlement_drafts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  companyEntities: `SELECT "id", "name", "unifiedSocialCreditCode", "isActive" FROM "CompanyEntity" ORDER BY "createdAt"`,
  duplicateCreditCodes: `SELECT upper(trim("unifiedSocialCreditCode")) code, count(*) FROM "CompanyEntity" WHERE "unifiedSocialCreditCode" IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  activeContracts: `SELECT "status", count(*) FROM "ContractVersion" WHERE "status" IN ('in_approval','approved_pending_seal','in_seal','seal_approved_pending_archive','pending_archive_confirm','approval_pending','approved','sealed_pending_archive') GROUP BY "status"`,
  activeSettlements: `SELECT "status", count(*) FROM "Settlement" WHERE "status" IN ('in_approval','approval_pending','approved_pending_archive','archive_pending','pending_archive_confirm') GROUP BY "status"`
};
const MUTATION_METHODS = new Set([
  "create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"
]);
const PROTECTED_NAMES = new Set(["checks", "name", "query"]);
const SQL_WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|MERGE|COPY|CALL|DO|GRANT|REVOKE)\b/i;
const EXPECTED_TX_CALLS = [
  'tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")',
  'tx.$executeRawUnsafe("SET default_transaction_read_only = on")',
  "tx.$queryRawUnsafe(query)"
];

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collect<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
) {
  const nodes: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
}

function rootIdentifier(expression: ts.Expression) {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function methodName(call: ts.CallExpression) {
  return ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : undefined;
}

function callSignature(call: ts.CallExpression) {
  const argumentsText = call.arguments.map((argument) => {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return JSON.stringify(argument.text);
    }
    return ts.isIdentifier(argument) ? argument.text : "<dynamic>";
  });
  return `${rootIdentifier(call.expression)}.${methodName(call)}(${argumentsText.join(",")})`;
}

function assertExactChecks(sourceFile: ts.SourceFile) {
  const declarations = collect(
    sourceFile,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "checks"
  );
  invariant(declarations.length === 1, "checks must have one declaration");
  const declaration = declarations[0];
  invariant(
    ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.declarations.length === 1 &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0,
    "checks must be declared with const"
  );
  invariant(
    declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer),
    "checks must be a fixed object literal"
  );
  const actual = declaration.initializer.properties.map((property) => {
    invariant(
      ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        (ts.isStringLiteral(property.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(property.initializer)),
      "each check must be a fixed string literal"
    );
    return [property.name.text, property.initializer.text];
  });
  invariant(
    JSON.stringify(actual) === JSON.stringify(Object.entries(EXPECTED_CHECKS)),
    "checks SQL allowlist changed"
  );
}

function targetsProtectedName(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return PROTECTED_NAMES.has(node.text);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const root = rootIdentifier(node);
    return Boolean(root && PROTECTED_NAMES.has(root));
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (targetsProtectedName(child)) found = true;
  });
  return found;
}

function assertNoProtectedWrites(sourceFile: ts.SourceFile) {
  let violation = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      targetsProtectedName(node.left)
    ) {
      violation = true;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      targetsProtectedName(node.operand)
    ) {
      violation = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  invariant(!violation, "protected checks iterator binding is reassigned");
}

function assertChecksIterator(sourceFile: ts.SourceFile, queryCall: ts.CallExpression) {
  let loop: ts.Node | undefined = queryCall.parent;
  while (loop && !ts.isForOfStatement(loop)) loop = loop.parent;
  invariant(loop && ts.isVariableDeclarationList(loop.initializer), "missing checks loop");
  invariant(
    (loop.initializer.flags & ts.NodeFlags.Const) !== 0 &&
      loop.initializer.declarations.length === 1 &&
      loop.initializer.declarations[0].name.getText(sourceFile) === "[name, query]",
    "checks query loop must use const [name, query]"
  );
  invariant(
    loop.expression.getText(sourceFile) === "Object.entries(checks)",
    "checks loop must use Object.entries(checks)"
  );
}

function assertSafeScript(candidateSource: string) {
  const sourceFile = ts.createSourceFile(
    "inspect-contract-settlement-governance-readiness.cjs",
    candidateSource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS
  );
  const calls = collect(sourceFile, ts.isCallExpression).sort(
    (left, right) => left.getStart(sourceFile) - right.getStart(sourceFile)
  );
  assertExactChecks(sourceFile);
  assertNoProtectedWrites(sourceFile);
  invariant(!SQL_WRITE_PATTERN.test(candidateSource), "SQL write keyword is forbidden");

  const transactions = calls.filter(
    (call) => methodName(call) === "$transaction" && rootIdentifier(call.expression) === "prisma"
  );
  invariant(transactions.length === 1, "script must use one Prisma transaction");
  const callback = transactions[0].arguments[0];
  invariant(
    callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body),
    "transaction must use a block callback"
  );
  invariant(
    callback.parameters.length === 1 &&
      ts.isIdentifier(callback.parameters[0].name) &&
      callback.parameters[0].name.text === "tx",
    "transaction callback must bind tx"
  );

  const txCalls = collect(callback.body, ts.isCallExpression)
    .filter((call) => rootIdentifier(call.expression) === "tx")
    .sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile));
  invariant(
    txCalls.every(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        ts.isIdentifier(call.expression.expression) &&
        call.expression.expression.text === "tx"
    ) &&
      JSON.stringify(txCalls.map(callSignature)) === JSON.stringify(EXPECTED_TX_CALLS),
    "transaction tx call allowlist changed"
  );

  const executeCalls = calls.filter((call) => methodName(call) === "$executeRawUnsafe");
  const queryCalls = calls.filter((call) => methodName(call) === "$queryRawUnsafe");
  invariant(
    executeCalls.length === 2 && executeCalls.every((call) => txCalls.includes(call)),
    "execute raw allowlist changed"
  );
  invariant(
    queryCalls.length === 1 && queryCalls[0] === txCalls[2],
    "query raw allowlist changed"
  );
  invariant(
    (candidateSource.match(/\.\$executeRawUnsafe\b/gu) ?? []).length === 2 &&
      (candidateSource.match(/\.\$queryRawUnsafe\b/gu) ?? []).length === 1 &&
      !/\.\$(executeRaw|queryRaw)(?!Unsafe)\b/u.test(candidateSource),
    "raw API reference allowlist changed"
  );
  assertChecksIterator(sourceFile, queryCalls[0]);
  invariant(
    !calls.some((call) => {
      const name = methodName(call);
      return Boolean(name && MUTATION_METHODS.has(name));
    }),
    "Prisma mutation method is forbidden"
  );
}

function replaceOnce(source: string, target: string, replacement: string) {
  const index = source.indexOf(target);
  invariant(index >= 0, `mutation target not found: ${target}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + target.length)}`;
}

function statusValues(sql: string) {
  const inClause = sql.match(/\bIN\s*\(([^)]*)\)/iu)?.[1];
  invariant(inClause, "active status query must contain a fixed IN clause");
  return Array.from(inClause.matchAll(/'([^']+)'/gu), (match) => match[1]);
}

const MUTATIONS: Array<[string, string, string, RegExp]> = [
  ["an unrelated SELECT", EXPECTED_CHECKS.companyEntities, 'SELECT * FROM "User"', /checks SQL/u],
  [
    "an extra tx ORM read",
    "const report = {};",
    "const report = {};\n      report.users = await tx.user.findMany();",
    /tx call/u
  ],
  [
    "checks property reassignment",
    "async function inspect()",
    "checks.companyEntities = checks.migration52;\n\nasync function inspect()",
    /binding is reassigned/u
  ],
  ["a mutable checks declaration", "const checks = {", "let checks = {", /declared with const/u],
  [
    "a mutable query loop binding",
    "for (const [name, query] of Object.entries(checks)) {",
    "for (let [name, query] of Object.entries(checks)) {\n        query = checks.migration52;",
    /binding is reassigned|loop must use const/u
  ],
  [
    "a dynamic raw query argument",
    "tx.$queryRawUnsafe(query)",
    "tx.$queryRawUnsafe(process.env.EXTRA_QUERY + query)",
    /tx call/u
  ],
  [
    "an iterator postfix update",
    "report[name] = await tx.$queryRawUnsafe(query);",
    "report[name] = await tx.$queryRawUnsafe(query);\n        query++;",
    /binding is reassigned/u
  ]
];

describe("contract settlement governance readiness inspection script", () => {
  const scriptPath = resolve(
    __dirname,
    "../../scripts/inspect-contract-settlement-governance-readiness.cjs"
  );
  const source = readFileSync(scriptPath, "utf8");

  it("matches the complete read-only script allowlist", () => {
    expect(() => assertSafeScript(source)).not.toThrow();
  });

  it("keeps the complete active status sets readable", () => {
    expect(statusValues(EXPECTED_CHECKS.activeContracts)).toEqual([
      "in_approval", "approved_pending_seal", "in_seal", "seal_approved_pending_archive",
      "pending_archive_confirm", "approval_pending", "approved", "sealed_pending_archive"
    ]);
    expect(statusValues(EXPECTED_CHECKS.activeSettlements)).toEqual([
      "in_approval", "approval_pending", "approved_pending_archive", "archive_pending",
      "pending_archive_confirm"
    ]);
  });

  it.each(MUTATIONS)("rejects %s", (_name, target, replacement, error) => {
    expect(() => assertSafeScript(replaceOnce(source, target, replacement))).toThrow(error);
  });
});
