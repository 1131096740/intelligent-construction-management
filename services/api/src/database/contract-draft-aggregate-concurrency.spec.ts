import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { BusinessPartyService } from "../business-party/business-party.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { ContractDraftAggregateService } from "../contract-workbench/contract-draft-aggregate.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { Test } from "@nestjs/testing";
import { ContractDraftController } from "../contract-workbench/contract-draft.controller";
import { ContractV2SubmissionService } from "../contract/contract-v2-submission.service";
import { ContractDraftBillExcelController } from "../contract-bill/contract-draft-bill-excel.controller";
import { ContractBillExcelService } from "../contract-bill/contract-bill-excel.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import * as ExcelJS from "exceljs";
import { ContractDraftEditLeaseService } from "../contract-workbench/contract-draft-edit-lease.service";
import { ContractService } from "../contract/contract.service";
import { PristineDraftDeletionService } from "../contract-workbench/pristine-draft-deletion.service";
import { ContractDocumentService } from "../contract-document/contract-document.service";

const TEST_DATABASE = "jiangkong_contract_draft_aggregate_test";
const LEASE_TOKEN_PREFIX = "contract-draft-aggregate-concurrency-lease";

export function contractDraftAggregateDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("合同草稿聚合并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("合同草稿聚合并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract draft aggregate PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;

  // Task 09 PREPARED ONLY: no resource/SQL execution is authorised in this run.
  integrationTest("creates a pending v2 draft without a legacy template and preserves its four-place or unknown facts under the real subject CHECK", async () => {
    const client = new PrismaClient({ datasources: { db: { url: contractDraftAggregateDatabaseUrl(process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL) } } });
    const ids = makeIds("task09-new-v2");
    const audit = new AuditService();
    let created = false;
    try {
      await client.user.create({ data: { id: ids.owner, name: "新合同合成经办人" } });
      await client.project.create({ data: { id: ids.project, code: `DRAFT-09-${randomUUID()}`, name: "新合同合成项目" } });
      const contracts = new ContractService(client as never, audit);
      const result = await contracts.createDraft({ numericProtocolVersion: 2, projectId: ids.project, contractTypeKey: "other", relationship: "upward" }, ids.owner);
      ids.contract = result.contract.id; ids.version = result.version.id; created = true;
      const bill = await client.contractBill.findFirstOrThrow({ where: { contractVersionId: ids.version } }); ids.billA = bill.id;
      const workbench = new ContractWorkbenchService(client as never, audit);
      const aggregate = new ContractDraftAggregateService(client as never, workbench, new ContractBillService(client as never, audit), new BusinessPartyService(client as never, audit), { assertCanBindContractDraftAttachments: async () => undefined } as never, audit);
      const initial = await aggregate.getWorkbench(ids.version, ids.owner, "2");
      expect(initial.version).toMatchObject({ signingSubjectType: "draft_unconfirmed", amountYuan: null, amountCents: null, businessTemplateVersionId: null });
      expect(initial.bills).toHaveLength(1); expect(initial.paymentTerms).toMatchObject({ originalText: "", stages: [] });
      const lease = await new ContractDraftEditLeaseService(client as never, {} as never, audit).acquire(ids.version, ids.owner);
      const base = aggregateInput(randomUUID());
      await aggregate.saveAggregate(ids.version, ids.owner, lease.token, { ...base, changedSections: ["draft", "bills"], draft: { ...base.draft,
        numericProtocolVersion: 2, manualAmountYuan: "1.5340", manualAmountCents: undefined,
        draftData: { contractName: "仅保存未完整的新合同", contractBasics: { businessType: "other", relationship: "upward", amountBasis: "tax_exclusive", invoiceStatus: "none" } }
      }, bills: [{ billKey: "main", expectedRevision: 1, numericProtocolVersion: 2, rows: [] }] });
      const saved = await aggregate.getWorkbench(ids.version, ids.owner, "2");
      expect(saved.version).toMatchObject({ amountYuan: "1.5340", amountCents: "153", status: "draft" });
      expect(saved.parties).toEqual([]); expect(saved.version.taxFacts.defaultTaxRatePercent).toBeNull();
      expect(saved.draftOperationAvailableActions).not.toContain("submit_contract_draft");
      await expect(client.contractVersion.update({ where: { id: ids.version }, data: { status: "effective" } })).rejects.toThrow();
      expect((await aggregate.getWorkbench(ids.version, ids.owner, "2")).version.status).toBe("draft");
    } finally {
      if (created) {
        const terms = await client.paymentTermsVersion.findMany({ where: { contractVersionId: ids.version }, select: { id: true } });
        await client.paymentTermsStage.deleteMany({ where: { paymentTermsVersionId: { in: terms.map(term => term.id) } } });
        await client.paymentTermsVersion.deleteMany({ where: { contractVersionId: ids.version } });
        await client.auditLog.deleteMany({ where: { businessId: ids.contract } });
      }
      await cleanupDraft(client, ids);
      await client.$disconnect();
    }
  });

  // PREPARED / NOT RUN: requires separately authorised migrations/resources.
  // Real domain services + PG + public HTTP; synthetic actor injection exercises
  // draft ownership, not production login or global permission guard wiring.
  integrationTest("keeps four-decimal draft facts across HTTP save/read/export and rejects lossy legacy writes atomically", async () => {
    const client = new PrismaClient({ datasources: { db: { url: contractDraftAggregateDatabaseUrl(process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL) } } });
    const ids = makeIds("decimal-v2");
    const audit = new AuditService();
    const aggregate = new ContractDraftAggregateService(client as never, new ContractWorkbenchService(client as never, audit),
      new ContractBillService(client as never, audit), new BusinessPartyService(client as never, audit),
      { assertCanBindContractDraftAttachments: async () => undefined } as never, audit);
    const excel = new ContractBillExcelService(client as never, audit, {} as never);
    // Constructor collaborators unrelated to these public routes are left out;
    // actual save/read/export business methods above are never substituted.
    const routed = await Test.createTestingModule({ controllers: [ContractDraftController, ContractDraftBillExcelController],
      providers: [
        { provide: ContractDraftAggregateService, useValue: aggregate },
        { provide: ContractBillExcelService, useValue: excel },
        { provide: ContractDraftEditLeaseService, useValue: {} },
        { provide: ContractService, useValue: {} },
        { provide: PristineDraftDeletionService, useValue: {} },
        { provide: ContractDocumentService, useValue: {} },
        { provide: ContractV2SubmissionService, useValue: {} }
      ] }).compile();
    const http = routed.createNestApplication({ logger: false });
    http.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    http.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => { request.user = { id: ids.owner }; next(); });
    http.useGlobalPipes(createApiValidationPipe());
    try {
      await seedDraft(client, ids, true);
      await http.listen(0, "127.0.0.1");
      const base = await http.getUrl();
      const body = {
        ...aggregateInput(randomUUID(), true), changedSections: ["draft", "bills"],
        draft: { ...aggregateInput(randomUUID()).draft, amountSource: "bill_sum", manualAmountCents: undefined,
          taxFacts: { ...aggregateInput(randomUUID()).draft.taxFacts, defaultTaxRatePercent: "0" } },
        bills: [
          { billKey: "main", expectedRevision: 1, numericProtocolVersion: 2, rows: [
            { clientRowKey: "line", sortOrder: 0, itemName: "四位清单", unit: "项", quantity: "1.2345", unitPrice: "1.2345", customData: {} },
            { clientRowKey: "a", sortOrder: 1, itemName: "微额一", unit: "项", quantity: "1", unitPrice: "0.005", customData: {} },
            { clientRowKey: "b", sortOrder: 2, itemName: "微额二", unit: "项", quantity: "1", unitPrice: "0.005", customData: {} }
          ] }, { billKey: "secondary", expectedRevision: 1, numericProtocolVersion: 2, rows: [] }
        ]
      };
      const put = (value: unknown) => fetch(`${base}/contract-drafts/${ids.version}`, { method: "PUT",
        headers: { "content-type": "application/json", "x-contract-draft-lease": leaseToken(ids) }, body: JSON.stringify(value) });
      expect((await put(body)).status).toBe(200);
      const read = await fetch(`${base}/contract-drafts/${ids.version}/workbench`, { headers: { "x-contract-numeric-protocol": "2" } });
      expect(read.status).toBe(200);
      expect((await fetch(`${base}/contract-drafts/${ids.version}/workbench`)).status).toBe(409);
      const saved = await read.json();
      expect(saved.bills[0]).toMatchObject({ numericProtocolVersion: 2, taxInclusiveAmountYuan: "1.5340", taxInclusiveAmountCents: "153" });
      expect(saved.bills[0].rows[0]).toMatchObject({ quantity: "1.2345", unitPrice: "1.2345", taxInclusiveAmountYuan: "1.5240" });
      const download = await fetch(`${base}/contract-drafts/${ids.version}/bills/main/export`);
      expect(download.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await download.arrayBuffer()) as never);
      expect(workbook.worksheets.every(sheet => sheet.state === "visible")).toBe(true);
      const sheet = workbook.worksheets[0]!;
      expect(sheet.getRow(2).values).toEqual(expect.arrayContaining(["1.2345", "1.5240"]));
      expect(sheet.columns.every(column => !column.hidden)).toBe(true);
      const invalid = structuredClone(body);
      invalid.idempotencyKey = randomUUID(); invalid.expectedRevision = saved.version.draftRevision;
      invalid.bills.forEach(bill => { bill.expectedRevision = saved.bills.find((current: { billKey: string }) => current.billKey === bill.billKey).revision; });
      invalid.bills[0]!.rows[0]!.unitPrice = "1.23456";
      const invalidResponse = await put(invalid);
      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toMatchObject({
        code: "DRAFT_VALIDATION_FAILED",
        message: "清单有 1 处需要修改"
      });
      const overflow = structuredClone(invalid); overflow.idempotencyKey = randomUUID();
      overflow.bills[0]!.rows[0]!.quantity = "1";
      overflow.bills[0]!.rows[0]!.unitPrice = "92233720368547758.0750";
      expect((await put(overflow)).status).toBe(400);
      const trailingFifthPlace = structuredClone(invalid); trailingFifthPlace.idempotencyKey = randomUUID();
      trailingFifthPlace.bills[0]!.rows[0]!.unitPrice = "1.23450";
      expect((await put(trailingFifthPlace)).status).toBe(400);
      const oldProtocol = structuredClone(invalid); oldProtocol.idempotencyKey = randomUUID();
      oldProtocol.bills[0]!.rows[0]!.unitPrice = "1.2345";
      oldProtocol.bills.forEach(bill => { delete (bill as { numericProtocolVersion?: number }).numericProtocolVersion; });
      const legacyResponse = await put(oldProtocol);
      expect(legacyResponse.status).toBe(400);
      expect((await legacyResponse.json()).message).toMatch(/精度已升级/u);
      expect(await (await fetch(`${base}/contract-drafts/${ids.version}/workbench`, { headers: { "x-contract-numeric-protocol": "2" } })).json()).toEqual(saved);
      const unknown = structuredClone(body); unknown.idempotencyKey = randomUUID(); unknown.expectedRevision = saved.version.draftRevision;
      unknown.bills.forEach(bill => { bill.expectedRevision = saved.bills.find((current: { billKey: string }) => current.billKey === bill.billKey).revision; });
      Object.assign(unknown.bills[0]!.rows[0]!, { quantity: null, unitPrice: null });
      unknown.bills[0]!.rows[1]!.unitPrice = "0";
      expect((await put(unknown)).status).toBe(200);
      const unknownRead = await (await fetch(`${base}/contract-drafts/${ids.version}/workbench`, { headers: { "x-contract-numeric-protocol": "2" } })).json();
      expect(unknownRead.version).toMatchObject({ amountYuan: null, amountCents: null });
      expect(unknownRead.bills[0]).toMatchObject({ taxInclusiveAmountYuan: null, taxInclusiveAmountCents: null });
      expect(unknownRead.bills[0].rows[0]).toMatchObject({ quantity: null, unitPrice: null, taxInclusiveAmountYuan: null });
      expect(unknownRead.bills[0].rows[1]).toMatchObject({ unitPrice: "0.00", taxInclusiveAmountYuan: "0.0000" });
    } finally {
      await http.close(); await cleanupDraft(client, ids); await client.$disconnect();
    }
  }, 45_000);

  // Task06 PREPARED / NOT EXECUTED. No PG/resource authorisation in this phase.
  // Two actual HTTP apps/Prisma pools; synthetic actor injection is not a
  // production authentication/global PermissionGuard or restricted-role proof.
  integrationTest("restores deleted legacy/null/zero facts once under the version lock and replays only public receipts", async () => {
    const databaseUrl = contractDraftAggregateDatabaseUrl(process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL);
    const ids = makeIds("row-undo");
    const appName = `draft-row-undo-${randomUUID()}`;
    const firstUrl = new URL(databaseUrl); firstUrl.searchParams.set("application_name", appName);
    const first = new PrismaClient({ datasources: { db: { url: firstUrl.toString() } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const blocker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const createHttp = async (client: PrismaClient) => {
      const audit = new AuditService();
      const aggregate = new ContractDraftAggregateService(client as never,
        new ContractWorkbenchService(client as never, audit), new ContractBillService(client as never, audit),
        new BusinessPartyService(client as never, audit),
        { assertCanBindContractDraftAttachments: async () => undefined } as never, audit);
      const module = await Test.createTestingModule({ controllers: [ContractDraftController], providers: [
        { provide: ContractDraftAggregateService, useValue: aggregate },
        ...[ContractDraftEditLeaseService, ContractService, PristineDraftDeletionService, ContractDocumentService, ContractV2SubmissionService]
          .map(provide => ({ provide, useValue: {} }))
      ] }).compile();
      const app = module.createNestApplication({ logger: false });
      app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
      app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => { request.user = { id: ids.owner }; next(); });
      app.useGlobalPipes(createApiValidationPipe());
      await app.listen(0, "127.0.0.1");
      return app;
    };
    const apps: Array<Awaited<ReturnType<typeof createHttp>>> = [];
    let releaseLock: (() => void) | undefined;
    const inFlight: Array<Promise<unknown>> = [];
    // Explicit numeric/source projection: no private receipt, actor, credential,
    // arbitrary table dump or generated row id participates in conservation.
    const factSelect = { itemName: true, quantity: true, unitPrice: true, taxRate: true, taxRateSource: true,
      pricingFactStatus: true, precisionPolicy: true, numericProtocolVersion: true, numericSource: true,
      numericReviewStatus: true, taxInclusiveAmountYuan: true, taxExclusiveAmountYuan: true, taxAmountYuan: true,
      taxInclusiveAmountCents: true, taxExclusiveAmountCents: true, taxAmountCents: true, taxExclusiveUnitPrice: true,
      isProvisional: true, customData: true } as const;
    const facts = async () => JSON.parse(JSON.stringify(await observer.contractBillRow.findMany({
      where: { contractBillId: ids.billA }, orderBy: { itemName: "asc" }, select: factSelect
    }), apiJsonReplacer));
    try {
      await seedDraft(first, ids, true);
      await first.contractVersion.update({ where: { id: ids.version }, data: {
        numericProtocolVersion: 2, pricingNature: "unit_price", amountSource: "bill_sum", taxMode: "multiple_rate",
        defaultTaxRatePercent: "0", amountYuan: null
      } });
      await first.contractBill.updateMany({ where: { contractVersionId: ids.version }, data: {
        numericProtocolVersion: 2, quantityScale: 4, unitPriceScale: 4
      } });
      const common = { contractBillId: ids.billA, unit: "项", quantity: "1", taxRate: "0", taxRateSource: "version_default",
        pricingFactStatus: "confirmed", precisionPolicy: "four_decimal", numericProtocolVersion: 2,
        numericSource: "decimal_input", numericReviewStatus: "verified", customData: {} };
      await first.contractBillRow.createMany({ data: [
        { ...common, rowKey: "legacy", sortOrder: 0, itemName: "历史六位", quantity: "1.234567", unitPrice: "2.345678",
          taxRate: "13", taxRateSource: "row_override", taxExclusiveUnitPrice: "8.027106", numericProtocolVersion: 1,
          numericSource: "legacy_cents", numericReviewStatus: "not_assessed", precisionPolicy: "legacy",
          taxInclusiveAmountCents: 991n, taxExclusiveAmountCents: 991n, taxAmountCents: 0n },
        { ...common, rowKey: "unknown", sortOrder: 1, itemName: "未知单价", unitPrice: null, pricingFactStatus: "unconfirmed" },
        { ...common, rowKey: "zero", sortOrder: 2, itemName: "明确零", unitPrice: "0", taxExclusiveUnitPrice: "0",
          taxInclusiveAmountYuan: "0", taxExclusiveAmountYuan: "0", taxAmountYuan: "0",
          taxInclusiveAmountCents: 0n, taxExclusiveAmountCents: 0n, taxAmountCents: 0n }
      ] });
      const original = await facts();
      apps.push(await createHttp(first), await createHttp(second));
      const bases = await Promise.all(apps.map(app => app.getUrl()));
      const put = (base: string, body: unknown) => fetch(`${base}/contract-drafts/${ids.version}`, { method: "PUT",
        headers: { "content-type": "application/json", "x-contract-draft-lease": leaseToken(ids) }, body: JSON.stringify(body) });
      const read = async () => {
        const response = await fetch(`${bases[0]}/contract-drafts/${ids.version}/workbench`, { headers: { "x-contract-numeric-protocol": "2" } });
        expect(response.status).toBe(200); return response.json();
      };
      const lookup = async (key: string) => {
        const response = await fetch(`${bases[0]}/contract-drafts/${ids.version}/save-requests/${key}`, { headers: { "x-contract-numeric-protocol": "2" } });
        expect(response.status).toBe(200); return response.json();
      };
      const deleteBody = { ...aggregateInput(randomUUID()), changedSections: ["draft", "bills"],
        draft: { ...aggregateInput(randomUUID()).draft, pricingNature: "unit_price", amountSource: "bill_sum", manualAmountCents: undefined,
          taxFacts: { ...aggregateInput(randomUUID()).draft.taxFacts, taxMode: "multiple_rate", defaultTaxRatePercent: "0" } },
        bills: [ { billKey: "main", numericProtocolVersion: 2, expectedRevision: 1, rows: [] },
          { billKey: "secondary", numericProtocolVersion: 2, expectedRevision: 1, rows: [] } ] };
      const deletion = await put(bases[0]!, deleteBody); expect(deletion.status).toBe(200);
      const deleted = await deletion.json();
      expect(await facts()).toEqual([]);
      expect(deleted).not.toHaveProperty("_rowUndo");
      const originalLookup = await lookup(deleteBody.idempotencyKey);
      expect(originalLookup.result).toEqual(deleted);
      const refs = deleted.deletedRowRestoreRefs.main as Array<{ saveIntentKey: string; oldRowKey: string; originalValues: Record<string, unknown> }>;
      expect(refs).toHaveLength(3);
      const afterDelete = await read();
      const restoreBody = { ...deleteBody, idempotencyKey: randomUUID(), expectedRevision: afterDelete.version.draftRevision,
        bills: afterDelete.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, numericProtocolVersion: 2,
          expectedRevision: bill.revision, rows: bill.billKey === "main" ? refs.map((ref, index) => ({ ...ref.originalValues,
            clientRowKey: `restore-${index}`, sortOrder: index, restoreRef: { saveIntentKey: ref.saveIntentKey, oldRowKey: ref.oldRowKey } })) : [] })) };
      let locked!: (pid: number) => void;
      const lockedPid = new Promise<number>(resolve => { locked = resolve; });
      const held = new Promise<void>(resolve => { releaseLock = resolve; });
      const lockTask = blocker.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${ids.version} FOR UPDATE`);
        const [identity] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        locked(identity!.pid); await held;
      }, { timeout: 20_000 });
      inFlight.push(lockTask);
      const blockerPid = await lockedPid;
      const winningAttempt = put(bases[0]!, restoreBody); inFlight.push(winningAttempt);
      await waitForBlockedApplication(observer, appName, blockerPid);
      const competingBody = { ...restoreBody, idempotencyKey: randomUUID() };
      const competingAttempt = put(bases[1]!, competingBody); inFlight.push(competingAttempt);
      releaseLock!(); await lockTask;
      const responses = await Promise.all([winningAttempt, competingAttempt]);
      const outcomes = await Promise.all(responses.map(async response => response.status === 400
        ? { status: response.status, error: await response.clone().json() }
        : { status: response.status }));
      expect(outcomes.sort((left, right) => left.status - right.status)).toEqual([{ status: 200 }, { status: 409 }]);
      const winnerIndex = responses.findIndex(response => response.status === 200);
      const winnerBody = winnerIndex === 0 ? restoreBody : competingBody;
      const restored = await responses[winnerIndex]!.json();
      expect(restored).not.toHaveProperty("_rowUndo");
      expect(restored.billRowKeys.main).toHaveLength(3);
      expect(await facts()).toEqual(original);
      const current = await read();
      expect(current.bills.find((bill: { billKey: string }) => bill.billKey === "main").rows).toHaveLength(3);
      const counts = async () => ({ receipts: await observer.contractDraftSaveRequest.count({ where: { contractVersionId: ids.version } }),
        audits: await observer.auditLog.count({ where: { businessId: ids.version } }) });
      const beforeReplay = await counts();
      const replay = await put(bases[0]!, winnerBody); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(restored);
      expect((await lookup(winnerBody.idempotencyKey)).result).toEqual(restored);
      expect((await lookup(deleteBody.idempotencyKey)).result).toEqual(originalLookup.result);
      // Fresh current version AND bill coordinates distinguish consumed-ref
      // rejection from the preceding stale-revision concurrency loser.
      const consumedBody = { ...winnerBody, idempotencyKey: randomUUID(), expectedRevision: current.version.draftRevision,
        bills: winnerBody.bills.map((bill: { billKey: string }) => ({ ...bill,
          expectedRevision: current.bills.find((entry: { billKey: string }) => entry.billKey === bill.billKey).revision })) };
      const consumed = await put(bases[0]!, consumedBody); expect(consumed.status).toBe(400);
      expect((await consumed.json()).message).toMatch(/已经恢复/u);
      expect(await counts()).toEqual(beforeReplay);
      expect(await facts()).toEqual(original);
      expect(await read()).toEqual(current);
    } finally {
      releaseLock?.(); await Promise.allSettled(inFlight);
      await Promise.all(apps.map(app => app.close()));
      await cleanupDraft(first, ids);
      await Promise.all([first, second, blocker, observer].map(client => client.$disconnect()));
    }
  }, 30_000);

  integrationTest(
    "allows one revision winner and rolls back an earlier section after a later failure",
    async () => {
      const databaseUrl = contractDraftAggregateDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const first = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const second = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const seededIds: Array<ReturnType<typeof makeIds>> = [];
      const audit = new AuditService();
      const service = (client: PrismaClient) =>
        new ContractDraftAggregateService(
          client as never,
          new ContractWorkbenchService(client as never, audit),
          new ContractBillService(client as never, audit),
          new BusinessPartyService(client as never, audit),
          {
            assertCanBindContractDraftAttachments: async () => undefined
          } as never,
          audit
        );

      try {
        const concurrentIds = makeIds("concurrent");
        seededIds.push(concurrentIds);
        await seedDraft(first, concurrentIds);
        const concurrent = await Promise.allSettled([
          service(first).saveAggregate(
            concurrentIds.version,
            concurrentIds.owner,
            leaseToken(concurrentIds),
            aggregateInput(randomUUID()) as never
          ),
          service(second).saveAggregate(
            concurrentIds.version,
            concurrentIds.owner,
            leaseToken(concurrentIds),
            aggregateInput(randomUUID()) as never
          )
        ]);
        const concurrentFailures = concurrent.flatMap((result) =>
          result.status === "rejected"
            ? [
                result.reason instanceof Error
                  ? result.reason.stack ?? result.reason.message
                  : String(result.reason)
              ]
            : []
        );

        const fulfilled = concurrent.filter(
          (result) => result.status === "fulfilled"
        );
        if (fulfilled.length !== 1) {
          throw new Error(concurrentFailures.join("\n"));
        }
        expect(fulfilled).toHaveLength(1);
        expect(
          concurrent.filter((result) => result.status === "rejected")
        ).toHaveLength(1);
        const rejected = concurrent.find(
          (result) => result.status === "rejected"
        );
        expect(
          rejected && rejected.status === "rejected"
            ? rejected.reason
            : null
        ).toMatchObject({
          response: expect.objectContaining({
            code: "DRAFT_REVISION_CONFLICT"
          })
        });
        await expect(
          first.contractVersion.findUnique({
            where: { id: concurrentIds.version }
          })
        ).resolves.toMatchObject({ draftRevision: 2 });
        await expect(
          first.contractDraftSaveRequest.count({
            where: { contractVersionId: concurrentIds.version }
          })
        ).resolves.toBe(1);
        await expect(
          first.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: concurrentIds.version
            }
          })
        ).resolves.toBe(1);

        const rollbackIds = makeIds("rollback");
        seededIds.push(rollbackIds);
        await seedDraft(first, rollbackIds, true);
        const rollbackService = new ContractDraftAggregateService(
          first as never,
          new ContractWorkbenchService(first as never, audit),
          {
            replaceRowsInTransaction: async (
              tx: PrismaClient,
              _actorUserId: string,
              _version: unknown,
              bill: { id: string }
            ) => {
              if (bill.id === rollbackIds.billB) {
                throw new Error("second bill validation failed");
              }
              await tx.contractBill.update({
                where: { id: rollbackIds.billA },
                data: { revision: { increment: 1 } }
              });
              return { changed: true, revision: 2, rows: [] };
            }
          } as never,
          {
            replaceContractPartiesInTransaction: async () => ({ changed: false })
          } as never,
          {
            assertCanBindContractDraftAttachments: async () => undefined
          } as never,
          audit
        );
        await expect(
          rollbackService.saveAggregate(
            rollbackIds.version,
            rollbackIds.owner,
            leaseToken(rollbackIds),
            aggregateInput(randomUUID(), true) as never
          )
        ).rejects.toThrow("second bill validation failed");
        await expect(
          first.contractBill.findMany({
            where: { id: { in: [rollbackIds.billA, rollbackIds.billB] } },
            orderBy: { id: "asc" }
          })
        ).resolves.toMatchObject([{ revision: 1 }, { revision: 1 }]);
        await expect(
          first.contractVersion.findUnique({ where: { id: rollbackIds.version } })
        ).resolves.toMatchObject({ draftRevision: 1 });
        await expect(
          first.contractDraftSaveRequest.count({
            where: { contractVersionId: rollbackIds.version }
          })
        ).resolves.toBe(0);
      } finally {
        for (const ids of seededIds.reverse()) {
          await cleanupDraft(first, ids);
        }
        await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      }
    },
    30_000
  );

  integrationTest(
    "records 100, 500 and 1000 row aggregate-save budgets without no-op rewrites",
    async () => {
      const databaseUrl = contractDraftAggregateDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const seededIds: Array<ReturnType<typeof makeIds>> = [];
      const audit = new AuditService();
      const aggregate = new ContractDraftAggregateService(
        client as never,
        new ContractWorkbenchService(client as never, audit),
        new ContractBillService(client as never, audit),
        new BusinessPartyService(client as never, audit),
        {
          assertCanBindContractDraftAttachments: async () => undefined
        } as never,
        audit
      );

      try {
        for (const rowCount of [100, 500, 1000]) {
          const ids = makeIds(`performance-${rowCount}`);
          seededIds.push(ids);
          await seedDraft(client, ids, true);
          const firstInput = aggregatePerformanceInput(
            randomUUID(),
            1,
            1,
            performanceRows(rowCount)
          );
          const auditBefore = await client.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: ids.version
            }
          });
          const receiptsBefore = await client.contractDraftSaveRequest.count({
            where: { contractVersionId: ids.version }
          });
          const firstStartedAt = process.hrtime.bigint();
          const firstResult = await aggregate.saveAggregate(
            ids.version,
            ids.owner,
            leaseToken(ids),
            firstInput as never
          );
          const firstDurationMs = elapsedMilliseconds(firstStartedAt);
          const persistedRows = await client.contractBillRow.findMany({
            where: { contractBillId: ids.billA },
            orderBy: { sortOrder: "asc" }
          });
          const billAfterFirst = await client.contractBill.findUniqueOrThrow({
            where: { id: ids.billA }
          });
          const auditAfterFirst = await client.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: ids.version
            }
          });
          const receiptsAfterFirst =
            await client.contractDraftSaveRequest.count({
              where: { contractVersionId: ids.version }
            });

          expect(persistedRows).toHaveLength(rowCount);
          expect(billAfterFirst.revision).toBe(2);
          expect(firstResult).toMatchObject({
            draftRevision: 2,
            effectiveChangedSections: expect.arrayContaining(["bills"])
          });
          expect(auditAfterFirst - auditBefore).toBe(0);
          expect(receiptsAfterFirst - receiptsBefore).toBe(1);

          const noChangeInput = aggregatePerformanceInput(
            randomUUID(),
            2,
            2,
            persistedRows.map((row) => ({
              clientRowKey: `existing-${row.sortOrder}`,
              rowKey: row.rowKey,
              sortOrder: row.sortOrder,
              itemCode: row.itemCode ?? undefined,
              itemName: row.itemName,
              specification: row.specification ?? undefined,
              unit: row.unit,
              quantity: row.quantity?.toString(),
              unitPrice: row.unitPrice?.toString() ?? "0",
              taxRatePercent: row.taxRate?.toString(),
              taxRateSource: row.taxRateSource as
                | "version_default"
                | "row_override",
              isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis ?? undefined,
              customData: row.customData
            }))
          );
          const noChangeStartedAt = process.hrtime.bigint();
          const noChangeResult = await aggregate.saveAggregate(
            ids.version,
            ids.owner,
            leaseToken(ids),
            noChangeInput as never
          );
          const noChangeDurationMs = elapsedMilliseconds(noChangeStartedAt);
          const [
            billAfterNoChange,
            auditAfterNoChange,
            receiptsAfterNoChange
          ] = await Promise.all([
            client.contractBill.findUniqueOrThrow({ where: { id: ids.billA } }),
            client.auditLog.count({
              where: {
                action: "contract.draft.save",
                businessId: ids.version
              }
            }),
            client.contractDraftSaveRequest.count({
              where: { contractVersionId: ids.version }
            })
          ]);

          expect(noChangeResult).toMatchObject({
            draftRevision: 2,
            effectiveChangedSections: []
          });
          expect(billAfterNoChange.revision).toBe(2);
          expect(auditAfterNoChange).toBe(auditAfterFirst);
          expect(receiptsAfterNoChange - receiptsAfterFirst).toBe(1);
          expect(firstDurationMs).toBeLessThan(30_000);
          expect(noChangeDurationMs).toBeLessThan(10_000);

          process.stdout.write(
            `${JSON.stringify({
              event: "contract_draft_aggregate_performance",
              rowCount,
              requestBytes: Buffer.byteLength(JSON.stringify(firstInput)),
              transactionDurationMs: Number(firstDurationMs.toFixed(2)),
              lockHoldUpperBoundMs: Number(firstDurationMs.toFixed(2)),
              changedRows: rowCount,
              saveRequestGrowth: receiptsAfterFirst - receiptsBefore,
              auditLogGrowth: auditAfterFirst - auditBefore,
              noChangeRequestBytes: Buffer.byteLength(
                JSON.stringify(noChangeInput)
              ),
              noChangeTransactionDurationMs: Number(
                noChangeDurationMs.toFixed(2)
              ),
              noChangeLockHoldUpperBoundMs: Number(
                noChangeDurationMs.toFixed(2)
              ),
              noChangeChangedRows: 0,
              noChangeSaveRequestGrowth:
                receiptsAfterNoChange - receiptsAfterFirst,
              noChangeAuditLogGrowth: auditAfterNoChange - auditAfterFirst
            })}\n`
          );
        }
      } finally {
        for (const ids of seededIds.reverse()) {
          await cleanupDraft(client, ids);
        }
        await client.$disconnect();
      }
    },
    120_000
  );

  integrationTest(
    "reads formal blockers from a fresh PostgreSQL snapshot after waiting for the version lock",
    async () => {
      const databaseUrl = contractDraftAggregateDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const writer = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const reader = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const observer = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const ids = makeIds("formal-snapshot");
      const formalFileId = `formal-file-${randomUUID()}`;
      const pendingTransactions: Promise<unknown>[] = [];
      let releaseWriter!: () => void;
      const writerRelease = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      let formalInserted!: (pid: number) => void;
      const formalInsertReady = new Promise<number>((resolve) => {
        formalInserted = resolve;
      });
      let readerPidReady!: (pid: number) => void;
      const readerPid = new Promise<number>((resolve) => {
        readerPidReady = resolve;
      });

      try {
        await seedDraft(writer, ids);
        await writer.fileObject.create({
          data: {
            id: formalFileId,
            bucket: "local-test",
            objectKey: `contract-draft-boundary/${formalFileId}.pdf`,
            originalName: "合同草稿正式化边界验证.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            uploadedByUserId: ids.owner,
            contentSha256: "a".repeat(64)
          }
        });
        const writerTransaction = writer.$transaction(async (tx) => {
          const [writerPid] = await tx.$queryRaw<Array<{ pid: number }>>(
            Prisma.sql`SELECT pg_backend_pid()::int AS pid`
          );
          if (!writerPid) throw new Error("无法读取 PostgreSQL writer 连接 pid");
          await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "ContractVersion"
            WHERE "id" = ${ids.version}
            FOR UPDATE
          `);
          await tx.contractFormalFile.create({
            data: {
              contractVersionId: ids.version,
              purpose: "mutually_signed_final",
              fileId: formalFileId,
              contentSha256: "a".repeat(64),
              pageCount: 1,
              sourceRevision: 1,
              status: "active",
              uploadedByUserId: ids.owner,
              declarationSnapshot: {},
              declaredByUserId: ids.owner,
              declaredAt: new Date()
            }
          });
          formalInserted(writerPid.pid);
          await writerRelease;
        });
        pendingTransactions.push(writerTransaction);
        const writerPid = await Promise.race([
          formalInsertReady,
          writerTransaction.then(
            () => {
              throw new Error("正式文件 writer 在发出插入信号前意外结束");
            },
            (error: unknown) => {
              throw error;
            }
          )
        ]);

        const boundaryTransaction = reader.$transaction(
          async (tx) => {
            const [pidRow] = await tx.$queryRaw<Array<{ pid: number }>>(
              Prisma.sql`SELECT pg_backend_pid()::int AS pid`
            );
            if (!pidRow) throw new Error("无法读取 PostgreSQL 测试连接 pid");
            readerPidReady(pidRow.pid);
            return lockContractDraftMutationBoundary(tx, ids.version);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        );
        pendingTransactions.push(boundaryTransaction);
        const pid = await Promise.race([
          readerPid,
          boundaryTransaction.then(
            () => {
              throw new Error("草稿边界 reader 在发出连接 pid 前意外结束");
            },
            (error: unknown) => {
              throw error;
            }
          )
        ]);
        await waitForPostgresLockWait(observer, pid, writerPid);

        releaseWriter();
        const [boundary] = await Promise.all([
          boundaryTransaction,
          writerTransaction
        ]);

        expect(boundary?.formalBlockers).toContain("存在双方签署正式文件");
      } finally {
        releaseWriter();
        await Promise.allSettled(pendingTransactions);
        await writer.contractFormalFile.deleteMany({
          where: { contractVersionId: ids.version }
        });
        await writer.fileObject.deleteMany({ where: { id: formalFileId } });
        await cleanupDraft(writer, ids);
        await Promise.allSettled([
          writer.$disconnect(),
          reader.$disconnect(),
          observer.$disconnect()
        ]);
      }
    },
    30_000
  );

  integrationTest(
    "maps a Serializable aggregate save to conflict when formalization commits while it waits",
    async () => {
      const databaseUrl = contractDraftAggregateDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const readerUrl = new URL(databaseUrl);
      readerUrl.searchParams.set(
        "application_name",
        "contract-draft-aggregate-formal-reader"
      );
      const writer = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const reader = new PrismaClient({
        datasources: { db: { url: readerUrl.toString() } }
      });
      const observer = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const audit = new AuditService();
      const aggregate = new ContractDraftAggregateService(
        reader as never,
        new ContractWorkbenchService(reader as never, audit),
        new ContractBillService(reader as never, audit),
        new BusinessPartyService(reader as never, audit),
        {
          assertCanBindContractDraftAttachments: async () => undefined
        } as never,
        audit
      );
      const ids = makeIds("serializable-formalization");
      const formalFileId = `formal-file-${randomUUID()}`;
      const pendingTransactions: Promise<unknown>[] = [];
      let releaseWriter!: () => void;
      const writerRelease = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      let formalizationReady!: (pid: number) => void;
      const formalizationPid = new Promise<number>((resolve) => {
        formalizationReady = resolve;
      });

      try {
        await seedDraft(writer, ids);
        await writer.fileObject.create({
          data: {
            id: formalFileId,
            bucket: "local-test",
            objectKey: `contract-draft-boundary/${formalFileId}.pdf`,
            originalName: "合同正式化并发验证.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            uploadedByUserId: ids.owner,
            contentSha256: "b".repeat(64)
          }
        });
        const writerTransaction = writer.$transaction(
          async (tx) => {
            const [writerPid] = await tx.$queryRaw<Array<{ pid: number }>>(
              Prisma.sql`SELECT pg_backend_pid()::int AS pid`
            );
            if (!writerPid) throw new Error("无法读取 PostgreSQL writer 连接 pid");
            await tx.$queryRaw(Prisma.sql`
              SELECT "id"
              FROM "Contract"
              WHERE "id" = ${ids.contract}
              FOR UPDATE
            `);
            await tx.$queryRaw(Prisma.sql`
              SELECT "id"
              FROM "ContractVersion"
              WHERE "id" = ${ids.version}
              FOR UPDATE
            `);
            await tx.contractFormalFile.create({
              data: {
                contractVersionId: ids.version,
                purpose: "mutually_signed_final",
                fileId: formalFileId,
                contentSha256: "b".repeat(64),
                pageCount: 1,
                sourceRevision: 1,
                status: "active",
                uploadedByUserId: ids.owner,
                declarationSnapshot: {},
                declaredByUserId: ids.owner,
                declaredAt: new Date()
              }
            });
            await tx.contractVersion.update({
              where: { id: ids.version },
              data: { status: "pending_archive_confirm" }
            });
            formalizationReady(writerPid.pid);
            await writerRelease;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        pendingTransactions.push(writerTransaction);
        const writerPid = await Promise.race([
          formalizationPid,
          writerTransaction.then(
            () => {
              throw new Error("正式化 writer 在发出锁信号前意外结束");
            },
            (error: unknown) => {
              throw error;
            }
          )
        ]);

        const aggregateSave = aggregate.saveAggregate(
          ids.version,
          ids.owner,
          leaseToken(ids),
          aggregateInput(randomUUID()) as never
        );
        void aggregateSave.catch(() => undefined);
        pendingTransactions.push(aggregateSave);
        await waitForBlockedApplication(
          observer,
          "contract-draft-aggregate-formal-reader",
          writerPid
        );

        releaseWriter();
        await expect(aggregateSave).rejects.toMatchObject({
          response: expect.objectContaining({
            code: "DRAFT_REVISION_CONFLICT",
            conflictReason: "serialization_failure"
          })
        });
        await expect(
          writer.contractVersion.findUnique({ where: { id: ids.version } })
        ).resolves.toMatchObject({
          draftRevision: 1,
          status: "pending_archive_confirm"
        });
        await expect(
          writer.contractDraftSaveRequest.count({
            where: { contractVersionId: ids.version }
          })
        ).resolves.toBe(0);
        await expect(
          writer.auditLog.count({
            where: {
              action: "contract.draft.save",
              businessId: ids.version
            }
          })
        ).resolves.toBe(0);
      } finally {
        releaseWriter();
        await Promise.allSettled(pendingTransactions);
        await writer.contractFormalFile.deleteMany({
          where: { contractVersionId: ids.version }
        });
        await writer.fileObject.deleteMany({ where: { id: formalFileId } });
        await cleanupDraft(writer, ids);
        await Promise.allSettled([
          writer.$disconnect(),
          reader.$disconnect(),
          observer.$disconnect()
        ]);
      }
    },
    30_000
  );
});

