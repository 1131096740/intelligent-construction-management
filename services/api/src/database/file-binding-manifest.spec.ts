import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NON_RECEIPT_FILE_BINDINGS } from "../file/file-business-binding";
import {
  buildContractFileBindingManifest,
  fileBusinessBindingRefs,
  resolveContractVersionFileBindings
} from "../file/file-binding-manifest";

describe("file binding manifest database integration", () => {
  const integrationTest =
    process.env.RUN_FILE_BINDING_MANIFEST_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "resolves version-owned bindings and classifies shared vs exclusive against real PostgreSQL",
    async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl || process.env.NODE_ENV === "production") {
        throw new Error("文件绑定清单数据库测试必须连接非生产隔离数据库");
      }
      const schema = `file_binding_manifest_${randomUUID().replace(/-/gu, "")}`;
      const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const isolatedUrl = new URL(databaseUrl);
      isolatedUrl.searchParams.set("schema", schema);
      const client = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });

      try {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await createIsolatedTables(client);

        await seed(client);

        // 1. 版本自有绑定解析：只含目标版本 V1 的绑定，不含 V2 的文件。
        const ownedBindings = await resolveContractVersionFileBindings(
          client,
          ["version-v1"]
        );
        const ownedFileIds = new Set(ownedBindings.map((binding) => binding.fileId));
        expect(ownedFileIds.has("file-z")).toBe(false);
        expect(ownedFileIds.has("file-a")).toBe(true);
        expect(ownedFileIds.has("file-new")).toBe(true);
        expect(ownedFileIds.has("file-base")).toBe(true);
        expect(ownedBindings).toContainEqual(
          expect.objectContaining({
            table: "ContractDraftAttachment",
            column: "fileId",
            rowId: "draft-1",
            fileId: "file-a"
          })
        );
        expect(ownedBindings).toContainEqual(
          expect.objectContaining({
            table: "ContractGeneratedDocument",
            column: "pdfFileId",
            rowId: "gen-1",
            fileId: "file-e"
          })
        );

        // 2. 行级引用扫描：文件 a 同时被目标草稿行与外部结算行引用。
        const refsForA = await fileBusinessBindingRefs(client, ["file-a"]);
        expect(refsForA.map((ref) => `${ref.table}:${ref.column}:${ref.rowId}`)).toEqual(
          expect.arrayContaining([
            "ContractDraftAttachment:fileId:draft-1",
            "SettlementLineAttachment:fileId:settlement-1"
          ])
        );

        // 3. 完整清单分类。
        const manifest = await buildContractFileBindingManifest(client, {
          contractVersionIds: ["version-v1"]
        });
        expect(manifest.mode).toBe("preview_only");
        expect(manifest.executionAllowed).toBe(false);
        expect(manifest.rows).toHaveLength(13);

        const byFileId = new Map(manifest.rows.map((row) => [row.fileId, row]));
        expect(byFileId.get("file-a")).toMatchObject({ bindingType: "shared" });
        expect(byFileId.get("file-a")?.blockedReason).toMatch(/永不执行对象删除/);
        expect(byFileId.get("file-a")?.sharedReason).toContain(
          "SettlementLineAttachment:fileId:settlement-1"
        );
        expect(byFileId.get("file-e")).toMatchObject({ bindingType: "shared" });
        expect(byFileId.get("file-e")?.sharedReason).toContain(
          "SpotProcurementReceiptPhoto:watermarkedFileId:photo-1"
        );

        for (const fileId of [
          "file-b",
          "file-c",
          "file-d",
          "file-d-preview",
          "file-tax",
          "file-auth",
          "file-bill",
          "file-import",
          "file-archive",
          "file-new",
          "file-base"
        ]) {
          expect(byFileId.get(fileId)?.bindingType).toBe("exclusive");
          expect(byFileId.get(fileId)?.blockedReason).toBeUndefined();
        }

        expect(manifest.summary).toEqual({
          exclusiveCount: 11,
          sharedCount: 2,
          blockedCount: 2,
          totalObjectCount: 13
        });
      } finally {
        await client.$disconnect();
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.$disconnect();
      }
    },
    30_000
  );
});

const EXTRA_VERSION_COLUMNS: Record<string, string[]> = {
  ContractDraftAttachment: ["contractVersionId"],
  ContractArchiveFile: ["contractVersionId"],
  ContractFormalFile: ["contractVersionId"],
  ContractGeneratedDocument: ["contractVersionId"],
  ContractOfflineRevision: ["contractVersionId"],
  ContractAuthorization: ["originContractVersionId"],
  ContractBill: ["contractVersionId"],
  ContractBillImport: ["sourceContractVersionId", "targetContractVersionId"],
  ContractTaxFactRevision: ["contractVersionId"]
};

