import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
import { HistoryExpenseService, type HistoryExpenseBatchView } from "../history-expense/history-expense.service";

/**
 * #417 真库证据（真实 PostgreSQL 16）：历史无合同费用批量分行核实入账
 *
 * 1) 综合部主管批量导入 20 行历史无合同费用（不补造合同）；
 * 2) 财务逐行核实 18 行，2 行保存待核对；付款状态未知不按已付/未付；
 * 3) 财务主管复核后只入账 18 行，2 行保留且不丢；
 * 4) 已入账事实不可改，重复导入幂等；
 * 5) 空白金额与显式 0 分开，未发生费用不入账；
 * 6) 费用只确认一次成本，不写资金账户、不再扣启用时现金/公司资金期初。
 *
 * 经营账写入通过受控端口记录输入（与既有 #405 真库用例同一口径），
 * 批次、行、复核、激活、审计、资金账户与付款事实均使用真实数据库断言。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue417-history-expense-local.cjs
 */
describe("issue 417 history expense batch PostgreSQL", () => {
  const integrationTest = process.env.ISSUE417_HISTORY_EXPENSE_RUN === "1" ? it : it.skip;

  integrationTest(
    "imports 20 rows, verifies 18, keeps 2 pending, posts only verified rows once",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const posted: Array<{ input: AppendOperatingFactInput; entryKind: string }> = [];
      const factIds = new Map<string, string>();
      const ledger = {
        async replayFromSourceInTransaction(
          _tx: unknown,
          input: AppendOperatingFactInput,
          _actorUserId: string,
          entryKind = "original"
        ) {
          const existing = factIds.get(input.idempotencyKey);
          if (existing) {
            return {
              id: existing,
              projectId: input.projectId,
              sourceType: input.sourceType,
              sourceBusinessId: input.sourceBusinessId,
              created: false,
              impactIds: []
            };
          }
          const id = randomUUID();
          factIds.set(input.idempotencyKey, id);
          posted.push({ input, entryKind });
          return {
            id,
            projectId: input.projectId,
            sourceType: input.sourceType,
            sourceBusinessId: input.sourceBusinessId,
            created: true,
            impactIds: input.impacts.map(() => randomUUID())
          };
        }
      };
      const service = new HistoryExpenseService(
        prisma as never,
        new ProjectVisibilityService(prisma as never),
        new AuditService(),
        ledger as never
      );
      try {
        if (process.env.ISSUE417_EXACT_FORWARD_RUN_ID) {
          await assertExactForwardDatabase(prisma, databaseUrl);
        }
        const fixture = await seedFixture(prisma);
        const rows = twentyRows();
        const baseline = await writableFacts(prisma);

        // 1) 权限：只有综合部主管能登记/导入。
        await expect(
          service.precheck(fixture.projectId, fixture.financeStaffUserId, { rows })
        ).rejects.toThrow("无权");
        const checked = await service.precheck(
          fixture.projectId,
          fixture.comprehensiveDirectorUserId,
          { rows }
        );
        assert.equal(checked.zeroWrites, true);
        assert.equal(checked.rows.length, 20);
        assert.equal(checked.blockingRows, 0);
        assert.deepEqual(
          await writableFacts(prisma),
          baseline,
          "预检不得写任何正式事实"
        );

        // 2) 空白金额不是 0；显式 0 才允许标记未发生。
        const blankAmount = await service.precheck(
          fixture.projectId,
          fixture.comprehensiveDirectorUserId,
          { rows: [row(91, { amountYuan: "" })] }
        );
        assert.equal(blankAmount.blockingRows, 1);
        assert.ok(
          blankAmount.rows[0]!.issues.some((issue) => issue.code === "amount_required")
        );
        const explicitZero = await service.precheck(
          fixture.projectId,
          fixture.comprehensiveDirectorUserId,
          { rows: [row(92, { amountYuan: "0" })] }
        );
        assert.equal(explicitZero.blockingRows, 0);
        assert.ok(
          explicitZero.rows[0]!.issues.some(
            (issue) => issue.code === "zero_amount" && issue.severity === "warning"
          )
        );

        // 3) 综合部主管建批次；重复导入幂等，不新增第二批次。
        const created = await service.createBatch(
          fixture.projectId,
          fixture.comprehensiveDirectorUserId,
          { rows }
        );
        assert.equal(created.idempotent, false);
        assert.equal(created.status, "under_review");
        assert.equal(created.totalRows, 20);
        assert.equal(created.pendingRows, 20);
        assert.equal(created.activatedRows, 0);
        const replayImport = await service.createBatch(
          fixture.projectId,
          fixture.comprehensiveDirectorUserId,
          { rows }
        );
        assert.equal(replayImport.idempotent, true);
        assert.equal(replayImport.id, created.id);
        assert.equal(
          await prisma.operatingTakeoverBatch.count({
            where: { projectId: fixture.projectId }
          }),
          1,
          "同一输入重复导入不得新增批次"
        );

        // 4) 财务逐行核实 18 行；2 行保留待核对，付款状态未知不伪造已付/未付。
        let detail: HistoryExpenseBatchView = created;
        for (const target of detail.rows) {
          if (target.rowNo > 18) continue;
          detail = await service.verifyRow(
            fixture.projectId,
            detail.id,
            target.id,
            fixture.financeStaffUserId,
            {
              expectedRevision: target.revision,
              reviewOutcome: "verified",
              note: "财务核对原始凭据与付款情况"
            }
          );
        }
        assert.equal(detail.verifiedRows, 18);
        assert.equal(detail.pendingRows, 2);
        assert.equal(detail.activatedRows, 0);
        const unknownPayment = detail.rows.find((item) => item.rowNo === 19)!;
        assert.equal(unknownPayment.paymentStatus, "unknown");
        assert.equal(unknownPayment.paidAmountCents, null);
        const pendingUnknown = detail.rows.find((item) => item.rowNo === 20)!;
        assert.equal(pendingUnknown.paymentStatus, "unknown");
        assert.equal(pendingUnknown.reviewStatus, "pending");

        // 核实后内容变化必须重新主管复核。
        await expect(
          service.confirm(fixture.projectId, detail.id, fixture.financeStaffUserId, {
            expectedRevision: detail.revision,
            idempotencyKey: randomUUID()
          })
        ).rejects.toThrow("无权");

        const confirmation = await service.confirm(
          fixture.projectId,
          detail.id,
          fixture.financeDirectorUserId,
          { expectedRevision: detail.revision, idempotencyKey: randomUUID() }
        );
        assert.ok(confirmation.confirmedAt);

        // 5) 财务主管激活：只把已核实 18 行入账，待核对 2 行保留。
        const activated = await service.activate(
          fixture.projectId,
          detail.id,
          fixture.financeDirectorUserId,
          { expectedRevision: confirmation.revision + 1 }
        );
        assert.equal(activated.activatedRows, 18);
        assert.equal(activated.pendingRows, 2);
        assert.equal(activated.status, "partially_activated");
        assert.equal(posted.length, 18, "费用成本只写一次，待核对行不入账");

        const confirmedCosts = posted.flatMap(({ input }) =>
          input.impacts.filter((impact) => impact.impactKind === "confirmed_cost")
        );
        assert.equal(confirmedCosts.length, 18);
        assert.equal(
          confirmedCosts.reduce((sum, impact) => sum + (impact.amountCents ?? 0n), 0n),
          1_800_000n,
          "18 行 × 1000 元只确认一次成本"
        );
        const fundImpacts = posted.flatMap(({ input }) =>
          input.impacts.filter((impact) =>
            [
              "company_project_funds_decrease",
              "company_project_funds_increase",
              "public_cash_funds_decrease"
            ].includes(impact.impactKind)
          )
        );
        assert.equal(fundImpacts.length, 0, "历史费用实付不再扣资金账户/期初");
        assert.equal(
          posted.every(
            ({ input }) =>
              input.factKind === "expense" &&
              input.operatingLevel === "project" &&
              input.isBeforeOperatingLedgerEffectiveDate === true &&
              input.historicalTakeoverBatchId === created.id
          ),
          true
        );

        // 未付款与部分付款保留应付余额；已付款不再生成应付。
        const unpaidInput = posted.find(
          ({ input }) =>
            (input.sourceSnapshot.values as Record<string, unknown>).businessRef ===
            "历史费用-007"
        )!.input;
        assert.ok(
          unpaidInput.impacts.some(
            (impact) =>
              impact.impactKind === "payable_increase" && impact.amountCents === 100_000n
          )
        );
        const partialInput = posted.find(
          ({ input }) =>
            (input.sourceSnapshot.values as Record<string, unknown>).businessRef ===
            "历史费用-011"
        )!.input;
        assert.ok(
          partialInput.impacts.some(
            (impact) =>
              impact.impactKind === "payable_increase" && impact.amountCents === 60_000n
          )
        );
        const paidInput = posted.find(
          ({ input }) =>
            (input.sourceSnapshot.values as Record<string, unknown>).businessRef ===
            "历史费用-001"
        )!.input;
        assert.equal(
          paidInput.impacts.some((impact) => impact.impactKind === "payable_increase"),
          false
        );

        // 公司/来源不明：费用与实付仍确认，主体来源待核对。
        const unknownPayerInput = posted.find(
          ({ input }) =>
            (input.sourceSnapshot.values as Record<string, unknown>).businessRef ===
            "历史费用-015"
        )!.input;
        assert.equal(
          (unknownPayerInput.sourceSnapshot.fact as Record<string, unknown>)
            .payerSourcePending,
          true
        );
        assert.ok(
          unknownPayerInput.impacts.some(
            (impact) =>
              impact.impactKind === "evidence_gap_notice" &&
              impact.description === "付款公司/资金来源待核对"
          )
        );
        assert.ok(
          unknownPayerInput.impacts.some(
            (impact) =>
              impact.impactKind === "confirmed_cost" && impact.amountCents === 100_000n
          )
        );

        // 6) 重复激活不重复计成本；已入账行不可改。
        const replayed = await service.activate(
          fixture.projectId,
          detail.id,
          fixture.financeDirectorUserId,
          { expectedRevision: confirmation.revision + 1 }
        );
        assert.equal(replayed.activatedRows, 18);
        assert.equal(posted.length, 18, "同一批次重复激活不得重复入账");
        await expect(
          service.verifyRow(
            fixture.projectId,
            detail.id,
            detail.rows[0]!.id,
            fixture.financeStaffUserId,
            {
              expectedRevision: detail.rows[0]!.revision,
              reviewOutcome: "verified",
              note: "尝试修改已入账事实"
            }
          )
        ).rejects.toThrow("已入账事实不可改");

        // 7) 待核对行改为显式 0 并标记未发生，原行保留且不入账。
        const pendingRow = replayed.rows.find((item) => item.rowNo === 19)!;
        const notOccurred = await service.verifyRow(
          fixture.projectId,
          replayed.id,
          pendingRow.id,
          fixture.financeStaffUserId,
          {
            expectedRevision: pendingRow.revision,
            reviewOutcome: "not_occurred",
            note: "经核对这笔费用最终未发生",
            values: { amountYuan: "0", paidAmountYuan: null, paymentStatus: "unknown" }
          }
        );
        const zeroRow = notOccurred.rows.find((item) => item.rowNo === 19)!;
        assert.equal(zeroRow.reviewStatus, "not_occurred");
        assert.equal(zeroRow.amountCents, "0");
        assert.equal(zeroRow.generatedFactId, null);
        assert.equal(posted.length, 18, "未发生费用不进经营账成本");
        assert.equal(
          notOccurred.rows.find((item) => item.rowNo === 20)!.reviewStatus,
          "pending",
          "未核清的其余行仍然保留"
        );

        // 8) 补资料：待核对行补齐付款公司与付款情况后重新核实并入账，原行与旧核实事实保留。
        const pendingRow20 = notOccurred.rows.find((item) => item.rowNo === 20)!;
        const supplemented = await service.verifyRow(
          fixture.projectId,
          notOccurred.id,
          pendingRow20.id,
          fixture.financeStaffUserId,
          {
            expectedRevision: pendingRow20.revision,
            reviewOutcome: "verified",
            note: "补齐原始付款凭据后重新核实",
            values: {
              payerCompanyName: "合成承担公司",
              paymentStatus: "paid",
              paidAmountYuan: "1000.00",
              costBearingCompanyName: "合成承担公司"
            }
          }
        );
        const row20 = supplemented.rows.find((item) => item.rowNo === 20)!;
        assert.equal(row20.reviewStatus, "verified");
        const row20Snapshot = await prisma.operatingTakeoverRow.findUniqueOrThrow({
          where: { id: row20.id }
        });
        const row20Values = row20Snapshot.valuesSnapshot as Record<string, unknown>;
        const row20History = row20Values._history as Array<{
          reviewStatus: string;
          values: Record<string, unknown>;
        }>;
        assert.ok(row20History.length >= 1, "补资料必须保留原有核实事实");
        assert.equal(row20History.at(-1)!.reviewStatus, "pending");
        assert.equal(row20History.at(-1)!.values.paymentStatus, "unknown");
        assert.equal(row20Values.paymentStatus, "paid");
        assert.equal(row20Snapshot.amountCents, 100_000n, "原行金额未被覆盖");

        await expect(
          service.activate(
            fixture.projectId,
            notOccurred.id,
            fixture.financeDirectorUserId,
            { expectedRevision: supplemented.revision }
          )
        ).rejects.toThrow("主管复核");

        const supplementConfirmation = await service.confirm(
          fixture.projectId,
          notOccurred.id,
          fixture.financeDirectorUserId,
          { expectedRevision: supplemented.revision, idempotencyKey: randomUUID() }
        );
        const supplementedActivated = await service.activate(
          fixture.projectId,
          notOccurred.id,
          fixture.financeDirectorUserId,
          { expectedRevision: supplementConfirmation.revision + 1 }
        );
        assert.equal(supplementedActivated.status, "activated");
        assert.equal(supplementedActivated.activatedRows, 19);
        assert.equal(posted.length, 19, "补资料后重新核实只新增一行成本");
        assert.equal(
          posted
            .flatMap(({ input }) =>
              input.impacts.filter((impact) => impact.impactKind === "confirmed_cost")
            )
            .reduce((sum, impact) => sum + (impact.amountCents ?? 0n), 0n),
          1_900_000n
        );

        // 9) 更正：已入账行反转 + 重登，原行与复核事实保留，净额正确且不重复。
        const originalRow1 = supplementedActivated.rows.find((item) => item.rowNo === 1)!;
        const originalFactId = originalRow1.generatedFactId!;
        assert.ok(originalFactId);
        await expect(
          service.correctRow(
            fixture.projectId,
            supplementedActivated.id,
            originalRow1.id,
            fixture.financeStaffUserId,
            {
              expectedRevision: originalRow1.revision,
              reason: "财务人员不能更正已入账费用",
              values: { amountYuan: "700.00" }
            }
          )
        ).rejects.toThrow("无权");
        const corrected = await service.correctRow(
          fixture.projectId,
          supplementedActivated.id,
          originalRow1.id,
          fixture.financeDirectorUserId,
          {
            expectedRevision: originalRow1.revision,
            reason: "原始凭据金额更正为700元",
            values: {
              amountYuan: "700.00",
              paidAmountYuan: "700.00",
              paymentStatus: "paid"
            }
          }
        );
        const correctionRow = corrected.rows.find((item) => item.rowNo === 21)!;
        assert.equal(correctionRow.reviewStatus, "activated");
        assert.equal(correctionRow.amountCents, "70000");
        assert.equal(
          (correctionRow.values._correction as Record<string, unknown>).originalRowId,
          originalRow1.id
        );
        const preservedOriginal = await prisma.operatingTakeoverRow.findUniqueOrThrow({
          where: { id: originalRow1.id }
        });
        assert.equal(preservedOriginal.generatedFactId, originalFactId, "原行事实不变");
        assert.equal(preservedOriginal.amountCents, 100_000n, "原行金额不被覆盖");
        assert.equal(preservedOriginal.reviewStatus, "activated");
        assert.equal(
          await prisma.operatingTakeoverConfirmation.count(),
          2,
          "原复核事实保留：初次复核与补资料复核均在"
        );
        const correctionAudit = await prisma.auditLog.findFirstOrThrow({
          where: { action: "history_expense.row.correct", businessId: originalRow1.id }
        });
        assert.equal(
          (correctionAudit.metadata as Record<string, unknown>).deltaCents,
          "-30000"
        );
        await expect(
          service.correctRow(
            fixture.projectId,
            corrected.id,
            originalRow1.id,
            fixture.financeDirectorUserId,
            {
              expectedRevision: originalRow1.revision,
              reason: "重复更正",
              values: { amountYuan: "600.00" }
            }
          )
        ).rejects.toThrow("已经更正");

        assert.equal(posted.length, 21, "更正只追加反转与重登两条事实");
        const reversal = posted.find(({ entryKind }) => entryKind === "reversal")!;
        assert.equal(reversal.input.adjustsFactId, originalFactId);
        assert.equal(reversal.input.direction, "inflow");
        assert.ok(
          reversal.input.impacts.some(
            (impact) =>
              impact.impactKind === "confirmed_cost" &&
              impact.direction === "decrease" &&
              impact.amountCents === 100_000n
          )
        );
        const netCost = posted
          .flatMap(({ input }) =>
            input.impacts.filter((impact) => impact.impactKind === "confirmed_cost")
          )
          .reduce(
            (sum, impact) =>
              sum +
              (impact.direction === "decrease"
                ? -(impact.amountCents ?? 0n)
                : (impact.amountCents ?? 0n)),
            0n
          );
        assert.equal(netCost, 1_870_000n, "19 行 1900 元 − 更正前 1000 元 + 更正后 700 元");
        assert.equal(corrected.activatedRows, 20, "原行保留 + 更正重登行");

        // 8) 全程不产生合同/结算/付款/资金账户事实，审计与权限可追。
        assert.equal(await prisma.contract.count({ where: { projectId: fixture.projectId } }), 0);
        assert.equal(
          await prisma.settlementDraft.count({ where: { projectId: fixture.projectId } }),
          0
        );
        assert.equal(
          await prisma.paymentRequest.count({ where: { projectId: fixture.projectId } }),
          0
        );
        assert.equal(await prisma.paymentExecution.count(), 0);
        assert.equal(await prisma.fundAccountBalanceRegistration.count(), 0);
        assert.equal(await prisma.operatingFact.count(), 0);
        const audits = await prisma.auditLog.findMany({
          where: { businessId: created.id },
          orderBy: { createdAt: "asc" }
        });
        assert.deepEqual(
          [...new Set(audits.map((audit) => audit.action))].sort(),
          ["history_expense.activate", "history_expense.batch.create", "history_expense.confirm"]
        );
        const rowAudits = await prisma.auditLog.count({
          where: { action: "history_expense.row.verify", businessType: "operating_takeover_row" }
        });
        assert.equal(rowAudits, 20, "18 行核实 + 1 行改为未发生 + 1 行补资料重新核实；重复导入只返回原批次，不重复写行");
        assert.deepEqual(
          await writableFacts(prisma),
          {
            batches: 1,
            rows: 21,
            confirmations: 2,
            activations: 1,
            fundAccounts: 0,
            payments: 0,
            operatingFacts: 0,
            contracts: 0,
            settlements: 0
          }
        );
      } finally {
        await prisma.$disconnect();
      }
    },
    120_000
  );
});

