import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const LIVE = process.env.RUN_POL215_DATABASE === "1";
const describeDatabase = LIVE ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL;

describeDatabase("POL-215 PostgreSQL 16 constraints", () => {
  let first: PrismaClient;
  let second: PrismaClient;
  const projectId = `pol215-project-${randomUUID()}`;
  const sha = "a".repeat(64);

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("POL-215 PG16 动态门缺少 DATABASE_URL");
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await first.project.create({ data: { id: projectId, code: `POL215-${randomUUID()}`, name: "POL-215 动态测试项目" } });
  });

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  async function createAuthority(
    id: string,
    obligationId?: string,
    wageLineId = `line-${id}`,
    coverageKind = obligationId ? "ROLE_SUMMARY" : "PERSON"
  ) {
    const authorityFingerprint = createHash("sha256").update(`authority:${id}`).digest("hex");
    const obligationFingerprint = obligationId
      ? createHash("sha256").update(`obligation:${obligationId}`).digest("hex")
      : null;
    await first.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "AffiliateClearingAuthorityVersion" (
          "id", "projectId", "constructionEnterpriseAssignmentId", "affiliateCompanyContractId",
          "protocolNameSnapshot", "protocolReferenceSnapshot", "assignmentNameSnapshot", "versionNo",
          "effectiveFrom", "coverageKind", "evidenceFileId", "evidenceSha256", "evidenceManifestSha256",
          "status", "authoritySnapshotRef", "authorityFingerprint", "idempotencyKey", "requestFingerprint",
          "createdByUserId", "confirmedByUserId", "confirmedAt", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, ${projectId}, ${`assignment-${id}`}, ${`contract-${id}`}, '动态测试协议', ${`protocol-${id}`},
          '动态测试施工企业', 1, DATE '2026-01-01', ${obligationId ? "ROLE_SUMMARY" : "PERSON"},
          ${`evidence-${id}`}, ${sha}, ${sha}, 'confirmed', ${`snapshot-${id}`}, ${authorityFingerprint},
          ${`idempotency-${id}`}, ${sha}, 'maker-1', 'confirmer-1', TIMESTAMP '2026-01-01 00:00:00',
          TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'
        )
      `);
      if (!obligationId) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AssignedWageAuthorityLine" (
            "id", "authorityVersionId", "projectId", "constructionEnterpriseAssignmentId", "affiliateCompanyContractId",
            "coverageKind", "coverageKey", "personAuthorityKey", "personNameSnapshot", "roleCategoryKey", "roleNameSnapshot",
            "employerNameSnapshot", "wageMonth", "amountRuleVersion", "amountMode", "approvedAmountCents", "grossCapCents",
            "midMonthPolicy", "evidenceLevel", "evidenceCoordinate", "evidenceSha256", "lineFingerprint", "createdAt"
          ) VALUES (
            ${wageLineId}, ${id}, ${projectId}, ${`assignment-${id}`}, ${`contract-${id}`},
            ${coverageKind}, ${coverageKind === "PERSON" ? "person:user-1" : "role:project_manager"},
            ${coverageKind === "PERSON" ? "user-1" : null}, ${coverageKind === "PERSON" ? "动态测试人员" : null},
            ${coverageKind === "ROLE_SUMMARY" ? "project_manager" : null}, ${coverageKind === "ROLE_SUMMARY" ? "动态测试岗位" : null},
            '动态测试施工企业', DATE '2026-08-01', 1, 'CONFIRMED_AMOUNT', 100, 100,
            'NOT_APPLICABLE', ${coverageKind === "PERSON" ? "A" : "B"}, 'sheet1!A1', ${sha}, ${"d".repeat(64)},
            TIMESTAMP '2026-01-01 00:00:00'
          )
        `);
      }
      if (obligationId && obligationFingerprint) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "GuaranteeObligationVersion" (
            "id", "authorityVersionId", "projectId", "constructionEnterpriseAssignmentId",
            "affiliateCompanyContractId", "obligationId", "versionNo", "baseAmountCents",
            "calculationMode", "fixedAmountCents", "capCents", "currencyCode", "effectiveFrom",
            "returnCondition", "enabled", "evidenceLevel", "evidenceCoordinate", "evidenceSha256",
            "obligationFingerprint", "createdByUserId", "confirmedByUserId", "confirmedAt", "createdAt"
          ) VALUES (
            ${`obligation-row-${obligationId}`}, ${id}, ${projectId}, ${`assignment-${id}`}, ${`contract-${id}`},
            ${obligationId}, 1, 100, 'FIXED_AMOUNT', 100, 100, 'CNY', DATE '2026-01-01',
            '动态测试显式返还', TRUE, 'A', 'sheet1!A1', ${sha}, ${obligationFingerprint},
            'maker-1', 'confirmer-1', TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'
          )
        `);
      }
    });
  }

  it("enforces unique source/target bridges and preserves append-only history", async () => {
    const manifest = await first.operatingTakeoverManifestVersion.create({
      data: {
        projectId,
        manifestNo: `M-${randomUUID()}`,
        sourceScopeFingerprint: sha,
        mapperName: "test",
        mapperVersion: 1,
        schemaVersion: 1,
        candidateBaselineSha: "b".repeat(40),
        permissionSnapshotFingerprint: sha,
        readSetFingerprint: sha,
        manifestFingerprint: "c".repeat(64),
        createdByUserId: "maker-1"
      }
    });
    await createAuthority("authority-1", undefined, "line-1");
    const row = await first.operatingTakeoverRowMapping.create({
      data: {
        projectId,
        manifestVersionId: manifest.id,
        rowNo: 1,
        sourceType: "construction_enterprise_takeover_selection",
        sourceBusinessId: "source-1",
        sourceVersion: 1,
        sourceFingerprint: sha,
        sourceCoordinate: "authority:row-1",
        normalizedRowHash: sha,
        amountCents: 100n,
        evidenceLevel: "A",
        coverageKind: "PERSON",
        coverageKey: "person:user-1",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        entryKind: "formal",
        mappingDecision: "FORMAL",
        conflictGroupKey: "project|PERSON|person:user-1|2026-08-01",
        sourceDiscriminator: "construction_enterprise_assigned_wage",
        governedSubjectKey: "subject-1",
        authorityCategory: "assigned_management_salary",
        authoritySnapshotRef: "acv-1",
        authorityFingerprint: sha,
        authorityVersionId: "authority-1",
        authorityLineId: "line-1",
        authorityLineFingerprint: "e".repeat(64),
        authoritativeGrossCapCents: 100n,
        currencyCode: "CNY",
        authoritySnapshot: { constructionEnterpriseAssignmentId: "assignment-1", personAuthorityKey: "user-1" },
        legacySourceSnapshot: { businessReason: "test" },
        readSetSnapshot: { sourceFingerprint: sha },
        mappingFingerprint: "d".repeat(64)
      }
    });
    const bridgeData = {
      projectId,
      rowMappingId: row.id,
      sourceType: row.sourceType,
      sourceBusinessId: row.sourceBusinessId,
      sourceVersion: row.sourceVersion,
      sourceFingerprint: row.sourceFingerprint,
      targetKind: "clearing_event_version",
      targetRef: "target-1",
      targetFingerprint: sha,
      mappingDecision: "FORMAL",
      createdByUserId: "maker-1"
    };
    const attempts = await Promise.allSettled([
      first.operatingTakeoverLegacySourceBridge.create({ data: { id: randomUUID(), ...bridgeData } }),
      second.operatingTakeoverLegacySourceBridge.create({ data: { id: randomUUID(), ...bridgeData } })
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    await expect(first.operatingTakeoverLegacySourceBridge.create({
      data: {
        id: randomUUID(),
        ...bridgeData,
        sourceFingerprint: "e".repeat(64),
        targetRef: "target-2"
      }
    })).rejects.toThrow();

    await expect(first.operatingTakeoverManifestVersion.update({ where: { id: manifest.id }, data: { status: "activated" } })).rejects.toThrow("不可更新或删除");
    await expect(first.operatingTakeoverRowMapping.delete({ where: { id: row.id } })).rejects.toThrow("不可更新或删除");
  });

  it("rejects a role summary snapshot that contains a person identity", async () => {
    const manifest = await first.operatingTakeoverManifestVersion.create({
      data: {
        projectId,
        manifestNo: `M-${randomUUID()}`,
        sourceScopeFingerprint: "e".repeat(64),
        mapperName: "test",
        mapperVersion: 1,
        schemaVersion: 1,
        candidateBaselineSha: "f".repeat(40),
        permissionSnapshotFingerprint: "1".repeat(64),
        readSetFingerprint: "2".repeat(64),
        manifestFingerprint: "3".repeat(64),
        createdByUserId: "maker-1"
      }
    });
    await createAuthority("authority-role-1", undefined, "line-role-1", "ROLE_SUMMARY");
    await expect(first.operatingTakeoverRowMapping.create({
      data: {
        projectId,
        manifestVersionId: manifest.id,
        rowNo: 1,
        sourceType: "construction_enterprise_takeover_selection",
        sourceBusinessId: "source-role-1",
        sourceVersion: 1,
        sourceFingerprint: "4".repeat(64),
        sourceCoordinate: "authority:role-1",
        normalizedRowHash: "5".repeat(64),
        amountCents: 100n,
        evidenceLevel: "B",
        coverageKind: "ROLE_SUMMARY",
        coverageKey: "role:project_manager",
        entryKind: "formal",
        mappingDecision: "FORMAL",
        conflictGroupKey: "role-group",
        sourceDiscriminator: "construction_enterprise_assigned_wage",
        governedSubjectKey: "subject-role-1",
        authorityCategory: "assigned_management_salary",
        authoritySnapshotRef: "acv-role-1",
        authorityFingerprint: "6".repeat(64),
        authorityVersionId: "authority-role-1",
        authorityLineId: "line-role-1",
        authorityLineFingerprint: "8".repeat(64),
        authoritativeGrossCapCents: 100n,
        currencyCode: "CNY",
        authoritySnapshot: { constructionEnterpriseAssignmentId: "assignment-1", personAuthorityKey: "user-1" },
        legacySourceSnapshot: { businessReason: "test" },
        readSetSnapshot: {},
        mappingFingerprint: "7".repeat(64)
      }
    })).rejects.toThrow("role_summary_no_person");
  });

  it("binds formal mappings to immutable authority and obligation rows", async () => {
    const manifest = await first.operatingTakeoverManifestVersion.create({
      data: {
        projectId,
        manifestNo: `M-${randomUUID()}`,
        sourceScopeFingerprint: "1".repeat(64),
        mapperName: "test",
        mapperVersion: 1,
        schemaVersion: 1,
        candidateBaselineSha: "2".repeat(40),
        permissionSnapshotFingerprint: "3".repeat(64),
        readSetFingerprint: "4".repeat(64),
        manifestFingerprint: "5".repeat(64),
        createdByUserId: "maker-1"
      }
    });
    await createAuthority("authority-obligation-1", "obligation-1");
    const row = await first.operatingTakeoverRowMapping.create({
      data: {
        projectId,
        manifestVersionId: manifest.id,
        rowNo: 1,
        sourceType: "construction_enterprise_takeover_selection",
        sourceBusinessId: "source-obligation-1",
        sourceVersion: 1,
        sourceFingerprint: "6".repeat(64),
        sourceCoordinate: "authority:obligation-1",
        normalizedRowHash: "7".repeat(64),
        amountCents: 100n,
        evidenceLevel: "A",
        coverageKind: "ROLE_SUMMARY",
        coverageKey: "role:project_manager",
        entryKind: "formal",
        mappingDecision: "FORMAL",
        conflictGroupKey: "obligation-group",
        sourceDiscriminator: "construction_enterprise_guarantee",
        governedSubjectKey: "construction_enterprise_guarantee/project/assignment/obligation-1",
        authorityCategory: "deposit",
        authoritySnapshotRef: "snapshot-authority-obligation-1",
        authorityFingerprint: "8".repeat(64),
        authorityVersionId: "authority-obligation-1",
        obligationId: "obligation-1",
        authoritativeGrossCapCents: 100n,
        currencyCode: "CNY",
        authoritySnapshot: { constructionEnterpriseAssignmentId: "assignment-authority-obligation-1" },
        legacySourceSnapshot: { businessReason: "test" },
        readSetSnapshot: {},
        mappingFingerprint: "9".repeat(64)
      }
    });
    expect(row.id).toBeTruthy();
    await expect(first.guaranteeObligationVersion.delete({ where: { obligationId_versionNo: { obligationId: "obligation-1", versionNo: 1 } } })).rejects.toThrow();
    await expect(first.affiliateClearingAuthorityVersion.delete({ where: { id: "authority-obligation-1" } })).rejects.toThrow();
  });
});
