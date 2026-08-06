import type { Prisma } from "@prisma/client";
import {
  buildFileBindingManifest,
  buildContractFileBindingManifest,
  classifyFileBinding,
  type FileBindingManifestRow,
  type ResolvedFileBinding
} from "./file-binding-manifest";
import { InMemoryVersionedObjectStorage } from "./versioned-object-storage";

function ref(
  table: string,
  column: string,
  rowId: string,
  fileId: string
): ResolvedFileBinding {
  return { table, column, rowId, fileId };
}

function ownedRef(table: string, column: string, rowId: string, fileId: string) {
  return ref(table, column, rowId, fileId);
}

function fileObjectLite(
  id: string,
  options: Partial<{ bucket: string; objectKey: string; storageStatus: string; contentSha256: string | null }> = {}
) {
  return {
    id,
    bucket: options.bucket ?? "private-bucket",
    objectKey: options.objectKey ?? `uploads/${id}.pdf`,
    storageStatus: options.storageStatus ?? "active",
    contentSha256: options.contentSha256 ?? null
  };
}

function fakeTx(options: {
  refs: ResolvedFileBinding[];
  fileObjects: ReturnType<typeof fileObjectLite>[];
}) {
  const $queryRaw = jest.fn().mockResolvedValue(options.refs);
  const findMany = jest.fn().mockResolvedValue(options.fileObjects);
  const tx = {
    $queryRaw,
    fileObject: { findMany }
  } as unknown as Prisma.TransactionClient;
  return { tx, $queryRaw, findMany };
}

function ownedKeyOf(manifest: { rows: FileBindingManifestRow[] }, fileId: string) {
  return manifest.rows.find((row) => row.fileId === fileId);
}

describe("classifyFileBinding", () => {
  const owned = new Set(["file-a"]);
  const ownedKeys = new Set(["ContractFormalFile:fileId:formal-1"]);

  it("treats a file whose only refs are owned bindings as exclusive", () => {
    const result = classifyFileBinding(
      [ref("ContractFormalFile", "fileId", "formal-1", "file-a")],
      ownedKeys,
      owned
    );
    expect(result).toEqual({ bindingType: "exclusive" });
  });

  it("marks a file shared when any registry table outside the target references it", () => {
    const result = classifyFileBinding(
      [
        ref("ContractFormalFile", "fileId", "formal-1", "file-a"),
        ref("SettlementLineAttachment", "fileId", "settlement-1", "file-a")
      ],
      ownedKeys,
      owned
    );
    expect(result.bindingType).toBe("shared");
    expect(result.sharedReason).toBe("SettlementLineAttachment:fileId:settlement-1");
  });

  it("marks a file shared when a receipt photo references it", () => {
    const result = classifyFileBinding(
      [ref("SpotProcurementReceiptPhoto", "originalFileId", "photo-1", "file-a")],
      ownedKeys,
      owned
    );
    expect(result.bindingType).toBe("shared");
  });

  it("never treats the supersede-pointer ref as shared", () => {
    const result = classifyFileBinding(
      [
        ref("ContractArchiveFile", "fileId", "archive-1", "file-a"),
        // file-a 是替换者，其自身指向旧文件；不构成外部依赖。
        ref("FileObject", "supersedesFileObjectId", "file-a", "file-a")
      ],
      new Set(["ContractArchiveFile:fileId:archive-1"]),
      owned
    );
    expect(result.bindingType).toBe("exclusive");
  });

  it("treats a superseded-by ref as internal when the superseder is a candidate", () => {
    const candidates = new Set(["file-a", "file-b"]);
    const result = classifyFileBinding(
      [
        ref("ContractArchiveFile", "fileId", "archive-1", "file-a"),
        // file-b 也在候选集内（链内替换），因此 file-a 被内部文件替换。
        ref("FileObject", "supersededByFileObject", "file-b", "file-a")
      ],
      new Set(["ContractArchiveFile:fileId:archive-1"]),
      candidates
    );
    expect(result.bindingType).toBe("exclusive");
  });

  it("marks a file shared when an external superseder points at it", () => {
    const result = classifyFileBinding(
      [
        ref("ContractArchiveFile", "fileId", "archive-1", "file-a"),
        // file-x 不在候选集内：外部文件仍把 file-a 作为替换基础。
        ref("FileObject", "supersededByFileObject", "file-x", "file-a")
      ],
      ownedKeys,
      owned
    );
    expect(result.bindingType).toBe("shared");
    expect(result.sharedReason).toContain("FileObject:supersededByFileObject:file-x");
  });
});

