const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const ExcelJS = require("exceljs");
const { PDFDocument } = require("pdf-lib");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");
const { PrismaClient } = require("@prisma/client");

const env = {
  ...readEnvFile(path.resolve(__dirname, "..", ".env")),
  ...process.env
};
const baseUrl = env.API_BASE_URL || "http://127.0.0.1:3000";
if (!process.env.DATABASE_URL && env.DATABASE_URL) {
  process.env.DATABASE_URL = env.DATABASE_URL;
}
const prisma = new PrismaClient();

// 与 prisma/seed.cjs 中 testPassword 一致；脚本只验证默认 seed/test 账号，绝不打印密码或 token。
const INITIAL_PASSWORD = process.env.SEED_PASSWORD || "Jgzg@2026";
const PASSWORD = process.env.TRIAL_RUN_PASSWORD || "Jgzg-UAT@2026";
const PROJECT_ID = coreFlowSeedData.project.id;
const PHONES = {
  contractStaff: coreFlowSeedData.users.contractStaff.phone,
  cashier: coreFlowSeedData.users.cashier.phone,
  chairman: "13800001001",
  projectManager: "13800001003",
  contractDirector: "13800001004",
  financeDirector: "13800001007",
  materialStaff: "13800001009",
  materialDirector: "13800001008",
  comprehensiveDirector: "13800001013",
  employee: "13800001014"
};

const ROLE_LABELS = {
  contractStaff: "合同员",
  cashier: "出纳/财务",
  chairman: "董事长",
  projectManager: "项目经理",
  contractDirector: "合同部主管",
  financeDirector: "财务总监",
  materialStaff: "物资员",
  materialDirector: "物资主管",
  comprehensiveDirector: "综合部主管",
  employee: "普通员工"
};

const RUN_ID = (process.env.TRIAL_RUN_ID || `${Date.now()}-${process.pid}`)
  .replace(/[^0-9A-Za-z-]/g, "")
  .slice(0, 32);
const CODES = {
  contract: `HT-UAT-${RUN_ID}`,
  blockedPayment: `FK-UAT-BLOCK-${RUN_ID}`,
  settlement: `JS-UAT-${RUN_ID}`,
  payment: `FK-UAT-${RUN_ID}`,
  overLimitPayment: `FK-UAT-OVER-${RUN_ID}`
};
const IS_ISOLATED_WRITE_UAT = process.argv.includes("--isolated-write-uat");
const GOVERNANCE_EVIDENCE_ARG = process.argv.find((argument) =>
  argument.startsWith("--governance-evidence=")
);
const GOVERNANCE_EVIDENCE_PATH =
  GOVERNANCE_EVIDENCE_ARG?.slice("--governance-evidence=".length) ||
  process.env.TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH ||
  "";
const EXPECTED_GOVERNANCE_CANDIDATE_SHA =
  process.env.TRIAL_RUN_CANDIDATE_SHA || "";

const GOVERNANCE_UAT_CASES = [
  ["contract_material_purchase", "材料采购合同完整审批、用章和归档"],
  ["contract_equipment_rental", "机械租赁合同完整审批、用章和归档"],
  ["contract_labor_subcontract", "劳务分包合同的项目级总工节点"],
  ["contract_professional_subcontract", "专业分包合同的项目级总工节点"],
  ["contract_generic", "通用合同综合部主管审批与直接付款来源"],
  ["contract_director_initiator_skip", "合同部主管发起时跳过自审节点"],
  ["contract_final_or_sign", "董事长或总经理任一人终审即通过"],
  ["contract_authorization_none_none", "双方均不需授权委托书"],
  ["contract_authorization_first_only", "仅我方需授权委托书"],
  ["contract_authorization_counterparty_only", "仅乙方需授权委托书"],
  ["contract_authorization_both", "双方均需授权委托书"],
  ["contract_change_9_99_percent", "累计正增项 9.99% 可提交"],
  ["contract_change_10_percent", "累计正增项 10% 可提交"],
  ["contract_change_10_01_percent", "累计正增项 10.01% 必须被阻断并提示新签合同"],
  ["settlement_material_route", "材料或机械结算的物资员、物资主管路线"],
  ["settlement_labor_route", "劳务或专业分包结算的工长或施工员、项目总工路线"],
  ["settlement_single_page_signatures", "单页 A4 横向结算单底部冻结签名"],
  ["settlement_multi_page_signatures", "多页结算单重复表头与逐页冻结签名"],
  ["readonly_cross_domain_positive", "授权财务或综合部岗位跨域只读和下载"],
  ["readonly_cross_domain_negative", "跨域只读岗位不能创建、修改、上传或确认"]
];

const HISTORICAL_BALANCE = {
  historicalSettledCents: "1200000",
  historicalApprovalPendingPaymentCents: "100000",
  historicalApprovedPendingPaymentCents: "200000",
  // 80% 当期结算款规则下，历史已付不得超过 12000 元期初结算的 9600 元到期额度。
  historicalPaidCents: "900000",
  historicalProxyPaidCents: "300000",
  historicalAdvancePaidCents: "0",
  historicalAdvanceDeductedCents: "0",
  historicalRetentionWithheldCents: "0",
  historicalRetentionReleasedCents: "0",
  otherConfirmedOccupancyCents: "100000"
};
const EXPECTED_TAKEOVER_SUGGESTED_LEVEL = "B";
const TAKEOVER_LEVEL_ADJUSTMENT_REASON =
  "UAT：系统建议B级，合同部按三类接管资料齐全并由主管复核确认后申报A级。";
const TAKEOVER_EVIDENCE_PURPOSES = [
  "historical_contract_scan",
  "historical_settlement_ledger",
  "historical_payment_voucher"
];
const TAKEOVER_EVIDENCE_DOWNLOAD_REASON_BY_ROLE = {
  "合同员": "UAT 合同员接管资料下载验收",
  "财务总监": "UAT 财务总监接管资料下载验收"
};
const TAKEOVER_EVIDENCE_DENIED_DOWNLOAD_REASON = "UAT 普通员工接管资料越权下载校验";
const SETTLEMENT_ARCHIVE_DOWNLOAD_REASON = "UAT 合同员结算归档件下载验收";
const PAYMENT_VOUCHER_DOWNLOAD_REASON = "UAT 出纳付款凭证下载验收";
const PAYMENT_PDF_ARCHIVE_DOWNLOAD_REASON = "UAT 出纳付款PDF归档下载验收";
const SETTLEMENT_TEMPLATE_HEADERS = [
  "清单编码/行号",
  "清单项名称",
  "是否本期结算",
  "合同数量",
  "合同单价",
  "前期已结算数量",
  "本期数量",
  "累计结算数量",
  "剩余可结算数量",
  "本期结算金额(分)",
  "人工调整金额(分)",
  "调整原因",
  "证据说明",
  "异常说明",
  "备注"
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return values;
      }
      const eq = trimmed.indexOf("=");
      if (eq <= 0) {
        return values;
      }
      const key = trimmed.slice(0, eq).trim();
      const rawValue = trimmed.slice(eq + 1).trim();
      return {
        ...values,
        [key]: rawValue.replace(/^['"]|['"]$/g, "")
      };
    }, {});
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}：预期 ${expected}，实际 ${actual}`);
  }
}

function assertPositiveInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} 必须是非负整数`);
}