function makeIds(kind: string) {
  const suffix = randomUUID();
  return {
    owner: `draft-aggregate-owner-${suffix}`,
    project: `draft-aggregate-project-${suffix}`,
    contract: `draft-aggregate-contract-${suffix}`,
    version: `draft-aggregate-version-${suffix}`,
    billA: `draft-aggregate-bill-${suffix}-a`,
    billB: `draft-aggregate-bill-${suffix}-b`,
    kind
  };
}

async function seedDraft(
  client: PrismaClient,
  ids: ReturnType<typeof makeIds>,
  withBill = false
) {
  await client.user.create({
    data: { id: ids.owner, name: `聚合${ids.kind}经办人` }
  });
  await client.project.create({
    data: {
      id: ids.project,
      code: `DRAFT-AGG-${randomUUID()}`,
      name: `聚合${ids.kind}项目`
    }
  });
  await client.contract.create({
    data: {
      id: ids.contract,
      projectId: ids.project,
      source: "system",
      code: null,
      temporaryCode: `DRAFT-AGG-${randomUUID()}`,
      name: `聚合${ids.kind}合同`,
      counterparty: "聚合并发验证单位",
      contractTypeKey: "material_purchase",
      ownerUserId: ids.owner
    }
  });
  await client.contractVersion.create({
    data: {
      id: ids.version,
      contractId: ids.contract,
      versionNo: 1,
      changeType: "original",
      status: "draft",
      amountCents: 0n,
      draftRevision: 1,
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountLimitType: "capped",
      defaultTaxRatePercent: "13",
      draftData: {},
      templateSnapshot: {
        fieldSchema: [],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: []
      },
      clauseSnapshot: []
    }
  });
  await client.contractDraftEditLease.create({
    data: {
      contractVersionId: ids.version,
      holderUserId: ids.owner,
      tokenHash: createHash("sha256").update(leaseToken(ids)).digest("hex"),
      expiresAt: new Date(Date.now() + 120_000)
    }
  });
  if (withBill) {
    await client.contractBill.createMany({
      data: [
        {
          id: ids.billA,
          contractVersionId: ids.version,
          billKey: "main",
          name: "主清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          schemaSnapshot: { columns: [] }
        },
        {
          id: ids.billB,
          contractVersionId: ids.version,
          billKey: "secondary",
          name: "第二清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          schemaSnapshot: { columns: [] }
        }
      ]
    });
  }
}

