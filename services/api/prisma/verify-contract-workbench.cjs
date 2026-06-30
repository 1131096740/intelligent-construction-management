const { execFile } = require("child_process");
const { promisify } = require("util");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";
const PASSWORD = process.env.SEED_PASSWORD || "Jgzg@2026";
const CONVERTER = process.env.DOC_CONVERTER_COMMAND || "soffice";
const WORKBENCH_SEEDS = [
  {
    code: "material_purchase",
    filterPath: "/contract-templates?contractTypeKey=material_purchase",
    seed: coreFlowSeedData.materialPurchaseWorkbench,
    docxName: "material-purchase-real-v1.docx"
  },
  {
    code: "equipment_rental",
    filterPath: "/contract-templates?contractTypeKey=equipment_rental",
    seed: coreFlowSeedData.equipmentRentalWorkbench,
    docxName: "equipment-rental-real-v1.docx"
  },
  {
    code: "labor_subcontract",
    filterPath: "/contract-templates?contractTypeKey=labor_subcontract",
    seed: coreFlowSeedData.laborSubcontractWorkbench,
    docxName: "labor-subcontract-real-v1.docx"
  },
  {
    code: "generic_contract",
    filterPath: "/contract-templates?contractTypeKey=generic_contract",
    seed: coreFlowSeedData.genericContractWorkbench,
    docxName: "generic-contract-v1.docx"
  }
];

const LIVE_GENERATION_CASES = [
  {
    label: "generic_contract",
    seed: coreFlowSeedData.genericContractWorkbench,
    names: {
      name: "Phase1通用合同验收",
      counterparty: "Phase1通用合同相对方"
    },
    draftData: {
      projectName: coreFlowSeedData.project.name,
      counterpartyName: "Phase1通用合同相对方",
      businessSummary: "Task 6 通用合同 Word 生成验收",
      settlementCycle: "按双方确认结算",
      paymentRatioPercent: 80
    },
    billKey: "genericItems",
    row: {
      itemName: "通用服务",
      specification: "按现场要求",
      unit: "项",
      quantity: "1.000",
      unitPrice: "10000.0000",
      taxRatePercent: "6",
      taxInclusiveAmount: "10000.00",
      remark: "Task 6 通用合同验收"
    }
  },
  {
    label: "equipment_rental",
    seed: coreFlowSeedData.equipmentRentalWorkbench,
    names: {
      name: "Phase1机械租赁验收合同",
      counterparty: "Phase1机械租赁公司"
    },
    draftData: {
      rentalStartDate: "2026-07-01",
      rentalEndDate: "2026-09-30",
      useLocation: "建设项目一期现场",
      settlementCycle: "上月16日至本月15日",
      paymentRatioPercent: 80
    },
    billKey: "equipmentRentals",
    row: {
      itemName: "挖掘机租赁",
      specification: "神钢350",
      unit: "台班",
      quantity: "10.000",
      unitPrice: "430.0000",
      taxRatePercent: "1",
      taxInclusiveAmount: "4300.00",
      fuelIncluded: false,
      operatorIncluded: true,
      remark: "Phase1机械租赁验收"
    }
  },
  {
    label: "labor_subcontract",
    seed: coreFlowSeedData.laborSubcontractWorkbench,
    names: {
      name: "Phase1劳务分包验收合同",
      counterparty: "Phase1劳务班组"
    },
    draftData: {
      projectName: coreFlowSeedData.project.name,
      workScope: "主体结构劳务作业",
      workLocation: "建设项目一期现场",
      plannedStartDate: "2026-07-01",
      plannedEndDate: "2026-09-30",
      settlementCycle: "按月结算",
      progressPaymentRatioPercent: 80
    },
    billKey: "laborItems",
    row: {
      itemName: "钢筋绑扎劳务",
      unit: "项",
      quantity: "1.000",
      unitPrice: "10000.0000",
      taxRatePercent: "3",
      taxInclusiveAmount: "10000.00",
      remark: "Phase1劳务分包验收"
    }
  }
];

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertConverterAvailable() {
  try {
    await execFileAsync(CONVERTER, ["--version"]);
  } catch {
    throw new Error(
      "DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path."
    );
  }
}