function isLocalHostName(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function assertLocalRuntimeGuard() {
  let apiUrl;
  try {
    apiUrl = new URL(baseUrl);
  } catch {
    throw new Error(`API_BASE_URL 不是有效 URL：${baseUrl}`);
  }
  assert(
    ["http:", "https:"].includes(apiUrl.protocol) && isLocalHostName(apiUrl.hostname),
    `P0-5B UAT 只能连接本机 API，当前 API_BASE_URL=${apiUrl.origin}`
  );

  const databaseUrl = env.DATABASE_URL;
  assert(databaseUrl, "P0-5B UAT 缺少 DATABASE_URL，不能确认是否为本地测试库。");

  let dbUrl;
  try {
    dbUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL 不是有效 PostgreSQL URL。");
  }
  assert(
    ["postgresql:", "postgres:"].includes(dbUrl.protocol),
    "P0-5B UAT 只能连接 PostgreSQL 本地测试库。"
  );
  assert(
    isLocalHostName(dbUrl.hostname),
    "P0-5B UAT 拒绝连接非本机数据库，请改用 localhost/127.0.0.1 测试库。"
  );
  assert(
    !/prod|production/i.test(dbUrl.pathname),
    "P0-5B UAT 拒绝疑似生产数据库名称，请改用本地 seed/test 数据库。"
  );

  const storageDriver = String(env.FILE_STORAGE_DRIVER ?? "local").toLowerCase();
  assert(
    storageDriver !== "cos",
    "P0-5B UAT 拒绝使用 COS 文件存储，请改用本地 FILE_STORAGE_DRIVER=local。"
  );
}

function loadGovernanceEvidenceManifest() {
  assert(
    GOVERNANCE_EVIDENCE_PATH,
    "合同结算治理 UAT 缺少证据清单：请使用 --governance-evidence=<隔离 UAT JSON 绝对路径>"
  );
  const manifestPath = path.resolve(GOVERNANCE_EVIDENCE_PATH);
  assert(fs.existsSync(manifestPath), `合同结算治理 UAT 证据清单不存在：${manifestPath}`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("合同结算治理 UAT 证据清单不是有效 JSON。");
  }

  assertEqual(manifest.schemaVersion, 1, "合同结算治理 UAT 证据清单版本");
  assert(
    typeof manifest.runId === "string" && manifest.runId.length >= 8,
    "合同结算治理 UAT 证据清单缺少 runId"
  );
  assert(
    /^[0-9a-f]{40}$/.test(String(manifest.candidateSha ?? "")),
    "合同结算治理 UAT 证据清单必须绑定 40 位小写候选 SHA"
  );
  assertEqual(manifest.storageDriver, "local", "合同结算治理 UAT 文件存储类型");
  assert(
    manifest.productionData === false,
    "合同结算治理 UAT 证据必须明确 productionData=false"
  );
  assertEqual(
    manifest.apiOrigin,
    new URL(baseUrl).origin,
    "合同结算治理 UAT 证据清单 API 来源"
  );
  const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ""));
  assertEqual(
    manifest.databaseName,
    databaseName,
    "合同结算治理 UAT 证据清单数据库"
  );
  assert(Array.isArray(manifest.cases), "合同结算治理 UAT 证据清单缺少 cases 数组");

  const caseById = new Map(manifest.cases.map((item) => [item?.id, item]));
  for (const [id, label] of GOVERNANCE_UAT_CASES) {
    const evidence = caseById.get(id);
    assert(evidence, `合同结算治理 UAT 缺少场景：${label} (${id})`);
    assert(evidence.passed === true, `合同结算治理 UAT 场景未通过：${label} (${id})`);
    assert(
      Array.isArray(evidence.evidenceIds) &&
        evidence.evidenceIds.length > 0 &&
        evidence.evidenceIds.every((value) => typeof value === "string" && value.length > 0),
      `合同结算治理 UAT 场景缺少脱敏证据编号：${label} (${id})`
    );
    assert(
      evidence.evidenceIds.some((value) => value.includes(manifest.runId)),
      `合同结算治理 UAT 场景证据未绑定本次 runId：${label} (${id})`
    );
  }

  const duplicateIds = manifest.cases
    .map((item) => item?.id)
    .filter((id, index, all) => id && all.indexOf(id) !== index);
  assert(duplicateIds.length === 0, `合同结算治理 UAT 场景编号重复：${duplicateIds.join(", ")}`);
  return manifest;
}

function assertGovernanceEvidenceManifest(manifest) {
  assertEqual(
    manifest.runId,
    RUN_ID,
    "合同结算治理 UAT 证据清单与当前 TRIAL_RUN_ID"
  );
  assert(
    /^[0-9a-f]{40}$/.test(EXPECTED_GOVERNANCE_CANDIDATE_SHA),
    "完整 UAT 必须设置 TRIAL_RUN_CANDIDATE_SHA 为当前候选的 40 位小写 SHA"
  );
  assertEqual(
    manifest.candidateSha,
    EXPECTED_GOVERNANCE_CANDIDATE_SHA,
    "合同结算治理 UAT 证据清单候选 SHA"
  );
  const requiredCaseIds = new Set(GOVERNANCE_UAT_CASES.map(([id]) => id));
  const unexpectedPassed = manifest.cases.filter(
    (item) => item?.passed === true && !requiredCaseIds.has(item.id)
  );
  assert(
    unexpectedPassed.length === 0,
    `合同结算治理 UAT 证据清单含有未知通过项：${unexpectedPassed
      .map((item) => item.id)
      .join(", ")}`
  );
}

async function login(role, phone) {
  const requestLogin = (password) => fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password })
    });

  let response = await requestLogin(INITIAL_PASSWORD);
  if (!response.ok && PASSWORD !== INITIAL_PASSWORD) {
    response = await requestLogin(PASSWORD);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${ROLE_LABELS[role] ?? role} 登录失败：HTTP ${response.status} ${body}`);
  }

  const data = await response.json();
  if (!data.tokens?.accessToken) {
    throw new Error(`${ROLE_LABELS[role] ?? role} 登录失败：未返回 accessToken`);
  }

  if (data.user?.mustChangePassword) {
    const changeResponse = await fetch(`${baseUrl}/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.tokens.accessToken}`
      },
      body: JSON.stringify({
        name: data.user.name,
        oldPassword: INITIAL_PASSWORD,
        newPassword: PASSWORD
      })
    });
    if (!changeResponse.ok) {
      const body = await changeResponse.text();
      throw new Error(`${ROLE_LABELS[role] ?? role} 首次改密失败：HTTP ${changeResponse.status} ${body}`);
    }
    const changed = await changeResponse.json();
    if (!changed.tokens?.accessToken || changed.user?.mustChangePassword) {
      throw new Error(`${ROLE_LABELS[role] ?? role} 首次改密失败：未返回可继续试运行的新令牌`);
    }
    return changed.tokens.accessToken;
  }

  return data.tokens.accessToken;
}

async function assertApiHealthReady() {
  const candidates = ["/health", "/api/health"];
  const errors = [];

  for (const path of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) {
        return;
      }
      errors.push(`${path}: HTTP ${response.status}`);
    } catch (error) {
      errors.push(`${path}: ${String(error?.message ?? error)}`);
    }
  }

  throw new Error(`本地 API 健康检查未通过：${errors.join("；")}`);
}

async function loginAll() {
  const entries = await Promise.all(
    Object.entries(PHONES).map(async ([role, phone]) => [role, await login(role, phone)])
  );
  return Object.fromEntries(entries);
}

async function userIdByPhone(role) {
  const user = await prisma.user.findUnique({
    where: { phone: PHONES[role] },
    select: { id: true }
  });
  assert(user, `${ROLE_LABELS[role] ?? role} 用户不存在，无法校验审计操作人`);
  return user.id;
}

async function readJson(path, token, label = path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} 读取失败：HTTP ${response.status} ${body}`);
  }

  return response.json();
}

async function postJson(path, body, token, label = path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${label} 提交失败：HTTP ${response.status} ${responseBody}`);
  }

  return response.json();
}

async function putJson(path, body, token, label = path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${label} 保存失败：HTTP ${response.status} ${responseBody}`);
  }

  return response.json();
}

async function postJsonExpectFailure(path, body, token, label) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify(body)
  });
  const responseBody = await response.text();

  if (response.ok) {
    throw new Error(`${label} 应被拒绝，但接口返回成功：${responseBody}`);
  }

  return {
    status: response.status,
    body: responseBody
  };
}

async function uploadPrivateBuffer(fileName, mimeType, buffer, token) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: mimeType }),
    fileName
  );

  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: authHeaders(token),
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`上传 UAT 脱敏文件失败：HTTP ${response.status} ${body}`);
  }

  return response.json();
}

async function uploadPrivateFile(fileName, token) {
  return uploadPrivateBuffer(
    fileName,
    "application/pdf",
    Buffer.from(`P0-5B 真实试运行 UAT 脱敏验证文件：${fileName}\n`),
    token
  );
}

async function uploadValidPdf(fileName, token) {
  const document = await PDFDocument.create();
  document.addPage([841.89, 595.28]);
  return uploadPrivateBuffer(
    fileName,
    "application/pdf",
    Buffer.from(await document.save({ useObjectStreams: false })),
    token
  );
}

async function uploadExistingLocalFile(fileId, fileName, token) {
  const file = await prisma.fileObject.findUnique({ where: { id: fileId } });
  assert(file?.storageStatus === "active", `未找到本地冻结文件 ${fileId}`);
  const privateRoot = path.resolve(env.FILE_STORAGE_ROOT || path.resolve(process.cwd(), "storage", "private"));
  const absolutePath = path.resolve(privateRoot, file.objectKey);
  assert(absolutePath.startsWith(`${privateRoot}${path.sep}`), "冻结文件路径越界");
  return uploadPrivateBuffer(fileName, file.mimeType, fs.readFileSync(absolutePath), token);
}

async function prepareSettlementSignatures(tokens) {
  const signaturePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
    "base64"
  );
  for (const role of [
    "contractStaff", "materialStaff", "materialDirector", "contractDirector",
    "projectManager", "financeDirector"
  ]) {
    const userId = await userIdByPhone(role);
    const signature = await uploadPrivateBuffer(
      `UAT-${RUN_ID}-${role}-signature.png`,
      "image/png",
      signaturePng,
      tokens[role]
    );
    await prisma.user.update({ where: { id: userId }, data: { signatureFileId: signature.id } });
  }
}

async function prepareGovernedSettlementDraft(input, token) {
  const fieldReviewerUserId = await userIdByPhone("materialStaff");
  const draft = await postJson(
    `/projects/${PROJECT_ID}/settlement-drafts`,
    {
      contractVersionId: input.contractVersionId,
      settlementTemplateVersionId: input.settlementTemplateVersionId,
      code: input.code,
      periodLabel: input.periodLabel,
      fieldReviewerUserId,
      fieldReviewerRoleKey: "material_staff",
      settlementLines: input.settlementLines
    },
    token,
    `保存 ${input.code} 结算草稿`
  );
  const frozen = await postJson(
    `/projects/${PROJECT_ID}/settlement-drafts/${draft.id}/frozen-document`,
    { expectedRevision: draft.revision },
    token,
    `冻结 ${input.code} 结算单`
  );
  const signedFile = await uploadExistingLocalFile(
    frozen.fileId,
    `${input.code}-counterparty-signed.pdf`,
    token
  );
  const signedDocument = await postJson(
    `/projects/${PROJECT_ID}/settlement-drafts/${draft.id}/counterparty-signed-documents`,
    {
      expectedRevision: draft.revision,
      frozenDocumentId: frozen.id,
      uploadedFileId: signedFile.id,
      declaration: {
        pageOrderMatchesFrozenDocument: true,
        counterpartySignedAndDated: true,
        everyPageStamped: true,
        crossPageSealCompleted: true
      }
    },
    token,
    `关联 ${input.code} 乙方签章扫描件`
  );
  assertEqual(signedDocument.pageCount, frozen.pageCount, `${input.code} 签章扫描件页数`);
  return draft;
}

