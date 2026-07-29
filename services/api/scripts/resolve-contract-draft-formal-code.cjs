const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Prisma, PrismaClient } = require("@prisma/client");
const readiness = require("./inspect-contract-draft-aggregate-readiness.cjs");

const ACTION = "contract.draft.formal_code.disposition";
const MAX_REPORT_AGE_MS = 30 * 60 * 1000;
const EDITABLE_STATUSES = new Set(["draft", "returned", "withdrawn"]);
const DECISIONS = new Set(["retain", "void"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readDatabaseUrl(filePath) {
  try {
    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (!line) return undefined;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    return (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    );
  } catch {
    return undefined;
  }
}

if (!process.env.DATABASE_URL) {
  const databaseUrl = readDatabaseUrl(path.resolve(__dirname, "../.env"));
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
}

function parseArgs(argv) {
  const args = { apply: false };
  const valueFlags = new Map([
    ["--report", "reportPath"],
    ["--contract-version-id", "contractVersionId"],
    ["--decision", "decision"],
    ["--expected-revision", "expectedRevision"],
    ["--expected-database-fingerprint", "expectedDatabaseFingerprint"],
    ["--expected-report-sha256", "expectedReportSha256"],
    ["--actor-user-id", "actorUserId"],
    ["--reason", "reason"],
    ["--confirm", "confirmation"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") {
      args.apply = true;
      continue;
    }
    const key = valueFlags.get(flag);
    invariant(key, `未知参数：${flag}`);
    const value = argv[index + 1];
    invariant(typeof value === "string" && value.length > 0, `${flag} 缺少值`);
    invariant(args[key] === undefined, `${flag} 不能重复`);
    args[key] = key === "expectedRevision" ? Number(value) : value;
    index += 1;
  }
  return args;
}

function expectedConfirmation(contractVersionId, decision) {
  return `RESOLVE_CONTRACT_DRAFT_FORMAL_CODE_${contractVersionId}_${decision}`;
}

function assertApplyGates({
  args,
  report,
  currentDatabaseFingerprint,
  now
}) {
  invariant(args.apply === true, "只有显式 --apply 才能执行正式编号处置");
  invariant(typeof args.reportPath === "string", "apply 必须提供 --report");
  invariant(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      args.contractVersionId ?? ""
    ),
    "apply 必须提供合法 --contract-version-id"
  );
  invariant(DECISIONS.has(args.decision), "--decision 只能是 retain 或 void");
  invariant(
    Number.isInteger(args.expectedRevision) && args.expectedRevision >= 0,
    "apply 必须提供非负整数 --expected-revision"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(args.expectedDatabaseFingerprint ?? ""),
    "apply 必须提供 64 位 --expected-database-fingerprint"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(args.expectedReportSha256 ?? ""),
    "apply 必须提供 64 位 --expected-report-sha256"
  );
  invariant(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      args.actorUserId ?? ""
    ),
    "apply 必须提供合法 --actor-user-id"
  );
  invariant(
    typeof args.reason === "string" &&
      args.reason.trim().length >= 5 &&
      args.reason.trim().length <= 500,
    "apply 必须提供 5–500 字符 --reason"
  );
  invariant(
    args.confirmation ===
      expectedConfirmation(args.contractVersionId, args.decision),
    "正式编号处置确认串不匹配"
  );
  readiness.verifyReport(report);
  invariant(
    report.mode === "read_only" && report.page?.truncated === false,
    "只接受未截断的只读预检报告"
  );
  invariant(
    args.expectedReportSha256 === report.reportSha256,
    "报告 SHA-256 与 --expected-report-sha256 不一致"
  );
  invariant(
    report.databaseFingerprint === args.expectedDatabaseFingerprint &&
      currentDatabaseFingerprint === args.expectedDatabaseFingerprint,
    "数据库 fingerprint 与报告或确认值不一致"
  );
  const generatedAt = new Date(report.generatedAt);
  const reportAgeMs = now.getTime() - generatedAt.getTime();
  invariant(
    Number.isFinite(generatedAt.getTime()) &&
      reportAgeMs >= 0 &&
      reportAgeMs <= MAX_REPORT_AGE_MS,
    "只读预检报告已过期"
  );
  invariant(
    Array.isArray(report.records),
    "只读预检报告缺少 records"
  );
  const matches = report.records.filter(
    (record) => record.contractVersionId === args.contractVersionId
  );
  invariant(matches.length === 1, "只读预检报告未精确包含目标合同版本");
  const record = matches[0];
  const unresolvedFormalCode =
    record.status === "blocking" &&
    Array.isArray(record.reasons) &&
    record.reasons.includes("FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION");
  const retainedFormalCode =
    record.status === "ready" &&
    record.facts?.formalCodeAllocatedWhileDraft === true &&
    record.facts?.formalCodeRetentionConfirmed === true;
  invariant(
    unresolvedFormalCode || retainedFormalCode,
    "目标记录不是待人工处置或已精确保留的提交前正式编号"
  );
  invariant(
    Number(record.facts?.draftRevision) === args.expectedRevision,
    "目标记录 revision 与 --expected-revision 不一致"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(record.facts?.formalCodeSha256 ?? ""),
    "目标记录缺少正式编号 SHA-256"
  );
  return {
    contractVersionId: args.contractVersionId,
    expectedRevision: args.expectedRevision,
    formalCodeSha256: record.facts.formalCodeSha256
  };
}

async function executeResolution({
  store,
  target,
  decision,
  actorUserId,
  reason,
  reportSha256,
  now
}) {
  invariant(DECISIONS.has(decision), "正式编号处置决定无效");
  const current = await store.lockAndLoad(target.contractVersionId);
  invariant(
    current &&
      current.contractVersionId === target.contractVersionId,
    "锁定后合同版本不存在或不匹配"
  );
  await store.assertActorCanResolve(actorUserId, current.projectId);
  invariant(
    EDITABLE_STATUSES.has(String(current.versionStatus)),
    "合同版本已不再是可编辑草稿"
  );
  invariant(
    Number(current.draftRevision) === Number(target.expectedRevision),
    "合同草稿 revision 已变化"
  );
  invariant(
    current.firstSubmittedAt === null &&
      String(current.approvalInstanceCount) === "0",
    "合同已经存在提交审批事实，不能再处置提交前正式编号"
  );
  invariant(
    typeof current.formalCode === "string" && current.formalCode.length > 0,
    "合同当前已没有待处置正式编号"
  );
  const formalCodeSha256 = readiness.sha256(current.formalCode);
  invariant(
    formalCodeSha256 === target.formalCodeSha256,
    "合同正式编号已变化"
  );
  if (
    decision === "retain" &&
    current.currentDispositionDecision === "retain" &&
    current.currentDispositionSha256 === formalCodeSha256
  ) {
    return {
      status: "already_resolved",
      decision,
      contractVersionId: target.contractVersionId,
      writes: 0
    };
  }
  const context = {
    decision,
    actorUserId,
    reason: reason.trim(),
    reportSha256,
    formalCodeSha256,
    expectedRevision: target.expectedRevision,
    now
  };
  let writes = 0;
  if (decision === "void") {
    writes += await store.clearFormalCode(current, context);
  }
  writes += await store.recordDisposition(current, context);
  return {
    status: "applied",
    decision,
    contractVersionId: target.contractVersionId,
    writes
  };
}

function createStore(tx) {
  return {
    async lockAndLoad(contractVersionId) {
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT
          cv."id" AS "contractVersionId",
          cv."draftRevision",
          cv."status" AS "versionStatus",
          cv."firstSubmittedAt",
          c."id" AS "contractId",
          c."projectId",
          c."code" AS "formalCode",
          (SELECT count(*)::text
            FROM "ApprovalInstance" ai
            WHERE ai."businessType" = 'contract_version'
              AND ai."businessId" = cv."id"
              AND ai."flowType" = 'contract.approve') AS "approvalInstanceCount",
          (SELECT a."metadata"->>'decision'
            FROM "AuditLog" a
            WHERE a."businessType" = 'contract_version'
              AND a."businessId" = cv."id"
              AND a."action" = ${ACTION}
            ORDER BY a."createdAt" DESC, a."id" DESC
            LIMIT 1) AS "currentDispositionDecision",
          (SELECT a."metadata"->>'formalCodeSha256'
            FROM "AuditLog" a
            WHERE a."businessType" = 'contract_version'
              AND a."businessId" = cv."id"
              AND a."action" = ${ACTION}
            ORDER BY a."createdAt" DESC, a."id" DESC
            LIMIT 1) AS "currentDispositionSha256"
        FROM "ContractVersion" cv
        JOIN "Contract" c ON c."id" = cv."contractId"
        WHERE cv."id" = ${contractVersionId}
        FOR UPDATE OF cv, c
      `);
      invariant(rows.length === 1, "未找到待处置合同版本");
      return rows[0];
    },
    async assertActorCanResolve(actorUserId, projectId) {
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT u."id"
        FROM "User" u
        JOIN "UserPosition" up ON up."userId" = u."id"
        JOIN "Position" p ON p."id" = up."positionId"
        WHERE u."id" = ${actorUserId}
          AND u."isActive" = true
          AND p."key" = 'contract_director'
          AND (up."projectId" IS NULL OR up."projectId" = ${projectId})
        LIMIT 1
      `);
      invariant(rows.length === 1, "只有合同部主管可以确认提交前正式编号处置");
    },
    async clearFormalCode(record, context) {
      const cleared = await tx.contract.updateMany({
        where: {
          id: record.contractId,
          projectId: record.projectId,
          code: record.formalCode
        },
        data: { code: null }
      });
      invariant(cleared.count === 1, "清除正式编号时合同数据已变化");
      const revised = await tx.contractVersion.updateMany({
        where: {
          id: record.contractVersionId,
          draftRevision: context.expectedRevision,
          status: { in: [...EDITABLE_STATUSES] },
          firstSubmittedAt: null
        },
        data: { draftRevision: { increment: 1 } }
      });
      invariant(revised.count === 1, "清除正式编号时草稿 revision 已变化");
      return cleared.count + revised.count;
    },
    async recordDisposition(record, context) {
      await tx.auditLog.create({
        data: {
          actorUserId: context.actorUserId,
          action: ACTION,
          businessType: "contract_version",
          businessId: record.contractVersionId,
          metadata: {
            decision: context.decision,
            reason: context.reason,
            formalCodeSha256: context.formalCodeSha256,
            reportSha256: context.reportSha256,
            revisionBefore: context.expectedRevision,
            revisionAfter:
              context.decision === "void"
                ? context.expectedRevision + 1
                : context.expectedRevision,
            formalCodeWillNeverBeReused: true
          }
        }
      });
      return 1;
    }
  };
}

