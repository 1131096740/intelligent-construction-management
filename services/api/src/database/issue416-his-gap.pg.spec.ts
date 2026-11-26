import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ContractReadService } from "../contract/contract-read.service";
import { ContractTakeoverActivationService } from "../contract-takeover/contract-takeover-activation.service";
import { ContractTakeoverHandoverService } from "../contract-takeover/contract-takeover-handover.service";
import { ContractTakeoverHistoricalPaymentOperatingSourceAdapter } from "../contract-takeover/contract-takeover-operating-source.adapter";
import { ContractTakeoverService } from "../contract-takeover/contract-takeover.service";
import { summarizeTakeoverMoney } from "../contract-takeover/contract-takeover-money-summary";

/**
 * #416 HIS 真库证据（真实 PostgreSQL 16）：
 * - NONE 级历史接管完成分工登记后可以真实激活；
 * - 已付 70 / 结算 60 形成 10 超付，并按约定预付款建期初余额；
 * - 激活不写资金账户、不重复扣启用时现金期初；
 * - NONE 级历史实付可以进入经营账来源投影，并标清实际日期早于经营账生效日；
 * - 主管通过的历史合同出现在结算工作台合同选项，历史 60 + 新 10 = 70；
 * - 财务或主管驳回制单人后，重提必须重新经过财务核对。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue416-his-gap-local.cjs
 */
