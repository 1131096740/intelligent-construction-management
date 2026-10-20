import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
export async function createCompanyTransferFixture(prisma: PrismaClient, companyName = "我方建设有限公司") {
  const suffix: string = randomUUID();
  const recorderId: string = randomUUID();
  const directorId: string = randomUUID();
  const projectId: string = randomUUID();
  const partyId: string = randomUUID();
  const partyVersionId: string = randomUUID();
  const assignmentId: string = randomUUID();
  const companyId: string = randomUUID();
  const companyVersionId: string = randomUUID();
  const contractFileId: string = randomUUID();
  const signatureFileId: string = randomUUID();
  const signatureVersionId: string = randomUUID();
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
  await prisma.projectMember.create({
    data: {
      projectId,
      userId: recorderId,
      positionKey: "contract_staff"
    }
  });
  await prisma.businessParty.create({
    data: {
      id: partyId,
      name: "挂靠建设集团",
      normalizedName: `挂靠建设集团-${suffix}`,
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
      name: companyName,
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
      name: companyName,
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
