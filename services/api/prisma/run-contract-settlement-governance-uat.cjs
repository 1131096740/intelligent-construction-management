const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PDFDocument } = require("pdf-lib");
const { PrismaClient } = require("@prisma/client");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");
const { signedSettlementVerification } = require("./signed-settlement-verification.cjs");

const env = { ...readEnvFile(path.resolve(__dirname, "..", ".env")), ...process.env };
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
const prisma = new PrismaClient();
const baseUrl = env.API_BASE_URL || "http://127.0.0.1:3000";
const signedChangeBaseUrl = env.TRIAL_RUN_SIGNED_CHANGE_API_BASE_URL || baseUrl;
const signedSettlementBaseUrl = env.TRIAL_RUN_SIGNED_SETTLEMENT_API_BASE_URL || baseUrl;
const initialPassword = process.env.SEED_PASSWORD || "Jgzg@2026";
const password = process.env.TRIAL_RUN_PASSWORD || "Jgzg-UAT@2026";
const runId = String(process.env.TRIAL_RUN_ID || "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 48);
const candidateSha = process.env.TRIAL_RUN_CANDIDATE_SHA || "";
const evidencePath = process.env.TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH || "";
const projectId = coreFlowSeedData.project.id;

const users = {
  contractStaff: { id: coreFlowSeedData.users.contractStaff.id, phone: coreFlowSeedData.users.contractStaff.phone },
  chairman: { id: "seed-user-chairman", phone: "13800001001" },
  generalManager: { id: "seed-user-general-manager", phone: "13800001002" },
  projectManager: { id: "seed-user-project-manager", phone: "13800001003" },
  contractDirector: { id: "seed-user-contract-director", phone: "13800001004" },
  financeDirector: { id: "seed-user-finance-director", phone: "13800001007" },
  materialDirector: { id: "seed-user-material-director", phone: "13800001008" },
  materialStaff: { id: "seed-user-material-staff", phone: "13800001009" },
  engineeringDirector: { id: "seed-user-engineering-director", phone: "13800001010" },
  engineeringForeman: { id: "seed-user-engineering-foreman", phone: "13800001011" },
  engineeringTech: { id: "seed-user-engineering-tech", phone: "13800001012" },
  comprehensiveDirector: { id: "seed-user-comprehensive-director", phone: "13800001013" },
  financeStaff: { id: coreFlowSeedData.users.cashier.id, phone: coreFlowSeedData.users.cashier.phone },
  employee: { id: "seed-user-employee", phone: "13800001014" }
};

const contractCases = [
  { id: "contract_material_purchase", type: "material_purchase", auth: [false, false] },
  { id: "contract_equipment_rental", type: "equipment_rental", auth: [true, false] },
  { id: "contract_labor_subcontract", type: "labor_subcontract", auth: [false, true] },
  { id: "contract_professional_subcontract", type: "professional_subcontract", auth: [true, true] },
  { id: "contract_generic", type: "generic_contract", auth: [false, false] }
];

const evidence = new Map();
const browserContractIds = new Map();
const signedSettlementReviewFixtures = new Map();

const expectedContractRoutes = {
  material_purchase: [["contract_director"], ["material_director"], ["project_manager"], ["finance_director"], ["chairman", "general_manager"]],
  equipment_rental: [["contract_director"], ["material_director"], ["project_manager"], ["finance_director"], ["chairman", "general_manager"]],
  labor_subcontract: [["contract_director"], ["engineering_director"], ["project_manager"], ["finance_director"], ["chairman", "general_manager"]],
  professional_subcontract: [["contract_director"], ["engineering_director"], ["project_manager"], ["finance_director"], ["chairman", "general_manager"]],
  generic_contract: [["contract_director"], ["comprehensive_director"], ["project_manager"], ["finance_director"], ["chairman", "general_manager"]]
};

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce((result, line) => {
    const value = line.trim();
    if (!value || value.startsWith("#")) return result;
    const separator = value.indexOf("=");
    if (separator <= 0) return result;
    result[value.slice(0, separator).trim()] = value.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    return result;
  }, {});
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function guard() {
  assert(runId.length >= 8, "TRIAL_RUN_ID 必须至少 8 个脱敏字符");
  assert(/^[0-9a-f]{40}$/.test(candidateSha), "TRIAL_RUN_CANDIDATE_SHA 必须是 40 位小写 SHA");
  assert(evidencePath, "必须设置 TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH");
  const api = new URL(baseUrl);
  const signedChangeApi = new URL(signedChangeBaseUrl);
  const database = new URL(env.DATABASE_URL || "");
  assert(localHost(api.hostname), `UAT 拒绝非本机 API：${api.origin}`);
  assert(localHost(signedChangeApi.hostname), "UAT 拒绝非本机补充协议 API");
  assert(localHost(new URL(signedSettlementBaseUrl).hostname), "UAT 拒绝非本机已签结算 API");
  assert(localHost(database.hostname), "UAT 拒绝非本机 PostgreSQL");
  assert(!/prod|production/i.test(database.pathname), "UAT 拒绝疑似生产数据库");
  assert(String(env.FILE_STORAGE_DRIVER || "local").toLowerCase() === "local", "UAT 必须使用 local 文件存储");
}

async function request(method, urlPath, token, body, expectedStatus, extraHeaders = {}, target = baseUrl) {
  const response = await fetch(`${target}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  if (expectedStatus !== undefined) {
    assert(response.status === expectedStatus, `${method} ${urlPath} 预期 HTTP ${expectedStatus}，实际 ${response.status}: ${text}`);
    return { status: response.status, body: text };
  }
  assert(response.ok, `${method} ${urlPath} 失败 HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function signedChangeRequest(method, urlPath, token, body) {
  return request(method, urlPath, token, body, undefined, {}, signedChangeBaseUrl);
}

async function login(account) {
  const attempt = async (loginPassword) => request("POST", "/auth/login", null, {
    phone: account.phone,
    password: loginPassword
  });
  let result;
  try {
    result = await attempt(password);
  } catch {
    result = await attempt(initialPassword);
  }
  if (result.user?.mustChangePassword) {
    result = await request("POST", "/auth/change-password", result.tokens.accessToken, {
      name: result.user.name,
      oldPassword: initialPassword,
      newPassword: password
    });
  }
  assert(result.tokens?.accessToken, `用户 ${account.id} 登录未返回 token`);
  return result.tokens.accessToken;
}

async function uploadPdf(token, name, pageCount = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([841.89, 595.28]);
  const buffer = Buffer.from(await document.save({ useObjectStreams: false }));
  return uploadBuffer(token, name, buffer, "application/pdf");
}

async function uploadContractDraftPdf(token, contractVersionId, name, pageCount = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([841.89, 595.28]);
  const buffer = Buffer.from(await document.save({ useObjectStreams: false }));
  return uploadMultipart(
    token,
    `/contract-drafts/${contractVersionId}/files`,
    name,
    buffer,
    "application/pdf"
  );
}

async function uploadBuffer(token, name, buffer, mimeType) {
  return uploadMultipart(token, "/files", name, buffer, mimeType);
}

async function uploadMultipart(token, urlPath, name, buffer, mimeType) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), name);
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const text = await response.text();
  assert(response.ok, `上传 ${name} 失败 HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function uploadCanvasSignature(token, name, buffer) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/png" }), name);
  const response = await fetch(`${baseUrl}/me/signature/canvas`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const text = await response.text();
  assert(response.ok, `上传 ${name} 失败 HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function prepareSignatures(tokens) {
  const signaturePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
    "base64"
  );
  for (const role of [
    "contractStaff", "chairman", "generalManager", "projectManager", "contractDirector", "financeDirector",
    "materialDirector", "materialStaff", "engineeringDirector", "engineeringForeman",
    "engineeringTech", "comprehensiveDirector"
  ]) {
    const signature = await uploadCanvasSignature(
      tokens[role],
      `UAT-${runId}-${role}-signature.png`,
      signaturePng
    );
    assert(signature.signatureFileId, `用户 ${role} 手写签名上传未返回文件 ID`);
  }
}

// Follow the current Web draft API: editing lease, revision and submission key.
// The retired approval-submission route must never be re-enabled for UAT.
async function submitContractDraft(versionId, token, expectedStatus) {
  const lease = await request("POST", `/contract-drafts/${versionId}/edit-lease`, token);
  assert(typeof lease.token === "string" && lease.token.length > 0, "合同编辑权未返回有效凭据");
  try {
    const workbench = await request("GET", `/contract-drafts/${versionId}/workbench`, token);
    const expectedRevision = workbench.version?.draftRevision;
    assert(Number.isInteger(expectedRevision), "合同工作台未返回当前草稿版本");
    return await request("POST", `/contract-drafts/${versionId}/submission`, token, {
      expectedRevision,
      idempotencyKey: randomUUID()
    }, expectedStatus, { "X-Contract-Draft-Lease": lease.token });
  } finally {
    await request("DELETE", `/contract-drafts/${versionId}/edit-lease`, token, undefined,
      undefined, { "X-Contract-Draft-Lease": lease.token });
  }
}

async function prepareSharedFixtures(tokens) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  assert(project?.isActive, "缺少启用的 seed 项目");
  const entity = await prisma.companyEntity.create({
    data: {
      name: `UAT建设主体-${runId}`,
      unifiedSocialCreditCode: `91350211${String(runId)
        .replace(/\D/gu, "")
        .slice(-10)
        .padStart(10, "0")}`,
      registeredAddress: "UAT脱敏地址",
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  const entityVersion = await prisma.companyEntityVersion.create({
    data: {
      companyEntityId: entity.id,
      versionNo: 1,
      name: entity.name,
      unifiedSocialCreditCode: entity.unifiedSocialCreditCode,
      registeredAddress: entity.registeredAddress,
      isActive: true,
      action: "create",
      actorUserId: users.contractStaff.id,
      actorRoleKey: "contract_staff"
    }
  });
  const quotaFile = await uploadPdf(tokens.contractStaff, `UAT-${runId}-owner-quota.pdf`);
  await prisma.projectOwnerContract.create({
    data: {
      projectId,
      ownerName: "UAT脱敏业主",
      contractName: `UAT业主合同-${runId}`,
      contractCode: `YZ-UAT-${runId}`,
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
      amountCents: 10_000_000_000n,
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "UAT脱敏付款条款",
      retentionSummary: "UAT脱敏质保条款",
      fileId: quotaFile.id,
      fileContentSha256Snapshot: quotaFile.contentSha256,
      recordedByUserId: users.contractStaff.id,
      confirmedByUserId: users.contractDirector.id,
      confirmedAt: new Date(),
      status: "effective"
    }
  });
  return { entity, entityVersion, quotaFileId: quotaFile.id };
}

async function createContractFixture(config, shared, tokens, applicantRole = "contractStaff") {
  const applicant = users[applicantRole];
  const layoutFile = await uploadPdf(tokens.contractStaff, `UAT-${runId}-${config.type}-layout.pdf`);
  const layout = await prisma.contractLayoutTemplate.create({
    data: { name: `UAT版式-${config.type}-${runId}`, contractTypeKey: config.type, createdByUserId: applicant.id }
  });
  const layoutVersion = await prisma.contractLayoutTemplateVersion.create({
    data: {
      layoutTemplateId: layout.id,
      versionNo: 1,
      status: "published",
      docxFileId: layoutFile.id,
      placeholderSchema: {},
      publishedByUserId: applicant.id,
      publishedAt: new Date()
    }
  });
  const contract = await prisma.contract.create({
    data: {
      projectId,
      source: "system",
      name: `UAT${config.type}-${runId}`,
      counterparty: `UAT乙方-${config.type}-${runId}`,
      companyEntityId: shared.entity.id,
      companyEntityName: shared.entity.name,
      contractTypeKey: config.type,
      ownerUserId: applicant.id,
      temporaryCode: `TEMP-${config.id}-${runId}-${applicantRole}`
    }
  });
  const templateSnapshot = {
    fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [],
    supplementChangePolicy: { version: 1, editableFieldKeys: [], editableClauseKeys: [], coreClauseKeys: [] }
  };
  const version = await prisma.contractVersion.create({
    data: {
      contractId: contract.id,
      versionNo: 1,
      changeType: "original",
      status: "draft",
      amountCents: 1_000_000n,
      originalBaseAmountCents: 1_000_000n,
      pricingNature: "fixed_total",
      amountLimitType: "capped",
      amountSource: "manual",
      amountAdjustmentReason: "UAT脱敏固定总价",
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "9",
      taxFactStatus: "confirmed",
      taxFactSource: "contract_document",
      taxFactRevision: 1,
      contractGovernanceVersion: 1,
      layoutTemplateVersionId: layoutVersion.id,
      draftData: {
        companyEntitySelection: {
          id: shared.entity.id,
          versionId: shared.entityVersion.id,
          versionNo: 1,
          name: shared.entity.name,
          unifiedSocialCreditCode: shared.entity.unifiedSocialCreditCode,
          registeredAddress: shared.entity.registeredAddress
        },
        myCompanyEntity: shared.entity.name,
        fieldValues: {
          invoiceType: "增值税专用发票",
          taxRatePercent: "9"
        }
      },
      templateSnapshot,
      clauseSnapshot: []
    }
  });
  await prisma.contractPartySnapshot.create({
    data: {
      contractVersionId: version.id,
      roleKey: "party_b",
      displayOrder: 1,
      snapshot: { name: contract.counterparty }
    }
  });
  const terms = await prisma.paymentTermsVersion.create({
    data: {
      contractId: contract.id,
      contractVersionId: version.id,
      versionNo: 1,
      status: "draft",
      originalText: config.type === "generic_contract" ? "按合同阶段直接付款" : "结算生效后付款"
    }
  });
  await prisma.paymentTermsStage.create({
    data: {
      paymentTermsVersionId: terms.id,
      name: config.type === "generic_contract" ? "UAT通用合同直付" : "UAT结算后付款",
      stageType: "progress",
      basis: config.type === "generic_contract" ? "contract_amount" : "current_settlement",
      ratioBps: 10000,
      triggerAnchor: config.type === "generic_contract" ? "contract_effective" : "settlement_effective",
      triggerEvent: config.type === "generic_contract" ? "contract_effective" : "settlement_effective",
      dueDays: 0,
      allowsInstallments: true,
      originalText: "UAT脱敏付款阶段"
    }
  });
  const numberRule = await prisma.contractNumberRule.create({
    data: {
      name: `UAT编号-${config.type}-${runId}`,
      pattern: `UAT-${runId}-${config.id}-{sequence}`,
      projectId,
      contractTypeKey: config.type,
      nextSequence: 1,
      sequenceWidth: 3,
      isActive: true,
      createdByUserId: applicant.id
    }
  });
  return { config, contract, version, terms, layoutVersion, numberRule, applicantRole };
}

async function setAuthorization(fixture, side, required, tokens) {
  const current = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  const body = { side, expectedRevision: current.draftRevision, required };
  if (required) {
    const file = await uploadContractDraftPdf(
      tokens[fixture.applicantRole],
      fixture.version.id,
      `UAT-${runId}-${fixture.config.type}-${side}-authorization.pdf`
    );
    body.upload = {
      fileId: file.id,
      grantorName: side === "first_party" ? "UAT我方" : "UAT乙方",
      agentName: "UAT脱敏代理人",
      scopeSummary: "签署、履行、变更及补充协议"
    };
  }
  return request("POST", `/contracts/${fixture.version.id}/authorizations`, tokens[fixture.applicantRole], body);
}

async function establishContractDocumentContent(fixture, tokens) {
  const actorToken = tokens[fixture.applicantRole];
  const versionId = fixture.version.id;
  const lease = await request("POST", `/contract-drafts/${fixture.version.id}/edit-lease`, actorToken);
  assert(lease?.token, `${fixture.config.type} 合同草稿编辑权获取失败`);
  try {
    const workbench = await request("GET", `/contract-drafts/${fixture.version.id}/workbench`, actorToken);
    const version = workbench?.version;
    assert(version, `${fixture.config.type} 合同草稿工作台读取失败`);
    const draftData = version.draftData && typeof version.draftData === "object"
      ? version.draftData
      : {};
    const contract = fixture.contract ?? await prisma.contract.findUnique({
      where: { id: version.contractId },
      select: { name: true }
    });
    assert(contract?.name, `${fixture.config.type} 合同名称缺失`);
    const companyEntityId = draftData.companyEntitySelection?.id;
    const taxFacts = version.taxFacts;
    const isChangeVersion = version.changeType === "change" ||
      version.changeType === "supplement" ||
      workbench.change?.isChange === true;
    const draftDataForSave = {
      ...draftData,
      ...(isChangeVersion ? {} : { contractName: contract.name })
    };
    if (isChangeVersion) {
      delete draftDataForSave.companyEntitySelection;
      delete draftDataForSave.myCompanyEntity;
    }
    assert(typeof companyEntityId === "string" && companyEntityId, `${fixture.config.type} 合同主体快照缺失`);
    assert(taxFacts && typeof taxFacts === "object", `${fixture.config.type} 合同税务事实缺失`);

    const paymentTermsVersion = await prisma.paymentTermsVersion.findFirst({
      where: { contractVersionId: versionId },
      select: { originalText: true, id: true }
    });
    const paymentStages = paymentTermsVersion
      ? await prisma.paymentTermsStage.findMany({
          where: { paymentTermsVersionId: paymentTermsVersion.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        })
      : [];

    const saved = await request(
      "PUT",
      `/contract-drafts/${fixture.version.id}`,
      actorToken,
      {
        idempotencyKey: randomUUID(),
        saveKind: "manual",
        expectedRevision: version.draftRevision,
        changedSections: ["draft"],
        draft: {
          draftData: draftDataForSave,
          clauses: Array.isArray(version.clauseSnapshot) ? version.clauseSnapshot : [],
          pricingNature: version.pricingNature,
          amountSource: version.amountSource,
          ...(version.amountSource === "manual"
            ? { manualAmountCents: String(version.amountCents) }
            : {}),
          ...(version.amountAdjustmentReason
            ? { amountAdjustmentReason: version.amountAdjustmentReason }
            : {}),
          ...(version.layoutTemplateVersionId
            ? { layoutTemplateVersionId: version.layoutTemplateVersionId }
            : {}),
          taxFacts: {
            invoiceType: taxFacts.invoiceType,
            taxMode: taxFacts.taxMode,
            defaultTaxRatePercent: taxFacts.defaultTaxRatePercent,
            source: taxFacts.source
          }
        },
        parties: (workbench.parties ?? []).map((party) => ({
          roleKey: party.roleKey,
          displayOrder: party.displayOrder,
          ...(party.businessPartyVersionId
            ? { businessPartyVersionId: party.businessPartyVersionId }
            : {}),
          snapshot: party.snapshot
        })),
        bills: (workbench.bills ?? []).map((bill) => ({
          billKey: bill.billKey,
          expectedRevision: bill.revision,
          rows: (bill.rows ?? []).map((row, index) => ({
            clientRowKey: row.clientRowKey ?? row.rowKey ?? row.id ?? `uat-row-${index}`,
            ...(row.rowKey ? { rowKey: row.rowKey } : {}),
            sortOrder: row.sortOrder ?? index,
            ...(row.itemCode ? { itemCode: row.itemCode } : {}),
            itemName: row.itemName,
            ...(row.specification ? { specification: row.specification } : {}),
            unit: row.unit,
            ...(row.quantity === null || row.quantity === undefined
              ? {}
              : { quantity: String(row.quantity) }),
            unitPrice: String(row.unitPrice),
            ...(row.taxRatePercent ? { taxRatePercent: row.taxRatePercent } : {}),
            ...(row.taxRateSource ? { taxRateSource: row.taxRateSource } : {}),
            ...(row.isProvisional === undefined ? {} : { isProvisional: row.isProvisional }),
            ...(row.settlementBasis ? { settlementBasis: row.settlementBasis } : {}),
            customData: row.customData && typeof row.customData === "object" ? row.customData : {}
          }))
        })),
        paymentTerms: paymentTermsVersion
          ? {
              originalText: paymentTermsVersion.originalText,
              stages: paymentStages.map((stage) => ({
                name: stage.name,
                stageType: stage.stageType,
                basis: stage.basis,
                ...(stage.ratioBps === null ? {} : { ratioBps: stage.ratioBps }),
                ...(stage.fixedAmountCents === null
                  ? {}
                  : { fixedAmountCents: String(stage.fixedAmountCents) }),
                triggerAnchor: stage.triggerAnchor,
                triggerEvent: stage.triggerEvent,
                dueDays: stage.dueDays,
                ...(stage.advanceDeductionMode === null
                  ? {}
                  : { advanceDeductionMode: stage.advanceDeductionMode }),
                ...(stage.advanceDeductionRatioBps === null
                  ? {}
                  : { advanceDeductionRatioBps: stage.advanceDeductionRatioBps }),
                ...(stage.advanceDeductionStartRatioBps === null
                  ? {}
                  : { advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps }),
                requiresInvoice: stage.requiresInvoice,
                allowsEarlyPayment: stage.allowsEarlyPayment,
                allowsInstallments: stage.allowsInstallments,
                ...(stage.retentionBps === null ? {} : { retentionBps: stage.retentionBps }),
                originalText: stage.originalText
              }))
            }
          : null,
        attachments: [],
        negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      },
      undefined,
      { "x-contract-draft-lease": lease.token }
    );
    assert(/^[a-f0-9]{64}$/.test(saved?.documentContentFingerprint ?? ""),
      `${fixture.config.type} 合同文书内容摘要未通过公开草稿保存流程建立`);
    fixture.version = await prisma.contractVersion.findUnique({ where: { id: versionId } });
    return saved;
  } finally {
    await request(
      "DELETE",
      `/contract-drafts/${fixture.version.id}/edit-lease`,
      actorToken,
      undefined,
      undefined,
      { "x-contract-draft-lease": lease.token }
    );
  }
}

async function prepareAndSubmitContract(fixture, tokens) {
  const [firstRequired, counterpartyRequired] = fixture.config.auth;
  await setAuthorization(fixture, "first_party", firstRequired, tokens);
  await setAuthorization(fixture, "counterparty", counterpartyRequired, tokens);
  let current = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  await request(
    "POST",
    `/contract-workbench/${fixture.version.id}/settlement-mode/confirm`,
    tokens.contractDirector,
    {
      expectedRevision: current.draftRevision,
      settlementMode: fixture.config.type === "generic_contract"
        ? "direct_payment"
        : "settlement_required"
    }
  );
  current = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  assert(
    current?.settlementMode === (fixture.config.type === "generic_contract" ? "direct_payment" : "settlement_required") &&
      current.settlementModeConfirmedAt,
    `${fixture.config.type} 结算方式确认未持久化`
  );
  await establishContractDocumentContent(fixture, tokens);
  current = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  const counterpartySignedPdf = await uploadContractDraftPdf(
    tokens[fixture.applicantRole],
    fixture.version.id,
    `UAT-${runId}-${fixture.config.type}-counterparty-signed.pdf`
  );
  const counterpartySigned = await request(
    "POST",
    `/contracts/${fixture.version.id}/formal-files/counterparty`,
    tokens[fixture.applicantRole],
    {
      fileIds: [counterpartySignedPdf.id],
      sourceRevision: current.draftRevision
    }
  );
  const unconfirmedSubmission = await submitContractDraft(
    fixture.version.id, tokens[fixture.applicantRole], 400
  );
  assert(
    unconfirmedSubmission.status >= 400 && unconfirmedSubmission.status < 500,
    `${fixture.config.type} 乙方签章整体确认前提交未被 4xx 阻断`
  );
  const [unconfirmedVersion, unconfirmedInstance] = await Promise.all([
    prisma.contractVersion.findUnique({ where: { id: fixture.version.id } }),
    prisma.approvalInstance.findFirst({
      where: {
        businessType: "contract_version",
        businessId: fixture.version.id,
        flowType: "contract.approve"
      }
    })
  ]);
  assert(unconfirmedVersion?.status === "draft", `${fixture.config.type} 未确认乙方签章时合同状态被错误提交`);
  assert(!unconfirmedInstance, `${fixture.config.type} 未确认乙方签章时错误创建审批实例`);
  await request(
    "POST",
    `/contracts/${fixture.version.id}/formal-files/counterparty/confirmation`,
    tokens[fixture.applicantRole],
    {
      formalFileId: counterpartySigned.previewFormalFileId,
      expectedDraftRevision: current.draftRevision
    }
  );
  const submitted = await submitContractDraft(fixture.version.id, tokens[fixture.applicantRole]);
  assert(submitted.status === "in_approval", `${fixture.config.type} 未进入审批中`);
  const instance = await prisma.approvalInstance.findFirst({
    where: { businessType: "contract_version", businessId: fixture.version.id, flowType: "contract.approve" }
  });
  assert(instance, `${fixture.config.type} 未写入审批实例`);
  const frozenRoute = instance.frozenNodes.map((node) => [...node.roleKeys]);
  const expectedRoute = expectedContractRoutes[fixture.config.type];
  assert(
    JSON.stringify(frozenRoute) === JSON.stringify(expectedRoute),
    `${fixture.config.type} 冻结审批路线不符：${JSON.stringify(frozenRoute)}`
  );
  fixture.approvalPdf = counterpartySignedPdf;
  fixture.instance = instance;
  evidence.set(fixture.config.id, [instance.id, counterpartySignedPdf.id, submitted.formalCode]);
  return instance;
}

function roleSequenceForType(type) {
  if (["material_purchase", "equipment_rental"].includes(type)) {
    return ["contractDirector", "materialDirector", "projectManager", "financeDirector", "chairman"];
  }
  if (["labor_subcontract", "professional_subcontract"].includes(type)) {
    return ["contractDirector", "engineeringDirector", "projectManager", "financeDirector", "chairman"];
  }
  return ["contractDirector", "comprehensiveDirector", "projectManager", "financeDirector", "chairman"];
}

async function approveContract(fixture, tokens, roles = roleSequenceForType(fixture.config.type)) {
  for (const role of roles) {
    const [version, instance] = await Promise.all([
      prisma.contractVersion.findUnique({ where: { id: fixture.version.id } }),
      prisma.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: fixture.version.id,
          flowType: "contract.approve",
          status: "in_progress"
        },
        orderBy: { createdAt: "desc" }
      })
    ]);
    assert(version && instance, `${fixture.config.type} 审批坐标缺失`);
    const isDirectorSelfReview = role === "contractDirector" && fixture.applicantRole === "contractDirector";
    await request("POST", `/contracts/${fixture.version.id}/approval`, tokens[role], {
      decision: "approve",
      comment: `UAT ${role} 通过`,
      expectedContractUpdatedAt: version.updatedAt.toISOString(),
      expectedApprovalInstanceId: instance.id,
      expectedNodeIndex: instance.currentNodeIndex,
      expectedApprovalUpdatedAt: instance.updatedAt.toISOString(),
      ...(isDirectorSelfReview ? {
        selfReviewReason: "UAT 合同部主管作为冻结经办人自审",
        confirmationPassword: password
      } : {})
    });
  }
  const approved = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  assert(approved.status === "approved_pending_seal", "合同终审后未进入待用章");
  const finalLogs = await prisma.approvalActionLog.findMany({ where: { approvalInstanceId: fixture.instance.id, action: "approve" } });
  assert(finalLogs.some((item) => item.approvedRoleKey === "chairman"), "董事长或签未写入冻结日志");
  assert(!finalLogs.some((item) => item.approvedRoleKey === "general_manager"), "董事长已或签后不应再写总经理审批");
  const chairmanLog = finalLogs.find((item) => item.approvedRoleKey === "chairman");
  evidence.set("contract_final_or_sign", [fixture.instance.id, chairmanLog.id]);
}

async function sealAndArchive(fixture, tokens) {
  await request("POST", `/contracts/${fixture.version.id}/seal/approve`, tokens.comprehensiveDirector, {
    confirmationPassword: password
  });
  const completion = {
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true
  };
  await request("POST", `/contracts/${fixture.version.id}/seal/complete`, tokens[fixture.applicantRole], completion);
  const finalPdf = await uploadPdf(tokens[fixture.applicantRole], `UAT-${runId}-${fixture.config.type}-final.pdf`);
  const final = await request("POST", `/contracts/${fixture.version.id}/formal-files/final`, tokens[fixture.applicantRole], {
    ...completion,
    fileId: finalPdf.id,
    sourceRevision: (await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } })).draftRevision,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  });
  await request("POST", `/contracts/${fixture.version.id}/formal-files/final/confirmation`, tokens.contractDirector, {
    ...completion,
    formalFileId: final.id,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  });
  const effective = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  assert(effective.status === "effective" && effective.effectiveAt, "合同双方最终版归档后未生效");
  assert(
    effective.settlementMode === (fixture.config.type === "generic_contract" ? "direct_payment" : "settlement_required") &&
      effective.settlementModeConfirmedAt,
    `${fixture.config.type} 生效归档后结算方式确认状态丢失`
  );
  evidence.set(fixture.config.id, [fixture.contract.id, fixture.version.id, final.id]);
}