describe("issue 416 history takeover HIS gaps on PostgreSQL", () => {
  const integrationTest =
    process.env.RUN_ISSUE416_HIS_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "activates a NONE-level history takeover, projects its payments, keeps opening cash untouched and continues 60 + 10 = 70",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const ids = fixtureIds();
      try {
        await prisma.$connect();
        await seedFixture(prisma, ids);
        const audit = new AuditService();
        const handover = new ContractTakeoverHandoverService(prisma as never, audit);
        await handover.register(ids.project, ids.takeover, ids.supervisor, {
          contractUserId: ids.contractUser,
          financeUserId: ids.finance,
          supervisorUserId: ids.supervisor,
          idempotencyKey: randomUUID()
        });

        const fundTablesBefore = await fundOpeningSnapshot(prisma);

        const takeover = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.takeover }
        });
        const contractFacts =
          await prisma.contractTakeoverContractFacts.findUniqueOrThrow({
            where: { takeoverId: ids.takeover }
          });
        const financeFacts =
          await prisma.contractTakeoverFinanceFacts.findUniqueOrThrow({
            where: { takeoverId: ids.takeover }
          });
        const payments = await prisma.contractTakeoverHistoricalPayment.findMany({
          where: { takeoverId: ids.takeover }
        });
        assert.equal(payments.length, 1);
        const vouchers =
          await prisma.contractTakeoverHistoricalPaymentVoucher.findMany({
            where: { historicalPaymentId: payments[0].id }
          });
        assert.equal(vouchers.length, 1);

        const projected: Array<{ sourceType: string; sourceBusinessId: string }> = [];
        const activation = new ContractTakeoverActivationService(audit, {
          async appendConfirmedSourceIfEnabledInTransaction(
            _tx: unknown,
            locator: { sourceType: string; sourceBusinessId: string }
          ) {
            projected.push({
              sourceType: locator.sourceType,
              sourceBusinessId: locator.sourceBusinessId
            });
            return null;
          }
        } as never);

        const result = await prisma.$transaction((tx) =>
          activation.executePreparedActivation(
            tx,
            {
              takeover: {
                id: takeover.id,
                projectId: takeover.projectId,
                contractId: takeover.contractId,
                contractVersionId: takeover.contractVersionId,
                paymentTermsVersionId: takeover.paymentTermsVersionId,
                takeoverLevel: takeover.takeoverLevel
              },
              contractFacts: {
                historicalSettledCents: contractFacts.historicalSettledCents,
                zeroSettlementDeclared: contractFacts.zeroSettlementDeclared
              },
              financeFacts: {
                zeroPaymentDeclared: financeFacts.zeroPaymentDeclared,
                excessTreatment: financeFacts.excessTreatment
              },
              payments: payments.map((payment) => ({
                id: payment.id,
                amountCents: payment.amountCents,
                status: payment.status
              })),
              vouchers: vouchers.map((voucher) => ({
                historicalPaymentId: voucher.historicalPaymentId
              })),
              contract: {
                contractTypeKey: "material_purchase",
                companyEntityId: null,
                companyEntityIsActive: null,
                companyEntityDataStatus: null,
                companyEntityVersionId: null,
                companyEntityVersionName: null,
                companyEntityCreditCode: null,
                companyEntityRegisteredAddress: null
              },
              contractVersion: {
                amountCents: 1_000_000n,
                amountLimitType: "capped"
              }
            } as never,
            ids.supervisor,
            randomUUID()
          )
        );

        assert.equal(result.activated, true);
        const activated = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.takeover }
        });
        assert.equal(activated.takeoverStatus, "confirmed");
        assert.equal(activated.historicalPaidCents, 70_000n);
        assert.equal(activated.historicalAdvancePaidCents, 10_000n);
        assert.ok(activated.historicalInitialSettlementId);
        assert.ok(
          projected.some(
            (source) =>
              source.sourceType === "contract_takeover_historical_payment" &&
              source.sourceBusinessId === payments[0].id
          )
        );

        const settlement = await prisma.settlement.findUniqueOrThrow({
          where: { id: activated.historicalInitialSettlementId! }
        });
        assert.equal(settlement.amountCents, 60_000n);
        assert.equal(settlement.paidAmountCents, 60_000n);
        assert.equal(settlement.periodLabel, "历史期初");

        const advanceBalance =
          await prisma.contractTakeoverBalanceAccount.findFirstOrThrow({
            where: { takeoverId: ids.takeover, balanceType: "historical_advance" }
          });
        assert.equal(advanceBalance.openingCents, 10_000n);
        assert.equal(advanceBalance.balanceCents, 10_000n);

        // HIS-12：启用前历史实付只参与历史事实和经营来源投影，不再次扣现金/公司资金期初。
        assert.deepEqual(await fundOpeningSnapshot(prisma), fundTablesBefore);

        // 经营账来源投影：NONE 级历史实付可进入正式经营账投影，并标清实际日期早于生效日。
        await prisma.project.update({
          where: { id: ids.project },
          data: { operatingLedgerEffectiveDate: new Date("2026-11-15T00:00:00.000Z") }
        });
        const adapter = new ContractTakeoverHistoricalPaymentOperatingSourceAdapter();
        const snapshots = await adapter.readProjectSnapshots(prisma as never, ids.project);
        assert.equal(snapshots.length, 1);
        const mapped = adapter.toOperatingFactInput(snapshots[0]);
        assert.equal(mapped.input.evidenceLevel, "C");
        assert.equal(mapped.input.amountCents, 70_000n);
        assert.equal(mapped.input.isBeforeOperatingLedgerEffectiveDate, true);
        const impacts = mapped.input.impacts.map((impact) => ({
          key: impact.sourceImpactKey,
          amount: impact.amountCents
        }));
        assert.deepEqual(
          impacts.map((impact) => impact.key).sort(),
          [
            "company_project_funds_decrease",
            "historical_advance",
            `payable:${activated.historicalInitialSettlementId}`
          ].sort()
        );
        assert.equal(
          impacts.find(
            (impact) =>
              impact.key === `payable:${activated.historicalInitialSettlementId}`
          )?.amount,
          60_000n
        );
        assert.equal(
          impacts.find((impact) => impact.key === "historical_advance")?.amount,
          10_000n
        );

        // HIS-08：主管通过的历史合同可出现在结算工作台合同选项；历史 60 + 新 10 = 70。
        const readService = new ContractReadService(prisma as never);
        const options = await readService.listCreateOptions(ids.project);
        const option = options.find((item) => item.contractId === ids.contract);
        assert.ok(option);
        assert.equal(option.source, "historical_takeover");
        assert.equal(option.canCreateSettlement, true);

        await prisma.settlement.create({
          data: {
            id: ids.newSettlement,
            projectId: ids.project,
            contractId: ids.contract,
            contractVersionId: ids.version,
            paymentTermsVersionId: ids.terms,
            code: "JS-HIS-010",
            periodLabel: "接管后第一期",
            status: "effective",
            amountCents: 10_000n,
            payableAmountCents: 10_000n,
            paidAmountCents: 0n
          }
        });
        const settlements = await prisma.settlement.findMany({
          where: { contractId: ids.contract, status: { in: ["effective", "partially_paid", "paid"] } },
          select: { id: true, amountCents: true }
        });
        const cumulative = settlements.reduce(
          (sum, row) => sum + row.amountCents,
          0n
        );
        assert.equal(cumulative, 70_000n);

        const money = summarizeTakeoverMoney({
          relationship: "outside",
          paidCents: activated.historicalPaidCents,
          settledCents: activated.historicalSettledCents,
          excessTreatment: financeFacts.excessTreatment
        });
        assert.equal(money.historicalOverpaidCents, 10_000n);
        assert.equal(money.historicalOverpaymentKind, "unsettled_advance");
      } finally {
        await prisma.$disconnect();
      }
    },
    180_000
  );

  integrationTest(
    "relays contract maker -> finance -> contract supervisor and sends both rejections back to the maker",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const ids = fixtureIds();
      try {
        await prisma.$connect();
        await seedRelayTakeover(prisma, ids);
        const audit = new AuditService();
        await new ContractTakeoverHandoverService(prisma as never, audit).register(
          ids.project,
          ids.relayTakeover,
          ids.supervisor,
          {
            contractUserId: ids.contractUser,
            financeUserId: ids.finance,
            supervisorUserId: ids.supervisor,
            idempotencyKey: randomUUID()
          }
        );
        const auth = { confirmPassword: async () => undefined };
        const service = new ContractTakeoverService(
          prisma as never,
          audit as never,
          auth as never
        );

        // 财务退回制单人，状态回到待补充并留下原因。
        const financeRejected = await service.returnFinanceForSupplement(
          ids.project,
          ids.relayTakeover,
          { reason: "历史实付金额与凭证不一致，请制单人重新核对" },
          ids.financeDirector
        );
        assert.equal(financeRejected.takeoverStatus, "needs_supplement");

        // 制单人重提后，财务确认被清空，必须重新核对。
        const resubmitted = await service.submitReview(
          ids.project,
          ids.relayTakeover,
          ids.contractUser
        );
        assert.equal(resubmitted.takeoverStatus, "pending_finance");
        const clearedFacts =
          await prisma.contractTakeoverFinanceFacts.findUniqueOrThrow({
            where: { takeoverId: ids.relayTakeover }
          });
        assert.equal(clearedFacts.confirmedRevision, null);

        // 非财务岗位不能核对；财务经办核对完成后进入合同主管复核。
        await assert.rejects(
          service.confirmFinanceSide(
            ids.project,
            ids.relayTakeover,
            {
              idempotencyKey: randomUUID(),
              expectedRevision: 1,
              currentPassword: "test-password",
              basedOnContractRevision: 1,
              basedOnFinanceBasisRevision: 1
            },
            ids.contractUser
          ),
          /当前岗位不能编辑财务侧接管资料/
        );
        const financeConfirmed = (await service.confirmFinanceSide(
          ids.project,
          ids.relayTakeover,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: 1,
            currentPassword: "test-password",
            basedOnContractRevision: 1,
            basedOnFinanceBasisRevision: 1
          },
          ids.finance
        )) as { confirmed: boolean };
        assert.equal(financeConfirmed.confirmed, true);
        const afterFinance = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.relayTakeover }
        });
        assert.equal(afterFinance.takeoverStatus, "pending_review");

        // 主管退回后，财务与合同确认一并清空，重提必须重新经过财务。
        const supervisorRejected = await service.returnForSupplement(
          ids.project,
          ids.relayTakeover,
          { reason: "财务金额与合同摘要不一致，请返工" },
          ids.supervisor
        );
        assert.equal(supervisorRejected.takeoverStatus, "needs_supplement");
        const afterSupervisorReturn =
          await prisma.contractTakeoverFinanceFacts.findUniqueOrThrow({
            where: { takeoverId: ids.relayTakeover }
          });
        assert.equal(afterSupervisorReturn.confirmedRevision, null);
        const secondResubmit = await service.submitReview(
          ids.project,
          ids.relayTakeover,
          ids.contractUser
        );
        assert.equal(secondResubmit.takeoverStatus, "pending_finance");

        const audits = await prisma.auditLog.findMany({
          where: { businessId: ids.relayTakeover },
          orderBy: { createdAt: "asc" },
          select: { action: true }
        });
        assert.deepEqual(
          audits.map((row) => row.action),
          [
            "contract_takeover.handover.register",
            "contract_takeover.finance_return_for_supplement",
            "contract_takeover.submit_review",
            "contract_takeover.finance_side.confirm",
            "contract_takeover.return_for_supplement",
            "contract_takeover.submit_review"
          ]
        );
      } finally {
        await prisma.$disconnect();
      }
    },
    180_000
  );

  integrationTest(
    "keeps unknown historical facts in their original stage and only records an explicit zero",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const ids = fixtureIds();
      try {
        await prisma.$connect();
        await seedZeroTakeover(prisma, ids);
        const audit = new AuditService();
        await new ContractTakeoverHandoverService(prisma as never, audit).register(
          ids.project,
          ids.zeroTakeover,
          ids.supervisor,
          {
            contractUserId: ids.contractUser,
            financeUserId: ids.finance,
            supervisorUserId: ids.supervisor,
            idempotencyKey: randomUUID()
          }
        );

        // 查不到的历史结算/实付保持原阶段，不自动生成 0 记录。
        const before = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.zeroTakeover }
        });
        assert.equal(before.takeoverStatus, "pending_review");
        assert.equal(
          await prisma.settlement.count({
            where: { sourceTakeoverId: ids.zeroTakeover }
          }),
          0
        );
        assert.equal(
          await prisma.contractTakeoverHistoricalPayment.count({
            where: { takeoverId: ids.zeroTakeover }
          }),
          0
        );

        const takeover = before;
        const contractFacts =
          await prisma.contractTakeoverContractFacts.findUniqueOrThrow({
            where: { takeoverId: ids.zeroTakeover }
          });
        const financeFacts =
          await prisma.contractTakeoverFinanceFacts.findUniqueOrThrow({
            where: { takeoverId: ids.zeroTakeover }
          });
        const activation = new ContractTakeoverActivationService(audit, {
          async appendConfirmedSourceIfEnabledInTransaction() {
            return null;
          }
        } as never);
        const result = await prisma.$transaction((tx) =>
          activation.executePreparedActivation(
            tx,
            {
              takeover: {
                id: takeover.id,
                projectId: takeover.projectId,
                contractId: takeover.contractId,
                contractVersionId: takeover.contractVersionId,
                paymentTermsVersionId: takeover.paymentTermsVersionId,
                takeoverLevel: takeover.takeoverLevel
              },
              contractFacts: {
                historicalSettledCents: contractFacts.historicalSettledCents,
                zeroSettlementDeclared: contractFacts.zeroSettlementDeclared
              },
              financeFacts: {
                zeroPaymentDeclared: financeFacts.zeroPaymentDeclared,
                excessTreatment: financeFacts.excessTreatment
              },
              payments: [],
              vouchers: [],
              contract: {
                contractTypeKey: "generic_contract",
                companyEntityId: null,
                companyEntityIsActive: null,
                companyEntityDataStatus: null,
                companyEntityVersionId: null,
                companyEntityVersionName: null,
                companyEntityCreditCode: null,
                companyEntityRegisteredAddress: null
              },
              contractVersion: { amountCents: 0n, amountLimitType: "uncapped" }
            } as never,
            ids.supervisor,
            randomUUID()
          )
        );

        assert.equal(result.activated, true);
        assert.equal(result.historicalInitialSettlementId, null);
        const activated = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.zeroTakeover }
        });
        assert.equal(activated.historicalPaidCents, 0n);
        assert.equal(
          await prisma.settlement.count({
            where: { sourceTakeoverId: ids.zeroTakeover }
          }),
          0
        );
        assert.equal(
          await prisma.contractTakeoverBalanceAccount.count({
            where: { takeoverId: ids.zeroTakeover }
          }),
          0
        );
      } finally {
        await prisma.$disconnect();
      }
    },
    180_000
  );
});

