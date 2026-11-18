/** Test-only CON-18 default-AppModule entry. The owning isolated controller must
 * separately prove PG ownership, seed only synthetic fixtures, and retain the
 * official converter/observer scopes before any business operation. */
export function assertTask12DefaultAppUrl(value: string, expected: Readonly<{
  role: string; database: string; serverPort: number; runRoot: string;
}>): void {
  const fail = () => { throw Object.assign(new Error("TASK12_DEFAULT_APP_INPUT"), { code: "TASK12_DEFAULT_APP_INPUT" }); };
  if (typeof value !== "string" || value.length > 8192 || !expected ||
    !/^jg_fixture_app_[a-f0-9]{24}$/u.test(expected.role) || !/^jg_task01_[a-f0-9]{32}$/u.test(expected.database) ||
    !Number.isInteger(expected.serverPort) || expected.serverPort <= 1024 || expected.serverPort > 65535 || expected.serverPort === 5432 ||
    !/^\/private\/tmp\/jg-native-contract-[A-Za-z0-9_-]{1,32}$/u.test(expected.runRoot)) fail();
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  const values: Record<string, string> = { schema: "public", connection_limit: "2", sslmode: "require", sslaccept: "strict",
    sslcert: expected.runRoot + "/ca.crt", connect_timeout: "5", pool_timeout: "5",
    application_name: "native_task12_" + expected.database.slice("jg_task01_".length) + "_3" };
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || Number(url.port) !== expected.serverPort ||
    url.username !== expected.role || !/^[a-f0-9]{96}$/u.test(url.password) || url.pathname !== "/" + expected.database || url.hash ||
    [...url.searchParams.keys()].length !== Object.keys(values).length ||
    Object.entries(values).some(([key, expectedValue]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== expectedValue)) fail();
}

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { lstatSync, realpathSync } from "node:fs";
import { AppModule } from "../app.module";
import { configureApiSecurity } from "../api-security";
import { apiJsonReplacer } from "../api-json-replacer";
import { listenApi } from "../api-listen";
import { createApiValidationPipe } from "../validation/api-validation";
import { AuditService } from "../audit/audit.service";
import { FileService } from "../file/file.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { PrismaService } from "./prisma.service";
import { withTask12DefaultDocumentScope, type Task12DefaultIdentity } from "./task12-default-document-scope";

/** Creates the genuine AppModule without provider overrides. The supplied use
 * callback and its fixture/observer/converter must be owned by a separately
 * qualified isolated controller; this function does not issue that authority. */
