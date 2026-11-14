import "reflect-metadata";
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaService } from "./prisma.service";
import { withTask12DocumentRoleServices, withTask12PreownedDocumentRoleServices } from "./task12-generated-document-role-services";

const database = "jg_task01_" + "a".repeat(32);
const roles = ["jg_c259_doc_template", "jg_c259_doc_worker", "jg_c259_doc_queue"] as const;
const expected = { database, databaseOid: "16391", namespaceOid: "2200" };
const keys = ["FILE_STORAGE_ROOT", "FILE_STORAGE_DRIVER", "FILE_DOWNLOAD_SECRET"] as const;
const reached = new Error("model persistence reached");
const materialSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "task12-doc-role-")));
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.FILE_STORAGE_ROOT = root;
  process.env.FILE_STORAGE_DRIVER = "local";
  process.env.FILE_DOWNLOAD_SECRET = "s".repeat(64);
  const trace: string[] = [];
  const observed = roles.map((role, index) => ({
    role, sessionRole: role, roleOid: String(16393 + index), backendPid: 201 + index,
    backendStart: "2026-11-12T01:00:00.00000" + (index + 1) + "Z",
    ...expected, clientAddress: "127.0.0.1", serverAddress: "127.0.0.1", serverPort: 5432, ssl: true
  }));
  const clients = roles.map((_, index) => {
    const name = ["template", "worker", "queue"][index];
    return {
      async $queryRaw() { trace.push(name + ":identity"); return [observed[index]]; },
      async $transaction() { trace.push(name + ":transaction"); throw reached; },
      async $disconnect() { trace.push(name + ":disconnect"); },
      contractLayoutPreviewJob: {
        async updateMany() { trace.push(name + ":recover"); throw reached; }
      }
    };
  });
  return { root, expected: { ...expected, storageRoot: root,
    roleOids: { template: "16393", worker: "16394", queue: "16395" } }, observed, trace,
    connections: { template: clients[0], worker: clients[1], queue: clients[2] } as unknown as
      Record<"template" | "worker" | "queue", PrismaService>,
    worker: clients[1].contractLayoutPreviewJob,
    cleanup() {
      for (const key of keys) if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
      rmSync(root, { recursive: true, force: true });
    }
  };
}

it("routes the original template publish, preview queue and worker recovery to three separate observed ports", async () => {
  const f = fixture();
  try {
    let late!: () => Promise<boolean>;
    await withTask12DocumentRoleServices(f.connections, f.expected, async services => {
      late = services.worker.processNext;
      await expect(services.template.publishVersion("layout", "actor", "change")).rejects.toBe(reached);
      await expect(services.queue.queueDraftPreview("version", "actor", { sourceRevision: 1 })).rejects.toBe(reached);
      await expect(services.worker.processNext()).rejects.toBe(reached);
    });
    expect(f.trace).toEqual(["template:identity", "worker:identity", "queue:identity",
      "template:transaction", "queue:transaction", "worker:recover",
      "template:identity", "worker:identity", "queue:identity",
      "template:disconnect", "worker:disconnect", "queue:disconnect"]);
    expect(() => late()).toThrow("TASK12_DOCUMENT_ROLE_CLOSED");
    await expect(withTask12DocumentRoleServices(f.connections, f.expected, jest.fn()))
      .rejects.toMatchObject({ code: "TASK12_DOCUMENT_ROLE_REPLAY" });
  } finally { f.cleanup(); }
});

it("does not construct or run document services when a connection reports the wrong role", async () => {
  const f = fixture();
  try {
    Object.assign(f.observed[0], { role: roles[1] });
    const use = jest.fn();
    await expect(withTask12DocumentRoleServices(f.connections, f.expected, use))
      .rejects.toMatchObject({ code: "TASK12_DOCUMENT_ROLE_IDENTITY" });
    expect(use).not.toHaveBeenCalled();
    expect(f.trace.slice(-3)).toEqual(["template:disconnect", "worker:disconnect", "queue:disconnect"]);
  } finally { f.cleanup(); }
});

