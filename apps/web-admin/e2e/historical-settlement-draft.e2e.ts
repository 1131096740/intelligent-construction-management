import { expect, test } from "@playwright/test";

test("旧结算草稿链接只读保留明细与历史文件", async ({ page }) => {
  const mutations: string[] = [];
  const downloads: string[] = [];
  await page.route("**/api/auth/login", route => route.fulfill({ json: {
    user: {
      id: "contract-1", name: "合同经办人", phone: "13900000000", mustChangePassword: false,
      roleKeys: ["contract_staff"], globalRoleKeys: ["contract_staff"]
    },
    tokens: { accessToken: "local-access-token", refreshToken: "local-refresh-token", expiresIn: 900 }
  } }));
  await page.route("**/api/me/work-items", route => route.fulfill({ json: {
    generatedAt: new Date().toISOString(), visibleProjectCount: 1,
    queues: { pending: [], blocked: [], started: [] },
    approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
  } }));
  await page.route("**/api/projects", route => route.fulfill({ json: [
    { id: "project-1", code: "GC-01", name: "历史桥梁工程" }
  ] }));
  await page.route("**/api/projects/project-1/settlement-drafts**", route => {
    if (route.request().method() !== "GET") {
      mutations.push(route.request().method());
      return route.fulfill({ status: 410 });
    }
    if (route.request().url().endsWith("/line-attachments")) {
      return route.fulfill({ json: [{ id: "attachment-1", fileId: "detail-file-1", fileName: "历史计量资料.pdf", purpose: "计量凭证", status: "active" }] });
    }
    return route.fulfill({ json: {
      id: "draft-1", projectId: "project-1", code: "JS-HISTORY", periodLabel: "2026-07",
      isFinal: false, status: "abandoned", abandonReason: "旧项目归档",
      availableActions: [{ key: "delete_pristine_draft", enabled: true }],
      lines: [{ sourceType: "manual_adjustment", name: "桥梁历史工程量", quantity: "2", unit: "件", amountCents: "12550" }],
      documents: { frozenDocument: { id: "document-1", fileId: "file-1", fileName: "历史结算单.pdf" } }
    } });
  });

  await page.route("**/api/files/file-1/download-ticket-capability", route => route.fulfill({ json: {
    availableActions: ["create_private_file_download_ticket"]
  } }));
  await page.route("**/api/files/file-1/download-ticket", route => {
    expect(route.request().postDataJSON()).toEqual({});
    downloads.push("ticket");
    return route.fulfill({ json: { downloadUrl: "/files/file-1/download?expiresAt=fixture", fileName: "历史结算单.pdf" } });
  });
  await page.addInitScript(() => {
    const activate = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download !== "历史结算单.pdf") return activate.call(this);
      document.documentElement.dataset.historicalDownload = this.getAttribute("href") ?? "";
    };
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/u);
  await page.goto("/结算工作台/新建?project=project-1&draftId=draft-1");
  await expect(page.getByRole("heading", { name: "历史结算草稿" })).toBeVisible();
  await expect(page.getByText("JS-HISTORY")).toBeVisible();
  await expect(page.getByText("桥梁历史工程量")).toBeVisible();
  await expect(page.getByText("125.50")).toBeVisible();
  await expect(page.getByText("冻结结算单 · 历史结算单.pdf")).toBeVisible();
  await expect(page.getByText("计量凭证 · 历史计量资料.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: /保存草稿|删除草稿|提交审批/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下载", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "下载", exact: true }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-historical-download", "/api/files/file-1/download?expiresAt=fixture");
  expect(downloads).toEqual(["ticket"]);
  expect(mutations).toEqual([]);
});
