import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { REGISTERED_PAYMENT_IMPACT_READER, type Task16RegisteredPaymentImpactRuntime } from "../payment/registered-payment-impact-reader";
import { createRegisteredPaymentSyntheticDb } from "../payment/testing/registered-payment-execution.synthetic-db";

const { createCurrent259ImpactRuntime } = createRequire(__filename)("../../prisma/task16-current259-impact-runtime.cjs") as {
  createCurrent259ImpactRuntime(session: unknown, check: () => void): Task16RegisteredPaymentImpactRuntime;
};

it("the real payment result service consumes the259 transaction provider and preserves permission and exact fact scope", async () => {
  const database = createRegisteredPaymentSyntheticDb();
  const seed = database.prisma as unknown as Record<string, { create(args: { data: Record<string, unknown> }): Promise<unknown> }>;
  const key = "d6cbd278-d7f1-4b28-a01c-07b1b11860c2";
  await seed.contractVersion.create({ data: { id: "version-a", signingSubjectType: "our_company" } });
  await seed.paymentRequest.create({ data: { id: "payment-a", projectId: "project-a", sourceType: "contract_due", paymentSubjectType: "our_company", contractVersionId: "version-a" } });
  await seed.paymentExecution.create({ data: { id: "execution-a", idempotencyKey: key, paymentRequestId: "payment-a", amountCents: 2500n,
    paidAt: new Date("2026-11-04T00:00:00Z"), executedByUserId: "finance", voucherFileId: "legacy-voucher" } });
  await seed.operatingFact.create({ data: { id: "fact-a", projectId: "project-a", sourceType: "payment_execution", sourceBusinessId: "execution-a",
    sourceVersion: 1, actualPayerSubjectKind: "participating_company", actualPayerSubjectId: "company-a", basisSnapshot: { voucherPending: false } } });
  const endpoint = { publishedHost: "127.0.0.1", publishedPort: 15432, clientAddress: "172.19.0.1", clientPort: 49152, serverAddress: "172.19.0.2", serverPort: 5432 };
  const queries: unknown[][] = [];
  let dedicated = 0;
  const tx = Object.assign({}, database.prisma, { $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
    if (!sql.includes("jg_read_registered_payment_impacts")) return [{ startedAt: "2026-11-10T04:03:11.000002Z", ...endpoint }];
    queries.push(args.slice(0, 5));
    return [{ factId: "fact-a", impactKind: "payment", amountCents: 2500n, numericProtocolVersion: 1, subjectKind: "participating_company", subjectId: "company-a" }];
  } });
  const runtime = { $transaction: async (operation: (client: typeof tx) => unknown, options: unknown) => {
    dedicated++; expect(options).toEqual({ isolationLevel: "Serializable" }); return operation(tx);
  } };
  const root = resolve(__dirname, "../../../..");
  const migrationRoot = resolve(root, "services/api/prisma/migrations");
  const source = { candidateSha: "0".repeat(40), sealSha256: "a".repeat(64),
    schemaSha256: createHash("sha256").update(readFileSync(resolve(root, "services/api/prisma/schema.prisma"))).digest("hex"),
    migrations: readdirSync(migrationRoot, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => row.name).sort()
      .map(name => ({ path: `services/api/prisma/migrations/${name}/migration.sql`, sha256: createHash("sha256").update(readFileSync(resolve(migrationRoot, name, "migration.sql"))).digest("hex") })) };
  const identity = ["owner", "runtime", "observer"].map((role, index) => ({ database: "jg_task01_0123456789abcdef0123456789abcdef", databaseOid: "16910", systemIdentifier: "7245753496126091540",
    effectiveRole: `jg_task01_${role}`, loginRole: `jg_task01_${role}`, effectiveOid: String(16911 + index), loginOid: String(16911 + index), pid: 411 + index,
    start: `2026-11-10T04:03:01.00000${index + 1}Z`, tls: true }));
  const provider = createCurrent259ImpactRuntime({ source, runtime, owner: {}, observer: {}, identity, endpoint, verifyFull: async () => {}, verifyInstalled259: async () => {},
    b7: { profile: "B7_ORIGINAL", xid: "451", routineOid: "38001", bodySha256: "f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20" } }, () => {});
  const ordinary = { ...database.prisma, $transaction: jest.fn(() => { throw new Error("unadmitted ordinary transaction"); }) };
  const module = await Test.createTestingModule({ providers: [RegisteredPaymentExecutionService,
    { provide: PrismaService, useValue: ordinary }, { provide: REGISTERED_PAYMENT_IMPACT_READER, useValue: provider }] }).compile();
  try {
    const service = module.get(RegisteredPaymentExecutionService);
    await expect(service.result("finance", key)).resolves.toMatchObject({ status: "recorded", execution: { executionId: "execution-a", amountCents: "2500" },
      effects: [{ factId: "fact-a", impacts: [{ kind: "payment", amountCents: "2500", subjectKind: "participating_company", subjectId: "company-a" }] }] });
    expect(queries).toEqual([[key, "execution-a", "payment-a", "project-a", "fact-a"]]);
    await expect(service.result("employee", key)).rejects.toMatchObject({ status: 403 });
    expect(queries).toHaveLength(1); expect(dedicated).toBe(2); expect(ordinary.$transaction).not.toHaveBeenCalled();
  } finally { await module.close(); }
});
