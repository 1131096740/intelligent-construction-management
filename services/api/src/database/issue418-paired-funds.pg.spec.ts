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
  PROJECT_AFFILIATE_SETTLEMENT_FACT_SOURCE_TYPE,
  PROJECT_OWNER_SETTLEMENT_ENTRY_SOURCE_TYPE,
  PROJECT_UPSTREAM_FUND_SOURCE_TYPE
} from "../project/project-operating-source.adapter";
import { readProjectOwnerBalance } from "../project/project-owner-balance";
import { ProjectUpstreamFundBusinessEntryService } from "../project/project-upstream-fund-business-entry.service";
import { ProjectService } from "../project/project.service";
import { SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE } from "../settlement/signed-settlement-operating-source.adapter";

const run = process.env.ISSUE418_PAIRED_FUNDS_RUN === "1" ? describe : describe.skip;

run("issue #418 paired payment metrics on the ordered operating ledger", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const raw = process.env.ISSUE418_PAIRED_FUNDS_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_PAIRED_FUNDS_DATABASE_REQUIRED");
    prisma = new PrismaService({ datasources: { db: { url: assertOrderedIssue333Database(raw) } } });
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error("ISSUE418_ISOLATED_LEDGER_SECRET");
    const installed = await prisma.$executeRaw`
      INSERT INTO public."OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, public.crypt(${secret}, public.gen_salt('bf'))) ON CONFLICT ("id") DO NOTHING
    `;
    expect(installed).toBe(1);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seedProject(scope: string, projectName: string, creditCode: string) {
    const enabledAt = new Date("2026-10-01T00:00:00.000Z");
    const checkedAt = new Date("2026-11-01T00:00:00.000Z");
    const maker = await prisma.user.create({ data: { name: "合成结算经办" } });
    const reviewer = await prisma.user.create({ data: { name: "合成结算复核", isActive: true } });
    const reader = await prisma.user.create({ data: { name: "合成财务主管", isActive: true } });
    const project = await prisma.project.create({
      data: { code: `XM-418-${scope.toUpperCase()}`, name: projectName, isActive: true }
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
      data: { name: "合成施工企业", normalizedName: `issue418-${scope}-enterprise`, createdByUserId: maker.id }
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
      data: { name: "合成参与公司", isActive: true, unifiedSocialCreditCode: creditCode }
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
      data: { name: "合成劳务公司", normalizedName: `issue418-${scope}-counterparty`, createdByUserId: maker.id }
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
        bucket: "private-local", objectKey: `issue418-${scope}/${name}`, originalName: name, mimeType,
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

    return { checkedAt, maker, reviewer, reader, project, enterprise, enterpriseVersion, affiliate,
      company, companyVersion, counterparty, counterpartyVersion, replay, file, confirmedRecord, hash, creditCode };
  }

  it("施工企业已付八十元、项目对外支付七十元，资金流水使用同一分录", async () => {
    const { checkedAt, maker, reviewer, reader, project, enterprise, company, companyVersion,
      counterparty, counterpartyVersion, replay, file, confirmedRecord, hash } = await seedProject(
      "funds", "合成双口径付款项目", "913100000000000018"
    );
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

  it("同一项目业主一百、内部拨款八十及下游成本六十只入账一次", async () => {
    const { checkedAt, maker, reviewer, reader, project, enterprise, enterpriseVersion, affiliate,
      company, companyVersion, counterparty, counterpartyVersion, replay, file, confirmedRecord, creditCode } = await seedProject(
      "a26", "合成两层资金与利润项目", "91440300708461136T"
    );
    const audit = new AuditService();
    const auth = new AuthService(prisma, new JwtTokenService(), audit);
    const visibility = new ProjectVisibilityService(prisma);
    const projections = new OperatingProjectionService(
      prisma, visibility, new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)),
      audit, auth
    );
    const projects = new ProjectService(prisma, audit, auth, undefined, replay, projections,
      new ProjectUpstreamFundBusinessEntryService(audit));
    const password = randomUUID();
    await prisma.user.update({ where: { id: reader.id }, data: { passwordHash: await auth.hashPassword(password) } });
    await prisma.handwrittenSignatureVersion.create({ data: {
      userId: reader.id, fileId: await file("receipt-signature.png", "image/png", reader.id),
      contentSha256: "a".repeat(64), source: "canvas"
    } });
    const ownerName = "合成业主";
    const ownerSettlement = await projects.recordOwnerSettlement(project.id, reader.id, {
      ownerName, settledAt: "2026-11-01", amountYuan: "100.0000",
      voucherFileId: await file("owner-settlement.pdf", "application/pdf", reader.id), idempotencyKey: randomUUID()
    });
    expect(ownerSettlement.amountYuan).toBe("100.0000");
    const receiptInput = {
      factType: "owner_payment_to_affiliate" as const, basisType: "written" as const,
      occurredAt: "2026-11-02", amountCents: "10000", counterpartyName: ownerName,
      evidenceFileId: await file("owner-receipt.pdf", "application/pdf", reader.id), idempotencyKey: randomUUID(),
      confirmedReceipt: true, confirmationPassword: password
    };
    const ownerReceipt = await projects.recordUpstreamFundFact(project.id, reader.id, receiptInput);
    expect(ownerReceipt.status).toBe("confirmed");
    await expect(projects.recordUpstreamFundFact(project.id, reader.id, receiptInput))
      .resolves.toMatchObject({ id: ownerReceipt.id, status: "confirmed" });
    await expect(readProjectOwnerBalance(prisma, project.id, new Date("2026-11-23"), new Date())).resolves.toEqual({
      settlementYuan: "100.0000", receivedYuan: "100.0000", outstandingYuan: "0.0000", advanceYuan: "0.0000"
    });

    // Begin the subsequent approved sources at the same replay boundary as the retained OPS-12 case.
    const upstream = await prisma.projectAffiliateCompanyContract.create({ data: {
      ...confirmedRecord("contract_staff"), contractReference: "HT-A26-UPWARD", contractName: "合成拨款合同",
      signedAt: checkedAt, rightsObligationsSummary: "合成对上履约拨款", amountNature: "fixed",
      amountCents: 8000n, companyEntityId: company.id, companyEntityVersionId: companyVersion.id,
      companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: creditCode,
      fileId: await file("upward-contract.pdf"), fileContentSha256Snapshot: "a".repeat(64)
    } });
    const upstreamSettlement = await prisma.projectAffiliateSettlementFact.create({ data: {
      ...confirmedRecord("budget_staff"), ledgerId: randomUUID(), contractLedgerId: upstream.id,
      affiliateCompanyContractId: upstream.id, counterpartyName: company.name,
      settledAt: checkedAt, periodLabel: "合成拨款一期", amountCents: 8000n, basisType: "oral"
    } });
    const invoice = await prisma.invoiceRecord.create({ data: {
      identityKey: "invoice-a26-upward", invoiceCode: "123456789012", invoiceNumber: "00000426",
      projectId: project.id, invoiceType: "vat_general", issueDate: checkedAt,
      sellerName: company.name, buyerName: enterprise.name, totalAmountCents: 8000n, allocatableAmountCents: 8000n,
      fileId: await file("upward-invoice.pdf"), uploadedByUserId: maker.id,
      sourceBusinessType: PROJECT_UPSTREAM_FUND_SOURCE_TYPE, sourceBusinessId: upstreamSettlement.id
    } });
    const remittanceDate = new Date("2026-11-03");
    const remittance = await prisma.projectUpstreamFundFact.create({ data: {
      ...confirmedRecord("finance_staff"), factType: "affiliate_remittance_to_company",
      occurredAt: remittanceDate, confirmedAt: remittanceDate, amountCents: 8000n, basisType: "oral", counterpartyName: company.name,
      companyEntityId: company.id, affiliateCompanyContractId: upstream.id,
      affiliateSettlementFactId: upstreamSettlement.id, invoiceRecordId: invoice.id
    } });

    const contract = await prisma.contract.create({ data: {
      projectId: project.id, companyEntityId: company.id, companyEntityName: company.name,
      code: "HT-A26-DOWNSTREAM", name: "合成下游劳务合同", contractTypeKey: "labor_subcontract", counterparty: counterparty.name
    } });
    const version = await prisma.contractVersion.create({ data: {
      contractId: contract.id, changeType: "original", status: "effective", versionNo: 1,
      amountCents: 6000n, numericProtocolVersion: 1, effectiveAt: checkedAt, signingSubjectType: "our_company",
      companyEntityVersionId: companyVersion.id, companyEntityIdSnapshot: company.id,
      companyEntityNameSnapshot: company.name, draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    await prisma.contractPartySnapshot.create({ data: {
      contractVersionId: version.id, roleKey: "party_b", displayOrder: 1,
      businessPartyVersionId: counterpartyVersion.id, snapshot: { name: counterparty.name }
    } });
    const terms = await prisma.paymentTermsVersion.create({ data: {
      contractId: contract.id, contractVersionId: version.id, versionNo: 1,
      status: "effective", originalText: "按已签结算付款"
    } });
    const settlementDate = new Date("2026-11-04");
    const settlement = await prisma.signedContractSettlement.create({ data: {
      projectId: project.id, contractKind: "downstream", contractId: contract.id,
      state: "confirmed", ownerUserId: maker.id, number: "A26-结算一期", amountYuan: "60.0000", confirmationNo: 1n,
      submittedAt: settlementDate, reviewedAt: settlementDate, reviewedByUserId: reviewer.id, revision: 2,
      confirmedContractSource: {
        relationship: "inside", sourceRecordId: version.id, sourceVersion: version.versionNo,
        contractTypeKey: "labor_subcontract", counterparty: counterparty.name,
        counterpartyKind: "downstream_counterparty", counterpartyVersionId: counterpartyVersion.id,
        payerKind: "participating_company", payerVersionId: companyVersion.id, companyEntityId: company.id,
        affiliateAssignmentId: affiliate.id, affiliateBusinessPartyVersionId: enterpriseVersion.id
      }
    } });

    async function append(sourceType: string, sourceBusinessId: string) {
      await expect(prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(
        tx, { projectId: project.id, sourceType, sourceBusinessId }, reviewer.id
      ))).resolves.toMatchObject({ created: true, sourceBusinessId });
    }
    await append(PROJECT_AFFILIATE_SETTLEMENT_FACT_SOURCE_TYPE, upstreamSettlement.id);
    await append(PROJECT_UPSTREAM_FUND_SOURCE_TYPE, remittance.id);
    await append(SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, settlement.id);

    const amounts = { confirmedIncomeYuan: "100.0000", confirmedCostYuan: "60.0000" };
    const profit = { currentOperatingProfitYuan: "40.0000" };
    const overview = () => projections.getProjectView(reader.id, { projectId: project.id, numericProtocolVersion: 2 });
    expect(await overview()).toMatchObject({
      operating: amounts, profitAndLoss: profit,
      actualFunds: { constructionEnterpriseFundsCents: "2000", companyProjectFundsCents: "8000",
        netProjectCashPositionCents: "10000", constructionEnterprisePaidCents: "8000", projectExternalPaidCents: "0" }
    });

    const request = await prisma.paymentRequest.create({ data: {
      projectId: project.id, contractId: contract.id, contractVersionId: version.id, paymentTermsVersionId: terms.id,
      code: "PAY-A26-DOWNSTREAM", sourceType: "signed_settlement", signedSettlementId: settlement.id,
      signedSettlementConfirmationNo: 1n, signedSettlementConfirmedYuan: "60.0000",
      signedSettlementContractConfirmedYuan: "60.0000", signedSettlementOccupiedCents: 0n,
      signedSettlementBasisAt: settlementDate, createdAt: settlementDate,
      status: "paid", requestedAmountCents: 4000n, approvedAmountCents: 4000n,
      paidAmountCents: 4000n, paymentSubjectType: "our_company"
    } });
    const paidAt = new Date("2026-11-05");
    const paid = await prisma.paymentExecution.create({ data: {
      paymentRequestId: request.id, amountCents: 4000n, paidAt, createdAt: paidAt, idempotencyKey: randomUUID(),
      paymentSubjectType: "our_company", companyEntityIdSnapshot: company.id,
      companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: creditCode,
      executedByUserId: reviewer.id, voucherFileId: await file("paid-voucher.pdf", "application/pdf", reviewer.id)
    } });
    await append(PAYMENT_EXECUTION_SOURCE_TYPE, paid.id);
    expect(await overview()).toMatchObject({
      operating: amounts, profitAndLoss: profit,
      actualFunds: { constructionEnterpriseFundsCents: "2000", companyProjectFundsCents: "4000",
        netProjectCashPositionCents: "6000", constructionEnterprisePaidCents: "8000", projectExternalPaidCents: "4000" }
    });

    const sources = [
      [PROJECT_OWNER_SETTLEMENT_ENTRY_SOURCE_TYPE, ownerSettlement.id, "confirmed_income", "increase", null],
      [PROJECT_UPSTREAM_FUND_SOURCE_TYPE, ownerReceipt.id, "construction_enterprise_funds_increase", "increase", 10000n],
      [PROJECT_UPSTREAM_FUND_SOURCE_TYPE, remittance.id, "construction_enterprise_funds_decrease", "decrease", 8000n],
      [PROJECT_UPSTREAM_FUND_SOURCE_TYPE, remittance.id, "company_project_funds_increase", "increase", 8000n],
      [SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, settlement.id, "confirmed_cost", "increase", 6000n],
      [PAYMENT_EXECUTION_SOURCE_TYPE, paid.id, "company_project_funds_decrease", "decrease", 4000n]
    ] as const;
    for (const [sourceType, sourceBusinessId, impactKind, direction, amountCents] of sources) {
      const fact = await prisma.operatingFact.findUniqueOrThrow({
        where: { sourceType_sourceBusinessId: { sourceType, sourceBusinessId } }, include: { impacts: true }
      });
      expect(fact.projectId).toBe(project.id);
      const impacts = fact.impacts.filter(impact => impact.impactKind === impactKind);
      expect(impacts).toMatchObject([{
        id: expect.any(String), factId: fact.id, sourceType, sourceBusinessId, direction, amountCents
      }]);
      if (amountCents === null) expect(impacts[0]!.amountYuan?.toFixed(4)).toBe("100.0000");
    }
  }, 30_000);
});
