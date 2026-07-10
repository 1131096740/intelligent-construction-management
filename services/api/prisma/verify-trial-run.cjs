const fs = require("node:fs");
const path = require("node:path");
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
const PASSWORD = process.env.SEED_PASSWORD || "Jgzg@2026";
const PROJECT_ID = coreFlowSeedData.project.id;
const PHONES = {
  contractStaff: coreFlowSeedData.users.contractStaff.phone,
  cashier: coreFlowSeedData.users.cashier.phone,
  chairman: "13800001001",
  projectManager: "13800001003",
  contractDirector: "13800001004",
  budgetDirector: "13800001005",
  financeDirector: "13800001007",
  materialStaff: "13800001009",
  materialDirector: "13800001008",
  employee: "13800001014"
};

const ROLE_LABELS = {
  contractStaff: "合同员",
  cashier: "出纳/财务",
  chairman: "董事长",
  projectManager: "项目经理",
  contractDirector: "合同部主管",
  budgetDirector: "预算部主管",
  financeDirector: "财务总监",
  materialStaff: "物资员",
  materialDirector: "物资主管",
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
const IS_PREFLIGHT = process.argv.includes("--preflight");

const HISTORICAL_BALANCE = {
  historicalSettledCents: 1200000,
  historicalApprovalPendingPaymentCents: 100000,
  historicalApprovedPendingPaymentCents: 200000,
  historicalPaidCents: 1000000,
  historicalProxyPaidCents: 300000,
  historicalAdvancePaidCents: 0,
  historicalAdvanceDeductedCents: 0,
  historicalRetentionWithheldCents: 0,
  historicalRetentionReleasedCents: 0,
  otherConfirmedOccupancyCents: 100000
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

async function login(role, phone) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password: PASSWORD })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${ROLE_LABELS[role] ?? role} 登录失败：HTTP ${response.status} ${body}`);
  }

  const data = await response.json();
  if (!data.tokens?.accessToken) {
    throw new Error(`${ROLE_LABELS[role] ?? role} 登录失败：未返回 accessToken`);
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

async function uploadPrivateFile(fileName, token) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([`P0-5B 真实试运行 UAT 脱敏验证文件：${fileName}\n`], {
      type: "application/pdf"
    }),
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
      amountCents: 10000000,
      signedAt: "2026-05-20T00:00:00.000Z",
      takeoverLevel: "A",
      lifecycleStatus: "in_progress",
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
    HISTORICAL_BALANCE.historicalSettledCents,
    "历史期初结算金额"
  );
  assertEqual(
    settlement.payableAmountCents,
    HISTORICAL_BALANCE.historicalSettledCents,
    "历史期初结算可付金额"
  );
  assertEqual(
    settlement.paidAmountCents,
    HISTORICAL_BALANCE.historicalPaidCents,
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
  assertEqual(ticket.fileId, fileId, `${label}下载票据文件`);
  assert(
    typeof ticket.downloadUrl === "string" && ticket.downloadUrl.includes("downloadReason="),
    `${label}下载票据未包含下载原因`
  );

  const response = await fetch(`${baseUrl}${ticket.downloadUrl}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label}短时效链接下载失败：HTTP ${response.status} ${body}`);
  }
  const content = await response.arrayBuffer();
  assert(content.byteLength > 0, `${label}短时效链接下载内容为空`);
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

async function attachAndDownloadTakeoverEvidence(takeoverId, token) {
  for (const purpose of TAKEOVER_EVIDENCE_PURPOSES) {
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
  for (const purpose of TAKEOVER_EVIDENCE_PURPOSES) {
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
  assert(row, "资料库台账未展示刚确认的结算归档件");
  assertEqual(row.documentType, "结算归档件", "资料库结算归档资料类型");
  assert(
    String(row.businessRef ?? "").includes(settlementCode) &&
      String(row.businessRef ?? "").includes(periodLabel),
    `资料库结算归档关联业务不正确：${row.businessRef}`
  );
  assertEqual(row.archiveStatus, "已确认", "资料库结算归档状态");
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
  await prisma.paymentTermsStage.create({
    data: {
      paymentTermsVersionId,
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
    }
  });
}

async function withTemporaryEffectiveVersionForBlockCheck(takeoverRecord, callback) {
  const [version, terms] = await Promise.all([
    prisma.contractVersion.findUnique({
      where: { id: takeoverRecord.contractVersionId },
      select: { status: true, effectiveAt: true }
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
      data: { status: "effective", effectiveAt: now }
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
          effectiveAt: version.effectiveAt
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
  const failed = await postJsonExpectFailure(
    "/payments",
    {
      sourceType: "contract_due",
      contractVersionId,
      code: CODES.blockedPayment,
      requestedAmountCents: 100000
    },
    token,
    "未确认接管时创建付款申请"
  );

  assert(
    failed.status >= 400,
    `未确认接管付款拦截 HTTP 状态异常：${failed.status}`
  );
}

async function createAndConfirmSettlement(contractVersionId, tokens) {
  let settlement = await postJson(
    "/settlements",
    {
      contractVersionId,
      code: CODES.settlement,
      periodLabel: "2026-07",
      amountCents: 5000000
    },
    tokens.contractStaff,
    "创建 UAT 结算"
  );
  assertEqual(settlement.status, "approval_pending", "UAT 结算创建状态");
  assertEqual(settlement.payableAmountCents, 4000000, "UAT 结算可付金额");

  for (const [role, token] of [
    ["materialStaff", tokens.materialStaff],
    ["materialDirector", tokens.materialDirector],
    ["contractDirector", tokens.contractDirector],
    ["budgetDirector", tokens.budgetDirector],
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
  assertEqual(settlement.status, "approved_pending_archive", "UAT 结算审批后状态");

  const archiveFile = await uploadPrivateFile(`${CODES.settlement}-archive.pdf`, tokens.contractStaff);
  const archive = await postJson(
    `/settlements/${settlement.id}/archive-files`,
    { fileId: archiveFile.id },
    tokens.contractStaff,
    "上传 UAT 结算归档文件"
  );
  settlement = await postJson(
    `/settlements/${settlement.id}/archive-confirmation`,
    { archiveFileId: archive.id, confirmationPassword: PASSWORD },
    tokens.contractDirector,
    "确认 UAT 结算归档"
  );
  assertEqual(settlement.status, "effective", "UAT 结算归档确认状态");
  await assertSettlementArchiveVisibleInArchiveLedger(
    archiveFile.id,
    settlement.code,
    settlement.periodLabel,
    tokens.contractStaff
  );
  await downloadPrivateFileWithReason(
    archiveFile.id,
    tokens.contractStaff,
    "合同员结算归档件",
    SETTLEMENT_ARCHIVE_DOWNLOAD_REASON
  );

  return { ...settlement, archiveFileId: archiveFile.id };
}

async function assertDuplicateSettlementPeriodBlocked(contractVersionId, token) {
  for (const [suffix, periodLabel] of [
    ["DUP", "2026-07"],
    ["DUP-SPACES", " 2026-07 "]
  ]) {
    const failed = await postJsonExpectFailure(
      "/settlements",
      {
        contractVersionId,
        code: `${CODES.settlement}-${suffix}`,
        periodLabel,
        amountCents: 1000000
      },
      token,
      `创建同期间重复 UAT 结算 ${periodLabel}`
    );
    assert(
      failed.status >= 400,
      `同期间重复结算拦截 HTTP 状态异常：${failed.status}`
    );
    assert(
      String(failed.body ?? "").includes("已存在结算单"),
      `同期间重复结算未返回中文业务提示：${failed.body}`
    );
  }
}

function assertHistoricalBalanceInPreview(preview) {
  assert(preview.historicalBalance, "付款预览未返回 historicalBalance");
  assert(Array.isArray(preview.capacityExplanation), "付款预览未返回容量说明");
  assertEqual(
    preview.historicalBalance.paidCents,
    HISTORICAL_BALANCE.historicalPaidCents,
    "付款预览历史已付金额"
  );
  assertEqual(
    preview.historicalBalance.approvalPendingPaymentCents,
    HISTORICAL_BALANCE.historicalApprovalPendingPaymentCents,
    "付款预览历史审批中金额"
  );
  assertEqual(
    preview.historicalBalance.approvedPendingPaymentCents,
    HISTORICAL_BALANCE.historicalApprovedPendingPaymentCents,
    "付款预览历史已批待付金额"
  );
  assertEqual(
    preview.historicalBalance.proxyPaidCents,
    HISTORICAL_BALANCE.historicalProxyPaidCents,
    "付款预览历史代付金额"
  );
  assertEqual(
    preview.capacity.historicalPaidCents,
    0,
    "付款预览容量历史已付已由期初结算承载"
  );
  assert(
    preview.capacity.actualPaidCents >= HISTORICAL_BALANCE.historicalPaidCents,
    `付款预览实际已付未包含历史期初已付：${preview.capacity.actualPaidCents}`
  );
  assertEqual(
    preview.capacity.historicalApprovalPendingCents,
    HISTORICAL_BALANCE.historicalApprovalPendingPaymentCents,
    "付款预览容量历史审批中金额"
  );
  assertEqual(
    preview.capacity.historicalApprovedPendingCents,
    HISTORICAL_BALANCE.historicalApprovedPendingPaymentCents,
    "付款预览容量历史已批待付金额"
  );
  assert(
    preview.capacity.maxRequestableCents >= 1000000,
    `付款预览可申请金额不足以发起 UAT 付款：${preview.capacity.maxRequestableCents}`
  );
  assert(
    !preview.capacityExplanation.some((row) => row.note === "含历史接管已付款"),
    "付款预览容量说明重复展示历史接管已付款"
  );
}

async function createAndApprovePayment(contractVersionId, tokens) {
  let payment = await postJson(
    "/payments",
    {
      sourceType: "contract_due",
      contractVersionId,
      code: CODES.payment,
      requestedAmountCents: 1000000
    },
    tokens.contractStaff,
    "创建 UAT 付款申请"
  );
  assertEqual(payment.status, "approval_pending", "UAT 付款申请创建状态");

  await postJsonExpectFailure(
    "/payments",
    {
      sourceType: "contract_due",
      contractVersionId,
      code: CODES.overLimitPayment,
      requestedAmountCents: 99999999
    },
    tokens.contractStaff,
    "创建超额 UAT 付款申请"
  );

  for (const [role, token] of [
    ["projectManager", tokens.projectManager],
    ["contractDirector", tokens.contractDirector],
    ["financeDirector", tokens.financeDirector],
    ["chairman", tokens.chairman]
  ]) {
    const isFinalPaymentApproval = role === "chairman";
    payment = await postJson(
      `/payments/${payment.id}/approval`,
      {
        decision: "approve",
        ...(isFinalPaymentApproval ? { approvedAmountCents: 1000000 } : {}),
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
  const execution = await postJson(
    `/payments/${payment.id}/executions`,
    {
      amountCents: 1000000,
      paidAt: "2026-06-22T00:00:00.000Z",
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
      amountCents: 1000000,
      occurredAt: "2026-06-22T01:00:00.000Z",
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
  assertEqual(persisted.paidAmountCents, 1000000, "付款实付后累计实付金额");

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
        { businessType: "settlement", businessId: input.settlementId },
        { businessType: "payment_request", businessId: input.paymentId },
        { businessType: "file_object", businessId: input.evidenceFileId },
        { businessType: "file_object", businessId: input.settlementArchiveFileId },
        { businessType: "file_object", businessId: input.paymentVoucherFileId },
        { businessType: "file_object", businessId: input.paymentPdfFileId }
      ]
    },
    select: { action: true, actorUserId: true, metadata: true }
  });
  const actionSet = new Set(auditActions.map((row) => row.action));
  const requiredActions = [
    "contract_takeover.create",
    "contract_takeover.evidence.attach",
    "contract_takeover.submit_review",
    "contract_takeover.confirm",
    "file.download.ticket",
    "file.download",
    "payment.contract_takeover.blocked",
    "payment.request.create",
    "settlement.approval.approve",
    "settlement.archive.upload",
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
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.fileId === input.settlementArchiveFileId &&
      row.metadata.downloadReason === SETTLEMENT_ARCHIVE_DOWNLOAD_REASON
  );
  assert(settlementArchiveTicketAudit, "关键审计日志缺少合同员结算归档件下载票据原因");
  const settlementArchiveDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.contractStaffUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.fileId === input.settlementArchiveFileId &&
      row.metadata.downloadReason === SETTLEMENT_ARCHIVE_DOWNLOAD_REASON
  );
  assert(settlementArchiveDownloadAudit, "关键审计日志缺少合同员结算归档件实际下载原因");
  const voucherTicketAudit = auditActions.find(
    (row) =>
      row.action === "file.download.ticket" &&
      row.actorUserId === input.cashierUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.fileId === input.paymentVoucherFileId &&
      row.metadata.downloadReason === PAYMENT_VOUCHER_DOWNLOAD_REASON
  );
  assert(voucherTicketAudit, "关键审计日志缺少出纳付款凭证下载票据原因");
  const voucherDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.cashierUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.fileId === input.paymentVoucherFileId &&
      row.metadata.downloadReason === PAYMENT_VOUCHER_DOWNLOAD_REASON
  );
  assert(voucherDownloadAudit, "关键审计日志缺少出纳付款凭证实际下载原因");
  const paymentPdfTicketAudit = auditActions.find(
    (row) =>
      row.action === "file.download.ticket" &&
      row.actorUserId === input.cashierUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.fileId === input.paymentPdfFileId &&
      row.metadata.downloadReason === PAYMENT_PDF_ARCHIVE_DOWNLOAD_REASON
  );
  assert(paymentPdfTicketAudit, "关键审计日志缺少出纳付款PDF归档下载票据原因");
  const paymentPdfDownloadAudit = auditActions.find(
    (row) =>
      row.action === "file.download" &&
      row.actorUserId === input.cashierUserId &&
      row.metadata &&
      typeof row.metadata === "object" &&
      row.metadata.fileId === input.paymentPdfFileId &&
      row.metadata.downloadReason === PAYMENT_PDF_ARCHIVE_DOWNLOAD_REASON
  );
  assert(paymentPdfDownloadAudit, "关键审计日志缺少出纳付款PDF归档实际下载原因");
}

function userFacingErrorMessage(error) {
  const raw = String(error?.message ?? error ?? "未知错误");

  if (error?.code === "P1001" || raw.includes("Can't reach database server")) {
    return "无法连接本地 PostgreSQL（默认 localhost:5432）。请先启动 services/api/docker-compose.yml 中的 postgres，完成 migrate/seed 后重试。";
  }

  if (raw.includes("fetch failed") || raw.includes("ECONNREFUSED")) {
    return `无法访问 API 服务（${baseUrl}）。请先启动 @jiangkong/api 服务后重试。`;
  }

  return raw.split("\n")[0] || "未知错误";
}

async function main() {
  assertLocalRuntimeGuard();
  await assertSeedDataReady();
  await assertApiHealthReady();
  if (IS_PREFLIGHT) {
    console.log("P0-5B UAT 预检通过：本地安全边界、seed 数据和 API health 已确认；未写入业务数据。");
    return;
  }

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

  const confirmed = await postJson(
    `/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/confirmation`,
    { confirmationPassword: PASSWORD },
    tokens.contractDirector,
    "确认历史接管"
  );
  assertEqual(confirmed.takeoverStatus, "confirmed", "历史接管确认状态");
  assert(confirmed.historicalBalanceConfirmedAt, "历史接管确认后未写入历史余额确认时间");
  takeoverRecord = await loadTakeoverRecord(takeover.id);
  assert(takeoverRecord.historicalBalanceConfirmedAt, "数据库历史余额确认时间为空");
  await assertHistoricalInitialSettlement(takeoverRecord);
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
  await assertDuplicateSettlementPeriodBlocked(takeoverRecord.contractVersionId, tokens.contractStaff);
  const preview = await readJson(
    `/payments/contract-application?contractVersionId=${encodeURIComponent(
      takeoverRecord.contractVersionId
    )}`,
    tokens.contractStaff,
    "合同累计付款预览"
  );
  assertHistoricalBalanceInPreview(preview);
  assert(
    Array.isArray(preview.includedSettlements) &&
      preview.includedSettlements.some((row) => row.settlementId === settlement.id),
    "付款预览未包含刚生效的 UAT 结算"
  );

  const payment = await createAndApprovePayment(takeoverRecord.contractVersionId, tokens);
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
