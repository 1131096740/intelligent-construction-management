import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const versionId = "version-governed-1";
const governedViewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

test("受治理合同仅按后端动作展示签署归档，并以敏感确认提交最终版", async ({ page }) => {
  let detail = governedDetail();
  await installLoginRoutes(page, ["contract_staff"]);
  await page.route(`**/api/contracts/${versionId}/change-eligibility`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ eligible: false, reason: "当前版本尚未生效", currentEffective: null, activeChange: null })
  }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/api/contracts/HT-GOVERNED-001", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail)
  }));

  let uploadedFinalBody: Record<string, unknown> | null = null;
  let privateFinalUploadRequests = 0;
  let finalAssociationAttempts = 0;
  let approvalOriginalDownloadBody: Record<string, unknown> | null = null;
  await page.route("**/api/files", (route) => {
    privateFinalUploadRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "private-final-file", originalName: "双方最终版.pdf" })
    });
  });
  await page.route("**/api/files/approval-file-1/download-ticket", (route) => {
    approvalOriginalDownloadBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ downloadUrl: "/files/approval-file-1/download?ticket=short-lived" })
    });
  });
  await page.route(`**/api/contracts/${versionId}/formal-files/final`, (route) => {
    finalAssociationAttempts += 1;
    uploadedFinalBody = route.request().postDataJSON() as Record<string, unknown>;
    if (finalAssociationAttempts === 1) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "关联暂时失败" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "formal-final-1" }) });
  });
  let approveSealBody: Record<string, unknown> | null = null;
  let completeSealBody: Record<string, unknown> | null = null;
  let returnFinalBody: Record<string, unknown> | null = null;
  let confirmFinalBody: Record<string, unknown> | null = null;
  await page.route(`**/api/contracts/${versionId}/seal/approve`, (route) => {
    approveSealBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "in_seal" }) });
  });
  await page.route(`**/api/contracts/${versionId}/seal/complete`, (route) => {
    completeSealBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "seal_approved_pending_archive" }) });
  });
  await page.route(`**/api/contracts/${versionId}/formal-files/final/return`, (route) => {
    returnFinalBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "seal_approved_pending_archive" }) });
  });
  await page.route(`**/api/contracts/${versionId}/formal-files/final/confirmation`, (route) => {
    confirmFinalBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "effective" }) });
  });

  await login(page);
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "签署与归档证据" })).toBeVisible();
  await expect(page.getByText("审批前乙方签章版", { exact: true })).toBeVisible();
  await expect(page.getByText("双方最终签署版", { exact: true })).toBeVisible();
  await expect(page.getByText("合同审批单", { exact: true })).toBeVisible();
  const finalUploadGroup = page.locator(".action-group").filter({ hasText: "上传双方最终版" });
  await expect(finalUploadGroup.getByRole("button", { name: "上传双方最终版" })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认归档" })).toHaveCount(0);
  await page.getByText("审批前乙方签章版", { exact: true }).locator("xpath=ancestor::article")
    .getByRole("button", { name: "下载文件" }).click();
  await expect(page.getByText("确认下载合同正式文件？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("说明本次操作原因").fill("归档核验");
  await page.getByPlaceholder("用于确认当前操作者身份").fill("Governance@2026");
  await page.getByRole("button", { name: "确认下载" }).click();
  await expect.poll(() => approvalOriginalDownloadBody).toEqual({
    confirmationPassword: "Governance@2026",
    downloadReason: "归档核验"
  });

  for (const viewport of governedViewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
    }));
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
  }

  await finalUploadGroup.locator('input[type="file"]').setInputFiles({
    name: "双方最终版.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 governed-final")
  });
  const finalDeclarationCheckboxes = finalUploadGroup.locator(".t-checkbox");
  await expect(finalDeclarationCheckboxes).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await finalDeclarationCheckboxes.nth(index).click();
  }
  await finalUploadGroup.getByRole("button", { name: "上传双方最终版" }).click();
  await expect(page.getByText("确认上传双方最终版？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认上传" }).click();
  await expect.poll(() => uploadedFinalBody).toEqual({
    fileId: "private-final-file",
    sourceRevision: 7,
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  });
  await expect(page.getByText("操作未完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认上传" }).click();
  await expect.poll(() => finalAssociationAttempts).toBe(2);
  await expect.poll(() => privateFinalUploadRequests).toBe(1);

  detail = governedDetail({
    status: "待同意用章",
    actions: [action("approve_seal", "同意用章", "primary", true)],
    primaryAction: "approve_seal",
    formalFiles: [],
    sealTask: sealTask()
  });
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  const sealActionGroup = page.locator(".action-group").filter({ hasText: "用章与归档文件生成" });
  await sealActionGroup.getByRole("button", { name: "同意用章" }).click();
  await expect(page.getByText("确认同意用章？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("用于确认当前操作者身份").fill("Governance@2026");
  await page.getByRole("button", { name: "确认同意用章" }).click();
  await expect.poll(() => approveSealBody).toEqual({ confirmationPassword: "Governance@2026" });

  detail = governedDetail({
    status: "我方签署盖章中",
    actions: [action("complete_seal", "确认已完成我方签署与盖章", "primary", true)],
    primaryAction: "complete_seal",
    formalFiles: [],
    sealTask: sealTask()
  });
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  const completionCheckboxes = sealActionGroup.locator(".t-checkbox");
  await expect(completionCheckboxes).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await completionCheckboxes.nth(index).click();
  await sealActionGroup.getByRole("button", { name: "确认已完成我方签署与盖章" }).click();
  await expect(page.getByText("确认已完成我方签署与盖章？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认已完成", exact: true }).click();
  await expect.poll(() => completeSealBody).toEqual(completionDeclaration());

  detail = governedDetail({
    status: "待最终版归档确认",
    actions: [
      action("return_final_contract", "退回补正", "danger", true),
      action("confirm_final_contract", "确认归档", "primary", true)
    ],
    primaryAction: "confirm_final_contract",
    formalFiles: [approvalOriginal(), mutuallySignedFinal()],
    sealTask: sealTask()
  });
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  const finalReviewGroup = page.locator(".action-group").filter({ hasText: "双方最终版复核" });
  await finalReviewGroup.getByRole("button", { name: "退回补正" }).click();
  await expect(page.getByText("确认退回双方最终版补正？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("说明本次操作原因").fill("扫描件缺少附件页");
  await page.getByRole("button", { name: "确认退回补正" }).click();
  await expect.poll(() => returnFinalBody).toEqual({
    formalFileId: "final-file-1",
    reason: "扫描件缺少附件页"
  });

  const confirmationCheckboxes = finalReviewGroup.locator(".t-checkbox");
  await expect(confirmationCheckboxes).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await confirmationCheckboxes.nth(index).click();
  await finalReviewGroup.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByText("确认双方最终版并归档？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("用于确认当前操作者身份").fill("Governance@2026");
  await page.getByRole("button", { name: "确认归档" }).last().click();
  await expect.poll(() => confirmFinalBody).toEqual({
    formalFileId: "final-file-1",
    confirmationPassword: "Governance@2026",
    ...finalDeclaration()
  });
});

test("合同经办人兼合同部主管仅按服务端自审能力完成合同部节点", async ({ page }) => {
  const selfReviewAction = {
    ...action("review_approval", "处理合同审批", "primary", true),
    requiresSelfReviewConfirmation: true
  };
  const detail = {
    ...governedDetail({
      status: "合同审批中",
      actions: [selfReviewAction],
      primaryAction: "review_approval"
    }),
    availableActionKeys: ["review_approval"],
    lifecycleUpdatedAt: "2026-08-08T00:00:00.000Z",
    reviewApprovalContext: {
      expectedContractUpdatedAt: "2026-08-08T00:00:00.000Z",
      expectedApprovalInstanceId: "approval-self-review-1",
      expectedNodeIndex: 0,
      expectedApprovalUpdatedAt: "2026-08-08T00:00:01.000Z"
    }
  };
  let reviewBody: Record<string, unknown> | null = null;

  await installLoginRoutes(page, ["contract_staff", "contract_director"]);
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route(`**/api/contracts/${versionId}/change-eligibility`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ eligible: false, reason: "当前版本尚未生效", currentEffective: null, activeChange: null })
  }));
  await page.route("**/api/contracts/HT-GOVERNED-001", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail)
  }));
  await page.route(`**/api/contracts/${versionId}/approval`, (route) => {
    reviewBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "in_approval" }) });
  });

  await login(page);
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "自审原因" })).toBeVisible();
  await page.getByRole("textbox", { name: "自审原因" })
    .fill("项目合同经办与合同部主管由本人兼任");
  await page.getByRole("button", { name: "通过" }).click();
  await expect(page.getByText("确认通过合同审批？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("用于确认当前操作者身份").fill("Governance@2026");
  await page.getByRole("button", { name: "确认通过" }).click();
  await expect.poll(() => reviewBody).toEqual({
    decision: "approve",
    selfReviewReason: "项目合同经办与合同部主管由本人兼任",
    confirmationPassword: "Governance@2026",
    expectedContractUpdatedAt: "2026-08-08T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-self-review-1",
    expectedNodeIndex: 0,
    expectedApprovalUpdatedAt: "2026-08-08T00:00:01.000Z"
  });
});

