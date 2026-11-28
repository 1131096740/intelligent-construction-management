import { createServer } from "node:http";
import {
  markTask12DirectSourceDiagnostic, observeTask12DirectSourceDiagnostic, recordTask12DirectSourceDiagnostic
} from "./task12-direct-source-diagnostic";

it("captures the first finite observation across the real loopback HTTP listener", async () => {
  const published = jest.fn();
  await expect(observeTask12DirectSourceDiagnostic(async () => {
    const server = createServer((_request, response) => {
      markTask12DirectSourceDiagnostic("DISPATCH_CATALOG");
      recordTask12DirectSourceDiagnostic(Object.assign(new Error("credentials and raw SQL"), {
        code: "P2010", meta: { code: "42501", message: "private text" }
      }));
      markTask12DirectSourceDiagnostic("SOURCE_POLICY");
      recordTask12DirectSourceDiagnostic(new Error("later failure"));
      response.writeHead(503).end();
    });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test loopback failed");
      expect((await fetch("http://127.0.0.1:" + address.port)).status).toBe(503);
      throw new Error("consumer stopped");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  }, published)).rejects.toThrow("consumer stopped");
  expect(published.mock.calls).toEqual([[{
    phase: "DISPATCH_CATALOG", operation: "PRISMA_QUERY_RAW", prismaCode: "P2010", sqlState: "42501"
  }]]);
});

it("preserves the thrown exception and ignores an accessor or malformed DB code", async () => {
  const published = jest.fn(), thrown = new Error("original");
  await expect(observeTask12DirectSourceDiagnostic(async () => {
    const meta = Object.defineProperty({}, "code", { get: () => { throw new Error("getter ran"); } });
    markTask12DirectSourceDiagnostic("DISPATCH_POLICY");
    recordTask12DirectSourceDiagnostic({ code: "P2010", meta });
    throw thrown;
  }, published)).rejects.toBe(thrown);
  expect(published.mock.calls).toEqual([[{ phase: "DISPATCH_POLICY" }]]);
});

it.each([
  "SHAPE_BINDINGS", "SHAPE_GENERATED_PARENT", "SHAPE_UPWARD_CREATE",
  "SHAPE_UPWARD_SAVE_PROJECTION", "SHAPE_UPWARD_SAVE_CATALOG", "SHAPE_UPWARD_SAVE_SUBMISSION",
  "SHAPE_UPWARD_SAVE_ARCHIVE_TRANSITION", "SHAPE_UPWARD_SAVE_SEAL_COMPLETION", "SHAPE_UPWARD_SAVE_ATTACHMENT",
  "SHAPE_HELPERS", "SHAPE_TRIGGERS",
  "DEFINER_UNKNOWN", "DEFINER_READER_BINDING_ABSENT", "DEFINER_READER_CATALOG", "DEFINER_READER_NO_ROW",
  "DEFINER_READER_MULTIPLE_ROWS", "DEFINER_READER_MISMATCH"
] as const)("records only the finite direct source phase %s", async phase => {
  const published = jest.fn(), thrown = new Error("original");
  await expect(observeTask12DirectSourceDiagnostic(async () => {
    type DiagnosticPhase = Parameters<typeof markTask12DirectSourceDiagnostic>[0];
    markTask12DirectSourceDiagnostic(phase);
    markTask12DirectSourceDiagnostic("private value" as DiagnosticPhase);
    recordTask12DirectSourceDiagnostic(new Error("private detail"));
    throw thrown;
  }, published)).rejects.toBe(thrown);
  expect(published.mock.calls).toEqual([[{ phase }]]);
});

it("publishes only fixed reader mismatch field names without values", async () => {
  const published = jest.fn(), thrown = new Error("private fields and values");
  await expect(observeTask12DirectSourceDiagnostic(async () => {
    markTask12DirectSourceDiagnostic("DEFINER_READER_MISMATCH");
    Reflect.apply(recordTask12DirectSourceDiagnostic, undefined, [thrown, { transactionId: true, privateId: true, completionOid: true, ownerOid: "private" }]);
    throw thrown;
  }, published)).rejects.toBe(thrown);
  expect(published.mock.calls).toEqual([[{
    phase: "DEFINER_READER_MISMATCH", mismatchedFields: ["completionOid", "transactionId"]
  }]]);
});

