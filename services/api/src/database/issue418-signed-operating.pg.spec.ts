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
import { SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE } from "../settlement/signed-settlement-operating-source.adapter";

const run = process.env.ISSUE418_SIGNED_OPERATING_RUN === "1" ? describe : describe.skip;

run("issue #418 confirmed signed settlements on the ordered operating ledger", () => {
  let prisma: PrismaService;

  beforeAll(() => {
    const raw = process.env.ISSUE418_SIGNED_OPERATING_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_SIGNED_OPERATING_DATABASE_REQUIRED");
    prisma = new PrismaService({ datasources: { db: { url: assertOrderedIssue333Database(raw) } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("对上五十元只形成内部应收，表外三十元进入成本与应付，明细可追溯", async () => {
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
      data: { code: "XM-418-SIGNED", name: "合成已签结算投影项目", isActive: true }
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
      data: { name: "合成施工企业", normalizedName: "issue418-signed-enterprise", createdByUserId: maker.id }
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
    const company = await prisma.companyEntity.create({ data: { name: "合成参与公司", isActive: true } });
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
        companyNameSnapshot: companyVersion.name, effectiveFrom: enabledAt,
        changeReason: "合成结算投影验收", addedByUserId: maker.id
      }
    });
    await prisma.project.update({
      where: { id: project.id }, data: { operatingLedgerEffectiveDate: enabledAt }
    });
    const counterparty = await prisma.businessParty.create({
      data: { name: "合成劳务公司", normalizedName: "issue418-signed-counterparty", createdByUserId: maker.id }
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
    // Seed frozen confirmation inputs. The review and its contract lookup precede this append boundary.
    async function appendConfirmed(kind: "upward" | "outside_fact", number: string, amountYuan: string) {
      const contractId = randomUUID();
      const upward = kind === "upward";
      const signed = await prisma.signedContractSettlement.create({
        data: {
          projectId: project.id, contractId, contractKind: kind, ownerUserId: maker.id,
          number, amountYuan, state: "confirmed", revision: 2, confirmationNo: 1n,
          submittedAt: checkedAt, reviewedAt: checkedAt, reviewedByUserId: reviewer.id,
          confirmedContractSource: {
            relationship: upward ? "upward" : "outside", sourceRecordId: contractId, sourceVersion: 1,
            contractTypeKey: upward ? null : "labor_subcontract",
            counterparty: upward ? company.name : counterparty.name,
            counterpartyKind: upward ? "participating_company" : "downstream_counterparty",
            counterpartyVersionId: upward ? companyVersion.id : counterpartyVersion.id,
            payerKind: "construction_enterprise", payerVersionId: enterpriseVersion.id,
            companyEntityId: upward ? company.id : null,
            affiliateAssignmentId: affiliate.id, affiliateBusinessPartyVersionId: enterpriseVersion.id
          }
        }
      });
      await expect(prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(
        tx, { projectId: project.id, sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: signed.id },
        reviewer.id
      ))).resolves.toMatchObject({ created: true, sourceBusinessId: signed.id });
      return prisma.operatingFact.findUniqueOrThrow({
        where: { sourceType_sourceBusinessId: {
          sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: signed.id
        } },
        include: { impacts: true }
      });
    }

    const upward = await appendConfirmed("upward", "对上-418-01", "50.0000");
    const outside = await appendConfirmed("outside_fact", "表外-418-01", "30.0000");
    expect(upward).toMatchObject({
      operatingLevel: "participating_company", amountCents: 5000n,
      impacts: [{ impactKind: "receivable_increase", amountCents: 5000n, direction: "increase" }]
    });
    expect(outside).toMatchObject({ operatingLevel: "project", amountCents: 3000n });
    expect(outside.impacts).toHaveLength(2);
    expect(outside.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ impactKind: "confirmed_cost", amountCents: 3000n, direction: "increase" }),
      expect.objectContaining({ impactKind: "payable_increase", amountCents: 3000n, direction: "increase" })
    ]));

    const audit = new AuditService();
    const projection = new OperatingProjectionService(
      prisma, new ProjectVisibilityService(prisma),
      new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)),
      audit, new AuthService(prisma, new JwtTokenService(), audit)
    );
    const view = await projection.getProjectView(reader.id, { projectId: project.id });
    expect(view.operating).toMatchObject({ confirmedIncomeCents: "0", confirmedCostCents: "3000", payableCents: "3000" });
    expect(view.relationshipTotals).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: "upward", confirmedCostCents: "0", receivableCents: "5000" }),
      expect.objectContaining({ relationship: "outside", confirmedCostCents: "3000", payableCents: "3000" })
    ]));
    const detail = await projection.getProjectDetailPage(reader.id, { projectId: project.id });
    expect(detail.items).toHaveLength(3);
    expect(detail.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTypeLabel: "已签结算", sourceBusinessCode: upward.sourceBusinessCode, signedImpactCents: "5000" }),
      expect.objectContaining({ sourceTypeLabel: "已签结算", sourceBusinessCode: outside.sourceBusinessCode, signedImpactCents: "3000" })
    ]));
    for (const fact of [upward, outside]) {
      expect(await prisma.operatingImpactEntry.count({
        where: { factId: fact.id, sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: fact.sourceBusinessId }
      })).toBe(fact.impacts.length);
    }
  });
});
