import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
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

const run = process.env.ISSUE418_RECOGNIZED_DEDUP_RUN === "1" ? describe : describe.skip;

run("issue #418 identifiable settlement dedup on the ordered operating ledger", () => {
  let prisma: PrismaService;

  beforeAll(() => {
    const raw = process.env.ISSUE418_RECOGNIZED_DEDUP_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_RECOGNIZED_DEDUP_DATABASE_REQUIRED");
    prisma = new PrismaService({ datasources: { db: { url: assertOrderedIssue333Database(raw) } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("可识别的跨来源结算在总览、明细分页和导出只计一期，保留下一期", async () => {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error("ISSUE418_ISOLATED_LEDGER_SECRET");
    expect(await prisma.$executeRaw`
      INSERT INTO public."OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, public.crypt(${secret}, public.gen_salt('bf'))) ON CONFLICT ("id") DO NOTHING
    `).toBe(1);

    const enabledAt = new Date("2026-10-01T00:00:00Z");
    const legacyAt = new Date("2026-11-01T00:00:00Z");
    const duplicateAt = new Date("2026-11-02T00:00:00Z");
    const nextPeriodAt = new Date("2026-11-03T00:00:00Z");
    const password = randomUUID();
    const maker = await prisma.user.create({ data: { name: "合成经办" } });
    const reviewer = await prisma.user.create({ data: { name: "合成复核", isActive: true } });
    const reader = await prisma.user.create({ data: {
      name: "合成财务主管", isActive: true, passwordHash: await hash(password, 10)
    } });
    const project = await prisma.project.create({ data: {
      code: "XM-418-DEDUP", name: "合成跨来源结算项目", isActive: true
    } });
    const finance = await prisma.position.upsert({
      where: { key: "finance_director" }, update: {},
      create: { key: "finance_director", name: "财务主管" }
    });
    await prisma.userPosition.create({ data: { userId: reader.id, positionId: finance.id, projectId: project.id } });
    await prisma.projectRosterMember.create({ data: { projectId: project.id, userId: reader.id } });

    const enterprise = await prisma.businessParty.create({ data: {
      name: "合成施工企业", normalizedName: "issue418-dedup-enterprise", createdByUserId: maker.id
    } });
    const enterpriseVersion = await prisma.businessPartyVersion.create({ data: {
      businessPartyId: enterprise.id, versionNo: 1,
      snapshot: { name: enterprise.name }, createdByUserId: maker.id
    } });
    const affiliate = await prisma.projectAffiliateAssignment.create({ data: {
      projectId: project.id, businessPartyId: enterprise.id, businessPartyVersionId: enterpriseVersion.id,
      affiliateNameSnapshot: enterprise.name, effectiveFrom: enabledAt,
      changeReason: "合成跨来源结算验收", assignedByUserId: maker.id
    } });
    const company = await prisma.companyEntity.create({ data: { name: "合成签约公司", isActive: true } });
    const companyVersion = await prisma.companyEntityVersion.create({ data: {
      companyEntityId: company.id, versionNo: 1, name: company.name,
      isActive: true, action: "create", actorUserId: maker.id
    } });
    await prisma.companyEntity.update({ where: { id: company.id }, data: { currentVersionNo: companyVersion.versionNo } });
    await prisma.projectParticipatingCompany.create({ data: {
      projectId: project.id, companyEntityId: company.id, companyEntityVersionId: companyVersion.id,
      companyNameSnapshot: companyVersion.name, effectiveFrom: enabledAt,
      changeReason: "合成跨来源结算验收", addedByUserId: maker.id
    } });
    await prisma.project.update({ where: { id: project.id }, data: { operatingLedgerEffectiveDate: enabledAt } });

    const counterparty = await prisma.businessParty.create({ data: {
      name: "合成劳务公司", normalizedName: "issue418-dedup-counterparty", createdByUserId: maker.id
    } });
    const counterpartyVersion = await prisma.businessPartyVersion.create({ data: {
      businessPartyId: counterparty.id, versionNo: 1,
      snapshot: { name: counterparty.name }, createdByUserId: maker.id
    } });
    const contract = await prisma.contract.create({ data: {
      projectId: project.id, code: "HT-418-DEDUP", name: "合成下游合同",
      counterparty: counterparty.name, contractTypeKey: "labor_subcontract",
      companyEntityId: company.id, companyEntityName: company.name
    } });
    const version = await prisma.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "original", status: "effective",
      effectiveAt: enabledAt, numericProtocolVersion: 1, amountCents: 20_000n,
      signingSubjectType: "our_company", companyEntityVersionId: companyVersion.id,
      companyEntityIdSnapshot: company.id, companyEntityNameSnapshot: companyVersion.name,
      draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    await prisma.contractPartySnapshot.create({ data: {
      contractVersionId: version.id, roleKey: "party_b", displayOrder: 1,
      businessPartyVersionId: counterpartyVersion.id, snapshot: { name: counterparty.name }
    } });
    const terms = await prisma.paymentTermsVersion.create({ data: {
      contractId: contract.id, contractVersionId: version.id, versionNo: 1,
      status: "effective", originalText: "按确认结算付款"
    } });
    const coordinates = { projectId: project.id, contractId: contract.id };
    // Reconstruct already-confirmed historical sources. New confirmations remain guarded.
    // This covers complete source identity, not the reduced snapshots written at 327.
    const legacy = await prisma.settlement.create({ data: {
      ...coordinates, contractVersionId: version.id, paymentTermsVersionId: terms.id,
      code: "JS-418-DEDUP", periodLabel: "第1期", periodEnd: legacyAt,
      status: "effective", amountCents: 6000n, payableAmountCents: 6000n
    } });
    const archive = await prisma.fileObject.create({ data: {
      bucket: "private-local", objectKey: "issue418-dedup/settlement-archive.pdf",
      originalName: "合成结算归档.pdf", mimeType: "application/pdf", sizeBytes: 128,
      uploadedByUserId: maker.id, contentSha256: "a".repeat(64), storageStatus: "active"
    } });
    await prisma.settlementArchiveFile.create({ data: {
      settlementId: legacy.id, fileId: archive.id, uploadedByUserId: maker.id,
      status: "confirmed", confirmedByUserId: reviewer.id, confirmedAt: legacyAt
    } });
    const confirmedContractSource = {
      relationship: "inside", sourceRecordId: version.id, sourceVersion: version.versionNo,
      contractTypeKey: "labor_subcontract", name: contract.name, counterparty: counterparty.name,
      counterpartyKind: "downstream_counterparty", counterpartyVersionId: counterpartyVersion.id,
      signingParty: company.name, payerKind: "participating_company", payerVersionId: companyVersion.id,
      companyEntityId: company.id, affiliateAssignmentId: affiliate.id,
      affiliateBusinessPartyVersionId: enterpriseVersion.id
    };
    function seedSigned(number: string, amountYuan: string, confirmationNo: bigint, reviewedAt: Date) {
      return prisma.signedContractSettlement.create({ data: {
        ...coordinates, contractKind: "downstream", ownerUserId: maker.id,
        number, amountYuan, state: "confirmed", revision: 2,
        submittedAt: reviewedAt, reviewedAt, reviewedByUserId: reviewer.id,
        confirmationNo, confirmedContractSource
      } });
    }
    const duplicate = await seedSigned("第 １ 期", "60.0000", 1n, duplicateAt);
    const nextPeriod = await seedSigned("第2期", "25.0000", 2n, nextPeriodAt);

    const replay = new OperatingSourceReplayService(
      prisma, new OperatingLedgerService(prisma), createOperatingSourceRegistry()
    );
    async function appendSource(sourceType: string, sourceBusinessId: string) {
      await expect(prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(
        tx, { projectId: project.id, sourceType, sourceBusinessId }, reviewer.id
      ))).resolves.toMatchObject({ created: true, sourceBusinessId });
    }
    for (const { sourceType, sourceBusinessId } of [
      { sourceType: "settlement", sourceBusinessId: legacy.id },
      { sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: duplicate.id },
      { sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: nextPeriod.id }
    ]) {
      await appendSource(sourceType, sourceBusinessId);
    }
    const readStoredFacts = () => prisma.operatingFact.findMany({
      where: { projectId: project.id }, orderBy: { id: "asc" }, include: { impacts: true }
    });
    const stored = await readStoredFacts();
    expect(stored).toHaveLength(3);
    const samePeriod = stored.filter(fact => fact.sourceBusinessId !== nextPeriod.id);
    expect(samePeriod).toHaveLength(2);
    const survivingCode = samePeriod[0]!.sourceBusinessCode;
    const suppressedCode = samePeriod[1]!.sourceBusinessCode;
    const expectedCodes = [nextPeriod.number, nextPeriod.number, survivingCode, survivingCode].sort();

    const audit = new AuditService();
    const projection = new OperatingProjectionService(
      prisma, new ProjectVisibilityService(prisma),
      new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)),
      audit, new AuthService(prisma, new JwtTokenService(), audit)
    );
    const view = await projection.getProjectView(reader.id, { projectId: project.id });
    expect(view.operating).toMatchObject({ confirmedCostCents: "8500", payableCents: "8500" });
    expect(view.asOf.crossSourceDedupedFactCount).toBe(1);
    async function readAllDetail(expectedCount: number) {
      const detailItems: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < expectedCount + 1; page += 1) {
        const result = await projection.getProjectDetailPage(reader.id, { projectId: project.id, pageSize: 1, cursor });
        expect(result.items.length).toBeLessThanOrEqual(1);
        detailItems.push(...result.items);
        cursor = result.page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(cursor).toBeUndefined();
      expect(detailItems).toHaveLength(expectedCount);
      return detailItems;
    }
    async function readExport() {
      const exported = await projection.exportView(reader.id, { scopeKind: "project", projectId: project.id },
        password, "project_operating_ledger_detail");
      const chunks: Buffer[] = [];
      for await (const chunk of exported.stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString("utf8");
    }
    function expectNoInternalIds(
      detailItems: Record<string, unknown>[],
      csv: string,
      facts: Awaited<ReturnType<typeof readStoredFacts>>
    ) {
      const detail = JSON.stringify(detailItems);
      for (const fact of facts) {
        for (const id of [fact.id, fact.sourceBusinessId, ...fact.impacts.map(impact => impact.id)]) {
          expect(detail).not.toContain(id);
          expect(csv).not.toContain(id);
        }
      }
    }

    const detailItems = await readAllDetail(4);
    expect(detailItems.map(item => item.sourceBusinessCode).sort()).toEqual(expectedCodes);
    const csv = await readExport();
    expect(csv.split("\n").slice(1).filter(Boolean)).toHaveLength(4);
    expect(csv).toContain(`"${survivingCode}"`);
    expect(csv).toContain('"第2期"');
    expect(csv).not.toContain(`"${suppressedCode}"`);
    expectNoInternalIds(detailItems, csv, stored);

    // Confirmed signed items may share a manually entered number and contract version.
    const repeated = await seedSigned("第2期", "15.0000", 3n, new Date("2026-11-04T00:00:00Z"));
    const decrease = await seedSigned("第2期", "-9.0000", 4n, new Date("2026-11-05T00:00:00Z"));
    for (const signed of [repeated, decrease]) {
      await appendSource(SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, signed.id);
    }
    const extendedFacts = await readStoredFacts();
    expect(extendedFacts).toHaveLength(5);
    expect(extendedFacts.filter(fact => fact.sourceBusinessCode === "第2期")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceBusinessId: nextPeriod.id, sourceVersion: 2 }),
        expect.objectContaining({ sourceBusinessId: repeated.id, sourceVersion: 3 }),
        expect.objectContaining({ sourceBusinessId: decrease.id, sourceVersion: 4 })
      ])
    );

    const extendedView = await projection.getProjectView(reader.id, { projectId: project.id });
    expect(extendedView.operating).toMatchObject({ confirmedCostCents: "9100", payableCents: "9100" });
    expect(extendedView.asOf.crossSourceDedupedFactCount).toBe(1);
    const extendedDetail = await readAllDetail(8);
    expect(extendedDetail.map(item => item.sourceBusinessCode).sort()).toEqual(
      [...expectedCodes, "第2期", "第2期", "第2期", "第2期"].sort()
    );
    expect(extendedDetail.filter(item => item.sourceBusinessCode === "第2期")
      .map(item => item.signedImpactCents).sort()).toEqual(["-900", "-900", "1500", "1500", "2500", "2500"]);
    const extendedCsv = await readExport();
    const [header, ...exportedRows] = extendedCsv.trimEnd().split("\n");
    expect(exportedRows).toHaveLength(8);
    const columns = header!.split('","');
    const codeColumn = columns.indexOf("来源业务编号");
    const amountColumn = columns.indexOf("金额（元）");
    expect(codeColumn).toBeGreaterThanOrEqual(0);
    expect(amountColumn).toBeGreaterThanOrEqual(0);
    const repeatedAmounts = exportedRows.map(row => row.split('","'))
      .filter(cells => cells[codeColumn] === "第2期")
      .map(cells => cells[amountColumn]).sort();
    expect(repeatedAmounts).toEqual(["'-9.00", "'-9.00", "15.00", "15.00", "25.00", "25.00"]);
    expect(extendedCsv).toContain(`"${survivingCode}"`);
    expect(extendedCsv).not.toContain(`"${suppressedCode}"`);
    expectNoInternalIds(extendedDetail, extendedCsv, extendedFacts);

    // Reconstruct another independently confirmed historical source in the first period.
    const ambiguousSigned = await seedSigned("第1期", "12.34", 5n, new Date("2026-11-06T00:00:00Z"));
    await appendSource(SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, ambiguousSigned.id);
    const ambiguousFacts = await readStoredFacts();
    expect(ambiguousFacts).toHaveLength(6);
    expect(ambiguousFacts.find(fact => fact.sourceBusinessId === ambiguousSigned.id))
      .toMatchObject({ sourceVersion: 5, amountCents: 1234n });

    const ambiguousView = await projection.getProjectView(reader.id, { projectId: project.id });
    expect(ambiguousView.asOf.crossSourceDedupedFactCount).toBe(0);
    expect(ambiguousView.integrity.moneyComplete).toBe(false);
    expect(ambiguousView.operating).toMatchObject({
      confirmedIncomeCents: "0", confirmedCostCents: null, payableCents: null
    });
    expect(ambiguousView.profitAndLoss).toMatchObject({
      currentOperatingProfitCents: null, finalConfirmedProfitCents: null, finalConfirmable: false
    });
    expect(ambiguousView.actualFunds).toMatchObject({
      confirmedProjectInflowsCents: "0", confirmedProjectOutflowsCents: "0"
    });
    const ambiguousV2View = await projection.getProjectView(reader.id, {
      projectId: project.id, numericProtocolVersion: 2
    });
    expect(ambiguousV2View.operating).toMatchObject({
      confirmedIncomeYuan: "0.0000", confirmedCostYuan: null, payableCents: null
    });
    expect(ambiguousV2View.profitAndLoss.currentOperatingProfitYuan).toBeNull();

    const ambiguousDetail = await readAllDetail(12);
    const ambiguousCsv = await readExport();
    const [, ...ambiguousCsvRows] = ambiguousCsv.trimEnd().split("\n");
    expect(ambiguousCsvRows).toHaveLength(12);
    for (const [code, amountsCents, amountsYuan] of [
      [legacy.code, ["6000", "6000"], ["60.00", "60.00"]],
      [duplicate.number, ["6000", "6000"], ["60.00", "60.00"]],
      [ambiguousSigned.number, ["1234", "1234"], ["12.34", "12.34"]],
      [nextPeriod.number, ["-900", "-900", "1500", "1500", "2500", "2500"],
        ["'-9.00", "'-9.00", "15.00", "15.00", "25.00", "25.00"]]
    ] as const) {
      expect(ambiguousDetail.filter(item => item.sourceBusinessCode === code)
        .map(item => item.signedImpactCents).sort()).toEqual(amountsCents);
      expect(ambiguousCsvRows.map(row => row.split('\",\"'))
        .filter(cells => cells[codeColumn] === code)
        .map(cells => cells[amountColumn]).sort()).toEqual(amountsYuan);
    }
    expectNoInternalIds(ambiguousDetail, ambiguousCsv, ambiguousFacts);
  });
});