test("当前合同部主管经办人仅在服务端授权后确认自己的双方最终版", async ({ page }) => {
  const detail = {
    ...governedDetail({
      status: "待最终版归档确认",
      actions: [action("confirm_final_contract", "确认归档", "primary", true)],
      primaryAction: "confirm_final_contract",
      formalFiles: [
        approvalOriginal(),
        { ...mutuallySignedFinal(), uploadedByUserId: "governance-user-1" }
      ]
    }),
    availableActionKeys: ["confirm_final_contract"]
  };
  let confirmationBody: Record<string, unknown> | null = null;

  await installLoginRoutes(page, ["contract_director"]);
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route(`**/api/contracts/${versionId}/change-eligibility`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ eligible: false, reason: "当前版本尚未生效", currentEffective: null, activeChange: null })
  }));
  await page.route("**/api/contracts/HT-GOVERNED-001", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail)
  }));
  await page.route(`**/api/contracts/${versionId}/formal-files/final/confirmation`, (route) => {
    confirmationBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "effective" }) });
  });

  await login(page);
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  const finalReviewGroup = page.locator(".action-group").filter({ hasText: "双方最终版复核" });
  await expect(finalReviewGroup.getByRole("button", { name: "确认归档" })).toBeVisible();
  const confirmations = finalReviewGroup.locator(".t-checkbox");
  await expect(confirmations).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await confirmations.nth(index).click();
  await finalReviewGroup.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByText("确认双方最终版并归档？", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("用于确认当前操作者身份")).toHaveCount(0);
  await page.getByRole("button", { name: "确认归档" }).last().click();
  await expect.poll(() => confirmationBody).toEqual({
    formalFileId: "final-file-1",
    ...finalDeclaration()
  });
});

