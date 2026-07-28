import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const TEST_DATABASE = "jiangkong_spot_incidental_task11";

export function spotMaterialClassificationDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("零星材料分类并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("零星材料分类并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("spot material classification PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_SPOT_MATERIAL_CLASSIFICATION_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "rejects concurrent draft creation for one material application",
    async () => {
      const databaseUrl = spotMaterialClassificationDatabaseUrl(
        process.env.SPOT_MATERIAL_CLASSIFICATION_DATABASE_URL
      );
      const clients = [0, 1].map(
        () =>
          new PrismaClient({
            datasources: { db: { url: databaseUrl } }
          })
      );
      const marker = randomUUID();
      const actorId = `spot-classification-user-${marker}`;
      const projectId = `spot-classification-project-${marker}`;
      const procurementId = `spot-classification-procurement-${marker}`;
      const versionId = `spot-classification-version-${marker}`;
      const lineId = `spot-classification-line-${marker}`;
      const paymentIds = [
        `spot-classification-payment-a-${marker}`,
        `spot-classification-payment-b-${marker}`
      ];

      try {
        await clients[0]!.user.create({
          data: { id: actorId, name: "零星材料分类实库门禁用户" }
        });
        await clients[0]!.project.create({
          data: {
            id: projectId,
            code: `SPOT-CLASS-${marker}`,
            name: "零星材料分类实库门禁项目"
          }
        });
        await clients[0]!.spotProcurement.create({
          data: {
            id: procurementId,
            projectId,
            code: `LXCG-SPOT-CLASS-${marker}`,
            applicantUserId: actorId,
            handlerUserId: actorId,
            status: "approved_in_progress"
          }
        });
        await clients[0]!.spotProcurementVersion.create({
          data: {
            id: versionId,
            procurementId,
            versionNo: 1,
            status: "approved",
            reason: "实库 3000 元分类与并发门禁",
            handlerUserId: actorId,
            applicationDepartmentSnapshot: "物资部",
            applicationNameSnapshot: "零星材料申请",
            purchaserNameSnapshot: "实库门禁用户",
            purchaserDepartmentNameSnapshot: "物资部",
            requestedArrivalAt: new Date(),
            createdByUserId: actorId
          }
        });
        await clients[0]!.spotProcurementLine.create({
          data: {
            id: lineId,
            versionId,
            sortOrder: 1,
            materialName: "实库门禁材料",
            unit: "项",
            quantity: new Prisma.Decimal("1")
          }
        });
        await clients[0]!.spotProcurement.update({
          where: { id: procurementId },
          data: { currentVersionId: versionId }
        });

        const results = await Promise.allSettled(
          clients.map((client, index) =>
            client.spotProcurementPayment.create({
              data: {
                id: paymentIds[index]!,
                projectId,
                procurementId,
                procurementVersionId: versionId,
                code: `LXCG-SPOT-CLASS-${marker}-P00${index + 1}`,
                status: "draft",
                settlementAmountCents: 299_999n,
                companyPaymentAmountCents: 299_999n,
                approvalAmountCents: 299_999n,
                paymentPath: "supplier_direct",
                paymentMethod: "bank_transfer",
                paymentType: "company_direct",
                merchantNameSnapshot: "实库门禁材料商",
                payeeNameSnapshot: "实库门禁材料商",
                handlerUserId: actorId,
                createdByUserId: actorId
              }
            })
          )
        );

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(
          await clients[0]!.spotProcurementPayment.count({
            where: { id: { in: paymentIds }, status: "draft" }
          })
        ).toBe(1);
      } finally {
        await Promise.all(clients.map((client) => client.$disconnect()));
      }
    },
    30_000
  );
});
