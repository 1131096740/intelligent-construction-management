import { PrismaClient } from "@prisma/client";
import { assertOrderedIssue333Database } from "../../test-support/ordered-issue333-fixture";
import {
  assertNoConfirmedSignedSettlementForPeriod,
  assertNoLegacySettlementForSignedPeriod
} from "../operating-ledger/settlement-source-dedup";

const run = process.env.ISSUE418_SETTLEMENT_GUARD_RUN === "1" ? describe : describe.skip;

run("issue #418 cross-source settlement guards on the ordered database", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const raw = process.env.ISSUE418_SETTLEMENT_GUARD_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_SETTLEMENT_GUARD_DATABASE_REQUIRED");
    prisma = new PrismaClient({
      datasources: { db: { url: assertOrderedIssue333Database(raw) } }
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("拒绝合同同版本同期次跨入口登记，允许不同期次", async () => {
    const day = new Date("2026-11-01T00:00:00.000Z");
    const maker = await prisma.user.create({ data: { name: "合成结算经办" } });
    const reviewer = await prisma.user.create({ data: { name: "合成结算复核" } });
    const project = await prisma.project.create({
      data: { code: "XM-418-GUARD", name: "跨来源结算守卫合成项目" }
    });
    const enterprise = await prisma.businessParty.create({
      data: { name: "合成施工企业", normalizedName: "issue418-guard-enterprise", createdByUserId: maker.id }
    });
    const enterpriseVersion = await prisma.businessPartyVersion.create({
      data: {
        businessPartyId: enterprise.id, versionNo: 1,
        snapshot: { name: enterprise.name }, createdByUserId: maker.id
      }
    });
    await prisma.projectAffiliateAssignment.create({
      data: {
        projectId: project.id, businessPartyId: enterprise.id, businessPartyVersionId: enterpriseVersion.id,
        affiliateNameSnapshot: enterprise.name, effectiveFrom: day,
        changeReason: "跨来源守卫验收", assignedByUserId: maker.id
      }
    });
    const company = await prisma.companyEntity.create({
      data: { name: "合成签约公司", isActive: true }
    });
    const companyVersion = await prisma.companyEntityVersion.create({
      data: {
        companyEntityId: company.id, versionNo: 1, name: company.name,
        isActive: true, action: "create", actorUserId: maker.id
      }
    });
    await prisma.companyEntity.update({
      where: { id: company.id }, data: { currentVersionNo: companyVersion.versionNo }
    });
    await prisma.projectParticipatingCompany.create({
      data: {
        projectId: project.id, companyEntityId: company.id, companyEntityVersionId: companyVersion.id,
        companyNameSnapshot: companyVersion.name, effectiveFrom: day,
        changeReason: "跨来源守卫验收", addedByUserId: maker.id
      }
    });
    const contract = await prisma.contract.create({
      data: {
        projectId: project.id, code: "HT-418-GUARD", name: "跨来源守卫合成下游合同",
        counterparty: "合成劳务公司", contractTypeKey: "labor_subcontract",
        companyEntityId: company.id, companyEntityName: company.name
      }
    });
    const version = await prisma.contractVersion.create({
      data: {
        contractId: contract.id, versionNo: 1, changeType: "original", status: "effective",
        effectiveAt: day, numericProtocolVersion: 1, amountCents: 12000n,
        signingSubjectType: "our_company", companyEntityVersionId: companyVersion.id,
        companyEntityIdSnapshot: company.id, companyEntityNameSnapshot: companyVersion.name,
        draftData: {}, templateSnapshot: {}, clauseSnapshot: []
      }
    });
    const terms = await prisma.paymentTermsVersion.create({
      data: {
        contractId: contract.id, contractVersionId: version.id, versionNo: 1,
        status: "effective", originalText: "按确认结算付款"
      }
    });
    const downstream = { projectId: project.id, contractId: contract.id };
    const legacy = await prisma.settlement.create({
      data: {
        ...downstream, contractVersionId: version.id, paymentTermsVersionId: terms.id,
        code: "JS-418-GUARD", periodLabel: "第1期", status: "effective",
        amountCents: 6000n, payableAmountCents: 6000n
      }
    });
    const signedNumber = "第 １ 期";
    await prisma.signedContractSettlement.create({
      data: {
        ...downstream, contractKind: "downstream", ownerUserId: maker.id,
        number: signedNumber, amountYuan: "60.0000", state: "confirmed", revision: 2,
        submittedAt: day, reviewedAt: day, reviewedByUserId: reviewer.id, confirmationNo: 1n,
        confirmedContractSource: {
          relationship: "inside", sourceRecordId: version.id, sourceVersion: version.versionNo,
          contractTypeKey: "labor_subcontract", name: contract.name, counterparty: contract.counterparty,
          signingParty: company.name, payerKind: "participating_company"
        }
      }
    });

    const coordinates = { ...downstream, contractVersionId: version.id };
    await expect(assertNoConfirmedSignedSettlementForPeriod(prisma, {
      ...coordinates, periodLabel: legacy.periodLabel, code: legacy.code
    })).rejects.toThrow("不能重复计成本");
    await expect(assertNoLegacySettlementForSignedPeriod(prisma, {
      ...coordinates, period: signedNumber
    })).rejects.toThrow("不能重复计成本");
    await expect(assertNoConfirmedSignedSettlementForPeriod(prisma, {
      ...coordinates, periodLabel: "第2期", code: "JS-418-GUARD-NEXT"
    })).resolves.toBeUndefined();
    await expect(assertNoLegacySettlementForSignedPeriod(prisma, {
      ...coordinates, period: "第2期"
    })).resolves.toBeUndefined();
  });
});