describe("buildFileBindingManifest", () => {
  it("produces a preview-only manifest with a single exclusive candidate", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const { tx } = fakeTx({
      refs: [...applicationBindings],
      fileObjects: [fileObjectLite("file-a", { contentSha256: "sha-1" })]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    expect(manifest.mode).toBe("preview_only");
    expect(manifest.executionAllowed).toBe(false);
    expect(manifest.target).toEqual({ contractVersionIds: ["v1"] });
    expect(manifest.rows).toHaveLength(1);
    const row = manifest.rows[0];
    expect(row).toMatchObject({
      fileId: "file-a",
      objectKey: "uploads/file-a.pdf",
      storageStatus: "active",
      contentSha256: "sha-1",
      bindingType: "exclusive"
    });
    expect(row.blockedReason).toBeUndefined();
    expect(row.businessBindings).toEqual([{ table: "ContractFormalFile", column: "fileId", rowId: "formal-1" }]);
    expect(manifest.summary).toEqual({ exclusiveCount: 1, sharedCount: 0, blockedCount: 0, totalObjectCount: 1 });
  });

  it("flags a file shared when an external settlement binding references it", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const external = ref("SettlementLineAttachment", "fileId", "settlement-9", "file-a");
    const { tx } = fakeTx({
      refs: [...applicationBindings, external],
      fileObjects: [fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    const row = manifest.rows[0];
    expect(row.bindingType).toBe("shared");
    expect(row.blockedReason).toMatch(/永不执行对象删除/);
    expect(row.sharedReason).toBe("SettlementLineAttachment:fileId:settlement-9");
    expect(manifest.summary).toEqual({ exclusiveCount: 0, sharedCount: 1, blockedCount: 1, totalObjectCount: 1 });
  });

  it("flags a file shared when a receipt photo references it", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const { tx } = fakeTx({
      refs: [
        ...applicationBindings,
        ref("SpotProcurementReceiptPhoto", "watermarkedFileId", "photo-3", "file-a")
      ],
      fileObjects: [fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });
    expect(manifest.rows[0].bindingType).toBe("shared");
  });

  it("keeps an internal replacement chain exclusive and out of shared", async () => {
    // file-b 替换 file-a，两者都属于目标聚合。
    const applicationBindings = [
      ownedRef("ContractArchiveFile", "fileId", "archive-b", "file-b"),
      ownedRef("ContractArchiveFile", "fileId", "archive-a", "file-a")
    ];
    const { tx } = fakeTx({
      refs: [
        ...applicationBindings,
        ref("FileObject", "supersedesFileObjectId", "file-b", "file-b"),
        ref("FileObject", "supersededByFileObject", "file-b", "file-a")
      ],
      fileObjects: [fileObjectLite("file-b"), fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    expect(ownedKeyOf(manifest, "file-b")?.bindingType).toBe("exclusive");
    expect(ownedKeyOf(manifest, "file-a")?.bindingType).toBe("exclusive");
    expect(manifest.summary.exclusiveCount).toBe(2);
  });

  it("marks a file shared when an external file supersedes it, without listing the external file", async () => {
    const applicationBindings = [ownedRef("ContractArchiveFile", "fileId", "archive-a", "file-a")];
    const { tx } = fakeTx({
      refs: [
        ...applicationBindings,
        ref("FileObject", "supersededByFileObject", "file-x", "file-a")
      ],
      fileObjects: [fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    expect(manifest.rows).toHaveLength(1);
    expect(manifest.rows[0].fileId).toBe("file-a");
    expect(manifest.rows[0].bindingType).toBe("shared");
  });

  it("blocks a file whose storage status is not active", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const { tx } = fakeTx({
      refs: [...applicationBindings],
      fileObjects: [fileObjectLite("file-a", { storageStatus: "deleting" })]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    expect(manifest.rows[0].bindingType).toBe("exclusive");
    expect(manifest.rows[0].blockedReason).toMatch(/非 active/);
    expect(manifest.summary).toEqual({ exclusiveCount: 0, sharedCount: 0, blockedCount: 1, totalObjectCount: 1 });
  });

  it("blocks a file whose FileObject record is missing", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-missing")];
    const { tx } = fakeTx({ refs: [...applicationBindings], fileObjects: [] });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    expect(manifest.rows[0]).toMatchObject({
      fileId: "file-missing",
      storageStatus: "missing",
      bindingType: "exclusive"
    });
    expect(manifest.rows[0].blockedReason).toMatch(/FileObject 记录缺失/);
  });

  it("blocks a prefix-like object key", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const { tx } = fakeTx({
      refs: [...applicationBindings],
      fileObjects: [fileObjectLite("file-a", { objectKey: "uploads/" })]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings
    });

    expect(manifest.rows[0].bindingType).toBe("exclusive");
    expect(manifest.rows[0].blockedReason).toMatch(/不是精确键/);
    expect(manifest.rows[0].storageSnapshot).toBeUndefined();
  });

  it("augments exclusive candidates with a version snapshot when storage is provided", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const storage = new InMemoryVersionedObjectStorage();
    storage.seed("uploads/file-a.pdf", [
      { versionId: "v1", isLatest: false, sizeBytes: 10 },
      { versionId: "v2", isLatest: true, sizeBytes: 12 },
      { versionId: "m1", isDeleteMarker: true, isLatest: false }
    ]);
    const { tx } = fakeTx({
      refs: [...applicationBindings],
      fileObjects: [fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings,
      storage
    });

    expect(manifest.rows[0].storageSnapshot).toEqual({ versionCount: 2, deleteMarkerCount: 1 });
    expect(manifest.rows[0].versionEnumerationError).toBeUndefined();
  });

  it("records an enumeration error without failing the manifest", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const storage = new InMemoryVersionedObjectStorage();
    storage.seed("uploads/file-a.pdf", [{ versionId: "v1", isLatest: true }]);
    storage.simulateNextListFailure();
    const { tx } = fakeTx({
      refs: [...applicationBindings],
      fileObjects: [fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings,
      storage
    });

    expect(manifest.rows[0].bindingType).toBe("exclusive");
    expect(manifest.rows[0].versionEnumerationError).toMatch(/版本枚举失败/);
    expect(manifest.summary.exclusiveCount).toBe(1);
  });

  it("does not query storage for shared files", async () => {
    const applicationBindings = [ownedRef("ContractFormalFile", "fileId", "formal-1", "file-a")];
    const storage = new InMemoryVersionedObjectStorage();
    const { tx } = fakeTx({
      refs: [...applicationBindings, ref("SettlementLineAttachment", "fileId", "s-1", "file-a")],
      fileObjects: [fileObjectLite("file-a")]
    });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings,
      storage
    });
    expect(manifest.rows[0].storageSnapshot).toBeUndefined();
    expect(manifest.rows[0].blockedReason).toMatch(/永不执行对象删除/);
  });

  it("returns an empty manifest when the target owns no files", async () => {
    const { tx } = fakeTx({ refs: [], fileObjects: [] });
    const manifest = await buildFileBindingManifest({
      tx,
      target: { contractVersionIds: ["v1"] },
      applicationBindings: []
    });
    expect(manifest.rows).toEqual([]);
    expect(manifest.summary.totalObjectCount).toBe(0);
  });
});

describe("buildContractFileBindingManifest", () => {
  it("resolves the version's owned bindings and builds the manifest", async () => {
    const owned = [ownedRef("ContractDraftAttachment", "fileId", "draft-1", "file-a")];
    const $queryRaw = jest
      .fn()
      .mockResolvedValueOnce(owned) // resolveContractVersionFileBindings
      .mockResolvedValueOnce(owned); // fileBusinessBindingRefs
    const findMany = jest.fn().mockResolvedValue([fileObjectLite("file-a")]);
    const tx = {
      $queryRaw,
      fileObject: { findMany }
    } as unknown as Prisma.TransactionClient;

    const manifest = await buildContractFileBindingManifest(tx, { contractVersionIds: ["v1"] });

    expect($queryRaw).toHaveBeenCalledTimes(2);
    expect(manifest.rows).toHaveLength(1);
    expect(manifest.rows[0]).toMatchObject({ fileId: "file-a", bindingType: "exclusive" });
    expect(manifest.rows[0].businessBindings).toEqual([
      { table: "ContractDraftAttachment", column: "fileId", rowId: "draft-1" }
    ]);
  });

  it("rejects an empty target", async () => {
    const { tx } = fakeTx({ refs: [], fileObjects: [] });
    await expect(
      buildContractFileBindingManifest(tx, { contractVersionIds: [] })
    ).rejects.toThrow(/至少一个合同版本/);
  });
});
