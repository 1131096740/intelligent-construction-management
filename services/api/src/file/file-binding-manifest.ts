import { Prisma } from "@prisma/client";
import { NON_RECEIPT_FILE_BINDINGS } from "./file-business-binding";
import { isValidObjectKey, type VersionedObjectStorage } from "./versioned-object-storage";

/**
 * 精确文件绑定清单。
 *
 * 用途：把一个「清理目标」（当前为合同版本聚合，后续票可扩展）内的全部文件对象
 * 解析为只读清单，逐文件判定 `exclusive`（只被目标自身绑定、可进入对象清理候选）
 * 与 `shared`（存在目标聚合之外的业务绑定，永不执行对象删除）。
 *
 * 安全边界（本票约定）：
 * - 全程只读：只查询、不写入、不删除、不调用对象存储写操作。
 * - 判定基于中心注册表 `NON_RECEIPT_FILE_BINDINGS` 的**行级**绑定：仅把目标自身的
 *   行当作「内部绑定」，其余任何表行的引用（含收货照片与替换链）都算外部共享。
 * - 共享文件永不进入对象清理候选；清单只报告，执行交由后续受控票据。
 * - 对象键必须是精确键（无尾部 `/`、无 `..`、非 `uploads/` 等前缀形态）。
 */

export interface ManifestBusinessBinding {
  table: string;
  column: string;
  rowId: string;
}

/** 已解析的绑定：`fileId` 是绑定行里实际引用到的文件对象 ID。 */
export interface ResolvedFileBinding extends ManifestBusinessBinding {
  fileId: string;
}

export type FileBindingKind = "exclusive" | "shared";

export interface FileBindingManifestRow {
  fileId: string;
  bucket: string;
  objectKey: string;
  storageStatus: string;
  contentSha256?: string | null;
  /** 该文件对象被哪些业务行引用（含内部与外部）。 */
  businessBindings: ManifestBusinessBinding[];
  bindingType: FileBindingKind;
  /** shared 时的外部绑定摘要（`table:column:rowId`，逗号分隔）。 */
  sharedReason?: string;
  /** 非空表示该文件被阻止进入对象清理候选（shared / 状态异常 / 键不精确等）。 */
  blockedReason?: string;
  /** 仅当提供了版本化对象存储且为可清理候选时填写。 */
  storageSnapshot?: {
    versionCount: number;
    deleteMarkerCount: number;
  };
  /** 版本枚举失败时记录，不改变 `exclusive` 判定，仅提示后续需重试确认。 */
  versionEnumerationError?: string;
}

export interface CleanupTarget {
  contractVersionIds: string[];
}

export interface CleanupManifestSummary {
  /** 可执行对象清理的独占文件数。 */
  exclusiveCount: number;
  /** 存在外部绑定的共享文件数。 */
  sharedCount: number;
  /** 被阻止（含非 active 状态 / 键不精确等）的文件数。 */
  blockedCount: number;
  /** 清单内全部候选文件对象数。 */
  totalObjectCount: number;
}

export interface CleanupManifest {
  mode: "preview_only";
  executionAllowed: false;
  generatedAt: string;
  target: CleanupTarget;
  rows: FileBindingManifestRow[];
  summary: CleanupManifestSummary;
}

export interface FileBindingManifestInput {
  tx: Prisma.TransactionClient;
  target: CleanupTarget;
  /** 业务层已解析的目标自身绑定（行级）。 */
  applicationBindings: readonly ResolvedFileBinding[];
  /** 可选：对每个可清理独占文件补充版本/删除标记快照。 */
  storage?: VersionedObjectStorage;
}

export interface FileBindingClassification {
  bindingType: FileBindingKind;
  /** shared 时的外部绑定摘要（`table:column:rowId`，逗号分隔）。 */
  sharedReason?: string;
}

export function bindingKey(binding: {
  table: string;
  column: string;
  rowId: string;
}): string {
  return `${binding.table}:${binding.column}:${binding.rowId}`;
}

