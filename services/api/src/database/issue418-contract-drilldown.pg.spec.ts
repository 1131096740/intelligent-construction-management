import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { assertOrderedIssue333Database } from "../../test-support/ordered-issue333-fixture";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { createOperatingSourceRegistry } from "../operating-ledger/operating-ledger.module";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { PAYMENT_EXECUTION_SOURCE_TYPE } from "../payment/payment-operating-source.adapter";
import { ProjectService } from "../project/project.service";
import { SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE } from "../settlement/signed-settlement-operating-source.adapter";

const run = process.env.ISSUE418_CONTRACT_DRILLDOWN_RUN === "1" ? describe : describe.skip;

run("issue #418 contract drill-down on the ordered operating ledger", () => {
  let prisma: PrismaService;

  beforeAll(() => {
    const raw = process.env.ISSUE418_CONTRACT_DRILLDOWN_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_CONTRACT_DRILLDOWN_DATABASE_REQUIRED");
    prisma = new PrismaService({ datasources: { db: { url: assertOrderedIssue333Database(raw) } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("审批中与已批待付分列，合同超付不抵扣另一合同未付", async () => {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error("ISSUE418_ISOLATED_LEDGER_SECRET");
    const installed = await prisma.$executeRaw`
      INSERT INTO public."OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, public.crypt(${secret}, public.gen_salt('bf'))) ON CONFLICT ("id") DO NOTHING
    `;
    expect(installed).toBe(1);

    const enabledAt = new Date("2026-10-01T00:00:00.000Z");
    const checkedAt = new Date("2026-11-01T00:00:00.000Z");
    const maker = await prisma.user.create({ data: { name: "合成结算经办" } });
    const reviewer = await prisma.user.create({ data: { name: "合成结算复核", isActive: true } });
    const reader = await prisma.user.create({ data: { name: "合成财务主管", isActive: true } });
    const project = await prisma.project.create({
      data: { code: "XM-418-DRILLDOWN", name: "合成合同钻取项目", isActive: true }
    });
    const finance = await prisma.position.upsert({
      where: { key: "finance_director" }, update: {},
      create: { key: "finance_director", name: "财务主管" }
    });
    await prisma.userPosition.create({
      data: { userId: reader.id, positionId: finance.id, projectId: project.id }
    });
    await prisma.projectRosterMember.create({ data: { projectId: project.id, userId: reader.id } });
    const enterprise = await prisma.businessParty.create({
      data: { name: "合成施工企业", normalizedName: "issue418-drilldown-enterprise", createdByUserId: maker.id }
    });
    const enterpriseVersion = await prisma.businessPartyVersion.create({
      data: {
        businessPartyId: enterprise.id, versionNo: 1,
        snapshot: { name: enterprise.name }, createdByUserId: maker.id
      }
    });
    const affiliate = await prisma.projectAffiliateAssignment.create({
      data: {
        projectId: project.id, businessPartyId: enterprise.id, businessPartyVersionId: enterpriseVersion.id,
        affiliateNameSnapshot: enterprise.name, effectiveFrom: enabledAt,
        changeReason: "合成结算投影验收", assignedByUserId: maker.id
      }
    });
    const company = await prisma.companyEntity.create({
      data: { name: "合成参与公司", isActive: true, unifiedSocialCreditCode: "913100000000000018" }
    });
    const companyVersion = await prisma.companyEntityVersion.create({
      data: {
        companyEntityId: company.id, versionNo: 1, name: company.name,
        unifiedSocialCreditCode: company.unifiedSocialCreditCode,
        isActive: true, action: "create", actorUserId: maker.id
      }
    });
    await prisma.companyEntity.update({
      where: { id: company.id }, data: { currentVersionNo: companyVersion.versionNo }
    });
    await prisma.projectParticipatingCompany.create({
      data: {
        projectId: project.id, companyEntityId: company.id, companyEntityVersionId: companyVersion.id,
        companyNameSnapshot: companyVersion.name, companyCreditCodeSnapshot: companyVersion.unifiedSocialCreditCode,
        effectiveFrom: enabledAt,
        changeReason: "合成结算投影验收", addedByUserId: maker.id
      }
    });
    await prisma.project.update({
      where: { id: project.id }, data: { operatingLedgerEffectiveDate: enabledAt }
    });
    const counterparty = await prisma.businessParty.create({
      data: { name: "合成劳务公司", normalizedName: "issue418-drilldown-counterparty", createdByUserId: maker.id }
    });
    const counterpartyVersion = await prisma.businessPartyVersion.create({
      data: {
        businessPartyId: counterparty.id, versionNo: 1,
        snapshot: { name: counterparty.name }, createdByUserId: maker.id
      }
    });

    const replay = new OperatingSourceReplayService(
      prisma, new OperatingLedgerService(prisma), createOperatingSourceRegistry()
    );

    async function createContract(code: string, name: string, affiliateSigning: boolean) {
      const contract = await prisma.contract.create({ data: {
        projectId: project.id, code, name, counterparty: counterparty.name, contractTypeKey: "labor_subcontract",
        ...(affiliateSigning ? {} : { companyEntityId: company.id, companyEntityName: company.name })
      } });
      const version = await prisma.contractVersion.create({ data: {
        contractId: contract.id, changeType: "original", status: "effective", versionNo: 1,
        amountCents: 12000n, numericProtocolVersion: 1, effectiveAt: checkedAt,
        ...(affiliateSigning ? {
          signingSubjectType: "affiliate", affiliateAssignmentId: affiliate.id,
          affiliateBusinessPartyVersionId: enterpriseVersion.id, affiliateNameSnapshot: enterprise.name
        } : {
          signingSubjectType: "our_company", companyEntityVersionId: companyVersion.id,
          companyEntityIdSnapshot: company.id, companyEntityNameSnapshot: company.name
        }),
        draftData: {}, templateSnapshot: {}, clauseSnapshot: []
      } });
      await prisma.contractPartySnapshot.create({ data: {
        contractVersionId: version.id, roleKey: "party_b", displayOrder: 1,
        businessPartyVersionId: counterpartyVersion.id, snapshot: { name: counterparty.name }
      } });
      const terms = await prisma.paymentTermsVersion.create({ data: {
        contractId: contract.id, contractVersionId: version.id, versionNo: 1,
        status: "effective", originalText: "以已确认结算为付款依据"
      } });
      return { contract, version, terms, affiliateSigning };
    }

    const first = await createContract("HT-418-1", "合成下游合同一", false);
    const second = await createContract("HT-418-OUT", "合成施工企业签约下游合同", true);
    async function appendSettlement(
      source: Awaited<ReturnType<typeof createContract>>,
      number: string,
      confirmationNo: bigint,
      amountYuan: string,
      reviewedAt: Date
    ) {
      const settled = await prisma.signedContractSettlement.create({ data: {
        projectId: project.id, contractKind: "downstream", contractId: source.contract.id,
        state: "confirmed", ownerUserId: maker.id, number, amountYuan, confirmationNo,
        submittedAt: reviewedAt, reviewedAt, reviewedByUserId: reviewer.id, revision: 2,
        confirmedContractSource: {
          relationship: source.affiliateSigning ? "outside" : "inside",
          sourceRecordId: source.version.id, sourceVersion: source.version.versionNo,
          contractTypeKey: "labor_subcontract", counterparty: counterparty.name,
          counterpartyKind: "downstream_counterparty", counterpartyVersionId: counterpartyVersion.id,
          payerKind: source.affiliateSigning ? "construction_enterprise" : "participating_company",
          payerVersionId: source.affiliateSigning ? enterpriseVersion.id : companyVersion.id,
          companyEntityId: source.affiliateSigning ? null : company.id,
          affiliateAssignmentId: affiliate.id, affiliateBusinessPartyVersionId: enterpriseVersion.id
        }
      } });
      await append(SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, settled.id);
      return settled;
    }

    async function append(sourceType: string, sourceBusinessId: string) {
      await expect(prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(
        tx, { projectId: project.id, sourceType, sourceBusinessId }, reviewer.id
      ))).resolves.toMatchObject({ created: true, sourceBusinessId });
    }

    // The payment was fully backed at the time. A later signed settlement lowers the effective total.
    const original = await appendSettlement(first, "JS-418-ONE", 1n, "70.0000", checkedAt);
    const paymentDate = new Date("2026-11-02T00:00:00.000Z");
    const correctionDate = new Date("2026-11-03T00:00:00.000Z");
    const request = await prisma.paymentRequest.create({ data: {
      projectId: project.id, contractId: first.contract.id, contractVersionId: first.version.id,
      paymentTermsVersionId: first.terms.id, code: "PAY-418-PAID", sourceType: "signed_settlement",
      status: "paid", requestedAmountCents: 7000n, approvedAmountCents: 7000n, paidAmountCents: 7000n,
      paymentSubjectType: "our_company", signedSettlementId: original.id, signedSettlementConfirmationNo: 1n,
      signedSettlementConfirmedYuan: "70.0000", signedSettlementContractConfirmedYuan: "70.0000",
      signedSettlementOccupiedCents: 0n, signedSettlementBasisAt: checkedAt, createdAt: checkedAt
    } });
    const voucher = await prisma.fileObject.create({ data: {
      bucket: "private-local", objectKey: "issue418-drilldown/paid-voucher.pdf", originalName: "实付合成凭证.pdf",
      mimeType: "application/pdf", sizeBytes: 128, uploadedByUserId: reviewer.id,
      contentSha256: "a".repeat(64), storageStatus: "active"
    } });
    const payment = await prisma.paymentExecution.create({ data: {
      paymentRequestId: request.id, amountCents: 7000n, paidAt: paymentDate, createdAt: paymentDate,
      idempotencyKey: randomUUID(), paymentSubjectType: "our_company", companyEntityIdSnapshot: company.id,
      companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: "913100000000000018",
      executedByUserId: reviewer.id, voucherFileId: voucher.id
    } });
    await append(PAYMENT_EXECUTION_SOURCE_TYPE, payment.id);
    await appendSettlement(first, "JS-418-ONE-ADJUSTMENT", 2n, "-10.0000", correctionDate);
    await appendSettlement(second, "JS-418-OUT", 1n, "30.0000", correctionDate);

    const pendingCoordinates = {
      projectId: project.id, contractId: first.contract.id, contractVersionId: first.version.id,
      paymentTermsVersionId: first.terms.id, sourceType: "contract_due", paymentSubjectType: "our_company",
      requestedAmountCents: 2000n, paidAmountCents: 0n
    };
    await prisma.paymentRequest.createMany({ data: [
      { ...pendingCoordinates, code: "PAY-418-REVIEW", status: "approval_pending" },
      { ...pendingCoordinates, code: "PAY-418-APPROVED", status: "approved_pending_payment", approvedAmountCents: 2000n }
    ] });

    const audit = new AuditService();
    const auth = new AuthService(prisma, new JwtTokenService(), audit);
    const projection = new OperatingProjectionService(
      prisma, new ProjectVisibilityService(prisma),
      new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)), audit, auth
    );
    const projects = new ProjectService(prisma, audit, auth, undefined, replay, projection);
    const overview = await projects.getOperatingFundsOverview(project.id, reader.id);
    expect(overview.contractDrilldown).toHaveLength(2);
    expect(overview.contractDrilldown).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contractKey: first.contract.id, contractCode: "HT-418-1", settledCents: "6000",
        paidCents: "7000", unpaidCents: "0", approvalPendingRequestCents: "2000",
        approvedPendingPaymentCents: "2000"
      }),
      expect.objectContaining({
        contractKey: second.contract.id, contractCode: "HT-418-OUT", settledCents: "3000",
        paidCents: "0", unpaidCents: "3000"
      })
    ]));
    expect(overview.contractDrilldown.every(row => row.unpaidCents !== null)).toBe(true);
    expect(overview.contractDrilldown.reduce((sum, row) => sum + BigInt(row.unpaidCents!), 0n)).toBe(3000n);
    const view = await projection.getProjectView(reader.id, { projectId: project.id });
    expect(view.operating.payableCents).toBe("2000");
  });
});