async function createPublishedSettlementTemplate(token) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("本期结算明细");
  worksheet.addRow(SETTLEMENT_TEMPLATE_HEADERS);
  worksheet.addRow([]);
  worksheet.addRow([]);
  worksheet.addRow([]);
  worksheet.addRow([]);
  worksheet.getCell("A6").value = "经办人签字：";
  worksheet.getCell("H6").value = "审核人签字：";
  worksheet.pageSetup.printArea = "A1:O6";
  const sourceBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const sourceFile = await uploadPrivateBuffer(
    `JS-UAT-TEMPLATE-${RUN_ID}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceBuffer,
    token
  );
  const created = await postJson(
    "/settlement-templates",
    {
      name: `P0-5B UAT 脱敏结算模板 ${RUN_ID}`,
      code: `JS-UAT-TPL-${RUN_ID}`,
      xlsxFileId: sourceFile.id,
      compatibleContractTypeKeys: ["material_purchase"],
      compatibleAmountRoles: [],
      compatiblePricingModes: [],
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    },
    token,
    "创建 UAT 结算模板"
  );
  const versionId = created.version?.id;
  assert(versionId, "创建 UAT 结算模板未返回版本编号");
  const inspection = await postJson(
    `/settlement-template-versions/${versionId}/inspection`,
    {},
    token,
    "检查 UAT 结算模板"
  );
  assertEqual(inspection.blockingErrors?.length, 0, "UAT 结算模板阻断项数量");
  await postJson(
    `/settlement-template-versions/${versionId}/preview-generation`,
    {},
    token,
    "生成 UAT 结算模板脱敏预览"
  );
  await postJson(
    `/settlement-template-versions/${versionId}/submission`,
    {},
    token,
    "提交 UAT 结算模板"
  );
  const published = await postJson(
    `/settlement-template-versions/${versionId}/publication`,
    { changeSummary: "P0-5B UAT 脱敏模板发布验证" },
    token,
    "发布 UAT 结算模板"
  );
  assertEqual(published.status, "published", "UAT 结算模板发布状态");
  return versionId;
}

async function assertSeedDataReady() {
  const requiredUsers = [
    coreFlowSeedData.users.contractStaff.id,
    coreFlowSeedData.users.cashier.id
  ];
  const [project, users] = await Promise.all([
    prisma.project.findUnique({ where: { id: PROJECT_ID } }),
    prisma.user.findMany({ where: { id: { in: requiredUsers } } })
  ]);

  if (!project || users.length !== requiredUsers.length) {
    throw new Error("缺少 seed/test 数据，请先运行 `pnpm --filter @jiangkong/api seed`。");
  }
}

function assertWorkbenchSummaryShape(summary, label) {
  assert(summary && typeof summary === "object", `${label} 工作台摘要必须是对象`);
  assert(typeof summary.generatedAt === "string", `${label} 工作台摘要缺少 generatedAt`);
  assertPositiveInteger(summary.visibleProjectCount, `${label} 可见项目数`);
  assert(Array.isArray(summary.cards), `${label} 工作台摘要缺少 cards 数组`);

  for (const card of summary.cards) {
    assert(typeof card.id === "string" && card.id.length > 0, `${label} 工作台卡片缺少 id`);
    assert(typeof card.title === "string" && card.title.length > 0, `${label} 工作台卡片缺少标题`);
    assertPositiveInteger(card.count, `${label} ${card.id} 数量`);
    assert(
      typeof card.description === "string" && card.description.length > 0,
      `${label} ${card.id} 缺少说明`
    );
    assert(
      typeof card.targetPath === "string" && card.targetPath.length > 0,
      `${label} ${card.id} 缺少跳转入口`
    );
    assert(
      typeof card.actionText === "string" && card.actionText.length > 0,
      `${label} ${card.id} 缺少操作文案`
    );
  }
}

function findCard(summary, id) {
  return summary.cards.find((card) => card.id === id);
}

function assertCardCountAtLeast(summary, id, minimum, label) {
  const card = findCard(summary, id);
  assert(card, `${label} 未返回工作台卡片 ${id}`);
  assert(
    card.count >= minimum,
    `${label} 工作台卡片 ${id} 数量不足：预期至少 ${minimum}，实际 ${card.count}`
  );
  return card;
}

async function loadWorkbenchSummary(label, token) {
  const summary = await readJson("/me/workbench-summary", token, `${label} 工作台摘要`);
  assertWorkbenchSummaryShape(summary, label);
  return summary;
}

async function createHistoricalTakeover(token) {
  const takeover = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers`,
    {
      code: CODES.contract,
      name: "P0-5B UAT 脱敏历史材料采购合同",
      counterparty: "P0-5B UAT 脱敏供应商",
      contractTypeKey: "material_purchase",
      companyEntityId: coreFlowSeedData.companyEntity.id,
      companyEntityName: coreFlowSeedData.companyEntity.name,
      amountCents: "10000000",
      signedAt: "2026-05-20",
      takeoverLevel: "A",
      lifecycleStatus: "in_progress",
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "9",
      taxFactSource: "contract_document",
      taxFactExplanation: "UAT 脱敏历史合同税务事实复核",
      paymentTermsOriginalText: "UAT：结算归档确认后可按当期结算款 80% 发起付款。",
      ...HISTORICAL_BALANCE,
      balanceSourceSummary: "UAT 脱敏财务台账摘要",
      evidenceSummary: "UAT 脱敏合同、结算和银行回单摘要",
      reviewComment: TAKEOVER_LEVEL_ADJUSTMENT_REASON
    },
    token,
    "创建历史合同接管"
  );

  assertEqual(takeover.contractNo, CODES.contract, "历史接管合同编号");
  assertEqual(takeover.takeoverStatus, "draft", "历史接管创建状态");
  assertEqual(takeover.takeoverLevel, "A", "历史接管申报等级");
  assertEqual(
    takeover.suggestedTakeoverLevel,
    EXPECTED_TAKEOVER_SUGGESTED_LEVEL,
    "历史接管系统建议等级"
  );
  assertEqual(
    takeover.takeoverLevelAdjustmentReason,
    TAKEOVER_LEVEL_ADJUSTMENT_REASON,
    "历史接管等级调整原因"
  );
  return takeover;
}

async function confirmHistoricalTaxFacts(takeoverId, tokens) {
  const revision = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeoverId}/tax-fact-revisions`,
    {
      kind: "supplement",
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "9",
      source: "contract_document",
      confirmationExplanation: "UAT 脱敏历史合同税务事实复核",
      rowFacts: []
    },
    tokens.contractStaff,
    "创建 UAT 历史合同税务事实补录"
  );
  await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeoverId}/tax-fact-revisions/${revision.id}/finance-review-submission`,
    {},
    tokens.contractStaff,
    "提交 UAT 税务事实财务复核"
  );
  await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeoverId}/tax-fact-revisions/${revision.id}/finance-review`,
    { decision: "approve", comment: "UAT 财务复核通过" },
    tokens.financeDirector,
    "财务复核 UAT 税务事实"
  );
  const confirmed = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeoverId}/tax-fact-revisions/${revision.id}/contract-confirmation`,
    { decision: "approve", comment: "UAT 合同部确认通过" },
    tokens.contractDirector,
    "合同部确认 UAT 税务事实"
  );
  assertEqual(confirmed.status, "confirmed", "UAT 税务事实确认状态");
}

async function loadTakeoverRecord(takeoverId) {
  const takeover = await prisma.contractTakeover.findUnique({
    where: { id: takeoverId },
    select: {
      id: true,
      projectId: true,
      contractId: true,
      contractVersionId: true,
      paymentTermsVersionId: true,
      takeoverLevel: true,
      suggestedTakeoverLevel: true,
      takeoverLevelAdjustmentReason: true,
      takeoverStatus: true,
      confirmedAt: true,
      historicalBalanceConfirmedAt: true
    }
  });

  assert(takeover, "数据库中未找到刚创建的历史接管记录");
  assertEqual(takeover.takeoverLevel, "A", "数据库历史接管申报等级");
  assertEqual(
    takeover.suggestedTakeoverLevel,
    EXPECTED_TAKEOVER_SUGGESTED_LEVEL,
    "数据库历史接管系统建议等级"
  );
  assertEqual(
    takeover.takeoverLevelAdjustmentReason,
    TAKEOVER_LEVEL_ADJUSTMENT_REASON,
    "数据库历史接管等级调整原因"
  );
  return takeover;
}