function sqlIdentifier(value: string): Prisma.Sql {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) {
    throw new Error("静态文件绑定标识不合法");
  }
  return Prisma.raw(`"${value}"`);
}

/**
 * 中心注册表 + 收货照片 + 替换链的**行级**引用扫描。
 *
 * 对每个 `fileId ∈ fileIds`，返回其全部 `(table, column, rowId)` 引用，含：
 * - `NON_RECEIPT_FILE_BINDINGS` 注册表各行（文件正式绑定入口）
 * - `SpotProcurementReceiptPhoto` 的原图/水印图引用
 * - 替换链：`FileObject.supersedesFileObjectId` 的两侧
 *   - `supersedesFileObjectId`：fileId 是一个「替换者」（其自身指向被替换的旧文件）
 *   - `supersededByFileObject`：fileId 是「被替换者」，被某文件以 supersedesFileObjectId 引用
 */
export async function fileBusinessBindingRefs(
  tx: Prisma.TransactionClient,
  fileIds: string[]
): Promise<ResolvedFileBinding[]> {
  const uniqueIds = [...new Set(fileIds)].sort();
  if (!uniqueIds.length) {
    return [];
  }
  const candidates = Prisma.join(
    uniqueIds.map((fileId) => Prisma.sql`(${fileId})`)
  );
  const registryQueries = NON_RECEIPT_FILE_BINDINGS.flatMap(
    (binding) =>
      binding.columns.map((column) => {
        const tableId = sqlIdentifier(binding.table);
        const columnId = sqlIdentifier(column);
        const rowIdColumn =
          "rowIdColumn" in binding ? binding.rowIdColumn : "id"
        return Prisma.sql`
          SELECT x.${columnId} AS "fileId",
                 ${binding.table} AS "table",
                 ${column} AS "column",
                 to_jsonb(x) ->> ${rowIdColumn} AS "rowId"
          FROM ${tableId} x
          JOIN candidates c ON c."id" = x.${columnId}
        `;
      })
  );
  const rows = await tx.$queryRaw<ResolvedFileBinding[]>(
    Prisma.sql`
      /* file_binding_manifest_refs */
      WITH candidates("id") AS (VALUES ${candidates})
      SELECT bindings."fileId", bindings."table", bindings."column", bindings."rowId"
      FROM (
        ${Prisma.join(registryQueries, " UNION ALL ")}
        UNION ALL
        SELECT x."id", 'FileObject', 'supersedesFileObjectId', x."id"
        FROM "FileObject" x
        JOIN candidates c ON c."id" = x."id"
        WHERE x."supersedesFileObjectId" IS NOT NULL
        UNION ALL
        SELECT x."supersedesFileObjectId", 'FileObject', 'supersededByFileObject', x."id"
        FROM "FileObject" x
        JOIN candidates c ON c."id" = x."supersedesFileObjectId"
        UNION ALL
        SELECT x."originalFileId", 'SpotProcurementReceiptPhoto', 'originalFileId', x."id"
        FROM "SpotProcurementReceiptPhoto" x
        JOIN candidates c ON c."id" = x."originalFileId"
        UNION ALL
        SELECT x."watermarkedFileId", 'SpotProcurementReceiptPhoto', 'watermarkedFileId', x."id"
        FROM "SpotProcurementReceiptPhoto" x
        JOIN candidates c ON c."id" = x."watermarkedFileId"
      ) bindings
    `
  );
  return rows;
}

/**
 * 纯分类函数：给定某文件的全部引用，判定独占/共享。
 *
 * 规则：
 * - `ownedRefKeys` 命中的引用 = 目标自身绑定 → 内部，不构成共享。
 * - `FileObject.supersedesFileObjectId`（替换者指针）：永不构成共享——删除替换者
 *   不会让被替换的旧文件悬空（旧文件仍存在），该引用只是链内元数据。
 * - `FileObject.supersededByFileObject`：仅当引用它的替换者也在候选文件集内（链内）时
 *   才视为内部；否则外部替换者仍指向该文件 → 共享。
 * - 其余任何引用（注册表、收货照片、非链）只要不在 ownedRefKeys 内 → 外部 → 共享。
 */
