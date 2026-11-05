// Real Nest controllers/services; only persistence, authentication and private
// file storage are synthetic. No PrismaClient, AppModule, SQL engine or gateway.
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
process.umask(0o077);
for (const key of ["DATABASE_URL", "DIRECT_URL", "DIRECT_DATABASE_URL", "SHADOW_DATABASE_URL"]) delete process.env[key];
Object.assign(process.env, { NODE_ENV: "test", APPROVAL_SMS_ENABLED: "false", AUTH_SMS_ENABLED: "false", SMS_ENABLED: "false" });
const root = path.resolve(__dirname, "../../../..");
const req = createRequire(path.join(root, "services/api/package.json"));
const { Prisma } = req("@prisma/client");
const { Test } = req("@nestjs/testing");
const load = name => req(path.join(root, "services/api/dist", name + ".js"));
const { ContractDraftController } = load("contract-workbench/contract-draft.controller");
const { ContractDraftAggregateService } = load("contract-workbench/contract-draft-aggregate.service");
const { ContractWorkbenchService } = load("contract-workbench/contract-workbench.service");
const { ContractDraftEditLeaseService } = load("contract-workbench/contract-draft-edit-lease.service");
const { ContractBillService } = load("contract-bill/contract-bill.service");
const { BusinessPartyService } = load("business-party/business-party.service");
const { ContractBillExcelService } = load("contract-bill/contract-bill-excel.service");
const { ContractDraftBillExcelController } = load("contract-bill/contract-draft-bill-excel.controller");
const { ContractService } = load("contract/contract.service");
const { PristineDraftDeletionService } = load("contract-workbench/pristine-draft-deletion.service");
const { ContractDocumentService } = load("contract-document/contract-document.service");
const { AuditService } = load("audit/audit.service");
const { FileService } = load("file/file.service");
const D = value => new Prisma.Decimal(value);
const now = new Date();
const actor = { id: "grid-actor", name: "合成合同经办人", phone: null, mustChangePassword: false, roleKeys: ["contract_staff"], globalRoleKeys: ["contract_staff"] };
const otherActor = { ...actor, id: "grid-prior-owner", name: "合成前经办人" };
const otherSession = { user: otherActor, accessToken: randomBytes(24).toString("hex"), refreshToken: randomBytes(24).toString("hex") };
const session = { user: actor, accessToken: randomBytes(24).toString("hex"), refreshToken: randomBytes(24).toString("hex") };
const project = { id: "grid-project", code: "合成项目", name: "本地合同表格验收项目", isActive: true };
const contract = { id: "grid-contract", projectId: project.id, ownerUserId: actor.id, name: "本地合成合同", code: null, temporaryCode: "合成草稿", voidedAt: null, contractTypeKey: "material_purchase", createdAt: now, updatedAt: now };
const bill = { id: "grid-bill", contractVersionId: "grid-version", billKey: "main", name: "合成四位材料清单", revision: 1, numericProtocolVersion: 2, pricingMode: "tax_inclusive", amountRole: "included", quantityScale: 4, unitPriceScale: 4, schemaSnapshot: { key: "main", name: "合成四位材料清单", columns: [] }, sourceExcelFileId: null, taxInclusiveAmountCents: 307n, taxExclusiveAmountCents: 307n, taxAmountCents: 0n, taxInclusiveAmountYuan: D("3.0680"), taxExclusiveAmountYuan: D("3.0680"), taxAmountYuan: D(0) };
const version = { id: "grid-version", contractId: contract.id, versionNo: 1, status: "draft", changeType: "original", baseVersionId: null, firstSubmittedAt: null, abandonedAt: null, abandonedByUserId: null, abandonReason: null, numericProtocolVersion: 2, contractGovernanceVersion: null, draftRevision: 1, documentContentRevision: 1, documentContentFingerprint: null, amountLimitType: "capped", pricingNature: "unit_price", amountSource: "bill_sum", amountCents: 307n, amountYuan: D("3.0680"), estimatedAmountCents: null, amountAdjustmentReason: null, invoiceType: "vat_special", taxMode: "single_rate", defaultTaxRatePercent: D(0), taxFactStatus: "draft", taxFactSource: "contract_document", taxFactRevision: 1, taxFactsFrozenAt: null, settlementMode: "settlement_required", settlementModeConfirmedAt: null, businessTemplateVersionId: null, layoutTemplateVersionId: null, readinessSnapshot: null, clauseSnapshot: [], templateSnapshot: { fieldSchema: [], billSchema: [bill.schemaSnapshot], clauseSchema: [], attachmentSchema: [], validationSchema: [] }, draftData: { fieldValues: {}, contractName: "本地合成合同" }, createdAt: now, updatedAt: now };
const rows = ["级配碎石", "长名称材料用于核验表格与局部滚动"].map((name, index) => ({ id: `grid-row-${index}`, contractBillId: bill.id, rowKey: `grid-row-key-${index}`, sortOrder: index, itemCode: "", itemName: name, specification: "合成规格", unit: "吨", quantity: D(1), unitPrice: D("1.5340"), taxExclusiveUnitPrice: D("1.5340"), taxInclusiveAmountYuan: D("1.5340"), taxExclusiveAmountYuan: D("1.5340"), taxAmountYuan: D(0), taxInclusiveAmountCents: 153n, taxExclusiveAmountCents: 153n, taxAmountCents: 0n, taxRateSource: "version_default", taxRatePercent: D(0), precisionPolicy: "four_decimal", numericProtocolVersion: 2, numericSource: "decimal_input", numericReviewStatus: "verified", taxRate: D(0), pricingFactStatus: "confirmed", isProvisional: false, settlementBasis: "", customData: {}, lineageId: null, remainderDisposition: null }));
let state = { contract: [contract], contractVersion: [version], contractBill: [bill], contractBillRow: rows, project: [project], user: [{ ...actor, isActive: true }, { ...otherActor, isActive: true }], userPosition: [], position: [], contractDraftEditLease: [], contractDraftSaveRequest: [] };
for (const name of ["approvalInstance", "approvalActionLog", "contractFormalFile", "contractAuthorization", "contractVersionAuthorizationLink", "contractSealTask", "contractArchiveFile", "settlement", "paymentRequest", "contractTakeover", "contractDraftCheckpoint", "contractGeneratedDocument", "contractPartySnapshot", "paymentTermsVersion", "paymentTermsStage", "contractDraftAttachment", "contractNegotiationRound", "contractOfflineRevision", "auditLog", "contractBillRowLineage", "contractBillRowTransition", "fileObject", "businessEntrySubmissionSnapshot"]) state[name] = [];
// All unseeded generated models are explicitly empty synthetic tables. This
// enables the real file ACL to reject absent business bindings, not bypass it.
for (const model of Prisma.dmmf.datamodel.models) state[model.name[0].toLowerCase() + model.name.slice(1)] ??= [];
const clone = value => value instanceof Date ? new Date(value) : Prisma.Decimal.isDecimal(value) ? D(value.toString()) : Array.isArray(value) ? value.map(clone) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const initialState = clone(state);
function matches(record, where = {}) {
  return Object.entries(where).every(([key, wanted]) => {
    if (key === "AND") return (Array.isArray(wanted) ? wanted : [wanted]).every(item => matches(record, item));
    if (key === "OR") return wanted.some(item => matches(record, item));
    if (key === "contractVersionId_billKey") return matches(record, wanted);
    const actual = record[key];
    if (wanted && typeof wanted === "object" && !Prisma.Decimal.isDecimal(wanted) && !(wanted instanceof Date)) {
      return Object.entries(wanted).every(([operator, value]) => {
        if (operator === "in") return value.includes(actual);
        if (operator === "notIn") return !value.includes(actual);
        if (operator === "not") return actual !== value;
        if (operator === "gt") return actual > value;
        if (operator === "gte") return actual >= value;
        if (operator === "lt") return actual < value;
        if (operator === "equals") return actual === value;
        throw Error(`Unsupported synthetic filter: ${key}.${operator}`);
      });
    }
    return actual === wanted || (actual instanceof Date && wanted instanceof Date && +actual === +wanted);
  });
}
const decimalColumns = new Set(["quantity", "unitPrice", "taxExclusiveUnitPrice", "taxRate", "defaultTaxRatePercent", "amountYuan", "taxInclusiveAmountYuan", "taxExclusiveAmountYuan", "taxAmountYuan"]);
function assign(record, data) {
  for (const [key, value] of Object.entries(data)) record[key] = value && typeof value === "object" && "increment" in value ? record[key] + value.increment : value !== null && decimalColumns.has(key) ? D(value) : clone(value);
  return clone(record);
}
const db = {};
for (const table of Object.keys(state)) {
  const find = ({ where = {}, orderBy } = {}) => {
    const found = state[table].filter(record => matches(record, where));
    const ordering = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
    const fields = new Set(["id", "sortOrder", "contractBillId", "billKey", "createdAt", "roleKey", "displayOrder", "versionNo", "revision", "sequenceNo", "side", "updatedAt", "slotKey"]);
    for (const order of ordering) for (const [field, direction] of Object.entries(order)) {
      if (!fields.has(field) || !["asc", "desc"].includes(direction)) throw Error("Unsupported synthetic ordering");
    }
    return found.sort((left, right) => {
      for (const order of ordering) for (const [field, direction] of Object.entries(order)) {
        const a = left[field], b = right[field];
        const compared = a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0;
        if (compared) return direction === "asc" ? compared : -compared;
      }
      return 0;
    });
  };
  const enrich = record => {
    if (!record) return null;
    const version = table === "contractBill" ? state.contractVersion.find(item => item.id === record.contractVersionId) : null;
    return { ...clone(record), ...(version ? { contractVersion: { ...clone(version), contract: clone(state.contract.find(item => item.id === version.contractId)) } } : {}) };
  };
  db[table] = {
    findUnique: async args => enrich(find(args)[0]), findFirst: async args => enrich(find(args)[0]), findMany: async args => find(args).map(enrich), count: async args => find(args).length,
    create: async ({ data }) => { const item = { id: randomUUID(), createdAt: new Date() }; assign(item, data); state[table].push(item); return clone(item); },
    createMany: async ({ data }) => { for (const item of data) await db[table].create({ data: item }); return { count: data.length }; },
    update: async ({ where, data }) => { const item = find({ where })[0]; if (!item) throw Error(`Missing synthetic ${table}`); return assign(item, data); },
    updateMany: async ({ where, data }) => { const found = find({ where }); found.forEach(item => assign(item, data)); return { count: found.length }; },
    deleteMany: async ({ where } = {}) => { const found = find({ where }); state[table] = state[table].filter(item => !found.includes(item)); return { count: found.length }; },
    upsert: async ({ where, create, update }) => find({ where }).length ? db[table].update({ where, data: update }) : db[table].create({ data: create })
  };
}
db.$transaction = async run => { const previous = clone(state); try { return await run(db); } catch (error) { state = previous; throw error; } };
db.$queryRaw = async query => {
  const text = query.strings?.join(" ") ?? "";
  if (text.includes('FROM "ContractFormalFile"')) { const id = query.values[0]; return [{ hasSignedFormalFile: state.contractFormalFile.some(file => file.contractVersionId === id && file.status === 'active' && file.purpose === 'mutually_signed_final'), hasActiveSealTask: state.contractSealTask.some(task => task.contractVersionId === id && task.status !== 'cancelled'), hasArchiveFile: state.contractArchiveFile.some(file => file.contractVersionId === id), hasSettlement: state.settlement.some(item => item.contractVersionId === id), hasPaymentRequest: state.paymentRequest.some(item => item.contractVersionId === id) }]; }
  if (text.includes('FROM "Contract" c')) { const version = state.contractVersion.find(item => item.id === query.values[0]); return clone(state.contract.filter(item => item.id === version?.contractId)); }
  if (text.includes('FROM "ContractVersion"')) return state.contractVersion.filter(item => item.id === query.values[0]).map(item => ({ ...clone(item), hasHistoricalTakeoverRelation: false }));
  if (text.includes('FROM "ContractBill"')) return clone(state.contractBill);
  if (text.includes('FROM "ContractBillRow"')) return clone(state.contractBillRow);
  if (text.includes('FROM "ContractDraftEditLease"')) return clone(state.contractDraftEditLease);
  if (["ContractPartySnapshot", "PaymentTermsVersion", "PaymentTermsStage"].some(table => text.includes(`FROM "${table}"`))) return [];
  throw Error("Unsupported synthetic lock query; no SQL is executed");
};
const buffers = new Map();
let delayNextSaveResponse = false;
let delayNextPreviewResponse = false;
let heldPreviewResponse = null;
let dropNextSaveResponse = false;
let nextWorkbenchResponseFailure = null;
let dropNextFileResponse = false;
let heldSaveResponse = null;
let holdNextSaveRequest = false;
let heldSaveRequest = null;
let storageReads = 0;
const storage = {
  bucketName: () => "synthetic-private-grid",
  write: async (key, buffer) => { buffers.set(key, Buffer.from(buffer)); },
  read: async key => { storageReads += 1; if (!buffers.has(key)) throw Error("Unknown synthetic private object"); return Buffer.from(buffers.get(key)); },
  delete: async key => { buffers.delete(key); }
};
async function main() {
  const audit = new AuditService();
  const files = new FileService(db, audit, storage);
  const fixtureWorkbook = new (req("exceljs").Workbook)();
  const fixtureSheet = fixtureWorkbook.addWorksheet("清单数据");
  fixtureSheet.addRow(["项目编号", "项目名称", "规格型号", "单位", "数量", "含税单价(元)", "不含税单价(元)", "税率(%)", "是否暂定", "结算依据"]);
  fixtureSheet.addRow(["", "有权读取的导入材料", "", "吨", "1", "1.2345", "", "0", "否", ""]);
  const fixtureBuffer = Buffer.from(await fixtureWorkbook.xlsx.writeBuffer());
  const workbench = new ContractWorkbenchService(db, audit);
  const aggregate = new ContractDraftAggregateService(db, workbench, new ContractBillService(db, audit), new BusinessPartyService(db, audit), files, audit);
  const lease = new ContractDraftEditLeaseService(db, { confirmPassword: async () => { throw Error("Password actions outside grid acceptance"); } }, audit);
  const excel = new ContractBillExcelService(db, audit, files);
  const module = await Test.createTestingModule({ controllers: [ContractDraftController, ContractDraftBillExcelController], providers: [
    { provide: ContractDraftAggregateService, useValue: aggregate }, { provide: ContractDraftEditLeaseService, useValue: lease }, { provide: ContractBillExcelService, useValue: excel },
    { provide: ContractDocumentService, useValue: { queueDraftPreview: async () => { throw new (req("@nestjs/common").BadRequestException)("本地表格验收未接入文书生成，请在文书验收入口核对"); } } },
    ...[ContractService, PristineDraftDeletionService].map(provide => ({ provide, useValue: {} }))
  ] }).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(req(path.join(root, "services/api/dist/validation/api-validation.js")).createApiValidationPipe());
  app.use(req("express").json());
  app.use((request, response, next) => {
    if (request.method === "GET" && request.path === "/__grid_fixture/health") return response.json({ status: "synthetic_http_only", pid: process.pid });
    if (request.method === "GET" && request.path === "/__grid_fixture/session") return response.json(request.query.actor === "prior-owner" ? otherSession : session);
    const authenticated = request.headers.authorization === `Bearer ${session.accessToken}` ? actor : request.headers.authorization === `Bearer ${otherSession.accessToken}` ? otherActor : null;
    if (!authenticated) return response.status(401).json({ message: "仅限本地合成验收会话" });
    request.user = authenticated;
    if (request.method === "GET" && request.path === "/__grid_fixture/storage-reads") return response.json({ reads: storageReads });
    if (request.method === "POST" && request.path === "/__grid_fixture/reset") {
      heldPreviewResponse?.response.destroy();
      heldPreviewResponse = null;
      delayNextPreviewResponse = false;
      heldSaveResponse?.response.destroy();
      heldSaveResponse = null;
      delayNextSaveResponse = false;
      dropNextSaveResponse = false;
      nextWorkbenchResponseFailure = null;
      dropNextFileResponse = false;
      holdNextSaveRequest = false;
      heldSaveRequest = null;
      state = clone(initialState);
      const preset = request.body?.preset;
      if (preset !== undefined && !["legacy-null-zero", "two-drafts", "prior-owner-deletion", "file-permissions", "existing-layout"].includes(preset)) return response.status(400).json({ message: "未知合成初始场景" });
      if (preset === "existing-layout") state.contractVersion[0].layoutTemplateVersionId = "grid-existing-retired-layout-version";
      if (preset === "legacy-null-zero") {
        const historical = { ...clone(rows[0]), itemName: "六位历史原事实", quantity: D("1.234567"), unitPrice: D("2.345678"), taxExclusiveUnitPrice: D("8.027106"), numericProtocolVersion: 1, numericSource: "legacy_cents", numericReviewStatus: "not_assessed", precisionPolicy: "legacy", taxInclusiveAmountYuan: null, taxExclusiveAmountYuan: null, taxAmountYuan: null, taxInclusiveAmountCents: 991n, taxExclusiveAmountCents: 991n, taxAmountCents: 0n };
        const unknown = { ...clone(rows[1]), itemName: "未知单价原事实", unitPrice: null, taxExclusiveUnitPrice: null, taxInclusiveAmountYuan: null, taxExclusiveAmountYuan: null, taxAmountYuan: null, taxInclusiveAmountCents: null, taxExclusiveAmountCents: null, taxAmountCents: null, pricingFactStatus: "unconfirmed" };
        const zero = { ...clone(rows[1]), id: "grid-row-zero", rowKey: "grid-row-key-zero", sortOrder: 2, itemName: "明确零单价原事实", unitPrice: D(0), taxExclusiveUnitPrice: D(0), taxInclusiveAmountYuan: D(0), taxExclusiveAmountYuan: D(0), taxAmountYuan: D(0), taxInclusiveAmountCents: 0n, taxExclusiveAmountCents: 0n, taxAmountCents: 0n };
        state.contractBillRow = [historical, unknown, zero];
        Object.assign(state.contractBill[0], { taxInclusiveAmountYuan: null, taxExclusiveAmountYuan: null, taxAmountYuan: null, taxInclusiveAmountCents: 0n, taxExclusiveAmountCents: 0n, taxAmountCents: 0n });
        Object.assign(state.contractVersion[0], { amountYuan: null, amountCents: 0n });
      }
      if (preset === "two-drafts") {
        state.contract.push({ ...clone(contract), id: "grid-other-contract" });
        state.contractVersion.push({ ...clone(version), id: "grid-other-version", contractId: "grid-other-contract" });
        state.contractBill.push({ ...clone(bill), id: "grid-other-bill", contractVersionId: "grid-other-version" });
        state.contractBillRow.push(...rows.map(row => ({ ...clone(row), id: `${row.id}-other`, contractBillId: "grid-other-bill" })));
      }
      if (preset === "prior-owner-deletion") {
        // A fixed initial history after a transfer, not a fault that changes
        // ownership or receipt authorship during a running business request.
        const original = {
          contractBillId: "grid-bill", rowKey: "grid-row-key-0", itemCode: "", itemName: "级配碎石", specification: "合成规格", unit: "吨", quantity: "1", unitPrice: "1.534", taxRate: "0", taxRateSource: "version_default", pricingFactStatus: "confirmed", precisionPolicy: "four_decimal", numericProtocolVersion: 2, numericSource: "decimal_input", numericReviewStatus: "verified", taxInclusiveAmountYuan: "1.534", taxExclusiveAmountYuan: "1.534", taxAmountYuan: "0", taxInclusiveAmountCents: "153", taxExclusiveAmountCents: "153", taxAmountCents: "0", taxExclusiveUnitPrice: "1.534", isProvisional: false, settlementBasis: "", customData: {}, sortOrder: 0, lineageId: null, remainderDisposition: null, remainderDispositionReason: null, remainderDispositionByUserId: null, remainderDispositionAt: null
        };
        state.contractBillRow = state.contractBillRow.slice(1);
        state.contractVersion[0].draftRevision = 2;
        Object.assign(state.contractBill[0], { revision: 2, taxInclusiveAmountYuan: D("1.5340"), taxExclusiveAmountYuan: D("1.5340"), taxAmountYuan: D(0), taxInclusiveAmountCents: 153n, taxExclusiveAmountCents: 153n, taxAmountCents: 0n });
        Object.assign(state.contractVersion[0], { amountYuan: D("1.5340"), amountCents: 153n });
        state.contractDraftSaveRequest = [{ idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", contractVersionId: "grid-version", expectedRevision: 1, resultRevision: 2, saveKind: "auto", requestSha256: "0".repeat(64), createdByUserId: otherActor.id, createdAt: now, expiresAt: new Date(now.getTime() + 86400000), responseSnapshot: { contractVersionId: "grid-version", draftRevision: 2, serverRevision: 2, savedAt: now.toISOString(), documentContentRevision: 2, documentContentFingerprint: "0".repeat(64), documentContentChangedSections: ["bills"], effectiveChangedSections: ["bills"], billRevisions: { main: 2 }, issueCounts: {}, readiness: null, documentsOutdated: true, availableActions: [], capability: { refreshRequired: false, draftOperationAvailableActions: [] }, invalidation: { status: "document_invalidated" }, amounts: { taxInclusiveAmountCents: "153", taxExclusiveAmountCents: "153", taxAmountCents: "0" }, _rowUndo: { version: 1, deletedRows: { main: [original] }, restoredKeys: [] } } }];
      }
      buffers.clear();
      storageReads = 0;
      if (preset === "file-permissions") {
        for (const [id, uploader] of [["grid-own-file", actor.id], ["grid-foreign-file", otherActor.id], ["grid-bound-file", otherActor.id]]) {
          const objectKey = `synthetic/${id}.xlsx`;
          buffers.set(objectKey, Buffer.from(fixtureBuffer));
          state.fileObject.push({ id, bucket: storage.bucketName(), objectKey, originalName: "合成清单.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: fixtureBuffer.length, uploadedByUserId: uploader, contentSha256: createHash("sha256").update(fixtureBuffer).digest("hex"), storageStatus: "active", supersedesFileObjectId: null, createdAt: now });
        }
        // A separately owned effective contract supplies a legitimate existing
        // readable binding; the target draft itself stays pristine/editable.
        state.contract.push({ ...clone(contract), id: "grid-file-source-contract" });
        state.contractVersion.push({ ...clone(version), id: "grid-file-source-version", contractId: "grid-file-source-contract", numericProtocolVersion: 1, status: "effective" });
        state.contractFormalFile.push({ id: "grid-file-binding", contractVersionId: "grid-file-source-version", purpose: "mutually_signed_final", fileId: "grid-bound-file", contentSha256: createHash("sha256").update(fixtureBuffer).digest("hex"), pageCount: 1, sourceRevision: 1, status: "active", uploadedByUserId: otherActor.id, declarationSnapshot: {}, declaredByUserId: otherActor.id, declaredAt: now, createdAt: now });
      }
      return response.json({ status: "synthetic_fixture_reset" });
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/delay-next-preview-response") {
      delayNextPreviewResponse = true;
      return response.json({ status: "next_preview_adapter_response_will_wait" });
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/release-preview-response") {
      if (!heldPreviewResponse) return response.status(409).json({ message: "尚无已完成的文书适配器响应" });
      const held = heldPreviewResponse;
      heldPreviewResponse = null;
      held.end.apply(held.response, held.args);
      return response.json({ status: "completed_preview_response_released" });
    }
    if (request.method === "POST" && request.path === "/contract-drafts/grid-version/preview-generation") {
      const end = response.end;
      response.end = function (...args) {
        if (delayNextPreviewResponse) {
          delayNextPreviewResponse = false;
          heldPreviewResponse = { response, end, args };
          return response;
        }
        return end.apply(response, args);
      };
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/delay-next-save-response") {
      delayNextSaveResponse = true;
      return response.json({ status: "next_successful_save_response_will_wait" });
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/drop-next-file-response") {
      dropNextFileResponse = true;
      return response.json({ status: "next_completed_file_upload_response_will_be_lost" });
    }
    if (request.method === "GET" && request.path === "/__grid_fixture/file-count") return response.json({ count: state.fileObject.length });
    if (request.method === "POST" && request.path === "/contract-drafts/grid-version/files") {
      const end = response.end;
      response.end = function (...args) {
        if (dropNextFileResponse && response.statusCode >= 200 && response.statusCode < 300) {
          dropNextFileResponse = false;
          request.socket.destroy();
          return response;
        }
        return end.apply(response, args);
      };
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/fail-next-workbench-response") {
      if (!["connection", "5xx"].includes(request.body?.mode)) return response.status(400).json({ message: "未知本地读取故障类型" });
      nextWorkbenchResponseFailure = request.body.mode;
      return response.json({ status: "next_completed_workbench_response_will_fail" });
    }
    if (request.method === "GET" && request.path === "/contract-drafts/grid-version/workbench") {
      const end = response.end;
      response.end = function (...args) {
        if (nextWorkbenchResponseFailure && response.statusCode >= 200 && response.statusCode < 300) {
          const failure = nextWorkbenchResponseFailure;
          nextWorkbenchResponseFailure = null;
          // Read-only domain work completed normally. Fault only its transport
          // response; never replace a successful write with fabricated facts.
          if (failure === "connection") { request.socket.destroy(); return response; }
          response.statusCode = 503;
          response.removeHeader("content-length");
          response.setHeader("content-type", "application/json; charset=utf-8");
          return end.call(response, JSON.stringify({ message: "本地合成能力读取服务暂不可用" }));
        }
        return end.apply(response, args);
      };
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/drop-next-save-response") {
      dropNextSaveResponse = true;
      return response.json({ status: "next_successful_save_response_will_be_lost" });
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/release-save-response") {
      if (!heldSaveResponse) return response.status(409).json({ message: "尚无已完成的保存响应" });
      const held = heldSaveResponse;
      heldSaveResponse = null;
      held.end.apply(held.response, held.args);
      return response.json({ status: "completed_save_response_released" });
    }
    if (request.method === "POST" && request.path === "/__grid_fixture/hold-next-save-request") {
      holdNextSaveRequest = true;
      return response.json({ status: "next_parsed_save_request_will_wait" });
    }
    if (request.method === "GET" && request.path === "/__grid_fixture/held-request") return response.json({ held: heldSaveRequest !== null });
    if (request.method === "POST" && request.path === "/__grid_fixture/release-save-request") {
      if (!heldSaveRequest) return response.status(409).json({ message: "尚无在途保存请求" });
      const resume = heldSaveRequest;
      heldSaveRequest = null;
      resume();
      return response.json({ status: "original_save_request_released" });
    }
    if (request.method === "PUT" && request.path === "/contract-drafts/grid-version") {
      if (holdNextSaveRequest) {
        holdNextSaveRequest = false;
        heldSaveRequest = next;
        // The original body is already parsed. Lose only its caller connection;
        // resuming this same request later still runs the real domain service.
        request.socket.destroy();
        return;
      }
      const end = response.end;
      response.end = function (...args) {
        if (dropNextSaveResponse && response.statusCode >= 200 && response.statusCode < 300) {
          dropNextSaveResponse = false;
          request.socket.destroy();
          return response;
        }
        if (delayNextSaveResponse && response.statusCode >= 200 && response.statusCode < 300) {
          delayNextSaveResponse = false;
          heldSaveResponse = { response, end, args };
          return response;
        }
        return end.apply(response, args);
      };
    }
    const reads = { "/projects/contract-create-options": [project], "/contract-templates": [], "/contract-business-scenarios": [], "/approval-delegations/user-options": [], "/work-items": [] };
    if (request.method === "GET" && Object.hasOwn(reads, request.path)) return response.json(reads[request.path]);
    next();
  });
  await app.listen(Number(process.env.JG_GRID_API_PORT), "127.0.0.1");
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => void app.close().finally(() => process.exit(0)));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