async function login() {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: coreFlowSeedData.users.contractStaff.phone,
      password: PASSWORD
    })
  });
  const text = await response.text();
  assert(response.ok, `login returned HTTP ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert(body.tokens?.accessToken, "login did not return an access token");
  console.log("ok login");
  return body.tokens.accessToken;
}

async function getJson(path, token) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders(token) });
  const text = await response.text();
  assert(response.ok, `${path} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function postJson(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert(response.ok, `${path} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function patchJson(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert(response.ok, `${path} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function uploadFile(fileName, mimeType, buffer, token) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: authHeaders(token),
    body: form
  });
  const text = await response.text();
  assert(response.ok, `/files returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function downloadBuffer(path, token) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function assertSeedReady() {
  const [project, ...seedRecords] = await Promise.all([
    prisma.project.findUnique({ where: { id: coreFlowSeedData.project.id } }),
    ...WORKBENCH_SEEDS.flatMap(({ seed }) => [
      prisma.contractBusinessTemplateVersion.findUnique({
        where: { id: seed.version.id }
      }),
      prisma.contractLayoutTemplateVersion.findUnique({
        where: { id: seed.layout.versionId }
      }),
      prisma.fileObject.findUnique({
        where: { id: seed.layout.docxFile.id }
      }),
      prisma.contractNumberRule.findUnique({
        where: { id: seed.numberingRule.id }
      })
    ])
  ]);
  assert(project, "Seed project is missing. Run `pnpm --filter @jiangkong/api seed` first.");
  for (const [index, { code, docxName }] of WORKBENCH_SEEDS.entries()) {
    const [templateVersion, layoutVersion, file, numberRule] = seedRecords.slice(
      index * 4,
      index * 4 + 4
    );
    assert(
      templateVersion?.status === "published",
      `Published ${code} template seed is missing.`
    );
    assert(layoutVersion?.status === "published", `Published ${code} layout seed is missing.`);
    assert(file?.originalName === docxName, `${code} layout does not use ${docxName}`);
    assert(numberRule?.isActive, `Active ${code} contract number rule seed is missing.`);
  }
}

async function listPublishedTemplates(token) {
  const templates = await getJson("/contract-templates", token);
  for (const { code, filterPath } of WORKBENCH_SEEDS) {
    assert(
      templates.some((template) => template.code === code),
      `${code} template was not listed as published`
    );
    const filtered = await getJson(filterPath, token);
    assert(
      filtered.length === 1 &&
        filtered[0]?.code === code &&
        filtered[0]?.status === "published" &&
        filtered[0]?.versionId,
      `${code} query did not return one published template version`
    );
  }
  console.log("ok list published templates");
}

async function createMinimalDraft(
  token,
  seed = coreFlowSeedData.materialPurchaseWorkbench,
  names = {
    name: "Phase1材料采购验收合同",
    counterparty: "Phase1材料供应商"
  }
) {
  const result = await postJson(
    "/contracts",
    {
      projectId: coreFlowSeedData.project.id,
      contractTypeKey: seed.template.contractTypeKey,
      businessTemplateVersionId: seed.version.id
    },
    token
  );
  assert(result.contract?.id && result.version?.id, "create minimal draft did not return ids");
  await prisma.contract.update({
    where: { id: result.contract.id },
    data: {
      name: names.name,
      counterparty: names.counterparty,
      companyEntityName: "建工智管建设有限公司"
    }
  });
  console.log(`ok create ${seed.template.code} draft ${result.contract.temporaryCode}`);
  return { contractId: result.contract.id, contractVersionId: result.version.id };
}

async function getWorkbench(contractId, token) {
  return getJson(`/contract-workbench/${contractId}`, token);
}

function billByKey(workbench, key) {
  const bill = workbench.bills.find((item) => item.billKey === key);
  assert(bill, `missing bill ${key}`);
  return bill;
}

async function saveDraft(contractVersionId, workbench, token) {
  const seed = coreFlowSeedData.materialPurchaseWorkbench;
  const saved = await patchJson(
    `/contract-workbench/${contractVersionId}`,
    {
      expectedRevision: workbench.version.draftRevision,
      draftData: {
        projectName: coreFlowSeedData.project.name,
        deliveryLocation: "建设项目一期现场",
        deliveryDeadline: "2026-07-20",
        qualityStandard: "符合国家现行质量标准和项目验收要求",
        taxRatePercent: 13,
        settlementMethod: "monthly"
      },
      clauses: seed.clauses,
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: 12800000,
      amountAdjustmentReason: "Phase 1 验收脚本手工合同金额",
      layoutTemplateVersionId: seed.layout.versionId
    },
    token
  );
  assert(saved.draftRevision === workbench.version.draftRevision + 1, "autosave revision mismatch");
  console.log("ok autosave");
}

async function saveLiveGenerationDraft(contractVersionId, workbench, seed, draftData, token) {
  const saved = await patchJson(
    `/contract-workbench/${contractVersionId}`,
    {
      expectedRevision: workbench.version.draftRevision,
      draftData,
      clauses: seed.clauses,
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: 1000000,
      amountAdjustmentReason: `${seed.template.name} live document generation smoke`,
      layoutTemplateVersionId: seed.layout.versionId
    },
    token
  );
  assert(
    saved.draftRevision === workbench.version.draftRevision + 1,
    `${seed.template.code} autosave revision mismatch`
  );
  console.log(`ok ${seed.template.code} autosave`);
}

async function createCheckpoint(contractVersionId, token) {
  const checkpoint = await postJson(
    `/contract-workbench/${contractVersionId}/checkpoints`,
    { name: "Phase 1 验收检查点" },
    token
  );
  assert(checkpoint.id, "manual checkpoint did not return an id");
  console.log("ok manual checkpoint");
}

async function addBillRow(bill, token) {
  const row = await postJson(
    `/contract-bills/${bill.id}/rows`,
    {
      expectedBillRevision: bill.revision,
      itemName: "钢筋",
      specification: "HRB400E 直径18",
      unit: "吨",
      quantity: "10.000",
      unitPrice: "10000.0000",
      taxRatePercent: "13",
      isProvisional: false,
      settlementBasis: "按到货验收数量结算",
      customData: {
        itemName: "钢筋",
        specification: "HRB400E 直径18",
        unit: "吨",
        quantity: "10.000",
        unitPrice: "10000.0000",
        taxRatePercent: "13",
        taxInclusiveAmount: "100000.00"
      }
    },
    token
  );
  const createdRow = row.rows?.find((item) => item.itemName === "钢筋");
  assert(createdRow?.rowKey, "add bill row did not return the created row");
  console.log("ok add bill row");
}

async function addBillRowFromData(bill, rowData, token, label) {
  const row = await postJson(
    `/contract-bills/${bill.id}/rows`,
    {
      expectedBillRevision: bill.revision,
      itemName: rowData.itemName,
      specification: rowData.specification,
      unit: rowData.unit,
      quantity: rowData.quantity,
      unitPrice: rowData.unitPrice,
      taxRatePercent: rowData.taxRatePercent,
      isProvisional: false,
      settlementBasis: "按双方确认结算资料结算",
      customData: rowData
    },
    token
  );
  assert(
    row.rows?.some((item) => item.itemName === rowData.itemName),
    `${label} add bill row did not return the created row`
  );
  console.log(`ok add ${label} bill row`);
}

async function exportExcelTemplate(bill, token) {
  const buffer = await downloadBuffer(`/contract-bills/${bill.id}/excel-template`, token);
  assert(buffer.length > 0, "export Excel template returned an empty file");
  console.log("ok export Excel template");
  return buffer;
}

async function fillExcelTemplate(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("清单数据") || workbook.worksheets[1];
  assert(sheet, "Excel template data sheet is missing");
  const codes = new Map();
  sheet.getRow(2).eachCell((cell, colNumber) => {
    codes.set(String(cell.value), colNumber);
  });
  const values = {
    itemName: "水泥",
    specification: "P.O 42.5",
    unit: "吨",
    quantity: "20.000",
    unitPrice: "480.0000",
    taxRatePercent: "13",
    taxInclusiveAmount: "9600.00"
  };
  for (const [code, value] of Object.entries(values)) {
    const column = codes.get(code);
    assert(column, `Excel template is missing column ${code}`);
    sheet.getRow(3).getCell(column).value = value;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function uploadImportApplyExcel(bill, token) {
  const template = await exportExcelTemplate(bill, token);
  const edited = await fillExcelTemplate(template);
  const file = await uploadFile(
    `phase1-materials-${Date.now()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    edited,
    token
  );
  const preview = await postJson(
    `/contract-bills/${bill.id}/excel-imports`,
    { fileId: file.id, mode: "append" },
    token
  );
  assert(preview.importId, "upload/import/apply Excel preview did not return importId");
  assert(preview.errors.length === 0, `Excel import preview has errors: ${JSON.stringify(preview.errors)}`);
  const applied = await postJson(`/contract-bill-imports/${preview.importId}/apply`, {}, token);
  assert(applied.bill?.id === bill.id, "Excel import apply returned the wrong bill");
  console.log("ok upload/import/apply Excel");
  return preview.importId;
}

async function addParties(
  contractVersionId,
  token,
  ownerName = "建工智管建设有限公司",
  counterpartyName = "Phase1材料供应商"
) {
  const snapshot = (name) => ({
    name,
    unifiedSocialCreditCode: `91310000${Math.floor(Math.random() * 100000000).toString().padStart(8, "0")}`,
    legalRepresentative: "张三",
    address: "上海市",
    contactName: "李四",
    contactPhone: "13800009999",
    attachments: []
  });
  await postJson(
    `/contract-workbench/${contractVersionId}/parties`,
    { roleKey: "party_a", snapshot: snapshot(ownerName) },
    token
  );
  await postJson(
    `/contract-workbench/${contractVersionId}/parties`,
    { roleKey: "party_b", snapshot: snapshot(counterpartyName) },
    token
  );
}

async function generateLiveDraftDocument(token, config) {
  const draft = await createMinimalDraft(token, config.seed, config.names);
  let workbench = await getWorkbench(draft.contractId, token);
  await saveLiveGenerationDraft(
    draft.contractVersionId,
    workbench,
    config.seed,
    config.draftData,
    token
  );
  workbench = await getWorkbench(draft.contractId, token);
  await addBillRowFromData(billByKey(workbench, config.billKey), config.row, token, config.label);
  await addParties(
    draft.contractVersionId,
    token,
    "建工智管建设有限公司",
    config.names.counterparty
  );
  const document = await queueDocument(
    draft.contractVersionId,
    "draft",
    token,
    config.seed.layout.versionId
  );
  const generated = await pollDocumentSuccess(draft.contractVersionId, document.id, token);
  console.log(`ok ${config.label} live draft document`);
  return { ...draft, draftDocument: generated };
}

async function checkReadiness(contractVersionId, token) {
  const readiness = await postJson(`/contracts/${contractVersionId}/readiness`, {}, token);
  assert(
    readiness.blocking.length === 0,
    `readiness has blocking errors: ${JSON.stringify(readiness.blocking)}`
  );
  return readiness;
}

async function queueDocument(
  contractVersionId,
  purpose,
  token,
  layoutTemplateVersionId = coreFlowSeedData.materialPurchaseWorkbench.layout.versionId
) {
  const document = await postJson(
    `/contract-workbench/${contractVersionId}/documents`,
    {
      layoutTemplateVersionId,
      purpose
    },
    token
  );
  assert(document.id, `queue ${purpose} document did not return id`);
  console.log(`ok queue ${purpose} document`);
  return document;
}

async function pollDocumentSuccess(contractVersionId, documentId, token) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const documents = await getJson(`/contract-workbench/${contractVersionId}/documents`, token);
    const document = documents.find((item) => item.id === documentId);
    if (document?.status === "success") {
      assert(document.docxFileId && document.pdfFileId, "successful document is missing file ids");
      console.log(`ok poll document success ${documentId}`);
      return document;
    }
    if (document?.status === "failed") {
      throw new Error(`document generation failed: ${document.errorMessage || documentId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`document ${documentId} did not succeed within 60 seconds`);
}

async function confirmOfflineRevision(contractVersionId, draftDocument, token) {
  assert(draftDocument.docxFileId, "draft document is missing docxFileId");
  const revision = await postJson(
    `/contract-workbench/${contractVersionId}/offline-revisions`,
    {
      fileId: draftDocument.docxFileId,
      sourceGeneratedDocumentId: draftDocument.id,
      label: "Live线下修订稿",
      note: "verify-contract-workbench smoke",
      confirmationStatementAccepted: true
    },
    token
  );
  const revisions = await getJson(
    `/contract-workbench/${contractVersionId}/offline-revisions`,
    token
  );
  assert(
    revisions.some(
      (item) =>
        item.id === revision.id &&
        item.fileId === draftDocument.docxFileId &&
        item.label === "Live线下修订稿"
    ),
    "offline revision was not persisted or listed"
  );
  console.log("ok offline revision live smoke");
}

async function submitApproval(contractVersionId, token) {
  const nextSequence = Math.floor(Date.now() / 1000);
  await prisma.contractNumberRule.updateMany({
    where: {
      id: coreFlowSeedData.materialPurchaseWorkbench.numberingRule.id,
      nextSequence: { lt: nextSequence }
    },
    data: { nextSequence }
  });
  const submitted = await postJson(
    `/contracts/${contractVersionId}/approval-submission`,
    { numberRuleId: coreFlowSeedData.materialPurchaseWorkbench.numberingRule.id },
    token
  );
  assert(submitted.status === "in_approval", "submit approval did not enter in_approval");
  console.log(`ok submit approval ${submitted.formalCode}`);
}

async function assertAudit(contractId, contractVersionId, importId, draftDocumentId, reviewDocumentId) {
  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { businessType: "contract", businessId: contractId },
        { businessType: "contract_version", businessId: contractVersionId },
        { businessType: "contract_bill_import", businessId: importId },
        { businessType: "contract_generated_document", businessId: draftDocumentId },
        { businessType: "contract_generated_document", businessId: reviewDocumentId }
      ]
    },
    select: { action: true, businessId: true }
  });
  const actions = new Set(rows.map((row) => row.action));
  const required = [
    "contract.draft.create",
    "contract.draft.save",
    "contract.bill.import.apply",
    "contract.document.success",
    "contract.approval.submit"
  ];
  const missing = required.filter((action) => !actions.has(action));
  assert(missing.length === 0, `Missing audit actions: ${missing.join(", ")}`);
  const hasDocumentSuccess = (documentId) =>
    rows.some((row) => row.businessId === documentId && row.action === "contract.document.success");
  assert(hasDocumentSuccess(draftDocumentId), "Missing draft document success audit");
  assert(hasDocumentSuccess(reviewDocumentId), "Missing internal review document success audit");
  console.log("ok audit logs");
}

async function main() {
  await assertConverterAvailable();
  await assertSeedReady();
  const token = await login();
  await listPublishedTemplates(token);
  for (const config of LIVE_GENERATION_CASES) {
    await generateLiveDraftDocument(token, config);
  }
  const draft = await createMinimalDraft(token);
  let workbench = await getWorkbench(draft.contractId, token);
  await saveDraft(draft.contractVersionId, workbench, token);
  await createCheckpoint(draft.contractVersionId, token);
  workbench = await getWorkbench(draft.contractId, token);
  await addBillRow(billByKey(workbench, "materials"), token);
  workbench = await getWorkbench(draft.contractId, token);
  const importId = await uploadImportApplyExcel(billByKey(workbench, "materials"), token);
  await addParties(draft.contractVersionId, token);
  workbench = await getWorkbench(draft.contractId, token);
  const draftDocument = await queueDocument(draft.contractVersionId, "draft", token);
  const generatedDraftDocument = await pollDocumentSuccess(
    draft.contractVersionId,
    draftDocument.id,
    token
  );
  await confirmOfflineRevision(draft.contractVersionId, generatedDraftDocument, token);
  await checkReadiness(draft.contractVersionId, token);
  const reviewDocument = await queueDocument(draft.contractVersionId, "internal_review", token);
  await pollDocumentSuccess(draft.contractVersionId, reviewDocument.id, token);
  await submitApproval(draft.contractVersionId, token);
  const version = await prisma.contractVersion.findUnique({
    where: { id: draft.contractVersionId }
  });
  assert(version?.status === "in_approval", "contract version is not in_approval");
  await assertAudit(
    draft.contractId,
    draft.contractVersionId,
    importId,
    draftDocument.id,
    reviewDocument.id
  );
  console.log("ok contract workbench phase 1 verification");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