export function classifyFileBinding(
  refs: readonly ResolvedFileBinding[],
  ownedRefKeys: ReadonlySet<string>,
  candidateFileIds: ReadonlySet<string>
): FileBindingClassification {
  const external = refs.filter((ref) => {
    if (ownedRefKeys.has(bindingKey(ref))) {
      return false;
    }
    if (ref.table === "FileObject" && ref.column === "supersedesFileObjectId") {
      return false;
    }
    if (ref.table === "FileObject" && ref.column === "supersededByFileObject") {
      return !candidateFileIds.has(ref.rowId);
    }
    return true;
  });
  if (!external.length) {
    return { bindingType: "exclusive" };
  }
  return {
    bindingType: "shared",
    sharedReason: external.map(bindingKey).join(",")
  };
}

/**
 * 解析「合同版本聚合」自身持有的文件绑定（行级）。
 *
 * 覆盖契约域内以 `contractVersionId` 为轴的所有文件绑定表，加上版本行自身的
 * `taxFactEvidenceFileId`。返回的 `rowId` 是该文件所在业务行的主键。
 */
const CONTRACT_VERSION_FILE_BINDINGS = [
  { table: "ContractDraftAttachment", column: "fileId", versionIdColumn: "contractVersionId" },
  { table: "ContractArchiveFile", column: "fileId", versionIdColumn: "contractVersionId" },
  { table: "ContractFormalFile", column: "fileId", versionIdColumn: "contractVersionId" },
  { table: "ContractGeneratedDocument", column: "docxFileId", versionIdColumn: "contractVersionId" },
  { table: "ContractGeneratedDocument", column: "pdfFileId", versionIdColumn: "contractVersionId" },
  { table: "ContractOfflineRevision", column: "fileId", versionIdColumn: "contractVersionId" },
  { table: "ContractOfflineRevision", column: "previewPdfFileId", versionIdColumn: "contractVersionId" },
  { table: "ContractAuthorization", column: "fileId", versionIdColumn: "originContractVersionId" },
  { table: "ContractBill", column: "sourceExcelFileId", versionIdColumn: "contractVersionId" },
  { table: "ContractBillImport", column: "fileId", versionIdColumn: "sourceContractVersionId" },
  { table: "ContractBillImport", column: "fileId", versionIdColumn: "targetContractVersionId" },
  { table: "ContractTaxFactRevision", column: "evidenceFileId", versionIdColumn: "contractVersionId" }
] as const;

export async function resolveContractVersionFileBindings(
  tx: Prisma.TransactionClient,
  contractVersionIds: string[]
): Promise<ResolvedFileBinding[]> {
  const uniqueIds = [...new Set(contractVersionIds)].sort();
  if (!uniqueIds.length) {
    return [];
  }
  const candidates = Prisma.join(
    uniqueIds.map((id) => Prisma.sql`(${id})`)
  );
  const tableQueries = CONTRACT_VERSION_FILE_BINDINGS.map(
    ({ table, column, versionIdColumn }) => {
      const tableId = sqlIdentifier(table);
      const columnId = sqlIdentifier(column);
      const versionIdColumnId = sqlIdentifier(versionIdColumn);
      return Prisma.sql`
        SELECT x.${columnId} AS "fileId",
               ${table} AS "table",
               ${column} AS "column",
               x."id" AS "rowId"
        FROM ${tableId} x
        JOIN candidates c ON c."id" = x.${versionIdColumnId}
      `;
    }
  );
  const rows = await tx.$queryRaw<ResolvedFileBinding[]>(
    Prisma.sql`
      /* file_binding_manifest_contract_versions */
      WITH candidates("id") AS (VALUES ${candidates})
      SELECT bindings."fileId", bindings."table", bindings."column", bindings."rowId"
      FROM (
        ${Prisma.join(tableQueries, " UNION ALL ")}
        UNION ALL
        SELECT x."taxFactEvidenceFileId", 'ContractVersion', 'taxFactEvidenceFileId', x."id"
        FROM "ContractVersion" x
        JOIN candidates c ON c."id" = x."id"
        WHERE x."taxFactEvidenceFileId" IS NOT NULL
      ) bindings
    `
  );
  return rows;
}