it("reads the actual template bytes with the original FileService under the template port", async () => {
  const f = fixture();
  try {
    copyFileSync(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"),
      join(f.root, "material.docx"));
    Object.assign(f.connections.template, {
      user: { findUnique: async () => ({ isActive: true }) },
      userPosition: { findMany: async () => [{ positionId: "director" }] },
      position: { findMany: async () => [{ id: "director", key: "contract_director" }] },
      contractLayoutTemplateVersion: { findUnique: async () => ({
        id: "layout", docxFileId: "source", status: "draft", draftRevision: 1, placeholderSchema: {}
      }) },
      contractLayoutPreviewJob: { findFirst: async () => null },
      fileObject: { findUnique: async () => {
        f.trace.push("template:file");
        return { id: "source", storageStatus: "active", objectKey: "material.docx", contentSha256: materialSha };
      } }
    });
    await expect(withTask12DocumentRoleServices(f.connections, f.expected,
      services => services.template.sourcePositions("layout", "actor"))).resolves.toMatchObject({
      sourceFileId: "source", sourceSha256: materialSha
    });
    expect(f.trace).toContain("template:file");
  } finally { f.cleanup(); }
});

it("rejects a reconnected backend even when its numeric PID and role have not changed", async () => {
  const f = fixture();
  try {
    await expect(withTask12DocumentRoleServices(f.connections, f.expected, async () => {
      f.observed[1].backendStart = "2026-11-12T01:00:02.000001Z";
    })).rejects.toMatchObject({ code: "TASK12_DOCUMENT_ROLE_IDENTITY" });
    expect(f.trace.slice(-3)).toEqual(["template:disconnect", "worker:disconnect", "queue:disconnect"]);
  } finally { f.cleanup(); }
});

it("retains the original scope failure when one client could not disconnect", async () => {
  const f = fixture();
  try {
    jest.spyOn(f.connections.worker, "$disconnect").mockRejectedValueOnce(new Error("failed model close"));
    await expect(withTask12DocumentRoleServices(f.connections, f.expected, async () => { throw reached; }))
      .rejects.toMatchObject({
        code: "TASK12_DOCUMENT_ROLE_CLEANUP_UNKNOWN", appCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE", cause: reached
      });
    expect(f.trace).toContain("queue:disconnect");
  } finally { f.cleanup(); }
});

it("does not disconnect pools until original in-flight worker work has settled", async () => {
  const f = fixture();
  let finish!: () => void;
  let notifyEntered!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { notifyEntered = resolve; });
  const worker = f.worker;
  jest.spyOn(worker, "updateMany").mockImplementationOnce(async () => {
    f.trace.push("worker:recover-held");
    notifyEntered();
    await held;
    throw reached;
  });
  let work!: Promise<boolean>;
  try {
    const result = withTask12DocumentRoleServices(f.connections, f.expected, async services => {
      work = services.worker.processNext();
    });
    const outcome = result.catch((error: unknown) => error);
    await Promise.race([entered, outcome]);
    expect(f.trace).not.toContain("worker:disconnect");
    finish();
    await expect(work).rejects.toBe(reached);
    await expect(outcome).resolves.toMatchObject({
      code: "TASK12_DOCUMENT_ROLE_OPERATIONS_INCOMPLETE", cause: reached
    });
    expect(f.trace.slice(-3)).toEqual(["template:disconnect", "worker:disconnect", "queue:disconnect"]);
  } finally { finish(); f.cleanup(); }
});

it("rejects a detached operation that failed before the scope callback returned", async () => {
  const f = fixture();
  try {
    await expect(withTask12DocumentRoleServices(f.connections, f.expected, async services => {
      void services.queue.queueDraftPreview("version", "actor", { sourceRevision: 1 });
      await new Promise(resolve => setImmediate(resolve));
      return "would otherwise succeed";
    })).rejects.toMatchObject({
      code: "TASK12_DOCUMENT_ROLE_OPERATIONS_UNOBSERVED", cause: reached
    });
    expect(f.trace.slice(-3)).toEqual(["template:disconnect", "worker:disconnect", "queue:disconnect"]);
  } finally { f.cleanup(); }
});

it("the fixed preowned role seam drains work but leaves the three disconnects to its issuer", async () => {
  const f = fixture();
  try {
    await expect(withTask12PreownedDocumentRoleServices(f.connections, f.expected, async services => {
      await expect(services.queue.queueDraftPreview("version", "actor", { sourceRevision: 1 })).rejects.toBe(reached);
      await expect(services.worker.processNext()).rejects.toBe(reached);
      return false;
    })).resolves.toBe(false);
    expect(f.trace).toEqual(["template:identity", "worker:identity", "queue:identity",
      "queue:transaction", "worker:recover", "template:identity", "worker:identity", "queue:identity"]);
  } finally { f.cleanup(); }
});