for (const roleKey of ["finance_staff", "comprehensive_director"]) {
test(`${roleKey} 只读查看合同不请求变更资格且不暴露写入动作`, async ({ page }) => {
  let changeEligibilityRequests = 0;
  await installLoginRoutes(page, [roleKey]);
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route(`**/api/contracts/${versionId}/change-eligibility`, (route) => {
    changeEligibilityRequests += 1;
    return route.fulfill({ status: 500 });
  });
  await page.route("**/api/contracts/HT-FINANCE-READONLY", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...governedDetail(), id: "HT-FINANCE-READONLY", availableActions: [
      action("download_approval_form", "下载审批单", "normal", true)
    ], primaryAction: "download_approval_form" })
  }));

  await login(page);
  await page.goto("/contracts/HT-FINANCE-READONLY");
  await expect(page.getByRole("button", { name: "发起变更/补充协议" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传双方最终版" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认归档" })).toHaveCount(0);
  await expect.poll(() => changeEligibilityRequests).toBe(0);
});
}

test("上传返回时切换合同仍保留原合同暂存文件且不关联新合同", async ({ page }) => {
  await installLoginRoutes(page, ["contract_staff"]);
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/contracts/*/change-eligibility", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ eligible: false, reason: "当前版本尚未生效", currentEffective: null, activeChange: null })
  }));
  await page.route("**/api/contracts/HT-GOVERNED-001", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(governedDetail()) }));
  await page.route("**/api/contracts/HT-GOVERNED-B", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...governedDetail(), id: "HT-GOVERNED-B", contractVersionId: "version-governed-b", title: "HT-GOVERNED-B · 合同 B" })
  }));
  let heldUpload: import("@playwright/test").Route | null = null;
  let versionBAssociations = 0;
  await page.route("**/api/files", (route) => { heldUpload = route; });
  await page.route("**/api/contracts/version-governed-b/formal-files/final", (route) => {
    versionBAssociations += 1;
    return route.fulfill({ status: 500 });
  });

  await login(page);
  await page.goto("/contracts/HT-GOVERNED-001");
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  const uploadGroup = page.locator(".action-group").filter({ hasText: "上传双方最终版" });
  await uploadGroup.locator('input[type="file"]').setInputFiles({ name: "A.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-A") });
  for (let index = 0; index < 6; index += 1) await uploadGroup.locator(".t-checkbox").nth(index).click();
  await uploadGroup.getByRole("button", { name: "上传双方最终版" }).click();
  await page.getByRole("button", { name: "确认上传" }).click();
  await expect.poll(() => heldUpload !== null).toBe(true);
  await page.goto("/contracts/HT-GOVERNED-B");
  const upload = heldUpload as import("@playwright/test").Route | null;
  if (!upload) throw new Error("未收到私有文件上传请求");
  await upload.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "file-staged-a" }) });
  await expect.poll(() => versionBAssociations).toBe(0);
  await expect(page.getByRole("button", { name: "上传双方最终版" })).toHaveCount(1);
});