interface FileObjectLite {
  id: string;
  bucket: string;
  objectKey: string;
  storageStatus: string;
  contentSha256: string | null;
}

function physicalObjectKey(fileObject: Pick<FileObjectLite, "bucket" | "objectKey">): string {
  return `${fileObject.bucket}\u0000${fileObject.objectKey}`;
}

function dedupeBindings(
  bindings: readonly ResolvedFileBinding[]
): ResolvedFileBinding[] {
  const seen = new Set<string>();
  const result: ResolvedFileBinding[] = [];
  for (const binding of [...bindings].sort((left, right) =>
    bindingKey(left).localeCompare(bindingKey(right))
  )) {
    const key = bindingKey(binding);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(binding);
  }
  return result;
}

function deriveBlockedReason(
  fileObject: FileObjectLite | undefined,
  classification: FileBindingClassification
): string | undefined {
  if (classification.bindingType === "shared") {
    return "文件存在目标聚合之外的业务绑定（shared），永不执行对象删除";
  }
  if (!fileObject) {
    return "FileObject 记录缺失，无法定位对象键";
  }
  if (fileObject.storageStatus !== "active") {
    return `storageStatus=${fileObject.storageStatus}，非 active 文件不允许对象清理`;
  }
  if (!isValidObjectKey(fileObject.objectKey)) {
    return "对象键不是精确键，禁止作为清理范围";
  }
  return undefined;
}

function summarize(rows: readonly FileBindingManifestRow[]): CleanupManifestSummary {
  return {
    exclusiveCount: rows.filter(
      (row) => row.bindingType === "exclusive" && !row.blockedReason
    ).length,
    sharedCount: rows.filter((row) => row.bindingType === "shared").length,
    blockedCount: rows.filter((row) => Boolean(row.blockedReason)).length,
    totalObjectCount: rows.length
  };
}

/** 解析「合同版本聚合」自身持有的文件绑定，并构建精确文件绑定清单。 */
export async function buildContractFileBindingManifest(
  tx: Prisma.TransactionClient,
  target: CleanupTarget,
  storage?: VersionedObjectStorage
): Promise<CleanupManifest> {
  if (!target.contractVersionIds.length) {
    throw new Error("清理目标必须指定至少一个合同版本");
  }
  const applicationBindings = await resolveContractVersionFileBindings(
    tx,
    target.contractVersionIds
  );
  return buildFileBindingManifest({ tx, target, applicationBindings, storage });
}

/**
 * 通用清单构建：接受业务层已解析的目标绑定，逐候选文件完成
 * 候选闭包、行级引用扫描、独占/共享分类与可选的版本快照。
 */