function leaseToken(ids: ReturnType<typeof makeIds>) {
  return `${LEASE_TOKEN_PREFIX}:${ids.version}`;
}

function aggregateInput(idempotencyKey: string, withBill = false) {
  return {
    idempotencyKey,
    saveKind: "manual" as const,
    expectedRevision: 1,
    changedSections: ["draft"] as const,
    draft: {
      draftData: {},
      clauses: [],
      pricingNature: "fixed_total" as const,
      amountSource: "manual" as const,
      manualAmountCents: "100",
      taxFacts: {
        invoiceType: null,
        taxMode: "single_rate" as const,
        defaultTaxRatePercent: null,
        source: "contract_document" as const
      }
    },
    parties: [],
    bills: withBill
      ? [
          { billKey: "main", expectedRevision: 1, rows: [] },
          { billKey: "secondary", expectedRevision: 1, rows: [] }
        ]
      : [],
    paymentTerms: null,
    attachments: [],
    negotiationDocuments: {
      referencedGeneratedDocumentIds: []
    }
  };
}

function performanceRows(rowCount: number) {
  return Array.from({ length: rowCount }, (_, index) => ({
    clientRowKey: `new-${index}`,
    sortOrder: index,
    itemCode: `ITEM-${index + 1}`,
    itemName: `性能验证清单行 ${index + 1}`,
    unit: "项",
    quantity: "1",
    unitPrice: "1.00",
    taxRatePercent: "13",
    taxRateSource: "version_default" as const,
    isProvisional: false,
    customData: {}
  }));
}