async function createIsolatedTables(client: PrismaClient): Promise<void> {
  for (const { table, columns } of NON_RECEIPT_FILE_BINDINGS) {
    const extraColumns = EXTRA_VERSION_COLUMNS[table] ?? [];
    const columnDefinitions = [...columns, ...extraColumns]
      .map((column) => `"${column}" TEXT`)
      .join(", ");
    await client.$executeRawUnsafe(
      `CREATE TABLE "${table}" ("id" TEXT PRIMARY KEY, ${columnDefinitions})`
    );
  }
  await client.$executeRawUnsafe(
    `CREATE TABLE "FileObject" ("id" TEXT PRIMARY KEY, "supersedesFileObjectId" TEXT, "bucket" TEXT, "objectKey" TEXT, "storageStatus" TEXT, "contentSha256" TEXT)`
  );
  await client.$executeRawUnsafe(
    `CREATE TABLE "SpotProcurementReceiptPhoto" ("id" TEXT PRIMARY KEY, "originalFileId" TEXT, "watermarkedFileId" TEXT)`
  );
}

async function seed(client: PrismaClient): Promise<void> {
  const insertFile = async (id: string, supersedesFileObjectId: string | null) =>
    client.$executeRawUnsafe(
      `INSERT INTO "FileObject" ("id", "supersedesFileObjectId", "bucket", "objectKey", "storageStatus")
       VALUES ('${id}', $1, 'private-bucket', 'uploads/${id}.pdf', 'active')`,
      supersedesFileObjectId
    );

  // FileObject 行（替换链：file-new 替换 file-base）。
  await insertFile("file-a", null);
  await insertFile("file-b", null);
  await insertFile("file-c", null);
  await insertFile("file-d", null);
  await insertFile("file-d-preview", null);
  await insertFile("file-e", null);
  await insertFile("file-tax", null);
  await insertFile("file-auth", null);
  await insertFile("file-bill", null);
  await insertFile("file-import", null);
  await insertFile("file-archive", null);
  await insertFile("file-z", null);
  await insertFile("file-new", "file-base");
  await insertFile("file-base", null);

  await client.$executeRawUnsafe(
    `INSERT INTO "ContractVersion" ("id", "taxFactEvidenceFileId") VALUES ('version-v1', 'file-tax'), ('version-v2', NULL)`
  );

  await client.$executeRawUnsafe(
    `INSERT INTO "ContractDraftAttachment" ("id", "contractVersionId", "fileId")
     VALUES ('draft-1', 'version-v1', 'file-a'), ('draft-other', 'version-v2', 'file-z')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractArchiveFile" ("id", "contractVersionId", "fileId")
     VALUES ('archive-1', 'version-v1', 'file-archive'), ('archive-new', 'version-v1', 'file-new'), ('archive-base', 'version-v1', 'file-base')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractFormalFile" ("id", "contractVersionId", "fileId")
     VALUES ('formal-1', 'version-v1', 'file-c')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractGeneratedDocument" ("id", "contractVersionId", "docxFileId", "pdfFileId")
     VALUES ('gen-1', 'version-v1', 'file-b', 'file-e')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractOfflineRevision" ("id", "contractVersionId", "fileId", "previewPdfFileId")
     VALUES ('off-1', 'version-v1', 'file-d', 'file-d-preview')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractTaxFactRevision" ("id", "contractVersionId", "evidenceFileId")
     VALUES ('tfr-1', 'version-v1', 'file-tax')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractAuthorization" ("id", "originContractVersionId", "fileId")
     VALUES ('auth-1', 'version-v1', 'file-auth')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractBill" ("id", "contractVersionId", "sourceExcelFileId")
     VALUES ('bill-1', 'version-v1', 'file-bill')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ContractBillImport" ("id", "fileId", "sourceContractVersionId", "targetContractVersionId")
     VALUES ('import-1', 'file-import', NULL, 'version-v1')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "SettlementLineAttachment" ("id", "fileId") VALUES ('settlement-1', 'file-a')`
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "SpotProcurementReceiptPhoto" ("id", "originalFileId", "watermarkedFileId")
     VALUES ('photo-1', NULL, 'file-e')`
  );
}