async function installLoginRoutes(page: Page, roleKeys: string[]) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "governance-user-1", name: "合同治理验收用户", phone: "13900000000",
        mustChangePassword: false, roleKeys, globalRoleKeys: roleKeys
      },
      tokens: { accessToken: "governance-access", refreshToken: "governance-refresh", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-17T00:00:00.000Z", visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    })
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Governance@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
}

function governedDetail(options: {
  status?: string;
  actions?: ReturnType<typeof action>[];
  primaryAction?: string | null;
  formalFiles?: ReturnType<typeof approvalOriginal>[];
  sealTask?: ReturnType<typeof sealTask>;
} = {}) {
  return {
    id: "HT-GOVERNED-001",
    contractVersionId: versionId,
    title: "HT-GOVERNED-001 · 受治理材料采购合同",
    meta: [{ label: "当前状态", value: options.status ?? "待上传双方最终版", tone: "warning" }],
    baseInfo: [{ label: "合同金额", value: "¥100,000.00" }],
    effectivenessSteps: [],
    paymentTermStages: [],
    settlementBlockMessage: "合同尚未生效，暂不可发起结算。",
    settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" },
    archiveFiles: [],
    formalFiles: options.formalFiles ?? [approvalOriginal()],
    sealTask: options.sealTask ?? sealTask(),
    approvalTimeline: [],
    availableActions: options.actions ?? [
      action("upload_final_contract", "上传双方最终版", "primary", true),
      action("download_approval_form", "下载审批单", "normal", true)
    ],
    primaryAction: options.primaryAction ?? "upload_final_contract",
    disabledReasons: [],
    chainLinks: [],
    changeVersions: []
  };
}

function approvalOriginal() {
  return {
    formalFileId: "approval-original-1", purpose: "approval_original", fileId: "approval-file-1",
    fileName: "审批前乙方签章版.pdf", pageCount: 12, sourceRevision: 7, status: "active",
    uploadedByUserId: "governance-user-1", confirmedByUserId: null, confirmedAt: null
  };
}

function mutuallySignedFinal() {
  return {
    formalFileId: "final-file-1", purpose: "mutually_signed_final", fileId: "final-file-object-1",
    fileName: "双方最终版.pdf", pageCount: 12, sourceRevision: 7, status: "active",
    uploadedByUserId: "handler-user-1", confirmedByUserId: null, confirmedAt: null
  };
}

function sealTask() {
  return {
    id: "seal-task-1", status: "completed", handlerUserId: "governance-user-1",
    approvedByUserId: "director-1", approvedAt: "2026-07-17T00:00:00.000Z",
    completedByUserId: "governance-user-1", completedAt: "2026-07-17T01:00:00.000Z"
  };
}

function completionDeclaration() {
  return {
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true
  };
}

function finalDeclaration() {
  return {
    ...completionDeclaration(),
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  };
}

function action(key: string, label: string, kind: "primary" | "normal" | "danger", enabled: boolean) {
  return { key, label, kind, enabled, disabledReason: null };
}
