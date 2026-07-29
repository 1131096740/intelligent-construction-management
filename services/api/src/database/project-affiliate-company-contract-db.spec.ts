import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const describeDatabase =
  process.env.RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS === "1"
    ? describe
    : describe.skip;

describeDatabase("project affiliate-company contract PostgreSQL constraints", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts only a complete signed confirmation and then rejects update and delete", async () => {
    const fixture = await createFixture(prisma);
    const contractId = randomUUID();
    await prisma.projectAffiliateCompanyContract.create({
      data: {
        id: contractId,
        projectId: fixture.projectId,
        contractReference: `GL-${contractId}`,
        contractName: "项目挂靠管理协议",
        signedAt: new Date("2026-07-20T00:00:00.000Z"),
        rightsObligationsSummary: "双方已线下约定项目管理、资金核对与责任边界。",
        affiliateAssignmentId: fixture.assignmentId,
        affiliateBusinessPartyVersionId: fixture.partyVersionId,
        affiliateNameSnapshot: "挂靠建设集团",
        affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
        companyEntityId: fixture.companyId,
        companyEntityVersionId: fixture.companyVersionId,
        companyEntityNameSnapshot: "我方建设有限公司",
        companyEntityCreditCodeSnapshot: fixture.companyCreditCode,
        companyEntityRegisteredAddressSnapshot: "厦门市",
        fileId: fixture.contractFileId,
        fileContentSha256Snapshot: "a".repeat(64),
        idempotencyKey: randomUUID(),
        requestFingerprint: "b".repeat(64),
        recordedByUserId: fixture.recorderId,
        recordedByRoleKey: "contract_staff"
      }
    });

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectAffiliateCompanyContract"
        SET "status" = 'confirmed',
            "confirmedByUserId" = ${fixture.directorId},
            "confirmedAt" = NOW()
        WHERE "id" = ${contractId}
      `)
    ).rejects.toThrow("ProjectAffiliateCompanyContract_confirmation_check");

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "ProjectAffiliateCompanyContract"
      SET "status" = 'confirmed',
          "confirmedByUserId" = ${fixture.directorId},
          "confirmedAt" = NOW(),
          "confirmationActionId" = ${randomUUID()},
          "confirmationSignatureVersionId" = ${fixture.signatureVersionId},
          "confirmationSignatureFileId" = ${fixture.signatureFileId},
          "confirmationSignatureSha256" = ${"c".repeat(64)}
      WHERE "id" = ${contractId}
    `);

    await expect(
      prisma.projectAffiliateCompanyContract.update({
        where: { id: contractId },
        data: { rightsObligationsSummary: "试图覆盖已确认权利义务" }
      })
    ).rejects.toThrow("confirmed affiliate-company contracts are append-only");
    await expect(
      prisma.projectAffiliateCompanyContract.delete({ where: { id: contractId } })
    ).rejects.toThrow("affiliate-company contracts cannot be deleted");
  });

  it("rejects reusing the same signed file for a second contract", async () => {
    const fixture = await createFixture(prisma);
    const firstId = randomUUID();
    const base = {
      projectId: fixture.projectId,
      contractName: "项目挂靠管理协议",
      signedAt: new Date("2026-07-20T00:00:00.000Z"),
      rightsObligationsSummary: "双方已线下约定项目管理、资金核对与责任边界。",
      affiliateAssignmentId: fixture.assignmentId,
      affiliateBusinessPartyVersionId: fixture.partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
      companyEntityId: fixture.companyId,
      companyEntityVersionId: fixture.companyVersionId,
      companyEntityNameSnapshot: "我方建设有限公司",
      companyEntityCreditCodeSnapshot: fixture.companyCreditCode,
      companyEntityRegisteredAddressSnapshot: "厦门市",
      fileId: fixture.contractFileId,
      fileContentSha256Snapshot: "a".repeat(64),
      requestFingerprint: "d".repeat(64),
      recordedByUserId: fixture.recorderId,
      recordedByRoleKey: "contract_staff"
    };
    await prisma.projectAffiliateCompanyContract.create({
      data: {
        id: firstId,
        contractReference: `GL-A-${firstId}`,
        idempotencyKey: randomUUID(),
        ...base
      }
    });

    await expect(
      prisma.projectAffiliateCompanyContract.create({
        data: {
          id: randomUUID(),
          contractReference: `GL-B-${firstId}`,
          idempotencyKey: randomUUID(),
          ...base
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

async function createFixture(prisma: PrismaClient) {
  const suffix = randomUUID();
  const recorderId = `contract-recorder-${suffix}`;
  const directorId = `contract-director-${suffix}`;
  const projectId = `project-${suffix}`;
  const partyId = `party-${suffix}`;
  const partyVersionId = `party-version-${suffix}`;
  const assignmentId = `assignment-${suffix}`;
  const companyId = `company-${suffix}`;
  const companyVersionId = `company-version-${suffix}`;
  const contractFileId = `contract-file-${suffix}`;
  const signatureFileId = `signature-file-${suffix}`;
  const signatureVersionId = `signature-version-${suffix}`;
  const affiliateCreditCode = `AFFILIATE-${suffix}`;
  const companyCreditCode = `COMPANY-${suffix}`;

  await prisma.user.createMany({
    data: [
      { id: recorderId, name: "合同人员", isActive: true },
      { id: directorId, name: "合同主管", isActive: true }
    ]
  });
  await prisma.project.create({
    data: { id: projectId, code: `P-${suffix}`, name: "隔离迁移测试项目" }
  });
  await prisma.businessParty.create({
    data: {
      id: partyId,
      name: "挂靠建设集团",
      unifiedSocialCreditCode: affiliateCreditCode,
      createdByUserId: recorderId
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: partyVersionId,
      businessPartyId: partyId,
      versionNo: 1,
      snapshot: {
        name: "挂靠建设集团",
        unifiedSocialCreditCode: affiliateCreditCode
      },
      createdByUserId: recorderId
    }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: assignmentId,
      projectId,
      businessPartyId: partyId,
      businessPartyVersionId: partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      affiliateCreditCodeSnapshot: affiliateCreditCode,
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      changeReason: "隔离数据库约束验证",
      assignedByUserId: recorderId
    }
  });
  await prisma.companyEntity.create({
    data: {
      id: companyId,
      name: "我方建设有限公司",
      unifiedSocialCreditCode: companyCreditCode,
      registeredAddress: "厦门市",
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await prisma.companyEntityVersion.create({
    data: {
      id: companyVersionId,
      companyEntityId: companyId,
      versionNo: 1,
      name: "我方建设有限公司",
      unifiedSocialCreditCode: companyCreditCode,
      registeredAddress: "厦门市",
      isActive: true,
      action: "create",
      actorUserId: recorderId,
      actorRoleKey: "contract_staff"
    }
  });
  await prisma.fileObject.createMany({
    data: [
      {
        id: contractFileId,
        bucket: "private-local",
        objectKey: `tests/${contractFileId}.pdf`,
        originalName: "挂靠管理协议.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: recorderId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      },
      {
        id: signatureFileId,
        bucket: "private-local",
        objectKey: `tests/${signatureFileId}.png`,
        originalName: "合同主管签名.png",
        mimeType: "image/png",
        sizeBytes: 100,
        uploadedByUserId: directorId,
        contentSha256: "c".repeat(64),
        storageStatus: "active"
      }
    ]
  });
  await prisma.handwrittenSignatureVersion.create({
    data: {
      id: signatureVersionId,
      userId: directorId,
      fileId: signatureFileId,
      contentSha256: "c".repeat(64),
      source: "canvas"
    }
  });

  return {
    recorderId,
    directorId,
    projectId,
    partyVersionId,
    assignmentId,
    companyId,
    companyVersionId,
    contractFileId,
    signatureFileId,
    signatureVersionId,
    affiliateCreditCode,
    companyCreditCode
  };
}