describe("retention diagnostics through the failing qualification", () => {
  const binding = {
    protocolVersion: 1, recipeVersion: "contract-direct-archive-retention-v1/1",
    applicationRoleOid: "PRIVATE_APPLICATION", anchorOwnerOid: "PRIVATE_OWNER",
    databaseOid: "PRIVATE_DATABASE", preparationRelationOid: "PRIVATE_PREPARATION",
    preparationSha256: "a".repeat(64)
  };
  const anchor = {
    currentRoleOid: "PRIVATE_CURRENT", sessionRoleOid: "PRIVATE_SESSION",
    backendPid: 1000, transactionId: "PRIVATE_TRANSACTION"
  };
  const preparation = { binding, actual: { relationOid: binding.preparationRelationOid } };

  it.each([
    ["registryQualified", "RETENTION_REGISTRY"],
    ["applicationCompletionReads", "RETENTION_APPLICATION_READS"],
    ["fileCallers", "RETENTION_FILE_CALLERS"]
  ] as const)("isolates %s without exposing its observed values", async (field, phase) => {
    const { readDirectArchiveRetentionQualification } = await import("./contract-direct-archive-retention-qualification");
    const query = jest.fn()
      .mockResolvedValueOnce([{ status: "absent", projectionOid: null, closureOid: null }])
      .mockResolvedValueOnce([{ binding, actual: { ...binding, ...anchor, registryQualified: true,
        applicationCompletionReads: true, fileCallers: [], [field]: false } }]);
    const published = jest.fn();
    const tx = { $queryRaw: query } as unknown as Parameters<typeof readDirectArchiveRetentionQualification>[0];
    await expect(observeTask12DirectSourceDiagnostic(
      () => readDirectArchiveRetentionQualification(tx, "PRIVATE_RETENTION", preparation, anchor), published
    )).rejects.toThrow("直签原件交接资格尚未完整核对");
    expect(query).toHaveBeenCalledTimes(2);
    expect(published.mock.calls).toEqual([[{ phase }]]);
  });

  it("keeps the actual raw catalog SQLSTATE through the public retention rejection", async () => {
    const { readDirectArchiveRetentionQualification } = await import("./contract-direct-archive-retention-qualification");
    const query = jest.fn()
      .mockResolvedValueOnce([{ status: "absent", projectionOid: null, closureOid: null }])
      .mockRejectedValueOnce(Object.assign(new Error("private SQL or data"), { code: "P2010", meta: { code: "42501" } }));
    const published = jest.fn();
    const tx = { $queryRaw: query } as unknown as Parameters<typeof readDirectArchiveRetentionQualification>[0];
    await expect(observeTask12DirectSourceDiagnostic(
      () => readDirectArchiveRetentionQualification(tx, "PRIVATE_RETENTION", preparation, anchor), published
    )).rejects.toThrow("直签原件交接资格尚未完整核对");
    expect(published.mock.calls).toEqual([[{
      phase: "RETENTION_CATALOG", operation: "PRISMA_QUERY_RAW", prismaCode: "P2010", sqlState: "42501"
    }]]);
  });

  it("distinguishes a nested completion registry failure with the same public rejection", async () => {
    const { readDirectArchiveRetentionQualification } = await import("./contract-direct-archive-retention-qualification");
    const noProjection = [{ status: "absent", projectionOid: null, closureOid: null }];
    const caller = { roleOid: "PRIVATE_FILE_CALLER", exactReads: true, executable: true };
    const rows = [{ binding: { ...binding, bindings: {} }, actual: { ...binding, ...anchor, bindings: {},
      registryQualified: true, applicationCompletionReads: true, fileCallers: [caller] } }];
    const query = jest.fn().mockResolvedValueOnce(noProjection).mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ relationOid: "12345", routineCount: 1, triggerCount: 2 }])
      .mockResolvedValueOnce(noProjection).mockResolvedValueOnce([]);
    const published = jest.fn();
    const tx = { $queryRaw: query } as unknown as Parameters<typeof readDirectArchiveRetentionQualification>[0];
    const linkedPreparation = { ...preparation, binding: { ...binding, fileCallerOids: [caller.roleOid] } };
    await expect(observeTask12DirectSourceDiagnostic(
      () => readDirectArchiveRetentionQualification(tx, "PRIVATE_RETENTION", linkedPreparation, anchor), published
    )).rejects.toThrow("直签归档完成接线资格尚未完整核对");
    expect(query).toHaveBeenCalledTimes(5);
    const catalog = query.mock.calls[4]?.[0] as { text: string };
    expect(catalog.text).toContain("jg_generated_archive_activation_basis_v1(pg_catalog.text,pg_catalog.bool)");
    expect(catalog.text).not.toContain("jg_generated_archive_activation_basis_v1(pg_catalog.text,pg_catalog.boolean)");
    expect(published.mock.calls).toEqual([[{ phase: "RETENTION_COMPLETION_REGISTRY" }]]);
  });
});
