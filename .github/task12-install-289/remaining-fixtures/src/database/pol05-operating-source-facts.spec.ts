import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { OperatingProjectionService, OwnerSettlementBelowCentForCloseError } from "../operating-projection/operating-projection.service";
import { ProjectService } from "../project/project.service";
import { ProjectUpstreamFundBusinessEntryService } from "../project/project-upstream-fund-business-entry.service";
import { readProjectOwnerBalance } from "../project/project-owner-balance";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { createOperatingSourceRegistry } from "../operating-ledger/operating-ledger.module";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";

describe("POL-05 formal operating sources PostgreSQL", () => {
  const integrationTest =
    process.env.RUN_POL05_OPERATING_SOURCE_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "keeps amount, permission, status, idempotency, concurrency, subjects, impacts and cost uniqueness closed",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      const fixture = fixtureIds();
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await seedFixture(clients[0]!, fixture);
        const services = clients.map((client) => replayService(client));

        await expect(
          services[0]!.replaySource(
            locator(fixture, "settlement", fixture.settlement1Id),
            fixture.managerUserId
          )
        ).rejects.toThrow("只有当前项目财务人员可以登记经营事实");
        await expect(
          services[0]!.replaySource(
            locator(fixture, "settlement", fixture.draftSettlementId),
            fixture.financeUserId
          )
        ).rejects.toThrow("经营来源不存在");

        const concurrent = await Promise.all([
          services[1]!.replaySource(
            locator(fixture, "settlement", fixture.settlement1Id),
            fixture.financeUserId
          ),
          services[2]!.replaySource(
            locator(fixture, "settlement", fixture.settlement1Id),
            fixture.financeUserId
          )
        ]);
        expect(concurrent.map((result) => result.created).sort()).toEqual([
          false,
          true
        ]);

        for (const [sourceType, sourceBusinessId] of [
          ["contract_version", fixture.contractVersionId],
          ["contract_version", fixture.affiliateContractVersionId],
          ["project_upstream_settlement", fixture.upstreamSettlementId],
          ["settlement", fixture.settlement2Id],
          ["payment_execution", fixture.paymentExecutionId],
          ["payment_execution", fixture.sameCompanyPaymentExecutionId],
          ["project_proxy_payment", fixture.proxyPaymentId]
        ] as const) {
          await expect(
            services[0]!.replaySource(
              locator(fixture, sourceType, sourceBusinessId),
              fixture.financeUserId
            )
          ).resolves.toEqual(expect.objectContaining({ created: true }));
        }

        const repeated = await services[0]!.replaySource(
          locator(fixture, "payment_execution", fixture.paymentExecutionId),
          fixture.financeUserId
        );
        expect(repeated.created).toBe(false);

        const summary = await operatingSummary(clients[0]!, fixture.projectId);
        expect(summary).toEqual({
          factCount: 8n,
          confirmedCostCents: 300_000n,
          payableIncreaseCents: 270_000n,
          payableDecreaseCents: 80_000n,
          companyFundsDecreaseCents: 70_000n,
          affiliateFundsDecreaseCents: 20_000n,
          interSubjectCents: 60_000n
        });

        const ownerBalance = await readProjectOwnerBalance(
          clients[0]!, fixture.projectId, new Date("2026-09-01T00:00:00.000Z"), new Date()
        );
        expect(ownerBalance).toEqual({
          settlementYuan: "4000.0000",
          receivedYuan: "0.0000",
          outstandingYuan: "4000.0000",
          advanceYuan: "0.0000"
        });

        const commitments = await clients[0]!.operatingFact.findMany({
          where: { projectId: fixture.projectId, sourceType: "contract_version" }, include: { impacts: true }
        });
        expect(commitments.map((fact) => fact.amountCents).sort()).toEqual([100_000n, 500_000n]);
        expect(commitments.every((fact) => fact.impacts.length === 1 &&
          fact.impacts[0]!.impactKind === "contract_commitment_reference")).toBe(true);

        const paymentFact = await clients[0]!.operatingFact.findUnique({
          where: {
            sourceType_sourceBusinessId: {
              sourceType: "payment_execution",
              sourceBusinessId: fixture.paymentExecutionId
            }
          },
          include: { impacts: true }
        });
        expect(paymentFact).toEqual(
          expect.objectContaining({
            debtorSubjectId: fixture.company1Id,
            approvedPayerSubjectId: fixture.company1Id,
            actualPayerSubjectId: fixture.company2Id,
            payeeSubjectId: fixture.counterpartyVersionId,
            amountCents: 60_000n
          })
        );
        expect(paymentFact?.impacts.map((impact) => impact.sourceImpactKey)).toEqual(
          expect.arrayContaining([
            `payable:${fixture.settlement1Id}`,
            `payable:${fixture.settlement2Id}`,
            "company_project_funds_decrease",
            "inter_subject_proxy_payment"
          ])
        );
        expect(
          paymentFact?.impacts.some((impact) => impact.impactKind === "confirmed_cost")
        ).toBe(false);
        await expect(
          insertInvalidPayerRoleImpact(
            clients[0]!,
            fixture,
            paymentFact!.id
          )
        ).rejects.toThrow("OperatingImpactEntry_supported_subject_check");

        const sameCompanyPaymentFact = await clients[0]!.operatingFact.findUnique({
          where: {
            sourceType_sourceBusinessId: {
              sourceType: "payment_execution",
              sourceBusinessId: fixture.sameCompanyPaymentExecutionId
            }
          },
          include: { impacts: true }
        });
        expect(sameCompanyPaymentFact).toEqual(
          expect.objectContaining({
            debtorSubjectId: fixture.company1Id,
            approvedPayerSubjectId: fixture.company1Id,
            actualPayerSubjectId: fixture.company1Id,
            operatingLevel: "project"
          })
        );
        expect(
          sameCompanyPaymentFact?.impacts.some(
            (impact) => impact.impactKind === "inter_subject_balance_increase"
          )
        ).toBe(false);

        const financeRecords = await clients[0]!.financeRecord.count({
          where: { projectId: fixture.projectId }
        });
        const financeFacts = await clients[0]!.operatingFact.count({
          where: { projectId: fixture.projectId, sourceType: "finance_record" }
        });
        assert.equal(financeRecords, 1);
        assert.equal(financeFacts, 0);

        const comparison = await services[0]!.compareProject(
          fixture.projectId,
          fixture.financeUserId
        );
        expect(comparison).toEqual(
          expect.objectContaining({
            consistent: true,
            summary: {
              expectedFacts: 8,
              actualFacts: 8,
              expectedImpacts: 15,
              actualImpacts: 15,
              differenceCount: 0
            }
          })
        );

        const ownerPaymentProbe = await appendOwnerPaymentRoleProbe(
          clients[0]!,
          fixture
        );
        expect(ownerPaymentProbe).toEqual(
          expect.objectContaining({ created: true })
        );
        expect(
          await clients[0]!.operatingFact.findUnique({
            where: {
              sourceType_sourceBusinessId: {
                sourceType: "pol05_owner_payment_role_probe",
                sourceBusinessId: `${fixture.prefix}_owner_payment`
              }
            },
            include: { impacts: true }
          })
        ).toEqual(
          expect.objectContaining({
            factKind: "owner_payment",
            actualPayerSubjectKind: "owner",
            impacts: [
              expect.objectContaining({
                subjectRole: "actual_payer",
                subjectKind: "owner"
              })
            ]
          })
        );

        await seedOverApprovedExecution(clients[0]!, fixture);
        await expect(
          services[0]!.replaySource(
            locator(
              fixture,
              "payment_execution",
              fixture.overApprovedExecutionId
            ),
            fixture.financeUserId
          )
        ).rejects.toThrow("累计金额超过付款申请批复金额");
        expect(
          await clients[0]!.operatingFact.count({
            where: {
              sourceType: "payment_execution",
              sourceBusinessId: fixture.overApprovedExecutionId
            }
          })
        ).toBe(0);
        await assertDirectOwnerReceipt(clients[0]!, clients[1]!, fixture, "POL-05 建设单位");
        await expect(readProjectOwnerBalance(
          clients[1]!, fixture.projectId, new Date("2026-09-01T00:00:00.000Z"), new Date()
        )).resolves.toEqual({
          settlementYuan: "4000.0000", receivedYuan: "20.0000", outstandingYuan: "3980.0000", advanceYuan: "0.0000"
        });
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    90_000
  );
  integrationTest("登记四位正负业主结算，同原键重放及并发减额保持收入、应收和资金独立", async () => {
    const url = assertDedicatedDatabase();
    const runtimeUrl = process.env.PROJECT_OWNER_SETTLEMENT_TEST_RUNTIME_URL;
    const runtime = runtimeUrl ? new URL(runtimeUrl) : null;
    const target = new URL(url);
    if (runtime && (runtime.origin !== target.origin || runtime.pathname !== target.pathname ||
      runtime.hostname !== target.hostname || runtime.port !== target.port ||
      runtime.username !== "jg_owner_settlement_test_runtime")) {
      throw new Error("业主结算测试只允许当前专库的隔离运行身份");
    }
    const owner = new PrismaClient({ datasources: { db: { url } } });
    const first = new PrismaClient({ datasources: { db: { url: runtimeUrl ?? url } } });
    const second = new PrismaClient({ datasources: { db: { url: runtimeUrl ?? url } } });
    const fixture = fixtureIds();
    const service = (client: PrismaClient) =>
      new ProjectService(client as never, new AuditService(), undefined, undefined, replayService(client));
    try {
      await seedFixture(owner, fixture);
      const voucher = await owner.fileObject.create({
        data: {
          bucket: "pol05-local-test", objectKey: `${fixture.prefix}_owner_settlement`,
          originalName: "业主结算凭证.pdf", mimeType: "application/pdf", sizeBytes: 1,
          uploadedByUserId: fixture.financeUserId, storageStatus: "active", contentSha256: "e".repeat(64)
        }
      });
      const base = {
        ownerName: "虚构业主结算单位", settledAt: "2026-08-14", voucherFileId: voucher.id
      };
      const submit = (client: PrismaClient, amountYuan: string, idempotencyKey = randomUUID()) =>
        service(client).recordOwnerSettlement(fixture.projectId, fixture.financeUserId, {
          ...base, amountYuan, idempotencyKey
        });
      await expect(service(first).recordOwnerSettlement(fixture.projectId, fixture.managerUserId, {
        ...base, amountYuan: "1.0000", idempotencyKey: randomUUID()
      })).rejects.toThrow("无权登记业主结算");
      const audit = new AuditService();
      const projection = new OperatingProjectionService(owner as never, new ProjectVisibilityService(owner as never),
        new ClearingReconciliationReaderService(owner as never, new CompanyRoleResolverService(owner as never)),
        audit, new AuthService(owner as never, undefined as never, audit));
      const readCloseProjection = () => owner.$transaction(tx =>
        projection.readProjectInTransaction(tx, fixture.financeUserId, { projectId: fixture.projectId }));
      await submit(first, "1.2300");
      await expect(readCloseProjection()).resolves.toMatchObject({
        projection: { operating: { confirmedIncomeCents: "123", receivableCents: "123" } }
      });
      await submit(first, "-1.2300");

      const originalKey = randomUUID();
      const registered = await submit(first, "10.0001", originalKey);
      await expect(submit(second, "10.0001", originalKey)).resolves.toEqual(registered);
      if (process.env.PROJECT_OWNER_SETTLEMENT_TEST_RUNTIME_URL) {
        const binding = await first.$queryRaw<Array<{ bound: boolean }>>`
          SELECT public.jg_project_owner_settlement_voucher_bound(${voucher.id}) AS bound
        `;
        expect(binding).toEqual([{ bound: true }]);
        const expense = await owner.projectExpenseRequest.create({ data: {
          projectId: fixture.projectId, code: `${fixture.prefix}_owner_voucher_rebind`,
          expenseType: "sporadic_payment", expenseSubtype: "sporadic_material", paymentSubject: "our_company",
          reason: "核对独占凭证冲突", requestedAmountCents: 100n, approvedAmountCents: 100n,
          paymentMethod: "bank_transfer", handlerUserId: fixture.financeUserId,
          applicantUserId: fixture.financeUserId, status: "approved_pending_payment",
        } });
        const constraint = await owner.$transaction(async tx => {
          await tx.$executeRaw`
            CREATE FUNCTION pg_temp.try_owner_voucher_rebind(
              execution_id TEXT, request_key TEXT, expense_id TEXT, project_id TEXT, actor_id TEXT, voucher_id TEXT
            ) RETURNS TEXT LANGUAGE plpgsql AS $$
            DECLARE violated TEXT;
            BEGIN
              INSERT INTO public."ProjectExpenseExecution"
                ("id", "idempotencyKey", "projectExpenseRequestId", "projectId", "amountCents", "paidAt", "executedByUserId", "voucherFileId")
              VALUES (execution_id, request_key, expense_id, project_id, 100, now(), actor_id, voucher_id);
              RETURN NULL;
            EXCEPTION WHEN unique_violation THEN
              GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
              RETURN violated;
            END $$;
          `;
          return tx.$queryRaw<Array<{ constraint: string }>>`
            SELECT pg_temp.try_owner_voucher_rebind(${randomUUID()}, ${randomUUID()}, ${expense.id},
              ${fixture.projectId}, ${fixture.financeUserId}, ${voucher.id}) AS "constraint"
          `;
        });
        expect(constraint).toEqual([{ constraint: "exclusive_file_business_binding_guard" }]);
        expect(await owner.projectExpenseExecution.count({ where: { projectExpenseRequestId: expense.id } })).toBe(0);
      }

      const negativeKeys = [randomUUID(), randomUUID()];
      const results = await Promise.allSettled([
        submit(first, "-8.0000", negativeKeys[0]), submit(second, "-8.0000", negativeKeys[1])
      ]);
      const successful = results.filter(result => result.status === "fulfilled");
      expect(successful).toHaveLength(1);
      expect(results.find(result => result.status === "rejected")).toMatchObject({
        reason: expect.objectContaining({ message: "业主累计结算不能低于零" })
      });
      const observed = await second.operatingFact.findMany({
        where: { projectId: fixture.projectId, sourceType: "project_owner_settlement_entry",
          sourceBusinessId: { in: [registered.id, ...successful.map(result => result.value.id)] } },
        include: { impacts: true }, orderBy: { amountYuan: "desc" }
      });
      expect(observed.map(row => row.amountYuan?.toFixed(4))).toEqual(["10.0001", "8.0000"]);
      expect(observed.map(row => row.impacts.map(impact => [impact.impactKind, impact.direction]).sort())).toEqual([
        [["confirmed_income", "increase"], ["receivable_increase", "increase"]],
        [["confirmed_income", "decrease"], ["receivable_decrease", "decrease"]]
      ]);
      await expect(readProjectOwnerBalance(
        second, fixture.projectId, new Date("2026-09-01T00:00:00.000Z"), new Date()
      )).resolves.toEqual({ settlementYuan: "2.0001", receivedYuan: "0.0000",
        outstandingYuan: "2.0001", advanceYuan: "0.0000" });
      const advanceOwner = "先付后结的虚构业主";
      await assertDirectOwnerReceipt(owner, owner, fixture, advanceOwner);
      const readOwnerBalance = () =>
        readProjectOwnerBalance(second, fixture.projectId, new Date("2026-09-01T00:00:00.000Z"), new Date());
      await expect(readOwnerBalance()).resolves.toEqual({
        settlementYuan: "2.0001", receivedYuan: "20.0000", outstandingYuan: "2.0001", advanceYuan: "20.0000"
      });
      const settleAdvanceOwner = (amountYuan: string) =>
        service(first).recordOwnerSettlement(fixture.projectId, fixture.financeUserId, {
          ...base, ownerName: advanceOwner, amountYuan, idempotencyKey: randomUUID()
        });
      await settleAdvanceOwner("100.0000");
      await expect(readOwnerBalance()).resolves.toEqual({
        settlementYuan: "102.0001", receivedYuan: "20.0000", outstandingYuan: "82.0001", advanceYuan: "0.0000"
      });
      await settleAdvanceOwner("-90.0000");
      await expect(readOwnerBalance()).resolves.toEqual({
        settlementYuan: "12.0001", receivedYuan: "20.0000", outstandingYuan: "2.0001", advanceYuan: "10.0000"
      });

      await expect(readCloseProjection()).rejects.toBeInstanceOf(OwnerSettlementBelowCentForCloseError);
      const overview = await projection.getProjectView(fixture.financeUserId, {
        projectId: fixture.projectId, numericProtocolVersion: 2
      });
      expect(overview.operating).toMatchObject({
        confirmedIncomeCents: null, confirmedIncomeYuan: "12.0001", receivableYuan: "12.0001"
      });
      expect(overview.actualFunds.constructionEnterpriseFundsCents).toBe("2000");
    } finally {
      await Promise.allSettled([owner.$disconnect(), first.$disconnect(), second.$disconnect()]);
    }
  }, 90_000);

});