function assertDedicatedDatabase(): string {
  const url = process.env.ISSUE416_HIS_DATABASE_URL ?? "";
  const target = new URL(url);
  if (
    process.env.NODE_ENV !== "test" ||
    target.hostname !== "127.0.0.1" ||
    !target.pathname.endsWith("_issue416_his")
  ) {
    throw new Error("ISSUE416_HIS_ISOLATED_DATABASE_REQUIRED");
  }
  return url;
}

function fixtureIds() {
  return {
    project: "issue416-his-project",
    contract: "issue416-his-contract",
    version: "issue416-his-contract-v1",
    terms: "issue416-his-terms-v1",
    takeover: "issue416-his-takeover",
    newSettlement: "issue416-his-new-settlement",
    relayContract: "issue416-his-relay-contract",
    relayVersion: "issue416-his-relay-contract-v1",
    relayTerms: "issue416-his-relay-terms-v1",
    relayTakeover: "issue416-his-relay-takeover",
    zeroContract: "issue416-his-zero-contract",
    zeroVersion: "issue416-his-zero-contract-v1",
    zeroTerms: "issue416-his-zero-terms-v1",
    zeroTakeover: "issue416-his-zero-takeover",
    contractUser: "issue416-his-user-contract",
    financeDirector: "issue416-his-user-finance-director",
    finance: "issue416-his-user-finance",
    supervisor: "issue416-his-user-supervisor"
  };
}

