import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService, PrivateFileStorage } from "./file.service";

const STORAGE_ENV_KEYS = [
  "FILE_STORAGE_DRIVER",
  "FILE_STORAGE_ROOT",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_BUCKET",
  "COS_REGION"
] as const;

function snapshotStorageEnv() {
  return Object.fromEntries(STORAGE_ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
    (typeof STORAGE_ENV_KEYS)[number],
    string | undefined
  >;
}

function restoreStorageEnv(snapshot: ReturnType<typeof snapshotStorageEnv>) {
  STORAGE_ENV_KEYS.forEach((key) => {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}

function configureCosStorage() {
  process.env.FILE_STORAGE_DRIVER = "cos";
  process.env.COS_SECRET_ID = "secret-id";
  process.env.COS_SECRET_KEY = "secret-key";
  process.env.COS_BUCKET = "private-bucket";
  process.env.COS_REGION = "ap-guangzhou";
}

describe("FileService", () => {
  const audit = {
    record: jest.fn()
  };
  const storage = {
    write: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
    bucketName: jest.fn()
  };

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    audit.record.mockReset();
    storage.write.mockReset();
    storage.read.mockReset();
    storage.delete.mockReset();
    storage.bucketName.mockReset();
    storage.bucketName.mockReturnValue("private-local");
  });

  it("允许已确认的全局岗位跨项目下载，但仍由外层票据保留密码、原因和审计", async () => {
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const businessLookup = jest.fn();
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "global-finance", positionId: "position-finance", projectId: null }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-finance", key: "finance_staff" }
        ])
      },
      projectOwnerContract: { findFirst: businessLookup }
    };

    await expect(
      (
        service as unknown as {
          assertCanDownloadFileObject(
            client: unknown,
            file: { id: string },
            actorUserId: string
          ): Promise<void>;
        }
      ).assertCanDownloadFileObject(tx, { id: "file-other-project" }, "global-finance")
    ).resolves.toBeUndefined();
    expect(businessLookup).not.toHaveBeenCalled();
  });

  it("fails closed outside test when file download secret is missing", () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      secret: process.env.FILE_DOWNLOAD_SECRET
    };
    process.env.NODE_ENV = "development";
    delete process.env.FILE_DOWNLOAD_SECRET;

    try {
      expect(
        () =>
          new FileService(
            {} as PrismaService,
            audit as unknown as AuditService,
            storage as unknown as PrivateFileStorage
          )
      ).toThrow("FILE_DOWNLOAD_SECRET");
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      if (previous.secret === undefined) delete process.env.FILE_DOWNLOAD_SECRET;
      else process.env.FILE_DOWNLOAD_SECRET = previous.secret;
    }
  });

  it("rejects private storage object keys outside the configured root", async () => {
    const previousRoot = process.env.FILE_STORAGE_ROOT;
    process.env.FILE_STORAGE_ROOT = "/private/tmp/private-root";

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("../private-root-evil/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
    } finally {
      if (previousRoot === undefined) {
        delete process.env.FILE_STORAGE_ROOT;
      } else {
        process.env.FILE_STORAGE_ROOT = previousRoot;
      }
    }
  });

  it("deletes local private files and treats a missing object as success", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = join(temporaryRoot, "private");

    try {
      const privateStorage = new PrivateFileStorage();
      expect(() => privateStorage.onModuleInit()).not.toThrow();
      await privateStorage.write("uploads/file.pdf", Buffer.from("private-file"));
      await expect(privateStorage.read("uploads/file.pdf")).resolves.toEqual(
        Buffer.from("private-file")
      );

      await privateStorage.write("uploads/file.pdf", Buffer.from("updated-private-file"));
      await expect(privateStorage.read("uploads/file.pdf")).resolves.toEqual(
        Buffer.from("updated-private-file")
      );

      await expect(privateStorage.delete("uploads/file.pdf")).resolves.toBeUndefined();
      await expect(readFile(join(temporaryRoot, "private/uploads/file.pdf"))).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(privateStorage.delete("uploads/file.pdf")).resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects a local read through an intermediate symlink outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideRoot = join(temporaryRoot, "outside");
    const outsideFile = join(outsideRoot, "file.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideRoot, join(privateRoot, "uploads"), "dir");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects reading a target symlink that points outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads"), { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideFile, join(privateRoot, "uploads/file.pdf"), "file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.read("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects a local write through an intermediate symlink without creating outside files", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideRoot = join(temporaryRoot, "outside");
    const outsideTarget = join(outsideRoot, "nested/file.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, join(privateRoot, "uploads"), "dir");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(
        privateStorage.write("uploads/nested/file.pdf", Buffer.from("private-file"))
      ).rejects.toThrow("私有文件路径无效，系统已阻止本次文件读取。");
      await expect(readFile(outsideTarget)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects writing a target symlink without modifying its outside target", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads"), { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideFile, join(privateRoot, "uploads/file.pdf"), "file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(
        privateStorage.write("uploads/file.pdf", Buffer.from("private-file"))
      ).rejects.toThrow("私有文件路径无效，系统已阻止本次文件读取。");
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("uses fixed messages for missing reads and local filesystem write failures", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads/folder.pdf"), { recursive: true });

    try {
      const privateStorage = new PrivateFileStorage();
      const readError = await privateStorage.read("uploads/missing.pdf").catch((reason) => reason);
      const writeError = await privateStorage
        .write("uploads/folder.pdf", Buffer.from("private-file"))
        .catch((reason) => reason);

      expect(readError).toEqual(expect.objectContaining({ message: "本地文件读取失败" }));
      expect(writeError).toEqual(expect.objectContaining({ message: "本地文件写入失败" }));
      expect(String((readError as { message?: unknown }).message)).not.toContain(temporaryRoot);
      expect(String((writeError as { message?: unknown }).message)).not.toContain(temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects an unsafe COS delete key before making a network request", async () => {
    const previous = snapshotStorageEnv();
    process.env.FILE_STORAGE_DRIVER = "cos";
    const fetchMock = jest.spyOn(globalThis, "fetch");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("../outside.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("rejects an out-of-root delete without touching the outside file", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = join(temporaryRoot, "private");
    await writeFile(outsideFile, "outside-file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("../outside.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects a local delete through an intermediate symlink outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideRoot = join(temporaryRoot, "outside");
    const outsideFile = join(outsideRoot, "file.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideRoot, join(privateRoot, "uploads"), "dir");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("rejects deleting a target symlink that points outside the root", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    const outsideFile = join(temporaryRoot, "outside.pdf");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads"), { recursive: true });
    await writeFile(outsideFile, "outside-file");
    await symlink(outsideFile, join(privateRoot, "uploads/file.pdf"), "file");

    try {
      const privateStorage = new PrivateFileStorage();

      await expect(privateStorage.delete("uploads/file.pdf")).rejects.toThrow(
        "私有文件路径无效，系统已阻止本次文件读取。"
      );
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-file");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("hides local paths when canonical path validation fails", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(privateRoot, { recursive: true });
    await symlink("loop-b", join(privateRoot, "loop-a"));
    await symlink("loop-a", join(privateRoot, "loop-b"));

    try {
      const privateStorage = new PrivateFileStorage();
      const error = await privateStorage.delete("loop-a/file.pdf").catch((reason) => reason);

      expect(error).toEqual(
        expect.objectContaining({ message: "本地文件存储路径校验失败" })
      );
      expect(String((error as { message?: unknown }).message)).not.toContain(temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it("hides local paths when deleting an existing directory fails", async () => {
    const previous = snapshotStorageEnv();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "jiangkong-private-storage-"));
    const privateRoot = join(temporaryRoot, "private");
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = privateRoot;
    await mkdir(join(privateRoot, "uploads/folder"), { recursive: true });

    try {
      const privateStorage = new PrivateFileStorage();
      const error = await privateStorage.delete("uploads/folder").catch((reason) => reason);

      expect(error).toEqual(expect.objectContaining({ message: "本地文件删除失败" }));
      expect(String((error as { message?: unknown }).message)).not.toContain(temporaryRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
      restoreStorageEnv(previous);
    }
  });

  it.each([204, 299, 404])(
    "deletes a private COS object idempotently when COS returns %s",
    async (status) => {
      const previous = snapshotStorageEnv();
      configureCosStorage();
      const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: async () => new ArrayBuffer(0)
      } as Response);
      const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

      try {
        const privateStorage = new PrivateFileStorage();

        await expect(privateStorage.delete("uploads/合同.pdf")).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledWith(
          "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
          expect.objectContaining({
            method: "DELETE",
            headers: expect.objectContaining({
              Host: "private-bucket.cos.ap-guangzhou.myqcloud.com",
              Authorization:
                "q-sign-algorithm=sha1&q-ak=secret-id&q-sign-time=1700000000;1700000600" +
                "&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=" +
                "&q-signature=02badb510ed63c81d6977c447ee4631fdf0a2e00"
            })
          })
        );
      } finally {
        dateNowMock.mockRestore();
        fetchMock.mockRestore();
        restoreStorageEnv(previous);
      }
    }
  );

  it("uses a safe business message when COS delete fails", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);

    try {
      const privateStorage = new PrivateFileStorage();
      const action = privateStorage.delete("uploads/file.pdf");

      await expect(action).rejects.toThrow("私有文件从对象存储删除失败，请稍后重试或联系管理员");
      await expect(action).rejects.not.toThrow("secret-key");
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it.each(["COS_BUCKET", "COS_REGION", "COS_SECRET_ID", "COS_SECRET_KEY"] as const)(
    "fails storage startup when %s is missing without exposing configured values",
    (missingKey) => {
      const previous = snapshotStorageEnv();
      configureCosStorage();
      process.env.COS_SECRET_ID = "configured-secret-id";
      process.env.COS_SECRET_KEY = "configured-secret-key";
      process.env.COS_BUCKET = "configured-private-bucket";
      delete process.env[missingKey];

      try {
        const privateStorage = new PrivateFileStorage();
        expect(() => privateStorage.onModuleInit()).toThrow(missingKey);
        let errorMessage = "";
        try {
          privateStorage.assertConfigured();
        } catch (error) {
          errorMessage = String(error);
        }
        expect(errorMessage).toContain(missingKey);
        expect(errorMessage).not.toContain("configured-secret-id");
        expect(errorMessage).not.toContain("configured-secret-key");
        expect(errorMessage).not.toContain("configured-private-bucket");
      } finally {
        restoreStorageEnv(previous);
      }
    }
  );

  it("validates complete COS configuration at startup without contacting COS", () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch");

    try {
      const privateStorage = new PrivateFileStorage();

      expect(() => privateStorage.onModuleInit()).not.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it.each(["", "   ", "/", "."])(
    "rejects an unsafe local storage root %j without touching the filesystem",
    (root) => {
      const previous = snapshotStorageEnv();
      process.env.FILE_STORAGE_DRIVER = "local";
      process.env.FILE_STORAGE_ROOT = root;

      try {
        const privateStorage = new PrivateFileStorage();

        expect(() => privateStorage.onModuleInit()).toThrow("FILE_STORAGE_ROOT");
      } finally {
        restoreStorageEnv(previous);
      }
    }
  );

  it("accepts the default local storage root without creating it during startup", () => {
    const previous = snapshotStorageEnv();
    process.env.FILE_STORAGE_DRIVER = "local";
    delete process.env.FILE_STORAGE_ROOT;

    try {
      const privateStorage = new PrivateFileStorage();

      expect(() => privateStorage.onModuleInit()).not.toThrow();
    } finally {
      restoreStorageEnv(previous);
    }
  });

  it("stores and reads private files from COS when enabled", async () => {
    const previous = {
      driver: process.env.FILE_STORAGE_DRIVER,
      secretId: process.env.COS_SECRET_ID,
      secretKey: process.env.COS_SECRET_KEY,
      bucket: process.env.COS_BUCKET,
      region: process.env.COS_REGION
    };
    process.env.FILE_STORAGE_DRIVER = "cos";
    process.env.COS_SECRET_ID = "secret-id";
    process.env.COS_SECRET_KEY = "secret-key";
    process.env.COS_BUCKET = "private-bucket";
    process.env.COS_REGION = "ap-guangzhou";
    const responseBody = Uint8Array.from(Buffer.from("cos-file"));
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => responseBody.buffer
    } as Response);
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    try {
      const privateStorage = new PrivateFileStorage();

      await privateStorage.write("uploads/合同.pdf", Buffer.from("private-file"));
      const buffer = await privateStorage.read("uploads/合同.pdf");

      expect(privateStorage.bucketName()).toBe("private-bucket");
      expect(buffer).toEqual(Buffer.from("cos-file"));
      expect(fetchMock).toHaveBeenCalledWith(
        "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Host: "private-bucket.cos.ap-guangzhou.myqcloud.com",
            Authorization: expect.stringContaining("q-ak=secret-id")
          }),
          body: new Uint8Array(Buffer.from("private-file"))
        })
      );
      expect(fetchMock).toHaveBeenLastCalledWith(
        "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization:
              "q-sign-algorithm=sha1&q-ak=secret-id&q-sign-time=1700000000;1700000600" +
              "&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=" +
              "&q-signature=a69c3d8d01bd4da652ef8cb81548968625404997"
          })
        })
      );
    } finally {
      dateNowMock.mockRestore();
      fetchMock.mockRestore();
      if (previous.driver === undefined) delete process.env.FILE_STORAGE_DRIVER;
      else process.env.FILE_STORAGE_DRIVER = previous.driver;
      if (previous.secretId === undefined) delete process.env.COS_SECRET_ID;
      else process.env.COS_SECRET_ID = previous.secretId;
      if (previous.secretKey === undefined) delete process.env.COS_SECRET_KEY;
      else process.env.COS_SECRET_KEY = previous.secretKey;
      if (previous.bucket === undefined) delete process.env.COS_BUCKET;
      else process.env.COS_BUCKET = previous.bucket;
      if (previous.region === undefined) delete process.env.COS_REGION;
      else process.env.COS_REGION = previous.region;
    }
  });

  it("signs the raw Chinese COS path while requesting its encoded URL", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    try {
      const privateStorage = new PrivateFileStorage();

      await privateStorage.write("uploads/合同.pdf", Buffer.from("private-file"));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://private-bucket.cos.ap-guangzhou.myqcloud.com/uploads/%E5%90%88%E5%90%8C.pdf",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization:
              "q-sign-algorithm=sha1&q-ak=secret-id&q-sign-time=1700000000;1700000600" +
              "&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=" +
              "&q-signature=b539aea8053cb66374f9dae1a857588422bf97af"
          })
        })
      );
    } finally {
      dateNowMock.mockRestore();
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("logs sanitized COS diagnostics without exposing credentials or file names", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const objectKey = "uploads/历史接管合同.pdf";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          "<Error>",
          "<Code>SignatureDoesNotMatch</Code>",
          "<Message>敏感上游错误细节</Message>",
          "<RequestId>NjY4OGQ1YjRfMTIzNDU2Nw==</RequestId>",
          "</Error>"
        ].join(""),
        { status: 403 }
      )
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    try {
      const privateStorage = new PrivateFileStorage();
      const action = privateStorage.write(objectKey, Buffer.from("private-file"));

      await expect(action).rejects.toThrow(
        "私有文件上传到对象存储失败，请稍后重试或联系管理员"
      );
      expect(loggerError).toHaveBeenCalledWith({
        event: "private_file_cos_request_failed",
        operation: "上传",
        statusCode: 403,
        cosErrorCode: "SignatureDoesNotMatch",
        cosRequestId: "NjY4OGQ1YjRfMTIzNDU2Nw==",
        objectKeyFingerprint: createHash("sha256").update(objectKey).digest("hex").slice(0, 16)
      });

      const loggedOutput = JSON.stringify(loggerError.mock.calls);
      expect(loggedOutput).not.toContain(objectKey);
      expect(loggedOutput).not.toContain("secret-id");
      expect(loggedOutput).not.toContain("secret-key");
      expect(loggedOutput).not.toContain("敏感上游错误细节");
    } finally {
      loggerError.mockRestore();
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("keeps COS transport failures observable without logging the upstream error", async () => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const objectKey = "uploads/历史接管合同.pdf";
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error(`socket failure: secret-key ${objectKey}`));
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    try {
      const privateStorage = new PrivateFileStorage();
      const action = privateStorage.read(objectKey);

      await expect(action).rejects.toThrow(
        "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"
      );
      expect(loggerError).toHaveBeenCalledWith({
        event: "private_file_cos_request_failed",
        operation: "读取",
        failureType: "传输失败",
        objectKeyFingerprint: createHash("sha256").update(objectKey).digest("hex").slice(0, 16)
      });

      const loggedOutput = JSON.stringify(loggerError.mock.calls);
      expect(loggedOutput).not.toContain(objectKey);
      expect(loggedOutput).not.toContain("secret-key");
      expect(loggedOutput).not.toContain("socket failure");
    } finally {
      loggerError.mockRestore();
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it.each([
    ["PUT", "私有文件上传到对象存储失败，请稍后重试或联系管理员"],
    ["GET", "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"]
  ] as const)("uses a business message when COS %s fails", async (method, message) => {
    const previous = {
      driver: process.env.FILE_STORAGE_DRIVER,
      secretId: process.env.COS_SECRET_ID,
      secretKey: process.env.COS_SECRET_KEY,
      bucket: process.env.COS_BUCKET,
      region: process.env.COS_REGION
    };
    process.env.FILE_STORAGE_DRIVER = "cos";
    process.env.COS_SECRET_ID = "secret-id";
    process.env.COS_SECRET_KEY = "secret-key";
    process.env.COS_BUCKET = "private-bucket";
    process.env.COS_REGION = "ap-guangzhou";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);

    try {
      const privateStorage = new PrivateFileStorage();
      const action =
        method === "PUT"
          ? privateStorage.write("uploads/合同.pdf", Buffer.from("private-file"))
          : privateStorage.read("uploads/合同.pdf");

      await expect(action).rejects.toThrow(message);
    } finally {
      fetchMock.mockRestore();
      if (previous.driver === undefined) delete process.env.FILE_STORAGE_DRIVER;
      else process.env.FILE_STORAGE_DRIVER = previous.driver;
      if (previous.secretId === undefined) delete process.env.COS_SECRET_ID;
      else process.env.COS_SECRET_ID = previous.secretId;
      if (previous.secretKey === undefined) delete process.env.COS_SECRET_KEY;
      else process.env.COS_SECRET_KEY = previous.secretKey;
      if (previous.bucket === undefined) delete process.env.COS_BUCKET;
      else process.env.COS_BUCKET = previous.bucket;
      if (previous.region === undefined) delete process.env.COS_REGION;
      else process.env.COS_REGION = previous.region;
    }
  });

  it.each([
    ["PUT", "私有文件上传到对象存储失败，请稍后重试或联系管理员"],
    ["GET", "资料文件暂时无法从对象存储读取，请稍后重试或联系管理员"]
  ] as const)("does not treat a COS %s 404 as success", async (method, message) => {
    const previous = snapshotStorageEnv();
    configureCosStorage();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as Response);

    try {
      const privateStorage = new PrivateFileStorage();
      const action =
        method === "PUT"
          ? privateStorage.write("uploads/file.pdf", Buffer.from("private-file"))
          : privateStorage.read("uploads/file.pdf");

      await expect(action).rejects.toThrow(message);
    } finally {
      fetchMock.mockRestore();
      restoreStorageEnv(previous);
    }
  });

  it("stores a private upload and records a file object with audit log", async () => {
    const buffer = Buffer.from("private-file");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "private/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = await service.uploadPrivateFile({
      originalName: "盖章合同.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer
    });

    expect(result.id).toBe("file-1");
    expect(storage.write).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\/[a-f0-9-]+-盖章合同\.pdf$/),
      buffer
    );
    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bucket: "private-local",
        objectKey: expect.stringMatching(/^uploads\/[a-f0-9-]+-盖章合同\.pdf$/),
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        contentSha256,
        storageStatus: "active",
        supersedesFileObjectId: null
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-staff-1",
      action: "file.upload",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        bucket: "private-local",
        objectKey: "private/file-1.pdf",
        originalName: "盖章合同.pdf",
        sizeBytes: 12
      }
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it.each(["file object creation", "upload audit"] as const)(
    "deletes the written object once and rethrows the original transaction error when %s fails",
    async (failureStage) => {
      const transactionError = Object.assign(new Error(`transaction failed at ${failureStage}`), {
        name: "PrismaClientKnownRequestError",
        code: "P2002"
      });
      const tx = {
        fileObject: {
          create: jest.fn()
        }
      };
      if (failureStage === "file object creation") {
        tx.fileObject.create.mockRejectedValue(transactionError as never);
        audit.record.mockResolvedValue(undefined);
      } else {
        tx.fileObject.create.mockResolvedValue({
          id: "file-transaction-failure",
          bucket: "private-local",
          objectKey: "uploads/file-transaction-failure.pdf",
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        } as never);
        audit.record.mockRejectedValue(transactionError);
      }
      const prisma = {
        $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx)
        )
      } as unknown as PrismaService;
      const service = new FileService(
        prisma,
        audit as unknown as AuditService,
        storage as unknown as PrivateFileStorage
      );

      let thrown: unknown;
      try {
        await service.uploadPrivateFile({
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("private-file")
        });
      } catch (error) {
        thrown = error;
      }

      const objectKey = storage.write.mock.calls[0]?.[0] as string;
      expect(objectKey).toMatch(/^uploads\/[a-f0-9-]+-合同附件\.pdf$/);
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(objectKey);
      expect(thrown).toBe(transactionError);
      expect((thrown as Error).name).toBe("PrismaClientKnownRequestError");
      expect((thrown as Error & { code: string }).code).toBe("P2002");
    }
  );

  it("logs only safe failure facts and returns a fixed 500 when orphan cleanup also fails", async () => {
    const transactionError = Object.assign(
      new Error("database failed Authorization=Bearer db-secret"),
      {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
        secret: "db-secret",
        buffer: Buffer.from("db-buffer-secret")
      }
    );
    const cleanupError = Object.assign(
      new Error("COS delete failed Authorization=Bearer cos-secret"),
      {
        name: "CosDeleteError",
        code: "COS_DELETE_FAILED",
        Authorization: "Bearer cos-secret",
        buffer: Buffer.from("cos-buffer-secret")
      }
    );
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(transactionError)
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.delete.mockRejectedValue(cleanupError);

    try {
      let thrown: unknown;
      try {
        await service.uploadPrivateFile({
          originalName: "敏感合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("private-file")
        });
      } catch (error) {
        thrown = error;
      }

      const objectKey = storage.write.mock.calls[0]?.[0] as string;
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(objectKey);
      expect(loggerError).toHaveBeenCalledTimes(1);

      const logged = JSON.stringify(loggerError.mock.calls);
      expect(logged).toContain(objectKey);
      expect(logged).toContain("database_transaction");
      expect(logged).toContain("orphan_cleanup");
      expect(logged).toContain("PrismaClientKnownRequestError");
      expect(logged).toContain("P2002");
      expect(logged).toContain("CosDeleteError");
      expect(logged).toContain("COS_DELETE_FAILED");
      expect(logged).not.toContain("db-secret");
      expect(logged).not.toContain("cos-secret");
      expect(logged).not.toContain("db-buffer-secret");
      expect(logged).not.toContain("cos-buffer-secret");
      expect(logged).not.toContain("Authorization");

      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      expect((thrown as InternalServerErrorException).getStatus()).toBe(500);
      expect((thrown as InternalServerErrorException).message).toBe(
        "文件登记失败且存储清理未完成"
      );
      const publicFailure = JSON.stringify(thrown);
      expect(publicFailure).not.toContain(objectKey);
      expect(publicFailure).not.toContain("db-secret");
      expect(publicFailure).not.toContain("cos-secret");
      expect(publicFailure).not.toContain("敏感合同附件.pdf");
    } finally {
      loggerError.mockRestore();
    }
  });

  it("does not delete an object when the storage write itself fails", async () => {
    const storageError = new Error("storage write failed");
    storage.write.mockRejectedValue(storageError);
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.uploadPrivateFile({
        originalName: "合同附件.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("private-file")
      })
    ).rejects.toBe(storageError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("ignores a forged replacement pointer during upload so linking only happens through the replacement helper", async () => {
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-new",
          bucket: "private-local",
          objectKey: "uploads/new-file.pdf",
          originalName: "合同更正件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1",
          supersedesFileObjectId: null
        }),
        update: jest.fn(),
        delete: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const input = {
      originalName: "合同更正件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer: Buffer.from("private-file"),
      supersedesFileObjectId: "file-old"
    };

    await service.uploadPrivateFile(input);

    const objectKey = storage.write.mock.calls[0]?.[0] as string;
    expect(objectKey).toMatch(/^uploads\/[a-f0-9-]+-合同更正件\.pdf$/);
    expect(objectKey).not.toBe("uploads/file-old.pdf");
    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        objectKey,
        supersedesFileObjectId: null
      })
    });
    expect(tx.fileObject.update).not.toHaveBeenCalled();
    expect(tx.fileObject.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  function replacementFile(
    id: string,
    overrides: Partial<{
      uploadedByUserId: string;
      storageStatus: string;
      supersedesFileObjectId: string | null;
    }> = {}
  ) {
    return {
      id,
      uploadedByUserId: "contract-staff-1",
      storageStatus: "active",
      supersedesFileObjectId: null,
      ...overrides
    };
  }

  function replacementTransaction(
    rows: ReadonlyArray<ReturnType<typeof replacementFile>>,
    options: {
      casCount?: number;
      rereadSupersedesFileObjectId?: string | null;
      unlockedRows?: ReadonlyArray<ReturnType<typeof replacementFile>>;
      events?: string[];
    } = {}
  ) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const queryRaw = jest.fn(async (query: { values?: unknown[] }) => {
      options.events?.push("lock");
      return (query.values ?? [])
        .filter((value): value is string => typeof value === "string")
        .map((id) => rowsById.get(id))
        .filter((row): row is ReturnType<typeof replacementFile> => Boolean(row));
    });
    const updateMany = jest.fn(async () => {
      options.events?.push("update");
      return { count: options.casCount ?? 1 };
    });

    return {
      $queryRaw: queryRaw,
      fileObject: {
        findMany: jest.fn().mockResolvedValue(options.unlockedRows ?? rows),
        updateMany,
        findUnique: jest.fn().mockResolvedValue({
          supersedesFileObjectId: options.rereadSupersedesFileObjectId ?? null
        }),
        delete: jest.fn()
      }
    };
  }

  it("rejects linking a file replacement to itself without touching storage", async () => {
    const tx = replacementTransaction([]);
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const result = service.linkFileReplacement(tx as never, {
      newFileId: "file-same",
      oldFileId: "file-same",
      actorUserId: "contract-staff-1"
    });
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow("新旧文件不能为同一文件");

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not remap an unexpected database failure while locking replacement files", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new"),
      replacementFile("file-old")
    ]);
    const databaseError = new Error("database connection lost");
    tx.$queryRaw.mockRejectedValueOnce(databaseError);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toBe(databaseError);

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["new file", [replacementFile("file-old")]],
    ["old file", [replacementFile("file-new")]]
  ] as const)("rejects linking when the %s is missing", async (_label, files) => {
    const tx = replacementTransaction(files);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("新文件或被替换文件不存在");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it.each(["file-new", "file-old"])(
    "rejects linking when %s is not active",
    async (inactiveFileId) => {
      const tx = replacementTransaction([
        replacementFile("file-new", {
          storageStatus: inactiveFileId === "file-new" ? "quarantined" : "active"
        }),
        replacementFile("file-old", {
          storageStatus: inactiveFileId === "file-old" ? "quarantined" : "active"
        })
      ]);
      const service = new FileService({} as PrismaService, audit as never, storage as never);

      await expect(
        service.linkFileReplacement(tx as never, {
          newFileId: "file-new",
          oldFileId: "file-old",
          actorUserId: "contract-staff-1"
        })
      ).rejects.toThrow("新旧文件必须处于可用状态");

      expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    }
  );

  it("rejects linking when the actor did not upload the new file", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new", { uploadedByUserId: "another-user" }),
      replacementFile("file-old")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    const result = service.linkFileReplacement(tx as never, {
      newFileId: "file-new",
      oldFileId: "file-old",
      actorUserId: "contract-staff-1"
    });
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toThrow("当前账号无权接入该文件替换链");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("links an unlinked new file with a conditional CAS update and preserves the old file", async () => {
    const events: string[] = [];
    const tx = replacementTransaction(
      [replacementFile("file-z-new"), replacementFile("file-a-old")],
      { events }
    );
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-z-new",
        oldFileId: "file-a-old",
        actorUserId: "contract-staff-1"
      })
    ).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const initialLockQuery = tx.$queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(initialLockQuery.values).toEqual(["file-a-old", "file-z-new"]);
    expect(initialLockQuery.strings.join("?")).toContain("FOR UPDATE");
    expect(initialLockQuery.strings.join("?")).toContain('FROM "FileObject"');
    expect(initialLockQuery.strings.join("?")).not.toContain("file-a-old");
    expect(initialLockQuery.strings.join("?")).not.toContain("file-z-new");
    expect(tx.fileObject.findMany).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: {
        id: "file-z-new",
        uploadedByUserId: "contract-staff-1",
        storageStatus: "active",
        supersedesFileObjectId: null
      },
      data: { supersedesFileObjectId: "file-a-old" }
    });
    expect(events).toEqual(["lock", "update"]);
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.fileObject.delete).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("treats an existing link to the same old file as idempotent", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new", { supersedesFileObjectId: "file-old" }),
      replacementFile("file-old")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).resolves.toBeUndefined();

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an existing link to a different old file", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new", { supersedesFileObjectId: "file-other" }),
      replacementFile("file-old")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("新文件已关联其他被替换文件");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a direct A-B replacement cycle after locking both rows", async () => {
    const tx = replacementTransaction([
      replacementFile("file-a"),
      replacementFile("file-b", { supersedesFileObjectId: "file-a" })
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-a",
        oldFileId: "file-b",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects closing an A-B-C replacement chain back to A", async () => {
    const tx = replacementTransaction([
      replacementFile("file-a", { supersedesFileObjectId: "file-b" }),
      replacementFile("file-b", { supersedesFileObjectId: "file-c" }),
      replacementFile("file-c")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-c",
        oldFileId: "file-a",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an already corrupted repeating replacement chain", async () => {
    const tx = replacementTransaction([
      replacementFile("file-new"),
      replacementFile("file-a", { supersedesFileObjectId: "file-b" }),
      replacementFile("file-b", { supersedesFileObjectId: "file-a" })
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-a",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("uses the locked snapshot when an unlocked old row appeared active", async () => {
    const tx = replacementTransaction(
      [replacementFile("file-new"), replacementFile("file-old", { storageStatus: "deleted" })],
      {
        unlockedRows: [replacementFile("file-new"), replacementFile("file-old")]
      }
    );
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("新旧文件必须处于可用状态");

    expect(tx.fileObject.findMany).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("rejects the reverse concurrent link after sorted locks reveal the first committed link", async () => {
    const tx = replacementTransaction([
      replacementFile("file-a", { supersedesFileObjectId: "file-b" }),
      replacementFile("file-b")
    ]);
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-b",
        oldFileId: "file-a",
        actorUserId: "contract-staff-1"
      })
    ).rejects.toThrow("文件替换链存在循环，无法接入");

    const lockQuery = tx.$queryRaw.mock.calls[0]?.[0] as { values: unknown[] };
    expect(lockQuery.values).toEqual(["file-a", "file-b"]);
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("treats a lost CAS as concurrent idempotency when reread links the same old file", async () => {
    const tx = replacementTransaction(
      [replacementFile("file-new"), replacementFile("file-old")],
      { casCount: 0, rereadSupersedesFileObjectId: "file-old" }
    );
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.linkFileReplacement(tx as never, {
        newFileId: "file-new",
        oldFileId: "file-old",
        actorUserId: "contract-staff-1"
      })
    ).resolves.toBeUndefined();

    expect(tx.fileObject.findUnique).toHaveBeenCalledWith({
      where: { id: "file-new" },
      select: { supersedesFileObjectId: true }
    });
  });

  it.each(["file-other", null])(
    "rejects a lost CAS when reread replacement is %s",
    async (supersedesFileObjectId) => {
      const tx = replacementTransaction(
        [replacementFile("file-new"), replacementFile("file-old")],
        { casCount: 0, rereadSupersedesFileObjectId: supersedesFileObjectId }
      );
      const service = new FileService({} as PrismaService, audit as never, storage as never);

      await expect(
        service.linkFileReplacement(tx as never, {
          newFileId: "file-new",
          oldFileId: "file-old",
          actorUserId: "contract-staff-1"
        })
      ).rejects.toThrow("新文件已关联其他被替换文件");
    }
  );

  it("loads a private file buffer for an authorized internal service", async () => {
    const buffer = Buffer.from("docx");
    const file = {
      id: "file-docx",
      objectKey: "uploads/template.docx",
      storageStatus: "active",
      contentSha256: createHash("sha256").update(buffer).digest("hex")
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file)
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(buffer);

    const result = await service.getFileBuffer("file-docx");

    expect(result.file.id).toBe("file-docx");
    expect(result.buffer.equals(Buffer.from("docx"))).toBe(true);
  });

  it("keeps a historical internal file without a content hash readable without download audit", async () => {
    const file = {
      id: "file-legacy-docx",
      objectKey: "uploads/legacy-template.docx",
      storageStatus: "active",
      contentSha256: null
    };
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file)
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(Buffer.from("legacy-docx"));

    await expect(service.getFileBuffer("file-legacy-docx")).resolves.toEqual({
      file,
      buffer: Buffer.from("legacy-docx")
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects an inactive file before an internal storage read", async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-inactive",
          objectKey: "uploads/inactive.docx",
          storageStatus: "quarantined",
          contentSha256: null
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(service.getFileBuffer("file-inactive")).rejects.toThrow(
      "资料文件当前不可用，请联系管理员核对文件状态"
    );
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", "not-a-valid-hash", Buffer.from("private-file")],
    ["mismatched", "0".repeat(64), Buffer.from("tampered-file")]
  ])("rejects an internal file with a %s content hash", async (_caseName, contentSha256, buffer) => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-invalid-hash",
          objectKey: "uploads/invalid.docx",
          storageStatus: "active",
          contentSha256
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(buffer);

    try {
      await expect(service.getFileBuffer("file-invalid-hash")).rejects.toThrow(
        "资料文件完整性校验失败，请联系管理员核对存储文件"
      );
      expect(loggerError).toHaveBeenCalledWith(
        "私有文件完整性校验失败 fileId=file-invalid-hash"
      );
      expect(JSON.stringify(loggerError.mock.calls)).not.toContain(contentSha256);
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it("uses a fixed message when an internal storage read fails", async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-storage-error",
          objectKey: "uploads/storage-error.docx",
          storageStatus: "active",
          contentSha256: null
        })
      }
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockRejectedValue(new Error("ENOENT /private/secret/path"));

    await expect(service.getFileBuffer("file-storage-error")).rejects.toThrow(
      "资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储"
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("authorizes and returns file metadata with the caller transaction", async () => {
    const file = {
      id: "file-1",
      uploadedByUserId: "owner-1"
    };
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file)
      }
    };
    const service = new FileService(
      {} as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.assertCanDownloadFile(tx as never, "file-1", "owner-1")
    ).resolves.toBe(file);
    expect(tx.fileObject.findUnique).toHaveBeenCalledWith({ where: { id: "file-1" } });
  });

  it("rejects private uploads without an uploader in business Chinese", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedByUserId: " ",
        buffer: Buffer.from("private-file")
      })
    ).rejects.toThrow("上传人信息缺失，请重新登录后再上传资料");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("rejects empty private uploads in business Chinese", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "盖章合同.pdf",
        mimeType: "application/pdf",
        sizeBytes: 0,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.alloc(0)
      })
    ).rejects.toThrow("上传文件为空，请重新选择资料文件");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("rejects files over FILE_UPLOAD_MAX_BYTES", async () => {
    const previous = process.env.FILE_UPLOAD_MAX_BYTES;
    process.env.FILE_UPLOAD_MAX_BYTES = "4";
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    try {
      await expect(
        service.uploadPrivateFile({
          originalName: "template.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 5,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("12345")
        })
      ).rejects.toThrow("上传文件超过系统限制，请压缩后重新上传或联系管理员");
      expect(storage.write).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.FILE_UPLOAD_MAX_BYTES;
      else process.env.FILE_UPLOAD_MAX_BYTES = previous;
    }
  });

  it("rejects extensions outside DOCX XLSX PDF PNG JPEG", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "template.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("text")
      })
    ).rejects.toThrow("文件格式不支持，请上传 PDF、Word、Excel 或图片资料");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("rejects DOCM and XLSM macro files", async () => {
    const service = new FileService({} as PrismaService, audit as never, storage as never);

    for (const originalName of ["template.docm", "bill.xlsm"]) {
      await expect(
        service.uploadPrivateFile({
          originalName,
          mimeType: "application/octet-stream",
          sizeBytes: 4,
          uploadedByUserId: "contract-staff-1",
          buffer: Buffer.from("data")
        })
      ).rejects.toThrow("文件格式不支持，请上传 PDF、Word、Excel 或图片资料");
    }
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("does not inspect magic bytes or run virus scanning", async () => {
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.docx",
          originalName: "template.docx",
          mimeType: "application/octet-stream",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(prisma, audit as never, storage as never);

    await expect(
      service.uploadPrivateFile({
        originalName: "template.docx",
        mimeType: "application/octet-stream",
        sizeBytes: 12,
        uploadedByUserId: "contract-staff-1",
        buffer: Buffer.from("not-a-real-docx")
      })
    ).resolves.toMatchObject({ id: "file-1" });
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

  it("records the configured storage bucket for private uploads", async () => {
    storage.bucketName.mockReturnValue("private-cos-bucket");
    const tx = {
      fileObject: {
        create: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-cos-bucket",
          objectKey: "uploads/file-1.pdf",
          originalName: "archive.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await service.uploadPrivateFile({
      originalName: "archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "contract-staff-1",
      buffer: Buffer.from("private-file")
    });

    expect(tx.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bucket: "private-cos-bucket"
      })
    });
  });

  it("creates a short-lived download ticket for a private file", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "合同归档复核"
    });

    expect(ticket.fileId).toBe("file-1");
    expect(ticket.downloadUrl).toContain("/files/file-1/download?");
    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(ticket.downloadUrl).toContain(
      `downloadReason=${encodeURIComponent("合同归档复核")}`
    );
    expect(ticket.expiresAt).toMatch(/T/);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "合同归档复核"
      }
    });
  });

  it("authorizes an offline-revision preview by the current contract owner, not the former uploader", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "preview-pdf",
          bucket: "private-local",
          objectKey: "uploads/preview-pdf.pdf",
          originalName: "线下修订预览.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "former-owner"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      contractOfflineRevision: {
        findFirst: jest.fn().mockResolvedValue({ contractVersionId: "version-1" })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          ownerUserId: "current-owner",
          voidedAt: null
        })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("preview-pdf", {
        actorUserId: "current-owner",
        downloadReason: "复核本轮合同差异"
      })
    ).resolves.toMatchObject({ fileId: "preview-pdf" });
    await expect(
      service.createDownloadTicket("preview-pdf", {
        actorUserId: "former-owner",
        downloadReason: "复核本轮合同差异"
      })
    ).rejects.toThrow("当前账号无权下载该线下修订稿文件");

    tx.fileObject.findUnique.mockResolvedValue({
      id: "offline-docx",
      bucket: "private-local",
      objectKey: "uploads/offline-docx.docx",
      originalName: "线下修订稿.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 24,
      uploadedByUserId: "former-owner"
    });
    await expect(
      service.createDownloadTicket("offline-docx", {
        actorUserId: "current-owner",
        downloadReason: "复核线下修订原文"
      })
    ).resolves.toMatchObject({ fileId: "offline-docx" });
    await expect(
      service.createDownloadTicket("offline-docx", {
        actorUserId: "former-owner",
        downloadReason: "复核线下修订原文"
      })
    ).rejects.toThrow("当前账号无权下载该线下修订稿文件");
    expect(tx.contractOfflineRevision.findFirst).toHaveBeenLastCalledWith({
      where: {
        OR: [{ fileId: "offline-docx" }, { previewPdfFileId: "offline-docx" }]
      },
      select: { contractVersionId: true }
    });
  });

  it("rejects download ticket creation when actor cannot access the file", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "资料下载复核"
      })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows project archive roles to create download tickets for takeover evidence", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "历史合同扫描件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      archiveRecord: {
        findFirst: jest.fn().mockResolvedValue({
          businessType: "contract_takeover",
          businessId: "takeover-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "复核历史接管资料"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.contractTakeover.findUnique).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "复核历史接管资料"
      }
    });
  });

  it("denies takeover evidence download tickets to users outside the project", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "历史合同扫描件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      archiveRecord: {
        findFirst: jest.fn().mockResolvedValue({
          businessType: "contract_takeover",
          businessId: "takeover-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "other-project-user-1",
        downloadReason: "复核历史接管资料"
      })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.contractTakeover.findUnique).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      select: { projectId: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows finance users to create download tickets for linked contract archives", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          contractVersionId: "contract-version-1",
          fileId: "file-1",
          status: "confirmed"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects download tickets for pending contract archive files", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "待确认盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          contractVersionId: "contract-version-1",
          fileId: "file-1",
          status: "pending_confirm"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("资料尚未归档确认，暂不能下载");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects download tickets for pending settlement archive files", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "待确认签章结算单.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-staff-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          settlementId: "settlement-1",
          fileId: "file-1",
          status: "pending_confirm"
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("资料尚未归档确认，暂不能下载");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows finance users to create download tickets for project receipt vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "收款凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: {
        findFirst: jest.fn().mockResolvedValue({
          id: "receipt-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows finance users to create download tickets for project proxy payment vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "总包代付凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "proxy-payment-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows budget users to create download tickets for upstream settlement vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "对上审定凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "budget-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "upstream-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "budget-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=budget-1");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects finance users from downloading upstream settlement vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "对上审定凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "budget-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "upstream-1",
          projectId: "project-1",
          voucherFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not grant upstream settlement voucher access through voided records", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "作废对上审定凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "budget-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "budget-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.projectUpstreamSettlement.findFirst).toHaveBeenCalledWith({
      where: { voucherFileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows approval roles to create download tickets for settlement exception quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "例外结算额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "exception-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "contract-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=contract-director-1");
    expect(tx.projectSettlementExceptionQuota.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "file-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects finance users from downloading settlement exception quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "例外结算额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "exception-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows financing approval roles to create download tickets for project financing quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "项目垫资额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: { findFirst: jest.fn().mockResolvedValue(null) },
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-director-1");
    expect(tx.projectFinancingQuota.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "file-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects finance staff from downloading project financing quota attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "项目垫资额度附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "project-manager-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectSettlementExceptionQuota: { findFirst: jest.fn().mockResolvedValue(null) },
      projectFinancingQuota: {
        findFirst: jest.fn().mockResolvedValue({
          id: "financing-quota-1",
          projectId: "project-1",
          attachmentFileId: "file-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "finance-staff-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows project expense approvers to create download tickets for request attachments", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "综合费用附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "employee-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "expense-1",
          projectId: "project-1",
          applicantUserId: "employee-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "budget-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=budget-director-1");
    expect(tx.projectExpenseRequest.findFirst).toHaveBeenCalledWith({
      where: { attachmentFileId: "file-1", voidedAt: null },
      select: { projectId: true, applicantUserId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows finance users to create download tickets for project expense execution vouchers", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "综合费用实付凭证.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "cashier-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseExecution: {
        findFirst: jest.fn().mockResolvedValue({
          projectId: "project-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.projectExpenseExecution.findFirst).toHaveBeenCalledWith({
      where: { voucherFileId: "file-1" },
      select: { projectId: true }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("allows archive-readable contract roles to download active project owner contract files", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "业主主合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectOwnerContract: {
        findFirst: jest.fn(({ where }: { where: { voidedAt?: null | { not: null } } }) =>
          Promise.resolve(
            where.voidedAt === null
              ? {
                  id: "owner-contract-1",
                  projectId: "project-1",
                  fileId: "file-1",
                  voidedAt: null
                }
              : {
                  id: "owner-contract-voided",
                  projectId: "project-1",
                  fileId: "file-1",
                  voidedAt: new Date("2026-07-01T00:00:00.000Z")
                }
          )
        )
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "contract-director-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=contract-director-1");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenCalledWith({
      where: { fileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-director-1",
      action: "file.download.ticket",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        expiresAt: ticket.expiresAt,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("does not grant project owner contract file access through voided records", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "作废业主主合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-uploader"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectOwnerContract: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "owner-contract-voided" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }])
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "contract-director-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(1, {
      where: { fileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(2, {
      where: { fileId: "file-1", voidedAt: { not: null } },
      select: { id: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects uploader download when the project owner contract file belongs to a voided record", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "作废业主主合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "contract-uploader"
        })
      },
      projectOwnerContract: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "owner-contract-voided" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "contract-uploader", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(1, {
      where: { fileId: "file-1", voidedAt: null },
      select: { projectId: true }
    });
    expect(tx.projectOwnerContract.findFirst).toHaveBeenNthCalledWith(2, {
      where: { fileId: "file-1", voidedAt: { not: null } },
      select: { id: true }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows the applicant to download an approval-form PDF", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "审批单-PAY-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "payment_request",
          businessId: "pay-1",
          fileId: "file-1",
          templateKey: "approval_form"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "approved"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "applicant-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=applicant-1");
  });

  it("allows finance staff to download a project expense approval-form PDF by project role", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "审批单-BX-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "chairman-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "project_expense_request",
          businessId: "expense-1",
          fileId: "file-1",
          templateKey: "approval_form"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "approved"
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.projectExpenseRequest.findUnique).toHaveBeenCalledWith({
      where: { id: "expense-1" }
    });
  });

  it("allows finance staff to download a project expense archived PDF by project role", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "报销归档-BX-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-director-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      projectExpenseRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: "expense-1", projectId: "project-1" })
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      archiveRecord: {
        findFirst: jest.fn().mockResolvedValue({
          businessType: "project_expense_request",
          businessId: "expense-1"
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=finance-1");
    expect(tx.archiveRecord.findFirst).toHaveBeenCalledWith({
      where: { fileId: "file-1" },
      select: { businessType: true, businessId: true }
    });
  });

  it("allows the applicant to download the latest in-progress settlement approval PDF", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "applicant-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=applicant-1");
  });

  it("denies latest settlement approval PDF download to roles outside the frozen approval route", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          frozenNodes: [
            { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
            { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
          ]
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ id: "settlement-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "engineering_tech" }])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "engineering-user-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
  });

  it("allows latest settlement approval PDF download to roles in the frozen approval route", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          frozenNodes: [
            { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
            { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
          ]
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ id: "settlement-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "material_staff" }])
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "material-user-1",
      downloadReason: "资料下载复核"
    });

    expect(ticket.downloadUrl).toContain("actorUserId=material-user-1");
  });

  it("does not treat non-signature approval logs as latest settlement approval PDF signatures", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "JS-2026-019-结算审批最新.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "settlement",
          businessId: "settlement-1",
          fileId: "file-1",
          templateKey: "settlement_approval_latest"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn(async (args: { where?: { action?: unknown } }) =>
          args.where?.action ? null : { id: "remind-log-1", action: "remind" }
        )
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ id: "settlement-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "engineering_tech" }])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "reminder-user-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(tx.approvalActionLog.findFirst).toHaveBeenCalledWith({
      where: {
        approvalInstanceId: "inst-1",
        actorUserId: "reminder-user-1",
        action: { in: ["approve", "reject_previous", "return_to_applicant"] }
      }
    });
  });

  it("denies an unrelated user from downloading an approval-form PDF", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "审批单-PAY-2026-001.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "system-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-1",
          businessType: "payment_request",
          businessId: "pay-1",
          fileId: "file-1",
          templateKey: "approval_form"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inst-1",
          applicantUserId: "applicant-1",
          status: "approved"
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: "pay-1", projectId: "project-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", { actorUserId: "stranger-1", downloadReason: "资料下载复核" })
    ).rejects.toThrow("当前账号无权下载该资料");
  });

  it("rejects overly long download reasons before creating a ticket", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "下载".repeat(101)
      })
    ).rejects.toThrow("下载原因不能超过 200 个字，请精简后重新提交");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects missing download reasons before creating a ticket", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "   "
      })
    ).rejects.toThrow("请填写下载原因，便于留痕审计");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("reads a private file through a short-lived ticket and records download audit", async () => {
    const buffer = Buffer.from("private-file");
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: createHash("sha256").update(buffer).digest("hex")
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(buffer);

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    const result = await service.readPrivateFile("file-1", {
      actorUserId: url.searchParams.get("actorUserId") ?? "",
      expiresAt: url.searchParams.get("expiresAt") ?? "",
      downloadReason: url.searchParams.get("downloadReason") ?? "",
      token: url.searchParams.get("token") ?? ""
    });

    expect(result.buffer).toEqual(buffer);
    expect(storage.read).toHaveBeenCalledWith("uploads/file-1.pdf");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-1",
      action: "file.download",
      businessType: "file_object",
      businessId: "file-1",
      metadata: {
        originalName: "盖章合同.pdf",
        sizeBytes: 12,
        downloadReason: "资料下载复核"
      }
    });
  });

  it("rejects a private file whose stored content hash no longer matches", async () => {
    const expectedHash = "0".repeat(64);
    const actualHash = createHash("sha256").update("tampered-file").digest("hex");
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: expectedHash
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(Buffer.from("tampered-file"));

    try {
      const ticket = await service.createDownloadTicket("file-1", {
        actorUserId: "finance-1",
        downloadReason: "资料下载复核"
      });
      const url = new URL(`http://local${ticket.downloadUrl}`);
      audit.record.mockClear();

      await expect(
        service.readPrivateFile("file-1", {
          actorUserId: url.searchParams.get("actorUserId") ?? "",
          expiresAt: url.searchParams.get("expiresAt") ?? "",
          downloadReason: url.searchParams.get("downloadReason") ?? "",
          token: url.searchParams.get("token") ?? ""
        })
      ).rejects.toThrow("资料文件完整性校验失败，请联系管理员核对存储文件");

      const logged = JSON.stringify(loggerError.mock.calls);
      expect(loggerError).toHaveBeenCalled();
      expect(logged).not.toContain(expectedHash);
      expect(logged).not.toContain(actualHash);
      expect(logged).not.toContain("uploads/file-1.pdf");
      expect(logged).not.toContain("secret-id");
      expect(logged).not.toContain("secret-key");
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it.each([
    ["empty", ""],
    ["short", "abc"],
    ["uppercase", "A".repeat(64)],
    ["non-hex", "g".repeat(64)]
  ])("rejects a non-null malformed stored content hash: %s", async (_caseName, contentSha256) => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-malformed",
          bucket: "private-local",
          objectKey: "uploads/malformed.pdf",
          originalName: "合同附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    storage.read.mockResolvedValue(Buffer.from("private-file"));

    try {
      const ticket = await service.createDownloadTicket("file-malformed", {
        actorUserId: "finance-1",
        downloadReason: "资料下载复核"
      });
      const url = new URL(`http://local${ticket.downloadUrl}`);
      audit.record.mockClear();

      await expect(
        service.readPrivateFile("file-malformed", {
          actorUserId: url.searchParams.get("actorUserId") ?? "",
          expiresAt: url.searchParams.get("expiresAt") ?? "",
          downloadReason: url.searchParams.get("downloadReason") ?? "",
          token: url.searchParams.get("token") ?? ""
        })
      ).rejects.toThrow("资料文件完整性校验失败，请联系管理员核对存储文件");

      expect(storage.read).toHaveBeenCalledWith("uploads/malformed.pdf");
      expect(loggerError).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(
        "私有文件完整性校验失败 fileId=file-malformed"
      );
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
    }
  });

  it("keeps historical files without a content hash readable", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-legacy",
          bucket: "private-local",
          objectKey: "uploads/legacy.pdf",
          originalName: "历史合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: null
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockResolvedValue(Buffer.from("legacy-file"));

    const ticket = await service.createDownloadTicket("file-legacy", {
      actorUserId: "finance-1",
      downloadReason: "历史资料复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    const result = await service.readPrivateFile("file-legacy", {
      actorUserId: url.searchParams.get("actorUserId") ?? "",
      expiresAt: url.searchParams.get("expiresAt") ?? "",
      downloadReason: url.searchParams.get("downloadReason") ?? "",
      token: url.searchParams.get("token") ?? ""
    });

    expect(result.buffer).toEqual(Buffer.from("legacy-file"));
  });

  it("rejects an inactive ticket file before storage read or download success audit", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-inactive-ticket",
          bucket: "private-local",
          objectKey: "uploads/inactive.pdf",
          originalName: "停用资料.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "quarantined",
          contentSha256: null
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-inactive-ticket", {
      actorUserId: "finance-1",
      downloadReason: "停用资料复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    await expect(
      service.readPrivateFile("file-inactive-ticket", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("资料文件当前不可用，请联系管理员核对文件状态");
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects tampered download ticket fields before reading or auditing a ticket", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1"
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const transaction = jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    );
    const prisma = {
      $transaction: transaction
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    transaction.mockClear();
    audit.record.mockClear();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: "篡改下载原因",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(
      service.readPrivateFile("file-2", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: "other-user",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("下载链接校验失败，请重新申请下载");
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns a business message when private storage cannot read a ticket file", async () => {
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          bucket: "private-local",
          objectKey: "uploads/file-1.pdf",
          originalName: "盖章合同.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: null
        })
      },
      contractArchiveFile: { findFirst: jest.fn() },
      settlementArchiveFile: { findFirst: jest.fn() },
      paymentExecution: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new FileService(
      prisma,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );
    storage.read.mockRejectedValueOnce(new Error("ENOENT: object missing"));

    const ticket = await service.createDownloadTicket("file-1", {
      actorUserId: "finance-1",
      downloadReason: "资料下载复核"
    });
    const url = new URL(`http://local${ticket.downloadUrl}`);
    audit.record.mockClear();

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: url.searchParams.get("actorUserId") ?? "",
        expiresAt: url.searchParams.get("expiresAt") ?? "",
        downloadReason: url.searchParams.get("downloadReason") ?? "",
        token: url.searchParams.get("token") ?? ""
      })
    ).rejects.toThrow("资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储");
    expect(storage.read).toHaveBeenCalledWith("uploads/file-1.pdf");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects overly long download reasons before reading a ticket", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new FileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as PrivateFileStorage
    );

    await expect(
      service.readPrivateFile("file-1", {
        actorUserId: "finance-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        token: "signed-ticket",
        downloadReason: "下载".repeat(101)
      })
    ).rejects.toThrow("下载原因不能超过 200 个字，请精简后重新提交");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
