import {
  CosVersionedObjectStorage,
  InMemoryVersionedObjectStorage,
  ObjectStorageOperationError,
  withObjectStorageRetry
} from "./versioned-object-storage";

describe("InMemoryVersionedObjectStorage", () => {
  function storage() {
    return new InMemoryVersionedObjectStorage();
  }

  it("lists a single-version object and proves convergence after delete", async () => {
    const client = storage();
    client.seed("uploads/a.pdf", [{ versionId: "v1", isLatest: true, sizeBytes: 10 }]);

    await expect(client.listObjectVersions("uploads/a.pdf")).resolves.toEqual([
      expect.objectContaining({ objectKey: "uploads/a.pdf", versionId: "v1", isLatest: true })
    ]);
    await expect(client.isConverged("uploads/a.pdf")).resolves.toBe(false);

    await client.deleteObjectVersion("uploads/a.pdf", "v1");

    await expect(client.listObjectVersions("uploads/a.pdf")).resolves.toEqual([]);
    await expect(client.isConverged("uploads/a.pdf")).resolves.toBe(true);
  });

  it("removes every historical version and delete marker for the exact key", async () => {
    const client = storage();
    client.seed("uploads/b.pdf", [
      { versionId: "v1", isDeleteMarker: false, isLatest: false },
      { versionId: "v2", isDeleteMarker: true, isLatest: false },
      { versionId: "v3", isDeleteMarker: true, isLatest: true }
    ]);

    for (const versionId of ["v1", "v2", "v3"]) {
      await client.deleteObjectVersion("uploads/b.pdf", versionId);
    }

    await expect(client.isConverged("uploads/b.pdf")).resolves.toBe(true);
    expect(client.state.versions.has("uploads/b.pdf")).toBe(false);
  });

  it("reports not converged while a noncurrent version or delete marker remains", async () => {
    const client = storage();
    client.seed("uploads/c.pdf", [
      { versionId: "current", isDeleteMarker: false, isLatest: true },
      { versionId: "stale", isDeleteMarker: false, isLatest: false }
    ]);

    await client.deleteObjectVersion("uploads/c.pdf", "current");

    await expect(client.isConverged("uploads/c.pdf")).resolves.toBe(false);
    await expect(client.listObjectVersions("uploads/c.pdf")).resolves.toEqual([
      expect.objectContaining({ versionId: "stale", isLatest: false })
    ]);
  });

  it("is safe to repeat deletion after complete convergence", async () => {
    const client = storage();
    client.seed("uploads/d.pdf", [{ versionId: "v1", isLatest: true }]);
    await client.deleteObjectVersion("uploads/d.pdf", "v1");

    await expect(
      client.deleteObjectVersion("uploads/d.pdf", "v1")
    ).resolves.toBeUndefined();
    await expect(client.deleteObjectVersion("uploads/d.pdf", "missing")).resolves.toBeUndefined();
    await expect(client.isConverged("uploads/d.pdf")).resolves.toBe(true);
  });

  it("never touches a similarly prefixed neighbouring object", async () => {
    const client = storage();
    client.seed("uploads/a.pdf", [{ versionId: "v1", isLatest: true }]);
    client.seed("uploads/a.pdf-f", [
      { versionId: "p1", isDeleteMarker: false, isLatest: false },
      { versionId: "p2", isDeleteMarker: false, isLatest: true }
    ]);

    await client.deleteObjectVersion("uploads/a.pdf", "v1");

    expect(client.state.versions.get("uploads/a.pdf-f")).toHaveLength(2);
    await expect(client.isConverged("uploads/a.pdf-f")).resolves.toBe(false);
  });

  it("only permanently removes a delete marker when the exact versionId is supplied", async () => {
    const client = storage();
    client.seed("uploads/e.pdf", [{ versionId: "marker", isDeleteMarker: true, isLatest: true }]);

    // 模拟「不带 versionId」的普通 DELETE：只会在版本化桶上再插入一个删除标记，不永久删除。
    client.seed("uploads/e.pdf", [
      { versionId: "marker", isDeleteMarker: true, isLatest: false },
      { versionId: "newer-marker", isDeleteMarker: true, isLatest: true }
    ]);

    await expect(client.isConverged("uploads/e.pdf")).resolves.toBe(false);

    await client.deleteObjectVersion("uploads/e.pdf", "marker");
    await client.deleteObjectVersion("uploads/e.pdf", "newer-marker");

    await expect(client.isConverged("uploads/e.pdf")).resolves.toBe(true);
  });

  it("exposes transient list and delete failures and leaves the job retryable", async () => {
    const client = storage();
    client.seed("uploads/f.pdf", [{ versionId: "v1", isLatest: true }]);
    client.simulateNextListFailure();

    await expect(client.listObjectVersions("uploads/f.pdf")).rejects.toMatchObject({
      name: "ObjectStorageOperationError",
      operation: "list_versions",
      retryable: true
    });

    client.simulateNextDeleteFailure();
    await expect(client.deleteObjectVersion("uploads/f.pdf", "v1")).rejects.toMatchObject({
      operation: "delete_version",
      retryable: true
    });

    // 重试后收敛。
    await withObjectStorageRetry(
      () => client.listObjectVersions("uploads/f.pdf"),
      { maxAttempts: 2, baseBackoffMs: 0 }
    );
    await expect(client.isConverged("uploads/f.pdf")).resolves.toBe(false);
  });

  it("retries only retryable errors and rethrows terminal errors", async () => {
    let attempts = 0;
    const terminal = new ObjectStorageOperationError({
      operation: "delete_version",
      retryable: false,
      diagnostics: { errorCode: "InvalidArgument" }
    });
    await expect(
      withObjectStorageRetry(
        () => {
          attempts += 1;
          return Promise.reject(terminal);
        },
        { maxAttempts: 3, baseBackoffMs: 0 }
      )
    ).rejects.toBe(terminal);
    expect(attempts).toBe(1);
  });
});