function runApplyWithClient({
  prisma,
  target,
  decision,
  actorUserId,
  reason,
  reportSha256,
  now
}) {
  return prisma.$transaction(
    (tx) =>
      executeResolution({
        store: createStore(tx),
        target,
        decision,
        actorUserId,
        reason,
        reportSha256,
        now
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    if (!args.apply) {
      const report = await readiness.inspectWithClient(prisma);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    invariant(process.env.DATABASE_URL, "DATABASE_URL is required");
    const report = JSON.parse(readFileSync(args.reportPath, "utf8"));
    const now = new Date();
    const target = assertApplyGates({
      args,
      report,
      currentDatabaseFingerprint: readiness.databaseFingerprint(
        process.env.DATABASE_URL
      ),
      now
    });
    const result = await runApplyWithClient({
      prisma,
      target,
      decision: args.decision,
      actorUserId: args.actorUserId,
      reason: args.reason,
      reportSha256: args.expectedReportSha256,
      now
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  ACTION,
  MAX_REPORT_AGE_MS,
  parseArgs,
  expectedConfirmation,
  assertApplyGates,
  executeResolution,
  createStore,
  runApplyWithClient
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      "合同草稿正式编号处置失败；未执行或已回滚，请重新生成只读报告后核对授权。\n"
    );
    process.exitCode = 1;
  });
}