async function assertDirectOwnerReceipt(
  first: PrismaClient,
  second: PrismaClient,
  fixture: ReturnType<typeof fixtureIds>,
  counterpartyName: string
) {
  const makeProjectService = (client: PrismaClient) => {
    const audit = new AuditService();
    const auth = new AuthService(client as never, undefined as never, audit);
    return {
      auth,
      project: new ProjectService(client as never, audit, auth, undefined,
        replayService(client), undefined, new ProjectUpstreamFundBusinessEntryService(audit))
    };
  };
  const [left, right] = [makeProjectService(first), makeProjectService(second)];
  const financeUserId = fixture.financeUserId;
  const password = randomUUID();
  await first.user.update({
    where: { id: financeUserId },
    data: { passwordHash: await left!.auth.hashPassword(password) }
  });
  const signatureFile = await first.fileObject.create({
    data: {
      bucket: "pol05-local-test", objectKey: `${fixture.prefix}_canvas`,
      originalName: "手写签名.png", mimeType: "image/png", sizeBytes: 1,
      uploadedByUserId: financeUserId, storageStatus: "active", contentSha256: "b".repeat(64)
    }
  });
  await first.handwrittenSignatureVersion.create({
    data: {
      userId: financeUserId, fileId: signatureFile.id, contentSha256: "b".repeat(64)
    }
  });
  const evidence = await first.fileObject.create({
    data: {
      bucket: "pol05-local-test", objectKey: `${fixture.prefix}_owner-receipt`,
      originalName: "业主到账依据.pdf", mimeType: "application/pdf", sizeBytes: 1,
      uploadedByUserId: financeUserId, storageStatus: "active", contentSha256: "c".repeat(64)
    }
  });
  const input = {
    factType: "owner_payment_to_affiliate" as const, basisType: "written" as const,
    occurredAt: "2026-08-05", amountCents: "2000", counterpartyName,
    evidenceFileId: evidence.id, idempotencyKey: randomUUID(), confirmedReceipt: true,
    confirmationPassword: password
  };
  const results = await Promise.all([
    left!.project.recordUpstreamFundFact(fixture.projectId, financeUserId, input),
    right!.project.recordUpstreamFundFact(fixture.projectId, financeUserId, input)
  ]);
  expect(results[0]).toMatchObject({ status: "confirmed", cashEffectCents: "0" });
  expect(results[1]).toMatchObject({ id: results[0].id, status: "confirmed", cashEffectCents: "0" });
  const booked = await second.operatingFact.findMany({
    where: { projectId: fixture.projectId, sourceType: "project_upstream_fund_fact",
      sourceBusinessId: results[0].id },
    include: { impacts: true }
  });
  expect(booked).toMatchObject([{
    factKind: "owner_payment", amountCents: 2000n,
    impacts: [{ impactKind: "construction_enterprise_funds_increase", amountCents: 2000n }]
  }]);
}