async function fundOpeningSnapshot(prisma: PrismaClient) {
  const [registrations, payments, balances] = await Promise.all([
    prisma.fundAccountBalanceRegistration.count(),
    prisma.registeredOperationalPayment.count(),
    prisma.registeredFundPaymentAllocation.count()
  ]);
  return { registrations, payments, balances };
}

async function seedFixture(
  prisma: PrismaClient,
  ids: ReturnType<typeof fixtureIds>
): Promise<void> {
  const users = [
    [ids.contractUser, "合同经办", "contract_staff"],
    [ids.finance, "财务经办", "finance_staff"],
    [ids.financeDirector, "财务主管", "finance_director"],
    [ids.supervisor, "合同主管", "contract_director"]
  ] as const;
  await prisma.user.createMany({
    data: users.map(([id, name], index) => ({
      id,
      name,
      phone: `139000042${String(index).padStart(2, "0")}`,
      passwordHash: "not-used-in-this-test",
      mustChangePassword: false,
      isActive: true
    }))
  });
  const positions = [
    ["issue416-his-pos-contract-staff", "contract_staff", "合同员"],
    ["issue416-his-pos-finance-staff", "finance_staff", "财务"],
    ["issue416-his-pos-finance-director", "finance_director", "财务主管"],
    ["issue416-his-pos-contract-director", "contract_director", "合同部主管"]
  ] as const;
  await prisma.position.createMany({
    data: positions.map(([id, key, name]) => ({ id, key, name }))
  });
  const positionByKey = new Map(positions.map(([id, key]) => [key, id]));
  await prisma.userPosition.createMany({
    data: users.map(([userId, , roleKey]) => ({
      userId,
      positionId: positionByKey.get(roleKey)!,
      projectId: null
    }))
  });
  await prisma.project.create({
    data: {
      id: ids.project,
      code: "ISSUE416HIS",
      name: "Issue416 HIS 真库项目",
      isActive: true
    }
  });
  await prisma.contract.create({
    data: {
      id: ids.contract,
      projectId: ids.project,
      source: "historical_takeover",
      code: "HT-HIS-001",
      name: "历史材料采购合同",
      counterparty: "历史供应商",
      contractTypeKey: "material_purchase",
      ownerUserId: ids.contractUser
    }
  });
  await prisma.contractVersion.create({
    data: {
      id: ids.version,
      contractId: ids.contract,
      versionNo: 1,
      changeType: "historical_takeover",
      status: "draft",
      amountCents: 1_000_000n,
      amountLimitType: "capped",
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: "issue416-his-company",
      companyEntityVersionId: "issue416-his-company-version",
      companyEntityNameSnapshot: "我方公司",
      affiliateAssignmentId: "issue416-his-affiliate",
      affiliateBusinessPartyVersionId: "issue416-his-affiliate-version",
      affiliateNameSnapshot: "施工企业甲",
      draftData: {
        historicalTakeover: true,
        relationship: "outside"
      },
      templateSnapshot: { historicalTakeover: true },
      clauseSnapshot: []
    }
  });
  await prisma.paymentTermsVersion.create({
    data: {
      id: ids.terms,
      contractId: ids.contract,
      contractVersionId: ids.version,
      versionNo: 1,
      status: "draft",
      originalText: "历史付款约定：按月结算。"
    }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: "issue416-his-affiliate",
      projectId: ids.project,
      businessPartyId: "issue416-his-business-party",
      businessPartyVersionId: "issue416-his-affiliate-version",
      affiliateNameSnapshot: "施工企业甲",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      changeReason: "真库用例预置",
      assignedByUserId: ids.supervisor
    }
  });
  await prisma.contractPartySnapshot.create({
    data: {
      contractVersionId: ids.version,
      roleKey: "party_b",
      displayOrder: 0,
      businessPartyVersionId: "issue416-his-counterparty-version",
      snapshot: { name: "历史供应商" }
    }
  });
  await prisma.contractTakeover.create({
    data: {
      id: ids.takeover,
      projectId: ids.project,
      contractId: ids.contract,
      contractVersionId: ids.version,
      paymentTermsVersionId: ids.terms,
      takeoverLevel: "NONE",
      takeoverStatus: "pending_review",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2025-01-15T00:00:00.000Z"),
      historicalSettledCents: 60_000n,
      takeoverCutoffDate: new Date("2026-10-31T00:00:00.000Z"),
      responsibleUserId: ids.contractUser,
      createdByUserId: ids.contractUser,
      submittedByUserId: ids.contractUser,
      submittedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  });
  await prisma.contractTakeoverContractFacts.create({
    data: {
      takeoverId: ids.takeover,
      revision: 1,
      financeBasisRevision: 1,
      signedAt: new Date("2025-01-15T00:00:00.000Z"),
      historicalSettledCents: 60_000n,
      zeroSettlementDeclared: false,
      performanceStatus: "performing",
      settlementEvidenceSummary: "历史结算台账已核对。",
      paymentTermsSnapshot: {},
      contractFactsSnapshot: {
        contractNo: "HT-HIS-001",
        contractName: "历史材料采购合同",
        contractTypeKey: "material_purchase",
        counterparty: "历史供应商",
        originalAmountCents: "1000000",
        zeroSettlementDeclared: false
      },
      confirmedRevision: 1,
      confirmedByUserId: ids.supervisor,
      confirmedAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedByUserId: ids.contractUser
    }
  });
  await prisma.contractTakeoverFinanceFacts.create({
    data: {
      takeoverId: ids.takeover,
      revision: 1,
      basedOnContractRevision: 1,
      basedOnFinanceBasisRevision: 1,
      zeroPaymentDeclared: false,
      excessTreatment: "historical_advance",
      excessReason: "历史已付超出累计结算，核实为约定预付款。",
      confirmedRevision: 1,
      confirmedContractRevision: 1,
      confirmedFinanceBasisRevision: 1,
      confirmedByUserId: ids.financeDirector,
      confirmedAt: new Date("2026-11-02T00:00:00.000Z"),
      updatedByUserId: ids.finance
    }
  });
  const payment = await prisma.contractTakeoverHistoricalPayment.create({
    data: {
      takeoverId: ids.takeover,
      rowKey: "row-1",
      sequenceNo: 1,
      amountCents: 70_000n,
      paidAt: new Date("2026-09-01T00:00:00.000Z"),
      payerName: "我方公司",
      payeeName: "历史供应商",
      bankReference: "BANK-HIS-001",
      paymentMethod: "bank_transfer",
      note: "接管前已付 70，累计结算 60",
      status: "draft"
    }
  });
  await prisma.contractTakeoverHistoricalPaymentVoucher.create({
    data: {
      historicalPaymentId: payment.id,
      fileId: "issue416-his-voucher-file",
      displayOrder: 0,
      uploadedByUserId: ids.finance
    }
  });
  await prisma.contractTakeoverSettlementEvidence.create({
    data: {
      takeoverId: ids.takeover,
      fileId: "issue416-his-settlement-file",
      displayOrder: 0,
      createdByUserId: ids.contractUser
    }
  });
  await prisma.contractTakeoverExcessEvidence.create({
    data: {
      takeoverId: ids.takeover,
      fileId: "issue416-his-excess-file",
      displayOrder: 0,
      createdByUserId: ids.finance
    }
  });
}

