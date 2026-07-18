import { expect, test } from "@playwright/test";

const now = "2026-07-17T08:00:00.000Z";
const project = { id: "project-1", code: "XM-001", name: "一号项目" };

test("runs final receipt, watermark preview, review and read-only closure UI", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__geoCalls", { value: 0, writable: true });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition() { (window as unknown as { __geoCalls: number }).__geoCalls += 1; },
        watchPosition() { (window as unknown as { __geoCalls: number }).__geoCalls += 1; return 1; },
        clearWatch() {}
      }
    });
  });
  await page.route("**/api/auth/login", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "handler-1", name: "物资员甲", phone: "13900000000", mustChangePassword: false, roleKeys: ["material_staff"], globalRoleKeys: [] }, tokens: { accessToken: "token", refreshToken: "refresh", expiresIn: 900 } }) }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ generatedAt: now, visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } }) }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/projects", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([project]) }));
  await page.route("**/api/spot-procurements/procurement-1/receipt", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ receipt: { id: "receipt-1", projectId: "project-1", procurementId: "procurement-1", procurementCode: "LXCG-001", procurementVersionId: "version-1", procurementVersionNo: 1, procurementVersionStatus: "approved", status: "reviewed", currentRevisionNo: 1, handler: { id: "handler-1", name: "物资员甲" }, note: null, actualCostCents: "120000", firstSubmittedAt: now, submittedAt: now, submittedBy: { id: "delegate-1", name: "受托人乙" }, lockedAt: null }, delegation: { id: "delegation-1", delegatorUserId: "handler-1", delegateUserId: "delegate-1", delegateName: "受托人乙", delegatedAt: now }, latestPdf: null, lines: [{ procurementLineId: "line-1", sortOrder: 1, materialName: "免烧砖", specification: "240×115×53", unit: "块", approvedQuantity: "1000", frozenUnitPrice: "1.2", qualifiedQuantity: "1000", unqualifiedQuantity: "0", unqualifiedReason: null, freeGiftQuantity: "0", replenishmentPending: false, discrepancyNote: null, actualCostCents: "120000" }], photos: [{ id: "photo-1", watermarkedFileId: "watermark-1", primaryFileId: "watermark-1", source: "album", category: "material_scene", note: "免烧砖", appendReason: null, uploadedByUserId: "delegate-1", serverRecordedAt: now, locked: true }], reviews: [{ id: "review-1", sequenceNo: 1, receiptRevisionNo: 1, decision: "approved", comment: "数量属实", reviewedBy: { id: "director-1", name: "物资主管" }, submissionDelegationId: "delegation-1", targetReviewId: null, createdAt: now }] }) }));
  await page.route("**/api/spot-procurements/procurement-1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ procurement: { id: "procurement-1", code: "LXCG-001", project, supplierPartyId: "party-1", supplierName: "建材门市", applicant: { id: "handler-1", name: "物资员甲" }, handler: { id: "handler-1", name: "物资员甲" }, status: "approved_in_progress", statusLabel: "采购已批，办理中", approvedAmountCents: "120000", actualCostCents: null, actualCost: { available: false, status: "not_available", label: "请查看收货" }, closedAt: null, voidedAt: null, voidReason: null, createdAt: now, updatedAt: now }, currentVersion: { id: "version-1", versionNo: 1, status: "approved", statusLabel: "审批通过", reason: "补料", note: null, supplierPartyId: "party-1", supplierName: "建材门市", handlerUserId: "handler-1", totalAmountCents: "120000", changeReason: null, changeSummary: null, submittedAt: now, approvedAt: now, createdByUserId: "handler-1", createdAt: now, updatedAt: now }, versions: [], lines: [], invoiceComposition: "invoice", attachments: [], approval: { status: "approved", statusLabel: "审批通过", currentNodeName: "完成", currentRoleKeys: [] }, approvalTimeline: [], payments: [], paymentSummary: { paymentCount: 1, activeSettlementAmountCents: "120000", companyPaymentAmountCents: "120000", paidAmountCents: "120000", supplierBalanceAmountCents: "0", executedSupplierBalanceAmountCents: "0", canceledAmountCents: "0", statusLabel: "已付", visibilityRestricted: false }, receipt: { available: false, status: "not_available", label: "查看收货详情" }, discrepancy: { available: false, status: "not_available", label: "无差异" }, applicationPdf: { available: true, generated: true, businessType: "spot_procurement_version", businessId: "version-1", disabledReason: null }, availableActions: [], primaryAction: null, disabledReasons: [] }) }));

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/零星采购收货/procurement-1");
  await expect(page.getByText("物资员甲", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("受托人乙", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("水印证据文件：watermark-1")).toBeVisible();
  await expect(page.getByText("已提交照片不可删除或替换")).toBeVisible();
  await expect(page.getByText("发票覆盖", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0);
});
