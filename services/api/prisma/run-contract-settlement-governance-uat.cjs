const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { PDFDocument } = require("pdf-lib");
const { PrismaClient } = require("@prisma/client");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");

const env = { ...readEnvFile(path.resolve(__dirname, "..", ".env")), ...process.env };
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
const prisma = new PrismaClient();
const baseUrl = env.API_BASE_URL || "http://127.0.0.1:3000";
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
  const database = new URL(env.DATABASE_URL || "");
  assert(localHost(api.hostname), `UAT 拒绝非本机 API：${api.origin}`);
  assert(localHost(database.hostname), "UAT 拒绝非本机 PostgreSQL");
  assert(!/prod|production/i.test(database.pathname), "UAT 拒绝疑似生产数据库");
  assert(String(env.FILE_STORAGE_DRIVER || "local").toLowerCase() === "local", "UAT 必须使用 local 文件存储");
}

async function request(method, urlPath, token, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
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

async function uploadBuffer(token, name, buffer, mimeType) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), name);
  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const text = await response.text();
  assert(response.ok, `上传 ${name} 失败 HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function uploadExistingLocalFile(token, fileId, name) {
  const file = await prisma.fileObject.findUnique({ where: { id: fileId } });
  assert(file && file.storageStatus === "active", `未找到本地文件 ${fileId}`);
  const privateRoot = path.resolve(env.FILE_STORAGE_ROOT || path.resolve(process.cwd(), "storage", "private"));
  const absolutePath = path.resolve(privateRoot, file.objectKey);
  assert(absolutePath.startsWith(`${privateRoot}${path.sep}`), "UAT 文件路径越界");
  return uploadBuffer(token, name, fs.readFileSync(absolutePath), file.mimeType);
}

async function prepareSignatures(tokens) {
  const signaturePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
    "base64"
  );
  const signatureSha256 = createHash("sha256").update(signaturePng).digest("hex");
  for (const role of [
    "contractStaff", "chairman", "generalManager", "projectManager", "contractDirector", "financeDirector",
    "materialDirector", "materialStaff", "engineeringDirector", "engineeringForeman",
    "engineeringTech", "comprehensiveDirector"
  ]) {
    const signature = await uploadBuffer(
      tokens[role],
      `UAT-${runId}-${role}-signature.png`,
      signaturePng,
      "image/png"
    );
    await prisma.handwrittenSignatureVersion.create({
      data: {
        userId: users[role].id,
        fileId: signature.id,
        contentSha256: signatureSha256,
        source: "canvas"
      }
    });
    await prisma.user.update({ where: { id: users[role].id }, data: { signatureFileId: signature.id } });
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
  const layoutFile = await uploadPdf(tokens[applicantRole], `UAT-${runId}-${config.type}-layout.pdf`);
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
    const file = await uploadPdf(tokens[fixture.applicantRole], `UAT-${runId}-${fixture.config.type}-${side}-authorization.pdf`);
    body.upload = {
      fileId: file.id,
      grantorName: side === "first_party" ? "UAT我方" : "UAT乙方",
      agentName: "UAT脱敏代理人",
      scopeSummary: "签署、履行、变更及补充协议"
    };
  }
  return request("POST", `/contracts/${fixture.version.id}/authorizations`, tokens[fixture.applicantRole], body);
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
  await prisma.contractGeneratedDocument.create({
    data: {
      contractVersionId: fixture.version.id,
      layoutTemplateVersionId: fixture.layoutVersion.id,
      purpose: "internal_review",
      status: "success",
      sourceRevision: current.draftRevision,
      inputSnapshot: {},
      idempotencyKey: `UAT-${runId}-${fixture.version.id}-internal-review`,
      engineVersion: "uat-fixture-v1",
      createdByUserId: users[fixture.applicantRole].id,
      completedAt: new Date()
    }
  });
  const approvalPdf = await uploadPdf(tokens[fixture.applicantRole], `UAT-${runId}-${fixture.config.type}-approval.pdf`);
  await request("POST", `/contracts/${fixture.version.id}/formal-files/approval`, tokens[fixture.applicantRole], {
    fileId: approvalPdf.id,
    sourceRevision: current.draftRevision,
    counterpartySigned: true,
    counterpartyStamped: true,
    crossPageSealCompleted: true,
    documentOrderConfirmed: true,
    authorizationsBeforeSignaturePageConfirmed: true
  });
  const submitted = await request("POST", `/contracts/${fixture.version.id}/approval-submission`, tokens[fixture.applicantRole], {
    numberRuleId: fixture.numberRule.id
  });
  assert(submitted.status === "in_approval", `${fixture.config.type} 未进入审批中`);
  const instance = await prisma.approvalInstance.findFirst({
    where: { businessType: "contract_version", businessId: fixture.version.id, flowType: "contract.approve" }
  });
  assert(instance, `${fixture.config.type} 未写入审批实例`);
  const frozenRoute = instance.frozenNodes.map((node) => [...node.roleKeys]);
  const expectedRoute = fixture.applicantRole === "contractDirector"
    ? expectedContractRoutes[fixture.config.type].slice(1)
    : expectedContractRoutes[fixture.config.type];
  assert(
    JSON.stringify(frozenRoute) === JSON.stringify(expectedRoute),
    `${fixture.config.type} 冻结审批路线不符：${JSON.stringify(frozenRoute)}`
  );
  fixture.approvalPdf = approvalPdf;
  fixture.instance = instance;
  evidence.set(fixture.config.id, [instance.id, approvalPdf.id, submitted.formalCode]);
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

async function approveContract(fixture, tokens) {
  for (const role of roleSequenceForType(fixture.config.type)) {
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
    await request("POST", `/contracts/${fixture.version.id}/approval`, tokens[role], {
      decision: "approve",
      comment: `UAT ${role} 通过`,
      expectedContractUpdatedAt: version.updatedAt.toISOString(),
      expectedApprovalInstanceId: instance.id,
      expectedNodeIndex: instance.currentNodeIndex,
      expectedApprovalUpdatedAt: instance.updatedAt.toISOString()
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
    documentOrderConfirmed: true,
    confirmationPassword: password
  });
  const effective = await prisma.contractVersion.findUnique({ where: { id: fixture.version.id } });
  assert(effective.status === "effective" && effective.effectiveAt, "合同双方最终版归档后未生效");
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

async function assertDirectorSkip(shared, tokens) {
  const config = { id: "contract_director_initiator_skip", type: "material_purchase", auth: [false, false] };
  const fixture = await createContractFixture(config, shared, tokens, "contractDirector");
  const instance = await prepareAndSubmitContract(fixture, tokens);
  const serialized = JSON.stringify(instance.frozenNodes);
  assert(!serialized.includes("contract_director"), "合同部主管发起时仍包含自审节点");
  assert(serialized.includes("material_director"), "主管发起后未从业务主管节点开始");
  evidence.set(config.id, [instance.id]);
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
      taxFactsFrozenAt: new Date()
    }
  });
  await prisma.paymentTermsVersion.update({ where: { id: fixture.terms.id }, data: { status: "effective" } });
  return fixture;
}

async function assertChangeBoundary(percentLabel, cents, allowed, shared, tokens) {
  const suffix = percentLabel.replace(".", "_");
  const base = await createEffectiveBoundaryBase("material_purchase", suffix, shared, tokens);
  const draft = await request("POST", `/contracts/${base.version.id}/change-drafts`, tokens.contractStaff, {
    changeType: "change",
    changeReason: `UAT 累计正增项 ${percentLabel}%`,
    changeDirection: "increase",
    changeAmountCents: String(cents)
  });
  const draftVersion = await prisma.contractVersion.findUnique({ where: { id: draft.id } });
  const changeFixture = {
    config: { type: "material_purchase" },
    version: draftVersion,
    applicantRole: "contractStaff"
  };
  await setAuthorization(changeFixture, "first_party", false, tokens);
  await setAuthorization(changeFixture, "counterparty", false, tokens);
  let current = await prisma.contractVersion.findUnique({ where: { id: draft.id } });
  await request(
    "POST",
    `/contract-workbench/${draft.id}/settlement-mode/confirm`,
    tokens.contractDirector,
    { expectedRevision: current.draftRevision, settlementMode: "settlement_required" }
  );
  current = await prisma.contractVersion.findUnique({ where: { id: draft.id } });
  await prisma.contractGeneratedDocument.create({
    data: {
      contractVersionId: draft.id,
      layoutTemplateVersionId: current.layoutTemplateVersionId,
      purpose: "internal_review",
      status: "success",
      sourceRevision: current.draftRevision,
      inputSnapshot: {},
      idempotencyKey: `UAT-${runId}-${draft.id}-change-review`,
      engineVersion: "uat-fixture-v1",
      createdByUserId: users.contractStaff.id,
      completedAt: new Date()
    }
  });
  const approvalPdf = await uploadPdf(tokens.contractStaff, `UAT-${runId}-change-${suffix}-approval.pdf`);
  await request("POST", `/contracts/${draft.id}/formal-files/approval`, tokens.contractStaff, {
    fileId: approvalPdf.id,
    sourceRevision: current.draftRevision,
    counterpartySigned: true,
    counterpartyStamped: true,
    crossPageSealCompleted: true,
    documentOrderConfirmed: true,
    authorizationsBeforeSignaturePageConfirmed: true
  });
  if (allowed) {
    const submitted = await request("POST", `/contracts/${draft.id}/approval-submission`, tokens.contractStaff, {
      numberRuleId: base.numberRule.id
    });
    assert(submitted.status === "in_approval", `${percentLabel}% 变更未进入审批`);
    const instance = await prisma.approvalInstance.findFirst({
      where: { businessType: "contract_version", businessId: draft.id, flowType: "contract.approve" }
    });
    assert(instance, `${percentLabel}% 变更未生成审批实例`);
    evidence.set(`contract_change_${suffix}_percent`, [draft.id, instance.id, approvalPdf.id]);
  } else {
    const failed = await request("POST", `/contracts/${draft.id}/approval-submission`, tokens.contractStaff, {
      numberRuleId: base.numberRule.id
    }, 400);
    assert(failed.body.includes("超过原合同 10%"), "10.01% 未返回必须新签合同的中文提示");
    const denial = await prisma.auditLog.findFirst({
      where: { action: "contract.change.limit.denied", businessId: draft.id }
    });
    assert(denial, "10.01% 阻断未持久化审计日志");
    evidence.set(`contract_change_${suffix}_percent`, [draft.id, denial.id, approvalPdf.id]);
  }
}

async function createSettlementTemplate(tokens) {
  const source = await uploadBuffer(tokens.contractStaff, `UAT-${runId}-settlement-template.xlsx`, Buffer.from("UAT"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const template = await prisma.settlementTemplate.create({
    data: { name: `UAT结算模板-${runId}`, code: `UAT-JS-TPL-${runId}`, createdByUserId: users.contractStaff.id }
  });
  return prisma.settlementTemplateVersion.create({
    data: {
      settlementTemplateId: template.id,
      versionNo: 1,
      status: "published",
      xlsxFileId: source.id,
      compatibleContractTypeKeys: ["material_purchase", "equipment_rental", "labor_subcontract", "professional_subcontract"],
      compatibleAmountRoles: [],
      compatiblePricingModes: [],
      columnSchema: {}, printRules: {}, evidenceRules: {}, anomalyRules: {},
      publishedByUserId: users.contractStaff.id,
      publishedAt: new Date()
    }
  });
}

function settlementLines(count) {
  return Array.from({ length: count }, (_, index) => ({
    sourceType: "manual_adjustment",
    name: `UAT结算项-${index + 1}`,
    unit: "项",
    quantity: "1",
    unitPriceCents: "100",
    amountCents: "100",
    reason: "UAT脱敏结算依据",
    sortOrder: index + 1
  }));
}

async function runSettlementScenario(caseId, contractFixture, reviewerRole, reviewerKey, lineCount, template, tokens) {
  const draft = await request("POST", `/projects/${projectId}/settlement-drafts`, tokens.contractStaff, {
    contractVersionId: contractFixture.version.id,
    settlementTemplateVersionId: template.id,
    code: `JS-UAT-${runId}-${caseId}`,
    periodLabel: `UAT-${caseId}`,
    fieldReviewerUserId: users[reviewerRole].id,
    fieldReviewerRoleKey: reviewerKey,
    settlementLines: settlementLines(lineCount)
  });
  const frozen = await request("POST", `/projects/${projectId}/settlement-drafts/${draft.id}/frozen-document`, tokens.contractStaff, {
    expectedRevision: draft.revision
  });
  const signedUpload = await uploadExistingLocalFile(tokens.contractStaff, frozen.fileId, `UAT-${runId}-${caseId}-counterparty-signed.pdf`);
  const signed = await request("POST", `/projects/${projectId}/settlement-drafts/${draft.id}/counterparty-signed-documents`, tokens.contractStaff, {
    expectedRevision: draft.revision,
    frozenDocumentId: frozen.id,
    uploadedFileId: signedUpload.id,
    declaration: {
      pageOrderMatchesFrozenDocument: true,
      counterpartySignedAndDated: true,
      everyPageStamped: true,
      crossPageSealCompleted: true
    }
  });
  const settlement = await request("POST", `/projects/${projectId}/settlement-drafts/${draft.id}/approval-submission`, tokens.contractStaff, {
    expectedRevision: draft.revision
  });
  assert(settlement.status === "approval_pending", `${caseId} 未进入审批`);
  const instance = await prisma.approvalInstance.findFirst({
    where: { businessType: "settlement", businessId: settlement.id, flowType: "settlement.approve" }
  });
  assert(instance, `${caseId} 未生成结算审批实例`);
  const route = JSON.stringify(instance.frozenNodes);
  if (reviewerKey === "material_staff") {
    assert(route.includes("material_staff") && route.includes("material_director"), "材料结算路线缺少物资员或物资主管");
  } else {
    assert(route.includes(reviewerKey) && route.includes("engineering_director"), "劳务结算路线缺少现场复核人或项目总工");
  }
  evidence.set(caseId, [draft.id, signed.id, settlement.id, instance.id]);
  const signatureCase = lineCount > 1 ? "settlement_multi_page_signatures" : "settlement_single_page_signatures";
  assert(lineCount === 1 ? frozen.pageCount === 1 : frozen.pageCount > 1, `${signatureCase} 页数不符`);
  assert(signed.pageCount === frozen.pageCount, `${signatureCase} 乙方签章件与冻结版页数不一致`);
  evidence.set(signatureCase, [frozen.id, frozen.fileId, signed.id, signedUpload.id]);
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
  evidence.set("contract_generic", [genericFixture.contract.id, genericFixture.version.id, stage.id, payment.id]);
}

async function assertReadonlyBoundaries(tokens) {
  await request("GET", "/contracts?limit=10", tokens.financeDirector);
  await request("GET", "/settlements?limit=10", tokens.financeDirector);
  await request("GET", "/company-entities/management", tokens.financeDirector);
  evidence.set("readonly_cross_domain_positive", [users.financeDirector.id, projectId]);
  await request("POST", "/contracts", tokens.financeDirector, {
    projectId,
    contractTypeKey: "material_purchase",
    businessTemplateVersionId: "forbidden"
  }, 403);
  await request("POST", `/projects/${projectId}/settlement-drafts`, tokens.financeDirector, {
    contractVersionId: "forbidden",
    settlementTemplateVersionId: "forbidden",
    code: `FORBIDDEN-${runId}`,
    periodLabel: "forbidden",
    settlementLines: settlementLines(1)
  }, 403);
  evidence.set("readonly_cross_domain_negative", [users.financeDirector.id, "HTTP-403-contract-create", "HTTP-403-settlement-create"]);
}

function writeEvidence() {
  const required = [
    ...contractCases.map((item) => item.id),
    "contract_director_initiator_skip", "contract_final_or_sign",
    "contract_authorization_none_none", "contract_authorization_first_only",
    "contract_authorization_counterparty_only", "contract_authorization_both",
    "contract_change_9_99_percent", "contract_change_10_percent", "contract_change_10_01_percent",
    "settlement_material_route", "settlement_labor_route",
    "settlement_single_page_signatures", "settlement_multi_page_signatures",
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
      evidenceIds: evidence.get(id).map((value, index) => index === 0 ? `${runId}:${value}` : value)
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
  await assertDirectorSkip(shared, tokens);
  await assertChangeBoundary("9.99", 99_900, true, shared, tokens);
  await assertChangeBoundary("10", 100_000, true, shared, tokens);
  await assertChangeBoundary("10.01", 100_100, false, shared, tokens);
  const laborEffective = await createEffectiveBoundaryBase("labor_subcontract", "labor-settlement", shared, tokens);
  const template = await createSettlementTemplate(tokens);
  await runSettlementScenario("settlement_material_route", fixtures.material_purchase, "materialStaff", "material_staff", 1, template, tokens);
  await runSettlementScenario("settlement_labor_route", laborEffective, "engineeringForeman", "engineering_foreman", 70, template, tokens);
  await assertGenericDirectPayment(fixtures.generic_contract, tokens);
  await assertReadonlyBoundaries(tokens);
  const output = writeEvidence();
  console.log(`合同结算治理隔离 UAT 已通过 20 项，证据：${output}`);
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