describe("CosVersionedObjectStorage", () => {
  const env = {
    COS_BUCKET: "private-bucket",
    COS_REGION: "ap-chengdu",
    COS_SECRET_ID: "secret-id",
    COS_SECRET_KEY: "secret-key"
  } as const;

  type CosEnvKey = keyof typeof env;

  function configureCos() {
    const previous: Partial<Record<CosEnvKey, string | undefined>> = {};
    for (const key of Object.keys(env) as CosEnvKey[]) {
      previous[key] = process.env[key];
      process.env[key] = env[key];
    }
    return () => {
      for (const key of Object.keys(env) as CosEnvKey[]) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    };
  }

  function xmlResponse(xml: string, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => undefined } as unknown as Headers,
      text: async () => xml,
      arrayBuffer: async () => new ArrayBuffer(0)
    } as unknown as Response;
  }

  it("lists only exact-key versions and delete markers from paginated XML", async () => {
    const restore = configureCos();
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<Version>
  <Key>uploads/a.pdf</Key>
  <VersionId>v-historical</VersionId>
  <IsLatest>false</IsLatest>
  <LastModified>2026-01-01T00:00:00.000Z</LastModified>
  <Size>11</Size>
</Version>
<DeleteMarker>
  <Key>uploads/a.pdf</Key>
  <VersionId>marker</VersionId>
  <IsLatest>true</IsLatest>
  <LastModified>2026-01-02T00:00:00.000Z</LastModified>
</DeleteMarker>
<Version>
  <Key>uploads/a.pdf-f</Key>
  <VersionId>neighbour</VersionId>
  <IsLatest>true</IsLatest>
</Version>`
      )
    );
    try {
      const client = new CosVersionedObjectStorage();
      const versions = await client.listObjectVersions("uploads/a.pdf");

      expect(versions).toEqual([
        expect.objectContaining({
          objectKey: "uploads/a.pdf",
          versionId: "v-historical",
          isDeleteMarker: false,
          isLatest: false,
          sizeBytes: 11
        }),
        expect.objectContaining({
          objectKey: "uploads/a.pdf",
          versionId: "marker",
          isDeleteMarker: true,
          isLatest: true
        })
      ]);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        "https://private-bucket.cos.ap-chengdu.myqcloud.com/" +
          "?max-keys=1000&prefix=uploads%2Fa.pdf&versions"
      );
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual(
        expect.objectContaining({
          Host: "private-bucket.cos.ap-chengdu.myqcloud.com",
          Authorization: expect.stringMatching(/q-url-param-list=max-keys;prefix;versions/)
        })
      );
    } finally {
      fetchMock.mockRestore();
      dateNowMock.mockRestore();
      restore();
    }
  });

  it("paginates with key-marker and version-id-marker until not truncated", async () => {
    const restore = configureCos();
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        xmlResponse(
          `<Version><Key>uploads/b.pdf</Key><VersionId>v1</VersionId><IsLatest>false</IsLatest></Version>
<DeleteMarker><Key>uploads/b.pdf</Key><VersionId>m1</VersionId><IsLatest>true</IsLatest></DeleteMarker>
<IsTruncated>true</IsTruncated><NextKeyMarker>uploads/b.pdf</NextKeyMarker><NextVersionIdMarker>m1</NextVersionIdMarker>`
        )
      )
      .mockResolvedValueOnce(
        xmlResponse(
          `<Version><Key>uploads/b.pdf</Key><VersionId>v2</VersionId><IsLatest>true</IsLatest></Version>
<IsTruncated>false</IsTruncated>`
        )
      );
    try {
      const client = new CosVersionedObjectStorage();
      const versions = await client.listObjectVersions("uploads/b.pdf");

      expect(versions.map((version) => version.versionId)).toEqual(["v1", "m1", "v2"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondUrl = (fetchMock.mock.calls[1] as unknown as [string])[0];
      expect(secondUrl).toContain("key-marker=uploads%2Fb.pdf");
      expect(secondUrl).toContain("version-id-marker=m1");
    } finally {
      fetchMock.mockRestore();
      restore();
    }
  });

  it("deletes an exact version via versionId and tolerates a missing version as converged", async () => {
    const restore = configureCos();
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(xmlResponse("", 204))
      .mockResolvedValueOnce(xmlResponse("", 404));
    try {
      const client = new CosVersionedObjectStorage();

      await client.deleteObjectVersion("uploads/c.pdf", "v1");
      await client.deleteObjectVersion("uploads/c.pdf", "already-gone");

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        "https://private-bucket.cos.ap-chengdu.myqcloud.com/uploads/c.pdf?versionid=v1"
      );
      expect(init.method).toBe("DELETE");
      expect(init.headers).toEqual(
        expect.objectContaining({
          Authorization: expect.stringContaining("q-url-param-list=versionid")
        })
      );
    } finally {
      fetchMock.mockRestore();
      dateNowMock.mockRestore();
      restore();
    }
  });

  it("maps transport and non-404 errors to retryable ObjectStorageOperationError", async () => {
    const restore = configureCos();
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockResolvedValueOnce(
        xmlResponse(
          "<Error><Code>InternalError</Code><RequestId>req-1</RequestId></Error>",
          500
        )
      );
    try {
      const client = new CosVersionedObjectStorage();

      await expect(client.listObjectVersions("uploads/d.pdf")).rejects.toMatchObject({
        name: "ObjectStorageOperationError",
        operation: "list_versions",
        retryable: true
      });
      await expect(client.deleteObjectVersion("uploads/d.pdf", "v1")).rejects.toMatchObject({
        operation: "delete_version",
        retryable: true,
        diagnostics: { errorCode: "InternalError", requestId: "req-1" }
      });
    } finally {
      fetchMock.mockRestore();
      restore();
    }
  });

  it("marks permanent 4xx errors as non-retryable and 429/5xx as retryable", async () => {
    const restore = configureCos();
    const dateNowMock = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(xmlResponse("<Error><Code>AccessDenied</Code></Error>", 403))
      .mockResolvedValueOnce(xmlResponse("<Error><Code>InvalidArgument</Code></Error>", 400))
      .mockResolvedValueOnce(xmlResponse("<Error><Code>SlowDown</Code></Error>", 429))
      .mockResolvedValueOnce(xmlResponse("<Error><Code>InternalError</Code></Error>", 500));
    try {
      const client = new CosVersionedObjectStorage();

      await expect(client.deleteObjectVersion("uploads/e.pdf", "v1")).rejects.toMatchObject({
        name: "ObjectStorageOperationError",
        operation: "delete_version",
        retryable: false
      });
      await expect(client.listObjectVersions("uploads/f.pdf")).rejects.toMatchObject({
        name: "ObjectStorageOperationError",
        operation: "list_versions",
        retryable: false
      });
      await expect(client.deleteObjectVersion("uploads/g.pdf", "v1")).rejects.toMatchObject({
        operation: "delete_version",
        retryable: true
      });
      await expect(client.listObjectVersions("uploads/h.pdf")).rejects.toMatchObject({
        operation: "list_versions",
        retryable: true
      });
    } finally {
      fetchMock.mockRestore();
      dateNowMock.mockRestore();
      restore();
    }
  });

  it("refuses invalid or empty object keys without issuing a request", async () => {
    const restore = configureCos();
    const fetchMock = jest.spyOn(globalThis, "fetch");
    try {
      const client = new CosVersionedObjectStorage();
      await expect(client.listObjectVersions("uploads/")).rejects.toMatchObject({
        name: "ObjectStorageOperationError",
        diagnostics: { errorCode: "InvalidObjectKey" }
      });
      await expect(
        client.deleteObjectVersion("uploads/..", "v1")
      ).rejects.toMatchObject({ name: "ObjectStorageOperationError" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restore();
    }
  });
});