async function seedRelayTakeover(
  prisma: PrismaClient,
  ids: ReturnType<typeof fixtureIds>
): Promise<void> {
  await prisma.contract.create({
    data: {
      id: ids.relayContract,
      projectId: ids.project,
      source: "historical_takeover",
      code: "HT-HIS-RELAY-001",
      name: "历史接管接力合同",
      counterparty: "接力相对方",
      contractTypeKey: "material_purchase",
      ownerUserId: ids.contractUser
    }
  });
  await prisma.contractVersion.create({
    data: {
      id: ids.relayVersion,
      contractId: ids.relayContract,
      versionNo: 1,
      changeType: "historical_takeover",
      status: "draft",
      amountCents: 500_000n,
      amountLimitType: "capped",
      draftData: { historicalTakeover: true, relationship: "outside" },
      templateSnapshot: { historicalTakeover: true },
      clauseSnapshot: []
    }
  });
  await prisma.paymentTermsVersion.create({
    data: {
      id: ids.relayTerms,
      contractId: ids.relayContract,
      contractVersionId: ids.relayVersion,
      versionNo: 1,
      status: "draft",
      originalText: "接力测试付款条款。"
    }
  });
  await prisma.contractTakeover.create({
    data: {
      id: ids.relayTakeover,
      projectId: ids.project,
      contractId: ids.relayContract,
      contractVersionId: ids.relayVersion,
      paymentTermsVersionId: ids.relayTerms,
      takeoverLevel: "NONE",
      takeoverStatus: "pending_finance",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2025-02-01T00:00:00.000Z"),
      historicalSettledCents: 20_000n,
      takeoverCutoffDate: new Date("2026-10-31T00:00:00.000Z"),
      responsibleUserId: ids.contractUser,
      createdByUserId: ids.contractUser,
      submittedByUserId: ids.contractUser,
      submittedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  });
  await prisma.contractTakeoverContractFacts.create({
    data: {
      takeoverId: ids.relayTakeover,
      revision: 1,
      financeBasisRevision: 1,
      signedAt: new Date("2025-02-01T00:00:00.000Z"),
      historicalSettledCents: 20_000n,
      zeroSettlementDeclared: false,
      performanceStatus: "performing",
      settlementEvidenceSummary: "接力合同结算依据已核对。",
      paymentTermsSnapshot: {},
      contractFactsSnapshot: {
        contractNo: "HT-HIS-RELAY-001",
        contractName: "历史接管接力合同",
        contractTypeKey: "material_purchase",
        counterparty: "接力相对方",
        originalAmountCents: "500000",
        zeroSettlementDeclared: false
      },
      confirmedRevision: null,
      updatedByUserId: ids.contractUser
    }
  });
  await prisma.contractTakeoverFinanceFacts.create({
    data: {
      takeoverId: ids.relayTakeover,
      revision: 1,
      basedOnContractRevision: 1,
      basedOnFinanceBasisRevision: 1,
      zeroPaymentDeclared: false,
      excessTreatment: null,
      confirmedRevision: null,
      updatedByUserId: ids.finance
    }
  });
}

async function seedZeroTakeover(
  prisma: PrismaClient,
  ids: ReturnType<typeof fixtureIds>
): Promise<void> {
  await prisma.contract.create({
    data: {
      id: ids.zeroContract,
      projectId: ids.project,
      source: "historical_takeover",
      code: "HT-HIS-ZERO-001",
      name: "历史零值合同",
      counterparty: "零值相对方",
      contractTypeKey: "generic_contract",
      ownerUserId: ids.contractUser
    }
  });
  await prisma.contractVersion.create({
    data: {
      id: ids.zeroVersion,
      contractId: ids.zeroContract,
      versionNo: 1,
      changeType: "historical_takeover",
      status: "draft",
      amountCents: 0n,
      amountLimitType: "uncapped",
      draftData: { historicalTakeover: true, relationship: "outside" },
      templateSnapshot: { historicalTakeover: true },
      clauseSnapshot: []
    }
  });
  await prisma.paymentTermsVersion.create({
    data: {
      id: ids.zeroTerms,
      contractId: ids.zeroContract,
      contractVersionId: ids.zeroVersion,
      versionNo: 1,
      status: "draft",
      originalText: "查不到历史结算与实付，按零值声明。"
    }
  });
  await prisma.contractTakeover.create({
    data: {
      id: ids.zeroTakeover,
      projectId: ids.project,
      contractId: ids.zeroContract,
      contractVersionId: ids.zeroVersion,
      paymentTermsVersionId: ids.zeroTerms,
      takeoverLevel: "NONE",
      takeoverStatus: "pending_review",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2025-03-01T00:00:00.000Z"),
      historicalSettledCents: 0n,
      takeoverCutoffDate: new Date("2026-10-31T00:00:00.000Z"),
      responsibleUserId: ids.contractUser,
      createdByUserId: ids.contractUser,
      submittedByUserId: ids.contractUser,
      submittedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  });
  await prisma.contractTakeoverContractFacts.create({
    data: {
      takeoverId: ids.zeroTakeover,
      revision: 1,
      financeBasisRevision: 1,
      signedAt: new Date("2025-03-01T00:00:00.000Z"),
      historicalSettledCents: 0n,
      zeroSettlementDeclared: true,
      performanceStatus: "performing",
      settlementEvidenceSummary: "查不到历史结算，已确认确实未发生。",
      paymentTermsSnapshot: {},
      contractFactsSnapshot: {
        contractNo: "HT-HIS-ZERO-001",
        contractName: "历史零值合同",
        contractTypeKey: "generic_contract",
        counterparty: "零值相对方",
        originalAmountCents: "0",
        zeroSettlementDeclared: true,
        zeroSettlementBasis: "查不到历史结算，确认确实未发生。"
      },
      confirmedRevision: 1,
      confirmedByUserId: ids.supervisor,
      confirmedAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedByUserId: ids.contractUser
    }
  });
  await prisma.contractTakeoverFinanceFacts.create({
    data: {
      takeoverId: ids.zeroTakeover,
      revision: 1,
      basedOnContractRevision: 1,
      basedOnFinanceBasisRevision: 1,
      zeroPaymentDeclared: true,
      excessTreatment: null,
      confirmedRevision: 1,
      confirmedContractRevision: 1,
      confirmedFinanceBasisRevision: 1,
      confirmedByUserId: ids.financeDirector,
      confirmedAt: new Date("2026-11-02T00:00:00.000Z"),
      updatedByUserId: ids.finance
    }
  });
}
