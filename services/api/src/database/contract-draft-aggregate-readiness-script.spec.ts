import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts = require("typescript");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const readinessTool = require("../../scripts/inspect-contract-draft-aggregate-readiness.cjs") as {
  createReport(input: {
    databaseFingerprint: string;
    generatedAt: string;
    migrationHead: string;
    totalRows: number;
    rows: Array<Record<string, unknown>>;
    maxRows?: number;
  }): Record<string, unknown>;
  verifyReport(report: Record<string, unknown>): void;
};

const scriptPath = resolve(
  __dirname,
  "../../scripts/inspect-contract-draft-aggregate-readiness.cjs"
);

const SQL_WRITE_PATTERN =
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|MERGE|COPY|CALL|DO|GRANT|REVOKE)\b/iu;
const ORM_WRITE_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert"
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collect<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
) {
  const result: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function methodName(call: ts.CallExpression) {
  return ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : undefined;
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

function assertSafeScript(source: string) {
  const ast = ts.createSourceFile(
    "inspect-contract-draft-aggregate-readiness.cjs",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS
  );
  const checksDeclaration = collect(
    ast,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "checks"
  )[0];
  invariant(checksDeclaration?.initializer, "checks declaration is required");
  invariant(
    ts.isCallExpression(checksDeclaration.initializer) &&
      checksDeclaration.initializer.expression.getText(ast) === "Object.freeze",
    "checks must be frozen"
  );
  const checksObject = checksDeclaration.initializer.arguments[0];
  invariant(
    checksObject && ts.isObjectLiteralExpression(checksObject),
    "checks must be a fixed object"
  );
  const checkNames = checksObject.properties.map((property) => {
    invariant(
      ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        (ts.isStringLiteral(property.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(property.initializer)),
      "every query must be a fixed SQL literal"
    );
    invariant(!SQL_WRITE_PATTERN.test(property.initializer.text), "write SQL is forbidden");
    invariant(
      !/objectKey|phone|password|bankAccount|tokenHash|draftData|clauseSnapshot/iu.test(
        property.initializer.text
      ),
      "sensitive business content is forbidden"
    );
    return property.name.text;
  });
  expect(checkNames).toEqual(["migrationHead", "candidateCount", "candidates"]);

  const calls = collect(ast, ts.isCallExpression);
  const transactions = calls.filter(
    (call) =>
      methodName(call) === "$transaction" &&
      rootIdentifier(call.expression) === "prisma"
  );
  expect(transactions).toHaveLength(1);
  const callback = transactions[0].arguments[0];
  invariant(
    callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body),
    "transaction callback is required"
  );
  const txCalls = collect(callback.body, ts.isCallExpression).filter(
    (call) => rootIdentifier(call.expression) === "tx"
  );
  expect(
    txCalls.filter((call) => methodName(call) === "$executeRawUnsafe")
  ).toHaveLength(2);
  expect(
    txCalls.filter((call) => methodName(call) === "$queryRawUnsafe")
  ).toHaveLength(1);
  expect(source).toContain("SET TRANSACTION READ ONLY");
  expect(source).toContain("SET default_transaction_read_only = on");
  expect(source).toContain(
    `d."purpose" = 'draft' AND d."status" = 'success'`,
  );
  expect(source).not.toContain(`d."purpose" = 'draft_preview'`);
  expect(source).toContain("isolationLevel: \"RepeatableRead\"");
  expect(
    calls.some((call) => {
      const method = methodName(call);
      const root = rootIdentifier(call.expression);
      return Boolean(
        method &&
          ORM_WRITE_METHODS.has(method) &&
          (root === "prisma" || root === "tx")
      );
    })
  ).toBe(false);
}

describe("contract draft aggregate readiness inspection", () => {
  it("starts RED until the fixed read-only inspection script exists", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(() => assertSafeScript(source)).not.toThrow();
  });

  it("classifies exact derivations separately from manual review and blocking", () => {
    const tool = readinessTool;
    const report = tool.createReport({
      databaseFingerprint: "db-fingerprint",
      generatedAt: "2026-07-29T12:00:00.000Z",
      migrationHead: "20260729120000_example",
      totalRows: 3,
      rows: [
        {
          contractVersionId: "ready-version",
          versionStatus: "draft",
          draftRevision: 8,
          billCount: "2",
          partyCount: "2",
          attachmentCount: "1",
          latestGeneratedRevision: 8,
          checkpointChangedAfterCreation: false,
          approvalInstanceCount: "1",
          earliestApprovalCreatedAt: "2026-07-01T00:00:00.000Z",
          firstSubmittedAt: null,
          formalCode: null,
          abandonedAt: null,
          takeoverId: null,
          takeoverActivatedAt: null,
          takeoverStatus: null,
          oldContractConfirmedAt: null,
          oldFinanceConfirmedAt: null,
          contractFactsCount: "0",
          financeFactsCount: "0",
          historicalPaidCents: "0",
          itemizedHistoricalPaidCents: "0",
          historicalPaymentCount: "0",
          historicalVoucherCount: "0",
          historicalApprovalPendingPaymentCents: "0",
          historicalApprovedPendingPaymentCents: "0",
          performanceStatus: null,
          settlementClosedAt: null,
          finalSettlementId: null
        },
        {
          contractVersionId: "manual-version",
          versionStatus: "effective",
          draftRevision: 3,
          billCount: "0",
          partyCount: "2",
          attachmentCount: "0",
          latestGeneratedRevision: null,
          checkpointChangedAfterCreation: false,
          approvalInstanceCount: "0",
          earliestApprovalCreatedAt: null,
          firstSubmittedAt: "2026-06-01T00:00:00.000Z",
          formalCode: "HT-2026-001",
          abandonedAt: null,
          takeoverId: null,
          takeoverActivatedAt: null,
          takeoverStatus: null,
          oldContractConfirmedAt: null,
          oldFinanceConfirmedAt: null,
          contractFactsCount: "0",
          financeFactsCount: "0",
          historicalPaidCents: "0",
          itemizedHistoricalPaidCents: "0",
          historicalPaymentCount: "0",
          historicalVoucherCount: "0",
          historicalApprovalPendingPaymentCents: "0",
          historicalApprovedPendingPaymentCents: "0",
          performanceStatus: null,
          settlementClosedAt: "2026-06-30T00:00:00.000Z",
          finalSettlementId: "settlement-final"
        },
        {
          contractVersionId: "blocked-version",
          versionStatus: "abandoned",
          draftRevision: 2,
          billCount: "0",
          partyCount: "0",
          attachmentCount: "0",
          latestGeneratedRevision: null,
          checkpointChangedAfterCreation: true,
          approvalInstanceCount: "0",
          earliestApprovalCreatedAt: null,
          firstSubmittedAt: null,
          formalCode: "HT-DRAFT-001",
          abandonedAt: "2026-07-20T00:00:00.000Z",
          takeoverId: null,
          takeoverActivatedAt: null,
          takeoverStatus: null,
          oldContractConfirmedAt: null,
          oldFinanceConfirmedAt: null,
          contractFactsCount: "0",
          financeFactsCount: "0",
          historicalPaidCents: "0",
          itemizedHistoricalPaidCents: "0",
          historicalPaymentCount: "0",
          historicalVoucherCount: "0",
          historicalApprovalPendingPaymentCents: "0",
          historicalApprovedPendingPaymentCents: "0",
          performanceStatus: null,
          settlementClosedAt: null,
          finalSettlementId: null
        }
      ]
    });

    expect(report).toMatchObject({
      mode: "read_only",
      status: "blocked",
      summary: { ready: 1, manualReview: 1, blocking: 1 },
      records: [
        {
          contractVersionId: "ready-version",
          status: "ready",
          facts: {
            exactVersionReadable: true,
            hasPriorSubmissionEvidence: true
          }
        },
        {
          contractVersionId: "manual-version",
          status: "manual_review",
          reasons: expect.arrayContaining([
            "PERFORMANCE_STATUS_REQUIRES_CONFIRMATION",
            "COMPLETED_STATUS_REQUIRES_CONFIRMATION"
          ])
        },
        {
          contractVersionId: "blocked-version",
          status: "blocking",
          reasons: expect.arrayContaining([
            "ACTIVE_RETENTION_OR_PURGE_CANDIDATE",
            "FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION"
          ])
        }
      ],
      reportSha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(() => tool.verifyReport(report)).not.toThrow();
    expect(() =>
      tool.verifyReport({
        ...report,
        databaseFingerprint: ""
      })
    ).toThrow(/fingerprint/iu);
    expect(() =>
      tool.verifyReport({
        ...report,
        summary: { ready: 99, manualReview: 0, blocking: 0 }
      })
    ).toThrow(/SHA-256/iu);
    expect(JSON.stringify(report)).not.toMatch(
      /objectKey|phone|password|bankAccount|tokenHash/iu
    );
  });

  it("blocks the whole report when pagination is truncated", () => {
    const tool = readinessTool;
    const report = tool.createReport({
      databaseFingerprint: "db-fingerprint",
      generatedAt: "2026-07-29T12:00:00.000Z",
      migrationHead: "20260729120000_example",
      totalRows: 10_001,
      rows: [],
      maxRows: 10_000
    });
    expect(report).toMatchObject({
      status: "blocked",
      page: { totalRows: 10_001, returnedRows: 0, truncated: true },
      summary: { ready: 0, manualReview: 0, blocking: 10_001 },
      records: [],
      blockers: ["REPORT_TRUNCATED"]
    });
  });

  it("blocks the whole report when count and rows change inside the inspection", () => {
    const tool = readinessTool;
    expect(
      tool.createReport({
        databaseFingerprint: "db-fingerprint",
        generatedAt: "2026-07-29T12:00:00.000Z",
        migrationHead: "20260729120000_example",
        totalRows: 1,
        rows: []
      })
    ).toMatchObject({
      status: "blocked",
      blockers: ["CANDIDATE_COUNT_CHANGED"],
      records: [],
      summary: { ready: 0, manualReview: 0, blocking: 1 }
    });
  });
});