export async function withTask12Con18DefaultApp<T>(expected: Readonly<{
  role: string; database: string; serverPort: number; runRoot: string;
  databaseOid: string; namespaceOid: string; roleOid: string;
}>, use: (app: INestApplication) => Promise<T>, verifySession?: (identity: Readonly<Task12DefaultIdentity>) => Promise<void>): Promise<T> {
  assertTask12DefaultAppUrl(process.env.DATABASE_URL ?? "", expected);
  const root = expected.runRoot, storage = root + "/storage";
  const fail = () => { throw Object.assign(new Error("TASK12_DEFAULT_APP_INPUT"), { code: "TASK12_DEFAULT_APP_INPUT" }); };
  if (process.env.NODE_ENV === "production" || process.env.FILE_STORAGE_DRIVER !== "local" || process.env.FILE_STORAGE_ROOT !== storage ||
    ["NODE_OPTIONS", "NODE_PATH", "SKIP_DATABASE_CONNECT"].some(key => Boolean(process.env[key])) || typeof use !== "function") fail();
  for (const name of [root, storage]) {
    const st = lstatSync(name);
    if (realpathSync(name) !== name || !st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) fail();
  }
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
  try { moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); }
  catch (error) { throw Object.assign(new Error("TASK12_DEFAULT_APP_COMPILE_CLEANUP", { cause: error }), { appCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" }); }
  let app: INestApplication | undefined, primary: unknown, failed = false, result: T | undefined;
  try {
    app = moduleRef.createNestApplication();
    const client = app.get(PrismaService), audit = app.get(AuditService), files = app.get(FileService),
      template = app.get(LayoutTemplateService), queue = app.get(ContractDocumentService), worker = app.get(ContractDocumentProcessor);
    result = await withTask12DefaultDocumentScope({ client, audit, files, template, queue, worker }, expected, async () => {
      configureApiSecurity(app!);
      app!.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
      app!.useGlobalPipes(createApiValidationPipe());
      await listenApi(app!, 0, "127.0.0.1");
      return use(app!);
    }, verifySession);
  } catch (error) {
    primary = error; failed = true;
  }
  try { if (app) await app.close(); else await moduleRef.close(); }
  catch (cleanup) { throw Object.assign(new Error("TASK12_DEFAULT_APP_CLEANUP", { cause: primary ?? cleanup }), { appCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" }); }
  if (failed) throw primary;
  return result as T;
}

import { currentOfficialDocumentScope } from "../../prisma/task12-official-document-profile.cjs";
import { assertTask12Con18OwnerWindow, observeTask12Con18Signed, observeTask12Con18Rounds, observeTask12Con18Archived, closeTask12Con18OwnerWindow } from "../../prisma/task12-con18-native-owner-window.cjs";
import { createTask12Con18DefaultHttp } from "./task12-con18-default-http";
import { runTask12Con18Withdrawal, type Task12Con18Input } from "./task12-con18-withdrawal-case";

/** Task-specific CON-18 chain. This alone is not an acceptance gate: only an
 * isolated controller can supply separately qualified fixture, official PDF
 * converter and read-only observer. No such capability is exposed via HTTP. */
export async function runTask12Con18DefaultApp(expected: Readonly<{
  role: string; database: string; serverPort: number; runRoot: string;
  databaseOid: string; namespaceOid: string; roleOid: string;
}>, input: Omit<Task12Con18Input, "bridge" | "readPdfDrawnText" | "observer">, ownerWindow: object, verifySession?: (identity: Readonly<Task12DefaultIdentity>) => Promise<void>) {
  if (!ownerWindow || typeof ownerWindow !== "object") throw new Error("TASK12_DEFAULT_APP_INPUT");
  let result: Awaited<ReturnType<typeof runTask12Con18Withdrawal>>;
  try {
    if (!input) throw new Error("TASK12_DEFAULT_APP_INPUT");
    if (assertTask12Con18OwnerWindow(ownerWindow, input.fixture) !== true) throw new Error("TASK12_DEFAULT_APP_OWNER_OBSERVATION");
    if (!(input.signal instanceof AbortSignal) || input.signal.aborted || typeof verifySession !== "function") throw new Error("TASK12_DEFAULT_APP_INPUT");
    const official = currentOfficialDocumentScope();
    const readPdf = (official as (typeof official & { readPdfDrawnText?: Task12Con18Input["readPdfDrawnText"] }))?.readPdfDrawnText;
    if (!official || official.kind !== "OFFICIAL_TOOL_RUNTIME" || typeof readPdf !== "function") throw new Error("TASK12_DEFAULT_APP_OFFICIAL_RUNTIME");
    official.checkMaterials();
    result = await withTask12Con18DefaultApp(expected, async app => {
      const bridge = createTask12Con18DefaultHttp(await app.getUrl(), input.signal);
      const observer: Task12Con18Input["observer"] = {
        signed: (versionId, roundId, actorId) => observeTask12Con18Signed(ownerWindow, versionId, roundId, actorId),
        rounds: (versionId, withdrawn, current) => observeTask12Con18Rounds(ownerWindow, versionId, withdrawn, current),
        archived: (versionId, roundId, archiveId) => observeTask12Con18Archived(ownerWindow, versionId, roundId, archiveId)
      };
      return runTask12Con18Withdrawal({ ...input, observer, bridge, readPdfDrawnText: async (bytes, signal) => {
        if (currentOfficialDocumentScope() !== official) throw new Error("TASK12_DEFAULT_APP_OFFICIAL_RUNTIME");
        official.check(); return readPdf(bytes, signal);
      } });
    }, verifySession);
  } catch (error) {
    try { await closeTask12Con18OwnerWindow(ownerWindow); }
    catch { throw Object.assign(new Error("TASK12_DEFAULT_APP_OWNER_CLEANUP", { cause: error }), { ownerCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" }); }
    throw error;
  }
  const closed = await closeTask12Con18OwnerWindow(ownerWindow);
  if (!closed.matched) throw new Error("TASK12_DEFAULT_APP_OWNER_OBSERVATION");
  return result;
}