function replayService(client: PrismaClient) {
  return new OperatingSourceReplayService(
    client as never,
    new OperatingLedgerService(client as never),
    createOperatingSourceRegistry()
  );
}

function locator(
  fixture: ReturnType<typeof fixtureIds>,
  sourceType: string,
  sourceBusinessId: string
) {
  return { projectId: fixture.projectId, sourceType, sourceBusinessId };
}

function fixtureIds() {
  const prefix = `pol05_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    affiliateName: `POL-05 施工企业 ${prefix}`,
    counterpartyName: `POL-05 下游供应商 ${prefix}`,
    projectId: `${prefix}_project`,
    financeUserId: `${prefix}_finance`,
    managerUserId: `${prefix}_manager`,
    affiliateAssignmentId: `${prefix}_affiliate_assignment`,
    affiliatePartyId: `${prefix}_affiliate_party`,
    affiliateVersionId: `${prefix}_affiliate_version`,
    company1Id: `${prefix}_company_1`,
    company1VersionId: `${prefix}_company_version_1`,
    company2Id: `${prefix}_company_2`,
    company2VersionId: `${prefix}_company_version_2`,
    counterpartyId: `${prefix}_counterparty`,
    counterpartyVersionId: `${prefix}_counterparty_version`,
    contractId: `${prefix}_contract`,
    contractVersionId: `${prefix}_contract_version`,
    affiliateContractId: `${prefix}_affiliate_contract`,
    affiliateContractVersionId: `${prefix}_affiliate_contract_version`,
    paymentTermsVersionId: `${prefix}_terms`,
    settlement1Id: `${prefix}_settlement_1`,
    settlement2Id: `${prefix}_settlement_2`,
    draftSettlementId: `${prefix}_settlement_draft`,
    upstreamSettlementId: `${prefix}_upstream`,
    paymentRequestId: `${prefix}_payment_request`,
    paymentExecutionId: `${prefix}_payment_execution`,
    sameCompanyPaymentRequestId: `${prefix}_same_company_payment_request`,
    sameCompanyPaymentExecutionId: `${prefix}_same_company_payment_execution`,
    proxyPaymentId: `${prefix}_proxy_payment`,
    overApprovedRequestId: `${prefix}_over_request`,
    overApprovedExecutionId: `${prefix}_over_execution`
  };
}

async function seedFixture(
  client: PrismaClient,
  fixture: ReturnType<typeof fixtureIds>
) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("POL-05 PostgreSQL 测试缺少经营账写入密钥");
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, crypt(${secret}, gen_salt('bf')))
    ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
  `);
  await client.user.createMany({
    data: [
      {
        id: fixture.financeUserId,
        name: "POL-05 项目财务",
        mustChangePassword: false,
        isActive: true
      },
      {
        id: fixture.managerUserId,
        name: "POL-05 项目经理",
        mustChangePassword: false,
        isActive: true
      }
    ]
  });
  await client.project.create({
    data: {
      id: fixture.projectId,
      code: fixture.projectId,
      name: "POL-05 经营来源项目"
    }
  });
  await client.projectMember.createMany({
    data: [
      {
        id: `${fixture.prefix}_finance_member`,
        projectId: fixture.projectId,
        userId: fixture.financeUserId,
        positionKey: "finance_staff"
      },
      {
        id: `${fixture.prefix}_manager_member`,
        projectId: fixture.projectId,
        userId: fixture.managerUserId,
        positionKey: "project_manager"
      }
    ]
  });
  await client.businessParty.createMany({
    data: [
      {
        id: fixture.affiliatePartyId,
        name: fixture.affiliateName,
        normalizedName: fixture.affiliateName,
        unifiedSocialCreditCode: `${fixture.prefix}AFF`,
        createdByUserId: fixture.financeUserId
      },
      {
        id: fixture.counterpartyId,
        name: fixture.counterpartyName,
        normalizedName: fixture.counterpartyName,
        unifiedSocialCreditCode: `${fixture.prefix}PAYEE`,
        createdByUserId: fixture.financeUserId
      }
    ]
  });
  await client.businessPartyVersion.createMany({
    data: [
      {
        id: fixture.affiliateVersionId,
        businessPartyId: fixture.affiliatePartyId,
        versionNo: 1,
        snapshot: { name: fixture.affiliateName },
        createdByUserId: fixture.financeUserId
      },
      {
        id: fixture.counterpartyVersionId,
        businessPartyId: fixture.counterpartyId,
        versionNo: 1,
        snapshot: { name: fixture.counterpartyName },
        createdByUserId: fixture.financeUserId
      }
    ]
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: fixture.affiliateAssignmentId,
      projectId: fixture.projectId,
      businessPartyId: fixture.affiliatePartyId,
      businessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      affiliateCreditCodeSnapshot: `${fixture.prefix}AFF`,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "POL-05 测试",
      assignedByUserId: fixture.financeUserId
    }
  });
  for (const company of [
    {
      id: fixture.company1Id,
      versionId: fixture.company1VersionId,
      name: "POL-05 原债务公司",
      creditCode: `${fixture.prefix}C1`
    },
    {
      id: fixture.company2Id,
      versionId: fixture.company2VersionId,
      name: "POL-05 实际代付公司",
      creditCode: `${fixture.prefix}C2`
    }
  ]) {
    await client.companyEntity.create({
      data: {
        id: company.id,
        name: company.name,
        unifiedSocialCreditCode: company.creditCode,
        dataStatus: "complete",
        currentVersionNo: 1
      }
    });
    await client.companyEntityVersion.create({
      data: {
        id: company.versionId,
        companyEntityId: company.id,
        versionNo: 1,
        name: company.name,
        unifiedSocialCreditCode: company.creditCode,
        isActive: true,
        action: "POL05_TEST",
        actorUserId: fixture.financeUserId
      }
    });
    await client.projectParticipatingCompany.create({
      data: {
        id: `${company.id}_participant`,
        projectId: fixture.projectId,
        companyEntityId: company.id,
        companyEntityVersionId: company.versionId,
        companyNameSnapshot: company.name,
        companyCreditCodeSnapshot: company.creditCode,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        changeReason: "POL-05 测试",
        addedByUserId: fixture.financeUserId
      }
    });
  }

  await client.project.update({
    where: { id: fixture.projectId },
    data: { operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z") }
  });

  await client.contract.create({
    data: {
      id: fixture.contractId,
      projectId: fixture.projectId,
      code: `${fixture.prefix}-CON`,
      name: "POL-05 材料合同",
      counterparty: fixture.counterpartyName,
      contractTypeKey: "material_purchase"
    }
  });
  await client.contractVersion.create({
    data: {
      id: fixture.contractVersionId,
      contractId: fixture.contractId,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents: 500_000n,
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      companyEntityIdSnapshot: fixture.company1Id,
      companyEntityVersionId: fixture.company1VersionId,
      companyEntityNameSnapshot: "POL-05 原债务公司",
      companyEntityCreditCodeSnapshot: `${fixture.prefix}C1`,
      signingSubjectType: "our_company",
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.paymentTermsVersion.create({
    data: {
      id: fixture.paymentTermsVersionId,
      contractId: fixture.contractId,
      contractVersionId: fixture.contractVersionId,
      versionNo: 1,
      status: "effective",
      originalText: "按生效结算付款"
    }
  });
  await client.contractPartySnapshot.create({
    data: {
      id: `${fixture.prefix}_party_b`,
      contractVersionId: fixture.contractVersionId,
      roleKey: "party_b",
      displayOrder: 1,
      businessPartyVersionId: fixture.counterpartyVersionId,
      snapshot: { name: fixture.counterpartyName }
    }
  });
  await client.contract.create({
    data: {
      id: fixture.affiliateContractId,
      projectId: fixture.projectId,
      code: `${fixture.prefix}-AFF-CON`,
      name: "POL-05 施工企业材料合同",
      counterparty: fixture.counterpartyName,
      contractTypeKey: "material_purchase"
    }
  });
  await client.contractVersion.create({
    data: {
      id: fixture.affiliateContractVersionId,
      contractId: fixture.affiliateContractId,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents: 100_000n,
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      signingSubjectType: "affiliate",
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      affiliateCreditCodeSnapshot: `${fixture.prefix}AFF`,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.contractPartySnapshot.create({
    data: {
      id: `${fixture.prefix}_affiliate_party_b`,
      contractVersionId: fixture.affiliateContractVersionId,
      roleKey: "party_b",
      displayOrder: 1,
      businessPartyVersionId: fixture.counterpartyVersionId,
      snapshot: { name: fixture.counterpartyName }
    }
  });

  const fileIds = [
    "settlement-1",
    "settlement-2",
    "upstream",
    "payment",
    "proxy",
    "same-company-payment",
    "over-payment"
  ].map((suffix) => `${fixture.prefix}_file_${suffix}`);
  await client.fileObject.createMany({
    data: fileIds.map((id) => ({
      id,
      bucket: "pol05-local-test",
      objectKey: id,
      originalName: `${id}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId: fixture.financeUserId,
      contentSha256: "a".repeat(64)
    }))
  });

  for (const contractVersionId of [fixture.contractVersionId, fixture.affiliateContractVersionId]) {
    const fileId = `${contractVersionId}_archive`;
    await client.fileObject.create({ data: {
      id: fileId, bucket: "pol05-local-test", objectKey: fileId, originalName: "合成签章合同.pdf",
      mimeType: "application/pdf", sizeBytes: 1, uploadedByUserId: fixture.financeUserId,
      contentSha256: "b".repeat(64)
    } });
    await client.contractArchiveFile.create({ data: {
      contractVersionId, fileId, uploadedByUserId: fixture.financeUserId,
      confirmedByUserId: fixture.financeUserId, confirmedAt: new Date("2026-08-01T00:00:00.000Z"), status: "confirmed"
    } });
  }

  for (const settlement of [
    {
      id: fixture.settlement1Id,
      code: `${fixture.prefix}-SET-1`,
      amountCents: 100_000n,
      payableAmountCents: 90_000n,
      periodLabel: "2026年7月",
      periodEnd: new Date("2026-07-31T00:00:00.000Z"),
      fileId: fileIds[0]!
    },
    {
      id: fixture.settlement2Id,
      code: `${fixture.prefix}-SET-2`,
      amountCents: 200_000n,
      payableAmountCents: 180_000n,
      periodLabel: "2026年8月",
      periodEnd: new Date("2026-08-12T00:00:00.000Z"),
      fileId: fileIds[1]!
    }
  ]) {
    await client.settlement.create({
      data: {
        id: settlement.id,
        projectId: fixture.projectId,
        contractId: fixture.contractId,
        contractVersionId: fixture.contractVersionId,
        paymentTermsVersionId: fixture.paymentTermsVersionId,
        code: settlement.code,
        periodLabel: settlement.periodLabel,
        status: "effective",
        amountCents: settlement.amountCents,
        payableAmountCents: settlement.payableAmountCents,
        periodEnd: settlement.periodEnd,
        calculationVersion: 1,
        governanceVersion: 1
      }
    });
    await client.settlementSignedDocument.create({
      data: {
        id: `${settlement.id}_document`,
        settlementId: settlement.id,
        purpose: "final_internal_signed_copy",
        fileId: settlement.fileId,
        contentSha256: "a".repeat(64),
        pageCount: 1,
        sourceRevision: 1,
        businessSnapshotToken: `${settlement.id}_snapshot`,
        approvalActionSetHash: "b".repeat(64),
        status: "active",
        generationStatus: "completed",
        generatedByUserId: fixture.financeUserId,
        confirmedByUserId: fixture.financeUserId,
        confirmedAt: new Date("2026-08-13T00:00:00.000Z")
      }
    });
  }
  await client.settlement.create({
    data: {
      id: fixture.draftSettlementId,
      projectId: fixture.projectId,
      contractId: fixture.contractId,
      contractVersionId: fixture.contractVersionId,
      paymentTermsVersionId: fixture.paymentTermsVersionId,
      code: `${fixture.prefix}-SET-DRAFT`,
      periodLabel: "2026年9月",
      status: "pending_archive_confirm",
      amountCents: 10_000n,
      payableAmountCents: 10_000n
    }
  });
  await client.projectUpstreamSettlement.create({
    data: {
      id: fixture.upstreamSettlementId,
      projectId: fixture.projectId,
      settledAt: new Date("2026-08-12T00:00:00.000Z"),
      reportedAmountCents: 420_000n,
      approvedAmountCents: 400_000n,
      approvingPartyName: "POL-05 建设单位",
      periodLabel: "2026年8月",
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      voucherFileId: fileIds[2]!,
      fileContentSha256Snapshot: "a".repeat(64),
      recordedByUserId: fixture.financeUserId,
      status: "confirmed",
      confirmedByUserId: fixture.financeUserId,
      confirmedAt: new Date("2026-08-13T00:00:00.000Z"),
      confirmationSignatureVersionId: `${fixture.prefix}_signature_version`,
      confirmationSignatureFileId: fileIds[2]!,
      confirmationSignatureSha256: "b".repeat(64)
    }
  });
  await client.paymentRequest.create({
    data: {
      id: fixture.paymentRequestId,
      projectId: fixture.projectId,
      sourceType: "contract_due",
      contractId: fixture.contractId,
      contractVersionId: fixture.contractVersionId,
      paymentTermsVersionId: fixture.paymentTermsVersionId,
      code: `${fixture.prefix}-PAY`,
      status: "partially_paid",
      requestedAmountCents: 100_000n,
      approvedAmountCents: 100_000n,
      paidAmountCents: 60_000n,
      paymentSubjectType: "our_company"
    }
  });
  await client.paymentExecution.create({
    data: {
      id: fixture.paymentExecutionId,
      idempotencyKey: randomUUID(),
      paymentRequestId: fixture.paymentRequestId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: fixture.company2Id,
      companyEntityNameSnapshot: "POL-05 实际代付公司",
      companyEntityCreditCodeSnapshot: `${fixture.prefix}C2`,
      amountCents: 60_000n,
      paidAt: new Date("2026-08-14T00:00:00.000Z"),
      executedByUserId: fixture.financeUserId,
      voucherFileId: fileIds[3]!
    }
  });
  await client.paymentExecutionAllocation.createMany({
    data: [
      allocation(fixture, fixture.settlement1Id, 25_000n, 1),
      allocation(fixture, fixture.settlement2Id, 35_000n, 2),
      {
        ...allocation(fixture, `${fixture.prefix}_advance`, 10_000n, 1),
        settlementId: fixture.settlement1Id,
        allocationType: "advance_deduction"
      }
    ]
  });
  await client.paymentRequest.create({
    data: {
      id: fixture.sameCompanyPaymentRequestId,
      projectId: fixture.projectId,
      sourceType: "contract_advance",
      contractId: fixture.contractId,
      contractVersionId: fixture.contractVersionId,
      paymentTermsVersionId: fixture.paymentTermsVersionId,
      code: `${fixture.prefix}-PAY-SAME`,
      status: "paid",
      requestedAmountCents: 10_000n,
      approvedAmountCents: 10_000n,
      paidAmountCents: 10_000n,
      paymentSubjectType: "our_company"
    }
  });
  await client.paymentExecution.create({
    data: {
      id: fixture.sameCompanyPaymentExecutionId,
      idempotencyKey: randomUUID(),
      paymentRequestId: fixture.sameCompanyPaymentRequestId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: fixture.company1Id,
      companyEntityNameSnapshot: "POL-05 原债务公司",
      companyEntityCreditCodeSnapshot: `${fixture.prefix}C1`,
      amountCents: 10_000n,
      paidAt: new Date("2026-08-14T00:15:00.000Z"),
      executedByUserId: fixture.financeUserId,
      voucherFileId: fileIds[5]!
    }
  });
  await client.projectProxyPayment.create({
    data: {
      id: fixture.proxyPaymentId,
      projectId: fixture.projectId,
      paidAt: new Date("2026-08-14T00:30:00.000Z"),
      amountCents: 20_000n,
      generalContractorName: fixture.affiliateName,
      paidTargetName: fixture.counterpartyName,
      paymentType: "material",
      paymentSubjectType: "affiliate",
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      voucherFileId: fileIds[4]!,
      recordedByUserId: fixture.financeUserId,
      contractId: fixture.affiliateContractId,
      settlementId: null
    }
  });
  await client.financeRecord.create({
    data: {
      id: `${fixture.prefix}_finance_record`,
      idempotencyKey: randomUUID(),
      projectId: fixture.projectId,
      paymentRequestId: fixture.paymentRequestId,
      direction: "outflow",
      amountCents: 60_000n,
      occurredAt: new Date("2026-08-14T00:00:00.000Z"),
      createdByUserId: fixture.financeUserId
    }
  });
}

function allocation(
  fixture: ReturnType<typeof fixtureIds>,
  settlementId: string,
  amountCents: bigint,
  allocationOrder: number
) {
  return {
    id: `${fixture.prefix}_allocation_${allocationOrder}_${settlementId}`,
    paymentExecutionId: fixture.paymentExecutionId,
    paymentRequestId: fixture.paymentRequestId,
    projectId: fixture.projectId,
    contractId: fixture.contractId,
    contractVersionId: fixture.contractVersionId,
    settlementId,
    sourceType: "contract_due",
    allocationType: "contract_due_payment",
    sourceRowId: settlementId,
    paymentTermsVersionId: fixture.paymentTermsVersionId,
    stageType: "progress",
    sourcePayableAmountCents: amountCents,
    amountCents,
    allocationOrder,
    createdByUserId: fixture.financeUserId
  };
}

async function seedOverApprovedExecution(
  client: PrismaClient,
  fixture: ReturnType<typeof fixtureIds>
) {
  const voucherFileId = `${fixture.prefix}_file_over-payment`;
  await client.paymentRequest.create({
    data: {
      id: fixture.overApprovedRequestId,
      projectId: fixture.projectId,
      sourceType: "contract_advance",
      contractId: fixture.contractId,
      contractVersionId: fixture.contractVersionId,
      paymentTermsVersionId: fixture.paymentTermsVersionId,
      code: `${fixture.prefix}-PAY-OVER`,
      status: "approved_pending_payment",
      requestedAmountCents: 10_000n,
      approvedAmountCents: 10_000n,
      paidAmountCents: 0n,
      paymentSubjectType: "our_company"
    }
  });
  await client.paymentExecution.create({
    data: {
      id: fixture.overApprovedExecutionId,
      idempotencyKey: randomUUID(),
      paymentRequestId: fixture.overApprovedRequestId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: fixture.company1Id,
      companyEntityNameSnapshot: "POL-05 原债务公司",
      companyEntityCreditCodeSnapshot: `${fixture.prefix}C1`,
      amountCents: 10_001n,
      paidAt: new Date("2026-08-14T02:00:00.000Z"),
      executedByUserId: fixture.financeUserId,
      voucherFileId
    }
  });
}

async function insertInvalidPayerRoleImpact(
  client: PrismaClient,
  fixture: ReturnType<typeof fixtureIds>,
  factId: string
) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("POL-05 PostgreSQL 测试缺少经营账写入密钥");
  return client.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${fixture.financeUserId}, ${secret})`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.operating_ledger_actor', ${fixture.financeUserId}, true)`
    );
    return tx.$executeRaw(Prisma.sql`
      INSERT INTO "OperatingImpactEntry" (
        "id", "factId", "projectId", "sourceType", "sourceBusinessId",
        "sourceImpactKey", "idempotencyKey", "impactKind", "amountCents",
        "direction", "subjectRole", "subjectKind", "subjectId", "impactSnapshot"
      ) VALUES (
        ${`${fixture.prefix}_invalid_payer_role_impact`}, ${factId},
        ${fixture.projectId}, 'payment_execution', ${fixture.paymentExecutionId},
        'invalid-payer-role', ${`${fixture.prefix}_invalid_payer_role_key`},
        'inter_subject_balance_increase', 1, 'increase', 'actual_payer',
        'downstream_counterparty', ${fixture.counterpartyVersionId}, '{}'::jsonb
      )
    `);
  });
}

async function appendOwnerPaymentRoleProbe(
  client: PrismaClient,
  fixture: ReturnType<typeof fixtureIds>
) {
  return new OperatingLedgerService(client as never).appendFromSource(
    {
      projectId: fixture.projectId,
      sourceType: "pol05_owner_payment_role_probe",
      sourceBusinessId: `${fixture.prefix}_owner_payment`,
      sourceBusinessCode: `${fixture.prefix}-OWNER-PAYMENT`,
      sourceVersion: 1,
      idempotencyKey: `${fixture.prefix}_owner_payment`,
      occurredAt: new Date("2026-08-14T03:00:00.000Z"),
      confirmedAt: new Date("2026-08-14T03:00:00.000Z"),
      confirmedByUserId: fixture.financeUserId,
      factKind: "owner_payment",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: 1n,
      currencyCode: "CNY",
      direction: "inflow",
      isBeforeOperatingLedgerEffectiveDate: false,
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: fixture.affiliateName,
      affiliateCreditCodeSnapshot: `${fixture.prefix}AFF`,
      sourceSnapshot: { purpose: "actual_payer role constraint probe" },
      subjects: {
        actualPayer: { kind: "owner", id: `${fixture.prefix}_owner` },
        payee: {
          kind: "construction_enterprise",
          id: fixture.affiliateVersionId
        }
      },
      impacts: [
        {
          idempotencyKey: `${fixture.prefix}_owner_payment_impact`,
          sourceImpactKey: "receivable_decrease",
          impactKind: "receivable_decrease",
          amountCents: 1n,
          direction: "decrease",
          subjectRole: "actual_payer",
          subject: { kind: "owner", id: `${fixture.prefix}_owner` },
          description: "POL-05 业主实付主体约束回归探针"
        }
      ]
    },
    fixture.financeUserId
  );
}

async function operatingSummary(client: PrismaClient, projectId: string) {
  const [row] = await client.$queryRaw<
    Array<{
      factCount: bigint;
      confirmedCostCents: bigint;
      payableIncreaseCents: bigint;
      payableDecreaseCents: bigint;
      companyFundsDecreaseCents: bigint;
      affiliateFundsDecreaseCents: bigint;
      interSubjectCents: bigint;
    }>
  >(Prisma.sql`
    SELECT COUNT(DISTINCT fact."id")::bigint AS "factCount",
      COALESCE(SUM(impact."amountCents") FILTER (WHERE impact."impactKind" = 'confirmed_cost'), 0)::bigint AS "confirmedCostCents",
      COALESCE(SUM(impact."amountCents") FILTER (WHERE impact."impactKind" = 'payable_increase'), 0)::bigint AS "payableIncreaseCents",
      COALESCE(SUM(impact."amountCents") FILTER (WHERE impact."impactKind" = 'payable_decrease'), 0)::bigint AS "payableDecreaseCents",
      COALESCE(SUM(impact."amountCents") FILTER (WHERE impact."impactKind" = 'company_project_funds_decrease'), 0)::bigint AS "companyFundsDecreaseCents",
      COALESCE(SUM(impact."amountCents") FILTER (WHERE impact."impactKind" = 'construction_enterprise_funds_decrease'), 0)::bigint AS "affiliateFundsDecreaseCents",
      COALESCE(SUM(impact."amountCents") FILTER (WHERE impact."impactKind" = 'inter_subject_balance_increase'), 0)::bigint AS "interSubjectCents"
    FROM "OperatingFact" fact
    LEFT JOIN "OperatingImpactEntry" impact ON impact."factId" = fact."id"
    WHERE fact."projectId" = ${projectId}
  `);
  return row!;
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.OPERATING_LEDGER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("POL-05 来源测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    (parsed.pathname !== "/jiangkong_database_dynamic_misc" && !(process.env.NODE_ENV === "test" && /^[a-f0-9]{32}$/.test(process.env.JG_GENERIC_289_RUN_ID ?? "") &&
      parsed.pathname === `/jg_task01_${process.env.JG_GENERIC_289_RUN_ID}` && parsed.username === "jg_task01_owner" &&
      parsed.hostname === "127.0.0.1" && parsed.protocol === "postgresql:" &&
      parsed.searchParams.get("sslmode") === "require" && parsed.searchParams.get("sslaccept") === "strict"))
  ) {
    throw new Error("POL-05 来源测试只允许本机一次性 PostgreSQL 16 专库");
  }
  return databaseUrl;
}
