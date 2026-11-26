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
import { FundFlowService } from "../fund-flow/fund-flow.service";
import { PAYMENT_EXECUTION_SOURCE_TYPE } from "../payment/payment-operating-source.adapter";
import {
  PROJECT_AFFILIATE_PAYMENT_FACT_SOURCE_TYPE,
  PROJECT_UPSTREAM_FUND_SOURCE_TYPE
} from "../project/project-operating-source.adapter";

const run = process.env.ISSUE418_PAIRED_FUNDS_RUN === "1" ? describe : describe.skip;

run("issue #418 paired payment metrics on the ordered operating ledger", () => {
  let prisma: PrismaService;

  beforeAll(() => {
    const raw = process.env.ISSUE418_PAIRED_FUNDS_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_PAIRED_FUNDS_DATABASE_REQUIRED");
    prisma = new PrismaService({ datasources: { db: { url: assertOrderedIssue333Database(raw) } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("施工企业已付八十元、项目对外支付七十元，资金流水使用同一分录", async () => {
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
      data: { code: "XM-418-FUNDS", name: "合成双口径付款项目", isActive: true }
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
      data: { name: "合成施工企业", normalizedName: "issue418-funds-enterprise", createdByUserId: maker.id }
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
      data: { name: "合成劳务公司", normalizedName: "issue418-funds-counterparty", createdByUserId: maker.id }
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

    const hash = "a".repeat(64);
    async function file(name: string, mimeType = "application/pdf", uploader = maker.id) {
      const row = await prisma.fileObject.create({ data: {
        bucket: "private-local", objectKey: `issue418-funds/${name}`, originalName: name, mimeType,
        sizeBytes: 128, uploadedByUserId: uploader, contentSha256: hash, storageStatus: "active"
      } });
      return row.id;
    }
    const signature = await prisma.handwrittenSignatureVersion.create({ data: {
      userId: reviewer.id, fileId: await file("signature.png", "image/png", reviewer.id),
      contentSha256: hash, source: "canvas"
    } });
    const frozen = {
      projectId: project.id, affiliateAssignmentId: affiliate.id,
      affiliateBusinessPartyVersionId: enterpriseVersion.id, affiliateNameSnapshot: enterprise.name,
      requestFingerprint: hash, recordedByUserId: maker.id, status: "confirmed",
      confirmedByUserId: reviewer.id, confirmedAt: checkedAt,
      confirmationSignatureVersionId: signature.id, confirmationSignatureFileId: signature.fileId,
      confirmationSignatureSha256: hash
    };
    function confirmedRecord(recordedByRoleKey: string) {
      return { ...frozen, recordedByRoleKey, idempotencyKey: randomUUID(), confirmationActionId: randomUUID() };
    }

    const directLedger = randomUUID();
    await prisma.projectAffiliateContractFact.create({ data: {
      ...confirmedRecord("contract_staff"), id: directLedger, ledgerId: directLedger,
      contractType: "labor_subcontract", externalContractReference: "HT-418-DIRECT",
      counterpartyName: counterparty.name, counterpartyVersionId: counterpartyVersion.id,
      signedAt: checkedAt, amountNature: "fixed", amountCents: 3000n, basisType: "oral"
    } });
    const directSettlementLedger = randomUUID();
    await prisma.projectAffiliateSettlementFact.create({ data: {
      ...confirmedRecord("budget_staff"), ledgerId: directSettlementLedger, contractLedgerId: directLedger,
      counterpartyName: counterparty.name, settledAt: checkedAt, periodLabel: "合成下游结算一期",
      amountCents: 3000n, basisType: "oral"
    } });
    const direct = await prisma.projectAffiliatePaymentFact.create({ data: {
      ...confirmedRecord("finance_staff"), ledgerId: randomUUID(), contractLedgerId: directLedger,
      settlementLedgerId: directSettlementLedger, counterpartyName: counterparty.name,
      paidAt: checkedAt, amountCents: 3000n, paymentKind: "normal",
      externalPaymentReference: "BANK-418-DIRECT", basisType: "oral"
    } });

    const upwardContract = await prisma.projectAffiliateCompanyContract.create({ data: {
      ...confirmedRecord("contract_staff"), contractReference: "HT-418-UPWARD", contractName: "合成对上协议",
      signedAt: checkedAt, rightsObligationsSummary: "合成对上计量与拨款协议", amountNature: "fixed",
      amountCents: 5000n, companyEntityId: company.id, companyEntityVersionId: companyVersion.id,
      companyEntityNameSnapshot: companyVersion.name, companyEntityCreditCodeSnapshot: "913100000000000018",
      fileId: await file("upward-contract.pdf"), fileContentSha256Snapshot: hash
    } });
    const upwardSettlement = await prisma.projectAffiliateSettlementFact.create({ data: {
      ...confirmedRecord("budget_staff"), ledgerId: randomUUID(), contractLedgerId: upwardContract.id,
      affiliateCompanyContractId: upwardContract.id, counterpartyName: company.name,
      settledAt: checkedAt, periodLabel: "合成对上结算一期", amountCents: 5000n, basisType: "oral"
    } });
    const invoice = await prisma.invoiceRecord.create({ data: {
      identityKey: "invoice-418-upward", invoiceCode: "123456789012", invoiceNumber: "00000418",
      projectId: project.id, invoiceType: "vat_general", issueDate: checkedAt,
      sellerName: company.name, buyerName: enterprise.name, totalAmountCents: 5000n,
      allocatableAmountCents: 5000n, fileId: await file("upward-invoice.pdf"), uploadedByUserId: maker.id,
      sourceBusinessType: "project_upstream_fund_fact", sourceBusinessId: upwardSettlement.id
    } });
    const remittance = await prisma.projectUpstreamFundFact.create({ data: {
      ...confirmedRecord("finance_staff"), factType: "affiliate_remittance_to_company",
      occurredAt: checkedAt, amountCents: 5000n, basisType: "oral", counterpartyName: company.name,
      companyEntityId: company.id, affiliateCompanyContractId: upwardContract.id,
      affiliateSettlementFactId: upwardSettlement.id, invoiceRecordId: invoice.id
    } });
    const fee = await prisma.projectUpstreamFundFact.create({ data: {
      ...confirmedRecord("finance_staff"), factType: "affiliate_deduction", deductionCategory: "management_fee",
      occurredAt: checkedAt, amountCents: 1000n, basisType: "oral", counterpartyName: enterprise.name
    } });

    const ownContract = await prisma.contract.create({ data: {
      projectId: project.id, companyEntityId: company.id, companyEntityName: company.name,
      code: "HT-418-OWN", name: "合成我方下游合同", contractTypeKey: "labor_subcontract", counterparty: counterparty.name
    } });
    const ownVersion = await prisma.contractVersion.create({ data: {
      contractId: ownContract.id, changeType: "original", status: "effective", versionNo: 1,
      amountCents: 4000n, numericProtocolVersion: 1, effectiveAt: checkedAt, signingSubjectType: "our_company",
      companyEntityVersionId: companyVersion.id, companyEntityIdSnapshot: company.id,
      companyEntityNameSnapshot: company.name, draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    await prisma.contractPartySnapshot.create({ data: {
      contractVersionId: ownVersion.id, roleKey: "party_b", displayOrder: 1,
      businessPartyVersionId: counterpartyVersion.id, snapshot: { name: counterparty.name }
    } });
    const terms = await prisma.paymentTermsVersion.create({ data: {
      contractId: ownContract.id, contractVersionId: ownVersion.id, versionNo: 1,
      status: "effective", originalText: "按合同先行付款"
    } });
    const request = await prisma.paymentRequest.create({ data: {
      projectId: project.id, contractId: ownContract.id, contractVersionId: ownVersion.id,
      paymentTermsVersionId: terms.id, code: "PAY-418-OWN", sourceType: "contract_advance",
      status: "paid", requestedAmountCents: 4000n, approvedAmountCents: 4000n, paidAmountCents: 4000n,
      paymentSubjectType: "our_company"
    } });
    const own = await prisma.paymentExecution.create({ data: {
      paymentRequestId: request.id, amountCents: 4000n, paidAt: checkedAt, idempotencyKey: randomUUID(),
      paymentSubjectType: "our_company", companyEntityIdSnapshot: company.id,
      companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: "913100000000000018",
      executedByUserId: reviewer.id, voucherFileId: await file("own-payment.pdf")
    } });

    // Replay confirmed source records through the same operating adapter and guarded writer as live services.
    for (const [sourceType, sourceBusinessId] of [
      [PROJECT_AFFILIATE_PAYMENT_FACT_SOURCE_TYPE, direct.id],
      [PROJECT_UPSTREAM_FUND_SOURCE_TYPE, remittance.id],
      [PROJECT_UPSTREAM_FUND_SOURCE_TYPE, fee.id],
      [PAYMENT_EXECUTION_SOURCE_TYPE, own.id]
    ]) {
      await expect(prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(
        tx, { projectId: project.id, sourceType, sourceBusinessId }, reviewer.id
      ))).resolves.toMatchObject({ created: true, sourceBusinessId });
    }
    const audit = new AuditService();
    const visibility = new ProjectVisibilityService(prisma);
    const projections = new OperatingProjectionService(
      prisma, visibility, new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)),
      audit, new AuthService(prisma, new JwtTokenService(), audit)
    );
    const view = await projections.getProjectView(reader.id, { projectId: project.id });
    expect(view.actualFunds).toMatchObject({
      constructionEnterprisePaidCents: "8000",
      projectExternalPaidCents: "7000"
    });

    const flow = new FundFlowService(prisma, visibility, audit);
    await expect(flow.list(project.id, maker.id, {})).rejects.toThrow("当前账号没有可见项目");
    const payments = await flow.list(project.id, reader.id, { type: "payment" });
    expect(payments.rows).toHaveLength(2);
    expect(payments.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: PROJECT_AFFILIATE_PAYMENT_FACT_SOURCE_TYPE, amountCents: "3000", direction: "out" }),
      expect.objectContaining({ sourceType: PAYMENT_EXECUTION_SOURCE_TYPE, amountCents: "4000", direction: "out" })
    ]));
    const internalReceipts = await flow.list(project.id, reader.id, { type: "transfer_in", companyEntityId: company.id });
    expect(internalReceipts.rows).toMatchObject([
      { amountCents: "5000", direction: "in", sourceType: PROJECT_UPSTREAM_FUND_SOURCE_TYPE }
    ]);
    const exported = await flow.export(project.id, reader.id, { type: "payment" });
    expect(exported.fileName).toContain("资金流水");
    expect(exported.buffer.length).toBeGreaterThan(0);
    expect(await prisma.auditLog.findMany({
      where: { action: "fund_flow.export", actorUserId: reader.id, businessId: project.id }
    })).toMatchObject([{ metadata: { rowCount: 2, type: "payment" } }]);
  });
});
