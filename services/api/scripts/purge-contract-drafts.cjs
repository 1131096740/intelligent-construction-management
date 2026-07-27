const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Prisma, PrismaClient } = require("@prisma/client");

const CONFIRMATION = "PURGE_CONTRACT_DRAFTS";

function readDatabaseUrl(filePath) {
  try {
    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (!line) return undefined;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    return (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    );
  } catch {
    return undefined;
  }
}

function parseArgs(argv) {
  const result = { versionIds: [], apply: false, inspect: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--version-id") result.versionIds.push(argv[++index]);
    else if (value === "--expected-fingerprint") result.expectedFingerprint = argv[++index];
    else if (value === "--authorized-by") result.authorizedBy = argv[++index];
    else if (value === "--confirm") result.confirmation = argv[++index];
    else if (value === "--apply") result.apply = true;
    else if (value === "--inspect") result.inspect = true;
    else throw new Error(`不支持的参数：${value}`);
  }
  if (!result.versionIds.length || new Set(result.versionIds).size !== result.versionIds.length) {
    throw new Error("必须提供且只能提供一次每个 --version-id");
  }
  if (result.versionIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) {
    throw new Error("每个 --version-id 必须是 UUID");
  }
  if (!result.inspect && (!result.expectedFingerprint || !/^[a-f0-9]{64}$/iu.test(result.expectedFingerprint))) {
    throw new Error("必须提供 64 位十六进制 --expected-fingerprint");
  }
  if (!result.inspect && !result.authorizedBy?.trim()) throw new Error("必须提供 --authorized-by 作为授权审计说明");
  if (result.inspect && result.apply) throw new Error("--inspect 不能与 --apply 同时使用");
  if (result.apply && result.confirmation !== CONFIRMATION) {
    throw new Error(`执行清除必须同时提供 --confirm ${CONFIRMATION}`);
  }
  return result;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ids(values) {
  return Prisma.join(values);
}

async function count(tx, sql) {
  const [row] = await tx.$queryRaw(Prisma.raw(sql));
  return Number(row.count);
}

async function inspectTargets(tx, versionIds, { lock }) {
  const targetRows = await tx.$queryRaw(Prisma.sql`
    SELECT
      c."id" AS "contractId", v."id" AS "versionId", coalesce(c."code", '') AS "code",
      v."versionNo", v."status", v."changeType", v."settlementMode"
    FROM "ContractVersion" v
    JOIN "Contract" c ON c."id" = v."contractId"
    WHERE v."id" IN (${ids(versionIds)})
    ORDER BY v."id" ASC
    ${lock ? Prisma.sql`FOR UPDATE OF c, v` : Prisma.empty}
  `);
  if (targetRows.length !== versionIds.length) {
    throw new Error("目标合同版本已变化或不存在；系统拒绝清除");
  }
  const expectedIds = [...versionIds].sort();
  if (targetRows.map((row) => row.versionId).join(",") !== expectedIds.join(",")) {
    throw new Error("目标合同版本集合不一致；系统拒绝清除");
  }
  const invalid = targetRows.filter((row) =>
    row.status !== "draft" || row.settlementMode !== null || row.versionNo !== 1
  );
  if (invalid.length) {
    throw new Error("目标不再是首版且未结算方式确认的纯草稿；系统拒绝清除");
  }
  return targetRows;
}

async function buildManifest(tx, versionIds, lock = false) {
  const targets = await inspectTargets(tx, versionIds, { lock });
  const versionIdsSql = ids(versionIds);
  const counts = {};
  const countFor = async (key, statement) => {
    counts[key] = await count(tx, statement);
  };

  await countFor("contractBills", `SELECT count(*)::int AS count FROM "ContractBill" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("contractBillRows", `SELECT count(*)::int AS count FROM "ContractBillRow" r JOIN "ContractBill" b ON b."id" = r."contractBillId" WHERE b."contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("contractBillImports", `SELECT count(*)::int AS count FROM "ContractBillImport" i JOIN "ContractBill" b ON b."id" = i."contractBillId" WHERE b."contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("paymentTermsVersions", `SELECT count(*)::int AS count FROM "PaymentTermsVersion" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("paymentTermsStages", `SELECT count(*)::int AS count FROM "PaymentTermsStage" s JOIN "PaymentTermsVersion" p ON p."id" = s."paymentTermsVersionId" WHERE p."contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("generatedDocuments", `SELECT count(*)::int AS count FROM "ContractGeneratedDocument" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("takeovers", `SELECT count(*)::int AS count FROM "ContractTakeover" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("draftCheckpoints", `SELECT count(*)::int AS count FROM "ContractDraftCheckpoint" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("partySnapshots", `SELECT count(*)::int AS count FROM "ContractPartySnapshot" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await countFor("authorizationLinks", `SELECT count(*)::int AS count FROM "ContractVersionAuthorizationLink" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);

  const blockers = {};
  const blockerFor = async (key, statement) => { blockers[key] = await count(tx, statement); };
  await blockerFor("settlements", `SELECT count(*)::int AS count FROM "Settlement" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("settlementDrafts", `SELECT count(*)::int AS count FROM "SettlementDraft" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("settlementProcesses", `SELECT count(*)::int AS count FROM "ContractSettlementProcess" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("paymentRequests", `SELECT count(*)::int AS count FROM "PaymentRequest" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("approvals", `SELECT count(*)::int AS count FROM "ApprovalInstance" WHERE "businessType" = 'contract_version' AND "businessId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("archiveFiles", `SELECT count(*)::int AS count FROM "ContractArchiveFile" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("formalFiles", `SELECT count(*)::int AS count FROM "ContractFormalFile" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("authorizations", `SELECT count(*)::int AS count FROM "ContractAuthorization" WHERE "originContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("sealTasks", `SELECT count(*)::int AS count FROM "ContractSealTask" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("taxFactRevisions", `SELECT count(*)::int AS count FROM "ContractTaxFactRevision" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("offlineRevisions", `SELECT count(*)::int AS count FROM "ContractOfflineRevision" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("negotiationRounds", `SELECT count(*)::int AS count FROM "ContractNegotiationRound" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("lineage", `SELECT count(*)::int AS count FROM "ContractBillRowLineage" WHERE "createdInContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("transitions", `SELECT count(*)::int AS count FROM "ContractBillRowTransition" WHERE "fromContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")}) OR "toContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("carryForwards", `SELECT count(*)::int AS count FROM "ContractBillRowCarryForward" WHERE "contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("versionDerivatives", `SELECT count(*)::int AS count FROM "ContractVersion" WHERE "baseVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")}) OR "supersedesVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")}) OR "copiedFromContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("reusedAuthorizationLinks", `SELECT count(*)::int AS count FROM "ContractVersionAuthorizationLink" WHERE "reusedFromContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("billImportCrossReferences", `SELECT count(*)::int AS count FROM "ContractBillImport" i WHERE (i."sourceContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")}) OR i."targetContractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")})) AND NOT EXISTS (SELECT 1 FROM "ContractBill" b WHERE b."id" = i."contractBillId" AND b."contractVersionId" IN (${versionIds.map((id) => `'${id}'`).join(",")}))`);
  await blockerFor("genericArchives", `SELECT count(*)::int AS count FROM "ArchiveRecord" WHERE "businessId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("genericPdfs", `SELECT count(*)::int AS count FROM "PdfDocument" WHERE "businessId" IN (${versionIds.map((id) => `'${id}'`).join(",")})`);
  await blockerFor("contractSiblings", `SELECT count(*)::int AS count FROM "ContractVersion" WHERE "contractId" IN (SELECT DISTINCT "contractId" FROM "ContractVersion" WHERE "id" IN (${versionIds.map((id) => `'${id}'`).join(",")})) AND "id" NOT IN (${versionIds.map((id) => `'${id}'`).join(",")})`);

  const fileRows = await tx.$queryRaw(Prisma.sql`
    WITH target_files AS (
      SELECT i."fileId" AS "fileId" FROM "ContractBillImport" i
      JOIN "ContractBill" b ON b."id" = i."contractBillId"
      WHERE b."contractVersionId" IN (${versionIdsSql})
      UNION
      SELECT b."sourceExcelFileId" FROM "ContractBill" b WHERE b."contractVersionId" IN (${versionIdsSql})
      UNION
      SELECT d."docxFileId" FROM "ContractGeneratedDocument" d WHERE d."contractVersionId" IN (${versionIdsSql})
      UNION
      SELECT d."pdfFileId" FROM "ContractGeneratedDocument" d WHERE d."contractVersionId" IN (${versionIdsSql})
    )
    SELECT f."id", f."objectKey", f."storageStatus", f."supersedesFileObjectId"
    FROM "FileObject" f JOIN target_files t ON t."fileId" = f."id"
    WHERE t."fileId" IS NOT NULL
    ORDER BY f."id" ASC
  `);
  const [fileReferenceCount] = await tx.$queryRaw(Prisma.sql`
    WITH target_files AS (
      SELECT i."fileId" AS "fileId" FROM "ContractBillImport" i
      JOIN "ContractBill" b ON b."id" = i."contractBillId"
      WHERE b."contractVersionId" IN (${versionIdsSql})
      UNION
      SELECT b."sourceExcelFileId" FROM "ContractBill" b WHERE b."contractVersionId" IN (${versionIdsSql})
      UNION
      SELECT d."docxFileId" FROM "ContractGeneratedDocument" d WHERE d."contractVersionId" IN (${versionIdsSql})
      UNION
      SELECT d."pdfFileId" FROM "ContractGeneratedDocument" d WHERE d."contractVersionId" IN (${versionIdsSql})
    )
    SELECT count(DISTINCT "fileId")::int AS "count" FROM target_files WHERE "fileId" IS NOT NULL
  `);
  if (fileRows.length !== fileReferenceCount.count) {
    throw new Error("目标私有文件记录不完整；系统拒绝清除");
  }
  if (fileRows.some((file) => file.storageStatus !== "active" || file.supersedesFileObjectId)) {
    throw new Error("目标存在非活动或替换链私有文件；系统拒绝清除");
  }
  return { targets, counts, blockers, files: fileRows };
}

function assertNoBlockers(blockers) {
  const active = Object.entries(blockers).filter(([, value]) => value > 0);
  if (active.length) {
    throw new Error(`目标存在不可清除的业务事实：${active.map(([key, value]) => `${key}=${value}`).join(", ")}`);
  }
}

async function deleteBusinessRows(tx, targets, versionIds, fileIds, auditMetadata) {
  const targetIds = ids(versionIds);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractBillImport" WHERE "contractBillId" IN (SELECT "id" FROM "ContractBill" WHERE "contractVersionId" IN (${targetIds}))`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractBillRow" WHERE "contractBillId" IN (SELECT "id" FROM "ContractBill" WHERE "contractVersionId" IN (${targetIds}))`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractBill" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "PaymentTermsStage" WHERE "paymentTermsVersionId" IN (SELECT "id" FROM "PaymentTermsVersion" WHERE "contractVersionId" IN (${targetIds}))`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractTakeover" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractGeneratedDocument" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractDraftCheckpoint" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractPartySnapshot" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractVersionAuthorizationLink" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "PaymentTermsVersion" WHERE "contractVersionId" IN (${targetIds})`);
  await tx.auditLog.createMany({
    data: versionIds.map((businessId) => ({
      actorUserId: null,
      action: "contract.draft.purge",
      businessType: "contract_version",
      businessId,
      metadata: auditMetadata
    }))
  });
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContractVersion" WHERE "id" IN (${targetIds})`);
  await tx.$executeRaw(Prisma.sql`DELETE FROM "Contract" WHERE "id" IN (${ids(targets.map((target) => target.contractId))})`);
  if (fileIds.length) {
    const deleted = await tx.fileObject.deleteMany({ where: { id: { in: fileIds }, storageStatus: "active" } });
    if (deleted.count !== fileIds.length) {
      throw new Error("私有文件记录状态已变化；数据库清除已回滚");
    }
  }
}

async function createStorage() {
  const { PrivateFileStorage } = require("../dist/file/file.service");
  const storage = new PrivateFileStorage();
  storage.onModuleInit();
  return storage;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    const databaseUrl = readDatabaseUrl(path.resolve(__dirname, "../.env"));
    if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  }
  const input = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const readManifest = await prisma.$transaction((tx) => buildManifest(tx, input.versionIds));
    assertNoBlockers(readManifest.blockers);
    const targetFingerprint = fingerprint(readManifest.targets);
    if (input.inspect) {
      console.log(JSON.stringify({ mode: "inspect", targetFingerprint, targetCount: readManifest.targets.length, counts: readManifest.counts, fileCount: readManifest.files.length, auditRetention: "preserve" }));
      return;
    }
    if (targetFingerprint !== input.expectedFingerprint) {
      throw new Error(`目标指纹不一致：expected=${input.expectedFingerprint} actual=${targetFingerprint}`);
    }
    if (!input.apply) {
      console.log(JSON.stringify({ mode: "check", targetFingerprint, targetCount: readManifest.targets.length, counts: readManifest.counts, fileCount: readManifest.files.length, auditRetention: "preserve" }));
      return;
    }
    const storage = await createStorage();
    const receipt = await prisma.$transaction(async (tx) => {
      const manifest = await buildManifest(tx, input.versionIds, true);
      assertNoBlockers(manifest.blockers);
      const lockedFingerprint = fingerprint(manifest.targets);
      if (lockedFingerprint !== input.expectedFingerprint) {
        throw new Error("加锁后目标指纹已变化；数据库清除已回滚");
      }
      for (const file of manifest.files) await storage.delete(file.objectKey);
      const auditMetadata = {
        authorizedBy: input.authorizedBy.trim(),
        targetFingerprint: lockedFingerprint,
        preservedAuditLogs: true,
        deletedPrivateFileCount: manifest.files.length,
        deletedBusinessCounts: manifest.counts
      };
      await deleteBusinessRows(tx, manifest.targets, input.versionIds, manifest.files.map((file) => file.id), auditMetadata);
      const [remaining] = await tx.$queryRaw(Prisma.sql`SELECT count(*)::int AS count FROM "ContractVersion" WHERE "id" IN (${ids(input.versionIds)})`);
      if (remaining.count !== 0) throw new Error("合同版本仍然存在；数据库清除已回滚");
      return { targetFingerprint: lockedFingerprint, targetCount: manifest.targets.length, counts: manifest.counts, fileCount: manifest.files.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    console.log(JSON.stringify({ mode: "apply", ...receipt, auditRetention: "preserve" }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