function assertDedicatedDatabase(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const runId = process.env.ISSUE417_EXACT_FORWARD_RUN_ID;
  if (runId !== undefined) {
    if (
      process.env.NODE_ENV !== "test" || !/^[a-f0-9]{32}$/u.test(runId) ||
      url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
      !url.port || url.username !== "jg_task01_owner" || !url.password ||
      url.pathname !== `/jg_task01_${runId}` ||
      url.searchParams.getAll("sslmode").join(",") !== "require" ||
      url.searchParams.getAll("sslaccept").join(",") !== "strict" ||
      !/^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(url.searchParams.get("sslcert") ?? "")
    ) {
      throw new Error("ISSUE417_EXACT_FORWARD_ENDPOINT");
    }
    return url.href;
  }
  if (
    process.env.NODE_ENV === "production" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/jiangkong_issue417"
  ) {
    throw new Error("只允许本机一次性 PostgreSQL 16 专库 jiangkong_issue417");
  }
  return url.toString();
}

async function assertExactForwardDatabase(prisma: PrismaClient, databaseUrl: string) {
  const endpoint = new URL(databaseUrl);
  const expectedCount = Number(process.env.ISSUE417_EXACT_FORWARD_COUNT);
  assert.ok(Number.isInteger(expectedCount) && expectedCount >= 335, "ISSUE417_EXACT_FORWARD_COUNT");
  const [row] = await prisma.$queryRaw<Array<{ accepted: boolean }>>`
    SELECT current_database() = ${endpoint.pathname.slice(1)}
      AND current_user = 'jg_task01_owner' AND session_user = current_user
      AND inet_client_addr() = '127.0.0.1'::inet AND inet_server_addr() = '127.0.0.1'::inet
      AND inet_server_port() = ${Number(endpoint.port)}::integer
      AND current_setting('server_version_num') = '160015'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl)
      AND (SELECT count(*) = ${expectedCount}
        AND count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) = 0
        AND count(*) FILTER (
          WHERE migration_name = '20261129012000_issue417_historical_expense_states'
            AND checksum = '924effc588fe48f9f4e63bd5187c2eb6a1a48b35d1749d699fccc4135ddaaecd'
        ) = 1
        FROM public._prisma_migrations) AS accepted
  `;
  assert.equal(row?.accepted, true, "ISSUE417_EXACT_FORWARD_DATABASE");
}