async function assertTakeoverConfirmationWrongPasswordBlocked(
  takeoverId,
  contractRevision,
  token
) {
  const failed = await postJsonExpectFailure(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeoverId}/contract-side/confirmation`,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: contractRevision,
      currentPassword: "UAT-WRONG-PASSWORD"
    },
    token,
    "错误密码确认合同侧历史接管"
  );
  assert(
    failed.status >= 400,
    `错误密码确认合同侧历史接管 HTTP 状态异常：${failed.status}`
  );
  assert(
    failed.body.includes("当前密码不正确"),
    `错误密码确认合同侧历史接管未返回中文业务提示：${failed.body}`
  );

  const takeover = await loadTakeoverRecord(takeoverId);
  assertEqual(takeover.takeoverStatus, "pending_review", "错误密码确认后接管状态");
  assert(!takeover.confirmedAt, "错误密码确认后不应激活接管");
  assert(!takeover.historicalBalanceConfirmedAt, "错误密码确认后不应确认历史余额");
}

async function saveAndConfirmDualDepartmentTakeover(takeover, tokens) {
  const settlementEvidence = await uploadPrivateFile(
    `${CODES.contract}-settlement-evidence.pdf`,
    tokens.contractStaff
  );
  const contractSide = await putJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/contract-side`,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      signedAt: takeover.signedAt.slice(0, 10),
      performanceStatus: "performing",
      historicalSettledCents: HISTORICAL_BALANCE.historicalSettledCents,
      settlementEvidenceSummary: "UAT 脱敏历史结算台账与双方核对依据",
      settlementEvidenceFileIds: [settlementEvidence.id],
      paymentTerms: {
        originalText: takeover.paymentTermsOriginalText,
        stages: [
          {
            name: "当期结算款",
            ratioBps: 8000,
            dueDays: 0,
            requiresInvoice: false,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
        ]
      },
      contractFacts: {
        contractNo: takeover.contractNo,
        contractName: takeover.contractName,
        contractTypeKey: takeover.contractTypeKey,
        counterparty: takeover.counterparty,
        originalAmountCents: takeover.amountCents,
        settlementCutoffDate: "2026-06-30",
        zeroSettlementDeclared: false
      }
    },
    tokens.contractStaff,
    "保存历史接管合同侧事实"
  );
  assertEqual(contractSide.revision, 1, "合同侧首次保存修订");

  const paymentVoucher = await uploadPrivateFile(
    `${CODES.contract}-historical-payment-voucher.pdf`,
    tokens.financeDirector
  );
  const financeSide = await putJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/finance-side`,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      basedOnContractRevision: contractSide.revision,
      basedOnFinanceBasisRevision: contractSide.financeBasisRevision,
      zeroPaymentDeclared: false,
      payments: [
        {
          rowKey: "uat-historical-payment-1",
          amountCents: HISTORICAL_BALANCE.historicalPaidCents,
          paidAt: "2026-06-30",
          payerName: "P0-5B UAT 脱敏付款单位",
          payeeName: takeover.counterparty,
          bankReference: `UAT-${RUN_ID}`,
          paymentMethod: "银行转账",
          voucherFileIds: [paymentVoucher.id]
        }
      ]
    },
    tokens.financeDirector,
    "保存历史接管财务侧事实"
  );
  assertEqual(financeSide.revision, 1, "财务侧首次保存修订");

  await assertTakeoverConfirmationWrongPasswordBlocked(
    takeover.id,
    contractSide.revision,
    tokens.contractDirector
  );
  const contractConfirmation = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/contract-side/confirmation`,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: contractSide.revision,
      currentPassword: PASSWORD
    },
    tokens.contractDirector,
    "确认历史接管合同侧"
  );
  assertEqual(
    contractConfirmation.activationStatus,
    "awaiting_finance_confirmation",
    "合同侧确认后的激活状态"
  );

  const financeConfirmation = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/finance-side/confirmation`,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: financeSide.revision,
      currentPassword: PASSWORD,
      basedOnContractRevision: contractSide.revision,
      basedOnFinanceBasisRevision: contractSide.financeBasisRevision
    },
    tokens.financeDirector,
    "确认历史接管财务侧"
  );
  assertEqual(financeConfirmation.activated, true, "双侧确认后的接管激活结果");
  assertEqual(
    financeConfirmation.activationStatus,
    "activated",
    "双侧确认后的激活状态"
  );
  return financeConfirmation;
}

async function loadTakeoverReadModel(takeoverId, token) {
  const rows = await readJson(
    `/projects/${PROJECT_ID}/contract-takeovers`,
    token,
    "历史接管读模型"
  );
  assert(Array.isArray(rows), "历史接管读模型不是列表");
  const takeover = rows.find((row) => row.id === takeoverId);
  assert(takeover, "历史接管读模型未返回刚创建的接管记录");
  return takeover;
}

async function assertTakeoverVerification(takeoverId, token, expected) {
  const takeover = await loadTakeoverReadModel(takeoverId, token);
  const verification = takeover.postConfirmationVerification;
  assert(verification, "历史接管读模型缺少接管后核验摘要");
  assertEqual(verification.statusLabel, expected.statusLabel, expected.label);

  for (const [field, minimum] of Object.entries(expected.minimumCounts ?? {})) {
    assert(
      Number(verification[field] ?? 0) >= minimum,
      `${expected.label}${field} 数量不足：预期至少 ${minimum}，实际 ${verification[field]}`
    );
  }

  return verification;
}

async function assertHistoricalInitialSettlement(takeoverRecord) {
  const settlement = await prisma.settlement.findUnique({
    where: { sourceTakeoverId: takeoverRecord.id },
    select: {
      id: true,
      contractVersionId: true,
      paymentTermsVersionId: true,
      periodLabel: true,
      status: true,
      amountCents: true,
      payableAmountCents: true,
      paidAmountCents: true,
      sourceType: true,
      sourceTakeoverId: true
    }
  });
  assert(settlement, "历史接管确认后未生成期初有效结算来源");
  assertEqual(settlement.status, "effective", "历史期初结算状态");
  assertEqual(settlement.periodLabel, "历史期初", "历史期初结算期间");
  assertEqual(settlement.sourceType, "historical_takeover", "历史期初结算来源类型");
  assertEqual(settlement.sourceTakeoverId, takeoverRecord.id, "历史期初结算接管来源");
  assertEqual(
    settlement.contractVersionId,
    takeoverRecord.contractVersionId,
    "历史期初结算合同版本"
  );
  assertEqual(
    settlement.paymentTermsVersionId,
    takeoverRecord.paymentTermsVersionId,
    "历史期初结算付款条款版本"
  );
  assertEqual(
    settlement.amountCents,
    BigInt(HISTORICAL_BALANCE.historicalSettledCents),
    "历史期初结算金额"
  );
  assertEqual(
    settlement.payableAmountCents,
    BigInt(HISTORICAL_BALANCE.historicalSettledCents),
    "历史期初结算可付金额"
  );
  assertEqual(
    settlement.paidAmountCents,
    BigInt(HISTORICAL_BALANCE.historicalPaidCents),
    "历史期初结算已付金额"
  );
  const archiveCount = await prisma.settlementArchiveFile.count({
    where: { settlementId: settlement.id }
  });
  assertEqual(archiveCount, 0, "历史期初结算不应伪造普通结算归档件");

  return settlement;
}

async function downloadPrivateFileWithReason(fileId, token, label, downloadReason) {
  assert(downloadReason, `${label}下载原因未配置`);
  const ticket = await postJson(
    `/files/${fileId}/download-ticket`,
    {
      confirmationPassword: PASSWORD,
      downloadReason
    },
    token,
    `${label}生成短时效下载链接`
  );
  const expiresAtMs = Date.parse(ticket.expiresAt);
  assertEqual(ticket.fileId, fileId, `${label}下载票据文件`);
  assert(
    Number.isFinite(expiresAtMs),
    `${label}下载票据未返回有效到期时间`
  );
  assert(
    expiresAtMs > Date.now() && expiresAtMs <= Date.now() + 5 * 60 * 1000,
    `${label}下载票据不是 5 分钟内短时效链接`
  );
  assert(
    typeof ticket.downloadUrl === "string" &&
      ticket.downloadUrl.includes("expiresAt=") &&
      ticket.downloadUrl.includes("downloadReason="),
    `${label}下载票据未包含到期时间或下载原因`
  );
  await assertPrivateFileDownloadTicketTamperBlocked(fileId, ticket.downloadUrl, label);

  const response = await fetch(`${baseUrl}${ticket.downloadUrl}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label}短时效链接下载失败：HTTP ${response.status} ${body}`);
  }
  const content = await response.arrayBuffer();
  assert(content.byteLength > 0, `${label}短时效链接下载内容为空`);
}

async function assertPrivateFileDownloadTicketTamperBlocked(fileId, downloadUrl, label) {
  const auditCountBefore = await prisma.auditLog.count({
    where: {
      businessType: "file_object",
      businessId: fileId,
      action: "file.download"
    }
  });
  const tamperedReasonUrl = new URL(downloadUrl, baseUrl);
  tamperedReasonUrl.searchParams.set("downloadReason", "UAT 篡改下载原因");
  await assertTamperedPrivateFileDownloadRejected(
    tamperedReasonUrl,
    `${label}篡改下载原因`
  );

  const tamperedFileUrl = new URL(downloadUrl, baseUrl);
  tamperedFileUrl.pathname = tamperedFileUrl.pathname.replace(fileId, "UAT-TAMPERED-FILE");
  await assertTamperedPrivateFileDownloadRejected(
    tamperedFileUrl,
    `${label}篡改资料编号`
  );

  const tamperedActorUrl = new URL(downloadUrl, baseUrl);
  tamperedActorUrl.searchParams.set("actorUserId", "UAT-TAMPERED-ACTOR");
  await assertTamperedPrivateFileDownloadRejected(
    tamperedActorUrl,
    `${label}篡改下载人`
  );

  const tamperedExpiryUrl = new URL(downloadUrl, baseUrl);
  tamperedExpiryUrl.searchParams.set("expiresAt", new Date(Date.now() + 120_000).toISOString());
  await assertTamperedPrivateFileDownloadRejected(
    tamperedExpiryUrl,
    `${label}篡改到期时间`
  );
  const auditCountAfter = await prisma.auditLog.count({
    where: {
      businessType: "file_object",
      businessId: fileId,
      action: "file.download"
    }
  });
  assertEqual(auditCountAfter, auditCountBefore, `${label}篡改下载票据审计数量`);
}

async function assertTamperedPrivateFileDownloadRejected(downloadUrl, label) {
  const response = await fetch(downloadUrl);
  assert(
    !response.ok,
    `${label}后短时效链接不应下载成功`
  );
  const body = await response.text();
  assert(
    body.includes("下载链接校验失败"),
    `${label}未返回中文业务提示：${body}`
  );
}

async function downloadTakeoverEvidenceFile(fileId, token, label) {
  await downloadPrivateFileWithReason(
    fileId,
    token,
    `${label}接管资料`,
    TAKEOVER_EVIDENCE_DOWNLOAD_REASON_BY_ROLE[label]
  );
}

async function assertTakeoverEvidenceDownloadDenied(fileId, token, label) {
  await postJsonExpectFailure(
    `/files/${fileId}/download-ticket`,
    {
      confirmationPassword: PASSWORD,
      downloadReason: TAKEOVER_EVIDENCE_DENIED_DOWNLOAD_REASON
    },
    token,
    `${label}越权下载接管资料`
  );
}

async function assertTakeoverEvidenceDownloadReasonRequired(fileId, token) {
  const auditCountBefore = await prisma.auditLog.count({
    where: {
      businessType: "file_object",
      businessId: fileId,
      action: { in: ["file.download.ticket", "file.download"] }
    }
  });
  const failed = await postJsonExpectFailure(
    `/files/${fileId}/download-ticket`,
    {
      confirmationPassword: PASSWORD,
      downloadReason: "   "
    },
    token,
    "缺下载原因下载接管资料"
  );
  assert(
    failed.status >= 400,
    `缺下载原因下载接管资料 HTTP 状态异常：${failed.status}`
  );
  assert(
    failed.body.includes("请填写下载原因"),
    `缺下载原因下载接管资料未返回中文业务提示：${failed.body}`
  );
  const auditCountAfter = await prisma.auditLog.count({
    where: {
      businessType: "file_object",
      businessId: fileId,
      action: { in: ["file.download.ticket", "file.download"] }
    }
  });
  assertEqual(auditCountAfter, auditCountBefore, "缺下载原因下载接管资料审计数量");
}

async function attachAndDownloadTakeoverEvidence(takeoverId, token) {
  const contractEvidencePurposes = TAKEOVER_EVIDENCE_PURPOSES.filter(
    (purpose) => purpose !== "historical_payment_voucher"
  );
  for (const purpose of contractEvidencePurposes) {
    const uploaded = await uploadPrivateFile(`UAT-${CODES.contract}-${purpose}.pdf`, token);
    await postJson(
      `/projects/${PROJECT_ID}/contract-takeovers/${takeoverId}/evidence-files`,
      { fileId: uploaded.id, purpose },
      token,
      `上传接管资料 ${purpose}`
    );
  }

  const takeover = await loadTakeoverReadModel(takeoverId, token);
  const uploadedPurposes = new Set(
    takeover.evidenceChecklist
      .filter((item) => item.uploaded)
      .map((item) => item.purpose)
  );
  for (const purpose of contractEvidencePurposes) {
    assert(uploadedPurposes.has(purpose), `接管资料清单未显示已上传：${purpose}`);
  }

  const downloadable = takeover.evidenceFiles.find((file) => file.canDownload);
  assert(downloadable?.fileId, "接管资料读模型未返回可下载资料");
  await downloadTakeoverEvidenceFile(downloadable.fileId, token, "合同员");
  return downloadable.fileId;
}

async function assertTakeoverEvidenceVisibleInArchiveLedger(fileId, token) {
  const archiveLedger = await readJson("/archives?limit=200", token, "资料库台账");
  assert(Array.isArray(archiveLedger.rows), "资料库台账未返回资料行");
  const row = archiveLedger.rows.find((item) => item.fileId === fileId);
  assert(row, "资料库台账未展示刚上传的历史接管资料");
  assertEqual(row.documentType, "历史接管资料", "资料库历史接管资料类型");
  assert(
    String(row.businessRef ?? "").includes(CODES.contract) &&
      String(row.businessRef ?? "").includes("历史接管"),
    `资料库历史接管资料业务标识不正确：${row.businessRef}`
  );
  assertEqual(row.archiveStatus, "已入库", "资料库历史接管资料状态");
  assertEqual(row.canDownload, true, "资料库历史接管资料下载状态");
}

async function assertSettlementArchiveVisibleInArchiveLedger(fileId, settlementCode, periodLabel, token) {
  const archiveLedger = await readJson("/archives?limit=200", token, "资料库台账");
  assert(Array.isArray(archiveLedger.rows), "资料库台账未返回资料行");
  const row = archiveLedger.rows.find((item) => item.fileId === fileId);
  assert(row, "资料库台账未展示刚确认的结算签名合成件");
  assertEqual(row.documentType, "结算我方签名合成件", "资料库结算归档资料类型");
  assert(
    String(row.businessRef ?? "").includes(settlementCode) &&
      String(row.businessRef ?? "").includes(periodLabel),
    `资料库结算归档关联业务不正确：${row.businessRef}`
  );
  assertEqual(row.archiveStatus, "证据已冻结", "资料库结算归档状态");
  assertEqual(row.canDownload, true, "资料库结算归档下载状态");
}

async function assertPaymentPdfArchiveVisibleInArchiveLedger(fileId, paymentCode, token) {
  const archiveLedger = await readJson("/archives?limit=200", token, "资料库台账");
  assert(Array.isArray(archiveLedger.rows), "资料库台账未返回资料行");
  const row = archiveLedger.rows.find((item) => item.fileId === fileId);
  assert(row, "资料库台账未展示刚归档的付款 PDF");
  assertEqual(row.documentType, "付款PDF留档", "资料库付款 PDF 资料类型");
  assert(
    String(row.businessRef ?? "").includes(paymentCode),
    `资料库付款 PDF 关联业务不正确：${row.businessRef}`
  );
  assertEqual(row.archiveStatus, "已入库", "资料库付款 PDF 归档状态");
  assertEqual(row.canDownload, true, "资料库付款 PDF 下载状态");
}

async function assertPaymentVoucherVisibleInArchiveLedger(fileId, paymentCode, token) {
  const archiveLedger = await readJson("/archives?limit=200", token, "资料库台账");
  assert(Array.isArray(archiveLedger.rows), "资料库台账未返回资料行");
  const row = archiveLedger.rows.find((item) => item.fileId === fileId);
  assert(row, "资料库台账未展示刚上传的付款凭证");
  assertEqual(row.documentType, "付款凭证", "资料库付款凭证资料类型");
  assert(
    String(row.businessRef ?? "").includes(paymentCode),
    `资料库付款凭证关联业务不正确：${row.businessRef}`
  );
  assertEqual(row.archiveStatus, "已上传", "资料库付款凭证状态");
  assertEqual(row.canDownload, true, "资料库付款凭证下载状态");
}

async function ensureProgressPaymentStage(paymentTermsVersionId) {
  const existing = await prisma.paymentTermsStage.findFirst({
    where: { paymentTermsVersionId, basis: "current_settlement" },
    orderBy: { createdAt: "asc" }
  });
  const stage = {
    name: "UAT 当期结算款",
    stageType: "progress",
    basis: "current_settlement",
    ratioBps: 8000,
    triggerAnchor: "settlement_effective",
    triggerEvent: "结算归档确认生效",
    dueDays: 0,
    requiresInvoice: true,
    allowsEarlyPayment: false,
    allowsInstallments: true,
    originalText: "UAT：结算归档确认生效后可支付当期结算款80%。"
  };
  if (existing) {
    await prisma.paymentTermsStage.update({ where: { id: existing.id }, data: stage });
    return;
  }
  await prisma.paymentTermsStage.create({
    data: { paymentTermsVersionId, ...stage }
  });
}

async function withTemporaryEffectiveVersionForBlockCheck(takeoverRecord, callback) {
  const [version, terms] = await Promise.all([
    prisma.contractVersion.findUnique({
      where: { id: takeoverRecord.contractVersionId },
      select: {
        status: true,
        effectiveAt: true,
        settlementMode: true,
        settlementModeSource: true,
        settlementModeConfirmedByUserId: true,
        settlementModeConfirmedAt: true
      }
    }),
    prisma.paymentTermsVersion.findUnique({
      where: { id: takeoverRecord.paymentTermsVersionId },
      select: { status: true }
    })
  ]);
  assert(version, "未找到 UAT 历史合同版本，无法验证未确认付款阻断。");
  assert(terms, "未找到 UAT 历史合同付款条款版本，无法验证未确认付款阻断。");

  const now = new Date();
  await prisma.$transaction([
    prisma.contractVersion.update({
      where: { id: takeoverRecord.contractVersionId },
      data: {
        status: "effective",
        effectiveAt: now,
        settlementMode: "direct_payment",
        settlementModeSource: "backfill",
        settlementModeConfirmedAt: now
      }
    }),
    prisma.paymentTermsVersion.update({
      where: { id: takeoverRecord.paymentTermsVersionId },
      data: { status: "effective" }
    })
  ]);

  try {
    return await callback();
  } finally {
    await prisma.$transaction([
      prisma.contractVersion.update({
        where: { id: takeoverRecord.contractVersionId },
        data: {
          status: version.status,
          effectiveAt: version.effectiveAt,
          settlementMode: version.settlementMode,
          settlementModeSource: version.settlementModeSource,
          settlementModeConfirmedByUserId: version.settlementModeConfirmedByUserId,
          settlementModeConfirmedAt: version.settlementModeConfirmedAt
        }
      }),
      prisma.paymentTermsVersion.update({
        where: { id: takeoverRecord.paymentTermsVersionId },
        data: { status: terms.status }
      })
    ]);
  }
}

async function findPaymentCreateOption(contractNo, token) {
  const options = await readJson(
    `/contracts/payment-create-options?projectId=${encodeURIComponent(PROJECT_ID)}`,
    token,
    "付款业务选择器"
  );
  assert(Array.isArray(options), "付款业务选择器必须返回数组");
  const option = options.find((row) => row.contractNo === contractNo);
  assert(option, `付款业务选择器未返回 UAT 历史合同 ${contractNo}`);
  return option;
}

async function verifyPaymentBlockedBeforeConfirmation(contractVersionId, token) {
  const version = await prisma.contractVersion.findUnique({ where: { id: contractVersionId } });
  assert(version, "未找到待验证付款阻断的合同版本");
  const contract = await prisma.contract.findUnique({ where: { id: version.contractId } });
  assert(contract, "未找到待验证付款阻断的合同");
  await prisma.contract.update({
    where: { id: contract.id },
    data: { contractTypeKey: "generic_contract" }
  });
  let failed;
  try {
    failed = await postJsonExpectFailure(
      "/payments",
      {
        sourceType: "contract_due",
        contractVersionId,
        paymentTermsStageId: `UAT-BLOCKED-${RUN_ID}`,
        code: CODES.blockedPayment,
        requestedAmountCents: "100000"
      },
      token,
      "未确认接管时创建付款申请"
    );
  } finally {
    await prisma.contract.update({
      where: { id: contract.id },
      data: { contractTypeKey: contract.contractTypeKey }
    });
  }

  assert(
    failed.status >= 400,
    `未确认接管付款拦截 HTTP 状态异常：${failed.status}`
  );
  assert(
    failed.body.includes("历史合同接管尚未主管确认"),
    `未确认接管付款未命中接管门禁：${failed.body}`
  );
}

async function createAndConfirmSettlement(contractVersionId, tokens) {
  const settlementTemplateVersionId = await createPublishedSettlementTemplate(
    tokens.contractDirector
  );
  await prepareSettlementSignatures(tokens);
  const settlementLines = [
    {
      sourceType: "manual_adjustment",
      name: "P0-5B UAT 脱敏本期结算调整",
      amountCents: "5000000",
      reason: "P0-5B UAT 脱敏结算依据"
    }
  ];
  const draft = await prepareGovernedSettlementDraft({
    contractVersionId,
    settlementTemplateVersionId,
    code: CODES.settlement,
    periodLabel: "2026-07",
    settlementLines
  }, tokens.contractStaff);
  let settlement = await postJson(
    `/projects/${PROJECT_ID}/settlement-drafts/${draft.id}/approval-submission`,
    { expectedRevision: draft.revision },
    tokens.contractStaff,
    "提交 UAT 结算审批"
  );
  assertEqual(settlement.status, "approval_pending", "UAT 结算创建状态");
  assertEqual(settlement.payableAmountCents, "4000000", "UAT 结算可付金额");

  for (const [role, token] of [
    ["materialStaff", tokens.materialStaff],
    ["materialDirector", tokens.materialDirector],
    ["contractDirector", tokens.contractDirector],
    ["projectManager", tokens.projectManager],
    ["financeDirector", tokens.financeDirector]
  ]) {
    settlement = await postJson(
      `/settlements/${settlement.id}/approval`,
      { decision: "approve", comment: "P0-5B UAT 脱敏审批通过" },
      token,
      `${ROLE_LABELS[role]} 审批 UAT 结算`
    );
  }
  assertEqual(settlement.status, "pending_generation", "UAT 结算审批后状态");

  const signedDocument = await postJson(
    `/settlements/${settlement.id}/signed-document-generation-retry`,
    {},
    tokens.contractDirector,
    "生成 UAT 最终签名合成件"
  );
  assert(signedDocument?.id, "UAT 最终签名合成件未返回文档标识");
  assert(signedDocument?.fileId, "UAT 最终签名合成件未返回文件标识");
  assertEqual(
    signedDocument.purpose,
    "final_internal_signed_copy",
    "UAT 最终签名合成件用途"
  );
  assertEqual(signedDocument.status, "active", "UAT 最终签名合成件状态");
  assert(
    /^[a-f0-9]{64}$/.test(signedDocument.contentSha256 || ""),
    "UAT 最终签名合成件摘要无效"
  );
  assert(
    /^[a-f0-9]{64}$/.test(signedDocument.approvalActionSetHash || ""),
    "UAT 最终签名合成件未冻结审批动作摘要"
  );
  assert(signedDocument.pageCount >= 1, "UAT 最终签名合成件页数无效");

  settlement = await postJson(
    `/settlements/${settlement.id}/archive-confirmation`,
    { confirmationPassword: PASSWORD },
    tokens.contractDirector,
    "确认 UAT 结算归档"
  );
  assertEqual(settlement.status, "effective", "UAT 结算归档确认状态");
  await assertSettlementArchiveVisibleInArchiveLedger(
    signedDocument.fileId,
    settlement.code,
    settlement.periodLabel,
    tokens.contractStaff
  );
  await downloadPrivateFileWithReason(
    signedDocument.fileId,
    tokens.contractStaff,
    "合同员结算归档件",
    SETTLEMENT_ARCHIVE_DOWNLOAD_REASON
  );

  return {
    ...settlement,
    archiveFileId: signedDocument.fileId,
    signedDocumentId: signedDocument.id,
    uatTemplateVersionId: settlementTemplateVersionId
  };
}

async function assertDuplicateSettlementPeriodBlocked(
  contractVersionId,
  settlementTemplateVersionId,
  token
) {
  for (const [suffix, periodLabel] of [
    ["DUP", "2026-07"],
    ["DUP-SPACES", " 2026-07 "]
  ]) {
    const duplicateDraft = await prepareGovernedSettlementDraft({
      contractVersionId,
      settlementTemplateVersionId,
      code: `${CODES.settlement}-${suffix}`,
      periodLabel,
      settlementLines: [
        {
          sourceType: "manual_adjustment",
          name: "P0-5B UAT 重复期间校验项",
          amountCents: "1000000",
          reason: "验证同期间唯一性"
        }
      ]
    }, token);
    const failed = await postJsonExpectFailure(
      `/projects/${PROJECT_ID}/settlement-drafts/${duplicateDraft.id}/approval-submission`,
      { expectedRevision: duplicateDraft.revision },
      token,
      `提交同期间重复 UAT 结算 ${periodLabel}`
    );
    assert(
      failed.status >= 400,
      `同期间重复结算拦截 HTTP 状态异常：${failed.status}`
    );
    assert(
      String(failed.body ?? "").includes("已存在结算单"),
      `同期间重复结算未返回中文业务提示：${failed.body}`
    );
    await postJson(
      `/projects/${PROJECT_ID}/settlement-drafts/${duplicateDraft.id}/abandonment`,
      {
        expectedRevision: duplicateDraft.revision,
        action: "abandon_application",
        reason: "重复期间校验完成，正式作废验证草稿"
      },
      token,
      `作废重复期间校验草稿 ${periodLabel}`
    );
  }
}

async function createAndApprovePayment(contractVersionId, settlementId, tokens) {
  let payment = await postJson(
    "/payments",
    {
      sourceType: "settlement",
      settlementId,
      contractVersionId,
      code: CODES.payment,
      requestedAmountCents: "1000000"
    },
    tokens.contractStaff,
    "创建 UAT 付款申请"
  );
  assertEqual(payment.status, "approval_pending", "UAT 付款申请创建状态");

  await postJsonExpectFailure(
    "/payments",
    {
      sourceType: "settlement",
      settlementId,
      contractVersionId,
      code: CODES.overLimitPayment,
      requestedAmountCents: "99999999"
    },
    tokens.contractStaff,
    "创建超额 UAT 付款申请"
  );

  for (const [role, token] of [
    ["comprehensiveDirector", tokens.comprehensiveDirector],
    ["projectManager", tokens.projectManager],
    ["financeDirector", tokens.financeDirector],
    ["chairman", tokens.chairman]
  ]) {
    const isFinalPaymentApproval = role === "chairman";
    const detail = await readJson(
      `/payments/${payment.id}`,
      token,
      `${ROLE_LABELS[role]} 读取 UAT 付款审批坐标`
    );
    assert(
      detail.reviewApprovalContext,
      `${ROLE_LABELS[role]} 未获得 UAT 付款审批坐标`
    );
    payment = await postJson(
      `/payments/${payment.id}/approval`,
      {
        decision: "approve",
        ...detail.reviewApprovalContext,
        ...(isFinalPaymentApproval ? { approvedAmountCents: "1000000" } : {}),
        comment: "P0-5B UAT 脱敏审批通过"
      },
      token,
      `${ROLE_LABELS[role]} 审批 UAT 付款`
    );
  }
  assertEqual(payment.status, "approved_pending_payment", "UAT 付款审批后状态");

  return payment;
}

async function recordPaymentExecutionFinanceAndArchive(payment, tokens) {
  const voucherFile = await uploadPrivateFile(`${CODES.payment}-voucher.pdf`, tokens.cashier);
  const paidAt = new Date().toISOString();
  const detail = await readJson(
    `/payments/${payment.id}`,
    tokens.cashier,
    "出纳读取 UAT 付款实付坐标"
  );
  assert(detail.executionContext, "出纳未获得 UAT 付款实付坐标");
  const execution = await postJson(
    `/payments/${payment.id}/executions`,
    {
      ...detail.executionContext,
      idempotencyKey: randomUUID(),
      amountCents: "1000000",
      paidAt,
      voucherFileId: voucherFile.id,
      confirmationPassword: PASSWORD
    },
    tokens.cashier,
    "登记 UAT 付款实付"
  );
  assert(execution.id, "付款实付登记未返回实付记录编号");
  await assertPaymentVoucherVisibleInArchiveLedger(
    voucherFile.id,
    payment.code,
    tokens.contractStaff
  );
  await downloadPrivateFileWithReason(
    voucherFile.id,
    tokens.cashier,
    "出纳付款凭证",
    PAYMENT_VOUCHER_DOWNLOAD_REASON
  );

  const financeRecord = await postJson(
    `/payments/${payment.id}/finance-records`,
    {
      amountCents: "1000000",
      occurredAt: new Date().toISOString(),
      confirmationPassword: PASSWORD
    },
    tokens.cashier,
    "登记 UAT 财务入账"
  );
  assert(financeRecord.id, "付款财务入账未返回入账记录编号");

  const archiveFile = await uploadPrivateFile(`${CODES.payment}-finance-archive.pdf`, tokens.cashier);
  const pdfArchive = await postJson(
    `/payments/${payment.id}/pdf-archive`,
    { fileId: archiveFile.id },
    tokens.cashier,
    "归档 UAT 付款 PDF"
  );
  assert(pdfArchive.pdfDocument?.id, "付款 PDF 归档未返回归档文件记录");
  const paymentPdfFileId = pdfArchive.archiveRecord?.fileId ?? pdfArchive.pdfDocument?.fileId;
  assert(paymentPdfFileId, "付款 PDF 归档未返回资料库文件编号");
  await assertPaymentPdfArchiveVisibleInArchiveLedger(
    paymentPdfFileId,
    payment.code,
    tokens.contractStaff
  );
  await downloadPrivateFileWithReason(
    paymentPdfFileId,
    tokens.cashier,
    "出纳付款PDF归档",
    PAYMENT_PDF_ARCHIVE_DOWNLOAD_REASON
  );

  const persisted = await prisma.paymentRequest.findUnique({ where: { id: payment.id } });
  assert(persisted, "数据库中未找到刚登记实付的付款申请");
  assertEqual(persisted.status, "paid", "付款实付后状态");
  assertEqual(persisted.paidAmountCents, 1000000n, "付款实付后累计实付金额");

  return {
    execution,
    financeRecord,
    pdfArchive,
    voucherFileId: voucherFile.id,
    paymentPdfFileId
  };
}

async function assertAuditActions(input) {
  const auditActions = await prisma.auditLog.findMany({
    where: {
      OR: [
        { businessType: "contract_takeover", businessId: input.takeoverId },
        { businessType: "contract", businessId: input.contractId },
        { businessType: "settlement", businessId: input.settlementId },
        { businessType: "payment_request", businessId: input.paymentId },
        { businessType: "file_object", businessId: input.evidenceFileId },
        { businessType: "file_object", businessId: input.settlementArchiveFileId },
        { businessType: "file_object", businessId: input.paymentVoucherFileId },
        { businessType: "file_object", businessId: input.paymentPdfFileId }
      ]
    },
    select: { action: true, actorUserId: true, businessId: true, metadata: true }
  });
  const actionSet = new Set(auditActions.map((row) => row.action));
  const requiredActions = [
    "contract_takeover.create",
    "contract_takeover.evidence.attach",
    "contract_takeover.submit_review",
    "contract_takeover.contract_side.confirm",
    "contract_takeover.finance_side.confirm",
    "contract_takeover.activate",
    "file.download.ticket",
    "file.download",
    "payment.contract_takeover.blocked",
    "payment.request.create",
    "settlement.approval.approve",
    "settlement.signed_document.generated",
    "settlement.archive.confirm",
    "payment.approval.approve",
    "payment.execution.record",
    "payment.finance.record",
    "payment.pdf_archive.record"
  ];
  const missingActions = requiredActions.filter((action) => !actionSet.has(action));

  assert(
    missingActions.length === 0,
    `关键审计日志缺失：${missingActions.join(", ")}`
  );
  const anonymousAudit = auditActions.find((row) => !row.actorUserId);
  assert(
    !anonymousAudit,
    `关键审计日志缺少操作人：${anonymousAudit?.action ?? "unknown"}`
  );
  const takeoverCreateAudit = auditActions.find(
    (row) => row.action === "contract_takeover.create"
  );
  assert(takeoverCreateAudit, "关键审计日志缺少历史接管创建记录");
  const takeoverCreateMetadata =
    takeoverCreateAudit.metadata &&
    typeof takeoverCreateAudit.metadata === "object"
      ? takeoverCreateAudit.metadata
      : {};
  assertEqual(
    takeoverCreateMetadata.takeoverLevel,
    "A",
    "历史接管创建审计确认等级"
  );
  assertEqual(
    takeoverCreateMetadata.suggestedTakeoverLevel,
    EXPECTED_TAKEOVER_SUGGESTED_LEVEL,
    "历史接管创建审计系统建议等级"
  );
  assertEqual(
    takeoverCreateMetadata.takeoverLevelAdjustmentReason,
    TAKEOVER_LEVEL_ADJUSTMENT_REASON,
    "历史接管创建审计等级调整原因"
  );
  const financeDownloadReason = TAKEOVER_EVIDENCE_DOWNLOAD_REASON_BY_ROLE["财务总监"];
  const financeTicketAudit = auditActions.find(
    (row) =>
      row.action === "file.download.ticket" &&
      row.actorUserId === input.financeDirectorUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === financeDownloadReason
  );
  assert(financeTicketAudit, "关键审计日志缺少财务总监接管资料下载票据原因");
  const financeDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.financeDirectorUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === financeDownloadReason
  );
  assert(financeDownloadAudit, "关键审计日志缺少财务总监接管资料实际下载原因");
  const employeeDownloadAudit = auditActions.find(
    (row) =>
      row.actorUserId === input.employeeUserId &&
      (row.action === "file.download.ticket" || row.action === "file.download")
  );
  assert(!employeeDownloadAudit, "普通员工越权下载接管资料不应写入下载审计");
  const settlementArchiveTicketAudit = auditActions.find(
    (row) =>
      row.action === "file.download.ticket" &&
      row.actorUserId === input.contractStaffUserId &&
      row.businessId === input.settlementArchiveFileId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === SETTLEMENT_ARCHIVE_DOWNLOAD_REASON
  );
  assert(settlementArchiveTicketAudit, "关键审计日志缺少合同员结算归档件下载票据原因");
  const settlementArchiveDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.contractStaffUserId &&
      row.businessId === input.settlementArchiveFileId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === SETTLEMENT_ARCHIVE_DOWNLOAD_REASON
  );
  assert(settlementArchiveDownloadAudit, "关键审计日志缺少合同员结算归档件实际下载原因");
  const voucherTicketAudit = auditActions.find(
    (row) =>
      row.action === "file.download.ticket" &&
      row.actorUserId === input.cashierUserId &&
      row.businessId === input.paymentVoucherFileId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === PAYMENT_VOUCHER_DOWNLOAD_REASON
  );
  assert(voucherTicketAudit, "关键审计日志缺少出纳付款凭证下载票据原因");
  const voucherDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.cashierUserId &&
      row.businessId === input.paymentVoucherFileId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === PAYMENT_VOUCHER_DOWNLOAD_REASON
  );
  assert(voucherDownloadAudit, "关键审计日志缺少出纳付款凭证实际下载原因");
  const paymentPdfTicketAudit = auditActions.find(
    (row) =>
      row.action === "file.download.ticket" &&
      row.actorUserId === input.cashierUserId &&
      row.businessId === input.paymentPdfFileId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === PAYMENT_PDF_ARCHIVE_DOWNLOAD_REASON
  );
  assert(paymentPdfTicketAudit, "关键审计日志缺少出纳付款PDF归档下载票据原因");
  const paymentPdfDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.cashierUserId &&
      row.businessId === input.paymentPdfFileId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.downloadReason === PAYMENT_PDF_ARCHIVE_DOWNLOAD_REASON
  );
  assert(paymentPdfDownloadAudit, "关键审计日志缺少出纳付款PDF归档实际下载原因");
}

function userFacingErrorMessage(error) {
  if (error == null) {
    return `验证器抛出了${String(error)}，而不是 Error 实例`;
  }
  const rawMessage = error?.message;
  const errorStack = error?.stack;
  if (!rawMessage && (error?.name || error?.code || error?.meta)) {
    return [
      error.name || "PrismaError",
      error.code ? `code=${error.code}` : "",
      error.meta ? `meta=${JSON.stringify(error.meta)}` : "",
      errorStack ? `stack=${errorStack}` : ""
    ].filter(Boolean).join(" ");
  }
  const raw = String(
    rawMessage || errorStack || error?.name || error || "未知错误"
  );

  if (error?.code === "P1001" || raw.includes("Can't reach database server")) {
    return "无法连接本地 PostgreSQL（默认 localhost:5432）。请先启动 services/api/docker-compose.yml 中的 postgres，完成 migrate/seed 后重试。";
  }

  if (raw.includes("fetch failed") || raw.includes("ECONNREFUSED")) {
    return `无法访问 API 服务（${baseUrl}）。请先启动 @jiangkong/api 服务后重试。`;
  }

  if (raw.trim()) return raw.split("\n")[0];
  return `验证器抛出了空错误对象（${error?.name || Object.prototype.toString.call(error)}，code=${error?.code || "-"}，meta=${JSON.stringify(error?.meta || {})}）`;
}

async function main() {
  assertLocalRuntimeGuard();
  await assertSeedDataReady();
  await assertApiHealthReady();
  if (!IS_ISOLATED_WRITE_UAT) {
    console.log("P0-5B UAT 默认只读检查通过：本地安全边界、seed 数据和 API health 已确认；未登录、未确认或激活接管、未写入业务数据。");
    return;
  }

  const governanceEvidence = loadGovernanceEvidenceManifest();
  assertGovernanceEvidenceManifest(governanceEvidence);

  const tokens = await loginAll();
  const contractStaffUserId = await userIdByPhone("contractStaff");
  const cashierUserId = await userIdByPhone("cashier");
  const financeDirectorUserId = await userIdByPhone("financeDirector");
  const employeeUserId = await userIdByPhone("employee");
  console.log(`开始 P0-5B 真实试运行 UAT 验证，编号 ${RUN_ID}`);

  const initialStaffSummary = await loadWorkbenchSummary("合同员", tokens.contractStaff);
  assert(
    initialStaffSummary.cards.length > 0,
    "合同员工作台未返回任何卡片，无法验证首页核心入口结构"
  );

  const takeover = await createHistoricalTakeover(tokens.contractStaff);
  let takeoverRecord = await loadTakeoverRecord(takeover.id);
  await ensureProgressPaymentStage(takeoverRecord.paymentTermsVersionId);
  const evidenceFileId = await attachAndDownloadTakeoverEvidence(
    takeover.id,
    tokens.contractStaff
  );
  await assertTakeoverEvidenceVisibleInArchiveLedger(evidenceFileId, tokens.contractStaff);
  await assertTakeoverEvidenceDownloadReasonRequired(evidenceFileId, tokens.contractStaff);
  await downloadTakeoverEvidenceFile(evidenceFileId, tokens.financeDirector, "财务总监");
  await assertTakeoverEvidenceDownloadDenied(evidenceFileId, tokens.employee, "普通员工");

  const staffAfterDraft = await loadWorkbenchSummary("合同员", tokens.contractStaff);
  assertCardCountAtLeast(staffAfterDraft, "contract_takeover_todo", 1, "创建历史接管后");

  let submitted = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/review-submission`,
    {},
    tokens.contractStaff,
    "提交历史接管复核"
  );
  assertEqual(submitted.takeoverStatus, "pending_review", "历史接管提交复核状态");

  const directorSummary = await loadWorkbenchSummary("合同部主管", tokens.contractDirector);
  assertCardCountAtLeast(directorSummary, "contract_takeover_review", 1, "提交复核后");

  await withTemporaryEffectiveVersionForBlockCheck(takeoverRecord, async () => {
    const pendingOption = await findPaymentCreateOption(CODES.contract, tokens.contractStaff);
    assertEqual(pendingOption.canCreatePayment, false, "未确认接管付款候选状态");
    assert(
      String(pendingOption.paymentUnavailableReason ?? "").includes("接管状态"),
      `未确认接管付款候选拦截原因不明确：${pendingOption.paymentUnavailableReason}`
    );
    const staffBlockedSummary = await loadWorkbenchSummary("合同员", tokens.contractStaff);
    assertCardCountAtLeast(staffBlockedSummary, "payment_blocked", 1, "未确认接管付款阻断");
    await verifyPaymentBlockedBeforeConfirmation(takeoverRecord.contractVersionId, tokens.contractStaff);
  });

  await confirmHistoricalTaxFacts(takeover.id, tokens);
  await saveAndConfirmDualDepartmentTakeover(takeover, tokens);
  takeoverRecord = await loadTakeoverRecord(takeover.id);
  assertEqual(takeoverRecord.takeoverStatus, "confirmed", "历史接管激活状态");
  assert(takeoverRecord.historicalBalanceConfirmedAt, "数据库历史余额确认时间为空");
  const initialSettlement = await assertHistoricalInitialSettlement(takeoverRecord);
  await assertTakeoverVerification(takeover.id, tokens.contractStaff, {
    label: "确认接管后的核验摘要状态",
    statusLabel: "待核验"
  });

  const confirmedOption = await findPaymentCreateOption(CODES.contract, tokens.contractStaff);
  assertEqual(confirmedOption.canCreatePayment, true, "确认接管后付款候选状态");
  assertEqual(
    confirmedOption.contractVersionId,
    takeoverRecord.contractVersionId,
    "付款候选合同版本"
  );

  const settlement = await createAndConfirmSettlement(takeoverRecord.contractVersionId, tokens);
  await assertDuplicateSettlementPeriodBlocked(
    takeoverRecord.contractVersionId,
    settlement.uatTemplateVersionId,
    tokens.contractStaff
  );
  const [effectiveInitialSettlement, effectiveCurrentSettlement] = await Promise.all([
    prisma.settlement.findUnique({ where: { id: initialSettlement.id } }),
    prisma.settlement.findUnique({ where: { id: settlement.id } })
  ]);
  assertEqual(effectiveInitialSettlement?.status, "effective", "历史期初结算付款前状态");
  assertEqual(effectiveCurrentSettlement?.status, "effective", "本期结算付款前状态");
  assertEqual(
    effectiveInitialSettlement?.paidAmountCents?.toString(),
    HISTORICAL_BALANCE.historicalPaidCents,
    "历史期初结算已付金额"
  );
  assert(
    BigInt(effectiveCurrentSettlement?.payableAmountCents ?? 0n) >= 1000000n,
    "本期生效结算可付金额不足以发起 UAT 付款"
  );

  const payment = await createAndApprovePayment(
    takeoverRecord.contractVersionId,
    settlement.id,
    tokens
  );
  await assertTakeoverVerification(takeover.id, tokens.contractStaff, {
    label: "新结算和付款后的核验摘要状态",
    statusLabel: "核验中",
    minimumCounts: {
      newSettlementCount: 1,
      paymentRequestCount: 1
    }
  });
  const cashierSummary = await loadWorkbenchSummary("出纳/财务", tokens.cashier);
  assertCardCountAtLeast(cashierSummary, "approved_pending_payment", 1, "付款审批通过后");

  const paymentClosure = await recordPaymentExecutionFinanceAndArchive(payment, tokens);
  await assertTakeoverVerification(takeover.id, tokens.contractStaff, {
    label: "实付入账后的核验摘要状态",
    statusLabel: "已形成闭环",
    minimumCounts: {
      newSettlementCount: 1,
      paymentRequestCount: 1,
      paymentExecutionCount: 1,
      financeRecordCount: 1
    }
  });

  await assertAuditActions({
    takeoverId: takeover.id,
    contractId: takeoverRecord.contractId,
    settlementId: settlement.id,
    paymentId: payment.id,
    evidenceFileId,
    settlementArchiveFileId: settlement.archiveFileId,
    paymentVoucherFileId: paymentClosure.voucherFileId,
    paymentPdfFileId: paymentClosure.paymentPdfFileId,
    contractStaffUserId,
    cashierUserId,
    financeDirectorUserId,
    employeeUserId
  });

  console.log(
    `通过 P0-5B UAT：${CODES.contract} -> ${CODES.settlement} -> ${CODES.payment}`
  );
  console.log(
    `通过合同结算治理 UAT 矩阵：${GOVERNANCE_UAT_CASES.length} 个必选场景，候选 ${governanceEvidence.candidateSha}`
  );
  console.log("说明：脚本使用唯一 UAT 编号写入脱敏 seed/test 数据，不连接生产库、不访问真实 COS。");
}

main()
  .catch((error) => {
    console.error(`P0-5B 真实试运行 UAT 验证失败：${userFacingErrorMessage(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
