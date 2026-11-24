import { expect, test, type Page } from "@playwright/test";
import { mockApprovalProgress } from "./helpers/approval-progress-mocks";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";
import { selectSignedContract, signedSettlementFixture, signedSettlementUrl, syntheticPdf } from "./helpers/signed-settlement-fixture";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

test("同单多份已签原件在小屏保持可见并跟随提交", async ({ page }) => {
  const calls = await signedSettlementFixture(page);
  await page.goto(signedSettlementUrl);
  await selectSignedContract(page);
  await page.getByLabel("选择已签 PDF 或照片").setInputFiles([syntheticPdf("signed-front.pdf"), syntheticPdf("signed-back.pdf")]);
  for (const viewport of [...viewports, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await expect(page.getByText("signed-front.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("signed-back.pdf", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "存草稿" }).click();
  await expect(page.getByText("草稿已保存")).toBeVisible();
  expect(calls.save[0]?.body.fileIds).toEqual(["uploaded-1", "uploaded-2"]);
  expect(calls.legacy).toEqual([]);
});

test("主管以当前已签版本复核，原件保持可读", async ({ page }) => {
  const calls = await signedSettlementFixture(page, "pending_review");
  await page.goto(`${signedSettlementUrl}&settlementId=signed-1`);
  await expect(page.getByText("已签原件.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "下载", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "通过并入账" }).click();
  await expect(page.getByText("已确认入账")).toBeVisible();
  expect(calls.reviews).toEqual([{ revision: 3, decision: "confirm", reason: "" }]);
  expect(calls.legacy).toEqual([]);
});

test("结算详情展示双证据并按后端状态重试与敏感重新生成", async ({ page }) => {
  let generationState: "failed" | "completed" = "failed";
  let retryCalls = 0;
  const regenerationBodies: Array<Record<string, unknown>> = [];
  await installDetailMocks(page, () => governedSettlementDetail(generationState));
  await page.route(
    "**/api/settlements/settlement-governed/signed-document-generation-retry",
    (route) => {
      retryCalls += 1;
      generationState = "completed";
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
  );
  await page.route(
    "**/api/settlements/settlement-governed/signed-document-regeneration",
    (route) => {
      regenerationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
  );
  await login(page);
  await mockApprovalProgress(page, [{ businessType: "settlement", businessId: "settlement-governed" }]);
  await page.route("**/api/settlements/settlement-governed/duty-sms", (route) => route.fulfill({ json: { notice: null } }));
  await page.route("**/api/approval-forms/settlement/settlement-governed/capability", (route) => route.fulfill({ json: { available: false } }));
  await page.goto("/结算管理/settlement-governed");
  await page.getByText("凭证资料", { exact: true }).last().click();

  const evidence = page.getByLabel("结算签章证据");
  await expect(evidence.getByText("乙方签章原件", { exact: true })).toBeVisible();
  await expect(evidence.getByText("最终内部签名合成件", { exact: true })).toBeVisible();
  await expect(evidence.getByText("最终签名合成件生成失败", { exact: true })).toBeVisible();
  await evidence.getByRole("button", { name: "重试生成签名合成件" }).click();
  await expect.poll(() => retryCalls).toBe(1);
  await expect(page.getByText("最终件已冻结", { exact: true })).toBeVisible();
  await expect(evidence.getByRole("button", { name: "下载最终内部签名合成件" })).toBeVisible();

  await evidence.getByRole("button", { name: "仅修复渲染问题并重新生成" }).click();
  await expect(page.getByText("仅修复渲染问题并重新生成？", { exact: true })).toBeVisible();
  await expect(page.getByText(/不会改变乙方原件、结算事实或审批结果/)).toBeVisible();
  await page.getByPlaceholder("说明本次操作原因").fill("最终件第 2 页签名显示错位，仅重新渲染");
  await page.getByPlaceholder("用于确认当前操作者身份").fill("Contract@2026");
  await page.getByRole("button", { name: "确认重新生成", exact: true }).click();
  await expect.poll(() => regenerationBodies).toEqual([{
    confirmPureRenderingIssue: true,
    reason: "最终件第 2 页签名显示错位，仅重新渲染",
    confirmationPassword: "Contract@2026"
  }]);
  await expect(page.getByText("操作已提交，结算详情已刷新。", { exact: true })).toBeVisible();
  await evidence.getByRole("button", { name: "确认最终签名合成件归档" }).click();
  await expect(page.getByText("确认结算归档？", { exact: true })).toBeVisible();
});

async function installDetailMocks(page: Page, detail: () => Record<string, unknown>) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-director-1",
        name: "合同部主管",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_director"],
        globalRoleKeys: ["contract_director"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-18T04:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/api/projects", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "project-1", code: "P001", name: "科技园项目" }])
  }));
  await page.route("**/api/settlements/settlement-governed/capability", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      settlementId: "settlement-governed",
      availableActions: [
        "retry_signed_document_generation",
        "regenerate_signed_document",
        "confirm_archive"
      ]
    })
  }));
  await page.route("**/api/settlements/settlement-governed", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail())
  }));
}