async function seedFixture(prisma: PrismaClient) {
  const projectId = randomUUID();
  await prisma.project.create({
    data: {
      id: projectId,
      code: `LSFY-${randomUUID()}`,
      name: "历史费用批量核实合成项目",
      takeoverStatus: "preparing"
    }
  });
  const comprehensiveDirectorUserId = await actor(
    prisma,
    "comprehensive_director",
    projectId
  );
  const financeStaffUserId = await actor(prisma, "finance_staff", projectId);
  const financeDirectorUserId = await actor(prisma, "finance_director", projectId);
  const company = await prisma.companyEntity.create({
    data: { name: "合成承担公司" }
  });
  const companyVersion = await prisma.companyEntityVersion.create({
    data: {
      companyEntityId: company.id,
      versionNo: 1,
      name: company.name,
      isActive: true,
      action: "create",
      actorUserId: comprehensiveDirectorUserId
    }
  });
  await prisma.projectParticipatingCompany.create({
    data: {
      projectId,
      companyEntityId: company.id,
      companyEntityVersionId: companyVersion.id,
      companyNameSnapshot: company.name,
      effectiveFrom: new Date("2020-01-01"),
      changeReason: "合成测试",
      addedByUserId: comprehensiveDirectorUserId
    }
  });
  const affiliateParty = await prisma.businessParty.create({
    data: {
      name: `合成施工企业-${randomUUID()}`,
      normalizedName: randomUUID(),
      createdByUserId: comprehensiveDirectorUserId
    }
  });
  const affiliateVersion = await prisma.businessPartyVersion.create({
    data: {
      businessPartyId: affiliateParty.id,
      versionNo: 1,
      snapshot: {},
      createdByUserId: comprehensiveDirectorUserId
    }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      projectId,
      businessPartyId: affiliateParty.id,
      businessPartyVersionId: affiliateVersion.id,
      affiliateNameSnapshot: affiliateParty.name,
      effectiveFrom: new Date("2020-01-01"),
      changeReason: "合成测试",
      assignedByUserId: comprehensiveDirectorUserId
    }
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { operatingLedgerEffectiveDate: new Date("2026-11-01") }
  });
  await prisma.businessParty.create({
    data: {
      name: "合成历史费用收款方",
      normalizedName: randomUUID(),
      createdByUserId: comprehensiveDirectorUserId
    }
  });
  return {
    projectId,
    companyName: company.name,
    comprehensiveDirectorUserId,
    financeStaffUserId,
    financeDirectorUserId
  };
}