export async function buildFileBindingManifest(
  input: FileBindingManifestInput
): Promise<CleanupManifest> {
  const { tx, target, storage } = input;
  const ownedBindings = dedupeBindings(input.applicationBindings);
  // 候选集 = 目标聚合自有的文件对象。替换链不把相邻外部文件纳入候选：
  // 链引用是否内部只取决于其 rowId 是否属于本候选集，逐文件直接判定即可。
  const candidateIds = [...new Set(ownedBindings.map((binding) => binding.fileId))].sort();
  const candidates = new Set(candidateIds);

  // 2. 行级引用全集 + 文件对象信息。
  const allRefs = await fileBusinessBindingRefs(tx, candidateIds);
  const refsByFile = new Map<string, ResolvedFileBinding[]>();
  for (const ref of allRefs) {
    const list = refsByFile.get(ref.fileId) ?? [];
    list.push(ref);
    refsByFile.set(ref.fileId, list);
  }
  const fileObjects = await tx.fileObject.findMany({
    where: { id: { in: candidateIds } },
    select: {
      id: true,
      bucket: true,
      objectKey: true,
      storageStatus: true,
      contentSha256: true
    }
  });
  const fileObjectById = new Map(
    fileObjects.map((fileObject) => [
      fileObject.id,
      fileObject as FileObjectLite
    ])
  );
  const physicalObjectRows = fileObjects.length
    ? await tx.fileObject.findMany({
        where: {
          OR: fileObjects.map(({ bucket, objectKey }) => ({ bucket, objectKey }))
        },
        select: { id: true, bucket: true, objectKey: true }
      })
    : [];
  const physicalObjectIdsByKey = new Map<string, string[]>();
  for (const physicalObject of physicalObjectRows) {
    const key = physicalObjectKey(physicalObject);
    const ids = physicalObjectIdsByKey.get(key) ?? [];
    ids.push(physicalObject.id);
    physicalObjectIdsByKey.set(key, ids);
  }
  const ownedRefKeys = new Set(ownedBindings.map(bindingKey));

  // 3. 组装清单行。
  const rows: FileBindingManifestRow[] = [];
  for (const fileId of candidateIds) {
    const fileObject = fileObjectById.get(fileId);
    const refs = refsByFile.get(fileId) ?? [];
    const baseClassification = classifyFileBinding(refs, ownedRefKeys, candidates);
    const physicalObjectSharedIds = fileObject
      ? (physicalObjectIdsByKey.get(physicalObjectKey(fileObject)) ?? []).filter(
          (physicalFileId) => !candidates.has(physicalFileId)
        )
      : [];
    const classification: FileBindingClassification = physicalObjectSharedIds.length
      ? {
          bindingType: "shared",
          sharedReason: [
            baseClassification.sharedReason,
            ...physicalObjectSharedIds.map(
              (physicalFileId) => `FileObject:physicalObject:${physicalFileId}`
            )
          ]
            .filter(Boolean)
            .join(",")
        }
      : baseClassification;
    const blockedReason = deriveBlockedReason(fileObject, classification);
    const row: FileBindingManifestRow = {
      fileId,
      bucket: fileObject?.bucket ?? "",
      objectKey: fileObject?.objectKey ?? "",
      storageStatus: fileObject?.storageStatus ?? "missing",
      contentSha256: fileObject?.contentSha256,
      businessBindings: refs.map(({ table, column, rowId }) => ({ table, column, rowId })),
      bindingType: classification.bindingType
    };
    if (classification.bindingType === "shared") {
      row.sharedReason = classification.sharedReason;
    }
    if (blockedReason) {
      row.blockedReason = blockedReason;
    }
    await augmentStorageSnapshot(row, storage);
    rows.push(row);
  }

  return {
    mode: "preview_only",
    executionAllowed: false,
    generatedAt: new Date().toISOString(),
    target,
    rows,
    summary: summarize(rows)
  };
}

async function augmentStorageSnapshot(
  row: FileBindingManifestRow,
  storage: VersionedObjectStorage | undefined
): Promise<void> {
  if (!storage || row.bindingType !== "exclusive" || row.blockedReason || !row.objectKey) {
    return;
  }
  try {
    const versions = await storage.listObjectVersions(row.objectKey);
    row.storageSnapshot = {
      versionCount: versions.filter((version) => !version.isDeleteMarker).length,
      deleteMarkerCount: versions.filter((version) => version.isDeleteMarker).length
    };
  } catch {
    row.versionEnumerationError = "版本枚举失败，无法确认对象当前状态";
  }
}