function governedSettlementDetail(generationState: "failed" | "completed") {
  const completed = generationState === "completed";
  const evidenceBase = {
    mimeType: "application/pdf",
    sizeBytes: 2048,
    status: "active",
    uploadedByName: "合同员",
    uploadedAt: "2026-07-18T02:00:00.000Z",
    confirmedByName: completed ? "合同部主管" : null,
    confirmedAt: null,
    disabledReason: null
  };
  return {
    id: "settlement-governed",
    settlementId: "settlement-governed",
    title: "JS-GOV-001 · 7月材料结算单",
    meta: [
      {
        label: "当前状态",
        value: completed ? "待归档确认" : "最终结算文件生成失败",
        tone: completed ? "warning" : "danger"
      },
      { label: "关联合同版本", value: "合同 v1" },
      { label: "付款条款版本", value: "v1" },
      { label: "结算期间", value: "2026年7月" },
      { label: "责任部门", value: "合同部" },
      { label: "下一步动作", value: completed ? "合同部主管确认归档" : "重试生成最终件" }
    ],
    baseInfo: [
      { label: "结算编号", value: "JS-GOV-001" },
      { label: "关联合同", value: "HT-2026-001 · 材料采购合同" },
      { label: "结算性质", value: "过程结算" },
      { label: "是否最终结算", value: "否" },
      { label: "结算金额", value: "¥100.00" },
      { label: "创建人", value: "合同员" }
    ],
    taxFactSummary: [],
    effectivenessSteps: [
      { label: "结算审批", status: "已通过", tone: "success" },
      { label: "签字盖章归档上传", status: completed ? "已上传" : "生成失败", tone: completed ? "success" : "danger" },
      { label: "合同部主管确认", status: "待处理", tone: "default" },
      { label: "结算生效", status: "未生效", tone: "default" }
    ],
    archiveResponsibilities: [],
    paymentRules: [],
    settlementLines: [],
    payableCalculation: { items: [], note: "" },
    paymentBlockMessage: "结算尚未生效。",
    archiveFiles: [
      {
        ...evidenceBase,
        recordId: "original-record",
        fileId: "original-file",
        fileName: "乙方签章扫描件.pdf",
        purpose: "乙方签章原件",
        statusLabel: "已冻结",
        canDownload: true,
        purposeKey: "counterparty_signed_original",
        generationStatus: "not_applicable",
        downloadability: "available"
      },
      {
        ...evidenceBase,
        recordId: "final-record",
        fileId: "final-file",
        fileName: "最终内部审批签名合成件.pdf",
        purpose: "最终内部审批签名合成件",
        statusLabel: completed ? "已冻结" : "生成失败",
        canDownload: completed,
        disabledReason: completed ? null : "最终签名合成件生成失败，请重试",
        purposeKey: "final_internal_signed_copy",
        generationStatus: generationState,
        downloadability: completed ? "available" : "unavailable"
      }
    ],
    approvalTimeline: [{
      id: "timeline-1",
      title: "财务主管审批",
      description: "审批通过并冻结签名",
      operator: "财务主管",
      occurredAt: "2026-07-18T01:30:00.000Z",
      status: "completed",
      statusLabel: "已完成",
      tone: "success"
    }],
    availableActions: [
      {
        key: "retry_signed_document_generation",
        label: "重试生成签名合成件",
        kind: "primary",
        enabled: !completed,
        disabledReason: completed ? "最终签名合成件已生成" : null
      },
      {
        key: "confirm_archive",
        label: "确认结算归档",
        kind: "primary",
        enabled: completed,
        disabledReason: completed ? null : "最终签名合成件尚未生成"
      }
    ],
    primaryAction: completed ? "confirm_archive" : "retry_signed_document_generation",
    disabledReasons: [],
    chainLinks: []
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}
