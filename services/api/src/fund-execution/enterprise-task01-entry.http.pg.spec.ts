import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import {
  loadTask01EntryContext,
  task01ConnectionIdentity,
  verifyTask01Connection,
  type Task01EntryContext
} from "../database/enterprise-task01-entry.test-support";
import { createApiValidationPipe } from "../validation/api-validation";

// PREPARED / NOT EXECUTED: the controlled resource run awaits separate authorisation.
// This is a funds CASE-entry smoke test, not a FundExecution posting acceptance.
const enabled = process.env.RUN_ENTERPRISE_TASK01_ENTRY_PG16 === "1";
type CaseBody = {
  caseId: string;
  revision: number;
  status: string;
  entrySnapshots: Array<{ valuesSnapshot: Record<string, unknown> }>;
};

describe("任务01受限连接的公开资金案件入口", () => {
  let app: INestApplication | undefined;
  let observer: PrismaClient | undefined;
  let runtime: PrismaService;
  let context: Task01EntryContext;
  let baseUrl: string;
  let token: string;
  let httpMetadataFile: string | undefined;
  let apiPort: number | undefined;

  beforeAll(async () => {
    if (!enabled) return;
    context = loadTask01EntryContext();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    runtime = app.get(PrismaService);
    observer = new PrismaClient({
      datasources: { db: { url: process.env.JG_TASK01_OBSERVER_DATABASE_URL } }
    });
    await observer.$connect();
    await app.init();
    await verifyTask01Connection(runtime, context, "jg_task01_runtime");
    await verifyTask01Connection(observer, context, "jg_task01_observer");
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    apiPort = Number(new URL(baseUrl).port);
    httpMetadataFile = process.env.JG_TASK01_HTTP_METADATA_FILE!;
    writeFileSync(httpMetadataFile, JSON.stringify({ apiPort, closed: false }), { flag: "wx", mode: 0o600 });
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context.actor),
      signal: AbortSignal.timeout(10_000)
    });
    if (login.status !== 201) throw new Error("任务01合成账号登录未成功");
    const session = await login.json() as { tokens?: { accessToken?: string } };
    if (!session.tokens?.accessToken) throw new Error("任务01登录会话不完整");
    token = session.tokens.accessToken;
  }, 45_000);

  afterAll(async () => {
    const closed = await Promise.allSettled([app?.close(), observer?.$disconnect()]);
    const succeeded = closed.every(result => result.status === "fulfilled");
    if (httpMetadataFile) writeFileSync(httpMetadataFile, JSON.stringify({ apiPort, closed: succeeded }), { mode: 0o600 });
    if (!succeeded) throw new Error("任务01运行连接或HTTP关闭未完成");
  });

  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("任务01公开案件接口未成功");
    return response.json() as Promise<T>;
  }

  (enabled ? it : it.skip)("从可信合成观察创建案件、分类提交并同键回读，独立只读观察仅一份", async () => {
    const initialRuntime = await task01ConnectionIdentity(runtime);
    const options = await request<Array<{ selectionRef: string }>>("/fund-executions/observation-options");
    expect(options.length).toBe(1);
    const createKey = randomUUID();
    const createBody = { observationSelectionRef: options[0]!.selectionRef, reason: "任务01合成资金案件", idempotencyKey: createKey };
    const created = await request<CaseBody>("/fund-executions/cases", "POST", createBody);
    expect(await request<CaseBody>("/fund-executions/cases", "POST", createBody)).toEqual(created);
    const path = `/fund-executions/cases/${created.caseId}`;
    const plans = await request<Array<{ lines: Array<{ axes: Array<{ selectionRef: string }> }> }>>(`${path}/classification-options`);
    expect(plans.length).toBe(1);
    const updated = await request<CaseBody>(path, "PATCH", {
      reason: "任务01公司项目资金到账",
      expectedRevision: created.revision,
      selections: plans[0]!.lines.flatMap(line => line.axes.map(({ selectionRef }) => ({ selectionRef }))),
      idempotencyKey: randomUUID()
    });
    const submit = { expectedRevision: updated.revision, idempotencyKey: randomUUID() };
    const submitted = await request<CaseBody>(`${path}/submit`, "POST", submit);
    expect(submitted.status).toBe("submitted");
    expect(await request<CaseBody>(`${path}/submit`, "POST", submit)).toEqual(submitted);
    const detail = await request<CaseBody>(path);
    expect(detail.entrySnapshots).toHaveLength(1);
    expect(detail.entrySnapshots[0]!.valuesSnapshot).toMatchObject({ amountCents: "12500", direction: "inflow", reason: "任务01公司项目资金到账" });

    if (!observer) throw new Error("任务01独立观察连接未建立");
    const rows = await observer.$queryRaw<Array<{ executionFacts: number; bankClaims: number; cases: number; receipts: number; snapshots: number }>>`
      SELECT
        (SELECT count(*)::integer FROM public."FundExecution" WHERE "idempotencyKey" = ${createKey}) AS "executionFacts",
        (SELECT count(*)::integer FROM public."BankTransactionClaim" b
           JOIN public."FundExecution" f ON f.id = b."fundExecutionId"
          WHERE f."idempotencyKey" = ${createKey}) AS "bankClaims",
        (SELECT count(*)::integer FROM public."FundExecutionCase" WHERE "idempotencyKey" = ${createKey}) AS cases,
        (SELECT count(*)::integer FROM public."FundExecutionCommandReceipt" WHERE "idempotencyKey" = ${createKey}) AS receipts,
        (SELECT count(*)::integer FROM public."FundExecutionEntrySnapshot" s
           JOIN public."FundExecutionCase" c ON c.id = s."fundExecutionCaseId"
          WHERE c."caseKey" = ${created.caseId}) AS snapshots`;
    expect(rows).toEqual([{ executionFacts: 1, bankClaims: 1, cases: 1, receipts: 1, snapshots: 1 }]);
    await verifyTask01Connection(runtime, context, "jg_task01_runtime");
    expect((await task01ConnectionIdentity(runtime)).backendPid).toBe(initialRuntime.backendPid);
    await runtime.$disconnect();
    await runtime.$connect();
    await verifyTask01Connection(runtime, context, "jg_task01_runtime");
    expect(await request<CaseBody>(path)).toEqual(detail);
  }, 60_000);
});