function aggregatePerformanceInput(
  idempotencyKey: string,
  expectedRevision: number,
  expectedBillRevision: number,
  rows: Array<Record<string, unknown>>
) {
  const base = aggregateInput(idempotencyKey, true);
  return {
    ...base,
    saveKind: "auto" as const,
    expectedRevision,
    changedSections: ["draft", "bills"] as const,
    draft: {
      ...base.draft,
      amountSource: "bill_sum" as const,
      manualAmountCents: undefined,
      taxFacts: {
        ...base.draft.taxFacts,
        defaultTaxRatePercent: "13"
      }
    },
    bills: [
      {
        billKey: "main",
        expectedRevision: expectedBillRevision,
        rows
      },
      {
        billKey: "secondary",
        expectedRevision: 1,
        rows: []
      }
    ]
  };
}

function elapsedMilliseconds(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function waitForPostgresLockWait(
  client: PrismaClient,
  pid: number,
  blockerPid: number
) {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const [activity] = await client.$queryRaw<Array<{
      waitEventType: string | null;
      blockingPids: number[];
    }>>(Prisma.sql`
      SELECT
        "wait_event_type" AS "waitEventType",
        pg_blocking_pids("pid") AS "blockingPids"
      FROM "pg_stat_activity"
      WHERE "pid" = ${pid}
    `);
    if (
      activity?.waitEventType === "Lock" &&
      activity.blockingPids.includes(blockerPid)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("合同草稿边界未在预期时间内等待指定 writer 锁");
}

async function waitForBlockedApplication(
  client: PrismaClient,
  applicationName: string,
  blockerPid: number
) {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const [activity] = await client.$queryRaw<Array<{
      waitEventType: string | null;
      blockingPids: number[];
    }>>(Prisma.sql`
      SELECT
        "wait_event_type" AS "waitEventType",
        pg_blocking_pids("pid") AS "blockingPids"
      FROM "pg_stat_activity"
      WHERE "application_name" = ${applicationName}
        AND "datname" = current_database()
        AND "wait_event_type" = 'Lock'
      ORDER BY "query_start" DESC
      LIMIT 1
    `);
    if (
      activity?.waitEventType === "Lock" &&
      activity.blockingPids.includes(blockerPid)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("合同草稿聚合保存未在预期时间内等待正式化 writer 锁");
}

async function cleanupDraft(
  client: PrismaClient,
  ids: ReturnType<typeof makeIds>
) {
  await client.contractFormalFile.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.contractDraftSaveRequest.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.auditLog.deleteMany({ where: { businessId: ids.version } });
  await client.contractDraftEditLease.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.contractBillRow.deleteMany({
    where: { contractBillId: { in: [ids.billA, ids.billB] } }
  });
  await client.contractBillRowLineage.deleteMany({
    where: { createdInContractVersionId: ids.version }
  });
  await client.contractBill.deleteMany({
    where: { contractVersionId: ids.version }
  });
  await client.contractVersion.deleteMany({ where: { id: ids.version } });
  await client.contract.deleteMany({ where: { id: ids.contract } });
  await client.project.deleteMany({ where: { id: ids.project } });
  await client.user.deleteMany({ where: { id: ids.owner } });
}