async function actor(
  prisma: PrismaClient,
  role: string,
  projectId: string
): Promise<string> {
  const user = await prisma.user.create({
    data: { name: `历史费用合成${role}`, phone: `he-${randomUUID()}` }
  });
  const position = await prisma.position.upsert({
    where: { key: role },
    create: { key: role, name: role },
    update: {}
  });
  await prisma.userPosition.create({
    data: { userId: user.id, positionId: position.id, projectId }
  });
  return user.id;
}

function row(index: number, overrides: Record<string, unknown> = {}) {
  const day = String(((index - 1) % 28) + 1).padStart(2, "0");
  const paymentStatus =
    index <= 6 || index === 15 || (index >= 16 && index <= 18)
      ? "paid"
      : index <= 10
        ? "unpaid"
        : index <= 14
          ? "partially_paid"
          : "unknown";
  return {
    values: {
      businessRef: `历史费用-${String(index).padStart(3, "0")}`,
      occurredAt: `2026-09-${day}`,
      purpose: `合成历史费用第${index}行`,
      costCategoryCode: index % 2 === 0 ? "material" : "crew_and_labor",
      amountYuan: "1000.00",
      paymentStatus,
      ...(paymentStatus === "paid"
        ? {
            paidAmountYuan: "1000.00",
            payerCompanyName: index === 15 ? "" : "合成承担公司"
          }
        : {}),
      ...(paymentStatus === "partially_paid"
        ? { paidAmountYuan: "400.00", payerCompanyName: "合成承担公司" }
        : {}),
      payeeName: "合成历史费用收款方",
      costBearingCompanyName: "合成承担公司",
      sourceDescription: `原始凭据第${index}份`,
      ...overrides
    }
  };
}

function twentyRows() {
  return Array.from({ length: 20 }, (_, index) => row(index + 1));
}

async function writableFacts(prisma: PrismaClient) {
  return {
    batches: await prisma.operatingTakeoverBatch.count(),
    rows: await prisma.operatingTakeoverRow.count(),
    confirmations: await prisma.operatingTakeoverConfirmation.count(),
    activations: await prisma.operatingTakeoverActivation.count(),
    fundAccounts: await prisma.fundAccountBalanceRegistration.count(),
    payments: await prisma.paymentExecution.count(),
    operatingFacts: await prisma.operatingFact.count(),
    contracts: await prisma.contract.count(),
    settlements: await prisma.settlementDraft.count()
  };
}