async function assertAuthorizationCombinations(fixtures) {
  const combinations = [
    ["contract_authorization_none_none", fixtures.material_purchase, [false, false]],
    ["contract_authorization_first_only", fixtures.equipment_rental, [true, false]],
    ["contract_authorization_counterparty_only", fixtures.labor_subcontract, [false, true]],
    ["contract_authorization_both", fixtures.professional_subcontract, [true, true]]
  ];
  for (const [caseId, fixture, expected] of combinations) {
    const links = await prisma.contractVersionAuthorizationLink.findMany({
      where: { contractVersionId: fixture.version.id }, orderBy: { side: "asc" }
    });
    const actual = ["first_party", "counterparty"].map((side) => links.find((item) => item.side === side)?.required === true);
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${caseId} 授权组合不符`);
    evidence.set(caseId, links.map((item) => item.id));
  }
}

async function assertDirectorInitiatorSelfReview(shared, tokens) {
  const config = { id: "contract_director_initiator_self_review", type: "material_purchase", auth: [false, false] };
  const fixture = await createContractFixture(config, shared, tokens, "contractDirector");
  const instance = await prepareAndSubmitContract(fixture, tokens);
  assert(
    JSON.stringify(instance.frozenNodes[0]?.roleKeys) === JSON.stringify(["contract_director"]),
    "合同部主管发起时未冻结合同部主管自审节点"
  );
  const version = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  const current = await prisma.approvalInstance.findFirst({
    where: {
      businessType: "contract_version",
      businessId: fixture.version.id,
      flowType: "contract.approve",
      status: "in_progress"
    },
    orderBy: { createdAt: "desc" }
  });
  assert(version && current, "合同部主管自审前审批坐标缺失");
  await request("POST", `/contracts/${fixture.version.id}/approval`, tokens.projectManager, {
    decision: "approve",
    comment: "UAT 项目经理不得越过合同部主管自审节点",
    expectedContractUpdatedAt: version.updatedAt.toISOString(),
    expectedApprovalInstanceId: current.id,
    expectedNodeIndex: current.currentNodeIndex,
    expectedApprovalUpdatedAt: current.updatedAt.toISOString()
  }, 403);

  await approveContract(fixture, tokens);
  const logs = await prisma.approvalActionLog.findMany({
    where: { approvalInstanceId: instance.id, action: "approve" },
    orderBy: { createdAt: "asc" }
  });
  const selfReviewLog = logs.find((item) => item.approvedRoleKey === "contract_director");
  assert(
    selfReviewLog?.actorUserId === users.contractDirector.id &&
      selfReviewLog.representedUserId === users.contractDirector.id &&
      selfReviewLog.metadata?.selfReview === true &&
      selfReviewLog.metadata?.selfReviewReason === "UAT 合同部主管作为冻结经办人自审",
    "合同部主管自审未记录当前岗位、经办身份与自审原因"
  );
  for (const roleKey of ["project_manager", "finance_director", "chairman"]) {
    assert(logs.some((item) => item.approvedRoleKey === roleKey), `合同部主管自审后缺少 ${roleKey} 审批节点`);
  }
  const selfReviewAudit = await prisma.auditLog.findFirst({
    where: {
      action: "contract.approval.approve",
      businessType: "contract_version",
      businessId: fixture.version.id,
      actorUserId: users.contractDirector.id
    },
    orderBy: { createdAt: "desc" }
  });
  assert(
    selfReviewAudit?.metadata?.selfReview === true &&
      selfReviewAudit.metadata?.selfReviewReason === "UAT 合同部主管作为冻结经办人自审",
    "合同部主管自审未写入审批审计"
  );
  evidence.set(config.id, [
    instance.id,
    selfReviewLog.id,
    selfReviewAudit.id,
    "HTTP-403-project-manager-before-self-review"
  ]);
}

async function assertDirectorHandlerSelfArchive(shared, tokens) {
  const config = { id: "contract_director_handler_self_archive", type: "material_purchase", auth: [false, false] };
  const preparePendingArchive = async (browserKey) => {
    const fixture = await createContractFixture({ ...config, id: `${config.id}_${browserKey}` }, shared, tokens, "contractDirector");
    await prepareAndSubmitContract(fixture, tokens);
    await approveContract(fixture, tokens);

    await request("POST", `/contracts/${fixture.version.id}/seal/approve`, tokens.comprehensiveDirector, {
      confirmationPassword: password
    });
    const completion = {
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true
    };
    await request("POST", `/contracts/${fixture.version.id}/seal/complete`, tokens.contractDirector, completion);
    const finalPdf = await uploadPdf(
      tokens.contractDirector,
      `UAT-${runId}-contract-director-handler-self-archive-${browserKey}-final.pdf`
    );
    const final = await request("POST", `/contracts/${fixture.version.id}/formal-files/final`, tokens.contractDirector, {
      ...completion,
      fileId: finalPdf.id,
      sourceRevision: (await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } })).draftRevision,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    });
    const pending = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
    assert(pending?.status === "pending_archive_confirm", "合同部主管经办人的最终版上传后未进入待归档确认");
    return { fixture, final };
  };

  const chromium = await preparePendingArchive("chromium");
  const webkit = await preparePendingArchive("webkit");
  assert(
    chromium.fixture.contract.id !== webkit.fixture.contract.id,
    "治理 UAT 双浏览器合同夹具必须使用不同 UUID"
  );
  browserContractIds.set(config.id, {
    chromium: chromium.fixture.contract.id,
    webkit: webkit.fixture.contract.id
  });
  evidence.set(config.id, [chromium.fixture.contract.id, chromium.fixture.version.id, chromium.final.id, webkit.fixture.contract.id, webkit.fixture.version.id, webkit.final.id]);
}

async function createEffectiveBoundaryBase(type, suffix, shared, tokens) {
  const fixture = await createContractFixture({ id: `boundary-${suffix}`, type, auth: [false, false] }, shared, tokens);
  await prisma.contract.update({ where: { id: fixture.contract.id }, data: { code: `BASE-UAT-${runId}-${suffix}` } });
  await prisma.contractVersion.update({
    where: { id: fixture.version.id },
    data: {
      status: "effective",
      effectiveAt: new Date(),
      contractGovernanceVersion: 1,
      companyEntityIdSnapshot: shared.entity.id,
      companyEntityVersionId: shared.entityVersion.id,
      companyEntityNameSnapshot: shared.entity.name,
      companyEntityCreditCodeSnapshot: shared.entity.unifiedSocialCreditCode,
      companyEntityRegisteredAddressSnapshot: shared.entity.registeredAddress,
      taxFactStatus: "frozen",
      taxFactsFrozenAt: new Date(),
      settlementMode: type === "generic_contract" ? "direct_payment" : "settlement_required",
      settlementModeSource: "contract_director",
      settlementModeConfirmedByUserId: users.contractDirector.id,
      settlementModeConfirmedAt: new Date()
    }
  });
  await prisma.paymentTermsVersion.update({ where: { id: fixture.terms.id }, data: { status: "effective" } });
  return fixture;
}

async function approveSignedSupplement(fixture, suffix, amountDeltaYuan, paymentAgreementText, tokens) {
  const path = `/contracts/${fixture.version.id}/signed-changes`;
  const pdf = await uploadPdf(tokens.contractStaff, `UAT-${runId}-change-${suffix}-mutually-signed.pdf`);
  const change = await signedChangeRequest("POST", path, tokens.contractStaff, {
    fileId: pdf.id, summary: "UAT 已签补充协议", amountDeltaYuan, paymentAgreementText
  });
  assert(change.status === "pending_review", "已签补充协议未进入待复核");
  const approved = await signedChangeRequest("POST", `${path}/${change.id}/review`, tokens.contractDirector, {
    decision: "approve"
  });
  assert(approved.status === "approved", "合同部主管复核后补充协议未生效");
  return { approved, fileId: pdf.id };
}

async function assertChangeBoundary(percentLabel, amountDeltaYuan, effectiveAmountYuan, shared, tokens) {
  const suffix = percentLabel.replace(".", "_");
  const base = await createEffectiveBoundaryBase("material_purchase", suffix, shared, tokens);
  const agreement = `UAT 补充协议调整付款约定 ${percentLabel}%`;
  const { approved, fileId } = await approveSignedSupplement(base, suffix, amountDeltaYuan, agreement, tokens);
  assert(approved.effectiveAmountYuan === effectiveAmountYuan, `${percentLabel}% 补充协议生效金额错误`);
  const list = await signedChangeRequest("GET", `/contracts/${base.version.id}/signed-changes`, tokens.contractStaff);
  assert(list.originalAmountYuan === "10000.0000" && list.effectiveAmountYuan === effectiveAmountYuan,
    `${percentLabel}% 补充协议未保留原金额或未更新当前金额`);
  assert(list.currentPaymentAgreementText === agreement, `${percentLabel}% 补充协议的新付款约定未生效`);
  evidence.set(`signed_supplement_${suffix}_percent`, [base.version.id, approved.id, fileId]);
}

async function runSettlementScenario(caseId, contractFixture, originalCase, pageCounts, tokens) {
  const effectiveContract = await prisma.contractVersion.findUnique({ where: { id: contractFixture.version.id } });
  assert(effectiveContract?.status === "effective" && effectiveContract.settlementMode === "settlement_required" &&
    effectiveContract.settlementModeConfirmedAt, `${caseId} 缺少已生效且已确认结算方式的合同`);
  const signed = signedSettlementVerification(signedSettlementBaseUrl, projectId);
  const number = `JS-UAT-${runId}-${caseId}`;
  const files = [];
  for (const [index, pages] of pageCounts.entries()) {
    files.push(await signed.upload(tokens.contractStaff, `${number}-${index + 1}.pdf`, pages));
  }
  const amountYuan = "100.0000";
  const input = {
    contractKind: "downstream", contractId: contractFixture.contract.id, number,
    amountYuan, fileIds: files.map(file => file.id)
  };
  const draft = await signed.request("POST", "", tokens.contractStaff, input);
  assert(draft.state === "draft", `${caseId} 未保留已签结算草稿`);
  const submitted = await signed.submit(draft, tokens.contractStaff);
  await signed.request("POST", `/${submitted.id}/review`, tokens.contractStaff,
    { revision: submitted.revision, decision: "confirm" }, 403);
  const attempts = await Promise.allSettled([
    signed.confirm(submitted, tokens.contractDirector),
    signed.confirm(submitted, tokens.contractDirector)
  ]);
  const completed = attempts.filter((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  assert(completed.length === 1 && rejected.length === 1 &&
    rejected[0].reason?.code === "ERR_ASSERTION" && rejected[0].reason.actual === 409,
    `${caseId} 同版本提交两次必须一笔生效且一笔冲突`);
  const confirmed = completed[0].value;
  signedSettlementReviewFixtures.set(caseId, { projectId, settlementId: confirmed.id, revision: submitted.revision });
  assert(confirmed.amountYuan === amountYuan && confirmed.reviewedByUserId === users.contractDirector.id &&
    confirmed.confirmedContractSource?.sourceRecordId === contractFixture.version.id, `${caseId} 金额、复核角色或合同版本不匹配`);
  const basis = await signed.request("GET", `/payment-basis?${new URLSearchParams({
    contractKind: input.contractKind, contractId: input.contractId
  })}`, tokens.contractStaff);
  assert(basis.latestConfirmed?.id === confirmed.id && basis.confirmedYuan === amountYuan, `${caseId} 确认后未进入付款依据`);
  for (const file of files) {
    await signed.verifyOriginal(tokens.contractStaff, confirmed.id, file, "隔离 UAT 核对已签结算原件");
  }
  evidence.set(caseId, [confirmed.id, contractFixture.version.id, users.contractDirector.id]);
  evidence.set(originalCase, [confirmed.id, ...files.map(file => file.id)]);
}

async function assertGenericDirectPayment(genericFixture, tokens) {
  const stage = await prisma.paymentTermsStage.findFirst({
    where: { paymentTermsVersionId: genericFixture.terms.id }
  });
  const payment = await request("POST", "/payments", tokens.contractStaff, {
    sourceType: "contract_due",
    contractVersionId: genericFixture.version.id,
    paymentTermsVersionId: genericFixture.terms.id,
    paymentTermsStageId: stage.id,
    code: `FK-UAT-${runId}-GENERIC`,
    requestedAmountCents: "10000"
  });
  assert(payment.status === "approval_pending" && payment.settlementId == null, "通用合同直付未冻结为无结算来源");
  const persisted = await prisma.paymentRequest.findUnique({ where: { id: payment.id } });
  assert(persisted.paymentTermsStageId === stage.id, "通用合同直付未冻结付款阶段");
  const original = await request("GET", `/payments/${payment.id}`, tokens.contractStaff);
  const agreement = "UAT 双方确认验收后延后三十日付款";
  const { approved, fileId } = await approveSignedSupplement(genericFixture, "direct-payment", "0", agreement, tokens);
  const updated = await request("GET", `/payments/${payment.id}`, tokens.contractStaff);
  const value = (detail, label) => detail.baseInfo.find(item => item.label === label)?.value;
  assert(updated.meta.some(item => item.label === "付款约定" && item.value === "约定已更新，请核对提交时和最新约定"),
    "已提交付款缺少付款约定更新提示");
  assert(value(original, "付款约定原文") === value(updated, "提交时付款约定") &&
    value(updated, "最新付款约定") === agreement, "付款详情未同时保留提交时和最新约定");
  assert(value(updated, "付款阶段") === value(original, "付款阶段") &&
    value(updated, "申请金额") === value(original, "申请金额"), "补充协议改写了冻结的付款依据");
  evidence.set("contract_generic", [genericFixture.contract.id, genericFixture.version.id, stage.id, payment.id, approved.id, fileId]);
}

async function assertReadonlyBoundaries(contractId, tokens) {
  await request("GET", "/contracts?limit=10", tokens.financeDirector);
  await request("GET", "/settlements?limit=10", tokens.financeDirector);
  await request("GET", "/company-entities/management", tokens.financeDirector);
  evidence.set("readonly_cross_domain_positive", [users.financeDirector.id, projectId]);
  await request("POST", "/contracts", tokens.financeDirector, {
    projectId,
    contractTypeKey: "material_purchase",
    businessTemplateVersionId: "forbidden"
  }, 403);
  const signed = signedSettlementVerification(signedSettlementBaseUrl, projectId);
  await signed.request("POST", "", tokens.financeDirector, {
    contractKind: "downstream", contractId, number: `FORBIDDEN-${runId}`
  }, 403);
  await request("POST", `/projects/${projectId}/settlement-drafts`, tokens.contractStaff, {}, 410);
  evidence.set("readonly_cross_domain_negative", [users.financeDirector.id, "HTTP-403-contract-create", "HTTP-403-signed-settlement-create", "HTTP-410-retired-settlement-create"]);
}

function writeEvidence() {
  const required = [
    ...contractCases.map((item) => item.id),
    "contract_director_initiator_self_review", "contract_director_handler_self_archive", "contract_final_or_sign",
    "contract_authorization_none_none", "contract_authorization_first_only",
    "contract_authorization_counterparty_only", "contract_authorization_both",
    "signed_supplement_9_99_percent", "signed_supplement_10_percent", "signed_supplement_10_01_percent",
    "signed_settlement_material_confirmation", "signed_settlement_labor_confirmation",
    "signed_settlement_single_page_original", "signed_settlement_multi_page_originals",
    "readonly_cross_domain_positive", "readonly_cross_domain_negative"
  ];
  const missing = required.filter((id) => !evidence.has(id));
  assert(missing.length === 0, `UAT 证据未收口：${missing.join(", ")}`);
  const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ""));
  const manifest = {
    schemaVersion: 1,
    runId,
    candidateSha,
    apiOrigin: new URL(baseUrl).origin,
    databaseName,
    storageDriver: "local",
    productionData: false,
    cases: required.map((id) => ({
      id,
      passed: true,
      evidenceIds: evidence.get(id).map((value, index) => index === 0 ? `${runId}:${value}` : value),
      ...(signedSettlementReviewFixtures.has(id)
        ? { signedSettlementReviewFixture: signedSettlementReviewFixtures.get(id) }
        : {}),
      ...(browserContractIds.has(id)
        ? {
            browserContractIds: Object.fromEntries(
              Object.entries(browserContractIds.get(id)).map(([browser, value]) => [browser, `${runId}:${value}`])
            )
          }
        : {})
    }))
  };
  const output = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, output);
  return output;
}

async function main() {
  guard();
  await request("GET", "/health");
  const tokens = Object.fromEntries(await Promise.all(
    Object.entries(users).map(async ([role, account]) => [role, await login(account)])
  ));
  await prepareSignatures(tokens);
  const shared = await prepareSharedFixtures(tokens);
  const fixtures = {};
  for (const config of contractCases) {
    const fixture = await createContractFixture(config, shared, tokens);
    await prepareAndSubmitContract(fixture, tokens);
    fixtures[config.type] = fixture;
  }
  await assertAuthorizationCombinations(fixtures);
  await approveContract(fixtures.material_purchase, tokens);
  await sealAndArchive(fixtures.material_purchase, tokens);
  await approveContract(fixtures.generic_contract, tokens);
  await sealAndArchive(fixtures.generic_contract, tokens);
  await assertDirectorInitiatorSelfReview(shared, tokens);
  await assertDirectorHandlerSelfArchive(shared, tokens);
  await assertChangeBoundary("9.99", "999.0000", "10999.0000", shared, tokens);
  await assertChangeBoundary("10", "1000.0000", "11000.0000", shared, tokens);
  await assertChangeBoundary("10.01", "1001.0000", "11001.0000", shared, tokens);
  const laborEffective = await createEffectiveBoundaryBase("labor_subcontract", "labor-settlement", shared, tokens);
  await runSettlementScenario("signed_settlement_material_confirmation", fixtures.material_purchase,
    "signed_settlement_single_page_original", [1], tokens);
  await runSettlementScenario("signed_settlement_labor_confirmation", laborEffective,
    "signed_settlement_multi_page_originals", [2, 1], tokens);
  await assertGenericDirectPayment(fixtures.generic_contract, tokens);
  await assertReadonlyBoundaries(fixtures.material_purchase.contract.id, tokens);
  const output = writeEvidence();
  console.log(`合同结算治理隔离 UAT 已通过 21 项，证据：${output}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      const detail = error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
        : JSON.stringify(error);
      console.error(`合同结算治理隔离 UAT 失败：${detail}`);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}

module.exports = { guard, writeEvidence };
